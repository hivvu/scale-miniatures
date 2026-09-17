/**
 * The relay's rules, and the WebSocket frames underneath them.
 *
 * The frame codec is the part of this project most likely to be wrong in a way that only shows up on
 * somebody else's network: a browser is allowed to fragment, to mask with any four bytes it likes, and to
 * send a control frame in the middle of a message. So it is tested against those rather than against the
 * one shape a browser happened to send while it was being written.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { accept, encode, decode, close, OP } from '../../server/ws.mjs';
import { Rooms, parseJoin, normaliseCode, makeCode, tag, ALPHABET, CODE_LENGTH, MAX_PLAYERS } from '../../server/relay.mjs';

/** A client frame, masked as the standard requires of one. */
function clientFrame(opcode: number, payload: Buffer | string, fin = true, mask = [0x37, 0xFA, 0x21, 0x3D]): Buffer {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const n = body.length;
  let head: Buffer;
  if (n < 126) { head = Buffer.alloc(2); head[1] = 0x80 | n; }
  else if (n < 65536) { head = Buffer.alloc(4); head[1] = 0x80 | 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(n), 2); }
  head[0] = (fin ? 0x80 : 0) | opcode;
  const m = Buffer.from(mask);
  const masked = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) masked[i] = body[i]! ^ m[i & 3]!;
  return Buffer.concat([head, m, masked]);
}

describe('the handshake', () => {
  it('answers with the hash the standard asks for', () => {
    // The example from RFC 6455 section 1.3, which is the one value every implementation agrees on.
    expect(accept('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
    const mine = 'x3JJHMbDL1EzLkh9GBhXDw==';
    const want = createHash('sha1').update(mine + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    expect(accept(mine)).toBe(want);
  });
});

describe('reading frames', () => {
  it('reads a short one', () => {
    const { messages, rest } = decode(clientFrame(OP.TEXT, 'hello'));
    expect(messages).toHaveLength(1);
    expect(messages[0]!.payload.toString()).toBe('hello');
    expect(rest).toHaveLength(0);
  });

  it('reads two that arrived together', () => {
    const buf = Buffer.concat([clientFrame(OP.TEXT, 'one'), clientFrame(OP.BINARY, Buffer.from([1, 2, 3]))]);
    const { messages } = decode(buf);
    expect(messages.map(m => m.opcode)).toEqual([OP.TEXT, OP.BINARY]);
    expect([...messages[1]!.payload]).toEqual([1, 2, 3]);
  });

  it('waits for one that is only half here, and finishes it when the rest turns up', () => {
    const whole = clientFrame(OP.TEXT, 'a longer message than one packet');
    const first = decode(whole.subarray(0, 9));
    expect(first.messages).toHaveLength(0);
    const second = decode(Buffer.concat([first.rest, whole.subarray(9)]));
    expect(second.messages[0]!.payload.toString()).toBe('a longer message than one packet');
  });

  it('joins a message a browser chose to split', () => {
    const a = clientFrame(OP.TEXT, 'split ', false);
    const b = clientFrame(OP.CONT, 'message', true);
    const first = decode(a);
    expect(first.messages).toHaveLength(0);
    const second = decode(b, 1 << 16, first.carry);
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0]!.payload.toString()).toBe('split message');
    expect(second.messages[0]!.opcode).toBe(OP.TEXT);
  });

  it('lets a ping through the middle of a split message', () => {
    const buf = Buffer.concat([
      clientFrame(OP.TEXT, 'half ', false),
      clientFrame(OP.PING, 'are you there'),
      clientFrame(OP.CONT, 'and half', true),
    ]);
    const { messages } = decode(buf);
    expect(messages.map(m => m.opcode)).toEqual([OP.PING, OP.TEXT]);
    expect(messages[1]!.payload.toString()).toBe('half and half');
  });

  it('reads the two longer length forms', () => {
    for (const n of [126, 200, 70000]) {
      const body = Buffer.alloc(n, 7);
      const { messages } = decode(clientFrame(OP.BINARY, body), 1 << 20);
      expect(messages[0]!.payload).toHaveLength(n);
    }
  });

  it('refuses a frame that is not masked, as a client frame must be', () => {
    const { error } = decode(encode(OP.TEXT, 'from a server'));
    expect(error).toMatch(/unmasked/);
  });

  it('refuses a frame bigger than it is willing to hold', () => {
    expect(decode(clientFrame(OP.BINARY, Buffer.alloc(5000)), 4096).error).toMatch(/too large/);
    // and the 64-bit form too, without allocating anything
    const head = Buffer.alloc(14);
    head[0] = 0x82; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(1 << 30), 2);
    expect(decode(head, 4096).error).toMatch(/too large/);
  });

  it('refuses a continuation that started nowhere', () => {
    expect(decode(clientFrame(OP.CONT, 'orphan')).error).toMatch(/continuation/);
  });
});

describe('writing frames', () => {
  it('uses the shortest header that fits, and never masks', () => {
    expect(encode(OP.TEXT, 'hi')).toHaveLength(2 + 2);
    expect(encode(OP.BINARY, Buffer.alloc(200))).toHaveLength(4 + 200);
    expect(encode(OP.BINARY, Buffer.alloc(70000))).toHaveLength(10 + 70000);
    expect(encode(OP.TEXT, 'hi')[1]! & 0x80).toBe(0);      // the mask bit, which a server must not set
  });

  it('says why it is closing', () => {
    const f = close(1002, 'bad frame');
    expect(f[0]! & 0x0F).toBe(OP.CLOSE);
    expect(f.subarray(2).readUInt16BE(0)).toBe(1002);
    expect(f.subarray(4).toString()).toBe('bad frame');
  });
});

describe('room codes', () => {
  it('are four letters with no vowels in them', () => {
    for (let i = 0; i < 200; i++) {
      const c = makeCode();
      expect(c).toHaveLength(CODE_LENGTH);
      for (const ch of c) expect(ALPHABET).toContain(ch);
      expect(c).not.toMatch(/[AEIOU]/);
    }
  });

  it('forgive how somebody types one', () => {
    expect(normaliseCode(' bcdf ')).toBe('BCDF');
    expect(normaliseCode('BCDF')).toBe('BCDF');
    expect(normaliseCode('BCD')).toBeUndefined();
    expect(normaliseCode('BCDA')).toBeUndefined();         // A is not in the alphabet
    expect(normaliseCode(42)).toBeUndefined();
    expect(normaliseCode(null)).toBeUndefined();
  });
});

describe('the first message', () => {
  it('asks for a new room, or a named one', () => {
    expect(parseJoin('{"join":null}')).toEqual({ create: true });
    expect(parseJoin('{"join":"bcdf"}')).toEqual({ code: 'BCDF' });
  });

  it('refuses everything else, and says which kind of wrong it is', () => {
    expect(parseJoin('not json').error).toMatch(/JSON/);
    expect(parseJoin('{"hello":1}').error).toMatch(/join/);
    expect(parseJoin('[]').error).toMatch(/join/);
    expect(parseJoin('{"join":"nope"}').error).toMatch(/four letters/);
  });
});

describe('rooms', () => {
  it('hand out slots from the bottom, and give them back', () => {
    const r = new Rooms();
    const code = r.create()!;
    expect(r.join(code, 'a')).toEqual({ slot: 0, peers: [] });
    expect(r.join(code, 'b')).toEqual({ slot: 1, peers: [0] });
    expect(r.join(code, 'c')).toEqual({ slot: 2, peers: [0, 1] });
    r.leave(code, 1);
    expect(r.join(code, 'd')).toEqual({ slot: 1, peers: [0, 2] });   // the gap is reused
  });

  it('say what went wrong rather than just no', () => {
    const r = new Rooms();
    expect(r.join('ZZZZ', 'a')).toEqual({ error: 'no such room' });
    const code = r.create()!;
    for (let i = 0; i < MAX_PLAYERS; i++) r.join(code, i);
    expect(r.join(code, 'late')).toEqual({ error: 'that room is full' });
  });

  it('forward to everybody but the sender', () => {
    const r = new Rooms();
    const code = r.create()!;
    r.join(code, 'a'); r.join(code, 'b'); r.join(code, 'c');
    expect(r.others(code, 1)).toEqual(['a', 'c']);
  });

  it('disappear when the last person leaves', () => {
    const r = new Rooms();
    const code = r.create()!;
    r.join(code, 'a'); r.join(code, 'b');
    r.leave(code, 0); r.leave(code, 1);
    expect(r.size(code)).toBe(0);
    expect(r.join(code, 'c')).toEqual({ error: 'no such room' });
  });

  it('let go of a room nobody has used for a while', () => {
    let clock = 0;
    const r = new Rooms(500, () => clock);
    const code = r.create()!;
    r.join(code, 'a');
    clock += 21 * 60 * 1000;
    r.sweep();
    expect(r.join(code, 'b')).toEqual({ error: 'no such room' });
  });

  it('refuse to make more rooms than they were told to hold', () => {
    const r = new Rooms(2);
    expect(r.create()).toBeTruthy();
    expect(r.create()).toBeTruthy();
    expect(r.create()).toBeUndefined();
  });

  it('never hand out the same code twice', () => {
    const r = new Rooms(4);
    let n = 0;
    const rand = (): number => [0, 0, 0, 0, 0, 0, 0, 1][n++] ?? 2;   // forced into a collision, then past it
    const first = r.create(rand)!;
    const second = r.create(rand)!;
    expect(second).not.toBe(first);
  });
});

describe('forwarding', () => {
  it('puts the sender on the front and leaves the rest alone', () => {
    const out = tag(2, Buffer.from([9, 8, 7]));
    expect([...out]).toEqual([2, 9, 8, 7]);
  });
});

/**
 * Just enough WebSocket to relay small packets, written out rather than depended on.
 *
 * The server has never had a dependency and this is not the place to start: the protocol we need is the
 * handshake (RFC 6455 section 4.2.2, which is a SHA-1 and a base64 away from being nothing at all) and
 * reading and writing frames. Everything a library would give us beyond that is for the cases we do not
 * have: no compression extension, no subprotocols, no TLS of our own (Cloudflare and Caddy are in front).
 *
 * Everything here is a pure function on buffers, so it is testable without a socket, which is the same
 * shape the poll service already has.
 */
import { createHash } from 'node:crypto';

/** RFC 6455: the one constant every implementation shares. */
const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const OP = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xA };

/** The value that goes back in Sec-WebSocket-Accept. */
export function accept(key) {
  return createHash('sha1').update(String(key) + MAGIC).digest('base64');
}

/** The bytes of a successful upgrade response. */
export function handshake(key) {
  return Buffer.from(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept(key)}\r\n\r\n`,
  );
}

/**
 * One frame, ready to send. Server frames are never masked, which is what the standard says and also what
 * every browser checks.
 */
export function encode(opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const n = body.length;
  let head;
  if (n < 126) {
    head = Buffer.alloc(2);
    head[1] = n;
  } else if (n < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(n, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  head[0] = 0x80 | opcode;                  // FIN, and never a fragment: our messages are small
  return Buffer.concat([head, body]);
}

/**
 * Reads whole frames out of whatever has arrived so far, and hands back the tail that is still only part of
 * one. Continuation frames are joined, because a browser is allowed to fragment even a short message and a
 * relay that assumed otherwise would work in testing and fail on somebody else's network.
 *
 * Returns `{ messages, rest, error }`. A frame longer than `limit` is an error rather than an allocation:
 * this is a relay for one input byte at a time, and anything big is either a bug or somebody trying it on.
 */
export function decode(buffer, limit = 1 << 16, carry = null) {
  const messages = [];
  let at = 0;
  let joined = carry;                       // { opcode, parts } while a fragmented message is arriving
  for (;;) {
    if (buffer.length - at < 2) break;
    const b0 = buffer[at], b1 = buffer[at + 1];
    const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0F, masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7F, head = 2;
    if (len === 126) {
      if (buffer.length - at < 4) break;
      len = buffer.readUInt16BE(at + 2); head = 4;
    } else if (len === 127) {
      if (buffer.length - at < 10) break;
      const big = buffer.readBigUInt64BE(at + 2);
      if (big > BigInt(limit)) return { messages, rest: buffer.subarray(at), error: 'frame too large', carry: joined };
      len = Number(big); head = 10;
    }
    if (len > limit) return { messages, rest: buffer.subarray(at), error: 'frame too large', carry: joined };
    // A client frame must be masked; the standard says to fail the connection when it is not.
    if (!masked) return { messages, rest: buffer.subarray(at), error: 'unmasked frame from a client', carry: joined };
    const total = head + 4 + len;
    if (buffer.length - at < total) break;
    const mask = buffer.subarray(at + head, at + head + 4);
    const body = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) body[i] = buffer[at + head + 4 + i] ^ mask[i & 3];
    at += total;

    if (opcode === OP.CLOSE || opcode === OP.PING || opcode === OP.PONG) {
      messages.push({ opcode, payload: body });        // control frames are never fragmented
      continue;
    }
    if (opcode === OP.CONT) {
      if (!joined) return { messages, rest: buffer.subarray(at), error: 'continuation without a start', carry: null };
      joined.parts.push(body);
    } else {
      if (joined) return { messages, rest: buffer.subarray(at), error: 'a new message inside another', carry: null };
      joined = { opcode, parts: [body] };
    }
    if (fin) {
      messages.push({ opcode: joined.opcode, payload: Buffer.concat(joined.parts) });
      joined = null;
    }
  }
  return { messages, rest: buffer.subarray(at), carry: joined };
}

/** A close frame with a code and a reason, which browsers show in the console and people report back. */
export function close(code = 1000, reason = '') {
  const r = Buffer.from(reason);
  const b = Buffer.allocUnsafe(2 + r.length);
  b.writeUInt16BE(code, 0);
  r.copy(b, 2);
  return encode(OP.CLOSE, b);
}

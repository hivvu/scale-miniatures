/**
 * The relay behind playing online. Node with no dependencies, one file, and no idea what a race is.
 *
 *   GET /api/relay   with an Upgrade: websocket header
 *
 * A client's first message is `{"join":"BCDF"}` to enter a room, or `{"join":null}` to make one. The reply
 * is `{"room":"BCDF","slot":0,"peers":[1]}`. After that every message is passed to the other members of the
 * room with the sender's slot on the front, and nothing is ever inspected.
 *
 * Keeping it ignorant is deliberate. A relay that understood the game would need to be kept in step with
 * the game, would have opinions about who is allowed to be where, and would be a third machine able to
 * disagree with the two that matter. This one forwards bytes, and the only thing it can get wrong is who
 * it forwards them to.
 *
 * Configuration, all optional:
 *   SM_RELAY_PORT    port to listen on                     (default 8788)
 *   SM_RELAY_PROXY   set to 1 behind a reverse proxy, to read X-Forwarded-For
 *   SM_RELAY_ROOMS   how many rooms may exist at once      (default 500)
 */
import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { decode, encode, close, handshake, OP } from './ws.mjs';

/** No vowels, so a code is never a word, and no letters that read as each other out loud. */
export const ALPHABET = 'BCDFGHJKLMNPRSTVWXZ';
export const CODE_LENGTH = 4;
/** Room slots: four cars, four people. */
export const MAX_PLAYERS = 4;
/** A room nobody has spoken in for this long is gone. */
export const IDLE_MS = 20 * 60 * 1000;
/**
 * How often to ping a quiet connection. Two people sitting in a lobby say nothing to each other, and
 * Cloudflare drops a WebSocket that has been silent for about a hundred seconds, so without this the room
 * dies while they are still reading the code out loud. Browsers answer a ping by themselves.
 */
export const KEEPALIVE_MS = 25 * 1000;
const MAX_FRAME = 4096;
const MAX_ROOMS_DEFAULT = 500;

export function makeCode(rand = (n) => randomInt(n)) {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += ALPHABET[rand(ALPHABET.length)];
  return s;
}

/** What a client may have typed. Case and stray spaces are the user's business, not theirs to get right. */
export function normaliseCode(input) {
  if (typeof input !== 'string') return undefined;
  const s = input.trim().toUpperCase();
  if (s.length !== CODE_LENGTH) return undefined;
  for (const c of s) if (!ALPHABET.includes(c)) return undefined;
  return s;
}

/**
 * The rooms, with no sockets in sight. A member is any object at all; the server puts its connection in
 * there, a test puts a plain array. That is what makes the joining and leaving rules testable.
 */
export class Rooms {
  constructor(max = MAX_ROOMS_DEFAULT, now = () => Date.now()) {
    this.rooms = new Map();
    this.max = max;
    this.now = now;
  }

  /** Makes a room and returns its code, or undefined when there is no room for another one. */
  create(rand) {
    this.sweep();
    if (this.rooms.size >= this.max) return undefined;
    let code;
    do { code = makeCode(rand); } while (this.rooms.has(code));
    this.rooms.set(code, { members: new Map(), at: this.now() });
    return code;
  }

  /**
   * Puts a member in a room. Returns `{ slot, peers }`, or `{ error }` saying which of the three things
   * went wrong, because "could not join" on its own sends people to look in the wrong place.
   */
  join(code, member) {
    this.sweep();
    const room = this.rooms.get(code);
    if (!room) return { error: 'no such room' };
    if (room.members.size >= MAX_PLAYERS) return { error: 'that room is full' };
    let slot = 0;
    while (room.members.has(slot)) slot++;
    room.members.set(slot, member);
    room.at = this.now();
    return { slot, peers: [...room.members.keys()].filter(s => s !== slot) };
  }

  leave(code, slot) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.members.delete(slot);
    if (room.members.size === 0) this.rooms.delete(code);
  }

  /** Everybody in the room except one slot: the list a message gets forwarded to. */
  others(code, slot) {
    const room = this.rooms.get(code);
    if (!room) return [];
    room.at = this.now();
    return [...room.members.entries()].filter(([s]) => s !== slot).map(([, m]) => m);
  }

  size(code) { return this.rooms.get(code)?.members.size ?? 0; }

  /** Drops rooms nobody has used for a while, so a forgotten tab does not hold a code for ever. */
  sweep() {
    const cutoff = this.now() - IDLE_MS;
    for (const [code, room] of this.rooms) if (room.at < cutoff) this.rooms.delete(code);
  }
}

/**
 * The first message. Returns `{ create: true }`, `{ code }`, or `{ error }`. Anything else a client sends
 * before it has joined is refused rather than guessed at.
 */
export function parseJoin(text) {
  let body;
  try { body = JSON.parse(text); } catch { return { error: 'that is not JSON' }; }
  // Arrays are objects, and `'join' in []` is true, because Array.prototype has a join. Without this an
  // array slips past the guard and comes back complaining about the room code instead.
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { error: 'expected a join' };
  if (!('join' in body)) return { error: 'expected a join' };
  if (body.join === null || body.join === undefined) return { create: true };
  const code = normaliseCode(body.join);
  return code ? { code } : { error: 'a room code is four letters' };
}

/** A forwarded message: the sender's slot, then whatever they sent, untouched. */
export function tag(slot, payload) {
  const out = Buffer.allocUnsafe(payload.length + 1);
  out[0] = slot;
  payload.copy ? payload.copy(out, 1) : Buffer.from(payload).copy(out, 1);
  return out;
}

// ---------------------------------------------------------------- the server

const PORT = Number(process.env.SM_RELAY_PORT ?? 8788);
const TRUST_PROXY = process.env.SM_RELAY_PROXY === '1';
const MAX_ROOMS = Number(process.env.SM_RELAY_ROOMS ?? MAX_ROOMS_DEFAULT);

function addressOf(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function start(port = PORT) {
  const rooms = new Rooms(MAX_ROOMS);
  const server = createServer((req, res) => {
    // The only plain request worth answering is a health check; everything else here is an upgrade.
    if ((req.url ?? '').split('?')[0] === '/api/relay') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size }));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if ((req.url ?? '').split('?')[0] !== '/api/relay' || !key) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    socket.write(handshake(key));
    socket.setNoDelay(true);                 // every millisecond here is a millisecond of input delay

    const client = { socket, code: undefined, slot: -1, who: addressOf(req) };
    let buffer = Buffer.alloc(0);
    let carry = null;

    const send = (opcode, payload) => { if (!socket.destroyed) socket.write(encode(opcode, payload)); };
    const fail = (reason, code = 1008) => {
      if (!socket.destroyed) { socket.write(close(code, reason)); socket.end(); }
    };
    client.send = send;

    const beat = setInterval(() => send(OP.PING), KEEPALIVE_MS);
    beat.unref?.();

    const bye = () => {
      clearInterval(beat);
      if (client.code !== undefined) {
        for (const m of rooms.others(client.code, client.slot)) {
          m.send(OP.TEXT, JSON.stringify({ left: client.slot }));
        }
        rooms.leave(client.code, client.slot);
      }
      client.code = undefined;
    };

    socket.on('data', chunk => {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      const { messages, rest, error, carry: next } = decode(buffer, MAX_FRAME, carry);
      buffer = Buffer.from(rest);
      carry = next ?? null;
      if (error) return fail(error, 1002);

      for (const { opcode, payload } of messages) {
        if (opcode === OP.CLOSE) { bye(); return fail('bye', 1000); }
        if (opcode === OP.PING) { send(OP.PONG, payload); continue; }
        if (opcode === OP.PONG) continue;

        if (client.code === undefined) {                       // still on the doorstep
          const want = parseJoin(payload.toString('utf8'));
          if (want.error) { send(OP.TEXT, JSON.stringify({ error: want.error })); continue; }
          const code = want.create ? rooms.create() : want.code;
          if (!code) { send(OP.TEXT, JSON.stringify({ error: 'no room for another room' })); continue; }
          const got = rooms.join(code, client);
          if (got.error) { send(OP.TEXT, JSON.stringify({ error: got.error })); continue; }
          client.code = code; client.slot = got.slot;
          send(OP.TEXT, JSON.stringify({ room: code, slot: got.slot, peers: got.peers }));
          for (const m of rooms.others(code, got.slot)) m.send(OP.TEXT, JSON.stringify({ joined: got.slot }));
          continue;
        }

        // Joined: forward, and do not look inside.
        const out = tag(client.slot, payload);
        for (const m of rooms.others(client.code, client.slot)) m.send(opcode, out);
      }
    });

    socket.on('close', bye);
    socket.on('error', bye);
  });

  server.listen(port);
  server.on('listening', () => console.log(`relay: listening on ${server.address()?.port ?? port}`));
  return server;
}

// Run only when this file is the program, so the tests can import the parts above without a socket.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) start();

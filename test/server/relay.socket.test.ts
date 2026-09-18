/**
 * The relay with real sockets on it.
 *
 * The rest of the server is tested without binding anything, on the grounds that the HTTP shell is thin
 * enough to read. This one is not: the handshake and the frame codec are written out here rather than
 * depended on, so the thing worth proving is that a real browser-grade client can talk to it. Node's own
 * WebSocket is that client.
 */
import { describe, it, expect, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { start } from '../../server/relay.mjs';

const server: Server = start(0);
const port = await new Promise<number>(res => {
  server.on('listening', () => res((server.address() as { port: number }).port));
});
afterAll(() => { server.close(); });

interface Client { ws: WebSocket; text: string[]; binary: number[][]; }

function open(): Promise<Client> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/relay`);
    ws.binaryType = 'arraybuffer';
    const c: Client = { ws, text: [], binary: [] };
    ws.onmessage = e => {
      if (typeof e.data === 'string') c.text.push(e.data);
      else c.binary.push([...new Uint8Array(e.data as ArrayBuffer)]);
    };
    ws.onopen = () => res(c);
    ws.onerror = rej;
  });
}

const settle = (): Promise<void> => new Promise(r => setTimeout(r, 120));

describe('two clients and a relay', () => {
  it('makes a room, lets the other one in, and passes bytes between them', async () => {
    const a = await open();
    a.ws.send(JSON.stringify({ join: null }));
    await settle();
    const hello = JSON.parse(a.text[0]!) as { room: string; slot: number; peers: number[] };
    expect(hello.slot).toBe(0);
    expect(hello.peers).toEqual([]);
    expect(hello.room).toHaveLength(4);

    const b = await open();
    b.ws.send(JSON.stringify({ join: hello.room.toLowerCase() }));   // typed in lower case, as people do
    await settle();
    expect(JSON.parse(b.text[0]!)).toEqual({ room: hello.room, slot: 1, peers: [0] });
    expect(JSON.parse(a.text[1]!)).toEqual({ joined: 1 });

    b.ws.send(new Uint8Array([1, 2, 3]));
    a.ws.send(new Uint8Array([9, 9]));
    await settle();
    expect(a.binary).toEqual([[1, 1, 2, 3]]);              // slot 1 said 1,2,3
    expect(b.binary).toEqual([[0, 9, 9]]);                 // slot 0 said 9,9

    b.ws.close();
    await settle();
    expect(JSON.parse(a.text[2]!)).toEqual({ left: 1 });
    a.ws.close();
  });

  it('says so when the room is not there', async () => {
    const c = await open();
    c.ws.send(JSON.stringify({ join: 'ZZZZ' }));
    await settle();
    expect(JSON.parse(c.text[0]!)).toEqual({ error: 'no such room' });
    c.ws.close();
  });

  it('answers a plain GET, so a deploy can check it is alive', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/relay`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true });
  });
});

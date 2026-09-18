/**
 * The browser client against the real relay.
 *
 * Both halves were tested apart already: the server's frame codec against hand-built frames, the packet
 * codec against its own bytes. What neither proves is that they meet. Node's WebSocket is the same client a
 * browser is, so this runs the two ends against each other over a real socket, which is the only way to find
 * out that (say) the slot byte is being stripped twice.
 */
import { describe, it, expect, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { start } from '../../server/relay.mjs';
import { Relay } from '../../src/hal/net/Relay';
import { encodeInput, decodePacket, INPUT } from '../../src/net/packet';

const server: Server = start(0);
const port = await new Promise<number>(res => {
  server.on('listening', () => res((server.address() as { port: number }).port));
});
const url = `ws://127.0.0.1:${port}/api/relay`;
afterAll(() => { server.close(); });

const settle = (): Promise<void> => new Promise(r => setTimeout(r, 120));

describe('the relay client', () => {
  it('makes a room, lets somebody in, and carries packets between them', async () => {
    const a = await Relay.join(undefined, url);
    expect(a.slot).toBe(0);
    expect(a.room).toHaveLength(4);
    expect(a.peers).toEqual([]);

    const joined: number[] = [];
    a.onJoin = s => joined.push(s);
    const got: { from: number; step: number; bytes: number[] }[] = [];
    a.onPacket = (from, data) => {
      const p = decodePacket(data);
      if (p?.kind === INPUT) got.push({ from, step: p.from, bytes: [...p.bytes] });
    };

    const b = await Relay.join(a.room.toLowerCase(), url);   // typed in lower case, as people do
    await settle();
    expect(b.slot).toBe(1);
    expect(b.peers).toEqual([0]);
    expect(joined).toEqual([1]);
    expect(a.peers).toEqual([1]);

    b.send(encodeInput(0, 41, [0x20, 0x60]));
    await settle();
    expect(got).toEqual([{ from: 1, step: 41, bytes: [0x20, 0x60] }]);

    const left: number[] = [];
    a.onLeave = s => left.push(s);
    b.close();
    await settle();
    expect(left).toEqual([1]);
    expect(a.peers).toEqual([]);
    a.close();
  });

  it('says what was actually wrong with the room, not just that it failed', async () => {
    await expect(Relay.join('ZZZZ', url)).rejects.toThrow('no such room');
  });

  it('hears about somebody leaving without losing its own connection', async () => {
    const a = await Relay.join(undefined, url);
    const b = await Relay.join(a.room, url);
    await settle();
    const left: number[] = [];
    b.onLeave = s => left.push(s);
    a.close();                                   // their socket goes, not the room
    await settle();
    expect(left).toEqual([0]);
    expect(b.open).toBe(true);                   // b is still in its room, waiting for somebody else
    b.close();
  });
});

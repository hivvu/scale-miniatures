/**
 * The browser end of `server/relay.mjs`: a WebSocket, a four letter room, and bytes in both directions.
 *
 * The protocol is deliberately tiny, because the relay is deliberately ignorant. The first message says
 * which room ({"join":"BCDF"}, or {"join":null} to make one) and the reply says who we turned out to be.
 * After that, text from the socket is the relay talking about the room and binary is another player talking
 * about the race, with their slot on the front. Nothing here looks inside a player's bytes.
 */
import type { NetTransport, Slot } from '../../net/transport';

/** Where the relay is, given where the page came from. Caddy puts it on /api/relay next to the poll. */
export function relayUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/api/relay`;
}

interface Hello { room: string; slot: number; peers: number[] }

export class Relay implements NetTransport {
  readonly room: string;
  readonly slot: Slot;
  readonly peers: Slot[];
  onPacket: ((from: Slot, data: Uint8Array) => void) | undefined;
  onJoin: ((slot: Slot) => void) | undefined;
  onLeave: ((slot: Slot) => void) | undefined;
  onError: ((why: string) => void) | undefined;

  private constructor(private readonly ws: WebSocket, hello: Hello) {
    this.room = hello.room;
    this.slot = hello.slot;
    this.peers = [...hello.peers];
    ws.onmessage = e => this.take(e.data);
    ws.onclose = () => { this.shut(); };
    ws.onerror = () => { this.onError?.('the connection to the relay failed'); };
  }

  get open(): boolean { return this.ws.readyState === WebSocket.OPEN; }

  /**
   * Joins `room`, or makes one when it is undefined. Rejects with what the relay said rather than a generic
   * failure: "no such room" and "that room is full" send somebody to look in completely different places.
   */
  static join(room?: string, url = relayUrl()): Promise<Relay> {
    return new Promise<Relay>((resolve, reject) => {
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch (e) { reject(new Error(String(e))); return; }
      ws.binaryType = 'arraybuffer';
      const fail = (why: string): void => { ws.onmessage = null; ws.onclose = null; ws.close(); reject(new Error(why)); };
      ws.onopen = () => { ws.send(JSON.stringify({ join: room ?? null })); };
      ws.onerror = () => { fail('cannot reach the relay'); };
      ws.onclose = () => { reject(new Error('the relay closed the connection')); };
      ws.onmessage = e => {
        if (typeof e.data !== 'string') return fail('the relay said something unexpected');
        let body: Partial<Hello> & { error?: string };
        try { body = JSON.parse(e.data) as Partial<Hello> & { error?: string }; }
        catch { return fail('the relay said something unexpected'); }
        if (typeof body.error === 'string') return fail(body.error);
        if (typeof body.room !== 'string' || typeof body.slot !== 'number') return fail('the relay said something unexpected');
        resolve(new Relay(ws, { room: body.room, slot: body.slot, peers: body.peers ?? [] }));
      };
    });
  }

  send(data: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  close(): void { this.ws.close(); }

  private take(data: unknown): void {
    if (typeof data === 'string') return this.news(data);
    if (!(data instanceof ArrayBuffer) || data.byteLength < 1) return;
    const all = new Uint8Array(data);
    this.onPacket?.(all[0]!, all.subarray(1));
  }

  /** Text is the relay itself, talking about who is in the room. */
  private news(text: string): void {
    let body: { joined?: number; left?: number; error?: string };
    try { body = JSON.parse(text) as typeof body; } catch { return; }
    if (typeof body.error === 'string') { this.onError?.(body.error); return; }
    if (typeof body.joined === 'number') {
      if (!this.peers.includes(body.joined)) this.peers.push(body.joined);
      this.onJoin?.(body.joined);
    }
    if (typeof body.left === 'number') {
      const i = this.peers.indexOf(body.left);
      if (i >= 0) this.peers.splice(i, 1);
      this.onLeave?.(body.left);
    }
  }

  /** The socket went: everybody in the room is gone as far as this machine is concerned. */
  private shut(): void {
    for (const p of this.peers.splice(0)) this.onLeave?.(p);
  }
}

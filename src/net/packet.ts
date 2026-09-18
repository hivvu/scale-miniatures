/**
 * What goes on the wire, and nothing else.
 *
 * Three kinds of message, all binary, all small. Inputs are the only thing sent often: one byte per player
 * per step, about 47 steps a second at the default SMOOTHNESS. Everything else (agreeing a race, saying who
 * is ready) is rare enough that JSON inside a `say` is the right price to pay for being able to read a
 * packet dump.
 *
 * **Every input packet repeats the last few steps.** A dropped packet would otherwise lose a step's byte for
 * ever, and there is no asking for it again: the machine that needed it has already guessed and moved on, and
 * would carry a wrong guess as truth to the end of the race. Repetition costs eight bytes and removes the
 * whole problem, which is why it is here and not a retry.
 */

export const INPUT = 1;
export const HASH = 2;
export const SAY = 3;

/** How many steps of input each packet carries. Eight is about 170 ms: two packets may be lost in a row. */
export const REDUNDANCY = 8;

export interface InputPacket { kind: typeof INPUT; gen: number; from: number; bytes: Uint8Array }
export interface HashPacket { kind: typeof HASH; gen: number; step: number; hash: number }
export interface SayPacket { kind: typeof SAY; text: string }
export type Packet = InputPacket | HashPacket | SayPacket;

/**
 * `gen` is which race of the evening this is. A playlist runs several, each counting its steps from zero
 * again, so without it the last packets of one track arrive during the first seconds of the next and drive
 * somebody's car with input meant for a different map.
 */
export function encodeInput(gen: number, from: number, bytes: ArrayLike<number>): Uint8Array {
  const n = Math.min(bytes.length, 0xFF);
  const skip = bytes.length - n;              // a run longer than a byte can count keeps its newest end
  const out = new Uint8Array(7 + n);
  const v = new DataView(out.buffer);
  out[0] = INPUT;
  out[1] = gen & 0xFF;
  v.setUint32(2, from + skip, true);
  out[6] = n;
  for (let i = 0; i < n; i++) out[7 + i] = bytes[skip + i]! & 0xFF;
  return out;
}

export function encodeHash(gen: number, step: number, hash: number): Uint8Array {
  const out = new Uint8Array(10);
  const v = new DataView(out.buffer);
  out[0] = HASH;
  out[1] = gen & 0xFF;
  v.setUint32(2, step, true);
  v.setUint32(6, hash >>> 0, true);
  return out;
}

export function encodeSay(body: unknown): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(body));
  const out = new Uint8Array(1 + text.length);
  out[0] = SAY;
  out.set(text, 1);
  return out;
}

/** Anything unrecognised is dropped rather than guessed at: the wire is public and a race is not worth risking. */
export function decodePacket(data: Uint8Array): Packet | undefined {
  if (data.length < 1) return undefined;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  switch (data[0]) {
    case INPUT: {
      if (data.length < 7) return undefined;
      const n = data[6]!;
      if (data.length < 7 + n) return undefined;
      return { kind: INPUT, gen: data[1]!, from: v.getUint32(2, true), bytes: data.subarray(7, 7 + n) };
    }
    case HASH:
      if (data.length < 10) return undefined;
      return { kind: HASH, gen: data[1]!, step: v.getUint32(2, true), hash: v.getUint32(6, true) };
    case SAY:
      return { kind: SAY, text: new TextDecoder().decode(data.subarray(1)) };
    default:
      return undefined;
  }
}

/**
 * One player's own bytes, kept long enough to be repeated. `packet` is what gets sent; it carries the tail
 * of the history, so a machine that missed the last one catches up from the next without asking.
 */
export class Outbox {
  private readonly bytes: number[] = [];
  /** The last step recorded, or -1. */
  last = -1;

  record(step: number, byte: number): void {
    this.bytes[step] = byte & 0xFF;
    if (step > this.last) this.last = step;
  }

  /** Undefined when there is nothing to say yet. */
  packet(gen: number, redundancy = REDUNDANCY): Uint8Array | undefined {
    if (this.last < 0) return undefined;
    const from = Math.max(0, this.last - redundancy + 1);
    const tail: number[] = [];
    for (let s = from; s <= this.last; s++) tail.push(this.bytes[s] ?? 0);
    return encodeInput(gen, from, tail);
  }
}

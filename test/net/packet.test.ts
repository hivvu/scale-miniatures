/**
 * What goes on the wire.
 *
 * The codec is small enough to read, which is exactly why it is worth testing: a wrong step number in an
 * input packet does not crash anything, it silently drives the other player's car with somebody else's keys
 * from half a second ago, and the only symptom is that the race feels wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  encodeInput, encodeHash, encodeSay, decodePacket, Outbox, INPUT, HASH, SAY, REDUNDANCY,
} from '../../src/net/packet';

describe('input packets', () => {
  it('say which race of the night they belong to', () => {
    const p = decodePacket(encodeInput(7, 1, [0x20]));
    expect(p?.kind === INPUT && p.gen).toBe(7);
  });

  it('come back as the steps they went in as', () => {
    const p = decodePacket(encodeInput(0, 1000, [0x20, 0xA0, 0x60]));
    expect(p?.kind).toBe(INPUT);
    if (p?.kind !== INPUT) return;
    expect(p.from).toBe(1000);
    expect([...p.bytes]).toEqual([0x20, 0xA0, 0x60]);
  });

  it('survive a step number past 65535, which a five minute race reaches', () => {
    const p = decodePacket(encodeInput(3, 100_000, [1]));
    expect(p?.kind === INPUT && p.from).toBe(100_000);
  });

  it('keep the newest end when asked to carry more than a count can hold', () => {
    const many = Array.from({ length: 300 }, (_, i) => i & 0xFF);
    const p = decodePacket(encodeInput(1, 0, many));
    if (p?.kind !== INPUT) throw new Error('not an input packet');
    expect(p.bytes).toHaveLength(255);
    expect(p.from).toBe(45);                       // the 45 oldest were dropped, and `from` says so
    expect(p.bytes[0]).toBe(45);
  });
});

describe('the other two kinds', () => {
  it('carry a step and a hash', () => {
    const p = decodePacket(encodeHash(2, 4321, 0xDEADBEEF));
    expect(p).toEqual({ kind: HASH, gen: 2, step: 4321, hash: 0xDEADBEEF });
  });

  it('carry whatever the lobby has to say', () => {
    const p = decodePacket(encodeSay({ go: { round: 2, track: 3 } }));
    expect(p?.kind).toBe(SAY);
    expect(p?.kind === SAY && JSON.parse(p.text)).toEqual({ go: { round: 2, track: 3 } });
  });
});

describe('a packet that makes no sense', () => {
  it('is dropped rather than guessed at', () => {
    expect(decodePacket(new Uint8Array(0))).toBeUndefined();
    expect(decodePacket(new Uint8Array([99, 1, 2]))).toBeUndefined();       // no such kind
    expect(decodePacket(new Uint8Array([INPUT, 0, 1, 0, 0]))).toBeUndefined(); // truncated header
    expect(decodePacket(new Uint8Array([INPUT, 0, 1, 0, 0, 0, 4, 1, 2]))).toBeUndefined();  // short of its bytes
    expect(decodePacket(new Uint8Array([HASH, 0, 0, 0]))).toBeUndefined();
  });

  it('decodes correctly from a view into a bigger buffer, which is how one arrives', () => {
    const whole = new Uint8Array(32);
    whole.set(encodeInput(0, 7, [5, 6]), 9);
    const p = decodePacket(whole.subarray(9, 9 + 9));
    expect(p?.kind === INPUT && p.from).toBe(7);
    expect(p?.kind === INPUT && [...p.bytes]).toEqual([5, 6]);
  });
});

describe('the outbox', () => {
  it('has nothing to say before anything is pressed', () => {
    expect(new Outbox().packet(0)).toBeUndefined();
  });

  it('repeats the last few steps, so one lost packet costs nothing', () => {
    const o = new Outbox();
    for (let s = 0; s < 20; s++) o.record(s, 0x20 | s);
    const p = decodePacket(o.packet(0)!);
    if (p?.kind !== INPUT) throw new Error('not an input packet');
    expect(p.bytes).toHaveLength(REDUNDANCY);
    expect(p.from).toBe(20 - REDUNDANCY);
    expect([...p.bytes]).toEqual(Array.from({ length: REDUNDANCY }, (_, i) => 0x20 | (20 - REDUNDANCY + i)));
  });

  it('carries what there is when the race has only just begun', () => {
    const o = new Outbox();
    o.record(0, 0x20);
    const p = decodePacket(o.packet(0)!);
    expect(p?.kind === INPUT && p.from).toBe(0);
    expect(p?.kind === INPUT && [...p.bytes]).toEqual([0x20]);
  });

  it('fills a step nobody pressed on, rather than sending a hole', () => {
    const o = new Outbox();
    o.record(0, 0x20);
    o.record(3, 0xA0);
    const p = decodePacket(o.packet(0)!);
    expect(p?.kind === INPUT && [...p.bytes]).toEqual([0x20, 0, 0, 0xA0]);
  });
});

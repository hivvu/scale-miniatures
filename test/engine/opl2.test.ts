/**
 * The OPL2 core: a sine at a known frequency, an envelope that decays, and silence when nothing is keyed on.
 * The chip is hardware, so these check its behaviour rather than compare against the game.
 */
import { describe, it, expect } from 'vitest';
import { OPL2, OPL_RATE } from '../../src/engine/sound/opl2';

/** Fundamental frequency of a buffer, by counting rising zero crossings. */
function fundamental(buf: Float32Array): number {
  let crossings = 0, first = -1, last = -1;
  for (let i = 1; i < buf.length; i++) {
    if (buf[i - 1]! <= 0 && buf[i]! > 0) { crossings++; if (first < 0) first = i; last = i; }
  }
  if (crossings < 2) return 0;
  return (crossings - 1) * OPL_RATE / (last - first);
}

function sine(opl: OPL2, chan: number, fnum: number, block: number): void {
  const op1 = [0x00, 0x01, 0x02, 0x08, 0x09, 0x0A, 0x10, 0x11, 0x12][chan]!;
  const op2 = op1 + 3;
  opl.write(0x01, 0x20);
  opl.write(0x20 + op1, 0x01); opl.write(0x20 + op2, 0x01);   // mult 1, no envelope tricks
  opl.write(0x40 + op1, 0x3F); opl.write(0x40 + op2, 0x00);   // modulator silent, carrier full
  opl.write(0x60 + op1, 0xF0); opl.write(0x60 + op2, 0xF0);   // instant attack, no decay
  opl.write(0x80 + op1, 0x0F); opl.write(0x80 + op2, 0x0F);   // full sustain, fast release
  opl.write(0xC0 + chan, 0x01);                               // additive, no feedback
  opl.write(0xE0 + op1, 0); opl.write(0xE0 + op2, 0);
  opl.write(0xA0 + chan, fnum & 0xFF);
  opl.write(0xB0 + chan, 0x20 | (block << 2) | (fnum >> 8));
}

describe('OPL2', () => {
  it('is silent until a channel is keyed on', () => {
    const opl = new OPL2();
    const buf = new Float32Array(1000);
    opl.render(buf);
    expect(buf.every(v => v === 0)).toBe(true);
  });

  it('plays the note the F-number and block ask for', () => {
    const opl = new OPL2();
    sine(opl, 0, 690, 4);                                     // what the driver's table gives for middle C
    const buf = new Float32Array(OPL_RATE / 4);
    opl.render(buf);
    expect(fundamental(buf)).toBeGreaterThan(510);
    expect(fundamental(buf)).toBeLessThan(535);
  });

  it('an octave up doubles the frequency', () => {
    const low = new OPL2(), high = new OPL2();
    sine(low, 0, 690, 3); sine(high, 0, 690, 4);
    const a = new Float32Array(OPL_RATE / 4), b = new Float32Array(OPL_RATE / 4);
    low.render(a); high.render(b);
    expect(fundamental(b) / fundamental(a)).toBeGreaterThan(1.9);
    expect(fundamental(b) / fundamental(a)).toBeLessThan(2.1);
  });

  it('releases the note when the key goes off', () => {
    const opl = new OPL2();
    sine(opl, 0, 690, 4);
    const buf = new Float32Array(OPL_RATE / 10);
    opl.render(buf);
    const loud = Math.max(...buf.map(Math.abs));
    expect(loud).toBeGreaterThan(0.05);
    opl.write(0xB0, (4 << 2) | (690 >> 8));                   // key off
    opl.render(buf);
    opl.render(buf);
    const quiet = Math.max(...buf.map(Math.abs));
    expect(quiet).toBeLessThan(loud / 10);
  });
});

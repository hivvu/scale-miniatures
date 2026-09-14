/**
 * The viewport's derived numbers against the literals they replaced. Every value here was read out of the
 * disassembly (fn 90c5's tile loop, fn 0630's clip, fn 92bc's copy, fn 4fd1's camera), so this is the test
 * that stops a later refactor quietly moving the default away from what the DOSBox captures show.
 */
import { describe, it, expect } from 'vitest';
import { DOS_VIEWPORT, makeViewport } from '../../src/engine/viewport';

describe('viewport', () => {
  it('reproduces the original geometry exactly', () => {
    expect(DOS_VIEWPORT).toEqual({
      width: 0x100, height: 0xC8, margin: 0x10, stride: 0x110,
      cols: 17, rows: 14,
      bufSize: 0x10000, mask: 0xFFFF,
      origin: 0x1110, clipH: 0xE0, overflowDi: 0xE590,
      halfW: 0x80, halfH: 0x64, camOffsetX: 0, camOffsetY: 0,
      h2hX: 0xE8, h2hY: 0xB0, h2hWrapX: 0xB18, h2hWrapY: 0xB50,
      bannerOffRight: 0x158,
      outWidth: 320, outX: 32,
      logicWidth: 0x100, logicClipH: 0xE0,
    });
    expect(makeViewport(256, 200)).toEqual(DOS_VIEWPORT);
  });

  it('lands on exactly one 64 KB segment at the original size', () => {
    // what the buffer must hold, rounded up to a power of two, has to come out at 0x10000 and not at
    // 0x8000: that is what keeps the original's 16-bit wrap-around, masks and all, intact
    const needed = DOS_VIEWPORT.origin + 201 * DOS_VIEWPORT.stride;
    expect(needed).toBeGreaterThan(0x8000);
    expect(needed).toBeLessThanOrEqual(0x10000);
    expect(DOS_VIEWPORT.bufSize).toBe(0x10000);
  });

  it('derives a wide viewport', () => {
    const vp = makeViewport(384, 224);
    expect(vp.stride).toBe(0x190);
    expect(vp.cols).toBe(25);
    expect(vp.rows).toBe(15);
    expect(vp.origin).toBe(0x1910);
    expect(vp.bufSize).toBe(0x20000);
    expect(vp.mask).toBe(0x1FFFF);
    expect(vp.clipH).toBe(0xF8);
    expect(vp.halfW).toBe(192);
    expect(vp.camOffsetX).toBe(64);
    expect(vp.camOffsetY).toBe(12);
    expect(vp.h2hX).toBe(0x168);
    expect(vp.h2hWrapX).toBe(0xC00 - 0x168);
    expect(vp.outWidth).toBe(448);
  });

  it('holds the invariants every size depends on', () => {
    for (const w of [256, 320, 384, 448, 512]) {
      for (const h of [200, 224, 240]) {
        const vp = makeViewport(w, h);
        expect(vp.cols * 16).toBe(vp.stride);                       // a tile row fills exactly one buffer row
        expect(vp.rows * 16).toBeGreaterThanOrEqual(vp.height + 16);  // enough rows for the fine scroll
        expect(vp.overflowDi + vp.width).toBeLessThanOrEqual(vp.bufSize);
        expect(vp.origin + (vp.height - 1) * vp.stride + vp.width).toBeLessThanOrEqual(vp.bufSize);
        expect(vp.mask + 1).toBe(vp.bufSize);
      }
    }
  });

  it('refuses sizes the renderer could not draw', () => {
    expect(() => makeViewport(260, 200)).toThrow(/multiple of 16/);
    expect(() => makeViewport(250, 200)).toThrow(/multiple of 16/);
    expect(() => makeViewport(0, 200)).toThrow(/multiple of 16/);
    expect(() => makeViewport(320, 201)).toThrow(/multiple of 8/);
    expect(() => makeViewport(320, 100)).toThrow(/multiple of 8/);
    expect(() => makeViewport(4096, 200)).toThrow(/wider than the world/);
  });
});

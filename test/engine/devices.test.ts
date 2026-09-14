/**
 * The input sources fn 2d5b can read besides the keyboard: the two joysticks (fn 2e6c / 2eb3) and the mouse
 * (fn 2e02), plus the two little routines that hang off GAME OPTIONS, fn 3ad0 (AUTO) and fn 2a13 (writing
 * SETTINGS.DAT back). Checked against the disassembly, not a capture: no retail install has a joystick.
 */
import { describe, it, expect } from 'vitest';
import { DataSegment } from '../../src/engine/memory';
import { pollInput, type AnalogueDevices } from '../../src/engine/race';
import { inputHandlers, applySettings, settingsBytes } from '../../src/engine/setup';
import { FrontEnd } from '../../src/engine/frontend';
import { autoSmoothness } from '../../src/engine/menus';

/** A stick and a mouse the test drives directly. */
function devices(over: Partial<ReturnType<AnalogueDevices['joysticks']>> = {},
  m: { buttons: number; x: number; y: number } = { buttons: 0, x: 0xA0, y: 0x64 }): AnalogueDevices & { warps: number } {
  return {
    warps: 0,
    joysticks: () => ({ ax: 0, ay: 0, bx: 0, by: 0, port: 0xFF, ...over }),
    mouse: () => m,
    warpMouse(): void { this.warps++; },
  };
}

/** A data segment with the shipped thresholds and one car on `src`. */
function seg(src: number): DataSegment {
  const d = new DataSegment();
  for (const o of [0x28FD, 0x2901, 0x2905, 0x2909]) d.w16(o, 10);
  for (const o of [0x28FF, 0x2903, 0x2907, 0x290B]) d.w16(o, 200);
  d.w16(0x290D, 3);
  d.w16(0x2658, src); d.w16(0x265A, 6); d.w16(0x265C, 6); d.w16(0x265E, 6);
  inputHandlers(d);
  return d;
}

describe('joystick and mouse input', () => {
  it('fn 2d00 records which sticks are in use', () => {
    expect(seg(1).r8(0x108C)).toBe(1);
    expect(seg(2).r8(0x108C)).toBe(2);
    const both = seg(1); both.w16(0x265A, 2); inputHandlers(both);
    expect(both.r8(0x108C)).toBe(3);
    expect(seg(4).r8(0x108C)).toBe(0);
  });

  it('fn 2e6c steers on the X axis and drives on the two buttons', () => {
    const d = seg(1);
    pollInput(d, undefined, devices({ ax: 105 }));
    expect(d.r8(0x137B)).toBe(0);                            // centred, nothing held
    expect(d.r16(0x108D)).toBe(105);                         // the count fn 2d5b read for itself

    pollInput(d, undefined, devices({ ax: 10 }));
    expect(d.r8(0x137B)).toBe(0x80);                         // on the threshold counts as left
    pollInput(d, undefined, devices({ ax: 200 }));
    expect(d.r8(0x137B)).toBe(0x40);

    pollInput(d, undefined, devices({ ax: 105, port: 0xFF & ~0x20 }));
    expect(d.r8(0x137B)).toBe(0x28);                         // button 2: accelerate, and fire with it
    pollInput(d, undefined, devices({ ax: 105, port: 0xFF & ~0x10 }));
    expect(d.r8(0x137B)).toBe(0x18);                         // button 1: brake
    pollInput(d, undefined, devices({ ax: 10, port: 0xFF & ~0x30 }));
    expect(d.r8(0x137B)).toBe(0xB8);                         // both, while steering left
  });

  it('fn 2e6c ignores the Y axis, as the original does', () => {
    const d = seg(1);
    pollInput(d, undefined, devices({ ax: 105, ay: -300 }));
    expect(d.r16(0x108F)).toBe(0xFED4);                      // read, stored...
    expect(d.r8(0x137B)).toBe(0);                            // ... and thrown away by fn 2e6c
  });

  it('fn 2eb3 reads the other stick through the other pair of buttons', () => {
    const d = seg(2);
    pollInput(d, undefined, devices({ bx: 10, port: 0xFF & ~0x80 }));
    expect(d.r16(0x1091)).toBe(10);
    expect(d.r8(0x137B)).toBe(0xA8);                         // left, accelerate, fire
  });

  it('fn 2e02 steers by how far the pointer left the middle, and recentres it', () => {
    const d = seg(3);
    const still = devices({}, { buttons: 0, x: 0xA0, y: 0x64 });
    pollInput(d, undefined, still);
    expect(d.r8(0x137B)).toBe(0);
    expect(still.warps).toBe(0);

    const moved = devices({}, { buttons: 1, x: 0xA0 - 3, y: 0x64 + 8 });
    pollInput(d, undefined, moved);
    expect(d.r8(0x137B)).toBe(0xB8);                         // the deadzone edge counts, so left and down,
    expect(moved.warps).toBe(1);                             // and the left button accelerates and fires

    const right = devices({}, { buttons: 2, x: 0xA0 + 4, y: 0x64 });
    pollInput(d, undefined, right);
    expect(d.r8(0x137B)).toBe(0x50);                         // right button = brake, and steering right
  });

  it('a source with no device behind it reads like an unplugged stick', () => {
    const d = seg(1);
    pollInput(d);                                            // the port answers at once, so both counts are 0
    expect(d.r16(0x108D)).toBe(0);
    expect(d.r8(0x1095)).toBe(0);                            // no button down
    expect(d.r8(0x137B)).toBe(0x80);                         // and a count below the threshold is hard left
  });
});

describe('the rest of GAME OPTIONS', () => {
  it('fn 3ad0 turns the burst count into a frame rate', () => {
    const fe = new FrontEnd(new DataSegment(), new Uint8Array(1));
    for (const [bursts, smoothness] of [[0x30, 1], [0x18, 1], [0x17, 2], [0x14, 2], [0x13, 3], [0x0D, 3], [0x0C, 4], [0, 4]]) {
      fe.speed = (): number => bursts!;
      autoSmoothness(fe);
      expect(fe.ds.r16(0x263A)).toBe(smoothness);
    }
    delete fe.speed;                                         // no clock: the fastest class
    autoSmoothness(fe);
    expect(fe.ds.r16(0x263A)).toBe(1);
  });

  it('fn 2a13 writes back what fn 2770 read in', () => {
    const d = new DataSegment();
    const file = new Uint8Array([4, 0, 5, 0, 2, 0, 1, 0, 10, 0, 0xC8, 0, 10, 0, 0xC8, 0,
      0x1E, 0x20, 0x11, 0x1F, 0x38, 0x3B, 0x3C, 0x3D, 0x4B, 0x4D, 0x48, 0x50, 0x52, 0x20, 0x39, 0x2F]);
    applySettings(d, file);
    d.w16(0x2658, d.r16(0x0F5F)); d.w16(0x265A, d.r16(0x0F61));   // fn 29f5, which runs just before
    expect(settingsBytes(d)).toEqual(file);
  });
});

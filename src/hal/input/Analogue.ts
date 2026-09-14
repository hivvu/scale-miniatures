/**
 * The browser's stand-ins for the two devices the game reads through the hardware itself: the game port at
 * 201h (fn 2f9e/2fcc/2ffe) and the mouse driver (int 33h). See re/notes/20-input.md.
 *
 * **Joysticks** are gamepads, one per stick: pad 0 is stick A, pad 1 is stick B. The port counts a real
 * stick to the thresholds the calibration screen worked out, so an axis of -1..+1 is mapped onto the same
 * scale: the centre sits halfway between the two thresholds and full deflection reaches twice as far, which
 * makes a direction register from half deflection on and makes F7 calibration a no-op (it would measure the
 * numbers it already has). The pad's first button is wired to the stick's *second* one, because that is the
 * one fn 2e6c accelerates with.
 *
 * **The mouse** needs pointer lock: the game recentres the pointer after every frame that moved, which only
 * relative movement can imitate. Without the lock it reports a pointer sitting still in the middle.
 */
import type { AnalogueDevices } from '../../engine/race';
import type { DataSegment } from '../../engine/memory';

export class BrowserDevices implements AnalogueDevices {
  /** Pointer movement since the last recentre, in 320x200 pixels, and the buttons held. */
  private mx = 0;
  private my = 0;
  private buttons = 0;

  constructor(private readonly d: DataSegment, target: EventTarget = window) {
    target.addEventListener('mousemove', e => {
      const m = e as MouseEvent;
      if (document.pointerLockElement === null) return;
      this.mx += m.movementX;
      this.my += m.movementY;
      this.buttons = m.buttons;
    });
    target.addEventListener('mousedown', e => { this.buttons = (e as MouseEvent).buttons; });
    target.addEventListener('mouseup', e => { this.buttons = (e as MouseEvent).buttons; });
  }

  /** fn 3a12: how many sticks answered, which is what GAME OPTIONS offers on F1 and F2. */
  static joystickCount(): number {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return 0;
    return navigator.getGamepads().filter(p => p !== null).length;
  }

  private static pad(n: number): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    return navigator.getGamepads()[n] ?? null;
  }

  /** An axis of -1..+1 as the count fn 2e6c compares against [28fd] and [28ff]. */
  private count(axis: number, min: number, max: number): number {
    const centre = (min + max) >> 1;
    return Math.round(centre + axis * (axis < 0 ? 2 * (centre - min) : 2 * (max - centre)));
  }

  joysticks(): { ax: number; ay: number; bx: number; by: number; port: number } {
    const d = this.d;
    const a = BrowserDevices.pad(0), b = BrowserDevices.pad(1);
    let port = 0xFF;                                              // the buttons are active low
    if (a?.buttons[0]?.pressed) port &= ~0x20;                    // stick A button 2: accelerate
    if (a?.buttons[1]?.pressed) port &= ~0x10;                    // stick A button 1: brake
    if (b?.buttons[0]?.pressed) port &= ~0x80;
    if (b?.buttons[1]?.pressed) port &= ~0x40;
    return {
      ax: this.count(a?.axes[0] ?? 0, d.r16(0x28FD), d.r16(0x28FF)),
      ay: this.count(a?.axes[1] ?? 0, d.r16(0x2901), d.r16(0x2903)),
      bx: this.count(b?.axes[0] ?? 0, d.r16(0x2905), d.r16(0x2907)),
      by: this.count(b?.axes[1] ?? 0, d.r16(0x2909), d.r16(0x290B)),
      port,
    };
  }

  mouse(): { buttons: number; x: number; y: number } {
    return { buttons: this.buttons & 3, x: 0xA0 + this.mx, y: 0x64 + this.my };
  }

  warpMouse(): void { this.mx = 0; this.my = 0; }
}

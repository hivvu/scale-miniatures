/**
 * The game's int 9 handler (fn 2efd): scancodes in, the three pieces of state the rest of the game reads
 * out. Nothing here talks to the browser; the page turns DOM events into scancodes (src/hal/input/scancodes).
 *
 * - [107c] 16-bit state of the sixteen keys in the SETTINGS.DAT table at [106c], bit 15 = the first entry
 *   (player 1 left) down to bit 0 (player 2 key 8). The high byte [107d] is player 1's input byte and the
 *   low byte [107c] player 2's, which is what fn 2d5b reads.
 * - [107f] the key being held (the first one down), [107e] the last key released, [1096] set by Esc.
 *   The menus wait on [107e], so a choice is only taken once the key comes back up.
 */
import { DataSegment } from './memory';

export const ESC = 0x01, RETURN = 0x1C;

export class Keyboard {
  constructor(readonly ds: DataSegment) {}

  /** Key down: `scancode` is the XT make code (extended keys use their base code, as the handler does). */
  make(scancode: number): void { this.event(scancode & 0x7F, true); }
  /** Key up. */
  release(scancode: number): void { this.event(scancode & 0x7F, false); }

  /** Everything up: the page uses this when it loses focus, where DOS would have seen the break codes. */
  clear(): void {
    const d = this.ds;
    d.w16(0x107C, 0); d.w8(0x107E, 0); d.w8(0x107F, 0);
  }

  private event(ah: number, make: boolean): void {
    const d = this.ds;
    if (!make) {                                      // 2f43: a completed keypress
      if (d.r8(0x107E) === 0 || d.r8(0x107F) === ah) {
        d.w8(0x107F, 0);
        d.w8(0x107E, ah);
        if (ah === ESC) d.w8(0x1096, 1);
      }
    } else if (d.r8(0x107F) === 0) {                  // 2f65: remember the key being held
      d.w8(0x107F, ah);
    }
    for (let i = 0, cx = 0x8000; i < 16; i++, cx >>= 1) {   // 2f70: the configured keys
      if (d.r8(0x106C + i) !== ah) continue;
      if (make) d.w16(0x107C, d.r16(0x107C) | cx);
      else d.w16(0x107C, d.r16(0x107C) & ~cx);
      return;
    }
  }
}

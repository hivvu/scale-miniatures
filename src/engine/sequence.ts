/**
 * The Challenge sequence: transliteration of MICRO_U.EXE fn 10a0 (the championship loop), fn 1a82 (the bonus
 * race) and the head and tail of fn 115c (pick the round and track, show the card, run the race, work out the
 * finishing order).
 *
 * The race loop itself stays in `Race`; this class only decides which screen comes next, so the browser can
 * drive it: `begin()`, then `screenDone()` whenever a screen's wait ends, and `raceFinished()` when the race
 * loop exits.
 */
import { DataSegment } from './memory';
import { FrontEnd } from './frontend';
import { drawPreRace, animatePreRace, drawResultsBoard, animateResults } from './screens';

export type Screen =
  | { kind: 'board' }
  | { kind: 'preRace'; round: number; track: number }
  | { kind: 'race'; round: number; track: number }
  | { kind: 'verdict'; message: number }
  | { kind: 'results' }
  | { kind: 'chooseOpponents' }
  | { kind: 'elimination'; car: number }
  | { kind: 'champion'; car: number }
  | { kind: 'end' };

const CAR1 = 0x0C03;                 // player 1's object record, used as "did player 1 finish here?"
const LAST_CAR = 0x0C54;

export class Championship {
  screen: Screen = { kind: 'end' };
  /** True while the round 9 time trial slotted in by fn 1a82 is being played. */
  private bonus = false;

  constructor(readonly ds: DataSegment, readonly fe: FrontEnd) {}

  get raceIndex(): number { return this.ds.r8(0x28C1); }
  get lastRace(): number { return this.ds.r8(0x0439); }
  get twoPlayers(): boolean { return this.ds.r8(0x03F8) !== 0; }

  /** fn 10a0 prologue: start a championship at race 0, the qualifier. */
  begin(): void {
    const d = this.ds;
    d.w8(0x1096, 0);
    d.w8(0x03FA, 3);
    d.w8(0x0343, 0);
    d.w8(0x28C1, 0);
    d.w8(0x0310, 0);
    d.w16(0x266C, 6);
    d.w16(0x266E, 6);
    this.prepareRace();
  }

  /** fn 115c head: round and track for this race, then the card that announces it. */
  private prepareRace(): void {
    const d = this.ds;
    let round: number, track: number;
    if (d.r8(0x0343) !== 0) {                          // bonus race (fn 1a82 sets [0343])
      round = 9;
      track = d.r8(0x0342);
    } else {
      const b = d.r8(0x043C + this.raceIndex);
      round = b >> 2;
      track = b & 3;
    }
    d.w8(0x28BF, round);
    d.w8(0x28C0, (track + 1) & 0xFF);
    // fn 1186: one player sees the championship board first, on every race but the last
    if (!this.twoPlayers && this.raceIndex !== this.lastRace) { this.screen = { kind: 'board' }; return; }
    this.showCard();
  }

  /** fn 11f8: the card that announces the race. */
  private showCard(): void {
    const d = this.ds;
    drawPreRace(this.fe);                              // the round 9 card also resets [03FA] to 3
    if (d.r8(0x28BF) !== 9 && this.raceIndex !== 0) animatePreRace(this.fe);
    this.screen = { kind: 'preRace', round: d.r8(0x28BF), track: d.r8(0x28C0) };
  }

  /**
   * fn 11f8 tail (1398): with the cheat code typed on GAME OPTIONS, keypad + and - step through the
   * championship's races straight from the pre-race card. True when the card has been redrawn.
   */
  cardSkip(scancode: number): boolean {
    const d = this.ds;
    if (d.r8(0x0F6A) === 0) return false;
    let n = d.r8(0x28C1);
    if (scancode === 0x4E) {                           // keypad +
      if (n === 0x19) return false;
      n++;
    } else if (scancode === 0x4A) {                    // keypad -
      n = n === 0 ? d.r8(0x0439) : n - 1;
    } else return false;
    d.w8(0x28C1, n);
    const b = d.r8(0x043C + n);
    d.w8(0x28BF, b >> 2);
    d.w8(0x28C0, (b & 3) + 1);
    this.showCard();
    return true;
  }

  /** fn 11d5: the finishing order as car object records, in [03FC..0402]. */
  finishingOrder(): void {
    const d = this.ds;
    const stride = d.r16(0x2662);
    for (let i = 0; i < 4; i++) {
      const off = d.r16(0x2678 + i * 2);
      d.w16(0x03FC + i * 2, ((Math.floor(off / stride) * 0x1B) + CAR1) & 0xFFFF);
    }
  }

  /** Call when the race loop has exited: works out the screen that follows. */
  raceFinished(): void {
    const d = this.ds;
    if (d.r8(0x0F69) === 1) d.w8(0x0406, 10);          // the cheat gives ten lives
    this.finishingOrder();
    if (this.bonus) {                                  // fn 1a82 tail: beat the clock or no bonus
      this.bonus = false;
      let message = 4;
      if (d.r8(0x291D) === 1) {
        message = 3;
        if (d.r8(0x0342) !== d.r8(0x043B)) d.w8(0x0342, d.r8(0x0342) + 1);
      }
      this.screen = { kind: 'verdict', message };     // fn 1c1b is driven by the page, screen by screen
      return;
    }
    if (this.raceIndex === 0) {                        // fn 10a0: the first race only qualifies
      const first = d.r16(0x03FC), second = d.r16(0x03FE);
      const qualified = first === CAR1 || (!this.twoPlayers && second === CAR1);
      const message = qualified ? 1 : 0;
      this.screen = { kind: 'verdict', message };
      return;
    }
    drawResultsBoard(this.fe);
    animateResults(this.fe);
    this.screen = { kind: 'results' };
  }

  /** Call when the current screen's wait has ended (a key, or its timeout). */
  screenDone(): void {
    const d = this.ds;
    switch (this.screen.kind) {
      case 'board':
        this.showCard();
        return;
      case 'preRace':
        this.screen = { kind: 'race', round: d.r8(0x28BF), track: d.r8(0x28C0) };
        return;
      case 'verdict':
        if (this.screen.message === 0) { this.screen = { kind: 'end' }; return; }
        if (this.screen.message === 1) {               // qualified: one player picks the opponents (fn 1a4a)
          if (!this.twoPlayers) { this.screen = { kind: 'chooseOpponents' }; return; }
          this.nextRace();
          return;
        }
        if (this.screen.message === 2) {               // fn 13e4 tail: a life gone, and maybe the last one
          if (d.r8(0x0406) === 0) { this.screen = { kind: 'end' }; return; }
          this.afterResults();
          return;
        }
        this.nextRace();                               // after a bonus race, carry on
        return;
      case 'chooseOpponents':
        this.nextRace();
        return;
      case 'elimination':
        this.afterResults();
        return;
      case 'results': {
        const first = d.r16(0x03FC), second = d.r16(0x03FE);
        if (this.twoPlayers) {
          if (first === CAR1) this.nextRace(); else this.prepareRace();
          return;
        }
        // fn 1650: winning, or coming second in any race but the last, keeps the life
        if (first !== CAR1 && (this.raceIndex === 0x19 || second !== CAR1)) {
          this.screen = { kind: 'verdict', message: 2 };
          return;
        }
        const out = this.eliminationTarget();
        if (out !== undefined) { this.screen = { kind: 'elimination', car: out }; return; }
        this.afterResults();
        return;
      }
      default:
        this.screen = { kind: 'end' };
    }
  }

  /** fn 10a0 (1112..1153): what the results lead to once the screens after them are done. */
  private afterResults(): void {
    const d = this.ds;
    const first = d.r16(0x03FC);
    if (first === CAR1) {                              // a win: every third one earns a bonus race
      d.w8(0x03FA, (d.r8(0x03FA) - 1) & 0xFF);
      if (d.r8(0x03FA) === 0 && this.raceIndex !== this.lastRace) { this.startBonusRace(); return; }
      this.nextRace();
      return;
    }
    if (this.raceIndex === 0x19 || d.r16(0x03FE) !== CAR1) { d.w8(0x03FA, 3); this.prepareRace(); return; }
    this.nextRace();
  }

  /**
   * fn 1676: every third race the player wins, one of the other drivers is knocked out. On race 3 it is
   * the one with the lowest character number, after that they go round in turn; nobody leaves unless there
   * is still a driver free to replace them.
   */
  private eliminationTarget(): number | undefined {
    const d = this.ds;
    if (d.r8(0x0310) % 3 !== 0) return undefined;
    if (this.raceIndex === 3) {
      let best = 0x0C1E, lowest = 0x63;
      for (let bx = 0x0C1E; bx <= LAST_CAR; bx += 0x1B) {
        const character = d.r16(bx + 0x13) & 0x0F;
        if (lowest >= character) { best = bx; lowest = character; }
      }
      d.w16(0x0346, best);
    } else {
      let next = d.r16(0x0346) + 0x1B;
      if (next > LAST_CAR) next = 0x0C1E;
      d.w16(0x0346, next);
    }
    let free = 0;
    for (let i = 0; i < 0x0B; i++) if ((d.r8(0x0164 + i) & 0x60) === 0) free++;
    return free === 0 ? undefined : d.r16(0x0346);
  }

  /** fn 1a82: slot a round 9 time trial in before moving on. */
  private startBonusRace(): void {
    const d = this.ds;
    this.bonus = true;
    d.w8(0x0343, 1);
    this.prepareRace();
    d.w8(0x0343, 0);
  }

  /** fn 10a0: move on, or crown the champion after the last race. */
  private nextRace(): void {
    const d = this.ds;
    d.w8(0x28C1, (d.r8(0x28C1) + 1) & 0xFF);
    d.w8(0x0310, (d.r8(0x0310) + 1) & 0xFF);
    if (this.raceIndex > this.lastRace) { this.screen = { kind: 'champion', car: CAR1 }; return; }
    this.prepareRace();
  }

  /** fn 1a4a: the cars that still have no driver, in order; the caller shows the character select for each. */
  opponentsToPick(): number[] {
    const d = this.ds;
    const out: number[] = [];
    for (let bx = CAR1; bx <= LAST_CAR; bx += 0x1B) if ((d.r16(bx + 0x13) & 0xFFFF) === 0x0B) out.push(bx);
    return out;
  }
}

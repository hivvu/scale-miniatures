/**
 * Front-end screens: transliteration of the drawing half of the menu routines in MICRO_U.EXE.
 * Each function draws one screen into the FrontEnd buffer; the input loops that surround them in the
 * original stay outside so the same code can be driven by the browser event loop or by a test.
 */
import { FrontEnd, FONT1, FONT2 } from './frontend';
import { s16 } from './memory';

/** Object records used by the menus (data segment offsets, 0x1B bytes apart from 0x0B7C). */
export const REC = {
  badge: 0x0B7C,      // BADGE.CHR, top-left corner
  logo: 0x0B97,       // LOGO.CHR
  intro: 0x0BB2,      // INTRO.CHR, the rotating vehicle on the title screen
  nos: 0x0BCD,        // NOS.CHR
  face0: 0x0BE8,      // FCNORMAL.CHR (player 1 face on the title/options header)
  faceHappy: 0x0C03,  // FCHAPPY.CHR
  car1: 0x0C1E, car2: 0x0C39, car3: 0x0C54,
  thumb: 0x0C6F,      // THUMB.CHR
  selgam: 0x0C8A,     // SELGAM.CHR
  words: 0x0CA5,      // WORDS.CHR
  cup: 0x0CC0,        // CUP.CHR
  mini0: 0x0CDB, mini1: 0x0CF6, mini2: 0x0D11, mini3: 0x0D2C,   // MINATURE.CHR, one per car
  frame: 0x0D47,      // FRAME.CHR
} as const;

/** Strings in the data segment (NUL-terminated, some in NUL-separated lists). */
export const STR = {
  vehicles: 0x002F,          // list of 12 vehicle names (title screen)
  options: 0x0E17,           // list: F1..F7, escape/return/space hints
  controlValues: 0x0F02,     // list: JOY 1, JOY 2, MOUSE, KEYS 1, KEYS 2
  smoothness: 0x0F22,        // list with a leading empty entry: '', HIGH, GOOD, MEDIUM, LOW, AUTO
  soundValues: 0x0F3D,       // list: NONE, BLASTER, SPEAKER
  cheatMark: 0x0F00,
  gameOptions: 0x0F52,
  copyright: 0x0010,
  // head to head
  chooseGame: 0x0922,        // CHOOSE GAME!
  tournament: 0x092F,        // list: TOURNAMENT, SINGLE RACE
  player: 0x094D, one: 0x0954, two: 0x0958,
  results: 0x095C,           // RESULTS!!
  verdicts: 0x0966,          // list: WINNER!, LOSER!
  raceNumber: 0x0975,        // TOURNAMENT RACE nn (digits at 0985)
  lost: 0x098D, won: 0x0997, // LOST nn (digits at 0991) / WON nn (digits at 099a)
  scores: 0x08A6,            // list: 0..4
  skills: 0x08CD,            // list: GRANNY..EXPERT, indexed through the table at 08b0
  selectVehicle: 0x0913,
  handicap: [0x01A0, 0x01B2, 0x01C4] as const,   // HANDICAP WALTER/MIKE/ANNE ?
  yesNo: 0x01D9,             // list: NO, YES
  whoToBe: 0x020F, whoToRace: 0x0227,
} as const;

/** Image headers addressed directly by fn 0db0 when it swaps a face's expression. */
const FACE_HEADERS = { happy: 0x0A14, sad: 0x0A28, frown: 0x0A3C, normal: 0x0A50 } as const;

/** Per-character 8-byte label lists: names (0x258) and skill words (0x2B1). */
export const LABELS = { names: 0x0258, skills: 0x02B1 } as const;

/** fn 0400: the header every menu screen starts from (badge, mode word, separator rules). */
export function drawHeader(fe: FrontEnd): void {
  const d = fe.ds;
  fe.clearScreen(0);
  fe.blit(REC.badge);
  d.w16(REC.words + 0x02, 0x48);
  d.w16(REC.words + 0x04, 0x08);
  d.w16(REC.words + 0x13, 0);
  fe.blit(REC.words);
  const mode = d.r8(0x0156);
  if (mode === 0) return;
  d.w16(REC.words + 0x02, d.r16(REC.words + 0x02) + 0x5A);
  d.w16(REC.words + 0x13, mode);
  fe.blit(REC.words);
  fe.fillRowsAt(0x1E, 1, 0x12);
  fe.fillRowsAt(0x1F, 2, 0x0E);
  fe.fillRowsAt(0x21, 1, 0x12);
}

/** fn 2770 (drawing part, 27f0): the GAME OPTIONS screen. */
export function drawOptions(fe: FrontEnd): void {
  const d = fe.ds;
  d.w8(0x0156, 0);
  drawHeader(fe);
  fe.textCentred(STR.gameOptions, 0x23, FONT2);
  let y = 0x34;
  let cx = 0;
  for (; cx < 6; cx++, y += 0x10) fe.textFromList(STR.options, cx, 0, y, FONT2);
  if (d.r16(0x2625) !== 0) fe.textFromList(STR.options, cx, 0, y, FONT2);
  cx++;
  y = 0xB0;
  fe.textFromList(STR.options, cx, 0xFFFF, y, FONT1);
  y += 8; cx++;
  fe.textFromList(STR.options, cx, 0xFFFF, y, FONT1);
  y += 8; cx++;
  fe.textFromList(STR.options, cx, 0xFFFF, y, FONT1);

  drawOptionValues(fe);
}

/** fn 2770 at 284d: only the four chosen values, which is all that changes while the screen is up. */
export function drawOptionValues(fe: FrontEnd): void {
  const d = fe.ds;
  fe.fillRect(0xC8, 0x34, 0x40, 0x3C, 0);
  let y = 0x34;
  fe.textFromList(STR.controlValues, d.r16(0x0F5F) - 1, 0xC8, y, FONT2);
  y += 0x10;
  fe.textFromList(STR.controlValues, d.r16(0x0F61) - 1, 0xC8, y, FONT2);
  y += 0x10;
  fe.textFromList(STR.soundValues, d.r16(0x0F64), 0xC8, y, FONT2);
  y += 0x10;
  fe.textFromList(STR.smoothness, d.r16(0x263A), 0xC8, y, FONT2);
  y += 0x10;
  if (d.r8(0x0F69) === 1) fe.textAt(STR.cheatMark, 0, y, FONT2);   // the cheat code puts a ! here
  fe.present();
}

/** fn 2a82 (F6): ten lines of credits from [0f75], up until any key. */
export function drawOptionsInfo(fe: FrontEnd): void {
  const d = fe.ds;
  d.w8(0x0156, 0);
  drawHeader(fe);
  let y = 0x2D;
  for (let cx = 0; cx < 0x0A; cx++, y += 0x10) fe.textFromList(0x0F75, cx, 0, y, FONT2);
  fe.present();
}

// ---------------------------------------------------------------- title and menus

/** fn 01de: the rotating vehicle picture and its name on the title screen. */
export function drawTitleVehicle(fe: FrontEnd): void {
  const d = fe.ds;
  d.w16(REC.intro + 0x02, 0x50);
  fe.blit(REC.intro);
  const y = d.r16(REC.intro + 0x04) + 0x40;
  fe.fillRowsAt(y, 8, 0);
  fe.textFromList(STR.vehicles, d.r16(REC.intro + 0x13), 0xFFFF, y, FONT1);
}

/** fn 0100 (drawing part): logo, copyright and the vehicle that cycles every 0x118 ticks. */
export function drawTitle(fe: FrontEnd): void {
  const d = fe.ds;
  d.w8(0x137B, 0); d.w8(0x14DF, 0); d.w8(0x1643, 0); d.w8(0x17A7, 0);
  d.w16(0x1080, 0); d.w8(0x107E, 0); d.w8(0x107F, 0); d.w8(0x1082, 0);
  fe.clearScreen(0);
  fe.blitSprite(REC.logo);
  fe.textCentred(STR.copyright, 0xB7, FONT2);
  d.w16(REC.intro + 0x13, 0xFFFF);
  d.w16(REC.intro + 0x04, 0x64);
  titleNextVehicle(fe);
}

/** One turn of the title loop: advance the vehicle frame (0..8) and redraw it. */
export function titleNextVehicle(fe: FrontEnd): void {
  const d = fe.ds;
  let cx = (d.r16(REC.intro + 0x13) + 1) & 0xFFFF;
  if (cx >= 9) cx = 0;
  d.w16(REC.intro + 0x13, cx);
  drawTitleVehicle(fe);
  fe.present();
}

/** fn 0220 (drawing part): SELECT GAME, one player against two. */
export function drawSelectGame(fe: FrontEnd): void {
  const d = fe.ds;
  d.w8(0x0156, 0);
  d.w8(0x1096, 0);
  fe.clearScreen(0);
  fe.blitSprite(REC.logo);
  fe.textCentred(0x0134, 0x5E, FONT2);
  fe.textAt(0x0140, 0x18, 0x6F, FONT1);
  fe.textAt(0x014B, 0x9C, 0x6F, FONT1);
  d.w16(REC.selgam + 0x04, 0x76);
  d.w16(REC.selgam + 0x02, 0x10); d.w16(REC.selgam + 0x13, 0); fe.blit(REC.selgam);
  d.w16(REC.selgam + 0x02, 0x94); d.w16(REC.selgam + 0x13, 1); fe.blit(REC.selgam);
  d.w16(REC.words + 0x04, 0xB7);
  d.w16(REC.words + 0x02, 0x18); d.w16(REC.words + 0x13, 2); fe.blit(REC.words);
  d.w16(REC.words + 0x02, 0x9C); d.w16(REC.words + 0x13, 1); fe.blit(REC.words);
  fe.present();
}

/** fn 02e0 (drawing part): the one-player menu, Head to Head against Challenge. */
export function drawOnePlayerMenu(fe: FrontEnd): void {
  const d = fe.ds;
  drawHeader(fe);
  fe.textAt(0x0140, 0x58, 0x32, FONT2);
  fe.textAt(0x013B, 0x70, 0x44, FONT2);
  fe.textAt(0x0134, 0x58, 0xB6, FONT2);
  d.w16(REC.selgam + 0x04, 0x58);
  d.w16(REC.selgam + 0x02, 0x10); d.w16(REC.selgam + 0x13, 2); fe.blit(REC.selgam);
  d.w16(REC.selgam + 0x02, 0x94); d.w16(REC.selgam + 0x13, 3); fe.blit(REC.selgam);
  d.w16(REC.words + 0x04, 0x99);
  d.w16(REC.words + 0x02, 0x18); d.w16(REC.words + 0x13, 1); fe.blit(REC.words);
  d.w16(REC.words + 0x02, 0xA4); d.w16(REC.words + 0x13, 2); fe.blit(REC.words);
  fe.present();
}

/** fn 0382 (one pass): the pointing hand that marks the highlighted choice, then the whole screen. */
export function drawMenuCursor(fe: FrontEnd, selection: number, y: number): void {
  const d = fe.ds;
  d.w16(REC.thumb + 0x04, y);
  d.w16(REC.thumb + 0x13, selection);
  fe.blitSprite(REC.thumb);
  fe.present();
}

/** fn 0382 tail: take the hand off again (the buffer keeps the screen underneath). */
export function eraseMenuCursor(fe: FrontEnd): void { fe.restoreBackground(REC.thumb); }

// ---------------------------------------------------------------- character select (fn 09e0)

/** fn 0eba: reset the character carousel and the four cars' choices. */
export function resetCharacters(fe: FrontEnd): void {
  const d = fe.ds;
  d.w16(0x0160, 6);
  d.w16(0x0192, 0);
  for (const o of [0x0406, 0x0407, 0x0408, 0x0409]) d.w8(o, 3);
  for (const o of [0x2668, 0x266A, 0x266C, 0x266E]) d.w16(o, 0xB);
  for (const o of [0x0C16, 0x0C31, 0x0C4C, 0x0C67]) d.w16(o, 0xB);
  for (let i = 0; i < 0xB; i++) d.w8(0x0164 + i, i);
}

/** fn 0db0: draw a face, choosing the expression image from the high byte of the frame word. */
export function drawFace(fe: FrontEnd, bx: number): void {
  const d = fe.ds;
  const saved = d.r16(bx + 0x13);
  let cl = saved & 0xFF, ch = (saved >> 8) & 0xFF;
  let si: number;
  if (ch === 0) {
    si = FACE_HEADERS.normal;
    if (cl & 0x20) cl = 0x0C;
    else if (cl & 0x40) cl = 0x0D;
  } else {
    si = FACE_HEADERS.frown;
    ch = (ch - 1) & 0xFF;
    if (ch !== 0) {
      cl = (cl << 1) & 0xFF;
      if (cl & 0x20) cl |= 1;
      cl &= 0x1F;
      si = FACE_HEADERS.happy;
      ch = (ch - 1) & 0xFF;
      if (ch !== 0) { si = FACE_HEADERS.sad; ch = 0; }
    }
  }
  d.w16(bx + 0x13, cl | (ch << 8));
  d.w16(bx, si);
  d.w16(bx + 0x08, d.r16(si + 0x12));
  fe.blit(bx);
  d.w16(bx + 0x13, saved);
}

/** fn 0f17: the 8-byte label for a face's character, drawn at the face's own x. */
export function drawCharacterLabel(fe: FrontEnd, bx: number, list: number, y: number): void {
  const d = fe.ds;
  if (d.r16(bx + 0x15) === 0xFFFF) return;
  const si = list + ((d.r16(bx + 0x13) & 0xF) << 3);
  fe.textAt(si, d.r16(bx + 0x02), y, FONT1);
}

/** fn 0e02: the double frame around the middle slot of the carousel. */
export function drawSelectionFrame(fe: FrontEnd): void {
  const d = fe.ds;
  fe.fillRowsAt(0x76, 1, 0x12);
  fe.fillRowsAt(0xB7, 1, 0x12);
  const bx = REC.frame;
  const set = (x: number, y: number, frame: number, mirror: number): void => {
    d.w16(bx + 0x02, x); d.w16(bx + 0x04, y); d.w16(bx + 0x13, frame); d.w8(bx + 0x0A, mirror); fe.blit(bx);
  };
  set(0x9C, 0xB6, 2, 1);
  d.w8(bx + 0x0A, 0); d.w16(bx + 0x02, 0x5C); fe.blit(bx);
  set(0x5C, 0x6E, 1, 0);
  d.w16(bx + 0x02, 0x9C); d.w8(bx + 0x0A, 1); fe.blit(bx);
  d.w16(bx + 0x13, 3); d.w16(bx + 0x02, 0x5C);
  for (let i = 0; i < 7; i++) {
    d.w16(bx + 0x02, d.r16(bx + 0x02) + 8);
    d.w8(bx + 0x0A, 1); d.w16(bx + 0x04, 0x6E); fe.blit(bx);
    d.w16(bx + 0x04, 0xB6); d.w8(bx + 0x0A, 0); fe.blit(bx);
  }
  d.w16(bx + 0x13, 0); d.w16(bx + 0x04, 0x76);
  for (let i = 0; i < 8; i++) {
    d.w16(bx + 0x02, 0x5C); d.w8(bx + 0x0A, 0); fe.blit(bx);
    d.w8(bx + 0x0A, 1); d.w16(bx + 0x02, 0x9C); fe.blit(bx);
    d.w16(bx + 0x04, d.r16(bx + 0x04) + 8);
  }
}

/** fn 0d1f: the whole character carousel at its current scroll position [0192]. */
export function drawCharacterStrip(fe: FrontEnd): void {
  const d = fe.ds;
  fe.fillRowsAt(0x77, 0x0A, 0x0E);
  fe.fillRowsAt(0x7E, 0x01, 0x12);
  fe.fillRowsAt(0x7F, 0x30, 0x00);
  fe.fillRowsAt(0xAF, 0x01, 0x12);
  fe.fillRowsAt(0xB0, 0x08, 0x0E);
  let dx = d.r16(0x0192);
  const bx = REC.face0;
  for (let i = 0; i < 0xB; i++) {
    const al = d.r8(0x0164 + i);
    if (dx === 0x140) d.w16(0x0160, al);
    const x = (dx - 0xD8) & 0xFFFF;
    d.w16(bx + 0x13, al);
    d.w16(bx + 0x02, x);
    drawFace(fe, bx);
    drawCharacterLabel(fe, bx, LABELS.names, 0xB0);
    drawCharacterLabel(fe, bx, LABELS.skills, 0x77);
    dx = (dx + 0x40) & 0xFFFF;
    if (dx >= 0x2C0) dx -= 0x2C0;
  }
  drawSelectionFrame(fe);
}

/** fn 0f3c: the chosen character's name under a car's face, or a black gap when nothing is chosen. */
export function drawChosenName(fe: FrontEnd, bx: number): void {
  const d = fe.ds;
  const cx = d.r16(bx + 0x13) & 0xF;
  const x = d.r16(bx + 0x02);
  const y = d.r16(bx + 0x04) + 0x31;
  if (cx >= 0xB) fe.fillRect(x, y, 8, 0x30, 0);
  else fe.textAt(LABELS.names + (cx << 3), x, y, FONT1);
}

/** fn 0c96: the prompt line above the carousel, blinking with the 32-tick flag [26cf]. */
export function drawPrompt(fe: FrontEnd): void {
  const d = fe.ds;
  const font = d.r16(0x0194);
  const rows = font === FONT1 ? 8 : 0x10;
  const si = d.r16(0x019A);
  if (si === 0) return;
  const y = d.r16(0x0196);
  fe.fillRowsAt(y, rows, 0);
  if (d.r8(0x26CF) & 1) fe.textCentred(si, y, font);
  fe.presentRows(y, rows);
}

/** fn 0c5d: the blinking vehicle name on the PRESS ANY KEY screen. */
export function drawVehicleName(fe: FrontEnd): void {
  const d = fe.ds;
  fe.fillRowsAt(0xBF, 8, 0);
  const list = d.r8(0x26CF) & 1 ? 0x00AB : STR.vehicles;
  fe.textFromList(list, d.r8(0x09D8) - 1, 0xFFFF, 0xBF, FONT1);
  fe.presentRows(0xBF, 8);
}

/** fn 102b + fn 09e0 (drawing part): the whole character-select screen for the car at [019e]. */
export function drawCharacterSelect(fe: FrontEnd): void {
  const d = fe.ds;
  const bx = d.r16(0x019E);
  drawHeader(fe);
  drawFace(fe, bx);
  fe.outline(bx, 0x0D);
  const ax = d.r16(bx + 0x13);
  if (ax <= 0x0A) {
    d.w8(0x0164 + ax, ax);
    d.w16(bx + 0x13, 0x0B);
    fe.blit(bx);
  }
  if (ax !== 0x0B) drawChosenName(fe, bx);
  drawCharacterStrip(fe);
  fe.present();
}

/**
 * fn 198e: the championship board, a CASE.CHR tile map with one MINATURE car for each race run so far.
 * The position of each comes from the word table at [0312] (column and row in 8-pixel cells) and the frame
 * from the championship table: the round gives the vehicle and the track the column of the strip.
 */
export function drawChampionshipBoard(fe: FrontEnd): void {
  const d = fe.ds;
  fe.tilemap(0x21FF, 0x0AA0, 0x0AB4);      // CASE.CHR tiles through CASE.MAP
  const bx = REC.mini0;
  let si = 0x043C;
  for (let race = 0; race < d.r8(0x28C1); race++) {
    si++;
    const place = d.r16(0x0312 + race * 2);
    d.w8(bx + 0x0A, 0);
    d.w16(bx + 0x02, ((place & 0xFF) << 3) + 0x0C);
    d.w16(bx + 0x04, ((place >> 8) << 3) + 0x4E);
    const entry = d.r8(si);
    d.w16(bx + 0x13, (((entry >> 2) - 1) & 0xFF) + ((entry & 3) << 3));
    fe.blitSprite(bx);
  }
}

// ---------------------------------------------------------------- race sequence (pre-race, results)

/** Car object records, one per starting slot, in [03FC..0402] finishing order. */
export const CAR_RECORDS = [0x0C03, 0x0C1E, 0x0C39, 0x0C54] as const;
/** MINATURE.CHR records, one per car. */
export const MINI_RECORDS = [0x0CDB, 0x0CF6, 0x0D11, 0x0D2C] as const;

/** fn 1a34: two ASCII digits at `si`, with a leading space below ten. */
export function twoDigits(fe: FrontEnd, si: number, value: number): void {
  const d = fe.ds;
  const tens = Math.floor((value & 0xFF) / 10), units = (value & 0xFF) % 10;
  d.w8(si, tens === 0 ? 0x20 : 0x30 + tens);
  d.w8(si + 1, 0x30 + units);
}

/** fn 1867: the track's name, with "RACE nn" beside it except on the last race of a championship. */
export function drawTrackName(fe: FrontEnd, y: number): void {
  const d = fe.ds;
  const round = d.r8(0x28BF), track = d.r8(0x28C0);
  const index = ((track - 1) + ((round - 1) << 2)) & 0xFF;
  let si = 0x0460;
  if (index !== 0) {                                   // jcxz: index 0 skips both the last-race case and the search
    if (d.r8(0x28C1) === d.r8(0x0439)) { fe.textFromList(0x0460, index, 0xFFFF, y, FONT2); return; }
    for (let n = index; n > 0; n--) { while (d.r8(si) !== 0) si++; si++; }
  }
  let len = 0;
  for (let p = si; d.r8(p) !== 0; p++) len++;
  const cx = ((len + 1) << 3) + 0x40;
  const x = (((0xFF - cx) & 0xFFFF) >> 1) + 0x40;
  fe.textAt(si, x, y, FONT2);
  twoDigits(fe, 0x03B3, d.r8(0x28C1));
  fe.textAt(0x03AE, x - 0x40, y, FONT2);
}

/** fn 19f2: the row of driver faces at the top of a screen, one per car still in the game. */
export function drawCarFaces(fe: FrontEnd): void {
  const d = fe.ds;
  drawHeader(fe);
  const two = d.r8(0x03F8) !== 0;
  let x = two ? 0x47 : 8;
  const last = two ? 0x0C1E : 0x0C54;
  for (let bx = 0x0C03; bx <= last; bx += 0x1B, x += 0x40) {
    d.w16(bx + 0x13, d.r16(bx + 0x13) & 0x4F);
    d.w16(bx + 0x04, 0x24);
    d.w16(bx + 0x02, x);
    drawFace(fe, bx);
    fe.outline(bx, 0x0D);
    drawChosenName(fe, bx);
  }
}

/** fn 11f8 (drawing part): the card shown before each race. */
export function drawPreRace(fe: FrontEnd): void {
  const d = fe.ds;
  fe.song(5);                                         // 1207
  if (d.r8(0x28BF) === 9) {                                  // round 9: the bonus time trial
    d.w8(0x03FA, 3);
    drawHeader(fe);
    fe.textCentred(0x03BF, 0x28, FONT2);
    fe.textCentred(0x03CE, 0x38, FONT2);
    fe.textCentred(0x03D9, 0x48, FONT2);
    d.w16(REC.intro + 0x13, 8);
    d.w16(REC.intro + 0x04, 0x5A);
    drawTitleVehicle(fe);
    fe.textCentred(0x03E8, 0xA2, FONT1);
    fe.present();
    return;
  }
  if (d.r8(0x28C1) === 0) {                                  // first race of a championship
    if (d.r8(0x03F8) === 1) return;
    drawHeader(fe);
    fe.textAt(0x035C, 0x58, 0x32, FONT2);
    fe.textAt(0x0367, 0x70, 0x46, FONT2);
    d.w16(REC.intro + 0x13, d.r8(0x28BF) - 1);
    d.w16(REC.intro + 0x04, 0x5A);
    drawTitleVehicle(fe);
    fe.present();
    return;
  }
  drawCarFaces(fe);
  drawTrackName(fe, 0x6C);
  const cx = (d.r8(0x28BF) - 1) & 0xFF;
  d.w16(REC.intro + 0x13, cx);
  d.w16(REC.intro + 0x04, 0x80);
  drawTitleVehicle(fe);
  fe.present();
  // the four miniature cars that drive in from both sides
  let frame = cx, x = 0x100;
  for (const bx of MINI_RECORDS) {
    d.w16(bx + 0x13, frame);
    d.w16(bx + 0x02, x);
    d.w16(bx + 0x04, 0x5A);
    d.w8(bx + 0x0A, 1);
    frame += 8;
    x += 0x40;
  }
  if (d.r8(0x03F8) !== 0) {
    d.w16(0x0CDD, 0xFFE0);
    d.w16(0x0CF8, 0x0100);
    d.w8(0x0CE5, 0);
  }
}

/** fn 13e4 up to the first present: the results board with the four finishing slots. */
export function drawResultsBoard(fe: FrontEnd): void {
  const d = fe.ds;
  fe.song(6);                                         // 142d
  drawHeader(fe);
  fe.textCentred(0x036C, 0x25, FONT2);
  drawTrackName(fe, 0x34);
  const nos = REC.nos;
  d.w16(nos + 0x13, 0); d.w16(nos + 0x02, 0x07); d.w16(nos + 0x04, 0x47); fe.blit(nos);
  d.w16(nos + 0x04, 0x8F); d.w16(nos + 0x13, 2); fe.blit(nos);
  d.w16(nos + 0x02, 0xC6); d.w16(nos + 0x04, 0x47); d.w16(nos + 0x13, 1); fe.blit(nos);
  d.w16(nos + 0x04, 0x8F); d.w16(nos + 0x13, 3); fe.blit(nos);
  const place = [[0x3F, 0x47], [0x86, 0x47], [0x3F, 0x8F], [0x86, 0x8F]] as const;
  for (let i = 0; i < 4; i++) {
    const bx = d.r16(0x03FC + i * 2);
    d.w16(bx + 0x02, place[i]![0]);
    d.w16(bx + 0x04, place[i]![1]);
  }
  d.w16(0x0CDD, 0xFFE0); d.w16(0x0CF8, 0x0120); d.w16(0x0D13, 0xFFE0); d.w16(0x0D2E, 0x0120);
  d.w16(0x0CDF, 0x6F); d.w16(0x0CFA, 0x6F); d.w16(0x0D15, 0xB7); d.w16(0x0D30, 0xB7);
  let ch = 0;
  for (let i = 0; i < 4; i++) {
    const bx = d.r16(0x03FC + i * 2);
    fe.outline(bx, 0x0F);
    let cl = (d.r8(0x28BF) - 1) & 0xFF;
    if (bx !== 0x0C03) { cl = (cl + 8) & 0xFF; if (bx !== 0x0C1E) { cl = (cl + 8) & 0xFF; if (bx !== 0x0C39) cl = (cl + 8) & 0xFF; } }
    const di = MINI_RECORDS[i]!;
    d.w8(di + 0x13, cl);
    d.w8(di + 0x0A, ch);
    ch ^= 1;
  }
  fe.present();
}

/** fn 13e4's animation: each miniature drives to its slot, then the driver's face and verdict appear. */
export function animateResults(fe: FrontEnd): void {
  const d = fe.ds;
  for (let i = 0; i < 4; i++) {
    const bx = MINI_RECORDS[i]!;
    const car = d.r16(0x03FC + i * 2);
    let ax = d.rs16(bx + 0x02);
    for (;;) {
      d.w16(bx + 0x02, ax);
      fe.blitSprite(bx);
      fe.presentRows(d.r16(bx + 0x04), 0x10);
      fe.restoreBackground(bx);
      if (bx === 0x0CDB || bx === 0x0D11) { ax += 2; if (ax < 7) continue; }
      else { ax -= 2; if ((ax & 0xFFFF) > 0xC6) continue; }
      break;
    }
    fe.blit(bx);                                        // the final opaque draw keeps the last drawn position
    d.w16(car + 0x13, d.r16(car + 0x13) & 0x0F);
    drawFace(fe, car);
    drawChosenName(fe, car);
    const ax2 = d.r16(car + 0x13);
    if (ax2 === d.r16(0x0C16)) {
      let si = 0x039A;                                        // QUALIFY
      if (d.r16(0x03FC) !== car && (d.r8(0x28C1) === 0x19 || d.r16(0x03FE) !== car)) si = 0x03A2;   // FAILED
      let x = 4;
      if (d.r16(0x03FC) !== car && d.r16(0x0400) !== car) x = 0xBC;
      fe.textAt(si, x, d.r16(car + 0x04) + 0x20, FONT1);
    }
    fe.present();
  }
  d.w16(d.r16(0x03FC) + 0x13, d.r16(d.r16(0x03FC) + 0x13) | 0x200);
  d.w16(d.r16(0x0400) + 0x13, d.r16(d.r16(0x0400) + 0x13) | 0x100);
  d.w16(d.r16(0x0402) + 0x13, d.r16(d.r16(0x0402) + 0x13) | 0x300);
}

/**
 * fn 13e4's tail: the winner and the loser flash while the screen waits for a key. Not wired into the page
 * yet, so the results board is currently still rather than flashing; the captures it is checked against
 * were taken at a fixed blink phase, so turning it on needs the comparison to allow both halves first.
 */
export function flashResults(fe: FrontEnd): void {
  const d = fe.ds;
  for (const p of [0x03FC, 0x0402]) {
    const bx = d.r16(p);
    d.w16(bx + 0x13, d.r16(bx + 0x13) ^ 0x10);
  }
  for (let bx = 0x0C03; bx <= 0x0C54; bx += 0x1B) drawFace(fe, bx);
  fe.present();
}

/** fn 1c1b (static part): the verdict screen between races. `message` indexes the list at 081F:
 *  0 failed to qualify, 1 qualified for Challenge, 2 one life lost, 3 extra life, 4 no bonus,
 *  5 qualified for Head to Head. */
export function drawVerdict(fe: FrontEnd, message: number): void {
  const d = fe.ds;
  fe.song(8);                                         // 1c78
  let cx = message;
  d.w16(0x261F, 0);
  if (d.r8(0x03F8) !== 0 && cx === 1) cx = 5;
  d.w8(0x107E, 0); d.w8(0x107F, 0);
  drawHeader(fe);
  const bx = 0x0C03;
  d.w16(bx + 0x02, 0x68);
  d.w16(bx + 0x04, 0x46);
  const expression = cx & 1 ? 2 : 3;
  d.w16(bx + 0x13, (d.r16(bx + 0x13) & 0x0F) | (expression << 8));
  drawChosenName(fe, bx);
  fe.outline(bx, 0x0D);
  fe.textFromList(0x081F, cx, 0xFFFF, 0x32, FONT2);
  if (cx === 0 || cx === 4) return;
  twoDigits(fe, 0x089C, d.r8(0x0406));
  twoDigits(fe, 0x0899, d.r8(0x0406));
  fe.textAt(0x0893, 0x60, 0x8C, FONT1);
}

/** fn 1de5: the driver's face flashes while the verdict screen waits for a key. */
export function flashVerdictFace(fe: FrontEnd): void {
  const d = fe.ds;
  d.w16(0x0C16, d.r16(0x0C16) ^ 0x10);
  drawFace(fe, 0x0C03);
  fe.present();
}

/** fn 11f8's tail: the miniature cars drive across the pre-race card until they reach their places. */
export function animatePreRace(fe: FrontEnd): void {
  const d = fe.ds;
  const two = d.r8(0x03F8) !== 0;
  for (let guard = 0; guard < 400; guard++) {
    fe.blitSprite(0x0CDB);
    fe.blitSprite(0x0CF6);
    if (!two) { fe.blitSprite(0x0D11); fe.blitSprite(0x0D2C); }
    fe.presentRows(d.r16(0x0CDF), 0x20);
    if (two) {
      if (d.r16(0x0CDD) === 0x54) return;
      fe.restoreBackground(0x0CDB);
      d.w16(0x0CDD, d.r16(0x0CDD) + 2);
      fe.restoreBackground(0x0CF6);
      d.w16(0x0CF8, d.r16(0x0CF8) - 2);
      continue;
    }
    if (d.rs16(0x0CDD) <= 0x10) return;
    for (let bx = 0x0D2C; bx >= 0x0CDB; bx -= 0x1B) {
      fe.restoreBackground(bx);
      d.w16(bx + 0x02, d.r16(bx + 0x02) - 2);
    }
  }
}

// ---------------------------------------------------------------- head to head (fn 240a / 2481 / 2216 / 256e)
/** fn 240a: the two drivers side by side at height `y`, with the tournament score when [08a5] is set. */
export function drawH2HFaces(fe: FrontEnd, y: number): void {
  const d = fe.ds;
  d.w16(REC.faceHappy + 0x04, y); d.w16(REC.car1 + 0x04, y);
  drawHeader(fe);
  d.w16(REC.faceHappy + 0x13, d.r16(REC.faceHappy + 0x13) & 0x4F);
  d.w16(REC.faceHappy + 0x02, 0x20);
  drawFace(fe, REC.faceHappy);
  fe.outline(REC.faceHappy, 0x0D);
  drawChosenName(fe, REC.faceHappy);
  d.w16(REC.car1 + 0x13, d.r16(REC.car1 + 0x13) & 0x4F);
  d.w16(REC.car1 + 0x02, 0xB0);
  drawFace(fe, REC.car1);
  fe.outline(REC.car1, 0x0D);
  drawChosenName(fe, REC.car1);
  if (d.r8(0x08A5) === 0) return;
  fe.textFromList(STR.scores, d.r8(0x098A), d.r16(REC.faceHappy + 0x02) + 0x38, d.r16(REC.faceHappy + 0x04), FONT2);
  fe.textFromList(STR.scores, d.r8(0x098C), d.r16(REC.car1 + 0x02) - 0x10, d.r16(REC.car1 + 0x04), FONT2);
}

/** fn 2481: each driver's lifetime record, WON nn / LOST nn, and the skill word the difference earns. */
export function drawH2HRecords(fe: FrontEnd): void {
  const d = fe.ds;
  // 2485 quirk: the original really does `and bx,0x1f` for player 1 and 0x0f for player 2. The extra bit
  // is the 0x10 flash flag, so on a flashing frame player 1's record is read out of the next table along.
  for (const [rec, mask] of [[REC.faceHappy, 0x1F], [REC.car1, 0x0F]] as const) {
    const character = d.r16(rec + 0x13) & mask;
    const won = d.r8(0x09A4 + character), lost = d.r8(0x09AF + character);
    twoDigits(fe, 0x099A, won);
    twoDigits(fe, 0x0991, lost);
    const x = d.r16(rec + 0x02) - 0x18, y = d.r16(rec + 0x04) + 0x3A;
    fe.textAt(STR.won, x, y, FONT1);
    fe.textAt(STR.lost, x + 0x30, y, FONT1);
    let n = won - lost + 0x0A;                        // 24cd: -10..+10 mapped onto the eight skill words
    if (n < 0) n = 0; else if (n > 0x14) n = 0x14;
    fe.textFromList(STR.skills, d.r8(0x08B0 + n), x, y + 8, FONT1);
  }
}

/** fn 2193 (drawing part): pick entry `index` of the ten single-race tracks at [09d9] and draw its vehicle. */
export function setSingleRaceTrack(fe: FrontEnd, index: number): void {
  const d = fe.ds;
  d.w16(0x08A3, index);
  const w = d.r16(0x09D9 + index * 2);
  let round = (w >> 8) & 0xFF;                        // xchg al, ah
  d.w8(0x09D8, round);                                // 1-based index into the vehicle name list
  d.w8(0x28C0, w & 0xFF);
  if (round === 0x0A) round = 3;                      // PRO FORMULA ONE / PRO SPORTSCARS reuse rounds 3 and 1
  if (round === 0x0B) round = 1;
  d.w8(0x28BF, round);
  d.w16(REC.intro + 0x13, round - 1);
  d.w16(REC.intro + 0x04, 0x7F);
  d.w16(REC.intro + 0x02, 0x50);
  fe.blit(REC.intro);
}

/** fn 2216 (one step): the two miniature cars closing in on the vehicle picture, four pixels per frame. */
export function stepTrackCars(fe: FrontEnd): boolean {
  const d = fe.ds;
  d.w16(REC.mini1 + 0x04, 0x46); d.w16(REC.mini0 + 0x04, 0x46);
  const step = d.r16(0x263A) * 4;
  d.w16(REC.mini0 + 0x02, d.r16(REC.mini0 + 0x02) + step);
  d.w16(REC.mini1 + 0x02, d.r16(REC.mini1 + 0x02) - step);
  fe.blitSprite(REC.mini0);
  fe.blitSprite(REC.mini1);
  return s16(d.r16(REC.mini0 + 0x02)) <= 0x58;
}

/** fn 2216 head: clear the two text rows, park the cars at the edges and name the vehicle. */
export function drawTrackCard(fe: FrontEnd): void {
  const d = fe.ds;
  fe.fillRowsAt(d.r16(REC.face0 + 0x04) + 0x40, 8, 0);
  const frame = d.r8(0x28BF) - 1;
  d.w16(REC.mini0 + 0x13, frame); d.w16(REC.mini0 + 0x02, 0);
  d.w16(REC.mini1 + 0x13, frame + 8); d.w16(REC.mini1 + 0x02, 0xE0);
  const y = d.r16(REC.intro + 0x04) + 0x40;
  fe.fillRowsAt(y, 8, 0);
  fe.textFromList(STR.vehicles, d.r8(0x09D8) - 1, 0xFFFF, y, FONT1);
}

/** fn 256e head: who won, the two records and the verdict over each face. */
export function drawH2HResults(fe: FrontEnd): void {
  const d = fe.ds;
  drawH2HFaces(fe, 0x64);
  drawH2HRecords(fe);
  const first = d.r16(0x03FC);
  fe.textAt(first === REC.faceHappy ? STR.verdicts : STR.verdicts + 8, 0x1D, 0x5C, FONT1);
  fe.textAt(first === REC.car1 ? STR.verdicts : STR.verdicts + 8, 0xB1, 0x5C, FONT1);
  const [cx, dx] = first === REC.faceHappy ? [0x200, 0x300] : [0x300, 0x200];
  d.w16(REC.faceHappy + 0x13, d.r16(REC.faceHappy + 0x13) | cx);
  d.w16(REC.car1 + 0x13, d.r16(REC.car1 + 0x13) | dx);
  fe.textCentred(STR.results, 0x3C, FONT2);
  if (d.r8(0x08A5) === 0) fe.textCentred(STR.tournament + 0x0B, 0x4C, FONT2);
  else fe.textCentred(STR.raceNumber, 0x4C, FONT2);
}

/** fn 256e tail: the cars drive back to the middle, then both faces flash. */
export function resetResultCars(fe: FrontEnd): void {
  const d = fe.ds;
  d.w16(REC.mini0 + 0x02, 0); d.w16(REC.mini1 + 0x02, 0xE0);
  d.w16(REC.mini0 + 0x04, 0xB6); d.w16(REC.mini1 + 0x04, 0xB6);
  const frame = d.r8(0x28BF) - 1;
  d.w16(REC.mini0 + 0x13, frame); d.w16(REC.mini1 + 0x13, frame + 8);
}

export function stepResultCars(fe: FrontEnd): boolean {
  const d = fe.ds;
  d.w16(REC.mini0 + 0x02, d.r16(REC.mini0 + 0x02) + 4);
  d.w16(REC.mini1 + 0x02, d.r16(REC.mini1 + 0x02) - 4);
  fe.blitSprite(REC.mini0);
  fe.blitSprite(REC.mini1);
  return d.r16(REC.mini0 + 0x02) !== 0x58;
}

/** fn 1faf (drawing part): the tournament card, race number and the track's miniature cars. */
export function drawTournamentCard(fe: FrontEnd): void {
  const d = fe.ds;
  const frame = d.r8(0x28BF) - 1;
  d.w16(REC.mini0 + 0x13, frame); fe.blit(REC.mini0);
  d.w16(REC.mini1 + 0x13, frame + 8); fe.blit(REC.mini1);
  drawH2HFaces(fe, 0x24);
  drawH2HRecords(fe);
  twoDigits(fe, 0x0985, d.r8(0x28C1));
  fe.textCentred(STR.raceNumber, 0x6E, FONT2);
  d.w16(REC.intro + 0x04, 0x7F);
  d.w16(REC.intro + 0x02, 0x50);
  d.w16(REC.intro + 0x13, frame);
  fe.blit(REC.intro);
}

/**
 * The input half of the front end: the wait loops that surround the screens in src/engine/screens.ts,
 * transliterated from MICRO_U.EXE fn 0032 (main), 0100 (title), 0220/02e0 (the two menus), 0382 (the hand
 * cursor), 09e0 + 0cd3 (the character carousel), 0c15 (press any key) and 102b (Challenge).
 *
 * The original blocks on the int 8 tick counters. Here every such wait is a `yield`, so the browser event
 * loop (or a test) drives the front end one game tick at a time: bump the counters with `timerTick`, read
 * the input with `pollInput`, then resume. A generator yields 'championship' where fn 102b calls fn 10a0,
 * and is resumed when the race sequence ends.
 */
import { DataSegment, s16 } from './memory';
import { FrontEnd, FONT1, FONT2 } from './frontend';
import { pollInput, STICK_CENTRED } from './race';
export { pollInput };
import {
  REC, STR, drawTitle, titleNextVehicle, drawSelectGame, drawOnePlayerMenu, drawMenuCursor, eraseMenuCursor,
  drawHeader, resetCharacters, drawFace, drawChosenName, drawCharacterStrip, drawPrompt, drawCarFaces,
  drawChampionshipBoard, drawVerdict, twoDigits, CAR_RECORDS, LABELS,
  drawH2HFaces, drawH2HRecords, drawH2HResults, drawTournamentCard, drawTrackCard, stepTrackCars,
  setSingleRaceTrack, resetResultCars, stepResultCars, drawVehicleName,
  drawOptions, drawOptionValues, drawOptionsInfo,
} from './screens';
import { inputHandlers, settingsBytes } from './setup';

/** What a front-end generator asks its driver for: one more game tick, or the race sequence. */
export type Request = 'tick' | 'championship' | 'race';
export type Task<T = void> = Generator<Request, T, void>;

/** int 8 (fn 489c): the counters every wait loop spins on, and the 32-tick blink flag. */
export function timerTick(d: DataSegment): void {
  d.add16(0x28F7, 1);
  d.add16(0x0002, 1);
  d.add16(0x261F, 1);
  const n = (d.r8(0x26D0) + 1) & 0xFF;
  d.w8(0x26D0, n);
  if (n >= 0x20) { d.w8(0x26CF, d.r8(0x26CF) ^ 1); d.w8(0x26D0, 0); }
}

/** fn 2770 tail: leaving GAME OPTIONS hands the two configured devices to cars 0 and 1 (fn 29f5). */
export function applyOptionsInputs(d: DataSegment): void {
  d.w16(0x2658, d.r8(0x0F5F));
  d.w16(0x265A, d.r8(0x0F61));
  d.w16(0x265C, 6);
  d.w16(0x265E, 6);
}

/** fn 17ff: wait `ticks`, abortable by a key or the fire button. True when the wait ran to the end. */
export function* waitTicks(d: DataSegment, ticks: number): Task<boolean> {
  const source = d.r16(0x1080);
  d.w16(0x1080, 0);
  d.w16(0x0002, 0);
  d.w8(0x107E, 0); d.w8(0x107F, 0);
  try {
    for (;;) {                                        // 1819: fire held at entry is ignored, not a press
      yield 'tick';
      if (d.r8(0x107E) !== 0) return false;
      if (!(d.r8(0x108B) & 8)) break;
      if (s16(d.r16(0x0002)) > s16(ticks)) return true;
    }
    for (;;) {                                        // 183b: now a press or a key ends the wait
      yield 'tick';
      if (d.r8(0x107E) !== 0) return false;
      if (d.r8(0x108B) & 8) return false;
      if (s16(d.r16(0x0002)) > s16(ticks)) return true;
    }
  } finally {
    d.w16(0x1080, source);
  }
}

/** fn 179b: wait for the fire button to come up and then go down again, 0x2bc ticks at most either way. */
export function* waitFire(d: DataSegment): Task<void> {
  const source = d.r16(0x1080);
  d.w16(0x0002, 0);
  d.w16(0x1080, 0);
  d.w8(0x107F, 0); d.w8(0x107E, 0);
  try {
    released: while (d.r16(0x0002) < 0x2BC) {         // 17b5: let go of the button first
      yield 'tick';
      if (d.r8(0x107E) !== 0) break;
      if (d.r8(0x108B) & 8) continue;
      while (d.r16(0x0002) < 0x2BC) {                 // 17d7: then press it again
        yield 'tick';
        if (d.r8(0x107E) !== 0) break released;
        if (d.r8(0x108B) & 8) break released;
      }
      break;
    }
  } finally {
    d.w16(0x1080, source);                            // as in waitTicks: a driver may abandon the generator
  }
}

/**
 * fn 0382: the pointing hand on SELECT GAME and the one-player menu. Left picks choice 1, right choice 2,
 * fire confirms; Esc or 2000 ticks without a choice return 0.
 */
export function* menuSelect(fe: FrontEnd, y: number, initial: number): Task<number> {
  const d = fe.ds;
  d.w16(0x1080, 0);
  d.w8(0x107E, 0);
  let cx = initial & 0xFFFF;
  for (;;) {
    drawMenuCursor(fe, cx, y);                        // 0392: the hand is only in the buffer for the copy
    eraseMenuCursor(fe);
    do {                                              // 03a9: wait for the button that got us here
      yield 'tick';
      d.w8(0x108B, d.r8(0x108B) & 8);
    } while (d.r8(0x108B) !== 0);
    d.w16(0x0002, 0);
    for (;;) {                                        // 03c2
      yield 'tick';
      if (d.r16(0x0002) >= 0x7D0) return 0;
      if (d.r8(0x107E) === 1) return 0;
      const al = d.r8(0x108B);
      if (al & 8) { if (cx === 0) break; return cx; }
      let dx = 1;
      if (!(al & 0x80)) { dx = 2; if (!(al & 0x40)) continue; }
      if (cx === dx) { d.w16(0x0002, 0); continue; }
      cx = dx;
      break;
    }
  }
}

/** fn 0100: the title screen. True when Esc asked to leave the game. */
export function* title(fe: FrontEnd): Task<boolean> {
  const d = fe.ds;
  fe.sound?.stopVoices();                             // 010a: ah=7, then ah=6, then song 1
  fe.sound?.stopAll();
  fe.song(1);
  drawTitle(fe);
  for (;;) {
    d.w16(0x0002, 0);
    for (;;) {
      yield 'tick';
      if (d.r8(0x137B) & 8) return false;
      const key = d.r8(0x107E);
      if (key === 1) return true;
      if (key !== 0) return false;
      if (s16(d.r16(0x0002)) >= 0x118) break;
    }
    titleNextVehicle(fe);                             // 017b: next vehicle every 0x118 ticks
  }
}

/** fn 0220: SELECT GAME. True when the player backed out to the title. */
export function* selectGame(fe: FrontEnd): Task<boolean> {
  const d = fe.ds;
  fe.song(1);                                         // 0220
  drawSelectGame(fe);
  const cx = yield* menuSelect(fe, 0x80, d.r16(0x0130));
  if (cx === 0) return true;
  d.w16(0x0130, cx);
  if (cx === 2) { yield* headToHeadTwoPlayers(fe); return false; }
  yield* onePlayerMenu(fe);
  return false;
}

/** fn 02e0: Head to Head against Challenge. */
export function* onePlayerMenu(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  drawOnePlayerMenu(fe);
  const cx = yield* menuSelect(fe, 0x6E, d.r16(0x0132));
  d.w16(0x0132, cx);
  d.w8(0x0156, cx & 0xFF);
  resetCharacters(fe);
  drawHeader(fe);
  if ((cx & 0xFF) === 1) return yield* headToHead(fe);
  if ((cx & 0xFF) === 2) yield* challenge(fe);
}

/** fn 102b: pick a character, press any key, then the championship. */
export function* challenge(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  d.w8(0x03F3, 0);
  d.w8(0x03F8, 0);
  d.w8(0x0342, 0);
  d.w16(0x2656, 1);
  d.w8(0x0310, 0);
  d.w16(0x08A2, 0);                                   // cs:9c62 = ds:08a2
  d.w16(0x1080, 0x137B);                              // the menus follow player 1 only
  d.w16(0x265A, 6);
  const bx = REC.faceHappy;                           // 0c03 = player 1's car record
  d.w16(0x019E, bx);
  d.w16(bx + 0x02, 0x68);
  d.w16(bx + 0x04, 0x27);
  drawFace(fe, bx);
  fe.outline(bx, 0x0D);
  const chosen = yield* characterSelect(fe, 0x020F, d.r16(0x03F4));
  if (chosen !== undefined) {
    d.w16(0x03F4, d.r16(d.r16(0x019E) + 0x13));
    yield* pressAnyKey(fe);
    d.w16(0x266A, 6);
    yield 'championship';
  }
  d.w16(0x265A, d.r16(0x0F61));
}

/**
 * fn 09e0: the eleven-face carousel. Left and right scroll it, fire takes the face in the middle; the
 * chosen one flashes five times and is marked taken. Esc gives up, and returns undefined.
 */
export function* characterSelect(fe: FrontEnd, prompt: number, previous: number): Task<number | undefined> {
  const d = fe.ds;
  if (previous !== 0xFFFF) d.w16(0x0192, d.r16(0x016F + previous * 2));
  d.w8(0x1096, 0);
  d.w16(0x019A, prompt);
  d.w16(0x0194, FONT1);
  d.w16(0x0196, 0x62);
  fe.song(2);                                         // 0a06
  d.w8(0x107F, 0); d.w8(0x107E, 0);
  const bx = d.r16(0x019E);
  const was = d.r16(bx + 0x13);
  if (was <= 0x0A) {                                  // put the car's old choice back on the carousel
    d.w8(0x0164 + was, was & 0xFF);
    d.w16(bx + 0x13, 0x0B);
    fe.blit(bx);
    drawChosenName(fe, bx);
  }
  drawCharacterStrip(fe);
  fe.present();
  do { yield 'tick'; } while (d.r8(0x108B) & 8);      // 0a4c: wait for the button that opened the screen
  drawCharacterStrip(fe);
  fe.present();
  while (s16(d.r16(0x0160)) > 0x0B) yield* scrollCarousel(fe, s16(d.r16(0x0162)));
  for (;;) {
    d.w16(0x0002, 0);
    let dir: number;
    for (;;) {                                        // 0a7b
      drawPrompt(fe);
      yield 'tick';
      const al = d.r8(0x108B);
      if (d.r8(0x107E) === 1) return undefined;
      if (al & 8) {
        const slot = d.r16(0x0160);
        if (slot > 0x0A) continue;                    // a face already taken cannot be chosen
        return yield* confirmCharacter(fe, slot);
      }
      if (al & 0x80) { dir = 1; break; }
      if (al & 0x40) { dir = 0xFFFF; break; }
    }
    d.w16(0x0162, dir);
    yield* scrollCarousel(fe, s16(dir));
  }
}

/** fn 09e0 tail (0ab5): mark the face taken, flash it five times and hand it to the car at [019e]. */
function* confirmCharacter(fe: FrontEnd, slot: number): Task<number> {
  const d = fe.ds;
  d.w8(0x0164 + slot, d.r8(0x0164 + slot) | 0x40);
  drawCharacterStrip(fe);
  const bx = d.r16(0x019E);
  d.w16(bx + 0x13, 0x0200 | slot);                    // expression 2 = happy
  drawChosenName(fe, bx);
  fe.present();
  for (let n = 0; n < 5; n++) {
    d.w16(bx + 0x13, d.r16(bx + 0x13) ^ 0x10);
    drawFace(fe, bx);
    d.w16(0x0002, 0);
    fe.presentRows(d.r16(bx + 0x04), 0x30);
    while (s16(d.r16(0x0002)) <= 0x0F) yield 'tick';
  }
  const character = d.r16(bx + 0x13) & 0x0F;
  for (const [rec, slotWord] of [[0x0C03, 0x2668], [0x0C1E, 0x266A], [0x0C39, 0x266C], [0x0C54, 0x266E]] as const) {
    if (bx !== rec) continue;
    d.w16(slotWord, character);
    if (rec === 0x0C03 || rec === 0x0C1E) d.w16(slotWord, character | (yield* handicap(fe, character)));
  }
  d.w16(bx + 0x13, character);
  drawFace(fe, bx);
  fe.presentRows(d.r16(bx + 0x04), 0x30);
  return d.r16(0x0160);
}

/**
 * fn 0b51: HANDICAP WALTER / MIKE / ANNE ? Only the three fastest drivers can be handicapped, and only when
 * a second human is playing. The answer is remembered per character at [01d6..01d8] and comes back as the
 * 0x80 bit of the car's entry in [2668..266e].
 */
function* handicap(fe: FrontEnd, character: number): Task<number> {
  const d = fe.ds;
  if (d.r16(0x2656) === 1) return 0;
  if (d.r16(0x265A) === 6) return 0;
  const question = STR.handicap[character];
  if (question === undefined) return 0;
  const slot = 0x01D6 + character;
  fe.fillRect(0, 0x62, 8, 0x100, 0);
  d.w8(0x01E0, d.r8(slot));
  fe.textAt(question, 0x2C, 0x62, FONT1);
  for (;;) {                                          // 0baf: redraw the answer, then wait for a key
    fe.fillRect(0xBC, 0x62, 8, 0x1E, 0);
    fe.textFromList(STR.yesNo, d.r8(0x01E0) === 0x80 ? 1 : 0, 0xBC, 0x62, FONT1);
    fe.present();
    for (;;) {
      yield 'tick';
      const al = d.r8(0x108B);
      if (al & 0x18) { d.w8(slot, d.r8(0x01E0)); return d.r8(0x01E0); }
      if (al & 0x80) { d.w8(0x01E0, 0); break; }
      if (al & 0x40) { d.w8(0x01E0, 0x80); break; }
    }
  }
}

// ---------------------------------------------------------------- head to head (fn 0fbf / 1e20 / 1ef1 / 1faf / 2329)
/** fn 0fbf: one player against one computer driver, over the same championship as the Challenge. */
export function* headToHead(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  d.w8(0x03F3, 0);
  d.w8(0x03F8, 1);
  d.w16(0x2656, 2);
  d.w8(0x0310, 0);
  d.w16(0x1080, 0x137B);
  d.w16(0x265A, 6);
  d.w16(0x08A2, 0);                                   // cs:9c62 = ds:08a2
  inputHandlers(d);
  drawCarFaces(fe);
  d.w16(0x019E, REC.faceHappy);
  if ((yield* characterSelect(fe, STR.whoToBe, d.r16(0x03F4))) !== undefined) {
    d.w16(0x03F4, d.r16(REC.faceHappy + 0x13));
    d.w16(0x019E, REC.car1);
    if ((yield* characterSelect(fe, STR.whoToRace, d.r16(0x03F6))) !== undefined) {
      d.w16(0x03F6, d.r16(REC.car1 + 0x13));
      yield* pressAnyKey(fe);
      yield 'championship';
    }
  }
  d.w16(0x265A, d.r16(0x0F61));
  inputHandlers(d);
}

/** fn 1e20: two players, each picking a driver with their own keys, then the CHOOSE GAME menu. */
export function* headToHeadTwoPlayers(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  d.w16(REC.mini0 + 0x02, 0x0A); d.w16(REC.mini0 + 0x04, 0x46); d.w8(REC.mini0 + 0x0A, 0);
  d.w16(REC.mini1 + 0x02, 0xD2); d.w16(REC.mini1 + 0x04, 0x46); d.w8(REC.mini1 + 0x0A, 1);
  d.w8(0x03F3, 1);
  d.w8(0x0156, 1);
  d.w16(0x265A, d.r16(0x0F61));
  d.w16(0x2656, 2);
  d.w8(0x03F8, 1);
  d.w16(0x09D6, 0);
  inputHandlers(d);
  resetCharacters(fe);
  drawCarFaces(fe);
  fe.textAt(STR.player, 4, 0x32, FONT1);
  fe.textAt(STR.one, 4, 0x3B, FONT1);
  d.w16(0x019E, REC.faceHappy);
  d.w16(0x1080, 0x137B);
  if ((yield* characterSelect(fe, STR.whoToBe, d.r16(0x09A0))) !== undefined) {
    fe.fillRect(0, 0x32, 0x14, 0x40, 0);
    fe.textAt(STR.player, 0xBE, 0x32, FONT1);
    fe.textAt(STR.two, 0xBE, 0x3B, FONT1);
    d.w16(0x019E, REC.car1);
    d.w16(0x1080, 0x14DF);
    if ((yield* characterSelect(fe, STR.whoToBe, d.r16(0x09A2))) !== undefined) yield* chooseGame(fe);
  }
  d.w8(0x03F3, 0);
}

/** fn 1ef1: CHOOSE GAME!, tournament against single race. */
function* chooseGame(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  for (;;) {
    fe.song(2);
    for (const o of [0x098A, 0x098C, 0x0989, 0x098B, 0x08A2]) d.w8(o, 0);
    drawCarFaces(fe);
    fe.textAt(STR.tournament, 0x18, 0xBE, FONT1);
    fe.textAt(STR.tournament + 0x0B, 0x9C, 0xBE, FONT1);
    fe.textCentred(STR.chooseGame, 0x68, FONT2);
    d.w16(REC.selgam + 0x04, 0x7C);
    d.w16(REC.selgam + 0x02, 0x10); d.w16(REC.selgam + 0x13, 4); fe.blit(REC.selgam);
    d.w16(REC.selgam + 0x02, 0x94); d.w16(REC.selgam + 0x13, 5); fe.blit(REC.selgam);
    fe.present();
    const cx = yield* menuSelect(fe, 0x90, d.r16(0x08A0));
    if (cx === 0) { d.w8(0x08A2, 0); return; }
    d.w16(0x08A0, cx);
    d.w16(0x2656, 2);
    d.w8(0x08A2, cx & 0xFF);
    if (cx !== 2) return yield* tournament(fe);
    const prompt = d.r16(0x0194);                     // 1f9b: the single race borrows the prompt font
    yield* singleRace(fe);
    d.w16(0x0194, prompt);
  }
}

/** fn 1faf: eight tracks drawn at random without repeats; first to four wins takes the tournament. */
function* tournament(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  d.w8(0x0988, 1);
  d.w8(0x08A5, 1);
  d.w8(0x28C1, 1);
  let refill = true;
  for (;;) {
    if (refill) { for (let i = 0; i < 8; i++) d.w8(0x09C2 + i, 0); refill = false; }
    let free = false;                                 // 1fcc: is there a track left in the bag?
    for (let si = 0x09C2; si < 0x09CA; si++) if (d.r8(si) === 0) { free = true; break; }
    if (!free) { refill = true; continue; }
    let bx: number;
    for (;;) {                                        // 1fdd: the tick counter picks one of the eight
      bx = d.r16(0x0002) & 7;
      if (d.r8(0x09C2 + bx) === 0) break;
      yield 'tick';
    }
    d.w8(0x09C2 + bx, 1);
    const al = d.r8(0x09BA + bx);
    d.w8(0x28BF, al >> 2);
    d.w8(0x28C0, (al & 3) + 1);
    d.w8(0x09D8, al >> 2);
    drawTournamentCard(fe);
    yield* trackCars(fe);
    yield* waitFire(d);
    yield 'race';                                     // fn 216c
    yield* h2hResults(fe);                            // fn 256e
    d.w8(0x28C1, (d.r8(0x28C1) + 1) & 0xFF);
    if (d.r8(0x098A) === 4) return yield* champion(fe, REC.faceHappy);
    if (d.r8(0x098C) === 4) return yield* champion(fe, REC.car1);
  }
}

/** fn 2216: the two miniature cars closing in on the vehicle picture. */
function* trackCars(fe: FrontEnd): Task<void> {
  drawTrackCard(fe);
  for (;;) {
    const more = stepTrackCars(fe);
    yield 'tick';
    fe.present();
    fe.restoreBackground(REC.mini0); fe.restoreBackground(REC.mini1);
    if (!more) return;
  }
}

/** fn 2329: SINGLE RACE, choosing a vehicle from the ten fixed tracks and racing it over and over. */
function* singleRace(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  d.w8(0x08A5, 0);
  fe.song(2);
  d.w8(0x0988, 0);
  for (;;) {                                          // 234b
    d.w16(REC.mini0 + 0x02, 0x56); d.w8(REC.mini0 + 0x0A, 0);
    d.w16(REC.mini1 + 0x02, 0x96); d.w8(REC.mini1 + 0x0A, 1);
    d.w16(0x1080, 0); d.w8(0x107E, 0); d.w8(0x107F, 0);
    drawH2HFaces(fe, 0x24);
    const x = d.r16(REC.thumb + 0x02);                // the hand doubles as the SELECT VEHICLE picture
    d.w16(REC.thumb + 0x13, 1);
    d.w16(REC.thumb + 0x02, 0xB8); d.w16(REC.thumb + 0x04, 0x88);
    fe.blitSprite(REC.thumb);
    d.w16(REC.thumb + 0x02, x);
    drawH2HRecords(fe);
    fe.textCentred(STR.selectVehicle, 0x6E, FONT2);
    do { yield 'tick'; } while (d.r8(0x108B) & 8);    // 23a9
    yield* pickVehicle(fe, 0);
    let go = false;
    picking: for (;;) {                               // 23c2
      d.w16(0x0002, 0);
      for (;;) {                                      // 23c8
        drawVehicleName(fe);
        yield 'tick';
        const al = d.r8(0x108B);
        if (d.r8(0x107E) === 1) return;
        if (al & 8) { go = true; break picking; }
        if (al & 0xC0) { yield* pickVehicle(fe, 1); continue picking; }   // 23e9: both keys step forwards
      }
    }
    if (!go) return;
    d.w16(0x0194, FONT1);
    yield 'race';
    yield* h2hResults(fe);
  }
}

/** fn 2193: step to another of the ten single-race tracks and show it. */
function* pickVehicle(fe: FrontEnd, step: number): Task<void> {
  const d = fe.ds;
  fe.song(2);
  let index = s16(d.r16(0x08A3)) + step;
  if (index < 0) index = 9;
  if (index > 9) index = 0;
  setSingleRaceTrack(fe, index);
  yield* trackCars(fe);
  fe.presentRows(d.r16(REC.intro + 0x04), 0x48);
}

/** fn 256e: who won this race, the running score and both lifetime records. */
function* h2hResults(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  let first: number = REC.faceHappy, second: number = REC.car1;
  if (d.r16(0x03FC) === REC.faceHappy) d.w8(0x098A, (d.r8(0x098A) + 1) & 0xFF);
  else { first = REC.car1; second = REC.faceHappy; d.w8(0x098C, (d.r8(0x098C) + 1) & 0xFF); }
  d.w16(0x03FC, first); d.w16(0x03FE, second);
  fe.song(8);
  const won = 0x09A4 + (d.r16(first + 0x13) & 0x0F);
  d.w8(won, (d.r8(won) + 1) & 0xFF);
  const lost = 0x09AF + (d.r16(second + 0x13) & 0x0F);
  d.w8(lost, (d.r8(lost) + 1) & 0xFF);
  drawH2HResults(fe);
  fe.present();
  d.w8(0x26CE, 0);                                    // fn 32ce: the dissolve is not drawn here
  resetResultCars(fe);
  for (;;) {                                          // 266f
    const more = stepResultCars(fe);
    yield 'tick';
    fe.present();
    if (!more) break;
    fe.restoreBackground(REC.mini0); fe.restoreBackground(REC.mini1);
  }
  for (;;) {                                          // 26a0: both faces flash until a key
    d.w16(REC.faceHappy + 0x13, d.r16(REC.faceHappy + 0x13) ^ 0x10); drawFace(fe, REC.faceHappy);
    d.w16(REC.car1 + 0x13, d.r16(REC.car1 + 0x13) ^ 0x10); drawFace(fe, REC.car1);
    fe.present();
    if (!(yield* waitTicks(d, 0x14))) return;
  }
}

/** fn 0cd3: slide the carousel one slot along the 0x2c0-wide ring, at the speeds listed from [0185]. */
export function* scrollCarousel(fe: FrontEnd, dir: number): Task<void> {
  const d = fe.ds;
  let cx = 0, si = 0x0185;
  do {
    const step = d.r8(si++);
    cx += step;
    let ax = d.r16(0x0192);
    if (dir >= 0) { ax += step; if (ax >= 0x2C0) ax -= 0x2C0; }
    else { const borrow = ax < step; ax = (ax - step) & 0xFFFF; if (borrow) ax = (ax + 0x2C0) & 0xFFFF; }
    d.w16(0x0192, ax);
    d.w16(0x261F, 0);
    while (s16(d.r16(0x261F)) < 1) yield 'tick';
    drawCharacterStrip(fe);
    fe.presentRows(0x76, 0x51);
  } while (cx < 0x40);
}

/** fn 11f8 tail (1395): the pre-race card waits for the fire button to come up and go down again. */
export function* preRaceCard(fe: FrontEnd): Task<void> {
  yield* waitFire(fe.ds);
}

/** fn 0c15: PRESS FIRE TO START, blinking, for 0x2bc ticks or until a key or the button. */
export function* pressAnyKey(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  d.w16(0x261F, 0);
  d.w16(0x019A, 0x0241);
  d.w16(0x0194, FONT1);
  d.w16(0x0196, 0x62);
  d.w8(0x107F, 0); d.w8(0x107E, 0);
  while (d.r16(0x261F) < 0x2BC) {
    drawPrompt(fe);
    yield 'tick';
    if (d.r8(0x107E) !== 0) return;
    if (d.r8(0x108B) & 8) return;
  }
}

/**
 * fn 1c1b: the verdict after a race. The head of it (the face, the message and the two counters) is
 * `drawVerdict`; what follows is the count of lives sliding from the old number to the new one while the
 * face flashes, and then the wait.
 */
export function* verdict(fe: FrontEnd, message: number): Task<void> {
  const d = fe.ds;
  drawVerdict(fe, message);
  let cx = message;
  if (d.r8(0x03F8) !== 0 && cx === 1) cx = 5;
  if (cx === 0 || cx === 4 || cx === 1 || cx === 5) return yield* verdictWait(fe);
  yield* livesChange(fe, cx);
}

/** fn 1de5: flash the driver's face until a key or 0x2bc ticks. */
function* verdictWait(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  while (d.r16(0x261F) < 0x2BC) {
    d.w16(0x0C16, d.r16(0x0C16) ^ 0x10);
    drawFace(fe, 0x0C03);
    fe.present();
    if (!(yield* waitTicks(d, 0x0F))) return;
  }
}

/** fn 1cdc: one life fewer (message 2 or less) or one more, the old count sliding out of the way. */
function* livesChange(fe: FrontEnd, cx: number): Task<void> {
  const d = fe.ds;
  let lives = d.r8(0x0406);
  if (cx <= 2) {
    twoDigits(fe, 0x089C, lives);
    lives = (lives - 1) & 0xFF; d.w8(0x0406, lives);
    twoDigits(fe, 0x0899, lives);
  } else {
    twoDigits(fe, 0x0899, lives);
    lives = (lives + 1) & 0xFF; d.w8(0x0406, lives);
    twoDigits(fe, 0x089C, lives);
  }
  let y = 0x8C, step = 2, end = 0xC8;
  if (cx > 2) { y = 0xC8; end = 0x8C; step = -2; }
  d.w16(0x261F, 0);
  d.w16(0x0002, 0x226);
  for (;;) {
    if (d.r16(0x261F) >= 0x2BC) return;
    if (s16(d.r16(0x0002)) > 0x0F) {                  // the face flashes on its own timer
      d.w16(0x0002, 0);
      d.w16(0x0C16, d.r16(0x0C16) ^ 0x10);
      drawFace(fe, 0x0C03);
    }
    fe.textAt(0x0899, 0x90, 0x8C, FONT1);
    if (y !== 0) fe.textAt(0x089C, 0x90, y, FONT1);
    for (let n = 0; n < 5; n++) yield 'tick';
    fe.present();
    if (y !== 0) fe.fillRect(0x90, y, 8, 0x10, 0);
    fe.fillRect(0x90, 0x8C, 8, 0x10, 0);
    if (y !== 0 && y !== end) { y += step; continue; }
    if (y !== 0 && cx === 3) d.w16(0x0899, d.r16(0x089C));
    yield 'tick';
    // 1dcd quirk: the original compares [107e] against 0x1b, an ASCII code, where that byte holds XT
    // scancodes (0x1b is `]`). The branch is therefore dead in the real game too. Kept as it is.
    if (d.r8(0x107E) === 0x1B) { d.w8(0x0406, 0); return; }
    if (d.r8(0x107E) !== 0) return;
    if (d.r8(0x108B) & 8) return;
    y = 0;
  }
}

/**
 * fn 16de: a driver is knocked out. Their face is marked as gone on the carousel and drops off the bottom
 * of the screen, then the player picks whoever takes their place.
 */
export function* elimination(fe: FrontEnd, bx: number): Task<void> {
  const d = fe.ds;
  fe.song(6);
  const character = d.r16(bx + 0x13) & 0x0F;
  d.w8(0x0164 + character, d.r8(0x0164 + character) | 0x20);
  d.w16(bx + 0x13, d.r16(bx + 0x13) | 0x40);
  drawCarFaces(fe);
  fe.textAt(0x03B6, 0x80, 0x64, FONT2);                       // "IS OUT!!"
  fe.textAt(LABELS.names + (character << 3), 0x48, 0x64, FONT2);
  fe.present();
  d.w16(bx + 0x08, d.r16(0x0A3A));                            // the face image the drop uses
  d.w16(bx + 0x13, character << 1);
  let si = 0x034B;
  // fn 174a keeps the seat's y in cx across the whole loop (it adds the step, stores, then subtracts it
  // straight back), so every step is measured from the seat and not from the last step. The table at [034b]
  // is 02 04 08 10 20 2f 20 10 08 04 02 04 08 10 20 2f 00: the face dips, bobs back up and then goes under.
  // Together with the height cut below, its bottom edge stays put and it sinks into its own seat.
  const seatY = d.r16(bx + 0x04);
  for (;;) {
    const drop = d.r8(si); si++;
    d.w16(bx + 0x04, (seatY + drop) & 0xFFFF);
    if (drop === 0) break;
    d.w16(bx + 0x13, d.r16(bx + 0x13) ^ 1);
    fe.clip(bx);
    d.w8(bx + 0x19, (d.r8(bx + 0x19) - drop) & 0xFF);         // the sprite is cut off as it goes
    fe.blitSpriteNoClip(bx);
    fe.presentRows(0x20, 0x3C);
    fe.restoreBackground(bx);
    d.w16(0x0002, 0);
    while (s16(d.r16(0x0002)) < 9) yield 'tick';
  }
  d.w16(bx + 0x13, 0x0B);
  fe.present();
  yield* waitFire(d);
  yield* chooseOpponents(fe);
}

/**
 * fn 1aad: the champion. The trophy is stacked out of the ten slices of CUP.CHR, the winner's face creeps
 * up the screen flashing, and the title and the name slide in from either side until they meet the middle.
 */
export function* champion(fe: FrontEnd, bx: number): Task<void> {
  const d = fe.ds;
  d.w16(0x0348, bx);
  fe.song(3);
  d.w16(0x03AA, 0xFF50);
  d.w16(0x03AC, 0x0100);
  const frame = d.r16(bx + 0x13);
  drawHeader(fe);
  const cup = REC.cup;
  d.w16(cup + 0x04, 0x5A); d.w16(cup + 0x02, 0x50); d.w16(cup + 0x13, 0);
  fe.blit(cup);
  fe.fillRect(0x68, 0x62, 4, 0x30, 0x0F);
  d.w16(bx + 0x08, d.r16(0x0A26));                    // the big face image
  d.w16(bx + 0x02, 0x68);
  const character = d.r16(bx + 0x13) & 0x0F;
  d.w16(0x0344, character);
  d.w16(bx + 0x13, character << 1);
  let y = 0x62;
  d.w16(0x0002, 0x32);
  for (;;) {
    if (s16(d.r16(0x0002)) >= 0x0F) { d.w16(0x0002, 0); d.w16(bx + 0x13, d.r16(bx + 0x13) ^ 1); }
    d.w16(bx + 0x04, y);
    fe.blitSprite(bx);
    fe.fillRowsAt(0x26, 0x10, 0);
    fe.textAt(0x0384, d.r16(0x03AA), 0x26, FONT2);
    if (d.r16(0x03AA) !== 0x28) d.add16(0x03AA, 2);
    d.w16(cup + 0x13, 1); d.w16(cup + 0x04, 0x62);
    fe.blitSprite(cup);
    for (let n = 2, cy = 0x6A; n <= 9; n++, cy += 8) {  // the rest of the trophy, slice by slice
      d.w16(cup + 0x13, n); d.w16(cup + 0x04, cy);
      fe.blit(cup);
    }
    fe.fillRowsAt(0xA4, 0x10, 0);
    fe.textAt(LABELS.names + (d.r16(0x0344) << 3), d.r16(0x03AC), 0xA4, FONT2);
    if (d.r16(0x03AC) !== 0x68) d.add16(0x03AC, -2);
    fe.present();
    if (d.r16(0x03AA) === 0x28 && d.r16(0x03AC) === 0x68) {
      fe.restoreBackground(bx);
      d.w16(0x1080, 0);
      yield 'tick';
      if (d.r8(0x108B) !== 0) break;
      continue;
    }
    if (y >= 0x36) y--;
    fe.restoreBackground(bx);
    yield 'tick';
  }
  d.w16(bx + 0x13, frame);
}

/**
 * fn 18d8: the championship board between races, with the car of the race just run blinking. It waits
 * 0x23 ticks between halves of the blink and gives up after 0x2bc ticks or a key press.
 */
export function* championshipBoard(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  if (d.r8(0x28C1) === 0) return;
  if (d.r8(0x043A) === 0) return;
  drawHeader(fe);
  drawChampionshipBoard(fe);
  fe.present();
  if (d.r8(0x28BF) === 9) return yield* bonusBoard(fe);
  d.w16(0x261F, 0);
  for (;;) {
    fe.present();
    if (!(yield* waitTicks(d, 0x23))) return;
    fe.restoreBackground(REC.mini0);
    fe.present();
    if (!(yield* waitTicks(d, 0x23))) return;
    fe.blitSprite(REC.mini0);
    if (d.r16(0x261F) >= 0x2BC) return;
  }
}

/** fn 192b: the round 9 board, where two columns of cars flash over the case. */
function* bonusBoard(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  const bx = REC.mini0;
  d.w16(0x261F, 0);
  for (;;) {
    d.w16(bx + 0x13, 0x1F);
    for (let y = 0x8E; y <= 0xBE; y += 0x10) {
      d.add16(bx + 0x13, 1);
      d.w16(bx + 0x02, 0x95);
      d.w16(bx + 0x04, y);
      fe.blitSprite(bx);
      d.add16(bx + 0x13, 1);
      d.w16(bx + 0x02, 0xB5);
      fe.blitSprite(bx);
    }
    fe.presentRows(0x8E, 0x30);
    if (!(yield* waitTicks(d, 0x23))) return;
    if (d.r16(0x261F) >= 0x2BC) return;
    drawChampionshipBoard(fe);
    fe.presentRows(0x8E, 0x30);
    if (!(yield* waitTicks(d, 0x23))) return;
  }
}

/**
 * fn 1a4a: once the player has qualified, they pick a driver for every car that still has none. Esc asks
 * again for the same car, so the four seats always end up filled.
 */
export function* chooseOpponents(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  drawCarFaces(fe);
  d.w16(0x0404, 0);
  for (;;) {
    const bx = CAR_RECORDS.find(rec => d.r16(rec + 0x13) === 0x0B);
    if (bx === undefined) { yield* pressAnyKey(fe); return; }
    d.w16(0x019E, bx);
    while ((yield* characterSelect(fe, 0x0227, 0xFFFF)) === undefined) { /* 1a7a: Esc asks again */ }
    d.w16(0x0404, bx);
  }
}

// ---------------------------------------------------------------- GAME OPTIONS (fn 2770)
/** 28ad/28b7: clear the two int 9 bytes and wait for a key to be pressed and let go. */
function* waitKey(d: DataSegment): Task<number> {
  d.w8(0x107F, 0);
  d.w8(0x107E, 0);
  do { yield 'tick'; } while (d.r8(0x107E) === 0);
  return d.r8(0x107E);
}

/**
 * fn 2770 from 27f0: the GAME OPTIONS screen. F1 and F2 pick each player's device, F3 the sound and F4 the
 * smoothness; Return starts the game and Esc leaves for DOS. Every other key is fed to the eight-scancode
 * sequence at [0f6b] (2 5 0 1 1 9 6 8): reaching the end sets the two cheat flags and puts a ! on the screen.
 * True when Esc asked to leave.
 */
export function* gameOptions(fe: FrontEnd): Task<boolean> {
  const d = fe.ds;
  d.w8(0x0EFF, 1);                                      // 27e0: SETTINGS.DAT is only read once
  d.w16(0x0F73, 0x0F6B);
  d.w8(0x0F63, 0);
  fe.rawKeys = true;                                    // the page must stop remapping keys while this is up
  try {
    for (;;) {                                          // 27f0: the whole screen
      drawOptions(fe);
      for (;;) {                                        // 284d: only the four values change from here
        drawOptionValues(fe);
        const al = yield* waitKey(d);
        if (al === 0x01) return true;                   // Esc: back to DOS
        if (al === 0x40) {                              // F6: the credits page, up until any key
          drawOptionsInfo(fe);
          yield* waitKey(d);
          break;
        }
        if (al === 0x41) {                              // F7 (fn 2ab5): calibrate the sticks, if any
          d.w8(0x0F63, 1);
          if (d.r16(0x2625) !== 0) { yield* calibrate(fe); break; }
        } else if (al === 0x3F) {                       // F5 (fn 92f0): REDEFINE KEYS
          d.w8(0x0F63, 1);
          yield* redefineKeys(fe);
          break;
        }
        d.w8(0x107F, 0); d.w8(0x107E, 0);
        const si = d.r16(0x0F73);                       // 28fe: the next scancode of the cheat sequence
        if (d.r8(si) === al) {
          d.w16(0x0F73, si + 1);
          if (si + 1 === 0x0F73) { d.w8(0x0F69, 1); d.w8(0x0F6A, 1); continue; }
        } else d.w16(0x0F73, 0x0F6B);

        let bl = d.r8(0x0F5F) - 1, bh = d.r8(0x0F61) - 1;   // 2924: zero-based device numbers
        let cl = d.r8(0x0F64), ch = d.r8(0x263A);
        if (al === 0x3B) {                              // F1: player 1, who may not have JOY 2 or the mouse
          d.w8(0x0F63, 1);
          for (let n = 0; n < 5; n++) {               // bounded: a hand-edited SETTINGS.DAT could rule out all five
            bl = (bl + 1) % 5;
            if (!((bl === 0 && d.r16(0x2625) === 0) || bl === 1 || bl === 2 || bl === bh)) break;
          }
        } else if (al === 0x3C) {                       // F2: player 2
          d.w8(0x0F63, 1);
          for (let n = 0; n < 5; n++) {
            bh = (bh + 1) % 5;
            if (!((bh === 2 && d.r16(0x2627) === 0) || (bh === 0 && d.r16(0x2625) === 0)
              || (bh === 1 && d.r16(0x2625) !== 2) || bh === bl)) break;
          }
        } else if (al === 0x3D) {                       // F3: sound; the original re-opens the device here
          d.w8(0x0F63, 1);
          for (let n = 0; n < 3; n++) {                 // 29ba, plus the page's own list of what it can play
            cl = (cl + 1) % 3;
            if (fe.soundDevices === undefined || fe.soundDevices.includes(cl)) break;
          }
          fe.soundDevice?.(cl);
        } else if (al === 0x3E) {                       // F4: smoothness, 1..5 (5 = AUTO)
          d.w8(0x0F63, 1);
          ch = ch + 1 > 5 ? 1 : ch + 1;
        } else if (al === 0x42 && fe.viewSize) {        // F8: the port's own line, not in SETTINGS.DAT
          fe.viewSize.next();
        } else if (al !== 0x1C) continue;               // anything else: wait for another key
        d.w16(0x0F5F, bl + 1); d.w16(0x0F61, bh + 1);
        d.w16(0x0F64, cl); d.w16(0x263A, ch);
        if (al !== 0x1C) continue;                      // 29ee: only Return leaves for the game
        d.w16(0x2658, bl + 1); d.w16(0x265A, bh + 1);   // 29f5: the two devices go to cars 0 and 1
        d.w16(0x265C, 6); d.w16(0x265E, 6);
        inputHandlers(d);
        if (d.r8(0x0F63) !== 0) fe.saveSettings?.(settingsBytes(d));    // 2a13: write SETTINGS.DAT back
        if ((d.r16(0x263A) & 0xFF) === 5) {             // 2a6e: AUTO times the machine and picks a rate
          autoSmoothness(fe);
          fe.clearScreen(0);
        }
        return false;
      }
    }
  } finally {
    fe.rawKeys = false;
  }
}

/**
 * fn 92f0 (F5 on GAME OPTIONS): REDEFINE KEYS. Ten keys, five per player (left, right, accelerate, brake,
 * select), collected into a scratch list at [ae73] and only copied over the int 9 table at [106c] once all
 * ten are in; Esc at any point leaves the old keys alone. Space and any key already taken are ignored,
 * which the original does by looping on [107e] without clearing it: the next key pressed replaces it.
 */
export function* redefineKeys(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  drawHeader(fe);
  for (let i = 0; i < 10; i++) d.w8(0xAE73 + i, 0);
  d.w8(0xAE3C, 1);
  let di = 0xAE73, cx = 0x63, y = 0x28;
  for (;;) {                                            // 9315: one key per pass
    cx++;
    if (cx >= 5) {                                      // 931c: a heading every five
      fe.textAt(d.r8(0xAE3C) === 1 ? 0xAE3D : 0xAE44, 0x0A, y, FONT2);
      d.w8(0xAE3C, d.r8(0xAE3C) + 1);
      y += 0x11;
      cx = 0;
    }
    fe.textFromList(0xAE4B, cx, 0x14, y, FONT1);        // 933b: LEFT, RIGHT, ACCELERATE, BRAKE, SELECT
    fe.present();
    d.w8(0x107E, 0); d.w8(0x107F, 0);
    let al: number;
    for (;;) {                                          // 9357
      al = d.r8(0x107E);
      if (al === 0x01) return;                          // Esc: keep the keys as they are
      let taken = al === 0 || al === 0x39;              // 9362: Space is never a driving key
      for (let i = 0; i < 10 && !taken; i++) taken = d.r8(0xAE73 + i) === al;
      if (!taken) break;
      yield 'tick';
    }
    d.w8(di, al);
    di++;
    let name = 0x3F;                                    // 937b: '?' unless the table at [adf0] names it
    for (let si = 0xADF0; d.r8(si) !== 0; si += 2) if (d.r8(si) === al) { name = d.r8(si + 1); break; }
    d.w8(0xAE3A, name);
    fe.textAt(0xAE3A, 0x6E, y, FONT1);
    y += 0x0A;
    if (di >= 0xAE7D) break;
  }
  for (let i = 0; i < 5; i++) d.w8(0x106C + i, d.r8(0xAE73 + i));          // 93ac: five each, skipping
  for (let i = 0; i < 5; i++) d.w8(0x1074 + i, d.r8(0xAE78 + i));          // the three keys 6 to 8
}

/** The game port as fn 2b93 reads it: the buttons the calibration screen waits on, pressed = 1. */
function stickButtons(fe: FrontEnd): number {
  return ~(fe.devices ? fe.devices.joysticks().port : 0xFF) & 0xFF;
}

/**
 * fn 2b93: blink PLACE JOYSTICK THEN PRESS FIRE until one of the buttons in `mask` goes down (or Return is
 * pressed), then read the axes. Any button already held at entry has to come up first.
 */
function* readStick(fe: FrontEnd, mask: number): Task<{ ax: number; ay: number; bx: number; by: number }> {
  const d = fe.ds;
  d.w8(0x107E, 0); d.w8(0x107F, 0);
  while (stickButtons(fe) & mask) yield 'tick';         // 2ba6
  for (;;) {                                            // 2bad
    d.w16(0x0194, FONT1); d.w16(0x0196, 0xB4); d.w16(0x019A, 0x0DF8);
    drawPrompt(fe);
    fe.present();
    if (stickButtons(fe) & mask) break;
    if (d.r8(0x107E) === 0x1C) break;
    yield 'tick';
  }
  return fe.devices ? fe.devices.joysticks() : STICK_CENTRED;
}

/**
 * fn 2ab5 (F7 on GAME OPTIONS, only offered when a joystick was found): centre, left and right for each
 * stick. Each threshold ends up halfway between the centre and that end, so a direction counts from half
 * deflection on. Only the X axis is calibrated, because fn 2e6c never uses the Y one.
 */
export function* calibrate(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  const half = (a: number, b: number): number => ((a + b) & 0xFFFF) >>> 1;
  drawHeader(fe);
  d.w8(0x0DF6, 0x31);                                   // the digit inside "JOYSTICK n"
  fe.textAt(0x0DED, 0x0A, 0x1E, FONT2);
  fe.textAt(0x0DD3, 0x0A, 0x2E, FONT2);                 // CENTRE
  const centre = yield* readStick(fe, 0x30);
  fe.textAt(0x0DDA, 0x0A, 0x3E, FONT2);                 // LEFT
  d.w16(0x28FD, half((yield* readStick(fe, 0x30)).ax, centre.ax));
  fe.textAt(0x0DDF, 0x0A, 0x4E, FONT2);                 // RIGHT
  d.w16(0x28FF, half((yield* readStick(fe, 0x30)).ax, centre.ax));
  if (d.rs16(0x2625) < 2) return;                       // 2b20: nothing to do without a second stick
  d.w8(0x0DF6, 0x32);
  fe.textAt(0x0DED, 0x6E, 0x1E, FONT2);
  fe.textAt(0x0DD3, 0x6E, 0x2E, FONT2);
  const centre2 = yield* readStick(fe, 0xC0);
  fe.textAt(0x0DDA, 0x6E, 0x3E, FONT2);
  d.w16(0x2905, half((yield* readStick(fe, 0xC0)).bx, centre2.bx));
  fe.textAt(0x0DDF, 0x6E, 0x4E, FONT2);
  d.w16(0x2907, half((yield* readStick(fe, 0xC0)).bx, centre2.bx));
}

/**
 * fn f99: a GAME?.LVL holds the championship tables. It is read in two pieces, 0x414 bytes over the race
 * list at [040a] and 0x3cc over the track data at [1feb].
 */
export function loadGameSet(d: DataSegment, data: Uint8Array): void {
  d.m.set(data.subarray(0, 0x414), 0x040A);
  d.m.set(data.subarray(0x414, 0x414 + 0x3CC), 0x1FEB);
}

/**
 * fn 2be8: PLAY WHICH GAME SET ?, the screen between GAME OPTIONS and the title. It lists every GAME?.LVL
 * on the disk by the name inside it, with the row under the cursor flashing through ten colours, and loads
 * the one picked. An install with no GAME?.LVL (which is every retail one) falls straight through.
 */
export function* chooseGameSet(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  d.w8(0x0156, 0);
  drawHeader(fe);
  fe.textCentred(0x0EE7, 0x20, FONT2);
  const sets = fe.gameSets ?? [];
  if (sets.length === 0) return;                        // 2c0e: findfirst failed
  d.w16(0x0EFD, 0x3C);
  let di = 0x0EDD;
  for (const set of sets) {                             // 2c1a: each one is loaded just to read its name
    d.w8(di, set.digit);
    if (set.digit === 0x31) d.w16(0x0D7B, di);
    di++;
    loadGameSet(d, set.data);
    fe.textAt(0x040A, 1, d.r16(0x0EFD), FONT1);
    d.add16(0x0EFD, 8);
  }
  d.w8(di, 0);
  fe.present();
  di = d.r16(0x0D7B);
  for (;;) {
    // 2c55: nothing may be held when a pass starts, so each direction counts once
    for (;;) { pollInput(d, undefined, fe.devices); if (d.r8(0x108B) === 0) break; yield 'tick'; }
    if (di < 0x0EDD) di = 0x0EDD;                       // 2c61: both ends of the list stick
    if (d.r8(di) === 0) di--;
    const y = ((di - 0x0EDD) << 3) + 0x3C;
    let dl = d.r8(0x0D70) + 1;                          // 2c8a: the highlight cycles through ten colours
    if (dl > 0x0A) dl = 1;
    d.w8(0x0D70, dl);
    if (d.r8(0x26CF) !== 1) fe.recolour(0, y, 8, 0x100, dl, 0);
    yield 'tick';                                       // 2ca5: fn 3165, one timer tick with it up
    fe.present();
    fe.recolour(0, y, 8, 0x100, 0, d.r8(0x0D70));
    pollInput(d, undefined, fe.devices);
    const al = d.r8(0x108B);
    if (al & 8) break;
    di--;
    if (al & 0x20) continue;
    if (al & 0x80) continue;
    di += 2;
    if (al & 0x10) continue;
    if (al & 0x40) continue;
    di--;
  }
  const digit = d.r8(di);                               // 2cf1: load the one picked, for good this time
  d.w8(0x088D, digit);
  const chosen = sets.find(set => set.digit === digit);
  if (chosen) loadGameSet(d, chosen.data);
}

/**
 * fn 3ad0: AUTO on the smoothness line times the machine by counting how many bursts of a thousand word
 * writes to VRAM fit in one visible field, and picks a frame rate from that. The page owns the clock and
 * runs the loop; without one the browser counts as the fastest class, which is what it is.
 */
export function autoSmoothness(fe: FrontEnd): void {
  const bursts = fe.speed ? fe.speed() : 0x18;
  fe.ds.w16(0x263A, bursts >= 0x18 ? 1 : bursts >= 0x14 ? 2 : bursts >= 0x0D ? 3 : 4);
}

/** fn 0032: the options screen, then the title and SELECT GAME until Esc walks back out of each. */
export function* frontEnd(fe: FrontEnd): Task<void> {
  const d = fe.ds;
  for (;;) {
    if (yield* gameOptions(fe)) return;               // 003c: Esc on the options screen leaves for DOS
    d.w8(0x107E, 0); d.w8(0x107F, 0); d.w16(0x1080, 0);
    yield* chooseGameSet(fe);                         // 004e: PLAY WHICH GAME SET ?
    for (;;) {
      d.w8(0x1096, 0);
      if (yield* title(fe)) break;                    // 0089: Esc at the title goes back to the options
      for (;;) {
        d.w8(0x1096, 0);
        if (yield* selectGame(fe)) break;
      }
    }
  }
}

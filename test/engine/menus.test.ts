/**
 * The front-end input loops (src/engine/menus.ts) against the same key script tools/gt_front.py fed to
 * DOSBox-X: start from the captured title screen, replay the presses tick by tick and check that the port
 * walks the same menus and lands on the same state and pixels the capture holds at each stop.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unpackPklite } from '../../src/data/pklite';
import { DataSegment } from '../../src/engine/memory';
import { applySettings, DS_IMAGE_OFFSET } from '../../src/engine/setup';
import { FrontEnd, newArena, loadFrontEndBanks, LOAD_SEG } from '../../src/engine/frontend';
import { viewSizeRow } from '../../src/engine/screens';
import { frontEnd, chooseOpponents, championshipBoard, verdict, elimination, champion, timerTick, pollInput,
  applyOptionsInputs, headToHead, headToHeadTwoPlayers, type Request, type Task } from '../../src/engine/menus';

const ROOT = process.cwd();
const DATA = process.env['MM_DATA_DIR'] ?? join(ROOT, 'MicroMac');
const GT = join(ROOT, 'build/golden/gt/front');
const have = existsSync(join(DATA, 'MICRO.EXE')) && existsSync(join(GT, 's01_gameset_vram.bin'));

const read = (n: string): Uint8Array => new Uint8Array(readFileSync(join(DATA, n)));
const gt = (n: string): Uint8Array => new Uint8Array(readFileSync(join(GT, n)));

describe.skipIf(!have)('front-end input loops', () => {
  const settingsPath = existsSync(join(ROOT, 'build/dos-work/SETTINGS.DAT')) ? join(ROOT, 'build/dos-work/SETTINGS.DAT') : join(DATA, 'SETTINGS.DAT');

  function boot(): FrontEnd {
    const { image: exe } = unpackPklite(read('MICRO.EXE'));
    const ds = new DataSegment(exe.subarray(DS_IMAGE_OFFSET, DS_IMAGE_OFFSET + 0x10000));
    applySettings(ds, new Uint8Array(readFileSync(settingsPath)));
    const mem = newArena();
    const parts: Uint8Array[] = [];
    for (let i = 0; i < 7; i++) parts.push(read(`COMPRESS.PI${i}`));
    loadFrontEndBanks(mem, parts, ds);
    applyOptionsInputs(ds);                      // the GAME OPTIONS screen hands the two devices over
    const fe = new FrontEnd(ds, mem);
    fe.bindAllRecords();
    return fe;
  }

  function seed(fe: FrontEnd, name: string): void {
    const cap = gt(name);
    const { relocs } = unpackPklite(read('MICRO.EXE'));
    fe.ds.m.set(cap, 0);
    for (const r of relocs) {
      const at = r.segment * 16 + r.offset - DS_IMAGE_OFFSET;
      if (at >= 0 && at + 1 < cap.length) fe.ds.w16(at, fe.ds.r16(at) - LOAD_SEG);
    }
    fe.bindAllRecords();
  }

  /** Drives the front end the way tools/gt_frame.py drives the game: poke, tick, poll, run to the next wait. */
  class Driver {
    done = false;
    championships = 0;
    races = 0;
    /** The page holds the generator here while the race loop runs. */
    racing = false;
    raceOver(): void { this.racing = false; }
    constructor(readonly fe: FrontEnd, private readonly task: Task<void> = frontEnd(fe)) {
      this.step();
    }
    private step(): void {
      for (;;) {
        const r = this.task.next();
        if (r.done) { this.done = true; return; }
        if (r.value === 'tick') return;
        if (r.value === 'race') { this.races++; this.racing = true; return; }   // fn 216c: the page runs the race
        this.championships++;                          // the race sequence is driven elsewhere
      }
    }
    /** One game tick with player 1's input byte held at `keys` ([107d], as gt_frame.hold pokes it). */
    tick(keys = 0, keys2 = 0): void {
      this.fe.ds.w8(0x107D, keys);
      this.fe.ds.w8(0x107C, keys2);
      timerTick(this.fe.ds);
      pollInput(this.fe.ds);
      if (!this.racing) this.step();
    }
    hold(keys: number, n: number): void { for (let i = 0; i < n; i++) this.tick(keys); }
    hold2(keys: number, n: number): void { for (let i = 0; i < n; i++) this.tick(0, keys); }
    release(n = 2): void { this.hold(0, n); }
    /** gt_frame.key: the scancode of a key that has been pressed and let go. */
    key(scancode: number): void { this.fe.ds.w8(0x107E, scancode); this.tick(); }
    frames(n: number): void { for (let i = 0; i < n; i++) this.tick(); }
  }

  /** The screens are drawn into a 256-wide window starting at x = 32 of the 320x200 mode. */
  function compareWindow(got: Uint8Array, want: Uint8Array, skipRows?: [number, number]): { bad: number; first: string } {
    let bad = 0, first = '';
    for (let y = 0; y < 200; y++) {
      if (skipRows && y >= skipRows[0] && y < skipRows[1]) continue;
      for (let x = 32; x < 288; x++) {
        const i = y * 320 + x;
        if (got[i] !== want[i]) {
          bad++;
          if (!first) first = `x=${x - 32} y=${y} got ${got[i]!.toString(16)} want ${want[i]!.toString(16)}`;
        }
      }
    }
    return { bad, first };
  }

  it('draws GAME OPTIONS like the capture and takes the cheat code', () => {
    const fe = boot();
    seed(fe, 's00_options_ds.bin');
    const d = fe.ds;
    const g = new Driver(fe);
    expect(compareWindow(fe.vram, gt('s00_options_vram.bin')).bad).toBe(0);
    expect(d.r8(0x0F69)).toBe(0);

    for (const code of [0x03, 0x06, 0x0B, 0x02, 0x02, 0x0A, 0x07, 0x09]) { g.key(code); g.frames(2); }
    expect(d.r8(0x0F69)).toBe(1);                       // 2 5 0 1 1 9 6 8
    expect(d.r8(0x0F6A)).toBe(1);
    expect(d.r16(0x0F73)).toBe(0x0F73);

    g.key(0x3E); g.frames(2);                           // F4 steps the smoothness
    expect(d.r16(0x263A)).toBe(3);

    d.w16(0x0F64, 1);                                   // F3 steps the sound: NONE, BLASTER, SPEAKER
    g.key(0x3D); g.frames(2);
    expect(d.r16(0x0F64)).toBe(2);
    fe.soundDevices = [0, 1];                           // ... unless the page says it cannot play one
    d.w16(0x0F64, 1);
    g.key(0x3D); g.frames(2);
    expect(d.r16(0x0F64)).toBe(0);
    delete fe.soundDevices;
    g.key(0x1C); g.frames(2);                           // Return hands the two devices to cars 0 and 1
    expect(d.r16(0x2658)).toBe(d.r16(0x0F5F));
    expect(d.r16(0x265C)).toBe(6);
  });

  it('F5 collects ten keys and F7 calibrates the stick', () => {
    const fe = boot();
    seed(fe, 's00_options_ds.bin');
    const d = fe.ds;
    const g = new Driver(fe);

    g.key(0x3F); g.frames(2);                           // F5: REDEFINE KEYS
    const wanted = [0x1E, 0x20, 0x11, 0x1F, 0x2C, 0x4B, 0x4D, 0x48, 0x50, 0x52];
    g.key(0x39); g.frames(2);                           // Space is never a driving key
    expect(d.r8(0xAE73)).toBe(0);
    g.key(wanted[0]!); g.frames(2);
    g.key(wanted[0]!); g.frames(2);                     // nor is one already taken
    expect(d.r8(0xAE74)).toBe(0);
    for (const k of wanted.slice(1)) { g.key(k); g.frames(2); }
    expect([...d.m.subarray(0x106C, 0x1071)]).toEqual(wanted.slice(0, 5));
    expect([...d.m.subarray(0x1074, 0x1079)]).toEqual(wanted.slice(5));

    // fn 2ab5: centre, left and right, each read when a button goes down. The thresholds end up halfway
    // between the centre and each end, which is exactly where they started.
    let stick = { ax: 105, port: 0xFF };
    fe.devices = {
      joysticks: () => ({ ...stick, ay: 0, bx: 0, by: 0 }),
      mouse: () => ({ buttons: 0, x: 0xA0, y: 0x64 }),
      warpMouse: (): void => {},
    };
    d.w16(0x2625, 1);
    g.key(0x41); g.frames(2);                           // F7
    for (const ax of [105, -85, 295]) {
      stick = { ax, port: 0xFF };
      g.frames(2);
      stick = { ax, port: 0xFF & ~0x10 };               // the button that ends each reading
      g.frames(2);
    }
    expect(d.r16(0x28FD)).toBe(10);
    expect(d.r16(0x28FF)).toBe(200);
  });

  it('PLAY WHICH GAME SET ? lists the sets and loads the one picked', () => {
    const fe = boot();
    seed(fe, 's00_options_ds.bin');
    const d = fe.ds;
    const set = (digit: number, name: string): { digit: number; data: Uint8Array } => {
      const data = new Uint8Array(0x7E0);
      for (let i = 0; i < name.length; i++) data[i] = name.charCodeAt(i);
      data[0x414] = digit;                              // the first byte of the track half, to tell them apart
      return { digit, data };
    };
    fe.gameSets = [set(0x31, 'THE ORIGINAL'), set(0x32, 'SOMEBODY ELSE')];
    const g = new Driver(fe);
    g.key(0x1C); g.frames(2);                           // Return on GAME OPTIONS opens the game sets
    expect(d.r16(0x0D7B)).toBe(0x0EDD);                 // GAME1.LVL is where the cursor starts
    expect(d.r8(0x0EDD)).toBe(0x31);
    expect(d.r8(0x0EDE)).toBe(0x32);
    expect(d.r8(0x0EDF)).toBe(0);

    g.release(4);                                       // each move needs a press of its own
    g.hold(0x40, 4);                                    // right moves down the list
    g.release(4);
    g.hold(0x08, 4);                                    // fire picks it
    expect(d.r8(0x088D)).toBe(0x32);
    expect(d.r8(0x1FEB)).toBe(0x32);                    // and the set is loaded over the race tables
    expect(String.fromCharCode(...d.m.subarray(0x040A, 0x0417))).toBe('SOMEBODY ELSE');
  });

  it('a wrong key starts the cheat code over', () => {
    const fe = boot();
    seed(fe, 's00_options_ds.bin');
    const d = fe.ds;
    const g = new Driver(fe);
    for (const code of [0x03, 0x06, 0x0B, 0x02, 0x04]) { g.key(code); g.frames(2); }   // 2 5 0 1 3
    expect(d.r16(0x0F73)).toBe(0x0F6B);
    for (const code of [0x03, 0x06, 0x0B, 0x02, 0x02, 0x0A, 0x07, 0x09]) { g.key(code); g.frames(2); }
    expect(d.r8(0x0F69)).toBe(1);
  });

  it('walks the title, both menus and the character select like the capture', () => {
    const fe = boot();
    seed(fe, 's01_gameset_ds.bin');                     // the capture labels are one screen behind: this is the title
    const d = fe.ds;
    const g = new Driver(fe);

    // fn 0032 starts on GAME OPTIONS; Return there goes through fn 2be8 (no GAME?.LVL here) to the title
    expect(d.r16(0x0F73)).toBe(0x0F6B);
    g.key(0x1C); g.frames(2);
    expect(d.r16(0x2658)).toBe(4); expect(d.r16(0x265A)).toBe(5);
    expect(compareWindow(fe.vram, gt('s01_gameset_vram.bin')).bad).toBe(0);

    g.key(0x1C); g.frames(20);                          // Return at the title opens SELECT GAME
    expect(d.r8(0x0156)).toBe(0);
    expect(compareWindow(fe.vram, gt('s02_title_vram.bin')).bad).toBe(0);

    g.frames(40);
    g.hold(0x80, 3); g.release(3);                      // left = one player
    g.hold(0x08, 3); g.release(3); g.frames(15);
    expect(d.r16(0x0130)).toBe(1);
    expect(compareWindow(fe.vram, gt('s04_selectgame_vram.bin')).bad).toBe(0);

    g.hold(0x40, 3); g.release(3);                      // right = Challenge
    g.hold(0x08, 3); g.release(3); g.frames(15);
    expect(d.r16(0x0132)).toBe(2);
    expect(d.r8(0x0156)).toBe(2);
    expect(d.r16(0x2656)).toBe(1);
    expect(d.r16(0x019E)).toBe(0x0C03);                 // player 1 is picking a character
    expect(d.r16(0x0192)).toBe(gt('s06_submenu_ds.bin')[0x0192]! | (gt('s06_submenu_ds.bin')[0x0193]! << 8));
    // the prompt line blinks every 32 ticks; the capture counts the ticks the real game spent drawing, so
    // its phase is a few ticks ahead of the port's and rows 0x62..0x69 are left out of the comparison
    expect(compareWindow(fe.vram, gt('s06_submenu_vram.bin'), [0x62, 0x6A]).bad).toBe(0);
  });

  it('fn 1a4a asks for a driver for every car that has none', () => {
    const fe = boot();
    seed(fe, 's06_submenu_ds.bin');
    const d = fe.ds;
    d.w16(0x2656, 1);                                   // one-player Challenge: no control-method prompt
    d.w16(0x0C03 + 0x13, 3);                            // the player is character 3, already taken
    d.w8(0x0164 + 3, 0x43);
    for (const rec of [0x0C1E, 0x0C39, 0x0C54]) d.w16(rec + 0x13, 0x0B);
    for (const word of [0x266A, 0x266C, 0x266E]) d.w16(word, 6);

    const g = new Driver(fe, chooseOpponents(fe));
    for (let n = 0; n < 3; n++) {                       // fire picks whatever face the carousel stopped on
      g.release(4);
      g.hold(0x08, 3); g.release(3);
      g.frames(120);                                    // five flashes, 0x10 ticks apart
    }
    expect(g.done).toBe(false);                         // fn 0c15 is waiting for a key
    const chosen = [0x0C1E, 0x0C39, 0x0C54].map(rec => d.r16(rec + 0x13));
    expect(chosen.every(c => c <= 0x0A)).toBe(true);
    expect(new Set([...chosen, 3]).size).toBe(4);       // four different drivers
    expect([0x266A, 0x266C, 0x266E].map(w => d.r16(w))).toEqual(chosen);

    g.key(0x1C);
    expect(g.done).toBe(true);
  });

  it('scrolls the carousel and takes the face in the middle', () => {
    const fe = boot();
    seed(fe, 's06_submenu_ds.bin');                     // the character select, with the carousel at rest
    const d = fe.ds;
    const before = d.r16(0x0192);
    const g = new Driver(fe);
    // the driver starts on GAME OPTIONS, so walk back down to the character select
    g.key(0x1C); g.frames(2);
    g.key(0x1C); g.frames(20);
    g.hold(0x80, 3); g.release(3); g.hold(0x08, 3); g.release(3); g.frames(15);
    g.hold(0x40, 3); g.release(3); g.hold(0x08, 3); g.release(3); g.frames(15);
    expect(d.r16(0x0192)).toBe(before);

    const middle = d.r16(0x0160);
    g.hold(0x40, 3); g.release(6); g.frames(10);        // one slot to the right, 13 ticks of ramp
    expect(d.r16(0x0192)).toBe((before - 0x40 + 0x2C0) % 0x2C0);
    expect(d.r16(0x0160)).not.toBe(middle);

    const taken = d.r16(0x0160);
    g.hold(0x08, 3); g.release(3); g.frames(100);       // fire: five flashes, then PRESS ANY KEY
    expect(d.r16(0x2668)).toBe(taken);
    expect(d.r16(0x03F4)).toBe(taken);
    expect(d.r8(0x0164 + taken) & 0x40).toBe(0x40);     // the face is marked taken on the carousel
    expect(g.championships).toBe(0);

    g.key(0x1C);                                        // any key leaves PRESS ANY KEY for the championship
    expect(g.championships).toBe(1);
    expect(d.r16(0x266A)).toBe(6);
  });

  it('one-player head to head picks a driver and a rival, then the championship', () => {
    const fe = boot();
    seed(fe, 's06_submenu_ds.bin');
    const d = fe.ds;
    const g = new Driver(fe, headToHead(fe));
    expect(d.r16(0x2656)).toBe(2);
    expect(d.r8(0x03F8)).toBe(1);
    expect(d.r16(0x265A)).toBe(6);                      // the rival is a computer driver

    g.release(4); g.hold(0x08, 3); g.release(3); g.frames(120);   // fire takes the face in the middle
    const player = d.r16(0x0C03 + 0x13);
    expect(player).toBeLessThanOrEqual(0x0A);
    expect(d.r16(0x2668)).toBe(player);                 // no handicap prompt with only one human
    expect(d.r16(0x019E)).toBe(0x0C1E);                 // now the rival

    g.release(4); g.hold(0x08, 3); g.release(3); g.frames(120);
    const rival = d.r16(0x0C1E + 0x13);
    expect(rival).toBeLessThanOrEqual(0x0A);
    expect(rival).not.toBe(player);
    expect(g.championships).toBe(0);

    g.key(0x1C);                                        // PRESS ANY KEY hands over to fn 10a0
    expect(g.championships).toBe(1);
  });

  it('two players each pick a driver and land on CHOOSE GAME', () => {
    const fe = boot();
    seed(fe, 's06_submenu_ds.bin');
    const d = fe.ds;
    const g = new Driver(fe, headToHeadTwoPlayers(fe));
    expect(d.r16(0x2656)).toBe(2);
    expect(d.r8(0x03F8)).toBe(1);
    expect(d.r16(0x265A)).toBe(d.r16(0x0F61));          // the second configured device drives car 1
    expect(d.r16(0x1080)).toBe(0x137B);                 // the carousel follows player 1

    g.release(4);
    for (let n = 0; n < 12 && d.r16(0x0160) > 2; n++) { g.hold(0x40, 3); g.release(6); g.frames(4); }
    const slot = d.r16(0x0160);
    expect(slot).toBeLessThanOrEqual(2);                // stop on one of the three that can be handicapped
    g.hold(0x08, 3); g.release(3); g.frames(120);
    g.hold(0x40, 2); g.release(2);                      // left = YES on HANDICAP <name> ?
    g.hold(0x08, 3); g.release(3);
    const one = d.r16(0x0C03 + 0x13);
    expect(one).toBe(slot);
    expect(d.r8(0x01D6 + one)).toBe(0x80);
    expect(d.r16(0x2668)).toBe(one | 0x80);
    expect(d.r16(0x1080)).toBe(0x14DF);                 // player 2's turn, on their own keys

    g.hold2(0, 4); g.hold2(0x08, 3); g.hold2(0, 3); g.frames(120);
    const two = d.r16(0x0C1E + 0x13);
    expect(two).toBeLessThanOrEqual(0x0A);
    expect(two).not.toBe(one);
    expect(g.done).toBe(false);                         // CHOOSE GAME! is waiting
    expect(g.races).toBe(0);

    g.hold(0x80, 3); g.release(3);                      // left = TOURNAMENT
    g.hold(0x08, 3); g.release(3);
    expect(d.r8(0x08A5)).toBe(1);
    expect(d.r8(0x28C1)).toBe(1);
    expect(d.r8(0x28BF)).toBeGreaterThanOrEqual(1);
    expect(d.r8(0x28BF)).toBeLessThanOrEqual(8);
    expect([1, 2, 3]).toContain(d.r8(0x28C0));
    g.frames(60);                                       // the two cars close in on the vehicle picture
    g.release(4); g.hold(0x08, 4);
    expect(g.races).toBe(1);                            // fn 216c: the page is asked for the race

    d.w16(0x03FC, 0x0C1E); d.w16(0x03FE, 0x0C03);       // fn 11d5: player 2 won this one
    const wonBefore = d.r8(0x09A4 + two), lostBefore = d.r8(0x09AF + (one & 0x0F));
    g.raceOver();
    g.frames(60);                                        // the miniature cars drive back to the middle
    expect(d.r8(0x098C)).toBe(1);                        // player 2's score
    expect(d.r8(0x098A)).toBe(0);
    expect(d.r8(0x09A4 + two)).toBe(wonBefore + 1);      // and their lifetime record
    expect(d.r8(0x09AF + (one & 0x0F))).toBe(lostBefore + 1);
    expect(g.races).toBe(1);

    g.key(0x1C); g.frames(40);                           // a key leaves the results for the next track
    expect(d.r8(0x28C1)).toBe(2);
    expect(g.races).toBe(1);
    g.release(4); g.hold(0x08, 4);                       // fn 179b: fire starts the next one
    expect(g.races).toBe(2);
  });

  it('the verdict takes a life off the player and puts the new count up', () => {
    const fe = boot();
    seed(fe, 's06_submenu_ds.bin');
    const d = fe.ds;
    d.w8(0x0406, 3);
    d.w8(0x03F8, 0);
    d.w16(0x0C03 + 0x13, 3);
    const g = new Driver(fe, verdict(fe, 2));
    g.frames(400);                                      // the old count slides out of the way
    expect(d.r8(0x0406)).toBe(2);
    expect(g.done).toBe(false);                         // still waiting for a key
    g.key(0x1C);
    g.frames(10);
    expect(g.done).toBe(true);
  });

  it('F8 offers the race view size, and only when the page asks for it', () => {
    const fe = boot();
    seed(fe, 's00_options_ds.bin');
    const d = fe.ds;
    d.w16(0x2625, 0);                                   // no joystick, so F8 lands on F7's row
    // with no hook the screen is the original's, to the pixel
    const plain = new Driver(fe);
    expect(compareWindow(fe.vram, gt('s00_options_vram.bin')).bad).toBe(0);
    plain.key(0x42);                                    // and F8 does nothing at all
    expect(compareWindow(fe.vram, gt('s00_options_vram.bin')).bad).toBe(0);

    const sizes = ['256X200', '320X200', '384X224'];
    let at = 0;
    const fe2 = boot();
    seed(fe2, 's00_options_ds.bin');
    fe2.ds.w16(0x2625, 0);
    fe2.viewSize = { get label(): string { return sizes[at]!; }, next: () => { at = (at + 1) % sizes.length; } };
    const g = new Driver(fe2);
    const row = viewSizeRow(fe2.ds);
    const ink = (): number => {                         // pixels on the row the port's line occupies
      let n = 0;
      for (let y = row; y < row + 12; y++) for (let x = 32; x < 288; x++) if (fe2.vram[y * 320 + x] !== 0) n++;
      return n;
    };
    expect(ink()).toBeGreaterThan(0);                   // F8 SCREEN SIZE 256X200 is on screen
    expect(compareWindow(fe2.vram, gt('s00_options_vram.bin')).bad).toBeGreaterThan(0);
    g.key(0x42);
    expect(at).toBe(1);
    g.key(0x42);
    expect(at).toBe(2);
    expect(g.done).toBe(false);                         // and it has not left the screen
    // everything below the line is still the original's: the footer is not painted over
    let bad = 0;
    for (let y = row + 12; y < 200; y++) for (let x = 32; x < 288; x++) if (fe2.vram[y * 320 + x] !== gt('s00_options_vram.bin')[y * 320 + x]) bad++;
    expect(bad).toBe(0);
  });

  it('the championship board draws one car per race run', () => {
    const fe = boot();
    seed(fe, 's06_submenu_ds.bin');
    const d = fe.ds;
    d.w8(0x28C1, 6);
    d.w8(0x043A, 1);
    d.w8(0x28BF, 2);
    const g = new Driver(fe, championshipBoard(fe));
    expect(fe.vram.some(v => v !== 0)).toBe(true);      // the case and the cars are on screen
    g.frames(30);
    expect(g.done).toBe(false);                         // it blinks until a key or 0x2bc ticks
    g.key(0x1C);
    g.frames(40);
    expect(g.done).toBe(true);
  });

  it('an eliminated driver is marked as gone and a replacement is picked', () => {
    const fe = boot();
    seed(fe, 's06_submenu_ds.bin');
    const d = fe.ds;
    d.w16(0x2656, 1);
    d.w16(0x0C03 + 0x13, 3); d.w8(0x0164 + 3, 0x43);
    d.w16(0x0C1E + 0x13, 5); d.w8(0x0164 + 5, 0x45);
    for (const rec of [0x0C39, 0x0C54]) d.w16(rec + 0x13, 0x0B);
    const g = new Driver(fe, elimination(fe, 0x0C1E));
    // fn 174a measures every step of the drop from the seat, never from the step before. Accumulating them
    // instead walks the face off the bottom of the screen, and the row count it then cuts by the step
    // underflows to a byte near 0xff, so the blit writes thousands of rows through the buffer and the save
    // segments behind it: that is what wrecked the banner here and the carousel's frame on the next screen.
    const ys: number[] = [], rows: number[] = [];
    for (let i = 0; i < 200; i++) { g.frames(1); ys.push(d.r16(0x0C1E + 0x04)); rows.push(d.r8(0x0C1E + 0x19)); }
    expect(Math.max(...ys) - Math.min(...ys)).toBe(0x2F);   // the deepest step in the table at [034b]
    expect(ys[ys.length - 1]).toBe(Math.min(...ys));        // and it is back on the seat at the end
    expect(Math.max(...rows)).toBeLessThanOrEqual(d.r16(0x0C1E + 0x0F));
    expect(d.r8(0x0164 + 5) & 0x20).toBe(0x20);         // character 5 is out for good
    g.hold(0x08, 3); g.release(3); g.frames(30);        // the fire press fn 179b waits for
    for (let n = 0; n < 3; n++) {                       // then fn 1a4a asks for the empty seats
      g.release(4); g.hold(0x08, 3); g.release(3); g.frames(120);
    }
    expect(d.r16(0x0C1E + 0x13) & 0x0F).not.toBe(5);    // somebody else is driving that car
    expect(d.r16(0x0C39 + 0x13)).toBeLessThan(0x0B);
  });

  it('the champion screen slides the trophy, the title and the name together', () => {
    const fe = boot();
    seed(fe, 's06_submenu_ds.bin');
    const d = fe.ds;
    d.w16(0x0C03 + 0x13, 3);
    const g = new Driver(fe, champion(fe, 0x0C03));
    g.frames(60);
    expect(d.r16(0x03AA)).toBeGreaterThan(0xFF50);      // the title is on its way in
    g.frames(300);
    expect(d.r16(0x03AA)).toBe(0x28);                   // both have arrived
    expect(d.r16(0x03AC)).toBe(0x68);
    expect(fe.vram.some(v => v !== 0)).toBe(true);
    expect(g.done).toBe(false);
    g.hold(0x08, 2);
    expect(g.done).toBe(true);
  });
});

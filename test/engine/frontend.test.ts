/**
 * Front-end screens vs DOSBox-X captures (build/golden/gt/front, produced by tools/gt_front.py).
 * Each case builds the data segment from MICRO.EXE, loads the COMPRESS.PI banks, draws one screen and
 * compares the 256x200 visible area of VRAM with the capture. Needs the local game folder and the dumps.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unpackPklite } from '../../src/data/pklite';
import { DataSegment } from '../../src/engine/memory';
import { applySettings, DS_IMAGE_OFFSET } from '../../src/engine/setup';
import { FrontEnd, newArena, loadFrontEndBanks, LOAD_SEG } from '../../src/engine/frontend';
import { drawOptions, drawTitle, drawSelectGame, drawOnePlayerMenu, drawMenuCursor, drawCharacterStrip, drawCharacterSelect, drawVerdict, flashVerdictFace, drawResultsBoard, animateResults, drawFace, drawPreRace, animatePreRace } from '../../src/engine/screens';

const ROOT = process.cwd();
const DATA = process.env['MM_DATA_DIR'] ?? join(ROOT, 'MicroMac');
const GT = join(ROOT, 'build/golden/gt/front');
const have = existsSync(join(DATA, 'MICRO.EXE')) && existsSync(join(GT, 's00_options_vram.bin'));

const read = (n: string): Uint8Array => new Uint8Array(readFileSync(join(DATA, n)));
const gt = (n: string): Uint8Array => new Uint8Array(readFileSync(join(GT, n)));

/** The screens are drawn into a 256-wide window starting at x = 32 of the 320x200 mode. */
function compareWindow(got: Uint8Array, want: Uint8Array): { bad: number; first: string } {
  let bad = 0, first = '';
  for (let y = 0; y < 200; y++) {
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

describe.skipIf(!have)('front-end screens', () => {
  const settingsPath = existsSync(join(ROOT, 'build/dos-work/SETTINGS.DAT')) ? join(ROOT, 'build/dos-work/SETTINGS.DAT') : join(DATA, 'SETTINGS.DAT');

  /** fn 26c0 + the start of fn 2770: data segment, banks and object records as the first screen finds them. */
  function boot(): FrontEnd {
    const { image: exe } = unpackPklite(read('MICRO.EXE'));
    const ds = new DataSegment(exe.subarray(DS_IMAGE_OFFSET, DS_IMAGE_OFFSET + 0x10000));
    applySettings(ds, new Uint8Array(readFileSync(settingsPath)));
    const mem = newArena();
    const parts: Uint8Array[] = [];
    for (let i = 0; i < 7; i++) parts.push(read(`COMPRESS.PI${i}`));
    loadFrontEndBanks(mem, parts, ds);
    const fe = new FrontEnd(ds, mem);
    fe.bindAllRecords();
    return fe;
  }

  /** Data-segment words DOS fixes up at load time hold absolute segments in the capture and relative ones here. */
  function relocatedWords(): Set<number> {
    const { relocs } = unpackPklite(read('MICRO.EXE'));
    const out = new Set<number>();
    for (const r of relocs) {
      const at = r.segment * 16 + r.offset - DS_IMAGE_OFFSET;
      if (at >= 0 && at + 1 < 0x10000) { out.add(at); out.add(at + 1); }
    }
    // record +8 holds the source segment copied from the (relocated) image header
    for (let bx = 0x0B7C; bx < 0x0D62; bx += 0x1B) { out.add(bx + 8); out.add(bx + 9); }
    return out;
  }

  it('data segment matches the capture at the options screen', () => {
    const fe = boot();
    drawOptions(fe);
    const want = gt('s00_options_ds.bin');
    const skip = relocatedWords();
    const diffs: string[] = [];
    for (let i = 0x10; i < want.length; i++) {                  // 0x00..0x0F: int 8 counters and the saved video mode
      if (skip.has(i)) continue;
      if (fe.ds.m[i] !== want[i]) diffs.push(`${i.toString(16).padStart(4, '0')}: got ${fe.ds.m[i]!.toString(16)} want ${want[i]!.toString(16)}`);
    }
    if (diffs.length) writeFileSync(join(ROOT, 'build/golden/gt/front/ds_diff.txt'), diffs.join('\n'));
    expect(diffs.slice(0, 40)).toEqual([]);
  });

  /** Overlay a captured data segment, undoing the load-time relocation so segments stay arena-relative. */
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

  it('title screen is pixel exact', () => {
    const fe = boot();
    seed(fe, 's01_gameset_ds.bin');
    drawTitle(fe);
    const { bad, first } = compareWindow(fe.vram, gt('s01_gameset_vram.bin'));
    expect(`${bad} ${first}`.trim()).toBe('0');
  });

  it('SELECT GAME screen is pixel exact', () => {
    const fe = boot();
    seed(fe, 's02_title_ds.bin');
    drawSelectGame(fe);
    drawMenuCursor(fe, fe.ds.r16(0x0130), 0x80);
    const { bad, first } = compareWindow(fe.vram, gt('s02_title_vram.bin'));
    expect(`${bad} ${first}`.trim()).toBe('0');
  });

  it('one-player menu is pixel exact', () => {
    const fe = boot();
    seed(fe, 's04_selectgame_ds.bin');
    drawOnePlayerMenu(fe);
    drawMenuCursor(fe, fe.ds.r16(0x0132), 0x6E);
    const { bad, first } = compareWindow(fe.vram, gt('s04_selectgame_vram.bin'));
    expect(`${bad} ${first}`.trim()).toBe('0');
  });

  for (const name of ['s06_submenu', 's07_charselect', 's08_charselect_r']) {
    it(`character select (${name}) is pixel exact`, () => {
      const fe = boot();
      seed(fe, `${name}_ds.bin`);
      drawCharacterSelect(fe);
      const { bad, first } = compareWindow(fe.vram, gt(`${name}_vram.bin`));
      expect(`${bad} ${first}`.trim()).toBe('0');
    });
  }

  const RES = join(ROOT, 'build/golden/gt/results');
  const haveResults = existsSync(join(RES, 'e264_vram.bin'));

  it.skipIf(!haveResults)('failed-to-qualify screen is pixel exact', () => {
    const fe = boot();
    const cap = new Uint8Array(readFileSync(join(RES, 'e264_ds.bin')));
    const { relocs } = unpackPklite(read('MICRO.EXE'));
    fe.ds.m.set(cap, 0);
    for (const r of relocs) {
      const at = r.segment * 16 + r.offset - DS_IMAGE_OFFSET;
      if (at >= 0 && at + 1 < cap.length) fe.ds.w16(at, fe.ds.r16(at) - LOAD_SEG);
    }
    fe.bindAllRecords();
    const flashed = fe.ds.r16(0x0C16);
    drawVerdict(fe, 0);
    fe.ds.w16(0x0C16, flashed ^ 0x10);
    flashVerdictFace(fe);
    const want = new Uint8Array(readFileSync(join(RES, 'e264_vram.bin')));
    const { bad, first } = compareWindow(fe.vram, want);
    expect(`${bad} ${first}`.trim()).toBe('0');
  });

  const BOARD = join(ROOT, 'build/golden/gt/board');

  /** Overlay a captured data segment from any dump directory, undoing the load-time relocation. */
  function seedFrom(fe: FrontEnd, dir: string, name: string): void {
    const cap = new Uint8Array(readFileSync(join(dir, name)));
    const { relocs } = unpackPklite(read('MICRO.EXE'));
    fe.ds.m.set(cap, 0);
    for (const r of relocs) {
      const at = r.segment * 16 + r.offset - DS_IMAGE_OFFSET;
      if (at >= 0 && at + 1 < cap.length) fe.ds.w16(at, fe.ds.r16(at) - LOAD_SEG);
    }
    fe.bindAllRecords();
  }

  it.skipIf(!existsSync(join(BOARD, 'prerace_vram.bin')))('pre-race card is pixel exact', () => {
    const fe = boot();
    seedFrom(fe, BOARD, 'prerace_ds.bin');
    drawPreRace(fe);
    animatePreRace(fe);
    const want = new Uint8Array(readFileSync(join(BOARD, 'prerace_vram.bin')));
    const { bad, first } = compareWindow(fe.vram, want);
    expect(`${bad} ${first}`.trim()).toBe('0');
  });

  /** The last capture in which the board has finished animating (mini 0 parked at x = 6). */
  function settledBoardDump(): string | undefined {
    if (!existsSync(BOARD)) return undefined;
    const names = readdirSync(BOARD).filter(n => /^b\d+_ds\.bin$/.test(n)).sort();
    let found: string | undefined;
    for (const n of names) {
      const d = new Uint8Array(readFileSync(join(BOARD, n)));
      if ((d[0x0CDD]! | (d[0x0CDE]! << 8)) === 6) found = n.replace('_ds.bin', '');
    }
    return found;
  }
  const boardDump = process.env['MM_BOARD'] ?? settledBoardDump();
  const haveBoard = boardDump !== undefined && existsSync(join(BOARD, `${boardDump}_vram.bin`));

  it.skipIf(!haveBoard)('results board is pixel exact', () => {
    const fe = boot();
    const cap = new Uint8Array(readFileSync(join(BOARD, `${boardDump}_ds.bin`)));
    const { relocs } = unpackPklite(read('MICRO.EXE'));
    fe.ds.m.set(cap, 0);
    for (const r of relocs) {
      const at = r.segment * 16 + r.offset - DS_IMAGE_OFFSET;
      if (at >= 0 && at + 1 < cap.length) fe.ds.w16(at, fe.ds.r16(at) - LOAD_SEG);
    }
    fe.bindAllRecords();
    const flashed = [0, 1, 2, 3].map(i => fe.ds.r16(0x0C03 + i * 0x1B + 0x13));
    drawResultsBoard(fe);
    animateResults(fe);
    for (let i = 0; i < 4; i++) fe.ds.w16(0x0C03 + i * 0x1B + 0x13, flashed[i]!);
    for (let bx = 0x0C03; bx <= 0x0C54; bx += 0x1B) drawFace(fe, bx);
    fe.present();
    const want = new Uint8Array(readFileSync(join(BOARD, `${boardDump}_vram.bin`)));
    const { bad, first } = compareWindow(fe.vram, want);
    expect(`${bad} ${first}`.trim()).toBe('0');
  });

  it('GAME OPTIONS screen is pixel exact', () => {
    const fe = boot();
    drawOptions(fe);
    const { bad, first } = compareWindow(fe.vram, gt('s00_options_vram.bin'));
    expect(`${bad} ${first}`.trim()).toBe('0');
  });
});

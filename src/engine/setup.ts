/**
 * Race setup: builds the data segment (DS = 093C) and the off-segment assets for one race from the game files
 * alone, the way the original does between the menu and the race loop:
 *
 *   caller (11a2 / 216c): [1082] = 1
 *   fn 3039 prologue: fn 37fc = [2630] = 0, [263a] >= 1, fn 319f, car colours, fn 3b50 (BRK/LEV + name patching),
 *     fn 3c09 (globals, STRT_POS/CHEATS/MAP, car structs, CT expansion, fn 2d00), fn 458b (COL/DIR), fn 482f (PH0),
 *     fn 4611 (VH0), fn 45e5 (PR banks + tile 0 copy), priority flags, fn 4758 (PAL), fn 32ce;
 *     then [2621] = -1 and [2638] = [263a].
 *
 * The static part of the segment is the initialised data of MICRO.EXE (image offset 0x93C0) after SETTINGS.DAT has
 * been applied (fn 2770). Everything the menus write is passed in as RaceParams.
 */
import { DataSegment } from './memory';
import { lzDecode } from '../data/lzcodec';
import { decodeBlocks, expandMap } from '../data/blocks';
import { decodeVehicle, frameTableBytes } from '../data/sprites';
import { applyPriorityFlags } from './render';
import { CARS } from './race';

export const DS_IMAGE_OFFSET = 0x93C0;
export { CARS };

export interface RaceParams {
  round: number;                 // [28bf] 1..9
  track: number;                 // [28c0] 1..3
  /** [28c1]: challenge track index (0 = first track of the challenge); tunes the AI parameters. */
  challengeIndex: number;
  /** [2656]: 1 = single player (challenge), 2 = head to head. */
  mode: number;
  /** [2658..265e]: input source per car (4 keys 1, 5 keys 2, 6 AI, 1/2 joystick, 3 mouse). */
  inputs: [number, number, number, number];
  /** [2668..266e]: character chosen for each car (index into the AI skill table at ds:23dc). */
  characters: [number, number, number, number];
}

/** Bytes of the files one race needs; names are relative to the game folder. */
export interface RaceFiles {
  exe: Uint8Array;               // unpacked MICRO.EXE load image
  settings?: Uint8Array | undefined;   // SETTINGS.DAT (32 bytes); absent = defaults from the executable
  brk?: Uint8Array | undefined; lev?: Uint8Array | undefined; strtPos: Uint8Array; cheats: Uint8Array; map: Uint8Array;
  ct: Uint8Array; col: Uint8Array; dir: Uint8Array; pal: Uint8Array;
  ph0: Uint8Array; vh0: Uint8Array; pr: Uint8Array[];
}

export interface RaceAssets {
  ds: DataSegment;
  mapWords: Uint16Array;
  banks: Uint8Array;
  vehicle: Uint8Array;
  /** Segment 5D78 image: the animation frames that follow the rotation source frames in the VH0 image. */
  extra: Uint8Array;
  /** 768-byte VGA palette (6-bit components) after the round 3 track tweaks of fn 4758. */
  palette: Uint8Array;
}

/** File names of one round/track, as fn 3b50 patches them into the templates at ds:11a0.. */
export function raceFileNames(round: number, track: number): Record<string, string> {
  const r = String(round), t = String(track);
  return {
    map: `GAME1/ROUND${r}${t}.MAP`, col: `GAME1/ROUND${r}.COL`, dir: `GAME1/ROUND${r}.DIR`, pal: `GAME1/ROUND${r}.PAL`,
    ct: `GAME1/ROUND${r}BR.CT`, lev: `GAME1/ROUND${r}BR.LEV`, brk: `GAME1/ROUND${r}${t}B.BRK`,
    vh0: `GAME1/ROUND${r}BR.VH0`, pr0: `GAME1/ROUND${r}BR.PR0`, pr1: `GAME1/ROUND${r}BR.PR1`, pr2: `GAME1/ROUND${r}BR.PR2`,
    strtPos: 'GAME1/STRT_POS.BIN', cheats: 'GAME1/CHEATS.BIN', ph0: 'BITSFILE.PH0', settings: 'SETTINGS.DAT', exe: 'MICRO.EXE',
  };
}

const copyInto = (d: DataSegment, off: number, src: Uint8Array, max = src.length): void => { d.m.set(src.subarray(0, Math.min(src.length, max)), off); };

/** fn 2770 (file part): SETTINGS.DAT buffer at ds:0da8, then the words it configures. */
export function applySettings(d: DataSegment, settings: Uint8Array): void {
  copyInto(d, 0x0DA8, settings, 0x28);
  let si = 0x0DA8;
  for (const o of [0x0F5F, 0x0F61, 0x263A, 0x0F64, 0x28FD, 0x28FF, 0x2905, 0x2907]) { d.w16(o, d.r16(si)); si += 2; }
  d.m.set(d.m.subarray(si, si + 16), 0x106C);
  d.w8(0x0EFF, 1); d.w16(0x0F73, 0x0F6B); d.w8(0x0F63, 0); d.w8(0x0156, 0);
}

/**
 * The sizes the loaders below take for granted. Nothing in the original checks them: it was reading files
 * it had installed itself. Here they come from whatever copy of the game the player owns, and a file that
 * is short or from another release otherwise corrupts the race in silence, so say which one it was.
 */
function checkSizes(files: RaceFiles): void {
  const want: [string, Uint8Array | undefined, number][] = [
    ['MICRO.EXE', files.exe, DS_IMAGE_OFFSET + 0x1000],
    ['the track (.MAP)', files.map, 0x800],
    ['the palette (.PAL)', files.pal, 0x300],
    ['STRT_POS.BIN', files.strtPos, 0x90],
    ['the tile blocks (.CT)', files.ct, 0x48],
    ['the surface map (.COL)', files.col, 0x12],
    ['the direction map (.DIR)', files.dir, 0x24],
  ];
  for (const [name, bytes, least] of want) {
    if (bytes !== undefined && bytes.length < least) {
      throw new Error(`${name} is ${bytes.length} bytes, expected at least ${least}. `
        + 'Is this the 1994 PC release, and did every file copy over whole?');
    }
  }
}

/**
 * fn 2a13: the 32 bytes GAME OPTIONS writes back to SETTINGS.DAT when anything on it changed. The two
 * devices come from [2658]/[265a] (where fn 29f5 has just put them), not from the screen's own copies.
 * The original skips the write on a floppy (int 21 ah=19 says drive A or B), which has no equivalent here.
 */
export function settingsBytes(d: DataSegment): Uint8Array {
  const out = new Uint8Array(0x20);
  const words = [0x2658, 0x265A, 0x263A, 0x0F64, 0x28FD, 0x28FF, 0x2905, 0x2907];
  words.forEach((o, i) => { const v = d.r16(o); out[i * 2] = v & 0xFF; out[i * 2 + 1] = v >> 8; });
  out.set(d.m.subarray(0x106C, 0x107C), words.length * 2);
  return out;
}

/** fn 3b50 name patching: round digit into the templates, round+track into the MAP/BRK names. */
function patchFileNames(d: DataSegment, round: number, track: number): void {
  const r = 0x30 + round, t = 0x30 + track;
  for (const o of [0x1205, 0x1210, 0x11EB, 0x11F8, 0x11B1, 0x11BC, 0x1229]) d.w8(o, r);
  d.w8(0x11A5, r); d.w8(0x11A6, t); d.w8(0x121C, r); d.w8(0x121D, t);
}

/** fn 3547 leaves the last digit of a multi-part template at the first part that failed to open. */
function markLoadedParts(d: DataSegment, template: number, parts: number): void {
  let e = template; while (d.r8(e) !== 0) e++;
  d.w8(e - 1, 0x30 + parts);
}

/** fn 2d00: per-input-source handler pointers at ds:1083.. and the joystick flags in [108c]. */
export function inputHandlers(d: DataSegment): void {
  d.w8(0x108C, 0);
  for (let i = 0; i < 4; i++) {
    const src = d.r16(0x2658 + i * 2);
    let dx = 0x2DED;
    if (src === 4) dx = 0x2DFA; else if (src === 5) dx = 0x2DFE; else if (src === 3) dx = 0x2E02;
    else if (src === 1) { d.w8(0x108C, d.r8(0x108C) | 1); dx = 0x2E6C; }
    else if (src === 2) { d.w8(0x108C, d.r8(0x108C) | 2); dx = 0x2EB3; }
    d.w16(0x1083 + i * 2, dx);
  }
}

/**
 * fn 3f3b: in a two-player game (fn 1ef1 leaves [08a2] set) every car takes the round's table as it stands.
 * The only skew is the handicap the character select asked for, kept in the 0x80 bit of [2668..266e]: it
 * slows the top speed by up to 0xc0 and the acceleration by up to 0x0c, less the higher the character's number.
 */
function twoPlayerParams(d: DataSegment, tbl: number): void {
  for (let i = 0; i < 4; i++) {
    const bx = CARS[i]!;
    const cx = d.r16(0x2668 + i * 2);
    const dx = (cx & 0x80) !== 0 ? (cx + 1) & 0x7F : 0;
    let s = tbl;
    const next = (): number => { const v = d.r16(s); s += 2; return v; };
    d.w16(bx + 0x129C, next() - (dx !== 0 ? 0xC0 - ((dx - 1) << 6) : 0));
    d.w16(bx + 0x12A0, next() + 0x32);
    d.w16(bx + 0x12A2, next() - (dx !== 0 ? 0x0C - ((dx - 1) << 2) : 0));
    d.w16(bx + 0x12A4, next());
    d.w16(bx + 0x12A6, next());
    d.w16(bx + 0x127C, next() + d.r16(0x24E0));
    d.w16(bx + 0x127E, next() + d.r16(0x24E0));
  }
}

/** fn 3c09 without the file reads: race globals, start positions, AI parameters, car struct reset. */
function initRaceState(d: DataSegment, p: RaceParams): void {
  const wr = (o: number, v: number): void => d.w16(o, v);
  wr(0x264E, 8); wr(0x2650, 8); wr(0x26C6, 0); wr(0x2911, 0); wr(0x2913, 0); wr(0x26C4, 1);
  wr(0x26B4, 4); wr(0x26B6, 4); wr(0x26B8, 1); wr(0x26BA, 0);
  wr(0x26C8, d.r16(0x2419 + (p.track - 1) * 2));
  for (const o of [0x26D1, 0x26D5, 0x26BC, 0x26BE, 0x26C0, 0x26C2, 0x2633, 0x2635]) wr(o, 0);
  wr(0x26CC, 0x64); wr(0x2917, 0); wr(0x2915, 0); wr(0x2919, 0); wr(0x291B, 3); d.w8(0x1096, 0); wr(0x291D, 0); wr(0x2682, 0xFFFF);
  // MAP loaded at ds:2963; the progress plane's maximum drives the ranking scale
  let mx = 0;
  for (let i = 0; i < 0x400; i++) mx = Math.max(mx, d.r8(0x2963 + 0x400 + i));
  wr(0x2652, mx); wr(0x2654, mx >> 1);
  for (const o of [0x1380, 0x14E4, 0x1648, 0x17AC]) wr(o, 1);
  for (const o of [0x137E, 0x14E2, 0x1646, 0x17AA]) wr(o, 0);

  // start position (STRT_POS.BIN at ds:1eab, 4 bytes per track: x, y); colour bits offset the cars on the grid
  let si = 0x1EAB + ((p.round - 1) << 4) + ((p.track - 1) << 2);
  let ax = (d.r16(si) + 0x14) & 0xFFFF; si += 2;
  for (const bx of CARS) { const cx = (ax + (d.r16(bx + 0x137C) & 1 ? 0x1A : 0)) & 0xFFFF; wr(bx + 0x125C, cx); wr(bx + 0x125E, cx); }
  ax = (ax - 0xFA) & 0xFFFF; if (d16s(ax) <= 0) ax = (ax + 0xC00) & 0xFFFF;
  wr(0x264A, ax); wr(0x2646, ax);
  ax = (d.r16(si) - 0xA) & 0xFFFF; si += 2;
  for (const bx of CARS) { const cx = (ax + (d.r16(bx + 0x137C) & 2 ? 0x1A : 0)) & 0xFFFF; wr(bx + 0x1268, cx); wr(bx + 0x126A, cx); }
  ax = (ax - 0xFA) & 0xFFFF; if (d16s(ax) <= 0) ax = (ax + 0xC00) & 0xFFFF;
  wr(0x264C, ax); wr(0x2648, ax);
  // head-to-head progress words
  for (let i = 0; i < 3; i++) {
    const b = 0x2684 + i * 0x10;
    wr(b + 2, 0); wr(b + 4, 0); wr(b + 6, 0); wr(b, 0);
    wr(b + 8, 1); wr(b + 0xA, 1); wr(b + 0xC, 1); wr(b + 0xE, 1);
  }
  wr(0x27B5, p.mode === 2 ? 0 : 1);

  // AI / handling parameters from the per-round table at ds:252a (9 words), skewed by character and challenge index
  const tbl = 0x252A + (p.round - 1) * 0x12;
  const ci = d.r8(0x28C1);
  if (d.r8(0x08A2) !== 0) twoPlayerParams(d, tbl);      // fn 3f3b: a two-player game reads the table straight
  else for (let i = 0; i < 4; i++) {
    const bx = CARS[i]!;
    let cx = d.rs16(0x23DC + d.r16(0x2668 + i * 2) * 2);
    if (bx === 0) cx = 0;
    else {
      if (ci <= 0) { cx = 0; if (bx !== 0x164) { cx += 6; if (bx !== 0x42C) cx += 6; } }
      cx -= 0xF; cx += ci;
      if (p.round === 7) cx += 4;
      if (p.round === 8) cx += 8;
      if (p.round === 2) cx += 7;
      if (ci === 8) cx += 3;
      if (ci >= 0x13) cx += 8;
      if (ci === 0x15) cx -= 1;
      if (ci === 0x16) cx -= 8;
      if (ci === 0x17) cx += 0x14;
      if (ci === 0x18) cx -= 5;
    }
    let s = tbl;
    let v = d.r16(s) + 11 * cx; s += 2;
    if (bx !== 0) v -= d.r16(0x2462 + ci * 2);
    wr(bx + 0x129C, v);
    v = d.r16(s) + 4 * cx + 0x32; s += 2; wr(bx + 0x12A0, v);
    v = d.r16(s) + cx; s += 2; wr(bx + 0x12A2, v);
    if (bx !== 0 && p.mode === 2 && ci >= 0x12) {
      let a = d.r16(bx + 0x12A2) >> 2;
      if (ci !== 0x17) a >>= 2;
      wr(bx + 0x12A2, d.r16(bx + 0x12A2) - a);
    }
    v = d.r16(s) + cx + 0x28; s += 2; wr(bx + 0x12A4, v);
    v = d.r16(s); s += 2; wr(bx + 0x12A6, v);
    v = d.r16(s) + 2 * cx; s += 2; v += bx !== 0 ? 0x28 : d.r16(0x24E0); wr(bx + 0x127C, v);
    v = d.r16(s) + 3 * cx; s += 2; v += bx !== 0 ? 0x28 : d.r16(0x24E0); wr(bx + 0x127E, v);
    if (bx !== 0x42C && ci === 0x17) { d.add16(0x129C, -0x4B); d.add16(0x12A2, -2); }
  }
  wr(0x28C2, d.r16(tbl + 0xE)); wr(0x28C4, d.r16(tbl + 0x10));

  if (p.mode !== 2) { wr(0x27B5, 1); wr(0x2660, 0); wr(0x2662, 0x164); } else wr(0x27B5, 0);
  wr(0x124E, 1); wr(0x13B2, 1); wr(0x1516, 1); wr(0x167A, 1); wr(0x12EB, 0);
  wr(0x144F, 1); wr(0x15B3, 1); wr(0x1717, 1); wr(0x265C, 6); wr(0x265E, 6);
  if (p.mode !== 1) { wr(0x144F, 0); wr(0x1516, 0); wr(0x167A, 0); } else wr(0x265A, 6);
  if (p.round === 9) { wr(0x13B2, 0); wr(0x1516, 0); wr(0x167A, 0); wr(0x27B5, 1); }
  for (let i = 0; i < 4; i++) if (d.r16(0x2658 + i * 2) === 6) wr(d.r16(0x2660 + i * 2) + 0x12EB, 1);

  // per-car reset (4220..4444)
  const scale = 9 * (d.r16(0x2652) & 0xFF);
  for (let i = 0; i < 4; i++) {
    const bx = CARS[i]!;
    wr(0x2670 + i * 2, scale); wr(0x2678 + i * 2, bx);
    wr(bx + 0x12EF, 0); wr(bx + 0x129E, d.r16(bx + 0x129C));
    for (const o of [0x1278, 0x1272, 0x1270, 0x1276, 0x1274, 0x1258, 0x125A, 0x1264, 0x1266, 0x127A, 0x1282, 0x1284, 0x1286, 0x1288, 0x128A]) wr(bx + o, 0);
    wr(bx + 0x128E, 0xFFE2); wr(bx + 0x1290, 0x14); wr(bx + 0x1292, 0x1E); wr(bx + 0x1294, 0xFFEC); wr(bx + 0x1296, 0);
    for (const o of [0x12A8, 0x12AC, 0x12B0, 0x12B2, 0x12B4, 0x12B6, 0x12C2, 0x12BE, 0x12C0, 0x12C4, 0x12C6, 0x12C8, 0x12CA, 0x12CC,
      0x12CE, 0x12D0, 0x12D2, 0x12D4, 0x12D6]) wr(bx + o, 0);
    wr(bx + 0x12D8, 1);
    for (const o of [0x12DA, 0x12DC, 0x12DE]) wr(bx + o, 0);
    d.w8(bx + 0x12E0, 0);
    for (const o of [0x12E1, 0x12E3, 0x12E5, 0x12E7, 0x12E9]) wr(bx + o, 0);
    wr(bx + 0x12ED, 3);
    wr(bx + 0x12F1, d.r16(bx + 0x125C)); wr(bx + 0x12F3, d.r16(bx + 0x1268));
    wr(bx + 0x12F5, 0); wr(bx + 0x12F7, 0); d.w8(bx + 0x137B, 0); wr(bx + 0x1382, 0); wr(bx + 0x1384, 0);
    wr(bx + 0x124C, d.r16(bx + 0x124E));
    for (const o of [0x1386, 0x1388, 0x138E]) wr(bx + o, 0);
    wr(bx + 0x138A, 1);
    for (const o of [0x138C, 0x1390, 0x1392]) wr(bx + o, 0);
    wr(bx + 0x12AE, 0xA);
    for (const o of [0x1394, 0x1398, 0x139C, 0x13A0, 0x13A2, 0x1396, 0x13A6]) wr(bx + o, 0);
    wr(bx + 0x12AE, 0xA); wr(bx + 0x1250, 0);
    wr(bx + 0x129A, p.round === 7 || p.round === 6 ? 2 : 3);
    d.m.fill(0xFF, bx + 0x12FD, bx + 0x12FD + 0x60);
    d.m.fill(0xFF, bx + 0x135D, bx + 0x135D + 0x1E);
  }
  if (p.mode === 2) { wr(0x2678, d.r16(0x2660)); wr(0x267A, d.r16(0x2662)); }
}

const d16s = (v: number): number => (v & 0x8000 ? v - 0x10000 : v);

/** fn 4758 tail: round 3 tracks 1/2 replace palette entries 0xFB..0xFD with the water colours of the track. */
export function tweakPalette(pal: Uint8Array, round: number, track: number): Uint8Array {
  const out = pal.slice(0, 0x300);
  if (round === 3 && (track === 1 || track === 2)) {
    const src = track === 2 ? 0x291 : 0x2C1;
    out.set(pal.subarray(src, src + 9), 0x2F1);
  }
  return out;
}

/** Build the data segment and the off-segment assets of one race. `into` reuses a data segment the front end
 *  is already living in, the way fn 3039 does when a race starts from the menus. */
export function setupRace(files: RaceFiles, p: RaceParams, into?: DataSegment): RaceAssets {
  checkSizes(files);
  const d = into ?? new DataSegment(files.exe.subarray(DS_IMAGE_OFFSET));
  if (!into && files.settings) applySettings(d, files.settings);

  // menu state consumed by the race code
  d.w8(0x28BF, p.round); d.w8(0x28C0, p.track); d.w8(0x28C1, p.challengeIndex);
  d.w16(0x2656, p.mode);
  for (let i = 0; i < 4; i++) { d.w16(0x2658 + i * 2, p.inputs[i]!); d.w16(0x2668 + i * 2, p.characters[i]!); }
  d.w8(0x1082, 1);

  // fn 37fc prologue
  d.w16(0x2630, 0);
  if (d.r16(0x263A) === 0) d.w16(0x263A, 1);
  d.w16(0x2643, 0x03D4);                                   // fn 319f: BIOS CRT controller base (0:0463)
  d.w16(0x137C, 3); d.w16(0x14E0, 2); d.w16(0x1644, 1); d.w16(0x17A8, 0); d.w16(0x2682, 0xFFFF);

  // fn 3b50
  patchFileNames(d, p.round, p.track);
  if (files.brk) { copyInto(d, 0x195B, files.brk, 0x200); d.w16(0x28BB, 0x195B); } else d.w16(0x28BB, 0);
  if (files.lev) { copyInto(d, 0x1B5B, files.lev, 0x80); d.w16(0x28B9, 0x1B5B); } else d.w16(0x28B9, 0);
  d.w16(0x28BD, d.r16(0x26D7 + (p.round - 1) * 2));
  if (p.round === 9) { d.w16(0x13B2, 0); d.w16(0x1516, 0); d.w16(0x167A, 0); d.w16(0x27B5, 1); }

  // fn 3c09
  copyInto(d, 0x1EAB, files.strtPos); copyInto(d, 0x1BDB, files.cheats); copyInto(d, 0x2963, files.map);
  initRaceState(d, p);
  const blocks = decodeBlocks(files.ct, files.col, files.dir, files.lev ?? new Uint8Array(0x80));
  const mapWords = expandMap(blocks, files.map.subarray(0, 0x400));
  inputHandlers(d);

  // fn 458b
  copyInto(d, 0x3163, files.col); copyInto(d, 0x35E3, files.dir);
  // fn 482f: PH0 decoded into ds:3fe3..ade3 (the tail beyond the decoded data is stale work memory in the original)
  const ph0 = lzDecode(files.ph0).data;
  d.m.set(ph0.subarray(0, Math.min(ph0.length, 0x10000 - 0x3FE3)), 0x3FE3);
  markLoadedParts(d, 0x1231, 1);
  // fn 4611: VH0 into the sprite segments; round 8 keeps its skid images in the data segment
  const vh0 = lzDecode(files.vh0).data;
  const vehicle = frameTableBytes(decodeVehicle(vh0, p.round));
  const extra = p.round === 9 ? vh0.slice(0x3840, 0x3840 + 0x1F40) : vh0.slice(0x1440, 0x1440 + 0x1B00);
  if (p.round === 8) d.m.set(vh0.subarray(0x1440, 0x1440 + 0x1400), 0x5EE3);
  markLoadedParts(d, 0x11F3, 1);
  // fn 45e5: PR banks, then tile 0 copied to ds:3ee3 (fn 4808)
  const parts = files.pr.map(b => lzDecode(b).data);
  const banks = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  parts.reduce((o, b) => { banks.set(b, o); return o + b.length; }, 0);
  d.m.set(banks.subarray(0, 0x100), 0x3EE3);
  markLoadedParts(d, 0x11E6, parts.length);

  applyPriorityFlags(mapWords, p.round, true);
  const palette = tweakPalette(files.pal, p.round, p.track);
  d.w8(0x26CE, 0);                                          // fn 327a / 32ce fade bookkeeping

  // fn 3039 prologue after fn 37fc
  d.w16(0x2621, 0xFFFF); d.w16(0x2638, d.r16(0x263A));
  return { ds: d, mapWords, banks, vehicle, extra, palette };
}

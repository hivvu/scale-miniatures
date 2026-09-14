/** ROUNDrBR.VH0 vehicle sprites: 32-direction rotation table as built by fn 4611/4696/46f6.
 *  Port of tools/mm/sprites.py; layout in re/notes/61-sprites.md. */
export interface VehicleSprites {
  size: number;            // 24 or 40
  frames: Uint8Array[];    // 32 frames (size*size each), index = heading >> 3
  extra: Uint8Array[];     // extra sprites copied to segment 5D78 (12 x 24x24 or 5 x 40x40)
  rawFrames: number;       // frames present in the decoded file
}

function vflip(f: Uint8Array, w: number): Uint8Array {
  const o = new Uint8Array(w * w);
  for (let r = 0; r < w; r++) o.set(f.subarray((w - 1 - r) * w, (w - r) * w), r * w);
  return o;
}
function hflip(f: Uint8Array, w: number): Uint8Array {
  const o = new Uint8Array(w * w);
  for (let r = 0; r < w; r++) for (let x = 0; x < w; x++) o[r * w + x] = f[r * w + (w - 1 - x)]!;
  return o;
}

/** 9 source frames (0..90 degrees) -> 32 frames exactly like fn 4696 (24) / fn 46f6 (40). */
export function buildFrames(base9: Uint8Array[], w: number): Uint8Array[] {
  const fr: Uint8Array[] = [...base9];
  for (let i = 7; i >= 0; i--) fr.push(vflip(base9[i]!, w));          // 9..16  = vflip(7..0)
  for (let i = 15; i >= 9; i--) fr.push(hflip(fr[i]!, w));            // 17..23 = hflip(15..9)
  for (let i = 8; i >= 1; i--) fr.push(hflip(base9[i]!, w));          // 24..31 = hflip(8..1)
  return fr;
}

export function decodeVehicle(data: Uint8Array, round: number): VehicleSprites {
  const w = round === 9 ? 40 : 24;
  const fsz = w * w;
  const nExtra = round === 9 ? 5 : 12;
  const need = (9 + nExtra) * fsz;
  const buf = new Uint8Array(Math.max(need, data.length)); buf.set(data);   // past the data: stale window, zero here
  const base9: Uint8Array[] = [];
  for (let i = 0; i < 9; i++) base9.push(buf.slice(i * fsz, (i + 1) * fsz));
  const extra: Uint8Array[] = [];
  for (let i = 0; i < nExtra; i++) extra.push(buf.slice((9 + i) * fsz, (10 + i) * fsz));
  return { size: w, frames: buildFrames(base9, w), extra, rawFrames: Math.floor(data.length / fsz) };
}

/** Exact image of segment 4D78 after loading (0x4800 B for 24x24, 0xC800 B for 40x40). */
export function frameTableBytes(v: VehicleSprites): Uint8Array {
  const out = new Uint8Array(v.frames.length * v.size * v.size);
  v.frames.forEach((f, i) => out.set(f, i * v.size * v.size));
  return out;
}

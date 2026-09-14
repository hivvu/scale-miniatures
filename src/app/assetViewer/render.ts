import type { Palette } from '../../data/palette';
import { paletteToRgba } from '../../data/palette';

/** Draw 8-bit indexed pixels (row-major, `stride` wide) into a canvas through a palette LUT. */
export function indexedToCanvas(px: Uint8Array, width: number, height: number, pal: Palette, scale = 1): HTMLCanvasElement {
  const lut = paletteToRgba(pal);
  const off = document.createElement('canvas'); off.width = width; off.height = height;
  const ctx = off.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  const out = new Uint32Array(img.data.buffer);
  for (let i = 0; i < width * height; i++) out[i] = lut[px[i] ?? 0]!;
  ctx.putImageData(img, 0, 0);
  if (scale === 1) return off;
  const c = document.createElement('canvas'); c.width = width * scale; c.height = height * scale;
  const cx = c.getContext('2d')!; cx.imageSmoothingEnabled = false;
  cx.drawImage(off, 0, 0, c.width, c.height);
  return c;
}

/** Tile sheet: n tiles of w x h bytes, `cols` per row. */
export function sheet(data: Uint8Array, w: number, h: number, cols: number): { px: Uint8Array; width: number; height: number } {
  const n = Math.floor(data.length / (w * h));
  const rows = Math.max(1, Math.ceil(n / cols));
  const px = new Uint8Array(cols * w * rows * h);
  for (let t = 0; t < n; t++) {
    const ox = (t % cols) * w, oy = Math.floor(t / cols) * h;
    for (let y = 0; y < h; y++) px.set(data.subarray(t * w * h + y * w, t * w * h + (y + 1) * w), (oy + y) * cols * w + ox);
  }
  return { px, width: cols * w, height: rows * h };
}

/** Full 3072x3072 track image from the expanded 192x192 tile words and the concatenated PR banks. */
export function renderTrack(world: Uint16Array, banks: Uint8Array): Uint8Array {
  const ntiles = Math.floor(banks.length / 256);
  const px = new Uint8Array(3072 * 3072);
  for (let ty = 0; ty < 192; ty++) for (let tx = 0; tx < 192; tx++) {
    const t = world[ty * 192 + tx]! & 0x7FFF;
    if (t >= ntiles) continue;
    for (let y = 0; y < 16; y++) px.set(banks.subarray(t * 256 + y * 16, t * 256 + y * 16 + 16), (ty * 16 + y) * 3072 + tx * 16);
  }
  return px;
}

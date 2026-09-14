/** ROUNDrBR.CT (72 B/block: 6x6 LE16 tile words), .COL (18 B/block: 1 bit per 8x8 cell, 12x12),
 *  .DIR (36 B/block: 1 byte per tile), .LEV (1 B/block). Port of tools/mm/blocks.py; semantics in
 *  re/notes/80-ai-collision.md. */
export interface Blocks {
  count: number;
  tiles: Uint16Array;   // count * 36 tile words (bit 15 = priority tile drawn over sprites)
  col: Uint8Array;      // count * 18
  dir: Uint8Array;      // count * 36 (padded/truncated to 36 per block like the game's fixed stride)
  lev: Uint8Array;      // count (missing bytes read as 0)
}

export function decodeBlocks(ct: Uint8Array, col: Uint8Array, dir: Uint8Array, lev: Uint8Array): Blocks {
  if (ct.length % 72) throw new Error('CT size not a multiple of 72');
  const n = ct.length / 72;
  if (col.length !== n * 18) throw new Error(`COL size ${col.length} != ${n}*18`);
  const tiles = new Uint16Array(n * 36);
  for (let i = 0; i < n * 36; i++) tiles[i] = ct[i * 2]! | (ct[i * 2 + 1]! << 8);
  const dirOut = new Uint8Array(n * 36); dirOut.set(dir.subarray(0, Math.min(dir.length, n * 36)));
  const levOut = new Uint8Array(n); levOut.set(lev.subarray(0, Math.min(lev.length, n)));
  return { count: n, tiles, col: new Uint8Array(col), dir: dirOut, lev: levOut };
}

/** 192x192 tile words as the game builds them (fn 447e). Cells whose block index is out of range are left 0
 *  (the game would read stale memory past the CT there). */
export function expandMap(blocks: Blocks, mapBlocks: Uint8Array): Uint16Array {
  const out = new Uint16Array(192 * 192);
  for (let i = 0; i < 1024; i++) {
    const b = mapBlocks[i]! & 0x3F;
    if (b >= blocks.count) continue;
    const bx = i % 32, by = (i / 32) | 0;
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 6; c++) out[(by * 6 + r) * 192 + bx * 6 + c] = blocks.tiles[b * 36 + r * 6 + c]!;
  }
  return out;
}

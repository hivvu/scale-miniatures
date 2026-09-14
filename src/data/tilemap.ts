/** ROUNDrt.MAP (2048 B): plane 0 = 32x32 block indices (& 0x3F, bits 6-7 = AI direction flags),
 *  plane 1 = 32x32 progress bytes (0xFF = void). Port of tools/mm/tilemap.py. */
export interface TileMap { blocks: Uint8Array; progress: Uint8Array; }

export function decodeTileMap(data: Uint8Array): TileMap {
  if (data.length !== 2048) throw new Error(`.MAP must be 2048 bytes, got ${data.length}`);
  return { blocks: data.slice(0, 1024), progress: data.slice(1024, 2048) };
}

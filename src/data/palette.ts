/** VGA palette (.PAL): 256 x (r,g,b) 6-bit DAC values. Port of tools/mm/palette.py. */
export interface Palette { rgb6: Uint8Array; }   // 768 bytes, values 0..63

export function decodePalette(data: Uint8Array): Palette {
  if (data.length !== 768) throw new Error(`palette must be 768 bytes, got ${data.length}`);
  for (const v of data) if (v > 0x3F) throw new Error('palette has values above 0x3F; not a 6-bit VGA palette');
  return { rgb6: new Uint8Array(data) };
}

/** 6-bit DAC -> 8-bit as DOSBox does: v<<2 | v>>4. Returns 256 packed 0xAABBGGRR (little-endian RGBA) values. */
export function paletteToRgba(pal: Palette): Uint32Array {
  const out = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const r = pal.rgb6[i * 3]!, g = pal.rgb6[i * 3 + 1]!, b = pal.rgb6[i * 3 + 2]!;
    const R = (r << 2) | (r >> 4), G = (g << 2) | (g >> 4), B = (b << 2) | (b >> 4);
    out[i] = (0xFF << 24 | B << 16 | G << 8 | R) >>> 0;
  }
  return out;
}

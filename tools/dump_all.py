#!/usr/bin/env python3
"""Decode everything decodable so far into build/assets-debug/ (PNG + JSON) for visual checks."""
import json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mm import io, lz, palette, tilemap, blocks, settings, strtpos, cheats
from PIL import Image

OUT = io.ROOT / "build" / "assets-debug"

def sheet(data, pal, tw=16, th=16, cols=16):
    n = len(data) // (tw * th); rows = (n + cols - 1) // cols
    img = Image.new('P', (cols * tw, max(rows, 1) * th)); px = img.load()
    for t in range(n):
        base = t * tw * th
        for y in range(th):
            for x in range(tw):
                px[(t % cols) * tw + x, (t // cols) * th + y] = data[base + y * tw + x]
    img.putpalette(pal); return img

def main():
    (OUT / "banks").mkdir(parents=True, exist_ok=True); (OUT / "tracks").mkdir(exist_ok=True); (OUT / "tables").mkdir(exist_ok=True)
    intro_pal = palette.decode_palette(io.read('INTRO.PAL')).to_pil_flat()
    for i in range(7):
        r = lz.decode(io.read(f'COMPRESS.PI{i}'))
        sheet(r.data, intro_pal).convert('RGB').save(OUT / "banks" / f"COMPRESS.PI{i}_tiles16.png")
    r = lz.decode(io.read('BITSFILE.PH0'))
    sheet(r.data, palette.decode_palette(io.read('GAME1/ROUND1.PAL')).to_pil_flat()).convert('RGB').save(OUT / "banks" / "BITSFILE.PH0_tiles16.png")
    info = {}
    for rnd in range(1, 10):
        pal = palette.decode_palette(io.read(f'GAME1/ROUND{rnd}.PAL')).to_pil_flat()
        banks = b''
        for k in range(3):
            try:
                d = lz.decode(io.read(f'GAME1/ROUND{rnd}BR.PR{k}')).data
            except FileNotFoundError:
                break
            banks += d
            sheet(d, pal).convert('RGB').save(OUT / "banks" / f"ROUND{rnd}BR.PR{k}_tiles16.png")
        vh = lz.decode(io.read(f'GAME1/ROUND{rnd}BR.VH0')).data
        sw = 40 if rnd == 9 else 24
        sheet(vh, pal, sw, sw, 8).convert('RGB').save(OUT / "banks" / f"ROUND{rnd}BR.VH0_sprites{sw}.png")
        blk = blocks.decode_blocks(io.read(f'GAME1/ROUND{rnd}BR.CT'), io.read(f'GAME1/ROUND{rnd}.COL'),
                                   io.read(f'GAME1/ROUND{rnd}.DIR'), io.read(f'GAME1/ROUND{rnd}BR.LEV'))
        ntiles = len(banks) // 256
        for trk in range(1, 5):
            try:
                m = tilemap.decode_tilemap(io.read(f'GAME1/ROUND{rnd}{trk}.MAP'))
            except FileNotFoundError:
                break
            tiles = blocks.expand_map(blk, m.blocks)
            img = Image.new('P', (3072, 3072)); px = img.load()
            for ty in range(192):
                row = tiles[ty]
                for tx in range(192):
                    n = row[tx] & 0x7FFF
                    if n >= ntiles: continue
                    base = n * 256
                    for y in range(16):
                        for x in range(16):
                            px[tx * 16 + x, ty * 16 + y] = banks[base + y * 16 + x]
            img.putpalette(pal)
            img.save(OUT / "tracks" / f"ROUND{rnd}{trk}.png")
            img.convert('RGB').resize((768, 768), Image.NEAREST).save(OUT / "tracks" / f"ROUND{rnd}{trk}_small.png")
            info[f"ROUND{rnd}{trk}"] = {"tiles_in_banks": ntiles, "blocks": len(blk.tiles), "progress_max": max(m.progress)}
            print("rendered", f"ROUND{rnd}{trk}")
    tables = {
        "settings": settings.decode_settings(io.read('SETTINGS.DAT')).describe(),
        "start_positions": strtpos.decode_strtpos(io.read('GAME1/STRT_POS.BIN')),
        "cheats": cheats.decode_cheats(io.read('GAME1/CHEATS.BIN')),
        "tracks": info,
    }
    (OUT / "tables" / "tables.json").write_text(json.dumps(tables, indent=1))
    print("done")

if __name__ == "__main__":
    main()

# GAME1 data formats (Confidence: verified by decoder + full-track render matching in-game art)

World: 192 x 192 tiles of 16x16 px = 3072 x 3072 px (coordinates wrap at 0xC00). Composed of
32 x 32 blocks of 6 x 6 tiles (96 x 96 px).

## ROUNDrt.MAP (2048 B) -> ds:2963
- bytes 0..1023: block index per cell, 32 columns x 32 rows, row-major. `idx & 0x3F` selects the
  block in the .CT; bits 6-7 unknown (masked off by the loader).
- bytes 1024..2047: second plane, one byte per cell; the loader computes max over the plane ->
  ds:[2652] (and max/2 -> [2654]). Likely the track progress / checkpoint index used for ranking.

## ROUNDrBR.CT (72 B per block, T blocks) -> read into 6D78:0000, expanded into the map buffer
- block = 6 rows x 6 LE16 tile words. Tile word: bits 0-14 = tile number (tile n lives at
  segment 1B78 + n*16 paragraphs = byte offset n*256 in the concatenated PR0|PR1|PR2 banks),
  bit 15 = priority tile (drawn after sprites, colour 0 transparent).
- Expanded map = 192 x 192 words, 384 B per row, at segment 3B78 (first 96 rows) and 4478
  (next 96 rows), contiguous (0x12000 bytes). Loader: fn 447e (two loops of 512 blocks).

## ROUNDr.COL (18 B per block) -> ds:3163 ; ROUNDr.DIR (36 B per block) -> ds:35e3
- Per-block attribute planes for the 6x6 tiles: COL = 4 bits per tile (surface/collision type),
  DIR = 8 bits per tile. Exact bit semantics still to be read from the physics code.
- ds:3ee3 = 256 B copy of tile 0 (animated tile source, fn 4808/8996), ds:3fe3.. = BITSFILE.PH0
  decoded (HUD/font graphics, 26048 B).

## ROUNDrBR.LEV (1 B per block, up to 128 B) -> ds:1b5b, pointer ds:[28b9]
## ROUNDrtB.BRK (up to 512 B) -> ds:195b, pointer ds:[28bb]   (AI braking hints per track)
## STRT_POS.BIN (144 B) -> ds:1eab : [round-1][track-1] -> (x, y) LE16; cars start at
   x + 0x14 (+0x1A for alternate slots), y - 0x0A (+0x1A); camera = (x - 250, y - 250) mod 0xC00.
## CHEATS.BIN (360 B) -> ds:1bdb : 30 records of 6 LE16 (round, track, x, y, type, param) scanned by
   fn 35f0 (the PAUSE handler) when |car.x - x| < 0x18 and |car.y - y| < 0x18, applied to the player's
   car with a white flash. fn 35f0 walks si from 1bdb while si <= 1fcb, so it reads 84 slots: the 54
   past the file are whatever follows in the data segment. Types:
     0 dec [0406] (a life)          5 [2915] = 1 (the fire button stops jumping)
     1 [26c6] = 4, [2635] = 1       6 [2917] = 1 (read nowhere else)
       (ends the race as a win)     7 [bx+12f9] = 0 (the on-track flag)
     2 [bx+127c] = param            8 [bx+129c] = 0x800 (max speed)
     3 [bx+127e] = param            9 [2915] = 1, [2919] = 1, [291b] = 4 (jump on any round)
     4 [bx+12a2] = param
   See notes/53-cheats.md.
## ROUNDr.PAL (768 B) -> 6D78:0000 then int 10h AX=1012h. Round 3 tracks 1/2 patch entries
   251..253 from 235..237 / 219..221 (fn 4758).

## Graphics banks (Codemasters LZ, see LZ.md)
- ROUNDrBR.PR0/PR1/PR2: 16x16 linear 8bpp tiles, 256 B each, 192 tiles per 48 KB bank, loaded to
  segments 1B78, 2778, 3378 (step 0xC00 paragraphs) by fn 45ef -> fn 3547.
- ROUNDrBR.VH0: vehicle sprites. Loaded to 1B78 first, then copied: 0x1440 B to 4D78 and 0x1B00 B
  to 5D78 (24x24 sprites, fn 4696 builds mirrored frames); round 9 uses 40x40 (0x3840/0x1F40, fn 46f6).
- COMPRESS.PI0..PI6 (shared): loaded at startup to 1B78.. (7 banks). Used by the front-end /
  intro screens (drawing code not yet read); they are overwritten by the round banks.
- BITSFILE.PH0: HUD/font bits -> ds:3fe3.

## Per-round table ds:252a (18 B per round): car parameters (speed/accel etc, fn 3f19..4134).
## Car structs: 4 cars, stride 0x164 (356 B), car0 base ds:124c; fields see 70-physics.md (WIP):
   [125c]/[125e] x, [1268]/[126a] y (wrap 0xC00), [12ae] state (0x0A racing, 0x0B/0x0C finished?),
   [12eb] is-player, [129c..12a6] stats, [128e..1294] box -30,+20,+30,-20, [12fd] 48-word history.

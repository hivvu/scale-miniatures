# 61 Vehicle sprites (VH0) and sprite blitter (Confidence: rotation table verified byte-exact against
# a DOSBox-X memory dump of segment 4D78 in the round 2 race; blitter verified by disassembly)

## ROUNDrBR.VH0 -> loader fn 4611
LZ-decoded into 1B78:0000 (fn 3547), then split:
- rounds 1-8 (24x24 sprites, 576 B linear 8bpp, row stride 24):
  - 0x1440 B (9 frames) -> 4D78:0000 ; fn 4696 expands them to 32 rotation frames (0x4800 B).
  - next 0x1B00 B (12 frames) -> 5D78:0000 (extra sprites: shadow/effects/objects, to map).
  - round 8 only: 0x1400 B copied from 5D78:0000 to ds:5ee3 (fn 4611 tail).
- round 9 (40x40 sprites, 1600 B each): 0x3840 B (9 frames) -> 4D78:0000, expanded by fn 46f6
  to 32 frames (0xC800 B); next 0x1F40 B (5 frames) -> 5D78:0000.
- Files hold more frames than the loader copies (R1: 24 frames, R2: 16, R9: 15).

## Rotation table (fn 4696 / 46f6), frame f = 576 B (24x24) or 1600 B (40x40)
Frames 0..8 come from the file: angle 0 .. 90 degrees in 11.25 degree steps (frame 8 = frame 0
rotated 90 degrees). tools/mm/sprites.py reproduces the table; tools/gt_compare_vh.py diffs it against a dump.
- frames 9..16  = vflip(frame 7), vflip(6), ..., vflip(0)     (rows reversed)
- frames 17..23 = hflip(frame 15), hflip(14), ..., hflip(9)   (columns reversed)
- frames 24..31 = hflip(frame 8), hflip(7), ..., hflip(1)
=> 32 directions; car heading byte [car+0x1278] (0..255), frame = heading >> 3, source offset =
   (heading & 0xF8) * 72  (24x24)  or  (heading & 0xF8) * 200  (40x40).

## Car sprite draw: fn 7ce0 -> per car fn 7d73 (bx = car struct offset, 4 cars, stride 0x164)
Pass order in fn 7ce0: (1) fn 7e5c shadows for cars with [+0x124c]!=0 and height [+0x12d6]!=0,
(2) fn 8386 / 8083 per car (skid marks / tyre tracks: ring buffers at [+0x135d..] (5 x 6 B) and
[+0x12fd..] (8 x 12 B), images at ds:3fe3/41e3/43e3 = BITSFILE.PH0 8x8 bits, drawn by fn 8cd0),
(3) fn 8712 (effect at [+0x1394..0x13a4], image ds:72e3), (4) per car: state handler jump table
cs:[0x278f + state*2] with state [+0x12ae]; then fn 9076 (name tag / marker) unless [2656]==2.
fn 7d73:
- skips the car equal to [0x2621]; sets [+0x1250] = 1 (drawn) or 0 (off-screen).
- height [+0x12d6] (jump) is subtracted from both x and y (except round 8); x,y = [+0x125c],[+0x1268]
- screen = world - camera ([0x264a],[0x264c]) with wrap: if result <= -12 (24x24) / -4 (40x40)
  add 0xC00; then minus 12 (or 20) to centre the sprite.
- fn 8bab clips against the 256x224 viewport, fn 8c6a blits with colour remap [+0x1252];
  round 9 uses fn 8ca4 (no remap, cars other than car 0 are not drawn by this path).
- round 8 extra: fn 843d unless state is 0x0D or 0x02.

## Clipper fn 8bab (in: di=x, ax=y, cx=w, dx=h, si=src) -> out: di=dest, si=src, cl=w', ch=h', dx=skip
- x < 0: w' = w + x (<=0 -> CF, not drawn), src += -x, skip = -x, x = 0.
- x >= 0x100 -> not drawn; x + w > 0x100: w' = 0x100 - x, skip = w - w'.
- y < 0: h' = h + y (<=0 -> not drawn), src += (h - h') * w.
- y >= 0xE0 -> not drawn; y + h > 0xE0: h' = 0xE0 - y and dest = 0xE590 + x (rows 216+, which
  fn 92bc never copies to VRAM: partially-below sprites vanish; quirk to replicate).
- else dest = 0x1110 + y*0x110 + x. Always dest -= cs:[0x8994] (fine x scroll 0..3).

## Blitters (es = 6D78 back buffer, stride 0x110)
- fn 8c6a (cars): per pixel: 0 = transparent; if (px & 0x0F) <= 2 then px += bl ([+0x1252] player
  colour offset); source row advance = skip (clipped pixels), dest advance = 0x110 - w'.
- fn 8ca4 (40x40 round 9) and fn 8ce4/8d09 (8x8 bits, clip -23..256 / -23..200): plain colour-0
  transparency. fn 8c3c: shadow: every non-zero source pixel writes colour 0 (black).
- fn 8cd0: 8x8 bit n at si + n*64, drawn at (x-4, y-4).

## Corrections to 60-tiles-blit.md
fn 7759 and fn 78f8 are not sprite routines: they are head-to-head round-end logic (winner/loser
state 0x0B/0x0C, [0x2911]/[0x2913] flags). The sprite pass is fn 7ce0 only.

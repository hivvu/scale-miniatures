# 60 Rendering

Confidence: verified pixel-exact against about 1300 DOSBox-X VRAM captures across all nine rounds, the
whole viewport including sprites and the HUD (`test/engine/frame.test.ts`). The camera ([264a],[264c]) is
the world pixel at the viewport's top-left.

- Mode 13h. Back buffer in segment 6D78, stride 0x110 (272) bytes: 16 px right margin and 16
  rows top margin (viewport source starts at 0x1110 - cs:[8994] where cs:[8994] = fine x offset & 3).
- Frame copy fn 92bc: 200 rows x 256 px from back buffer to A000:0020 (screen x = 32..287),
  dest stride 320. => visible playfield 256 x 200 with 32 px black borders left/right.
- Race renderer fn 90c5 (only when ds:[2638] == 1):
  1. animated tiles: rounds 1/3/5 fn 8996 rewrites tile 0 (256 B at 1B78:0000) with a 16x16 window
     of the 32x32 pattern at ds:3ee3 shifted by (camX & 0x1F)/2, (camY & 0x1F)/2 (water); round 2
     fn 89e0 cycles 4 tile colours at 4478:8046; round 8 fn 8a2b.
  2. camera ds:[264a] (x), [264c] (y): tile col = x>>4, 17 columns; row = y>>4, 14 rows;
     sub-tile offsets 16-(x&15), 16-(y&15). Map word at (row*192+col)*2 from segment 3B78.
     Tile blit: 16 rows of 8 movsw, dest stride 0x110. Tiles with bit 15 are deferred (pushed).
  3. sprites: fn 7ce0 (see 61-sprites.md). fn 7759/78f8 (guarded by [2911]/[2913]) are
     head-to-head round-end handlers, not drawing code.
  4. deferred priority tiles drawn with colour-0 transparency (loop at 9214).
  5. fn 8dfc, per-player HUD fn 851f/855a (state 0x0B/0x0C), fn 8634, fn 7b46.
- Text panel: ds:0888 buffer 272-stride x 56 rows, copied to A000:0020 by fn 08bc (menus/intro text).
- Palette upload via int 10h AX=1012h from 6D78:0000 (fn 26ec, 4758).
- Self-modifying speed patch fn 7a75: on 386+ several movsw blits are patched to movsd (0x66A5).
- Detail level ds:[263a] (1..5) measured at start by fn 3ad0 (loop iterations per frame).

## Ground truth 2026-09-11 (build/golden/gt/round2_track1)
Viewport pixel (sx,sy) = world[(camY+sy) mod 3072][(camX+sx) mod 3072] through MAP -> CT -> PR banks: 0 mismatching
pixels outside the four car boxes and the HUD panel (top-left 48x120) during the start countdown. Car structs read
from the dump: x [+125c], y [+1268], heading byte [+1278] (frame = heading>>3), state [+12ae] = 0x0A while racing,
colour offset [+1252] = 0,2,4,6 for cars 0..3, [+124c] = active/drawn flag.

## Renderer transliteration (src/engine/render.ts) -- 2026-09-11
Pixel-exact against the per-step VRAM captures of the traces (test/engine/frame.test.ts, 21 frames, HUD excluded):
- Tile layer: 17x14 tiles from camera >>4, dest = (16 - fineX) + (16 - fineY)*0x110, aligned down to 4 with the
  residue in cs:[8994] applied by the VRAM copy (fn 92bc copies 200 rows from 0x1110 - residue).
- **Priority tiles**: bit 15 is NOT in the .CT files; race init (fn 37fc at 397f) sets it in the expanded map for
  GAME1 round 2 (tiles 0x40..0x13C) and round 3 (tiles 1..0x51), first 0x4706 words of each 96-row half only.
  The overlay drawn after sprites is the tile 12 places later (source offset 0xC00), colour 0 transparent.
- Sprites: shadows (fn 7e5c -> 8c3c) for cars in the air, cars (fn 7d73 -> 8c6a, recolour px&0xF<=2 by [1252]),
  foam/tyre bits (fn 8083 -> 8cd0: 8x8 at ds:[1307] + age*64, PH0 data at ds:3fe3) and skids (fn 847e: 32x32 at
  ds:5ee3 + age<<10) drawn before the cars.
- HUD (drawing half of fn 8dfc, after the deferred tiles): digits 8x16 at ds:5463 + n*128 (fn 905f), car icon 16x16 at
  ds:5363 (ds:5be3 once [12ed] == 0) recoloured by [1252] on low nibble 1/2 (fn 903f -> 8dc0). Player laps-to-go digit
  at buffer 0x1118 (viewport (8,0)); rows y = 16,32,48,64: icon of car [2678+2i] at x = 0, digit i+1 at x = 16. HUD
  blits subtract cs:[8994] so they stay pinned while the tile layer fine-scrolls. Head to head: leader lap digit +
  8 tug-bar cells (ds:5ae3 / 59e3 by [26b4]); round 9: elapsed time [26c8] >> 4 as digits at 0x1998..0x19b0.
  fn 851f/855a/8634 are the head-to-head end-of-race handlers (states 0x0B/0x0C), fn 7b46 is the engine sound update.
- Order inside fn 90c5 matters for the emitters: skid/foam lists are drawn as they stand, then fn 8386/8083 add this
  frame's entries; the ranking sort (fn 8dfc) runs before the HUD draw. RaceRenderer.render(sideEffects) keeps that.
- Animated tiles, round 2 (fn 89e0): the plughole is a 4x4 block of MAP WORDS (segment 4478 offset 0x8046 = rows
  181..184, cols 99..102) rewritten every render with tiles 0x00/0x10/0x20/0x30 + 0..15 by phase ([26d1] >> 2) & 3.
  It is the map that animates, not the tile pixels. Verified on trace_r2t1_current (car teleported next to the drain).
- State animations: state 1 (fn 880a -> 7fe8): 24x24 frame from segment 5D78 (VH0 image from 0x1440, 12 frames of
  0x240) at car pos - camera - 12, recoloured by [1252]; frame = word at table (round 2: ds:2835 stride 0x10, others
  ds:27f9 stride 0x1e, rounds 4/9 heading-based ds:27c1/27dd stride 0xe) + [12b6]*2; -2 = no draw, -1 = end -> state 7.
  Round 9 uses fn 8034: 40x40 plain frames (0x640 each, index mod 5) from 5D78 (VH0 image from 0x3840).
  States 2/0x0D (fn 82be -> 8339): table ds:289d + [12b8]*2, frame word at +0xe; draws the car (7d73) when
  state != 2 && [12b8] <= 3, or state == 2 && [12b8] >= 3, then the 24x24 frame from ds:45e3 + frame*0x240 at
  ([12ba],[12bc]) - [12d6] - camera - 12, plain blit. State 7 (fn 6feb) draws nothing.
- Particles (fn 8712): while [13a4] > 0x28 an 8x8 bit (ds:72e3 + ([1396] >> 2) * 64) at ([1398],[139c]) with a
  colour-0 shadow offset by ([139a],[139e]) (fn 8d36); for 0x1e <= [13a4] <= 0x28 the splash bits ds:41e3 + k*64,
  k = 0,1,2,3,4,5,4,3,2,1,0 indexed by [13a4] - 0x1e. Both use the fn 8cd0 bounds test (no clipping).
- Race end (30df): 100 iterations of {wait tick (3165), fn 855a, present (92bc)}; no physics, no scene redraw.
- Verified against VRAM (trace_r2t1_whirl, 200 per-step frames): state 1 sink animation, state 7 wait, state 2 respawn.
- Finishing-position marker (7d49..7d65 -> fn 9076): after the state handler, when round != 9, mode != 2 and
  ([26c6] >= 2 or [12ed] == 0): 16x8 image ds:5ce3 + ([12ef]-1)*128 at (x - [12d6] - 8, y - [12d6] - 0x14) - camera.
- State table ds:278f: 0 7d73, 1 880a, 2 82be, 4 7f62, 5 7efa, 7 6feb, a 849b, b/c 7d73, d 82be, e 6ae5, f 8683,
  10 86a8 (f/10 = round 9 time-trial banners, 3/6/8/9 = 35be no-op). 851f/855a/8634 (90c5 tail) are head-to-head
  only in practice ([26b8] is a car offset only in H2H); in single player the end sequence holds the last frame.
- Rounds 1/3/5 water: fn 8996 rewrites tile 0 from its copy at ds:3ee3 rotated by ((camX & 0x1f) >> 1, (camY & 0x1f) >> 1).
  This is the one surface phased on the camera instead of placed by it, so the wider views have to add the half of
  their growth the camera moved back on before taking the phase, or the whole animated ground sits half of it out of
  step with the map drawn on top (very visible on round 5's tablecloth).
- Round 8 (fn 8a2b): 3x3 blocks of map words cycle through tile sets 0 / 9 / 0x12 by ([26d3] >> 2) & 3 (phase 3 resets
  the counter); track 2: block at row 68 col 18; track 3: (62,98) (68,90) (80,90) (86,90) (104,90) (110,90); track 1 none.
- Round 9 banners (states 0xF/0x10 -> fn 86d2 -> 9289): car drawn, then the 88x22 image (ds:8ce3 time up, ds:9523
  finished) at ([26be] - 0x2c, [26c0] - 0xc) sliding from y 0 to 0x7c in steps of 8; drawn as a colour-0 silhouette
  while [26cf] == 1 (blink). ds:9d63 images are 0x15 rows.
- Round 8 helicopters (7e3a -> fn 843d): after a successful 24 px car blit, when the state is not 2/0xD, a 32x32 rotor
  frame (([1392] >> 1) & 3) from ds:5ee3 + n*0x400 is drawn centred 4 px up-left of the car and [1392] is incremented.
  The rotor images are the VH0 bytes 0x1440..0x2840 copied over the PH0 area by fn 4611 (tests must redo that copy
  after loading PH0 into the data segment).
- Round 9 time display (8ff5): digits of [26c8] >> 4 at buffer 0x1998/0x19a0/0x19b0; the separator (digit 10 at
  0x19a8) is drawn whenever the units digit is non-zero, because fn 905f leaves cx shifted left by 7 (900b compares
  that against 5).
- Verified against VRAM: rounds 1..9 track 1 (6 frames each, 300 steps), water tile rotation on 1/3/5, rotors on 8.
- Resolved (2026-09-11): the trace_r2t1 step-100 mismatch was a test-harness bug, not a renderer bug. The older
  two-file trace layout (cars_/glob_) was being expanded into one buffer with zeros between the car structs and the
  globals, wiping the AI direction tables (ds:18fb/191b) and checkpoint windows (ds:1feb) before the replayed step.
  All 21 frames are exact.

## The viewport (port only)

Every number that described the 256x200 window used to be a literal spread through the renderer and the
physics. They now come from one place, `src/engine/viewport.ts`, derived from a width and a height:

| field | at the original size | where it was |
|---|---|---|
| `stride` | 0x110 | bytes per back-buffer row (width + a 16 px margin for the fine scroll) |
| `cols` / `rows` | 17 / 14 | the tile loop at 9107, one more than the view needs |
| `origin` | 0x1110 | the top-left visible pixel, row 16 column 16 |
| `bufSize` / `mask` | 0x10000 / 0xFFFF | segment 6D78 and its 16-bit wrap |
| `clipH` | 0xE0 | fn 0630: 200 visible rows plus a 24 px car |
| `overflowDi` | 0xE590 | where fn 0630 parks a sprite clipped at the bottom, one row below the copy |
| `halfW` / `halfH` | 0x80 / 0x64 | the per-car camera anchors written at fn 53bc |
| `h2hX` / `h2hY` | 0xE8 / 0xB0 | fn 4fd1's "the cars are too far apart" test: width - 24, height - 24 |
| `outWidth` / `outX` | 320 / 32 | fn 92bc's copy into mode 13h |

`DOS_VIEWPORT` reproduces all of them exactly and is the default, so the golden captures still decide what
is correct; `test/engine/viewport.test.ts` pins every value.

Two derivations are load-bearing. `bufSize` is the next power of two that holds `origin + (height+1)*stride`,
which at the original size lands on **0x10000 exactly**, so the wrap-around the original relies on is
preserved rather than approximated. And `clipH` is `height + 24`, **not** the buffer's capacity: the two
agree at 256x200, but the capacity formula grows with the width and would silently extend the window
downwards.

Widening works at all because the world is a torus and the camera has no clamp, so there is always more map.
`test/engine/widescreen.test.ts` renders the same frozen state at 256x200 and at 384x200 with the camera
moved half the extra width to the left, and requires the shared columns to be identical: the wider view adds
pixels without moving any. The HUD is the exception, and deliberately so: it is anchored to the left edge of
the view, so it travels with it.

# 80 AI, track attributes and car-car collision

Confidence: read from the disassembly and validated step by step against 17 DOSBox-X traces
(`test/engine/trace.test.ts`).

## Track attribute files (semantics now known)
- **COL** (18 B per .CT block): 1 bit per 8x8-pixel cell, 12x12 cells per 96x96 block, row-major, MSB first
  (bit index = y_cell*12 + x_cell; byte = idx>>3, mask = 0x80 >> (idx&7)). 1 = solid (wall/obstacle). fn 589c.
- **DIR** (36 B per block): 1 byte per 16x16 tile (6x6, row-major). Low nibble (rounds 2: low 3 bits) = AI
  direction code 0..15 -> target heading via ds:18fb (16 words: 40 60 80 A0 C0 E0 00 20 50 70 90 B0 D0 F0 10 30),
  optionally remapped through ds:191b[variant][code] when MAP bit 7 (cell byte bit 1 after >>6) is set, variant =
  (LEV >> 5) & 3; MAP bit 6 flips the heading by 0x80. High nibble / top 3 bits = terrain type ([12d0], dispatched
  through the per-round handler table at [28bd]: e.g. ramps, bumps, slow zones, water; 0x10 bit = slow zone in
  round 3; 0x18 bits = current/ramp in round 2 -> fn 6231 adds a push velocity from the DIR heading).
- **LEV** (1 B per block): bit 7 = no position history (off-track / hazard, do not use as respawn point);
  bits 5-6 = DIR variant selector for the AI. Loaded via [28b9].
- **BRK** (per track, via [28bb], indexed by the progress index [12e3]): AI throttle hint per progress cell:
  high nibble 0 = full throttle; 1 = target speed (lo<<7) + 0x380 (+0x50 on track 0x17, round 7 adjustments),
  brake above it; 2 = full throttle with max speed capped to (lo<<6) + 0x600; >=3 = full throttle unless steering
  (then like 1).
- **MAP plane 2** (bytes 1024..2047): progress index per 96x96 cell (0xFF = void -> respawn). Max -> [2652].
- Checkpoint lists ds:1feb[round-1][track-1] -> word list (lo = progress value, hi = ...), terminated by 0xFFFF;
  cursor [12e7]. Passing the last checkpoint and crossing back to a low progress value = lap ([12ed]--);
  jumping backwards more than [2654] (= max progress / 2) = wrong-way / shortcut handling (fn 5e4e).

## AI input (fn 5429, called through the control-source table when [1082] != 0)
```
dir = DIR[12da] & 0xF (round 2: & 7) ; if MAP bit set: dir = VARIANT[(LEV>>5)&3][dir]
target = HEADING[dir] ; if MAP bit 6: target ^= 0x80
d = (int8)(target - heading): d < 0 -> steer left (0x80) ; d >= 3 -> steer right (0x40)
brk = BRK[[12e3]] : mode = brk >> 4, param = brk & 0xF   (see BRK above) -> accelerate 0x20 or brake 0x10
always sets fire (0x08)
```
Catch-up: AI cars that are off-screen and behind ([262f]) accelerate 6x and follow velocity 1.5x faster.

## Car-car collision (fn 5921 -> fn 5960 for the 6 pairs [27b1],[27b3])
- Uses candidate positions (x', y'). dx, dy wrapped; only when |dx| <= 16 and |dy| <= 16.
- Lookup table ds:17da[(dy+16)/2 * 17 + (dx+16)/2] (17x17 bytes) gives the collision normal heading (0 = none).
- If either car is in state 2: both get fixed velocities (+0x40,+0x40 / -0x40,-0x40).
- Else impulse = ((dvx * sin(n) - dvy * cos(n)) with the same >>8<<1 fixed-point products, at least 0x1F4;
  round 6 with impulse > 0x1F4 respawns both cars (state 0x0D). Car A: v -= impulse*(sin,cos); car B: v += ...
  Both get [12ac]=1 (recompute candidate in fn 5be7). Sound fn 5/3.

## Terrain type handlers (table at [28bd], indexed by [12d0] = DIR >> 4 or >> 5)
Examples read so far: 60cb ramp launch ([12d4] = (vx^2+vy^2 of the high bytes)/15 + 4, round 1 variants /7, /12);
6169 = fall (respawn, [1382]=0x46); 618c = bump (two-stage, +0xC8 vx); 61b0 = slow surface (v halved, speed cap
0x200, sound fn 0A/06); 63d6 = set [128a]; 63dd/641a = small hops; 6456/64f5 = pulled to the cell centre with
knockback (state 1, [12be]/[12c0] = delta/4 over 4 ticks) and velocities zeroed.
Round 2 fn 62e3: whirlpool/drain at (0x650, 0xB70): within 60 px the car is pulled toward it; within 12 px it is
captured (state 1, [1382]=0x46).

## Pair order and bx quirk in fn 5921 / 5960 (2026-09-11)
fn 5921 rewrites only one of [27b1]/[27b3] per call, so the pairs are (0,1) (0,2) (0,3) (1,3) (1,2) (3,2): the last
pair has car 3 as A (impulse sign) and the lookup table (ds:17da, 17 x 17, index (dy+16)/2 * 17 + (dx+16)/2) is not
symmetric, so the order decides whether a near miss counts (round 1 trace, step 160).
fn 5960 starts by recomputing the candidate position ([125a]/[125e], [1266]/[126a]) of whatever car bx points to, and
fn 5921 never reloads bx between its six calls: bx enters as the last car of the fn 525e loop ([2666]) and leaves each
call as A when A is inactive or not in state 0/2, otherwise as B. Invisible while every car is in state 0 (fn 5532
recomputes the candidate anyway) but visible for a car in state 1 (whirlpool trace, step 101).

## Round 3 pockets (fn 6ae5, terrain type 4 = DIR >> 5; states 4 / 5 / 0x0E), 2026-09-12
DIR is 36 bytes per block (6x6 cells), indexed by block*0x24 + cell, not per tile. Pocket records at ds:22e1 are
7 words: block x, block y, minimum [12e7] (checkpoint progress), exit x, exit y, exit heading, pocket index
(0/0x10/0x20 -> per-pocket words [2684] count, [2686] head, [2688] tail, [268a] wait, [268c..] 4-slot car queue).
Track 1 never matches. Phase [1382]: 0 = entering: match within one block and enough progress -> state 4,
knockback to the cell centre ([12be]/[12c0] = diff/4, [12c2] = 4), else 6f58 bounce (state 5). State 4 (7f62): after
the knockback the sink animation (table ds:2879, frame word at +0x12) then state 0x0E inactive, phase 1.
Phase 1 (6c01): teleport data from the record (exit x/y/heading, speed = [129c]), lists cleared, phase 2.
Phase 2 (6d94): head-to-head wait; single player falls into phase 3. Phase 3 (6df3): roll 8*[263a] px per frame
to the exit point; when there and first in the queue (and [2680] free), phase 4: active, [12d6] = 1, [12d4] = 8,
drawn (fn 7d73), and once within 0x32 px of the exit x back to state 0. State 5 (7efa): bounce animation (ds:2855)
then state 7. Renderer: states 4/5 draw the car during the knockback, then fn 7fe8 frames; 0x0E draws the car only
in phase 4 (or the phase-3 frame that pops out).

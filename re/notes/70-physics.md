# 70 Car physics (Confidence: transliterated in tools/mm/sim/race.py and step-exact against the DOSBox-X trace
# build/golden/gt/trace_r2t1 (accelerate / steer left / steer right / coast, 4 cars incl. AI, camera, ranking))

All values are 16-bit, positions in world pixels with 8-bit sub-pixel fraction, world wraps at 0xC00 (3072).
Car struct: 4 cars, base ds:124c, stride 0x164 (bx = 0, 0x164, 0x2c8, 0x42c). Offsets below are absolute
for car 0 (add bx). Per-round constants come from ds:252a (18 B per round, see 40-file-loaders/tables) via
fn 3f19..4134 into the car fields at race start.

## Car fields (established)
| off | meaning |
|---|---|
| 124a | control source index (1..4 -> word [2658 + (n-1)*2]: 4 keys1, 5 keys2, 3 mouse, 1/2 joystick, 6 AI) |
| 124c | active (in race) ; 1250 = drawn/on-screen this frame |
| 1252 | palette offset for the sprite blitter (0,2,4,6) |
| 1258/125a | x sub-pixel fraction (current / candidate) ; 125c/125e x (current / candidate) |
| 1264/1266, 1268/126a | same for y |
| 1262, 126e | camera anchor offsets (0x80, 0x64 = half viewport) |
| 1270, 1274 | target velocity vx*, vy* (from heading and speed) |
| 1272, 1276 | actual velocity vx, vy (8.8 fixed, per tick) |
| 1278 | heading 0..255 (frame = heading>>3; low nibble quantised when not steering) |
| 127a | speed (signed; negative = reverse) |
| 127c | slip threshold B ; 127e = velocity follow step A ; 1280 = inertia model on ; 1282 = sliding flag |
| 1284/1286/1288/128a | surface timers/flags (oil/ice/ramp?), while >0 use [28c2]/[28c4] as B/A |
| 128c | trigger tyre-track image ; 128e..1294 skid-mark angle state (round 2) |
| 1296, 1298 | ring indices for the tyre-track (12 B x 8) and skid (6 B x 5) buffers at 12fd / 135d |
| 129a | steering rate (heading units per tick; round 7 halves it above speed 0x320) |
| 129c | current max speed ; 129e = nominal max speed ; 12a0 = max reverse (negative) |
| 12a2 | acceleration ; 12a4 = brake decel ; 12a6 = coast friction ; 12a8 = on-track flag (from fn 5532) |
| 12aa | off-track tick counter (AI: respawn after 20) ; 12ac = collided-this-tick |
| 12ae | state (0 racing, 1 knocked/being moved, 2 ?, 5, 7, 0x0A start line?, 0x0B/0x0C H2H win/lose, 0x0D respawning, 0x0E, 0x0F, 0x10) |
| 12b0 | state tick counter ; 12b2/12b4 = tyre-track / skid emit cooldowns |
| 12ba/12bc | respawn position (x, y) |
| 12be/12c0/12c2 | knockback dx, dy, ticks (fn 73e7 moves x,y by dx,dy for c ticks) |
| 12c4..12ca | 4 probe hits: solid at (x-8,y), (x+8,y), (x-8,y-8)?, (x+8,y+8)? (see fn 5532 at 56a3) |
| 12cc | current .CT block index ; 12ce = (x_sub<<8 | y_sub) 8-px cell inside the block ; 12de = MAP byte bits 6-7 |
| 12d0/12d2 | terrain type now / previous (DIR value >> 4 or >> 5 depending on round) |
| 12d4/12d6/12d8 | jump: vertical speed, height, landed flag (fn 7429) |
| 12da/12dc | DIR byte now / previous ; 12e0 = LEV byte of the block |
| 12e1/12e3 | previous / current progress index (MAP plane 2 byte) ; 12e5 = progress changed this tick |
| 12e7/12e9 | checkpoint cursor into the per-track checkpoint list (tables at ds:1feb[round][track]) |
| 12eb | is AI (1) / human (0) ; 12ed = laps remaining (3 at start, dec on lap; <=0 finished) |
| 12f1/12f3, 12f5/12f7 | last on-track position and the one before (respawn target) |
| 12f9, 12fb | flags used by the state handlers ; 137b = input byte (see 20-input.md) |
| 137e/1380 | camera-settled flag / hold flag ; 1382 = timer ; 1384 = pending respawn ; 1388 ; 138a = bounce-halving flag ; 138e/1390 = ramp/bump state ; 1394..13a4 = jump/splash particle effect |

## Frame pacing (fn 3039, verified in the trace)
The loop body (one logic step) runs [263a] times (SMOOTHNESS: 2 = GOOD) between two screen updates; fn 90c5
only renders when [2638] == 1 (the last step of the frame), so the render side effects (sprite visibility
[1250], countdown, ranking, skid emitters, [26d1]) happen once per frame while physics runs every step.
After the last step the loop waits until cs:[4ade] (retrace count) >= byte [263c + [263a]] (table 0,1,3,5,7,32)
and copies the back buffer. At cycles=3000 a step takes longer than one 70 Hz tick, so timer-tick dumps catch
states in the middle of a step: ground truth must be sampled at the top of the loop (0822:3067), which is what
tools/gt_trace.py does (one dump per step). tools/mm/sim/race.py replays such traces step by step
(tools/sim_compare.py).

## Per step (race loop fn 3039)
1. fn 2d5b: input bytes ([137b] per car; AI cars via fn 5429, see 80-ai-collision.md).
2. fn 35f0 cheats (only while P2 key 7 is held), fn 4aee physics (below), fn 90c5 render.
3. Per car: fn 7429 (jump height integration, H2H end), fn 73e7 if state != 0 (knockback move), fn 51b2 (particles).

## fn 4aee: for each car (bx), then camera
- Race 9 special-case (state 0x0F). Catch-up flag [262f] = car is not drawn and is in the leader list [2678..267e].
- If laps remaining <= 0 (finished) and not H2H: coast to a stop (speed -= brake), count finished cars in [26c6].
- State must be 0, [1380]/[137e] camera hold handled, car active.
- Steering (input bits 0x80/0x40, rate cx = fn 4edc = [129a]): heading -= / += cx, & 0xFF. If |speed| < 0x100
  and round < 7 the speed is set to 0xFF (lets a stationary car turn). When not steering the low nibble of the
  heading snaps to 0 / 8 / next 16 (<=4 -> 0, 5..11 -> 8, >=12 -> +0x10).
- Only while racing ([2656]==2 (H2H) or fewer than 2 finished and laps > 0):
  - up+down both (0x30) -> jump trigger path (fn 4f17) ; neither -> coast (fn 4e38) unless in the air.
  - accelerate 0x20: speed += accel (x6 when catch-up), clamp to [129c].
  - brake 0x10: speed -= [12a4], clamp to [12a0] (reverse).
  - fire 0x08 without up/down: jump/splash effect on rounds with [2919]==1 or round 7 (sets 1394.. from sin table).
  - coast (fn 4e38): speed moves toward 0 by [12a6].
- After the 4 cars: fn 525e x4 (move), fn 5921 (6 car pairs, fn 5960), fn 5be7 x4 (track), then camera.

## fn 525e: velocity and position (per car; skipped when state != 0, in the air, or camera hold)
```
sin = int8 SIN[heading & 0xF8]           ; SIN = 256-byte table ds:10a0 (only every 8th entry used)
cos = int8 SIN[(heading - 0x40) & 0xF8]   ; wrap +0x100 when negative
vx* = ((sin * speed) >> 8) << 1 ; vy* = ((cos * speed) >> 8) << 1        -> [1270], [1274]
A = [127e] ; B = [127c] ; catch-up: A += A>>1, B += B>>1 ; surface timers [1284]/[1286] -> A=[28c4], B=[28c2]
if [1280] (inertia) and |vx* - vx| > B: sliding=1, vx += sign(vx* - vx) * A  else sliding=0, vx = vx*   (same for vy)
[1262]=0x80 ; [126e]=0x64
```
Skid sound when sliding (not rounds 2/8; round 6 rate-limited by [28fb]).
Position update happens in fn 5532 / 5be7: candidate = pos + (v + frac) with the 8.8 split
(x' = x + hi8(vx + fx), fx' = lo8), wrapped to 0..0xBFF; committed in fn 5da0 (candidate -> current) when the
state is 0 or 2.

## fn 5532: terrain at the candidate position
- fn 589c(x', y'): block index -> [12cc], cell (8x8) -> [12ce], MAP bits 6-7 -> [12de], progress byte cx.
  CF = COL bit set (solid). fn 585b: DIR byte -> [12da] (previous -> [12dc]).
- Solid cell (CF=1): unless a round-specific DIR class allows it (round 7: DIR>>4 in 1..7 passes; rounds 4/5:
  DIR>>4 >= 5 passes), the car has hit an obstacle: progress index updated ([12e1]<-[12e3]<-cx, [12e5]=1;
  progress 0xFF = fall/void -> respawn state 0x0D), bump sound, then 4 probes with fn 589c at
  (x-8,y), (x+8,y), (x-8,y-8), (x+8,y+8) -> flags [12c4..12ca]; if none hit, [12c8]=[12c4]=1. [12a8]=1.
- Round 3 uses a different path (5740) with DIR & 0xE0 == 0xE0 as solid and DIR bit 4 as a slow zone
  (speed capped to 0x100, [138a]=1).
- Not solid: [12a8]=0, progress update as above (round 3 skips cells flagged in table ds:25cc).

## fn 5be7: apply collision response and commit
- If [12ac] (collided with a car this tick): recompute the candidate from the new velocity.
- fn 5532, then fn 5e4e (terrain type / checkpoints / laps, see 80-ai-collision.md).
- If [12fb] and on-track flag [12a8]: AI cars off track for 20 ticks respawn (state 0x0D at [12ba]/[12bc]).
  Wall bounce: left/right probe hit -> vx = -vx ; up/down probe hit -> vy = -vy ; none -> both negated;
  halved when [138a]. Probes cleared, candidate recomputed.
- fn 5da0: commit candidate -> current position when state is 0 or 2; LEV byte -> [12e0]; if LEV bit 7 clear
  (and round 3 table allows) save position history [12f1..12f7] (respawn target). [138a]=1. Round 7 / [2919]: fn 79fd.

## Camera (end of fn 4aee)
Target [2646],[2648] = leader car ([27b7 + [27b5]*2] selects; H2H = midpoint of the two players - (0x80,0x64))
minus the anchors [1262],[126e]. Camera [264a],[264c] moves toward the target by [264e]/[2650] per axis; when the
remaining distance is <= the step (or >= 1001, i.e. a wrap) it snaps and the step becomes 0x32 (50). At race start
the step is 4 (fn 7759) which gives the slow opening pan. [137e] per car = 1 when both steps are 50 (camera settled).

## Jumps (fn 7429, per car)
[12d6] height, [12d4] vertical speed: height += vspeed >> 2, vspeed -= 1 each tick; on landing (height <= 0)
vspeed = -vspeed - bounce[round] (ds:24ff) unless [12d8] set (then stop). Round 2 sets [128c] (splash/track mark).
Landing with [1384] pending -> respawn. Sounds via driver fn 5 (al = effect id).

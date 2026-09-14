# 20 Input (int 9 handler at cs:2efd, the game port and the mouse)

Confidence: verified by disassembly. Ported in `src/engine/keyboard.ts` (the handler) and
`src/hal/input/scancodes.ts` (DOM `KeyboardEvent.code` to XT scancode); fn 2d5b is `pollInput`
in `src/engine/race.ts`, and the joystick and mouse behind it are `src/hal/input/Analogue.ts`.

```
pusha; push ds/es; ds=093C
al = in 60h; ah = scancode; ack via 61h (or 80h / and 7Fh)
if scancode == E0h: cs:[2f99] = 1 (E0 prefix pending); goto eoi
if scancode in {2Ah, 36h} (shift make) and cs:[2f99]==1: cs:[2f99]=0; goto eoi   ; fake shift after E0
make = (scancode & 80h) == 0; ah = scancode & 7Fh
if make:
    if ds:[107f]==0: ds:[107f]=ah                                  ; the key being held
else:                                                              ; a completed keypress
    if ds:[107e]==0 or ds:[107f]==ah: ds:[107f]=0; ds:[107e]=ah; if ah==1 (Esc): ds:[1096]=1
search ah in 16-byte table ds:[106c..107b] (the SETTINGS.DAT scancodes, copied there by fn 2770)
    i = index found; mask = 0x8000 >> i
    make:  ds:[107c] |= mask      break: ds:[107c] &= ~mask
eoi: al=61h; out 20h  (specific EOI IRQ1; BIOS int 9 is NOT chained)
```
- **`ds:[107c]` = 16-bit key state bitmask**, bit 15 = table entry 0 (P1 key 1) ... bit 0 = entry 15.
  Table order (SETTINGS.DAT +16): P1 [left,right,up,down,k5,k6,k7,k8] then P2 same (to confirm
  semantics of each slot from the game code that reads [107c]).
- `ds:[107f]` = the key being held (the first one down), **`ds:[107e]` = the last key released**, `ds:[1096]`
  = Esc pressed. Every menu waits on `[107e]`, so a key only counts once it comes back up.
- Note: the E0 prefix flag is set but not otherwise used for matching: extended keys (arrows,
  Ins) match by their base scancode (4B/4D/48/50/52), same as the numeric keypad keys.
- `ds:[262d]` seems to be a hardware-detection flag used to choose the default sound driver.

## SETTINGS.DAT -> memory (fn 2770)
words -> [0f5f]=w0 (4), [0f61]=w1 (5), [263a]=w2 (2), [0f64]=w3 (1 = driver index -> DRIVERn.BIN),
[28fd]=w4 (10), [28ff]=w5 (200), [2905]=w6 (10), [2907]=w7 (200); 16 scancodes -> [106c..107b].
Meanings of the words still to be determined.

## Input byte per car (fn 2d5b, per frame) -- Confidence: verified by disassembly
Control source per car slot = word [0x2658 + slot*2]; fn 2d00 fills the function table [0x1083..0x1089]:
| source | function | meaning |
|---|---|---|
| 4 | 2dfa: al = [0x107d] | keyboard set 1 (P1 scancodes, high byte of the bitmask) |
| 5 | 2dfe: al = [0x107c] | keyboard set 2 (P2 scancodes, low byte) |
| 3 | 2e02 | mouse (int 33h): buttons -> 0x28/0x10, position vs centre (160,100) +-[0x290d] -> dirs; recentres |
| 1 | 2e6c | joystick A (port 201h, fn 2f9e); thresholds [0x28fd]/[0x28ff]/[0x2901]/[0x2903] |
| 2 | 2eb3 | joystick B (fn 2fcc); thresholds [0x2905]..[0x290b] |
| other | 2ded | AI: 0, or fn 5429 when [0x1082] != 0 |
Results -> [0x137b], [0x14df], [0x1643], [0x17a7] (car 0..3, = car struct + 0x12f?), and
[0x108b] = [0x137b] | [0x14df] (both players) or *[0x1080] when [0x1080] != 0 (menus pick a source).
**Bit layout** (same for keyboard, joystick and mouse): 0x80 left, 0x40 right, 0x20 up (accelerate),
0x10 down (brake), 0x08 fire (P1: Alt, P2: Ins), 0x04/0x02/0x01 = keys 6-8 (F1-F3 / D, Space, V).
So SETTINGS.DAT scancode order is [left, right, up, down, fire, k6, k7, k8] per player.
Menus: fn 0382 (SELECT GAME etc.) waits for fire release, then left/right (0x80/0x40) move the
highlight and fire confirms; Esc ([0x107e]==1) or 2000 ticks without input cancels. The title and
the options screens take any key at all ([0x107e] != 0); fn 2bd8 compares it with 0x1C (Return).
Race loop fn 3039: per tick fn 2d5b, then cheats (fn 35f0 when P2 key 7 (Space) is held: bit 1 of
[0x107c]), fn 4aee, render fn 90c5, per car fn 7429 (+ fn 73e7 when state != 0) and fn 51b2, frame
pacing by [0x263a] (smoothness) against the retrace counter cs:[0x4ade], then copy fn 92bc.

## The game port and the mouse -- Confidence: verified by disassembly, never captured

No retail install has a joystick, so none of this is in the DOSBox captures; it is checked against the
listing only, in `test/engine/devices.test.ts`.

**fn 2d5b head.** fn 2d00 leaves a bitmask in `[108c]` (bit 0 = stick A in use, bit 1 = stick B). Once per
frame fn 2d5b reads the port for whichever sticks that names -- fn 2f9e (A), fn 2fcc (B), fn 2ffe (both) --
and leaves the four counts in `[108d]` (AX) `[108f]` (AY) `[1091]` (BX) `[1093]` (BY) and the **inverted**
button byte in `[1095]`, so a set bit there means a button is down: 0x10/0x20 = stick A buttons 1 and 2,
0x40/0x80 = stick B's. Each read is the classic one-shot count: write port 201h, then `in` in a loop of up
to 0x7530 turns, adding the carry of each axis bit into its own register until the axes being watched have
both gone low. An unplugged stick therefore counts 0, which reads as hard left.

**fn 2e6c / 2eb3 (the handlers).** Only the X axis is used: `<= [28fd]` is left, `>= [28ff]` is right (and
`[2905]`/`[2907]` for stick B). Button 1 brakes, button 2 accelerates, either one fires, and both together
set both. The Y axis is read, stored and compared against `[2901]`/`[2903]`, but every one of those
comparisons has its flags thrown away before anything reads them, so **up and down on the stick do
nothing**. That is a bug in the original and the port keeps it.

**fn 2ab5 / 2b93 (F7 on GAME OPTIONS).** CENTRE, LEFT and RIGHT, each read when a button goes down, with
PLACE JOYSTICK THEN PRESS FIRE blinking underneath. Each threshold ends up halfway between the centre and
that end, so a direction counts from half deflection on. Offered only when fn 3a12 (int 15h ah=84h) found a
stick: `[2625]` = how many, `[2627]` = whether fn 3a44 found a mouse.

**fn 2e02 (the mouse).** int 33h fn 3: the left button is accelerate + fire (0x28), the right one is brake
(0x10), and the pointer's distance from (160, 100) steers, with `[290d]` = 3 pixels of slack. Any frame that
moved warps the pointer back to the middle (int 33h fn 4), so the driver is always reporting one frame of
movement.

**In the browser** (`src/hal/input/Analogue.ts`): one gamepad per stick, with an axis of -1..+1 mapped onto
the same scale the calibration screen would have measured, so a direction registers from half deflection and
running F7 measures the numbers it already has. The pad's first button is wired to the stick's *second* one,
because that is the one that accelerates. The mouse needs pointer lock, since only relative movement can
imitate a pointer that is recentred every frame.

# 50 Front end (options, title, menus, character select, pre-race and results screens)

Confidence: transliterated from the disassembly and verified pixel by pixel against DOSBox-X captures
(`build/golden/gt/front`, `tools/gt_front.py`; `test/engine/frontend.test.ts`). Ported in `src/engine/frontend.ts`
(graphics engine) and `src/engine/screens.ts` (the screens themselves).

## Ghidra listing gotcha

Ghidra applied the EXE relocation table with load segment 0x1000, so **every segment immediate in
`re/exports/MICRO_U.EXE/listing.asm` is 0x1000 higher than the byte in the file**: `MOV AX,0x7d78` is really
`mov ax,6d78`. Data in the data segment is relocated the same way at load time, so the image headers and object
records hold *absolute* segments in a DOSBox-X dump (load segment 0x0822) and relative ones in the file image.
The port keeps everything relative; `ndisasm -b16` on the depacked image gives the unrebased truth.

## Second renderer

The front end never uses the race renderer. It draws into a buffer at segment **6D78** with a stride of
**0x110** (272) bytes; the visible area is **256x200** starting at offset **0x888** (row 8, column 8), and
fn 08bc copies it to VRAM at offset 0x20, i.e. x = 32. The 32-pixel columns either side of the 320-pixel mode
are never written by a menu. All menu coordinates are therefore 0..255 horizontally and 0..199 vertically.

## Graphics data

| what | where |
|---|---|
| COMPRESS.PI0..6 | fn 26c0 -> 3547, LZ, one 0xC000-byte bank per part from segment **1B78** |
| image headers | ds:0A14..0B7C, 0x14 bytes: name (13, NUL), +0D height, +0F width, +11 frame count, +12 segment |
| object records | ds:0B7C..0D62, 0x1B bytes each (see below) |
| sprite save buffers | segments 6C48/6C68/6C88/6CA8 = the free space *inside* the PI region after FRAME.CHR |
| palette | INTRO.PAL, loaded by fn 07a0 (called from 26ec) |

Images are raw 8bpp, width x height per frame, frames stacked; colour 0 is transparent for sprite blits and
for glyphs, opaque for fn 053a.

| image | size | frames | use |
|---|---|---|---|
| FCHAPPY / FCSAD / FCFROWN / FCNORMAL.CHR | 48x48 | 16/16/11/14 | driver faces; normal frames 12/13 are the "out" and "?" markers |
| THUMB.CHR | 48x32 | 3 | the pointing hand that marks a menu choice |
| MINATURE.CHR | 32x16 | 38 | small cars: frame = (round - 1) + 8 * car slot |
| BADGE.CHR | 72x32 | 1 | header badge |
| CASE.CHR + CASE.MAP | 8x8 tiles | - | the championship board drawn by fn 0710/198e |
| CUP.CHR | 96x8 | 10 | trophy |
| INTRO.CHR | 96x64 | 9 | the vehicle picture of each round |
| WORDS.CHR | 96x16 | 3 | "MicroMachines", "Challenge", "Head to Head" |
| SELGAM.CHR | 96x64 | 6 | the four menu pictures |
| LOGO.CHR | 248x96 | 1 | title logo |
| NOS.CHR | 24x32 | 4 | the finishing position numbers 1..4 |
| FONT1.CHR / FONT2.CHR | 8x8 / 8x16 | 38 | 0-9, A-Z, then '!' (36) and '?' (37) |
| FRAME.CHR | 8x8 | 4 | the frame around the selected character |

## Object record (0x1B bytes)

| off | meaning |
|---|---|
| +00 | image header pointer (data segment) |
| +02 | x, signed (clipped against 0..255) |
| +04 | y, signed (clipped against 0..199) |
| +06 | save-buffer segment (0 = do not save) |
| +08 | source segment, copied from the header by fn 049c |
| +0A | 1 = draw mirrored |
| +0B | frame size = width * height |
| +0D | source offset, computed by the clip |
| +0F | height |
| +11 | width |
| +13 | frame index; the high byte selects a face expression (see fn 0db0) and bit 4 flashes |
| +15 | destination offset, FFFF when fully clipped |
| +17 | source bytes to skip per row (horizontal clipping) |
| +19 | rows to draw (byte) |
| +1A | columns to draw (byte: a 256-wide image would store 0) |

## Primitives

| fn | meaning |
|---|---|
| 049c | bind a record to its image header (height, width, frame size, segment) |
| 0630 | clip to 256x200, fill in +0D/+15/+17/+19/+1A; carry = nothing visible |
| 053a | clip + opaque blit (mirrorable) |
| 04b8 | clip + save background + blit with colour 0 transparent (04bd skips the clip) |
| 05f3 / 05b4 | save / restore the background rectangle |
| 06cc | clip + one-pixel outline around the record in colour AL (ignores the clip result) |
| 0710 | 8x8 tile map (CASE.MAP over CASE.CHR) straight into the buffer |
| 07e5 | replace one colour with another inside a rectangle |
| 0823 | filled rectangle (x, y, rows, width, colour) |
| 0862 / 0876 | fill whole rows / the whole screen |
| 089c / 08bc | present rows y..y+n / the whole screen |
| 08f0 | draw string number CX of a NUL-separated list (AX = FFFF centres it) |
| 0910 / 0929 / 0999 | centred string / string at x (negative x scrolls in) / one glyph |

Quirks kept in the port: the vertical clip for a negative y adds `visible_height * height` to the source
offset instead of `-y * width`; the column count is stored in a byte; fn 0910 centres on 0x7F, not 0x80.

## Screens

| fn | screen |
|---|---|
| 2770 | GAME OPTIONS (also reads SETTINGS.DAT the first time) |
| 2be8 | PLAY WHICH GAME SET ? (only when a GAME?.LVL file exists) |
| 0100 | title: logo, copyright, and a vehicle picture that changes every 0x118 ticks |
| 0220 | SELECT GAME: one player / two players |
| 02e0 | one-player menu: Head to Head / Challenge |
| 0382 | the selection loop shared by both menus (hand cursor, 2000-tick timeout) |
| 09e0 | character select: an 11-slot carousel 0x40 pixels apart on a 0x2C0-wide ring ([0192] = scroll) |
| 0d1f / 0db0 / 0f17 / 0e02 | carousel strip / one face / a character label / the frame around the middle slot |
| 0c15 / 0c5d | PRESS ANY KEY TO START and its blinking vehicle name |
| 0eba | reset the carousel and the four cars' choices |
| 11f8 | the card before each race (round 9 bonus, first race, or faces + track name + miniatures) |
| 1867 | the track's name, with "RACE nn" beside it except on the last race |
| 19f2 | the row of driver faces at the top of a screen |
| 13e4 | RESULTS!!: four slots, miniatures driving in, QUALIFY / FAILED, winner and loser flashing |
| 1c1b | the lives screen (two players) |
| 16de | "<name> IS OUT!!" |
| 1aad | championship winner |
| 10a0 / 115c | the race sequence: pick round and track from ds:043C, pre-race card, race, results |

## Input loops

Ported in `src/engine/menus.ts`, one generator per routine: each wait for the int 8 tick counter is a
`yield`, so the browser (src/app/game/main.ts) drives the whole front end a tick at a time, and fn 102b's
call to fn 10a0 becomes a `yield 'championship'`. Verified against the capture's key script in
`test/engine/menus.test.ts`: replaying the presses walks the same menus and lands pixel-exact on the title,
SELECT GAME, the one-player menu and the character select.

| fn | loop |
|---|---|
| 0032 | title, then SELECT GAME over and over; Esc at the title leaves the game |
| 0100 | title: any key starts, Esc quits, the vehicle changes every 0x118 ticks |
| 0382 | hand cursor: left = choice 1, right = choice 2, fire confirms, Esc or 2000 idle ticks cancel |
| 0220 / 02e0 | the two menus around fn 0382; [0130] / [0132] remember the last choice |
| 102b | Challenge: [1080] = 137b (player 1 drives the menus), pick a character, press any key, race |
| 09e0 | carousel: fire takes the face in the middle unless it is taken ([0160] > 0x0A) |
| 0ab5 | the chosen face flashes five times (bit 0x10 of the frame word), 0x10 ticks apart |
| 0cd3 | one slot of scroll: 13 steps from the ramp at [0185] (2 2 2 2 4 4 4 4 8 8 8 8 8 = 0x40), a tick each |
| 0c15 | PRESS FIRE TO START: the prompt blinks for 0x2bc ticks or until a key |
| 179b / 17ff | wait for the button to come up and go down again / wait n ticks, abortable |
| 0b51 | which half of the keyboard a player drives with; skipped when [2656] == 1 or [265a] == 6 |
| 1a4a | after qualifying, a character select for every car whose frame word is still 0x0B (the three rivals), then PRESS ANY KEY; Esc asks again for the same car |
| 18d8 / 198e | the championship board: a CASE.CHR tile map with one MINATURE car per race run, the last one blinking. The position of each comes from the word table at [0312] and the frame from the championship table (round - 1 plus track * 8). Round 9 gets two columns of cars flashing over it instead (fn 192b) |
| 1c1b tail | the lives: the old count slides from y 0x8c to 0xc8 (or back, for a life won) while the face flashes, and [0406] changes on the way |
| 16de | "<name> IS OUT!!": the driver is marked 0x20 on the carousel, their face sinks into its own seat and comes back up twice before it goes for good, then fn 1a4a fills the empty seat. The loop holds the seat's y in cx (it adds the step from the table at [034b], stores, then subtracts it straight back), so every step is measured from the seat, and the matching `sub [bx+19],al` after fn 0630 keeps the bottom edge still. Stepping from the previous position instead walks the face off the screen and underflows that row count into a byte near 0xff, which blits thousands of rows through the buffer and the save segments behind it |
| 1aad | the champion: the trophy is stacked out of the ten slices of CUP.CHR, the winner's face creeps up the screen flashing, and the title and the name slide in from either side ([03aa] and [03ac]) |

The screens with their own wait loops (fn 18d8, 1c1b, 16de, 1a4a, 1aad) are generators like the menus, driven
by game.html a tick at a time. Their animation speed in the original is set by how long the drawing takes;
the port gives each pass of those loops one tick.

Two things the port leaves out: fn 32ce (a buffer effect guarded by [26ce], never 1 in the menus) and the
sound driver calls (far calls to 1424:0000 with ah = 4/6/7/8/9).

The keys are the ones in SETTINGS.DAT: player 1 drives with A/D/W/S and Alt, player 2 with the arrows and
Ins, and in a one-player Challenge fn 102b parks car 1 on source 6 (AI), so in DOS the arrows do nothing at
all. game.html therefore aliases the arrows and Return onto player 1's own scancodes ([106c]..[1070]) before
handing them to the int 9 port, which is a page convenience, not a change in the game's own input.

## State

| address | meaning |
|---|---|
| [0130] / [0132] | last choice on the SELECT GAME / one-player menus |
| [0156] | game mode word drawn in the header (0 = none, 1 = Head to Head, 2 = Challenge) |
| [0160] | character under the middle of the carousel |
| [0162] | carousel scroll direction |
| [0164..016E] | the 11 carousel slots; bit 0x40 marks a character already taken, 0x20 one that is out |
| [016F..017E] | the eight scroll positions a slot can rest at |
| [0185..] | the acceleration ramp used when the carousel scrolls one slot |
| [0192] | carousel scroll position (0..0x2C0) |
| [0194] / [0196] / [019A] | prompt font / y / string |
| [019E] | the car record currently choosing a character |
| [03F4] / [03F6] | the character each player picked last time |
| [03F8] | 1 = two players |
| [03FA] | lives-ish counter used by the race sequence |
| [03FC..0402] | the four car records in finishing order |
| [0406..0409] | lives per car |
| [0439] | number of races in the championship (0x19 = 25) |
| [0f5f] / [0f61] | the input device of each player, handed to [2658] / [265a] when GAME OPTIONS closes |
| [261f] | a second tick counter, used by the carousel and the PRESS ANY KEY screen |
| [043C..] | the championship table: one byte per race, `round = b >> 2`, `track = (b & 3) + 1` |
| [0460..] | the 36 track names |
| [09D8] | the round whose vehicle name blinks on the PRESS ANY KEY screen |
| [28BF] / [28C0] / [28C1] | round / track / race index |

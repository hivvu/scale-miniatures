# 90 Sound: the Sound Images driver and the game's sound data

Confidence: read from the driver binaries and MICRO_U.EXE, ported in `src/engine/sound/`, and validated
byte for byte against the real driver under DOSBox-X (see "Ground truth" below). Only DRIVER2, the PC
speaker one, is still unported.

The game does not synthesise anything itself. It loads one of the DRIVERn.BIN files at **relative segment
0x1424** (right after its own image, which ends at 0x1423D) and calls it as `call far 1424:0000` with the
function number in `ah`. The files are *Sound Images Generation 2 sound drivers (c) 1992-94 Tony
Williams/Sound Images*, and they carry the game's sounds and instruments inside them.

| file | size | device |
|---|---|---|
| DRIVER0.BIN | 8 | no sound: `mov ax,0` / `retf` twice |
| DRIVER1.BIN | 28625 | AdLib / Sound Blaster (OPL2 at 0x388), 16 channels |
| DRIVER2.BIN | 11845 | PC speaker (PIT channel 2), 4 channels |

`[0f64]` (SETTINGS.DAT word 3) picks the file; fn 321c patches the digit into the name at ds:11da, reads the
whole file to 1424:0000 and calls the driver twice.

## Loading and the two entry points (fn 321c)

```
[0f64] + '0' -> ds:11e0            ; "DRIVERn.BIN"
cs:[3279] = 0                      ; the int 8 handler stops calling the driver while it loads
open, read 0xFFFF bytes to 1424:0000, close
ah=0, dx=0x388, bx=[000b], cx=[000d]  -> call far 1424:0   ; init (bx/cx are 0 in this game)
do { ah=2, cx=0x4287 -> call far 1424:0 } while (al != 0)  ; PIT divisor per game tick
cs:[3279] = 1                      ; int 8 now calls ah=3 once per tick (70.086 Hz)
```

Offset 0 of the driver is `call dispatch / retf` and offset 4 is `call dispatch / iret`, so the same table
serves a far call and an interrupt hook. The dispatcher checks `ah` against a byte that **fn 0 sets to 0x10**
(DRIVER2 [0x124], DRIVER1 [0xc3]), so nothing but the init works until the device is there; the table of 17
handlers follows it.

## The API

| ah | what it does | where the game uses it |
|---|---|---|
| 0 | init: dx = OPL/PIT port, detect the chip, silence it, allow ah 1..0x10 | fn 321c |
| 1 | shut down: speaker off, only ah=0 allowed again | fn 49af (exit) |
| 2 | cx = PIT ticks per tick of ah=3; works out the sequencer's timing constants. Returns al = 1 (retry) when cx < 0x445 | fn 321c |
| 3 | one tick of the sequencer: run the request queues, advance every channel | int 8 (fn 489c), guarded by cs:[3279] |
| 4 | stop sound al | always paired with ah=9 |
| 5 | queue sound al on the effects queue (8 slots; al = 1 returned when it is full) | the race: al = 1..0x10 |
| 6 | stop everything and clear both queues (deferred to the next tick) | after ah=8, at every screen change |
| 7 | stop the channels but keep the queue (deferred) | before a race, at the title |
| 8 | queue sound al on the second queue | menus and the race |
| 9 | al - [playing]: 0 when sound al is not playing | before every ah=4 |
| 0xa | look for al in the four/sixteen channel slots | rare |
| 0xb | count the channels whose state == ah | rare |
| 0xc / 0xd | return a constant (0x57 / 0x67) | not used |
| 0xe | set a global pitch/volume word | rare |
| 0xf / 0x10 | set or clear bits 0/1 of the driver's mode byte | 3 call sites |

## Songs

`[0x13f0]` points at the song bank, which in DRIVER1 is everything from 0x13f6 to 0x652e, about 20 KB, the
bulk of the file. **The game's music is in there: eight songs of four to eight tracks each.**

```
byte  count                     ; 8
word  table                     ; offset of the header table, relative to the bank (0x652e - 0x13f6)
...
table: word header[count]       ; each relative to the bank
header: word tempo              ; goes to [125e] and is multiplied by [125f]
        byte tracks
        word track[tracks]      ; each the start of a sequence, relative to the bank
```

Function ah=4 asks for a song (the request sits in [125a] until the next tick), ah=9 says which one is
playing ([125b]). Fn 0606 starts it: every channel is silenced, one slot per track is filled in with state 1,
and the tempo is worked out again. Slots in state 1 run at the song's tempo, slots in state 2 (the effects)
at a fixed rate.

Which screen plays what: 1 title and SELECT GAME, 2 character select and head to head, 3 champion, 5 the
card before a race, 6 results and "IS OUT!!", 8 the verdict.

## Sound bank

`[0x13f2]` (DRIVER1) / `[0x74b]` (DRIVER2) points at the bank inside the file:

```
byte  count                     ; 18 in DRIVER1, 15 in DRIVER2
word  offset[count]             ; relative to the start of the bank
      sequences...
```

Sound numbers **below 0x40** index this table (`si = bank + bank[1 + (al-1)*2]`). Numbers **0x40 and above**
are not sequences in the bank at all: they play the 16-byte record at `driver:0008 + (al - 0x40) * 16`, four
little looping sequences the game overwrites to make the engine notes.

## Sequence format (the same for both drivers)

A sequence is a stream of `delta, event` pairs, starting with a delta. Deltas are MIDI variable-length
quantities (fn 0x925 in DRIVER1, 0x599 in DRIVER2, up to five bytes, 0xFFFF... = stop).

| event | meaning |
|---|---|
| 0x00..0x7F | note on: the byte is the note, the next byte the velocity |
| 0x80..0x8F | use channel n (low nibble); the channel's operator pair comes from a table in the driver |
| 0x90 | note off for the note in the next byte |
| 0x91 | end of sequence: the slot is freed |
| 0x92 | instrument: the next byte picks a 16-byte record |
| 0x93 | tempo: the next byte, then the timing constants are worked out again |
| 0x94..0x97 | one byte each; 0x95 is used by the engine records (pitch) |
| 0x98 | jump back to the loop point |
| 0x99 | all notes off on this channel |
| 0x9a | jump to a fixed empty sequence inside the driver |
| 0x9b | one byte |
| 0x9c | set the loop point to here |
| 0x9d | two bytes |
| 0xff | nothing (just the delta) |

All 18 DRIVER1 sequences parse cleanly to their 0x91 with these lengths (`tools/mm/sound.py`). They are short:
ten bytes for a single note with a length, 36 to 68 for the arpeggios the menus play, and three of them loop
with 0x95 (the engine).

## Instruments (DRIVER1)

`[0x13f4]` points at 0x6751: a 128-byte note table (`xlatb`, all zero in this game) followed by 128 records
of 16 bytes from 0x67d1 to the end of the file. Fn 0x398 (event 0x92) writes them to the OPL as
`reg 0x60+op = [bx+0]/[bx+1]`, `0x80+op = [bx+2]/[bx+3]`, `0xe0+op = [bx+6]/...`, with the operator offsets
of the channel in [di+0x0c]. Register writes go through fn 0x175 (al = register, ah = value).

## Ported

- `src/engine/sound/driver.ts` = the driver itself: the bank, the songs, the instruments and the sequencer
  (fn 021a with its queues, fn 0606, fn 0273/0294 and every event handler), producing the register writes fn
  0175 would make.
- **The two write routines matter.** Fn 0175 compares against the driver's own shadow of the chip at 0x114d
  and skips a write that would change nothing; fn 019d always writes. The shadow ships full of 0xff, and the
  reset (fn 00e8) and the silence list at 0x104a go through **fn 019d**, so they really do set every
  operator's 0x60 and 0x80 registers to 0xff (fastest attack, decay and release) and the levels to 0x3f.
  After that an instrument byte of 0xff is correctly skipped by fn 0175. Sending the reset through fn 0175
  instead leaves the chip at its power-on zeros, which means a release rate of zero: every note keeps
  sounding after its key-off and the game gets a wall of drones behind the music. That was the first bug
  found by ear.
- `src/engine/sound/opl2.ts` = the YM3812: nine two-operator channels, the logarithmic sine and exponential
  tables, four waveforms, feedback, key scaling, the tremolo and vibrato LFOs and the four-stage envelope.
  Hardware, not game code, so it is modelled rather than transliterated. Three things have to be right or
  everything sounds harsh: the exponential table is a *falling* mantissa (2^((255-i)/256) * 1024, doubled on
  the way out, so a full-scale operator peaks at 4084), the modulator's output is added to the carrier's
  phase index as it stands, and feedback is `(previous + current) >> (9 - fb)`.

Only the OPL2 is used: the driver talks to port 0x388 and nothing else, so a Sound Blaster plays this game
through the same FM chip as an AdLib and none of its digital side. The game does look for a Sound Blaster
(fn 3a12 probes 0x210..0x260 for 0xAA on base + 0x0a) but only to decide the default device: [262d] = 1
gives DRIVER1, otherwise DRIVER2, and SETTINGS.DAT word 3 overrides both.

## Ground truth

The driver is checked against the real one, tick for tick. Two things had to be right first:

- **SETTINGS.DAT word 3 = 1.** That word is [0f64], and fn 321c patches it straight into the file name
  `DRIVER?.BIN`. Nothing else chooses: fn 321c always passes dx = 0x388 to the driver's init, whatever the
  Sound Blaster probe found. (The probe, fn 3a8d, only picks the *default* when there is no SETTINGS.DAT;
  fn 3a12 next to it is the joystick, not the sound.)
- **An OPL2 that answers at 0x388.** The driver's fn 0 does the classic AdLib timer detection (reset the
  timers, read the status, start timer 1, read the status again, expect 0xc0). If it fails it leaves its
  dispatch limit [00c3] at 0 and every other function returns 0xffff, so fn 321c's `ah=2` loop at 3262 spins
  for ever: that is the "never reaches the first timer tick" of the earlier attempts, not a DOSBox problem.
  `sbtype=sb2` with `oplmode=opl2` works.

A Sound Blaster in the conf also puts `BLASTER=...` in the DOS environment, which pushes the load segment
from 0x822 to **0x824**, hence `MM_LOAD_SEG` in tools/gt_frame.py.

```
# 16 samples, 10 ticks apart, of the title song
MM_LOAD_SEG=824 python3 tools/gt_opl.py build/dos-snd/run_sound.conf build/dos-snd build/golden/gt/sound/opl 16 10
# the same for the character select's song: MM_OPL_SWITCH=n walks the menus before sample n
MM_LOAD_SEG=824 MM_OPL_SWITCH=0 python3 tools/gt_opl.py build/dos-snd/run_sound.conf build/dos-snd \
    build/golden/gt/sound/opl_song2 12 10
MM_LOAD_SEG=824 python3 tools/gt_sound.py build/dos-snd/run_sound.conf build/dos-snd build/golden/gt/sound
```

`gt_opl.py` dumps the driver's whole work area, 1100..1440, every `step` game ticks: the 256-byte register
shadow at 114d, the sixteen 0x16-byte channel records at 1271, the two eight-slot request queues at 13d1 and
13d9, and the tempo rate/accumulator pairs at 1261/1265 (music) and 1269/126d (effects). int 8 calls the
driver's ah=3 exactly once, below the breakpoint, so `frames(n)` is exactly n driver ticks.

`test/engine/opl_trace.test.ts` seeds `SoundDriver` with one sample (`loadState`), runs the ticks in between
and compares the shadow, the channel records and the queues against the next (`saveState`). It picks up every
`build/golden/gt/sound/opl*` directory and matches byte for byte: 15 intervals of song 1 and 11 of song 2,
150 and 110 driver ticks. An interval the capture spends walking the menus is skipped, because the game asks
for another song in the middle of it and the driver alone cannot know.

Still against the disassembly only: the engine notes (fn 7b46 writes a new pitch into the record between
ticks, so a seed-and-step comparison cannot line up).

**DRIVER2, the PC speaker, is not ported.** Rather than leave SPEAKER on the GAME OPTIONS screen as a silent
choice, the page passes `FrontEnd.soundDevices = [0, 1]` and F3 steps over it; a SETTINGS.DAT that asks for
it is read as asking for BLASTER. The engine keeps the original's three-way cycle when that list is not set.
DRIVER2 is the same Sound Images driver with the same seventeen functions and the same sequence format, so
porting it would mostly be a new output stage (the PIT channel 2 square wave) under the sequencer that is
already there and now proven.
- `src/hal/audio/SoundOutput.ts` = Web Audio: renders at the chip's 49716 Hz, resamples to the browser's rate
  and schedules 50 ms buffers 200 ms ahead, ticking the driver on the audio clock.
- `tools/mm/sound.py` dumps a sound or a song as events; `test/engine/diag_sound.test.ts` (with
  MM_SOUND_WAV set) renders one to a WAV.

Wired into game.html: the songs at the title, SELECT GAME, the character select, the card before a race, the
results board and the verdict, and the silence fn 11aa and fn 3104 ask for around a race.

The race is wired too. Its 24 ah=5 / ah=0a calls were already recorded by `Race.sounds` (a queue of
`{fn, arg}`), which game.html now drains into the driver after every step: fn 5 plays, fn 0a plays only if
that sound is not already on a channel.

## Levels

Fn 0567 turns the instrument's two level bytes into the chip's 0x40 registers, and there are three things
worth spelling out because each of them changes the timbre:

- The carrier's level (byte 0x0b) is scaled by the note's velocity, the channel volume ([di+11]) and the
  global volume ([1256]) before it is looked up. The modulator's (byte 0x0a) is scaled the same way **only
  when the pair is additive**; in FM the modulation depth must not follow the velocity.
- Either way the result goes through the driver's own 129-byte table at 0x10cc, which turns loudness
  (0..128) into the chip's attenuation (0x3f..0x00). Writing the instrument byte straight to the register
  leaves the modulator far too quiet and the FM far too clean.
- Byte 0x0c holds both key scale levels: bits 1-0 for the carrier (`ror` twice) and bits 5-4 for the
  modulator (`shl` twice).

## The engine note (fn 7b46)

Called at the end of fn 90c5, so once per displayed frame, and only with the OPL driver. Per car:

```
pitch = min(|speed|, 0x7ff) / 10
if [12d4] != 0 (in the air): pitch += 0x30
if [1382] != 0 (reappearing): pitch = 0x14
if [1250] == 0 (not on screen): pitch = 0x0a
pitch += (random() & 3) - 2 ; if negative, negate
record[+0a] = pitch                      ; the argument of the 0x95 pitch bend
record[+0c] = pitch ? 0x98 : 0x91        ; loop on, or end the sequence
if looping and sound 0x40+car is not playing: play it
```

The record is `00 92 70 00 9c 00 23 7f 01 95 <pitch> 00 <98|91> ...`: instrument 0x70, a loop point, one
note, then the bend the game keeps rewriting. The loop comes back round about every game tick, but **the
note is not struck again**: fn 0294 skips the key-off before a note when the channel is in state 2 with a
sound number of 0x40 or more, so an engine is one note held down for ever whose pitch is bent. Keying it
again each time turns the engine into a buzz at the loop rate, which is not what the game sounds like.

Fn 7ab7 would have given each round its own engine (instrument 0x71 for the cars, 0x70 for the boats of
round 2, and a slower loop for round 8) but nothing in this build calls it, so every round uses the record
as it ships: instrument 0x70. Ported as `Race.engineSound` plus `SoundDriver.engine`;
`Race.random` is fn 7cae, whose three seed words overlap by a byte in the code segment.

fn 7af8, which silences the engines by zeroing all four cars' speeds when the driver is the OPL one (so the
sound setting reaches the physics), came in with the head to head. Only the PC speaker driver is left.

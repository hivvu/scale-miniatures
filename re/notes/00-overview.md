# 00 Overview

## Binaries
- `MICRO.COM` (472 B): launcher. EXEC `SM.EXE`; if exit code == 2, EXEC `MICRO.EXE`.
- `SM.EXE` (4832 B): plain MZ, 512 B header, entry file offset 0x988. Front-end; writes `SETTINGS.DAT`.
- `MICRO.EXE` (28955 B): PKLITE 1.15 (extra + large model). Unpacked by `tools/mm/pklite.py`
  into `re/unpacked/MICRO_U.EXE` (gitignored).
  - Unpacked image: 82493 B (0x1423D), 279 relocations, all in segment 0 of the image.
  - Header of the rebuilt file: 0x480 B (0x48 paragraphs). Image starts at file offset 0x480.
  - sha256 of MICRO_U.EXE: 4ae15df4851116f9a415acebebd4f5136fbacab9872ad88d34655f13a40c6e30
  - Entry CS:IP = 0000:0006, SS:SP = 7D78:0400 (stub) / program sets SP = 0x3E8 itself.

## Segments (relative to load segment)
Derived from relocation targets in MICRO_U.EXE:
- `0000` code (single code segment, near calls)
- `093C` data segment (DS set at entry: `mov ax,93Ch; mov ds,ax`)
- `1424` first paragraph after the image: runtime buffers/overlays start here.
  Entry does `mov ah,7; call far 1424:0000` right after `int 10h ax=13h` (overlay API?).
- Other referenced segments: 1B78 1B88 27D8 3438 3A68 3B78 4248 4368 4478 4828 48B8 4A48 4A73 4C4F
  4D78 59CF 5AEF 5D78 63F0 69C0 6A80 6B18 6C48 6C68 6C88 6CA8 6CDB 6D78 (buffers), 7D78 (stack).
- Total memory needed by the stub: 0x7DA9 paragraphs above load segment (~514 KB).

## Startup sequence (image offsets, CS=0)
```
0006 call 31F0          ; init/detection, returns AX (0 = failure -> jmp 00C6)
0010 mov ds,093C; mov ss,7D78; mov sp,03E8
001D call 7A75
0020 mov ah,0F; int 10h ; save current video mode -> ds:[0001]
0027 mov ax,13; int 10h ; MODE 13h confirmed
002C call 26C0 ; call 498A
0032 mov ah,7 ; call far 1424:0000
0039 call 2770 ; jb 0097
```

## Code card bypass
`fn 31f0` loads FONT.BIN into 1424:0000 and calls its fn 0 (AH=0); AX=0 means passed, else exit.
Patch for reference runs: `re/unpacked/MICRONCC.EXE` = MICRO_U.EXE with image offset 0x0006
(file 0x0486) `E8 E7 31` (call 31f0) -> `31 C0 90` (xor ax,ax; nop). FONT.BIN is then never loaded.
The sound driver DRIVERn.BIN is loaded into the same segment 1424:0000 by `fn 321c` afterwards.

## DOSBox-X ground truth (headless, no screen needed) -- 2026-09-11
- Load segment of MICRONCC.EXE under DOSBox-X (16 MB, MICRONCC run from AUTOEXEC): **0x0822**. So Ghidra
  1000:xxxx = 0822:xxxx; DS = 115E; VH0 table 559A (4D78); extra sprites 659A (5D78); work/back buffer 759A (6D78);
  overlay/driver 1C46 (1424).
- `tools/dbg_drive.py` drives the DOSBox-X debugger through a pty (-break-start; BP / BPINT / SM / MEMDUMPBIN / RUN).
  `tools/gt_frame.py` breaks once per tick on the int 8 handler (0822:489C) and pokes inputs into the game's own
  variables: [107E] = raw scancode (Return-driven screens), [107D] = P1 input byte (0x80 L, 0x40 R, 0x20 U,
  0x10 D, 0x08 fire). `tools/gt_race.py` walks options -> title -> SELECT GAME -> ONE PLAYER -> Challenge ->
  character -> PRESS ANY KEY -> first race and dumps VRAM/PNG, the sprite table, DS and the back buffer into
  build/golden/gt/<round>_<track>/. ~0.9 s per tick through the pty; file-open breakpoints (BPINT 21 3D) skip loads.
- `tools/gt_trace.py` = per-logic-step trace of the first race (breakpoint at the loop top 0822:3067, P1 input script,
  dumps cars_NNNN.bin / glob_NNNN.bin / ds_full_start.bin into build/golden/gt/trace_r2t1). `tools/sim_compare.py`
  replays it through `tools/mm/sim/race.py` and prints the first differing car field. ~2.5 s per step through the pty.
  Scenarios can poke memory at a given step (POKES, recorded in trace.json 'pokes' and replayed by the TS tests) and
  capture VRAM every step inside VRAM_WINDOWS. The conf path is made absolute by dbg_drive (the child chdirs to the
  work dir; a relative conf silently fell back to the default config and the game never started).
- First Challenge race = ROUND 2 track 1 (ROUND21.MAP, powerboats). Sound set to NONE via SETTINGS.DAT word 3 = 0
  in build/dos-work. DRIVER1 with sbtype=none looked like a hang: it is not, the driver's AdLib detection
  fails without an OPL2 at 0x388 and every later call returns 0xffff. See 90-sound.md, "Ground truth".
- Interactive alternative (needs the screen unlocked): screencapture works; `winlist`/`sendkey` helpers in the
  tools/mac/ (Swift, CGWindowList / CGEvent postToPid; see its README) — held keys need >= 1 tick (14 ms).

- Int 8 variables ([26cf]/[26d0] blink, [261e] tick counter) change asynchronously; a logic step spans several ticks at
  cycles=3000, so the flag can flip between the top-of-iteration dump and the render. The replay tests seed them from
  the dump at the END of the iteration (state t), which matched every case so far (round 4 trace, step 5, blink flip).

## Browser pages (npm run dev, port 3000)

| page | what it does |
|---|---|
| `/viewer.html` | asset browser: palettes, tiles, full track renders, sprites (loads ./MicroMac automatically with `?dev`) |
| `/race.html?round=N&track=M` | one race, straight into the track, built from the game files |
| `/game.html` | the game from the title screen: menus, character select, then the Challenge races |

The dev server serves the local `MicroMac` folder at `/MicroMac/` and the captures at `/golden/`; neither is part of a build.

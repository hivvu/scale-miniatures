# 40 File loaders (Confidence: verified by disassembly + DOSBox-X file log)

Startup order (DOSBox-X log with code card bypassed): mode 13h -> COMPRESS.PI0..PI6 -> DRIVER0.BIN
(before settings are read) -> INTRO.PAL -> SETTINGS.DAT.

| file | opener | destination |
|---|---|---|
| FONT.BIN | fn 31f0 (AX=3DC0) | 1424:0000, then far call fn 0 (code card; AX=0 pass) |
| COMPRESS.PI0..6 | fn 26c0 -> 3547 (si=ds:09f0, dx=1B78) | 1B78 + n*0xC00 (LZ) |
| DRIVERn.BIN | fn 321c (digit patched at ds:11e0 from [0f64]) | 1424:0000; far call ah=0 dx=388 bx=[000b] cx=[000d]; ah=2 cx=4287 until al==0 |
| INTRO.PAL | fn 26ec -> 07a0 | 6D78:0000 -> int 10h 1012h |
| SETTINGS.DAT | fn 2770 (open at 2793), saved by fn 2a28 (create) | words -> [0f5f][0f61][263a][0f64][28fd][28ff][2905][2907]; keys -> [106c] |
| ROUNDrtB.BRK | fn 3b50 | ds:195b (<= 0x200) |
| ROUNDrBR.LEV | fn 3b50 | ds:1b5b (<= 0x80) |
| STRT_POS.BIN | fn 3c09 | ds:1eab |
| CHEATS.BIN | fn 3c09 | ds:1bdb |
| ROUNDrt.MAP | fn 3c09 | ds:2963 |
| ROUNDrBR.CT | fn 3c09 (446a) | 6D78:0000 -> expanded to 3B78/4478 |
| ROUNDrBR.COL / .DIR | fn 458b | ds:3163 / ds:35e3 |
| ROUNDrBR.PR0..2 | fn 45e5 -> 45ef -> 3547 | 1B78 + n*0xC00 (LZ); then fn 4808 copies tile 0 to ds:3ee3 |
| ROUNDrBR.VH0 | fn 4611 -> 3547 | 1B78 (LZ) then copied to 4D78 (0x1440) / 5D78 (0x1B00); round 9: 0x3840 / 0x1F40 |
| ROUNDr.PAL | fn 4758 | 6D78:0000 (0x300 B) |
| ..\BITSFILE.PH0 | fn 482f -> 3547 | 1B78 (LZ) then ds:3fe3 (0x6E00 B) |
| Paul.dat, HCASE.MAP | strings at ds:0a0a / ds:0ab3 (refs cs:273c, cs:4ae7) | dev leftovers, to check |

fn 3b50 does int 21h AH=3Bh chdir to ds:042a (probably "GAME1"), then patches the round/track
digits into all template names ([1205][1210][11eb][11f8][11b1][11bc][1229] round; [11a5][121c] round+track).
Work segment 6D78 is also the back buffer. Round loader entry: fn 3c09 (returns CF on failure, then fn 2d00).

## Race setup (fn 3039 -> 37fc -> 3b50/3c09/458b/482f/4611/45e5), 2026-09-11
Transliterated in src/engine/setup.ts (setupRace) and verified byte-exact against build/golden/gt/trace_r2t1/ds_full_start.bin
outside the ISR/timer/menu regions listed in test/engine/setup.test.ts.
- Static DS image = MICRO.EXE load image at 0x93C0 (PKLITE depacker ported to src/data/pklite.ts, identical to UNP output).
- fn 2770: SETTINGS.DAT (0x28 B) -> ds:0da8, words -> [0f5f][0f61][263a][0f64][28fd][28ff][2905][2907], 8 key words -> [106c].
- Menu inputs consumed by the race: [28bf] round, [28c0] track, [28c1] challenge index, [2656] mode (1 challenge, 2 H2H),
  [2658..265e] input sources, [2668..266e] characters (first Challenge race: 10 for the player, 6 for the AI), [1082] = 1.
- fn 37fc: [2630] = 0, [263a] >= 1, [2643] = 0:0463 (CRT base 3D4), car colours [137c]=3 [14e0]=2 [1644]=1 [17a8]=0, [2682] = -1.
- fn 3b50: chdir GAME1, digits patched into the templates, BRK -> ds:195b ([28bb]), LEV -> ds:1b5b ([28b9]), [28bd] = [26d7 + (round-1)*2].
- fn 3c09: race globals (see setup.ts initRaceState), STRT_POS -> 1eab, CHEATS -> 1bdb, MAP -> 2963, [2652] = max of the
  progress plane, [2654] = [2652]/2; start grid from STRT_POS[(round-1)*16 + (track-1)*4] (+0x14, y-0xa; colour bit 0/1 adds
  0x1a in x/y), camera = grid - 0xfa; AI/handling words [129c..12a6][127c][127e] from the 9-word table at ds:252a per round,
  skewed by character skill (ds:23dc) and challenge index (ds:2462, ds:24e0); per-car struct reset (state 0x0A, 3 laps,
  [129a] = 3 or 2 for rounds 6/7); CT expansion into 3B78/4478; fn 2d00 handler pointers at ds:1083 ([108c] joystick flags).
- fn 3547 (multi-part LZ loader) increments the template digit per part and leaves it at the first missing part, so after
  a race the names read ROUNDrBR.PR3, ROUNDrBR.VH1, ..\BITSFILE.PH1.
- fn 4611 round 8 copies 0x1400 B of the VH0 image (offset 0x1440) to ds:5ee3 (skid images); fn 4808 copies tile 0 to ds:3ee3.
- fn 4758: ROUNDr.PAL -> 6D78:0; round 3 tracks 1/2 copy 9 palette bytes (0x2c1 / 0x291) over 0x2f1.

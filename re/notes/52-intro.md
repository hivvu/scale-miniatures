# The intro (SM.EXE)

`MICRO.COM` is a 472-byte launcher: it runs **SM.EXE** and then **MICRO.EXE** (the strings and the two
`int 21 ah=4b` calls are all it contains). SM.EXE is the Codemasters "Absolutely Brilliant" logo.

## The file

A plain MZ, 4832 bytes, **no relocations**, `cs = ds = ` the load segment (0x0822 under DOSBox-X, the same as
MICRO.EXE), entry `cs:0788`. Nothing is packed, so every address below is an offset into the load image (the
file past its 512-byte header), data included.

It allocates two 64000-byte blocks (`int 21 ah=48`, bx = 0xfa0) and reads one file into each, whole:

| fn | file | size | into |
|---|---|---|---|
| 0bef | gfx1.gfx | 0xd401 | [0002] |
| 0c0e | antifont.bin | 0x32d5 | [0004] |

Then fn 0c6b hooks int 9 (fn 0cbf, which only stores the scancode in [0362]), checks for VGA
(`int 10 ax=1a00`, bl >= 7; anything less sets [06bc] and the intro is skipped), sets **mode 13h** and loads
its own 256-colour palette from [036c] with `int 10 ax=1012`. There is no back buffer: [0364] = 0xa000 and
everything is drawn straight into VRAM, one frame per vertical retrace (`in 0x3da`, bit 3). **There is no
sound at all.**

## The one blit (fn 0ccc)

Every image goes through one routine and one 12-byte record:

```
+00 x (signed)   +02 y   +04 width   +06 height   +08 segment   +0a source offset
```

fn 0c24 clips x and the width to the 320-pixel line (a negative x moves the source along instead), fn 0c54
works out `di = y * [0366] + x`, and the copy is **whole words and fully opaque** — an odd width therefore
loses its last column, which is what happens to every 11-pixel font glyph.

## What is on screen

| record | what | from |
|---|---|---|
| 02c6 | one font glyph, 11 x 13 | antifont.bin, glyph n at n * 0x8f |
| 02d6 | one letter of "Codemasters" (32 x 32) or the logo (64 x 48) | gfx1.gfx |
| 02e6 | "Absolutely", 176 x 36, at gfx1:a804 | gfx1.gfx |
| 02f6 | "Brilliant!", 176 x 26, at gfx1:c174 | gfx1.gfx |

gfx1.gfx is **raw 8-bit pixels, no compression**: 32x32 tiles every 0x400 bytes from offset 4, the 64x48 logo
frames at 0x7800..0x9c00, and the two words at the end.

The font is proportional. The table at **[06cf]** is `char, width` pairs ending in a width of 0xff; the index
of the entry is the glyph number. fn 0855 measures a string with it, centres it and draws it.

## The frame loop (fn 097f)

```
0aac  once the sweep is done, count 0xfa frames and set [06b8] = exit
0bb3  draw letter-table entry [02be] (0x1e + n, 14 bytes each, 48 of them), then [02be] += 0x0e
      until 0x292: the word "Codemasters" builds up letter by letter, four frames a letter
0b83  [02e6] += 8 and [02f6] -= 8 every frame until [02e6] reaches [02c0] = 0x48, then [06c3] = 0xff:
      the two words slide in from the sides, 35 frames
0ac6  A and B held together ([02c4] + [02c5] == 2) draws the build stamp at [0680]; letting go wipes
      rows 159..177
09d0  int 9: make/break of A (1e/9e) and B (30/b0), nothing else
      then, once [06c3] is set and [06cd] is not:
0a48    brighten a 70-step diagonal band by 0x10, eight pixels a row, at ([06c7], [06c9]) going down-left,
        then [06c7] += 8; at 0x138 the sweep is over and [06cd] = 0xffff
09f8    darken the same band 0x20 pixels behind, once [06cb] has reached 6
      wait for the retrace; int 33 ax=3 with a button down leaves at once; so does [06b8]
```

The letter table entry is `x, xadd, (glyph number), y, source, width, height`; the drawn x is `x + xadd`.

So the whole thing is: "Codemasters" typing itself in over 48 frames while "Absolutely" and "Brilliant!"
slide in, a diagonal shine sweeping across, then about four seconds of nothing, then out. `(c) Codemasters
1994.` is drawn once at y = 0xb4 by fn 0855 and never touched again.

## In the port

`src/engine/intro.ts` is the whole of it: it keeps the SM.EXE load image as its data segment, so the tables,
the palette and the strings are read from the file exactly as the original reads them. `step()` is one frame.
`src/app/game/main.ts` runs it before the front end and `?nointro` skips it.
`tools/gt_intro.py` captures the ground truth into `build/golden/gt/intro/` and writes its own DOSBox-X conf
when the path does not exist:

```
python3 tools/gt_intro.py build/dos-work/run_intro.conf build/dos-work build/golden/gt/intro 170
```

It finds SM.EXE's load segment from the code pane at an `int 21 ah=3d` breakpoint (the `int 21` in fn 0d63 is
at offset 0d6d), then breaks once per frame at `cs:097f`. `test/engine/intro.test.ts` compares every captured
frame byte for byte and also checks the 313-frame length and the click.

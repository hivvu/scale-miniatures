# 30 Timer, frame sync and interrupt vectors (MICRO_U.EXE, CS=1000 in Ghidra = load segment)

Confidence: verified by disassembly, and by every DOSBox-X trace since: the tick counters drive the whole
port and a wrong one would desynchronise the frame captures immediately.

## Install / uninstall
- `fn 490d` install timer (called from `498a`), guarded by `ds:[2618]` (1 = installed).
  - `fn 485b` **calibration**: PIT ch0 mode 2 with divisor 0 (65536), wait for two consecutive
    vertical-retrace starts (port 3DAh bit 3), latch the PIT counter at each -> returns
    **PIT ticks per VGA frame** (~17024 for mode 13h at 70.086 Hz). Stored in `ds:[2612]`.
  - `ds:[2614] = frame_ticks - 0x96` (150) = the PIT divisor actually programmed (mode 2, `out 43h,34h`).
  - `ds:[2610] = 0x3428 / frame_ticks` (idiv; 0 for 70 Hz).
  - Old int 8 vector saved at `ds:[260c]` (off) / `ds:[260e]` (seg); new vector = `cs:489c`.
- `fn 4966` uninstall: restore int 8, PIT divisor back to 0 (65536 = 18.2 Hz).
- `fn 498a` = install timer + `fn 4a21` (VGA retrace IRQ) + hook **int 9 = cs:2efd** (old at ds:[2925]/[2927]).
- `fn 49af` shutdown: restore int 9, uninstall timer, resync DOS time/date from the RTC
  (int 1Ah ah=2/4, BCD via `fn 4adf`, int 21h ah=2Dh/2Bh), overlay call `ah=6` (sound shutdown), `fn 4a6c`.

## int 8 handler `489c`
```
cli; pusha; ds=093C
if cs:[4a92] != 1:            ; VGA retrace IRQ not seen -> phase-lock to retrace by polling
    PIT <- 0xFFFF; wait until 3DAh bit3 set (in retrace); PIT <- ds:[2614]; inc cs:[4ade]
inc ds:[28f7]; inc ds:[0002]; inc ds:[261f]      ; tick counters (ds:0002 = main tick counter?)
inc byte ds:[26d0]; if >= 0x20: ds:[26cf] ^= 1; ds:[26d0] = 0   ; 32-tick blink toggle
if cs:[3279] != 0: ah=3; call far 1424:0000      ; overlay fn 3 = sound driver tick
pushf; call far [ds:260c]                         ; chain to BIOS int 8 (keeps DOS clock)
al=20h; out 20h; pop ds; popa; sti; iret
```
=> **Game tick = one VGA frame (70.086 Hz in mode 13h)**, phase-locked to vertical retrace.

## int 0Ah handler `4a94` (IRQ2 = VGA vertical retrace interrupt)
- `fn 4a21` setup: read CRTC 11h -> cs:[4a8d]; save old int 0Ah vector cs:[4a8e]; hook cs:4a94;
  CRTC 11h: clear bits 4,5 then set bit 4 (enable vertical interrupt); cs:[4ade] = 0xFF.
- handler: if 3C2h bit 7 (CRT interrupt pending) == 0 -> chain old handler. Else clear the
  interrupt (CRTC 11h bit 4 low then high), EOI, **cs:[4a92] = 1**, `inc cs:[4ade]` (frame counter).
- Effect: if the hardware raises the retrace IRQ, the timer ISR stops polling 3DAh.
- `fn 4a6c` restore.
- Note: DOSBox-X may not emulate the CRT interrupt; the polling fallback in int 8 covers it.

## Counters (data segment 093C)
- `[0002]` tick counter (word), `[28f7]`, `[261f]` also incremented each tick; `cs:[4ade]` frame byte.
- `[26cf]` blink flag toggled every 32 ticks; `[26d0]` blink counter.

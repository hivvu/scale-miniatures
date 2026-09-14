# macOS helpers for interactive DOSBox-X sessions (need the screen unlocked)
- `swiftc -O winlist.swift -o winlist` : list on-screen windows (id, layer, pid, owner, title, bounds); `./winlist dosbox`.
  Capture a window with `screencapture -x -o -l <id> out.png` (the id changes when DOSBox-X recreates its window).
- `swiftc -O sendkey.swift -o sendkey` : `./sendkey <pid> <keycode> [hold_ms] ...` posts held key events to a process
  (macOS virtual key codes: 36 Return, 53 Esc, 49 Space, 0 A, 2 D, 13 W, 1 S, 58 Alt, 122 F1). Game keys must be
  held >= 1 tick (14 ms); Return-driven screens latch the scancode so a tap is enough.
- Prefer the headless path (tools/dbg_drive.py + gt_frame.py) when the screen is locked or for deterministic runs.

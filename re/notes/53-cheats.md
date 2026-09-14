# Cheats, the pause key and the debug keys

Two separate things, both reached from the race loop's `test byte [107c],2` at 3074.

## [107c] and the key it tests

int 9 (fn 2efd) keeps a 16-bit mask at **[107c]** of the sixteen keys in the SETTINGS.DAT table at [106c],
bit 15 = entry 0 down to bit 0 = entry 15. The table the shipped SETTINGS.DAT holds is

```
idx  0  1  2  3  4   5   6   7   8  9  10 11 12 13 14 15
key 1e 20 11 1f 38  3b  3c  3d  4b 4d 48 50 52 20 39 2f
    A  D  W  S  Alt F1  F2  F3  <- player 2's arrows + Ins ->  D  Space V
    <---- player 1 ---->
```

`test byte [107c],2` is bit 1 of the word, entry 14: **Space**. Holding it calls fn 35f0 once per loop
iteration.

## fn 35f0: pause

1. `ah=8` then `ah=6` on the sound driver: everything goes quiet.
2. The CHEATS.BIN scan below.
3. The **Paused!** banner (PH0 sprite 0x9d63, fn 9289 at (0x80, 0x3c)), then a wait for a key release or
   0x8c ticks of [261f].
4. [2633] = 2, one more render pass (fn 90c5), fn 7af8 to silence the engines.
5. Wait for a key release, then the debug keys below, then [2633] = 0 and back to the race.

## The CHEATS.BIN spots

fn 35f0 walks the 12-byte records at ds:1bdb (`round, track, x, y, kind, value`, all LE16) while
`si <= 0x1fcb`. When the round and track match and the player's car is within 0x18 of (x, y), the record's
`kind` is applied to **the player's car only** ([2660]) and the screen flashes white for one frame:

| kind | effect |
|---|---|
| 0 | `dec [0406]` — take one of the player's lives |
| 1 | [26c6] = 4, [2635] = 1 and the ranking reordered: the race ends as a win |
| 2 | [bx+127c] = value (top speed along the car's heading) |
| 3 | [bx+127e] = value (top speed sideways) |
| 4 | [bx+12a2] = value (acceleration) |
| 5 | [2915] = 1: the fire button no longer jumps, it just coasts |
| 6 | [2917] = 1, which nothing else reads |
| 7 | [bx+12f9] = 0, the car's on-track flag |
| 8 | [bx+129c] = 0x800 (max speed) |
| 9 | [2915] = 1, [2919] = 1, [291b] = 4: the round 7 jump on any round |

The shipped file has 30 records over rounds 1..8 (`tools/mm/cheats.py` decodes them). The loop's bound runs
54 records past the end of the file, so it also reads whatever the data segment holds after it. These are
plainly developer aids, not player rewards: five of them take a life away.

## The cheat code

The **GAME OPTIONS** screen (fn 2770, the first screen of the game, before PLAY WHICH GAME SET ?) compares
every key that is not one of its own against a sequence of eight scancodes at ds:0f6b, with the position kept
in [0f73]:

```
03 06 0b 02 02 0a 07 09   =   2 5 0 1 1 9 6 8
```

Any other key resets [0f73] to 0f6b. Getting to the end sets **[0f69] = 1** and **[0f6a] = 1**, and a `!`
(the string at ds:0f00) appears at the bottom of the options screen. What they turn on:

| flag | where | what |
|---|---|---|
| [0f69] | fn 11b3, after every race | `[0406] = 10`: the player's lives are put back to ten |
| [0f69] | fn 37bf, on the pause screen | the three debug keys below |
| [0f6a] | fn 1398, on the pre-race card | keypad `+` (0x4e) and `-` (0x4a) step [28c1] through the championship's races and redraw the card, so any race can be jumped to |

Note that fn 37bf reads it as `cs:[a329]`, which is the same byte: the data segment starts at cs + 0x93c0,
and 0xa329 - 0x93c0 = 0xf69.

## The debug keys on the pause screen

Only with [0f69] set, and never in round 9:

| key | what |
|---|---|
| F12 (0x58) | fn 35bf: create the file named at ds:2929 (a digit at 292d counts up) and write 0xfffa bytes of the back buffer (6D78) into it — a screen dump |
| F1 + F2 ([107c] == 0x600 exactly) | the kind 9 effect: jump on any round |
| F2 + F3 ([107c] == 0x300 exactly) | the kind 1 effect: the race ends as a win |

Both combinations compare the whole word, so no other configured key may be down at the same time.

## In the port

All of it is in, and `test/engine/cheats.test.ts` and two cases in `test/engine/menus.test.ts` cover it.

- `menus.ts gameOptions` is fn 2770 from 27f0, so the code can be typed. The screen itself is pixel-exact
  against the DOSBox capture. `frontEnd` is now the whole of fn 0032: options, then the title and SELECT GAME,
  with Esc walking back out of each and off to DOS.
- `race.ts fn35f0` / `pauseStep` / `cheatSpot` / `applySpot` are the pause and the spots; `render.ts
  pauseFrame` draws the banner and `main.ts` drives the two waits and paints the white flash.
- `sequence.ts cardSkip` is fn 1398, and the pre-race card now waits on fn 179b (`menus.ts preRaceCard`)
  instead of the first key that came along.
- `src/data/cheats.ts` decodes CHEATS.BIN, matching tools/mm/cheats.py.

The rest of GAME OPTIONS came in with it:

- **F5** is fn 92f0, REDEFINE KEYS: ten keys, five per player, collected in a scratch list and only copied
  over the int 9 table once all ten are in. Space and any key already taken are refused, which the original
  does by looping on `[107e]` without clearing it, so the next key pressed replaces it; Esc leaves the old
  keys alone.
- **F7** is fn 2ab5, the **joystick calibration**, not a sound test as an earlier note here claimed. It is
  only offered when `[2625]` says a stick answered. See notes/20-input.md.
- **fn 2a13** writes SETTINGS.DAT back whenever anything on the screen changed. `FrontEnd.saveSettings`
  hands the 32 bytes to the page, which keeps them in `localStorage` and reads them back instead of the file
  next time, so redefined keys and a calibrated stick survive a reload.
- **fn 3ad0** is the benchmark behind AUTO: how many bursts of a thousand word writes to VRAM fit in one
  visible field, which it turns into a frame rate of 1 to 4. `FrontEnd.speed` lets the page run the loop
  against its own clock; a browser clears the top class every time, which is the honest answer.
- **fn 2be8**, PLAY WHICH GAME SET ?, sits between the options and the title. It lists every GAME?.LVL on
  the disk by the name inside it, flashing the row under the cursor through ten colours, and the one picked
  is read over the championship tables at [040a] and [1feb]. No retail install ships a GAME?.LVL, so the
  screen falls straight through, exactly as it does on DOS.
- **F12** on the pause screen (fn 35bf) writes the back buffer to SCRE0.RAW, SCRE1.RAW and so on; the page
  offers those 65530 bytes as a download, with the same name and the same counter.

F3 still cycles [0f64] as the original does, but the page narrows the list with `FrontEnd.soundDevices`:
with only DRIVER1 ported, SPEAKER is stepped over rather than offered as silence, and a SETTINGS.DAT that
asks for it is read as asking for BLASTER. Because the page maps Return onto player 1's fire button, GAME
OPTIONS turns that remapping off (`FrontEnd.rawKeys`) so its Return and the code's digits arrive as
themselves.

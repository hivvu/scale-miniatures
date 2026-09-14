# Head to head

Two cars instead of four, a shared camera, and a tug-of-war bar instead of a lap ranking. `[2656] = 2` is the
mode flag; `[03f8] = 1` marks the front end as a head to head. Addresses are offsets in the depacked
MICRO.EXE code image (`ndisasm -b16`), data offsets are in the data segment.

## Two ways in

| entry | what it is | who drives car 1 |
|---|---|---|
| fn 0fbf (one-player menu, choice 1) | the player picks a driver **and** a rival, then the ordinary championship (fn 10a0) runs with two cars | `[265a] = 6`, the computer |
| fn 1e20 (SELECT GAME, choice 2) | two players, each picking with their own keys, then CHOOSE GAME! | `[265a] = [0f61]`, the second configured device |

fn 0fbf needs nothing new from the sequence: `Championship.twoPlayers` already reads `[03f8]`, so the board
between races and fn 1a4a (picking the rivals) are skipped and the results lead straight to the next race.

## fn 1e20 and the screens under it

```
1e20  both character selects            [019e] = 0c03 with [1080] = 137b, then 0c1e with [1080] = 14df
 1ef1 CHOOSE GAME!                      menu at y = 0x90; 1 = tournament, 2 = single race, 0 = back
  1faf tournament                       eight tracks, first to four wins, then fn 1aad
  2329 single race                      ten fixed tracks, raced over and over until Esc
```

Shared drawing:

| fn | what |
|---|---|
| 240a | the two faces at height `ax`, outlined, named, with the score from [098a] / [098c] when [08a5] |
| 2481 | WON nn / LOST nn per driver from [09a4+c] / [09af+c], and the skill word: `wins - losses + 10` clamped to 0..0x14 through the table at [08b0] into the list at [08cd] |
| 2216 | two MINATURE cars closing in on the vehicle picture, `[263a] * 4` pixels a frame until x = 0x58 |
| 256e | RESULTS!!, WINNER!/LOSER! over each face, the cars driving back in and both faces flashing |
| 2193 | step through the ten single-race entries at [09d9] (word per entry: vehicle name index, track) |

The tournament bag is eight bytes at `[09c2]`: a track is chosen by `[0002] & 7` (the tick counter) until it
lands on a free slot, and the bag is refilled when it is full. `[09ba]` holds the eight tracks, `round = b >> 2`
and `track = (b & 3) + 1`.

## HANDICAP (fn 0b51)

Called from the tail of the character select, with `ax` = the character just chosen. Only characters 0, 1 and
2 (WALTER, MIKE, ANNE) have a question, and only when a second human is playing (`[2656] != 1` and
`[265a] != 6`). The answer, 0 or 0x80, is remembered at `[01d6..01d8]` and OR-ed into the car's entry in
`[2668..266e]`.

`[08a2]` (set by fn 1ef1 to 1 or 2) switches the whole AI parameter setup from fn 3fbe to **fn 3f3b**: every
car reads the round's nine-word table at `[252a]` as it stands, and the only skew is the handicap, which takes
`0xc0 - (dx - 1) * 0x40` off the top speed `[129c]` and `0x0c - (dx - 1) * 4` off `[12a2]`, where
`dx = (character + 1)` when the 0x80 bit is set.

## The race

`[26b4]` is the tug-of-war bar, 0..8, starting at 4; `[26b6]` is the value it is moving to and `[26ba]` the
0x40-tick countdown of the animation that gets there. `[26b8]` is the car that just scored, or 1 when nothing
is happening.

```
4fd1/525e  a car more than 0xe8 / 0xb0 from the other  ->  [2911] = 1
90c5 91f2  [2913] != 0 ? fn 78f8 : [2911] == 1 ? fn 7759
7759       the leader (lower [12ef]) goes to state 0x0b, the other is moved onto the leader's
           checkpoint [12f1]/[12f3] and goes to state 0x0c; [26b8] = the leader
7429 75d2  [26ba] = 0x40, both cars to state 0x0c, [26b6] = [26b4] +/- 1; every 8 ticks the two swap
           so the segment flashes.  At 0 the cars respawn (state 0x0d), the bar takes its new value
           and, at 8 or 0, [26c6] = 2 ends the race
78f8       both cars are back: the one behind is put on the other's checkpoint, both to state 7
3039 30df  [26c6] >= 2 in a head to head leaves at once (no 100-step grace period); the original then
           holds the last frame for 100 more frames of fn 855a
```

The HUD is fn 8f03: the same score as fn 8dfc but over two cars, one bubble pass, and a wrap-around
correction (when the two progress values are more than `[2654]` apart the smaller one is really in front).
`[12ef]` ends as 1 and 2, which the 8-segment bar and the leader's lap digit read.

Banners (88x22 sprites in BITSFILE.PH0, drawn by fn 9289 at `([26be] - 0x2c, [26c0] - 0xc)`, as a colour-0
silhouette while `[26cf] == 1`):

| offset | word | drawn by |
|---|---|---|
| 7423 | Bonus | fn 851f (state 0x0b, 1 < [26b4] < 7) and fn 855a mid-match; fn 8634 slides it off to the left |
| 7c63 | Winner | fn 855a when `[26b4] + [26b6]` is 1 or 0xf, sliding down from y = -0x18 to 0x7c |
| 84a3 | Play Off | fn 8634 while `3 <= [26c2] < 0x64` |
| 8ce3 | 1 Up! | fn 8683, round 9 bonus won |
| 9523 | Failed | fn 86a8, round 9 bonus lost |
| 9d63 | Paused! | not used by the port |

fn 7af8, called from every one of those, silences the engines: with the AdLib driver it simply zeroes the
four cars' speeds `[127a]` (the speaker driver stops its two engine voices instead).

## In the port

`src/engine/menus.ts` holds fn 0fbf / 1e20 / 1ef1 / 1faf / 2329 / 2193 / 0b51 as generators; they yield the
new request `'race'` where the original calls fn 216c, and `src/app/game/main.ts` runs the race loop and
resumes them. `src/engine/screens.ts` has the drawing (fn 240a / 2481 / 2216 / 256e), `src/engine/race.ts`
the race side and `src/engine/render.ts` the banner blit. The page aliases the arrows onto player 1's keys
only while `[03f3] != 1`, so in a two-player game the arrows are player 2's own keys again.

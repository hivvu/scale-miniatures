# Scale Miniatures

*"THE ORIGINAL SCALE MINIATURES", says the badge on the title screen.*

This is my reconstruction of Codemasters' **Micro Machines** (PC, 1994) as a TypeScript program that runs
natively in a browser. There is no emulator anywhere in it: We (Me and Claude) disassembled the original `MICRO.EXE` and
rewrote it routine by routine, so what runs in the page is the game's own logic, its own physics, its own
sprite renderer and its own OPL2 sound sequencer, expressed in TypeScript.

**No game data is in this repository.** The page reads your own installed copy of the game, locally. If you
do not own Micro Machines, this repository is of no use to you.

## What is in

* The Codemasters intro (`SM.EXE`), byte for byte.
* GAME OPTIONS, the title screen, SELECT GAME and the character carousel.
* **Challenge**: all 26 races, the championship board, lives, drivers knocked out every third win, the bonus
  time trials and the champion screen.
* **Head to Head**, one player and two, tournament and single race, with the handicap prompt.
* All nine rounds, all their tracks, all their terrain: the tabletop pockets, the bathtub currents and
  whirlpool, the breakfast table, the garden, the pool table shells, the helicopters, the time trial.
* Music and sound effects through a from-scratch YM3812 (OPL2) written in TypeScript, driven by the game's
  own Sound Images sequencer read out of `DRIVER1.BIN`.
* The pause screen, the `CHEATS.BIN` spots and the cheat code (see below).
* Keyboard, gamepad and mouse, with the redefine-keys and joystick-calibration screens.

What is missing: the PC speaker driver (`DRIVER2.BIN`), so the SPEAKER option is stepped over rather than
offered as silence.

## Widescreen

The game draws 256x200 into the middle of the VGA screen and wastes 32 columns on each side. The port can
draw more of the track instead. There are two ways to ask for it, and both are remembered: the **View** box
above the canvas, or `F8` on the game's own GAME OPTIONS screen. `F8` is the one line on that screen the
original has not got; it is drawn with the game's own font in the row F7 would have taken, and it steps
through the sizes the way F1 to F4 step through theirs. It names them rather than giving the numbers,
because the value column of that screen holds seven capitals and no more (the longest the game itself puts
there is `BLASTER`):

| | | |
|---|---|---|
| `DOS` | 256 x 200 | what the game shipped as |
| `VGA` | 320 x 200 | the rest of the VGA screen |
| `TALL` | 320 x 224 | and taller |
| `WIDE` | 384 x 224 | |
| `WIDEST` | 448 x 240 | |

Each one shows strictly more of the track than the one before it.

This is worth more than a bigger picture in **Head to Head**. A point is scored there when one car gets far
enough ahead that the other is left behind, and the original decides that with two numbers, 232 and 176,
which are the view's width and height minus a car. It means "both cars still fit on screen". Widen the view
and the area you have to play in genuinely grows with it, so matches run longer and getting away from
someone takes real distance.

It is off by default, and everything the captures check still runs at the original size. What proves the
widening is honest is a test that renders the same frozen moment twice, once narrow and once wide with the
camera moved half the extra width across, and requires every column the two views share to be identical:
the wider view adds pixels without moving any. The one thing that does move is the HUD, which stays pinned
to the left edge of the view. Menus and the intro are fixed-size artwork and cannot widen, so they sit
centred in the larger canvas.

One consequence worth stating: the flag that says whether a car was drawn also feeds the AI's catch-up
boost, so in a wider view the opponents stay "on screen" for longer, their rubber band engages later, and
races are a little easier.

There is a **Fullscreen** button next to it, and double-clicking the picture does the same. The canvas is
scaled by whole numbers only, so every game pixel stays exactly the same size as its neighbours and the
leftover space stays black; a fractional scale would make some pixels a row wider than others, which on
320x200 artwork is very visible. `Esc` leaves fullscreen, and a second press then does the game's own Esc:
the first one is swallowed so that leaving fullscreen does not also back you out of the menu you were in.

## What you need

* **Node.js 20, or 22 and up** (vite 6 and vitest 3 both skip Node 21).
* **Python 3** (only to generate the file manifest, and for the reverse-engineering tools).
* A desktop browser with Web Audio.
* **Your own installed copy of Micro Machines for DOS.** A ZIP of floppy images is not enough on its own:
  what the page reads is the *installed* game directory, the one with `MICRO.EXE` and a `GAME1` folder in it.

### Getting the game files in place

The game shipped on floppies with an `INSTALL.EXE` that copies and unpacks everything onto the hard disk.
If you still have that install directory, copy it. If all you have are the disks or disk images, run
`INSTALL.EXE` once under DOSBox and keep the directory it produces.

**Where it goes:** the folder must sit at the root of this repository, next to `package.json`, and be
called `MicroMac`. Either copy it or point a symlink at it:

```bash
cd scale-miniatures
ln -s "/path/to/your/Micro Machines" MicroMac    # or: cp -R "/path/to/your/Micro Machines" MicroMac
ls MicroMac/MICRO.EXE MicroMac/GAME1             # both must exist
```

The name is case-sensitive on Linux. What has to be inside it:

```
MicroMac/
  MICRO.EXE            the game itself, PKLITE-packed; unpacked in the browser
  COMPRESS.PI0 .. PI6  front-end graphics
  BITSFILE.PH0         in-race sprites and banners
  INTRO.PAL            the front-end palette
  SETTINGS.DAT         controls, sound device, smoothness (optional)
  DRIVER1.BIN          the AdLib / Sound Blaster driver, which carries the music (optional)
  SM.EXE               \
  GFX1.GFX              | the Codemasters intro (optional)
  ANTIFONT.BIN         /
  GAME1/              r = round 1..9, t = track 1..4
    ROUND<r><t>.MAP        the track layout        ROUND<r><t>B.BRK   AI braking hints
    ROUND<r>.COL .DIR .PAL surfaces, directions, colours
    ROUND<r>BR.CT .LEV     tile blocks and levels
    ROUND<r>BR.VH0         vehicle sprites         ROUND<r>BR.PR0 .PR1 .PR2   tile banks
    STRT_POS.BIN  CHEATS.BIN
```

**The game's files never enter the repository.** `MicroMac` is in `.gitignore` without a trailing slash, so
git ignores it whether it is a real folder or a symlink, and `git status` will not offer it to you. Nothing
is bundled, uploaded or sent anywhere either: the browser reads the files off your own disk and they stay
there. If you ever see one of them in `git status`, stop and open an issue, because that is a bug in the ignore
rules and not something you should work around.

One more thing that is pinned to my release: `test/golden/hashes.json`, the 42 digests the decoder tests
compare against. A different release will fail those rather than skip them, and that is the decoders
telling you your files differ, not a bug.

`manifest.json` is the one piece of game metadata that is committed: the path, size and SHA-256 of each
file of the 1996-12-24 re-release, which is what `tools/manifest.py --verify` checks an installation
against. If your copy is a different release, regenerating it will show `manifest.json` as modified. That
is expected; it holds no game content, only hashes.

## Running it

```
npm install
python3 tools/manifest.py     # indexes your MicroMac folder into manifest.json
npm run dev
```

Then open:

* **http://localhost:3000/** for the front page, which loads the game when you ask it to.
* http://localhost:3000/game.html for the game on its own, with no page around it.
* http://localhost:3000/race.html?round=2&track=1 to drop straight into one track.
* http://localhost:3000/viewer.html to browse the decoded assets.
* http://localhost:3000/online.html to play up to three other people (a playlist of tracks, 3 to 40 laps,
  two to four cars), and
  http://localhost:3000/netlab.html to watch the netcode cope with a bad connection. Both want the relay
  running beside the dev server: `npm run relay`.

`npm test` runs the test suite and `npm run typecheck` the compiler. Only the tests want the game files,
and they skip cleanly without them; point them at another copy with `MM_DATA_DIR=/path/to/MicroMac`.

## Hosting it somewhere

`npm run build` writes a static site to `dist/`. It needs no Node at runtime and any web server will do.
Deploying under a subfolder works too, as long as the build knows: `SM_BASE=/micromachines/ npm run build`,
and everything the pages ask for follows that base.

Two things live outside that build, on purpose.

**The relay.** `npm run relay` (`server/relay.mjs`) carries the bytes between the people playing online. It
is four letter rooms and nothing else: it never looks inside a packet, keeps nothing on disk, and a room
disappears with the people in it. The race itself runs identically on every machine, so the relay has
nothing to be right or wrong about beyond who it forwards to.

**The game itself.** The dev server mirrors your `MicroMac` folder at `/MicroMac/`, and it is the only thing
that does: the plugin is `apply: 'serve'`, so a build contains no game data at all. A host that serves that
same path hands the game straight to whoever opens the page, and the front page then starts on its own; a
host that does not makes the page ask each visitor to point at their own installed copy, which their browser
reads locally and never uploads. Both paths work and the page picks whichever it finds. Serving the files is
distribution rather than a private copy once the site is reachable from outside your own network, and the
game is not out of copyright: it was Codemasters' and is Electronic Arts' now. **Keep that folder outside
`dist/`**, because a rebuild empties `dist/`.

**The poll** on the front page, if you want it. `server/poll.mjs` is one dependency-free Node file that
answers `/api/poll`; see [server/README.md](server/README.md).

Worked examples are in [`deploy/`](deploy/): nginx and Caddy, both listening only on the loopback, plus a
[Cloudflare Tunnel](deploy/cloudflared.yml.example) in front so that nothing at home listens on the
internet and there is no certificate to renew. The live site is
[scaleminiatures.fun](https://scaleminiatures.fun/).

The front page loads **Google Analytics** (`G-JV7RQVWG6T`), which is the only third-party request it makes:
the fonts are served from the site itself and there is nothing else. `game.html`, `race.html` and
`viewer.html` load no analytics at all.

### Deploying on a push

`.github/workflows/deploy.yml` builds and deploys whatever lands on `main`. Since the machine has nothing
listening on the internet, nothing can be pushed to it: a **self-hosted runner** sits beside the stack and
pulls the work instead. Its container is [`deploy/gh-runner/docker-compose.yml`](deploy/gh-runner/docker-compose.yml),
and the comments at the top of that file are the whole setup.

The job installs Node (the runner image has neither a usable one nor npm), typechecks, runs the tests,
builds, swaps `dist/` over without a gap, updates the poll service and the two config files, reloads Caddy
and then asks the site for three URLs to prove it is still answering. **`MicroMac/` is never touched**: it
is not in this repository, it exists only on that machine, and no deploy stands on it.

## Controls

The game reads the keys out of `SETTINGS.DAT`, so these are the ones it ships with. F5 on GAME OPTIONS
changes them, and what you choose is remembered.

| | Player 1 | Player 2 |
|---|---|---|
| Steer | `A` / `D` | `Left` / `Right` |
| Accelerate, brake | `W` / `S` | `Up` / `Down` |
| Fire, confirm | `Alt` | `Insert` |

The arrow keys and `Return` are also wired to player 1 for convenience, right up until a two-player game
starts, at which point they go back to being player 2's own keys. `Esc` goes back a screen. `Space` pauses a
race. A click skips the intro, and `?nointro` leaves it out altogether.

On **GAME OPTIONS**, the screen the game opens on:

| Key | |
|---|---|
| `F1`, `F2` | each player's control device: keys, joystick or mouse |
| `F3` | sound device |
| `F4` | smoothness (AUTO times the machine, as the original does) |
| `F5` | redefine the ten driving keys |
| `F6` | credits |
| `F7` | calibrate the joystick (only shown when one is connected) |
| `F8` | how much of the track a race draws (mine, not the original's) |
| `Return` | play |
| `Esc` | quit |

A **gamepad** counts as a joystick: the stick steers, the first button accelerates and the second brakes.
That is not my choice, it is the original's: the joystick handler only ever looks at the X axis, and drives
on the two buttons. The **mouse** needs a click first, to lock the pointer, because the game recentres the
pointer every frame and only relative movement can imitate that.

## The cheat code is still in

I kept it, exactly as it works on DOS. On the GAME OPTIONS screen, type:

```
2  5  0  1  1  9  6  8
```

A `!` appears at the bottom of the screen. From then on:

* Your lives are put back to **ten** after every race.
* On the pre-race card, keypad `+` and `-` step through the championship's races, so you can jump to any of
  them.
* On the pause screen: `F12` writes a screen dump (the browser downloads `SCRE0.RAW`, `SCRE1.RAW` and so
  on), `F1`+`F2` gives you the round 7 jump on any track, and `F2`+`F3` ends the race as a win.

Separately from the code, `CHEATS.BIN` holds thirty spots scattered over the tracks: pause while standing on
one and the screen flashes white as it applies. They are plainly developer aids rather than rewards, and
five of the thirty take a life off you.

## How faithful it is, and how I know

Every routine is a transliteration of the disassembly, working on a byte image of the game's own data
segment, so struct offsets, wrap-around and aliasing all come out for free. To check it, I drive DOSBox-X
headless through its debugger and capture ground truth from the real game: memory dumps, VRAM frames, and
the sound driver's own work area.

The test suite replays those captures:

* 17 physics traces, step by step, byte for byte.
* About 1300 rendered frames across all nine rounds, pixel for pixel.
* 170 frames of the intro, byte for byte.
* Two songs through the sound driver, comparing the OPL2 register shadow, the channel records and the
  sequencer queues against the real driver's, tick for tick.
* The front-end screens against captures of the real menus.

That is 1613 tests here. **It is not what you will see.** Those captures are dumps of the running game's
own memory, so they are not mine to redistribute and they are not in this repository: `build/` is ignored.
Four of the suites build their cases by listing the capture directory, so without it those tests do not
merely skip, they do not exist. A clean clone runs **29 tests** with no game files at all, and a few dozen
more once you add your own copy. If you want the rest, `tools/gt_*.py` drives DOSBox-X headless and
regenerates every capture from your own installation.

Two further caveats, so the numbers mean what they say. The frame and trace comparisons accept either of
two snapshots of the timer variables, because the real game's interrupt fires in the middle of an
iteration. And where something could not be captured at all (nobody's retail install has a joystick), it is
checked against the disassembly only, and the notes say which.

Deliberate differences from DOS, all of them in the page rather than the engine: settings are kept in
`localStorage` instead of being written back to `SETTINGS.DAT`; SPEAKER is left out of the sound cycle
because that driver is not ported; the arrows are aliased to player 1; and the AUTO benchmark runs against
the browser's clock. Original bugs are kept, including the one where the joystick's Y axis compares its
thresholds and then throws the result away, so up and down on the stick do nothing.

## Layout

* `re/notes/` : the reverse-engineering notes. Start with `STATUS.md`, then `00-overview.md`.
  `re/notes/formats/` documents the file formats.
* `src/engine/` : the port. One file per area (physics and race loop, renderer, front end, menus, sound),
  each function named after the address it came from.
* `src/hal/` : everything the browser provides that DOS did not (file access, Web Audio, gamepad, pointer).
* `src/data/` : the decoders (LZ codec, PKLITE, palettes, maps, sprites).
* `tools/` : the Python side. `tools/mm/` mirrors the decoders and holds a Python transliteration of the
  physics; `tools/dbg_drive.py` and the `gt_*.py` scripts drive DOSBox-X headless to capture ground truth.
* `test/` : everything above, replayed.

## About the help I had

I did not type most of this. I worked through it with **Claude Code**, using Anthropic's **Fable 5.1** and
**Opus 5** models: they read the disassembly, wrote the transliterations and built the capture tooling,
while I decided what to attack next, what counted as proof, and what to do when the port and the real game
disagreed. A fair amount of the work was exactly that: noticing a trace had diverged at step 400 and
figuring out which routine was lying.

## Licence

The code, the notes and the tools in this repository are mine and are released under the
**GNU General Public License v3.0 only** (`GPL-3.0-only`); the full text is in [LICENSE](LICENSE).

That grant covers only what I wrote. **It does not cover Micro Machines itself**: not the original
executables, not the graphics, the tracks, the sound data or anything extracted from them. Those stay
copyright Codemasters, and nothing of theirs is in here.

## Legal

Micro Machines is copyright Codemasters. I have no affiliation with them, and this is not endorsed by them.
This repository contains none of the game's code, data, graphics or sound, and never distributes any of it:
it reads the copy you already own, on your own machine. The reverse-engineering notes describe the
original's behaviour, which is what makes the reimplementation possible.

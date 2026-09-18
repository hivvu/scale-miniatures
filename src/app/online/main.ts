/**
 * Two to four people, two to four machines, one race, and then the next one.
 *
 * The lobby is web and the race is DOS. That split is the whole design: a four letter room, a playlist and
 * a lap count never existed in 1994 and have no original to imitate, while everything from the green flag
 * on is the game's own code running the same steps on every machine. What crosses the wire is one byte per
 * player per step and nothing else.
 *
 * Everything the machines have to agree on is decided in one place, by whoever made the room, and sent: the
 * playlist, the laps, how many cars, the SMOOTHNESS (the game picks it with a benchmark, and the physics
 * reads it), and a fingerprint of the game files themselves. Nothing is worked out locally, because a value
 * worked out locally is a value two machines can disagree about.
 *
 * The one thing each machine decides for itself is where it is looking. See engine/camera.ts for why that
 * is harder than it sounds and how it stays out of the race.
 */
import type { GameFiles } from '../../hal/fs/GameFiles';
import { fromServerIfServed, fromFolderInput } from '../../hal/fs/openGameFiles';
import { decodePalette, paletteToRgba } from '../../data/palette';
import { unpackPklite } from '../../data/pklite';
import { setupRace, raceFileNames, CARS, type RaceFiles, type RaceParams } from '../../engine/setup';
import { Race } from '../../engine/race';
import { RaceRenderer } from '../../engine/render';
import { DOS_VIEWPORT } from '../../engine/viewport';
import { View } from '../../engine/camera';
import { hashBytes, TICKS_PER_FRAME } from '../../engine/tick';
import { Peer } from '../../net/Peer';
import { Outbox, decodePacket, encodeHash, encodeSay, INPUT, HASH, SAY } from '../../net/packet';
import { Relay } from '../../hal/net/Relay';
import { SoundOutput } from '../../hal/audio/SoundOutput';
import { startHero } from '../landing/hero';
import { startClock } from './clock';
import type { NetTransport } from '../../net/transport';

const VP = DOS_VIEWPORT;
const TICK = 1 / 70.086;                  // one VGA frame
/** Agreed, never read from the local SETTINGS.DAT: fn 3ad0 picks it by benchmark and the physics reads it. */
const SMOOTHNESS = 2;
const PER_STEP = TICK * (TICKS_PER_FRAME[SMOOTHNESS] ?? 3) / SMOOTHNESS;
/**
 * How far ahead of everybody else's confirmed input this machine will run.
 *
 * Smaller than the rollback window on purpose. The window is how far back a late packet may still be put
 * right; this is how far forward it is worth guessing, and guessing further only buys more corrections. It
 * also has to be smaller so that a gap can close again: a machine that got a head start (the other one was
 * busy for a moment, a full screen switch, a slow load) would otherwise sit at the window's edge for the
 * rest of the race, because both then run at the same speed and nothing ever brings them back together.
 */
const RUN_AHEAD = 4;
/** Steps between two machines comparing their state. */
const CHECK_EVERY = 30;
/** The most people a room holds, which is also the most cars the game has. */
const MAX = 4;
export const MIN_LAPS = 3;
export const MAX_LAPS = 40;
/**
 * The input source words for driven cars. Which one hardly matters, since a byte handed in over the wire
 * wins over the source; what matters is that it is not 6, the AI, because a car marked as the AI's is
 * steered by it as well as read from the wire.
 */
const SOURCES = [4, 5, 4, 5] as const;
/** A different character each, so the cars on one track can be told apart. */
const FACES = [3, 5, 10, 6] as const;

const $ = <T extends HTMLElement>(s: string): T => document.querySelector<T>(s)!;
const status = $('#status');
const lobby = $('#lobby');
const stage = $('#stage');
const under = $('#under');
const board = $('#board');
const overlay = $('#overlay');
const say = (text: string): void => { status.textContent = text; };

// P1 keys as in SETTINGS.DAT: A left, D right, W accelerate, S brake, Alt fire.
const KEYS: Record<string, number> = {
  KeyA: 0x80, ArrowLeft: 0x80, KeyD: 0x40, ArrowRight: 0x40, KeyW: 0x20, ArrowUp: 0x20,
  KeyS: 0x10, ArrowDown: 0x10, AltLeft: 0x08, AltRight: 0x08, Space: 0x08,
};
let keys = 0;
/**
 * Whether the keyboard belongs to the page rather than to the race. Half the room code alphabet is also
 * steering (D, S, W are all in it), so a handler that swallowed those while somebody was typing their
 * code ate the letters and looked for all the world like the page was lagging.
 */
const typing = (e: Event): boolean => {
  const el = e.target as HTMLElement | null;
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.isContentEditable === true;
};
addEventListener('keydown', e => {
  if (typing(e)) return;
  const b = KEYS[e.code]; if (b) { keys |= b; e.preventDefault(); }
});
addEventListener('keyup', e => {
  if (typing(e)) return;
  const b = KEYS[e.code]; if (b) { keys &= ~b; e.preventDefault(); }
});
addEventListener('blur', () => { keys = 0; });

/**
 * Full screen, with the canvas at the largest **whole** multiple that fits: a fractional scale leaves some
 * game pixels a row wider than their neighbours, which on 320x200 art is very visible. Not every browser
 * has the unprefixed call, none of them allow it outside a gesture, and any of them may refuse; a refusal
 * is not worth an error in the console, the race simply carries on in the page.
 */
function fullscreen(stageEl: HTMLElement, canvas: HTMLCanvasElement): void {
  const fit = (): void => {
    if (document.fullscreenElement === stageEl) {
      const scale = Math.max(1, Math.floor(Math.min(
        window.innerWidth / canvas.width, window.innerHeight / canvas.height)));
      canvas.style.width = `${canvas.width * scale}px`;
      canvas.style.height = `${canvas.height * scale}px`;
    } else {
      canvas.style.width = '';
      canvas.style.height = '';
    }
  };
  const toggle = (): void => {
    const el = stageEl as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> };
    const call = document.fullscreenElement
      ? (document.exitFullscreen?.bind(document) ?? doc.webkitExitFullscreen?.bind(document))
      : (el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el));
    void Promise.resolve(call?.()).catch(() => { /* refused, or no full screen at all */ });
  };
  document.querySelector('#fullscreen')?.addEventListener('click', toggle);
  canvas.addEventListener('dblclick', toggle);
  document.addEventListener('fullscreenchange', fit);
  addEventListener('resize', fit);
}

export interface Leg { round: number; track: number }

/** Everything every machine has to agree on before the flag drops. */
export interface Deal {
  /** The tracks to race, in order. */
  legs: Leg[];
  laps: number;
  /** Cars on the track, people included. */
  cars: number;
  /** How many of those cars are people, always the lowest slots. */
  humans: number;
  /** 1 = a race, 2 = head to head, which is the game's own two player mode and has its own camera. */
  mode: number;
  smoothness: number;
}

/** The race one leg of the deal describes, the same on every machine. */
export function params(deal: Deal, leg: Leg): Omit<RaceParams, 'viewport'> {
  const inputs = [0, 1, 2, 3].map(i => (i < deal.humans ? SOURCES[i]! : 6));
  const faces = [0, 1, 2, 3].map(i => (i < deal.cars ? FACES[i]! : 6));
  return {
    round: leg.round, track: leg.track, challengeIndex: deal.mode === 2 ? 1 : 0, mode: deal.mode,
    inputs: inputs as [number, number, number, number],
    characters: faces as [number, number, number, number],
    humanCars: deal.humans, cars: deal.cars, laps: deal.laps,
  };
}

/** Points for finishing: the winner takes one per car, the last one takes one. */
export function points(place: number, cars: number): number {
  return Math.max(0, cars - place + 1);
}

/**
 * A number that is the same on two machines only if they are about to run the same race from the same
 * bytes. It covers the files themselves rather than a manifest, so it works the same whether the copy came
 * from the server or from the visitor's own folder.
 */
function fingerprint(f: RaceFiles): number {
  let h = 0x811C9DC5;
  const fold = (b: Uint8Array | undefined): void => {
    h = Math.imul(h ^ (b ? hashBytes(b) : 0x9E3779B9), 0x01000193) >>> 0;
  };
  fold(f.exe); fold(f.settings); fold(f.brk); fold(f.lev); fold(f.strtPos); fold(f.cheats);
  fold(f.map); fold(f.ct); fold(f.col); fold(f.dir); fold(f.pal); fold(f.ph0); fold(f.vh0);
  for (const p of f.pr) fold(p);
  return h >>> 0;
}

async function openFiles(): Promise<GameFiles> {
  const served = await fromServerIfServed();
  if (served) return served;
  const box = $('#needfiles');
  const input = $<HTMLInputElement>('#folder');
  const why = document.querySelector('#why');
  $('#pickfolder').addEventListener('click', () => input.click());
  box.hidden = false;
  const files = await fromFolderInput(input, msg => { if (why) why.textContent = msg; });
  box.hidden = true;
  return files;
}

async function loadRace(files: GameFiles, leg: Leg): Promise<RaceFiles> {
  const names = raceFileNames(leg.round, leg.track);
  const opt = async (n: string): Promise<Uint8Array | undefined> => (files.has(n) ? files.read(n) : undefined);
  const pr: Uint8Array[] = [];
  for (const k of ['pr0', 'pr1', 'pr2']) { const b = await opt(names[k]!); if (b) pr.push(b); }
  return {
    exe: unpackPklite(await files.read(names['exe']!)).image, settings: await opt(names['settings']!),
    brk: await opt(names['brk']!), lev: await opt(names['lev']!), strtPos: await files.read(names['strtPos']!),
    cheats: await files.read(names['cheats']!), map: await files.read(names['map']!), ct: await files.read(names['ct']!),
    col: await files.read(names['col']!), dir: await files.read(names['dir']!), pal: await files.read(names['pal']!),
    ph0: await files.read(names['ph0']!), vh0: await files.read(names['vh0']!), pr,
  };
}

/**
 * "cannot reach the relay" is true and useless: it is the same sentence whether the relay is down, the
 * address is wrong, or something in between refused the upgrade. The relay answers a plain GET on the same
 * address, so ask it that and say which of those it was. Locally the answer is almost always that
 * `npm run relay` was never started, and it costs a person twenty minutes to work that out for themselves.
 */
async function whyNot(e: unknown): Promise<string> {
  const said = e instanceof Error ? e.message : String(e);
  if (!/cannot reach the relay|closed the connection/.test(said)) return said;
  try {
    const r = await fetch('/api/relay', { cache: 'no-store' });
    if (r.ok) return 'the relay is running but would not take the connection.';
  } catch { /* it is not answering at all, which is the next line */ }
  const here = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  return here
    ? 'the relay is not running: `npm run relay`, beside `npm run dev`.'
    : 'the relay is not answering. Try again in a moment.';
}

/**
 * The feedback section, which is always on the page. It is the only thing here that sends anything
 * anywhere, and it sends exactly what was typed: no name, no address, nothing about the machine. The room
 * code goes with it, when there is one, so that a report of something going wrong can be lined up with
 * what the relay saw at the time.
 */
function wireFeedback(room: () => string): void {
  const form = $<HTMLFormElement>('#feedbackform');
  const box = $<HTMLTextAreaElement>('#feedback');
  const thanks = $('#thanks');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = box.value.trim();
    if (text === '') { thanks.textContent = 'write something first'; return; }
    thanks.textContent = 'sending…';
    void fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(room() === '' ? { text } : { text, room: room() }),
    }).then(r => {
      // A failure here is worth saying out loud rather than swallowing: somebody took the trouble to write
      // it, and being told it went nowhere is better than being told it arrived when it did not.
      if (!r.ok) { thanks.textContent = 'that did not send, sorry. Try again in a moment.'; return; }
      box.value = '';
      box.disabled = true;
      thanks.textContent = 'thank you.';
    }).catch(() => { thanks.textContent = 'that did not send, sorry. Try again in a moment.'; });
  });
}

/** Where every car finished one leg, by car number. */
interface Result { places: number[] }

/**
 * One leg, from the flag to the finish. Resolves with where everybody came, or undefined when the race
 * ended because there was nobody left to race.
 */
function runLeg(wire: NetTransport, files: RaceFiles, deal: Deal, mine: number, gen: number,
                sound?: SoundOutput): Promise<Result | undefined> {
  lobby.hidden = true;
  stage.hidden = false;
  under.hidden = false;
  board.hidden = true;
  overlay.hidden = !new URLSearchParams(location.search).has('debug');
  stage.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const built = setupRace(files, { ...params(deal, deal.legs[gen]!), viewport: VP });
  const r = new Race(built.ds, VP);
  // In a race everybody watches their own car, which is why the drawing gets a camera of its own and the
  // one in the data segment is left to decide what it decides. Head to head is the exception and must be:
  // its camera sits between the two cars on purpose, and falling off it is how a round is lost.
  const own = deal.mode !== 2 ? new View(VP) : undefined;
  r.followLeader = own !== undefined;
  // No shove for whoever falls behind: see Race.catchup. Head to head keeps the game's own rules, where
  // being left behind is the point of the mode rather than something to be rescued from.
  r.catchup = deal.mode === 2;
  const renderer = new RaceRenderer({
    ds: built.ds, mapWords: built.mapWords, banks: built.banks, vehicle: built.vehicle,
    extra: built.extra, viewport: VP,
  });
  renderer.race = r;
  if (sound) r.sound = sound;
  if (own) { own.jumpTo(built.ds, CARS[mine]!); renderer.view = own; renderer.hudCar = CARS[mine]!; }
  const peer = new Peer(r, deal.humans, deal.smoothness);
  let frame: Uint8Array | undefined;
  /**
   * How many of the frames about to be produced nobody will ever see.
   *
   * A slow machine runs several logic steps between two frames of the browser's, and the game draws on
   * every other step, so it would rasterise the whole scene three or four times and show the last one. That
   * costs the most exactly when there is least to spare, and it feeds on itself: the slower it draws, the
   * more steps pile up between frames, and the more it draws. Only the last one is worth the work.
   *
   * The side effects still run for every one of them: fn 90c5 is where the skid and foam emitters live, so
   * a skipped frame that skipped those would be a different race.
   */
  let skipDraws = 0;
  peer.sim.onRender = sideEffects => {
    // The game's camera moves once per logic step, so the view is asked for that many.
    own?.follow(built.ds, CARS[mine]!, deal.smoothness);
    if (skipDraws > 0) { skipDraws--; sideEffects(); return; }
    frame = renderer.render(sideEffects);
  };

  const pal = paletteToRgba(decodePalette(built.palette));
  const canvas = $<HTMLCanvasElement>('#screen');
  canvas.width = VP.outWidth; canvas.height = VP.height;
  const ctx = canvas.getContext('2d')!;
  const off = document.createElement('canvas');
  off.width = VP.outWidth; off.height = VP.height;
  const octx = off.getContext('2d')!;
  const img = octx.createImageData(VP.outWidth, VP.height);
  const present = (): void => {
    if (!frame) return;
    const out = new Uint32Array(img.data.buffer);
    for (let i = 0; i < VP.outWidth * VP.height; i++) out[i] = pal[frame[i]!]!;
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  };

  const outbox = new Outbox();
  let sentHashAt = -1, desync = -1, checks = 0, gone = false;
  /**
   * Diagnostics, and only that. `?corrupt=N` breaks this machine on purpose at step N, to watch the others
   * notice; `?end=N` finishes the leg there, so a playlist can be tried without driving three laps first.
   * Both write to the state, so every machine has to be given the same number or they are a desync.
   */
  const debug = new URLSearchParams(location.search);
  const corruptAt = Number(debug.get('corrupt') ?? 0), endAt = Number(debug.get('end') ?? 0);
  /** The step counters and rollback numbers are for working on this, not for playing it. */
  const chatty = debug.has('debug');
  let corrupted = false;
  /**
   * Somebody who has gone still has a car on the track, and the race cannot go on until every step of
   * theirs is accounted for. Their last byte is repeated for them, which is what their absence would have
   * been predicted as anyway, and the car carries on as they left it.
   */
  const left = new Set<number>();

  return new Promise<Result | undefined>(done => {
    // The lobby's handlers stay underneath and are put back at the finish. A machine that got to the end
    // first is already talking about the next leg while this one is still racing, and those messages have
    // to reach the lobby or the playlist stops dead between two races.
    const wasPacket = wire.onPacket, wasLeave = wire.onLeave;
    let stop = (): void => { /* replaced once the clocks below exist */ };
    const finish = (r: Result | undefined): void => {
      stop();
      wire.onPacket = wasPacket; wire.onLeave = wasLeave;
      peer.sim.onRender = undefined;
      done(r);
    };
    wire.onLeave = slot => {
      wasLeave?.(slot);
      if (slot < deal.humans) left.add(slot);
      if (left.size >= deal.humans - 1) gone = true;
    };
    wire.onPacket = (from, data) => {
      wasPacket?.(from, data);
      if (from === mine || from >= deal.humans) return;   // somebody in the room who is not in the race
      const p = decodePacket(data);
      if (!p || p.kind === SAY || p.gen !== gen) return;  // a packet from another leg drives nobody's car
      if (p.kind === INPUT) {
        for (let i = 0; i < p.bytes.length; i++) peer.input(from, p.from + i, p.bytes[i]!);
      } else if (p.kind === HASH) {
        const ours = peer.hashAt(p.step);
        // Silence when the step has already fallen out of the window: not knowing is not disagreeing.
        if (ours === undefined) return;
        checks++;
        if (ours !== p.hash && desync < 0) desync = p.step;
      }
    };

    let acc = 0, last = performance.now(), since = last, wasRolls = 0, rate = 0, frames = 0, fps = 0;
    /** Set when the leg is over, so a frame that arrives late does not carry on racing. */
    let ended = false;
    const drawing = peer.sim.onRender;
    const tick = (now: number): void => {
      acc += Math.min(0.25, (now - last) / 1000); last = now;
      // Everything but the last of the batch about to run is state without a picture: see skipDraws.
      const want = Math.floor(acc / PER_STEP);
      const allowed = Math.max(0, peer.confirmed + RUN_AHEAD + 1 - peer.step);
      skipDraws = Math.max(0, Math.ceil(Math.min(want, allowed) / deal.smoothness) - 1);

      while (acc >= PER_STEP) {
        acc -= PER_STEP;
        // Input is recorded for the step this machine is **about to run**, never for a clock running ahead
        // of it. A free running counter looks the same until somebody falls behind, and then the local
        // player's own steering sits in the log waiting to be simulated: a quarter of a second of lag on
        // your own car, felt as the whole game having gone heavy. Everybody else's car is predicted, which
        // is what the rollback is for; your own never has to be.
        if (peer.step > peer.confirmed + RUN_AHEAD) { acc = 0; break; }   // let the others catch up
        const at = peer.step;
        peer.input(mine, at, keys);
        outbox.record(at, keys);
        for (const s of left) peer.input(s, at, peer.tracks[s]!.at(at));
        peer.advanceTo(at + 1);
        if (peer.over) break;
      }
      skipDraws = 0;
      const packet = outbox.packet(gen);
      if (packet) wire.send(packet);
      if (sound) {
        // The ah=5, ah=8 and ah=0a calls the race made, exactly as the single player page drains them.
        for (const { fn, arg } of r.sounds) {
          if (fn === 8) { sound.play(arg, true); continue; }
          if (fn === 0x0A && sound.isPlaying(arg)) continue;
          sound.play(arg);
        }
        r.sounds.length = 0;
        sound.pump();
      }
      if (corruptAt > 0 && !corrupted && peer.step >= corruptAt) {
        corrupted = true;
        peer.poke(0x1262, peer.sim.d.r8(0x1262) ^ 0xFF);
      }
      if (endAt > 0 && peer.step >= endAt && built.ds.rs16(0x26C6) < 2) built.ds.w16(0x26C6, 2);
      present();

      const c = peer.confirmedHash();
      if (c && c.step - sentHashAt >= CHECK_EVERY) { wire.send(encodeHash(gen, c.step, c.hash)); sentHashAt = c.step; }

      frames++;
      if (now - since > 500) {
        rate = Math.round((peer.rollbacks - wasRolls) * 1000 / (now - since));
        fps = Math.round(frames * 1000 / (now - since));
        wasRolls = peer.rollbacks; since = now; frames = 0;
      }
      const leg = deal.legs[gen]!;
      const ahead = peer.step - peer.confirmed - 1;
      if (chatty) {
        const line = `you are car ${mine + 1} · race ${gen + 1} of ${deal.legs.length},`
          + ` round ${leg.round} track ${leg.track} · step ${peer.step} · agreed up to ${peer.confirmed}`
          + ` · ${ahead} ahead on guesses · ${fps} fps`
          + ` · rollbacks ${peer.rollbacks} (${rate}/s) · states compared ${checks}`
          + (left.size > 0 ? ` · ${left.size} gone` : '')
          + (desync >= 0 ? ` · DESYNC at step ${desync}` : '');
        say(line);
        overlay.textContent = line;              // and inside the stage, where full screen can see it
      } else if (desync >= 0) {
        say('the machines have fallen out of step with each other. Reload and start again.');
      } else if (left.size > 0) {
        say(`${left.size === 1 ? 'a player' : `${left.size} players`} left; their cars carry on as they left them.`);
      } else {
        say('');
      }

      if (gone) { say('everybody else left'); ended = true; sound?.stopAll(); finish(undefined); return; }
      if (peer.over) {
        sound?.stopAll();
        present();
        ended = true;
        finish({ places: CARS.map(bx => built.ds.r16(bx + 0x12EF)) });
        return;
      }
    };

    /**
     * A frame that throws would kill the loop silently and for good, and leave somebody looking at a still
     * picture with nothing to say why. It is caught, said out loud, and the leg ends.
     *
     * Drawing is skipped while nobody can see it, which is also what stops catching up afterwards from
     * arriving as one long freeze. See clock.ts for why the clock is not just `requestAnimationFrame`.
     */
    const clock = startClock(now => {
      if (ended) return false;
      peer.sim.onRender = document.hidden ? undefined : drawing;
      try { tick(now); } catch (e) {
        ended = true;
        say(`the race stopped: ${String(e)}`);
        finish(undefined);
        return false;
      }
      return !ended;
    });
    stop = () => { ended = true; clock.stop(); };
  });
}

function showBoard(deal: Deal, table: number[], gen: number, mine: number): void {
  stage.hidden = true;
  under.hidden = true;
  board.hidden = false;
  board.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const done = gen + 1 >= deal.legs.length;
  const order = [...table.keys()].filter(i => i < deal.cars).sort((a, b) => table[b]! - table[a]!);
  board.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = done ? 'Final standings' : `After race ${gen + 1} of ${deal.legs.length}`;
  board.append(h);
  const ol = document.createElement('ol');
  for (const car of order) {
    const li = document.createElement('li');
    const who = car < deal.humans ? `Player ${car + 1}` : `Computer, car ${car + 1}`;
    li.textContent = `${who} — ${table[car]} point${table[car] === 1 ? '' : 's'}`;
    if (car === mine) li.className = 'you';
    ol.append(li);
  }
  board.append(ol);
  if (!done) {
    const p = document.createElement('p');
    p.className = 'tag';
    p.textContent = 'next race loading';
    board.append(p);
  }
}

async function main(): Promise<void> {
  const q = new URLSearchParams(location.search);

  const roomLine = $('#roomline');
  const code = $('#code');
  const who = $('#who');
  const start = $<HTMLButtonElement>('#start');
  const setup = $('#setup');
  const kind = $<HTMLSelectElement>('#kind');
  const lapsIn = $<HTMLInputElement>('#laps');
  const carsIn = $<HTMLSelectElement>('#cars');
  const trackIn = $<HTMLSelectElement>('#track');
  const listUl = $('#list');
  const join = $<HTMLInputElement>('#joincode');
  fullscreen(stage, $<HTMLCanvasElement>('#screen'));
  let roomCode = '';
  wireFeedback(() => roomCode);
  // The same boat as the front page, and the same duck: it reads the page's own furniture to know what it
  // has to steer around, so it needs nothing from here beyond the two images.
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  startHero($('#head'), $<HTMLCanvasElement>('#hero-canvas'), `${base}mm-boat.png`, `${base}mm-duck.png`);

  // The playlist. Round 9 is the time trial, which is one car on its own and not a race.
  for (let round = 1; round <= 8; round++) for (let track = 1; track <= 3; track++) {
    const o = document.createElement('option');
    o.value = `${round},${track}`;
    o.textContent = `Round ${round} · track ${track}`;
    trackIn.append(o);
  }
  const legs: Leg[] = [{ round: Number(q.get('round') ?? 2), track: Number(q.get('track') ?? 1) }];
  const drawList = (): void => {
    listUl.innerHTML = '';
    legs.forEach((leg, i) => {
      const li = document.createElement('li');
      li.textContent = `Round ${leg.round} · track ${leg.track} `;
      if (legs.length > 1) {
        const x = document.createElement('button');
        x.type = 'button'; x.textContent = 'remove';
        x.addEventListener('click', () => { legs.splice(i, 1); drawList(); });
        li.append(x);
      }
      listUl.append(li);
    });
  };
  drawList();
  $('#add').addEventListener('click', () => {
    if (legs.length >= 12) { say('twelve races is plenty for one evening.'); return; }
    const [round, track] = trackIn.value.split(',').map(Number);
    legs.push({ round: round!, track: track! });
    drawList();
  });

  const enter = async (want?: string): Promise<void> => {
    say('connecting…');
    let wire: Relay;
    try { wire = await Relay.join(want); }
    catch (e) { say(await whyNot(e)); return; }

    $('#choices').hidden = true;
    roomCode = wire.room;
    roomLine.hidden = false;
    roomLine.scrollIntoView({ block: 'center', behavior: 'smooth' });
    code.textContent = wire.room;
    const share = new URL(location.href);
    share.searchParams.set('room', wire.room);
    $<HTMLAnchorElement>('#share').href = share.toString();
    $<HTMLAnchorElement>('#share').textContent = share.toString();

    const host = wire.slot === 0;
    let agreed: Deal | undefined;
    let files: GameFiles | undefined;
    let started = false;
    /**
     * The AdLib driver, once. It is made on the way into the first race rather than at load: an audio
     * context started without somebody having clicked something is refused, and by then they have clicked
     * Start or Join.
     */
    let sound: SoundOutput | undefined;
    const wakeSound = async (g: GameFiles): Promise<void> => {
      if (sound || !g.has('DRIVER1.BIN')) return;
      try {
        sound = new SoundOutput(await g.read('DRIVER1.BIN'));
        sound.start();
      } catch { sound = undefined; }          // no audio on this machine: the race is silent, not broken
    };

    const room = (): void => {
      const n = wire.peers.length + 1;
      who.textContent = n < 2 ? 'waiting for somebody to join…' : `${n} in the room`;
      setup.hidden = !host;
      start.hidden = !host;
      start.disabled = !host || wire.peers.length === 0;
    };

    // Before the handlers, not after: closing the socket reports everybody in the room as having left, and
    // a leave handler already in place would talk over the sentence that explains what actually happened.
    if (wire.slot >= MAX) {
      say('that room is full.');
      wire.close();
      return;
    }

    wire.onJoin = room;
    wire.onLeave = () => { room(); if (!started) say('somebody left the room'); };
    wire.onError = why => { say(why); };
    room();

    /**
     * Everybody's fingerprint, by leg and slot. Kept by leg and never cleared, because a machine that
     * finished a moment earlier says it is ready for the next one while this machine is still watching the
     * table, and throwing that away would leave both sides waiting for a message that was already sent.
     */
    const prints = new Map<string, number>();
    let myPrint: number | undefined;
    let waiting: { gen: number; go: () => void } | undefined;

    const allAgree = (deal: Deal, gen: number): boolean => {
      if (myPrint === undefined) return false;
      for (let s = 0; s < deal.humans; s++) if (s !== wire.slot && !prints.has(`${gen}:${s}`)) return false;
      return true;
    };

    /** Loads a leg on every machine and waits until they all say they have the same files. */
    const settle = async (deal: Deal, gen: number): Promise<RaceFiles | undefined> => {
      myPrint = undefined;
      files ??= await openFiles();
      await wakeSound(files);
      const raceFiles = await loadRace(files, deal.legs[gen]!);
      myPrint = fingerprint(raceFiles);
      wire.send(encodeSay({ ready: gen, fp: myPrint }));
      if (!allAgree(deal, gen)) {
        say('waiting for the other machines…');
        await new Promise<void>(res => { waiting = { gen, go: res }; });
        waiting = undefined;
      }
      for (let s = 0; s < deal.humans; s++) {
        if (s !== wire.slot && prints.get(`${gen}:${s}`) !== myPrint) {
          say('these machines have different copies of the game, so the race would drift apart. '
            + 'Everybody needs the same installed files.');
          return undefined;
        }
      }
      return raceFiles;
    };

    /** The whole evening: every leg in order, with the table in between. */
    const play = async (deal: Deal): Promise<void> => {
      started = true;
      const table = [0, 0, 0, 0];
      for (let gen = 0; gen < deal.legs.length; gen++) {
        const raceFiles = await settle(deal, gen);
        if (!raceFiles) return;
        const result = await runLeg(wire, raceFiles, deal, wire.slot, gen, sound);
        if (!result) return;
        for (let car = 0; car < deal.cars; car++) table[car]! += points(result.places[car] ?? deal.cars, deal.cars);
        showBoard(deal, table, gen, wire.slot);
        if (gen + 1 < deal.legs.length) await new Promise(res => setTimeout(res, 4000));
      }
      say('that is the lot. Reload to play again.');
    };

    wire.onPacket = (from, data) => {
      const p = decodePacket(data);
      if (!p || p.kind !== SAY) return;
      let body: { go?: Deal; ready?: number; fp?: number };
      try { body = JSON.parse(p.text) as typeof body; } catch { return; }
      if (body.go && !agreed && from === 0) {          // the room's first member is the one who decides
        agreed = body.go;
        if (wire.slot >= agreed.humans) { say('that race started without you.'); return; }
        void play(agreed);
      }
      if (typeof body.fp === 'number' && typeof body.ready === 'number') {
        prints.set(`${body.ready}:${from}`, body.fp);
        if (agreed && waiting && allAgree(agreed, waiting.gen)) waiting.go();
      }
    };

    start.addEventListener('click', () => {
      const here = Math.min(MAX, wire.peers.length + 1);
      const h2h = kind.value === 'h2h';
      if (h2h && here !== 2) { say('head to head is two players. The others have to leave the room first.'); return; }
      const cars = h2h ? 2 : Math.max(here, Number(carsIn.value));
      const laps = Math.min(MAX_LAPS, Math.max(MIN_LAPS, Math.round(Number(lapsIn.value) || MIN_LAPS)));
      start.disabled = true;
      setup.hidden = true;
      agreed = { legs: [...legs], laps, cars, humans: h2h ? 2 : here, mode: h2h ? 2 : 1, smoothness: SMOOTHNESS };
      wire.send(encodeSay({ go: agreed }));
      void play(agreed);
    });

    say(host ? 'read the code out, wait for everybody, then press Start.' : 'waiting for the first player to start…');
  };

  $('#create').addEventListener('click', () => { void enter(); });
  $('#joinform').addEventListener('submit', e => {
    e.preventDefault();
    const want = join.value.trim().toUpperCase();
    if (want.length !== 4) { say('a room code is four letters'); return; }
    void enter(want);
  });

  const invited = q.get('room');
  if (invited) { join.value = invited.toUpperCase(); void enter(invited.toUpperCase()); }
  else say('make a room, or type the code somebody gave you.');
}

main().catch((e: unknown) => { say(String(e)); });

/**
 * Two machines racing each other on one screen, with a wire between them you can make as bad as you like.
 *
 * There is no network here and that is the point: both sides are in this tab, so anything that goes wrong
 * is the netcode and not the internet. Drive the left one. The right one is the other player's screen,
 * running the same race from the same inputs, hearing about yours however late the slider says.
 *
 * The two numbers at the bottom are hashes of the whole 64 KB of game state. If they ever differ, the
 * machines are playing different games, and everything after that is noise. The CORRUPT button proves the
 * detector works by breaking one on purpose.
 */
import { GameFiles } from '../../hal/fs/GameFiles';
import { decodePalette, paletteToRgba } from '../../data/palette';
import { unpackPklite } from '../../data/pklite';
import { setupRace, raceFileNames, type RaceFiles } from '../../engine/setup';
import { Race } from '../../engine/race';
import { RaceRenderer } from '../../engine/render';
import { DOS_VIEWPORT } from '../../engine/viewport';
import { Peer } from '../../net/Peer';

const VP = DOS_VIEWPORT;
const TICK = 1 / 70.086;
const SMOOTHNESS = 2;                 // agreed between the machines, never read from the local settings
const REDUNDANCY = 8;                 // steps of input per packet, so one lost packet costs nothing

const $ = <T extends HTMLElement>(s: string): T => document.querySelector<T>(s)!;
const status = $('#status');

/** P1 keys as in SETTINGS.DAT. */
const KEYS: Record<string, number> = {
  KeyA: 0x80, ArrowLeft: 0x80, KeyD: 0x40, ArrowRight: 0x40, KeyW: 0x20, ArrowUp: 0x20,
  KeyS: 0x10, ArrowDown: 0x10, AltLeft: 0x08, AltRight: 0x08, Space: 0x08,
};
let keys = 0;
addEventListener('keydown', e => { const b = KEYS[e.code]; if (b) { keys |= b; e.preventDefault(); } });
addEventListener('keyup', e => { const b = KEYS[e.code]; if (b) { keys &= ~b; e.preventDefault(); } });
addEventListener('blur', () => { keys = 0; });

/** The pretend other player, so there is something to race without finding a second human. */
function opponent(step: number): number {
  let v = Math.imul(step * 2654435761 + 99991, 0x27220A95) >>> 0;
  v ^= v >>> 13;
  return 0x20 | ((v & 0xFF) < 90 ? ((v >> 9) & 1 ? 0x80 : 0x40) : 0);
}

/** The wire: a packet carries the last few steps, so losing one is covered by the next. */
class Wire {
  private readonly queue: { at: number; from: number; bytes: number[] }[] = [];
  private readonly history: number[] = [];
  lagSteps = 4;
  loss = 0;
  constructor(readonly car: number) {}

  post(now: number, step: number, byte: number): void {
    this.history[step] = byte;
    if (this.loss > 0 && Math.random() < this.loss) return;
    const from = Math.max(0, step - REDUNDANCY + 1);
    this.queue.push({ at: now + this.lagSteps, from, bytes: this.history.slice(from, step + 1) });
  }

  deliver(now: number, to: Peer): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const p = this.queue[i]!;
      if (p.at > now) continue;
      p.bytes.forEach((b, k) => to.input(this.car, p.from + k, b));
      this.queue.splice(i, 1);
    }
  }
}

interface Side { peer: Peer; renderer: RaceRenderer; canvas: HTMLCanvasElement; frame?: Uint8Array }

async function main(): Promise<void> {
  status.textContent = 'loading…';
  const files = await GameFiles.fromServer();
  const q = new URLSearchParams(location.search);
  const round = Number(q.get('round') ?? 2), track = Number(q.get('track') ?? 1);
  const names = raceFileNames(round, track);
  const opt = async (n: string): Promise<Uint8Array | undefined> => (files.has(n) ? files.read(n) : undefined);
  const pr: Uint8Array[] = [];
  for (const k of ['pr0', 'pr1', 'pr2']) { const b = await opt(names[k]!); if (b) pr.push(b); }
  const raceFiles: RaceFiles = {
    exe: unpackPklite(await files.read(names['exe']!)).image, settings: await opt(names['settings']!),
    brk: await opt(names['brk']!), lev: await opt(names['lev']!), strtPos: await files.read(names['strtPos']!),
    cheats: await files.read(names['cheats']!), map: await files.read(names['map']!), ct: await files.read(names['ct']!),
    col: await files.read(names['col']!), dir: await files.read(names['dir']!), pal: await files.read(names['pal']!),
    ph0: await files.read(names['ph0']!), vh0: await files.read(names['vh0']!), pr,
  };

  /** One machine. Both are built from the same parameters, which is what makes them the same game. */
  const machine = (canvas: HTMLCanvasElement): Side => {
    const a = setupRace(raceFiles, {
      round, track, challengeIndex: 1, mode: 2, inputs: [4, 5, 6, 6], characters: [3, 5, 6, 6], viewport: VP,
    });
    const race = new Race(a.ds, VP);
    const renderer = new RaceRenderer({ ds: a.ds, mapWords: a.mapWords, banks: a.banks, vehicle: a.vehicle, extra: a.extra, viewport: VP });
    renderer.race = race;
    const peer = new Peer(race, 2, SMOOTHNESS);
    const side: Side = { peer, renderer, canvas };
    peer.sim.onRender = sideEffects => { side.frame = renderer.render(sideEffects); };
    return side;
  };

  const left = machine($<HTMLCanvasElement>('#a'));
  const right = machine($<HTMLCanvasElement>('#b'));
  const pal = paletteToRgba(decodePalette(setupRace(raceFiles, {
    round, track, challengeIndex: 1, mode: 2, inputs: [4, 5, 6, 6], characters: [3, 5, 6, 6], viewport: VP,
  }).palette));

  for (const s of [left, right]) { s.canvas.width = VP.outWidth; s.canvas.height = VP.height; }
  const off = document.createElement('canvas');
  off.width = VP.outWidth; off.height = VP.height;
  const octx = off.getContext('2d')!;
  const img = octx.createImageData(VP.outWidth, VP.height);
  const present = (s: Side): void => {
    if (!s.frame) return;
    const out = new Uint32Array(img.data.buffer);
    for (let i = 0; i < VP.outWidth * VP.height; i++) out[i] = pal[s.frame[i]!]!;
    octx.putImageData(img, 0, 0);
    const c = s.canvas.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    c.drawImage(off, 0, 0, s.canvas.width, s.canvas.height);
  };

  const toRight = new Wire(0);            // your bytes, going to the other machine
  const toLeft = new Wire(1);             // theirs, coming back
  const lag = $<HTMLInputElement>('#lag');
  const loss = $<HTMLInputElement>('#loss');
  const readWires = (): void => {
    const ms = Number(lag.value);
    const steps = Math.round(ms / 1000 / (TICK * 1.5));    // a step is about one and a half ticks
    toRight.lagSteps = toLeft.lagSteps = steps;
    toRight.loss = toLeft.loss = Number(loss.value) / 100;
    $('#lagv').textContent = `${ms} ms`;
    $('#lossv').textContent = `${loss.value}%`;
  };
  lag.addEventListener('input', readWires);
  loss.addEventListener('input', readWires);
  readWires();

  $('#corrupt').addEventListener('click', () => { right.peer.poke(0x1262, right.peer.sim.d.r8(0x1262) ^ 0xFF); });

  let acc = 0, last = performance.now(), step = 0, since = performance.now(), wasRoll = 0, rate = 0, worst = 0;
  const loop = (now: number): void => {
    acc += Math.min(0.25, (now - last) / 1000); last = now;
    const perStep = TICK * 1.5;                              // SMOOTHNESS 2: three ticks to two steps
    while (acc >= perStep) {
      acc -= perStep;
      const mine = keys, theirs = opponent(step);
      left.peer.input(0, step, mine);                        // each machine knows its own at once
      right.peer.input(1, step, theirs);
      toRight.post(step, step, mine);
      toLeft.post(step, step, theirs);
      toRight.deliver(step, right.peer);
      toLeft.deliver(step, left.peer);
      left.peer.advanceTo(step + 1);
      right.peer.advanceTo(step + 1);
      step++;
    }
    present(left); present(right);

    if (now - since > 500) {
      rate = Math.round((left.peer.rollbacks - wasRoll) * 1000 / (now - since));
      wasRoll = left.peer.rollbacks; since = now;
    }
    // Compare the past both machines have been told about, never where they are now: where they are now
    // contains each one's guesses about the other, and those are meant to differ.
    const ca = left.peer.confirmedHash(), cb = right.peer.confirmedHash();
    const at = ca && cb ? Math.min(ca.step, cb.step) : -1;
    const ha = ca?.hash, hb = cb?.hash;
    const sync = ca !== undefined && cb !== undefined && ca.step === cb.step && ca.hash === cb.hash;
    if (sync) worst = 0; else if (ca && cb && ca.step === cb.step) worst = ca.step;
    $('#sync').textContent = worst > 0 ? `DESYNC at step ${worst}` : sync ? 'IN SYNC' : 'settling…';
    $('#sync').className = worst > 0 ? 'bad' : 'ok';
    const hex = (h?: number): string => (h === undefined ? '--------' : h.toString(16).padStart(8, '0'));
    status.textContent =
      `step ${left.peer.step} · agreed up to ${at} · running ${left.peer.step - left.peer.confirmed - 1} ahead on guesses`
      + ` · rollbacks ${left.peer.rollbacks} (${rate}/s) · steps re-run ${left.peer.resimulated}`
      + ` · you ${hex(ha)} · them ${hex(hb)}`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main().catch((e: unknown) => { status.textContent = String(e); });

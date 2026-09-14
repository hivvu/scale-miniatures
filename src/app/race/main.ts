/** Playable race demo. Builds the whole race state from the game files (dev only: the Vite plugin serves the local
 *  MicroMac folder). Query parameters: ?round=2&track=1 (defaults: round 2 track 1, the first Challenge race). */
import { GameFiles } from '../../hal/fs/GameFiles';
import { decodePalette, paletteToRgba } from '../../data/palette';
import { unpackPklite } from '../../data/pklite';
import { setupRace, raceFileNames, type RaceFiles } from '../../engine/setup';
import { Race } from '../../engine/race';
import { RaceRenderer } from '../../engine/render';
import { DOS_VIEWPORT, makeViewport } from '../../engine/viewport';

const status = document.querySelector('#status') as HTMLElement;
const canvas = document.querySelector('#screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const params = new URLSearchParams(location.search);
const VIEWPORT = ((): typeof DOS_VIEWPORT => {
  try { return makeViewport(Number(params.get('width') ?? 256), Number(params.get('height') ?? 200)); }
  catch { return DOS_VIEWPORT; }
})();
canvas.width = VIEWPORT.outWidth; canvas.height = VIEWPORT.height;
canvas.style.width = `${VIEWPORT.outWidth * 3}px`;
canvas.style.height = 'auto';
const off = document.createElement('canvas'); off.width = VIEWPORT.outWidth; off.height = VIEWPORT.height;
const octx = off.getContext('2d')!;
const img = octx.createImageData(VIEWPORT.outWidth, VIEWPORT.height);

// P1 keys as in SETTINGS.DAT: A left, D right, W up (accelerate), S down (brake), Alt fire
const KEYS: Record<string, number> = { KeyA: 0x80, ArrowLeft: 0x80, KeyD: 0x40, ArrowRight: 0x40, KeyW: 0x20, ArrowUp: 0x20,
  KeyS: 0x10, ArrowDown: 0x10, AltLeft: 0x08, AltRight: 0x08, Space: 0x08 };
let keys = 0;
window.addEventListener('keydown', e => { const b = KEYS[e.code]; if (b) { keys |= b; e.preventDefault(); } });
window.addEventListener('keyup', e => { const b = KEYS[e.code]; if (b) { keys &= ~b; e.preventDefault(); } });
window.addEventListener('blur', () => { keys = 0; });

async function main(): Promise<void> {
  status.textContent = 'loading…';
  const files = await GameFiles.fromServer();
  const q = params;
  const round = Number(q.get('round') ?? 2), track = Number(q.get('track') ?? 1);
  const names = raceFileNames(round, track);
  document.querySelector('h1')!.textContent = `Round ${round}, track ${track} (engine test)`;
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
  // Challenge, player 1 on keys 1 (character 10), three AI cars (character 6), as the first Challenge race is set up
  const { ds, mapWords, banks, vehicle, extra, palette } = setupRace(raceFiles, { round, track, challengeIndex: 0, mode: 1, inputs: [4, 6, 6, 6], characters: [10, 6, 6, 6], viewport: VIEWPORT });
  const pal = paletteToRgba(decodePalette(palette));
  const race = new Race(ds, VIEWPORT);
  const renderer = new RaceRenderer({ ds, mapWords, banks, vehicle, extra, viewport: VIEWPORT });
  renderer.race = race;

  const TICK = 1 / 70.086;                    // VGA frame = game tick
  const stepsPerFrame = ds.r16(0x263A);        // SMOOTHNESS (2 = GOOD)
  const ticksPerFrame = [0, 1, 3, 5, 7, 32][stepsPerFrame] ?? 3;
  let acc = 0, last = performance.now(), ticks = 0, steps = 0, frame: Uint8Array | undefined;
  const present = (fb: Uint8Array): void => {
    const out = new Uint32Array(img.data.buffer);
    for (let i = 0; i < VIEWPORT.outWidth * VIEWPORT.height; i++) out[i] = pal[fb[i]!]!;
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  };
  const loop = (now: number): void => {
    acc += Math.min(0.1, (now - last) / 1000); last = now;
    try {
      while (acc >= TICK * ticksPerFrame) {
        acc -= TICK * ticksPerFrame;
        for (let s = 0; s < stepsPerFrame; s++) {
          ticks += ticksPerFrame / stepsPerFrame;
          // int 8 blink counter: [26d0] += 1 per tick, toggles [26cf] every 32 ticks
          const blinkTicks = Math.floor(ticks);
          ds.w8(0x26D0, blinkTicks & 0x1F); ds.w8(0x26CF, (blinkTicks >> 5) & 1);
          race.stepPhysics(keys);
          if (race.over) { if (frame) present(frame); status.textContent = `race over after ${steps} steps (position ${ds.r16(0x12EF)})`; return; }
          if (race.rendersThisStep) frame = renderer.render(() => race.renderSideEffects());
          race.stepPost(); steps++;
        }
      }
    } catch (e) {
      status.textContent = `stopped at step ${steps}: ${String(e)}`; if (frame) present(frame); return;
    }
    if (frame) present(frame);
    const c0 = 0;
    status.textContent = `step ${steps} · speed ${ds.rs16(c0 + 0x127A)} · heading ${ds.r16(c0 + 0x1278)} · laps left ${ds.rs16(c0 + 0x12ED)} · rank ${ds.r16(c0 + 0x12EF)} · progress ${ds.r16(c0 + 0x12E3)}`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
main().catch(e => { status.textContent = String(e); });

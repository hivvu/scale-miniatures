/**
 * The game from the title screen on: the front-end menus (src/engine/menus.ts) hand over to the Challenge
 * sequence (src/engine/sequence.ts), which announces each race, runs it and shows the verdict. One data
 * segment is shared by the menus, the sequence and the race, as in the original.
 */
import { GameFiles } from '../../hal/fs/GameFiles';
import { fromServerIfServed, fromFolderInput } from '../../hal/fs/openGameFiles';
import { SCANCODE } from '../../hal/input/scancodes';
import { BrowserDevices } from '../../hal/input/Analogue';
import { DOS_VIEWPORT, makeViewport, type Viewport } from '../../engine/viewport';
import { decodePalette, paletteToRgba } from '../../data/palette';
import { unpackPklite } from '../../data/pklite';
import { setupRace, raceFileNames, applySettings, DS_IMAGE_OFFSET, type RaceFiles } from '../../engine/setup';
import { DataSegment } from '../../engine/memory';
import { Keyboard } from '../../engine/keyboard';
import { FrontEnd, newArena, loadFrontEndBanks } from '../../engine/frontend';
import { SoundOutput } from '../../hal/audio/SoundOutput';
import { frontEnd, chooseOpponents, championshipBoard, verdict, elimination, champion, preRaceCard,
  timerTick, pollInput, applyOptionsInputs, type Request, type Task } from '../../engine/menus';
import { Championship } from '../../engine/sequence';
import { Intro } from '../../engine/intro';
import { Race } from '../../engine/race';
import { RaceRenderer } from '../../engine/render';

const status = document.querySelector('#status') as HTMLElement;
const canvas = document.querySelector('#screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
/**
 * How much of the track to draw. The original's 256x200 is the default and is what the captures check; a
 * wider view is opt-in with ?width= and ?height=, and is remembered. Menus and the intro are fixed-size
 * artwork that cannot widen, so they stay centred in the larger canvas.
 */
/**
 * The sizes F8 steps through, and the ones the picker above the canvas offers. Each one shows strictly
 * more of the track than the one before it, so the names read as a scale the way SMOOTHNESS does. They
 * are capitals only and at most seven characters because that is what the value column of GAME OPTIONS
 * holds: the longest the game itself puts there is BLASTER.
 */
const SIZES: readonly (readonly [number, number, string])[] =
  [[256, 200, 'DOS'], [320, 200, 'VGA'], [320, 224, 'TALL'], [384, 224, 'WIDE'], [448, 240, 'WIDEST']];

let VIEWPORT = ((): Viewport => {
  const q = new URLSearchParams(location.search);
  const stored = ((): [number, number] | undefined => {
    try { const v = localStorage.getItem('micromachines/viewport'); return v ? JSON.parse(v) as [number, number] : undefined; }
    catch { return undefined; }
  })();
  const w = Number(q.get('width') ?? stored?.[0] ?? DOS_VIEWPORT.width);
  const h = Number(q.get('height') ?? stored?.[1] ?? DOS_VIEWPORT.height);
  try {
    const vp = makeViewport(w, h);
    if (q.has('width') || q.has('height')) {
      try { localStorage.setItem('micromachines/viewport', JSON.stringify([vp.width, vp.height])); } catch { /* private window */ }
    }
    return vp;
  } catch { return DOS_VIEWPORT; }
})();
// the picker above the canvas: choosing a size reloads, because the geometry is fixed when the race starts
const chooser = document.querySelector('#viewport') as HTMLSelectElement | null;
if (chooser) {
  chooser.value = `${VIEWPORT.width}x${VIEWPORT.height}`;
  chooser.addEventListener('change', () => {
    const [w, h] = chooser.value.split('x');
    const q = new URLSearchParams(location.search);
    q.set('width', w!); q.set('height', h!);
    location.search = q.toString();
  });
}

let OUT_W = Math.max(320, VIEWPORT.outWidth), OUT_H = Math.max(200, VIEWPORT.height);
canvas.width = OUT_W; canvas.height = OUT_H;

/**
 * How big to draw the canvas. Windowed it is a fixed 3x, capped by the page width. Fullscreen it is the
 * largest **whole** multiple that fits, so every game pixel stays the same size as its neighbours; a
 * fractional scale would leave some pixels a row wider than others, which on 320x200 art is very visible.
 * Whatever is left over stays black around it.
 */
function fitCanvas(): void {
  if (document.fullscreenElement === stage) {
    const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / OUT_W, window.innerHeight / OUT_H)));
    canvas.style.width = `${OUT_W * scale}px`;
    canvas.style.height = `${OUT_H * scale}px`;
  } else {
    canvas.style.width = `${OUT_W * 3}px`;
    canvas.style.height = 'auto';     // with max-width: 100% this keeps the aspect on a narrow window
  }
}

const stage = document.querySelector('#stage') as HTMLElement | null;
const fullscreenButton = document.querySelector('#fullscreen') as HTMLButtonElement | null;
/**
 * Not every browser has the unprefixed call (older Safari), none of them allow it outside a user gesture,
 * and any of them may simply refuse. A refusal is not worth an error in the console: the button just does
 * nothing and the game carries on windowed.
 */
const toggleFullscreen = (): void => {
  const el = stage as (HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }) | null;
  const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> };
  if (!el) return;
  const call = document.fullscreenElement
    ? (document.exitFullscreen?.bind(document) ?? doc.webkitExitFullscreen?.bind(document))
    : (el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el));
  void Promise.resolve(call?.()).catch(() => { /* refused, or no fullscreen at all */ });
};
fullscreenButton?.addEventListener('click', toggleFullscreen);
canvas.addEventListener('dblclick', toggleFullscreen);
/** Some browsers leave fullscreen before delivering the Escape, others after; this covers both. */
let leftFullscreenAt = -1e9;
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) leftFullscreenAt = performance.now();
  fitCanvas();
});
const escapeLeftFullscreen = (): boolean =>
  document.fullscreenElement !== null || performance.now() - leftFullscreenAt < 500;
window.addEventListener('resize', fitCanvas);
fitCanvas();
const off = document.createElement('canvas'); off.width = OUT_W; off.height = OUT_H;
const octx = off.getContext('2d')!;
let img = octx.createImageData(OUT_W, OUT_H);

/**
 * Change the size the race draws at, which F8 on GAME OPTIONS does. Everything but the race is fixed-size
 * artwork presented centred, so the whole canvas can be resized here and now; the race itself picks the
 * new geometry up when the next one starts, which is the only moment that screen can be reached from.
 */
function setViewport(vp: Viewport): void {
  VIEWPORT = vp;
  OUT_W = Math.max(320, vp.outWidth); OUT_H = Math.max(200, vp.height);
  canvas.width = OUT_W; canvas.height = OUT_H;
  off.width = OUT_W; off.height = OUT_H;
  img = octx.createImageData(OUT_W, OUT_H);
  if (chooser) chooser.value = `${vp.width}x${vp.height}`;
  try { localStorage.setItem('micromachines/viewport', JSON.stringify([vp.width, vp.height])); } catch { /* private window */ }
  const q = new URLSearchParams(location.search);        // ?width= wins over the stored value, so move it too
  if (q.has('width') || q.has('height')) {
    q.set('width', String(vp.width)); q.set('height', String(vp.height));
    history.replaceState(null, '', `${location.pathname}?${q.toString()}`);
  }
  fitCanvas();
}

const TICK = 1 / 70.086;

/**
 * The game's own files. A server that keeps a copy beside the page hands them over and nothing is asked of
 * anybody; otherwise the visitor points at their own installed folder, which is the only way a static host
 * can work without redistributing somebody else's game.
 */
async function openFiles(): Promise<GameFiles> {
  const served = await fromServerIfServed();
  if (served) return served;
  const box = document.querySelector('#needfiles') as HTMLElement | null;
  const input = document.querySelector('#folder') as HTMLInputElement | null;
  if (!box || !input) throw new Error('this page does not serve the game files and has no folder picker');
  const why = document.querySelector('#why');
  document.querySelector('#pickfolder')?.addEventListener('click', () => input.click());
  status.textContent = '';
  box.hidden = false;
  const files = await fromFolderInput(input, msg => { if (why) why.textContent = msg; });
  box.hidden = true;
  return files;
}

async function main(): Promise<void> {
  status.textContent = 'loading…';
  const files = await openFiles();
  const exe = unpackPklite(await files.read('MICRO.EXE')).image;

  // one data segment for the whole session, as the game has
  const ds = new DataSegment(exe.subarray(DS_IMAGE_OFFSET));   // to the end: the strings run past 0x8000
  // SETTINGS.DAT, as last written by GAME OPTIONS (fn 2a13) or, failing that, as it came with the game
  const SETTINGS = 'micromachines/SETTINGS.DAT';
  const stored = ((): Uint8Array | undefined => {
    try { const b = localStorage.getItem(SETTINGS); return b ? Uint8Array.from(atob(b), c => c.charCodeAt(0)) : undefined; }
    catch { return undefined; }
  })();
  if (stored) applySettings(ds, stored);
  else if (files.has('SETTINGS.DAT')) applySettings(ds, await files.read('SETTINGS.DAT'));
  applyOptionsInputs(ds);                              // fn 2770 tail: the two configured devices
  const mem = newArena();
  const parts: Uint8Array[] = [];
  for (let i = 0; i < 7; i++) if (files.has(`COMPRESS.PI${i}`)) parts.push(await files.read(`COMPRESS.PI${i}`));
  loadFrontEndBanks(mem, parts, ds);
  const fe = new FrontEnd(ds, mem);
  fe.bindAllRecords();

  // The game reads the keys configured in SETTINGS.DAT; on a browser keyboard the arrows and Return are
  // worth having as well, so they are delivered as player 1's own scancodes ([106c] left, right, up, down,
  // fire).
  // fn 321c: the driver file the settings ask for carries the songs and the effects. Only DRIVER1, the AdLib
  // one, is ported, so SETTINGS.DAT asking for the PC speaker is taken as asking for it too.
  let sound: SoundOutput | undefined;
  if (ds.r16(0x0F64) === 2) ds.w16(0x0F64, 1);
  if (files.has('DRIVER1.BIN')) {
    sound = new SoundOutput(await files.read('DRIVER1.BIN'));
    if (ds.r16(0x0F64) === 1) fe.sound = sound;
  }

  // fn 321c: F3 on GAME OPTIONS cycles [0f64]. DRIVER2, the PC speaker one, is not ported, so it is left out
  // of the cycle rather than offered as silence; the original always shows all three.
  fe.soundDevices = sound ? [0, 1] : [0];
  fe.soundDevice = (device: number): void => {
    if (device === 1 && sound) fe.sound = sound; else { sound?.stopAll(); delete fe.sound; }
  };

  // F8 on GAME OPTIONS: the one line on that screen the original has not got. It steps through the same
  // sizes the picker above the canvas offers and is remembered the same way; SETTINGS.DAT knows nothing
  // about it, so it is deliberately not part of what fn 2a13 writes back.
  const sizeAt = (): number => SIZES.findIndex(([w, h]) => w === VIEWPORT.width && h === VIEWPORT.height);
  fe.viewSize = {
    get label(): string { return SIZES[sizeAt()]?.[2] ?? `${VIEWPORT.width}X${VIEWPORT.height}`; },
    next(): void {
      const [w, h] = SIZES[(sizeAt() + 1) % SIZES.length]!;
      setViewport(makeViewport(w, h));
    },
  };

  // fn 2a13: the options screen writes SETTINGS.DAT back whenever anything on it changed.
  fe.saveSettings = (bytes: Uint8Array): void => {
    try { localStorage.setItem(SETTINGS, btoa(String.fromCharCode(...bytes))); } catch { /* private window */ }
  };

  // fn 3ad0: AUTO counts how many bursts of a thousand word writes fit in one visible field of the 70 Hz
  // mode. A browser clears the top class every time, which is the honest answer.
  fe.speed = (): number => {
    const scratch = new Uint16Array(1000);
    const end = performance.now() + (1000 * 400 / 449) / 70.086;
    let bursts = 0;
    while (performance.now() < end) { for (let i = 0; i < 1000; i++) scratch[i] = bursts; bursts++; }
    return bursts;
  };

  // fn 2d5b reads the game port and the mouse driver itself; the browser's stand-ins are the Gamepad API
  // and a locked pointer. fn 3a12/3a44 probe once at startup, but a gamepad only becomes visible to the
  // page once it is used, so the count is refreshed every frame instead.
  const devices = new BrowserDevices(ds);
  fe.devices = devices;
  ds.w16(0x2627, 1);

  const kb = new Keyboard(ds);
  const alias: Record<string, number> = {
    ArrowLeft: ds.r8(0x106C), ArrowRight: ds.r8(0x106D), ArrowUp: ds.r8(0x106E), ArrowDown: ds.r8(0x106F),
    Enter: ds.r8(0x1070), NumpadEnter: ds.r8(0x1070),
  };
  // ...except in a two-player game ([03f3], set for the whole of fn 1e20), where the arrows and Insert are
  // player 2's own keys and player 1 drives on the set SETTINGS.DAT gave them, and on GAME OPTIONS, which
  // reads raw scancodes (its Return, and the cheat code's digits).
  const scancode = (code: string): number | undefined =>
    (ds.r8(0x03F3) === 1 || fe.rawKeys ? undefined : alias[code]) ?? SCANCODE[code];
  // The Escape that leaves fullscreen would otherwise also back the game out of whatever screen it is on.
  // Chrome swallows that keydown itself but still delivers the keyup, and the menus read the last key
  // *released*, so the keyup is the one that has to be ignored. The next press does the game's Esc.
  let swallowEscapeUp = false;
  window.addEventListener('keydown', e => {
    sound?.start();
    if (e.code === 'Escape' && escapeLeftFullscreen()) { swallowEscapeUp = true; return; }
    const s = scancode(e.code);
    if (s === undefined) return;
    if (!e.repeat) { kb.make(s); intro?.key(s); }
    e.preventDefault();
  });
  window.addEventListener('pointerdown', () => {
    sound?.start();
    intro?.click();
    // the mouse only works recentred, which in a browser means the pointer lock
    const wantsMouse = [0x2658, 0x265A, 0x265C, 0x265E].some(o => ds.r16(o) === 3);
    if (wantsMouse && document.pointerLockElement === null) void canvas.requestPointerLock();
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Escape' && (swallowEscapeUp || escapeLeftFullscreen())) { swallowEscapeUp = false; return; }
    const s = scancode(e.code);
    if (s === undefined) return;
    kb.release(s); intro?.key(s | 0x80);
    e.preventDefault();
  });
  window.addEventListener('blur', () => kb.clear());

  const frontPalette = paletteToRgba(decodePalette(await files.read('INTRO.PAL')));
  let palette = frontPalette;

  // MICRO.COM runs SM.EXE before the game: the Codemasters intro. It is silent and a click ends it early,
  // which is what int 33 does in the original.
  let intro: Intro | undefined;
  if (['SM.EXE', 'GFX1.GFX', 'ANTIFONT.BIN'].every(n => files.has(n)) && !location.search.includes('nointro')) {
    // the port credit under Codemasters' own line; theirs is left exactly as it was
    intro = new Intro(await files.read('SM.EXE'), await files.read('GFX1.GFX'), await files.read('ANTIFONT.BIN'),
      'Scale Miniatures 2026');
    palette = paletteToRgba(decodePalette(intro.palette));
  }

  status.textContent = 'arrows choose, Enter confirms';
  const task = frontEnd(fe);
  let champ: Championship | undefined;
  let menuRace: { round: number; track: number } | undefined;
  let race: Race | undefined;
  let renderer: RaceRenderer | undefined;
  let frame: Uint8Array | undefined;
  let ticks = 0, steps = 0, acc = 0, last = performance.now();
  let stepsPerFrame = 1, ticksPerFrame = 3;

  /** `fb` may be narrower than the canvas (the menus and the intro always are): centre it. */
  const present = (fb: Uint8Array, fbW = 320, fbH = 200): void => {
    const out = new Uint32Array(img.data.buffer);
    if (fbW === OUT_W && fbH === OUT_H) {
      for (let i = 0; i < OUT_W * OUT_H; i++) out[i] = palette[fb[i]!]!;
    } else {
      const x0 = (OUT_W - fbW) >> 1, y0 = (OUT_H - fbH) >> 1;
      out.fill(palette[0]!);
      for (let y = 0; y < fbH; y++) {
        const src = y * fbW, dst = (y + y0) * OUT_W + x0;
        for (let x = 0; x < fbW; x++) out[dst + x] = palette[fb[src + x]!]!;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  };

  async function startRace(round: number, track: number): Promise<void> {
    status.textContent = `loading round ${round} track ${track}…`;
    const names = raceFileNames(round, track);
    const opt = async (n: string): Promise<Uint8Array | undefined> => (files.has(n) ? files.read(n) : undefined);
    const pr: Uint8Array[] = [];
    for (const k of ['pr0', 'pr1', 'pr2']) { const b = await opt(names[k]!); if (b) pr.push(b); }
    const raceFiles: RaceFiles = {
      exe, brk: await opt(names['brk']!), lev: await opt(names['lev']!), strtPos: await files.read(names['strtPos']!),
      cheats: await files.read(names['cheats']!), map: await files.read(names['map']!), ct: await files.read(names['ct']!),
      col: await files.read(names['col']!), dir: await files.read(names['dir']!), pal: await files.read(names['pal']!),
      ph0: await files.read(names['ph0']!), vh0: await files.read(names['vh0']!), pr,
    };
    const assets = setupRace(raceFiles, {
      round, track, challengeIndex: ds.r8(0x28C1), mode: ds.r16(0x2656),
      inputs: [ds.r16(0x2658), ds.r16(0x265A), ds.r16(0x265C), ds.r16(0x265E)],
      characters: [ds.r16(0x2668), ds.r16(0x266A), ds.r16(0x266C), ds.r16(0x266E)], viewport: VIEWPORT,
    }, ds);
    sound?.stopVoices();                               // fn 11aa: the song stops for the race
    palette = paletteToRgba(decodePalette(assets.palette));
    race = new Race(ds, VIEWPORT);
    race.devices = devices;
    if (sound) race.sound = sound;
    renderer = new RaceRenderer({ ds, mapWords: assets.mapWords, banks: assets.banks, vehicle: assets.vehicle,
      extra: assets.extra, viewport: VIEWPORT });
    renderer.race = race;
    stepsPerFrame = ds.r16(0x263A);
    ticksPerFrame = [0, 1, 3, 5, 7, 32][stepsPerFrame] ?? 3;
    ticks = 0; steps = 0; acc = 0; last = performance.now();
    status.textContent = `round ${round} track ${track}`;
  }

  /** One game tick of the menus: the int 8 counters, the input poll, then on to the next wait. */
  function stepFrontEnd(): void {
    timerTick(ds);
    pollInput(ds, undefined, devices);
    for (;;) {
      const r: IteratorResult<Request, void> = task.next();
      if (r.done) { status.textContent = 'the game left for DOS'; return; }
      if (r.value === 'tick') return;
      if (r.value === 'race') {                        // fn 216c: a two-player menu runs one race itself
        menuRace = { round: ds.r8(0x28BF), track: ds.r8(0x28C0) };
        ds.w8(0x107E, 0);
        return;
      }
      champ = new Championship(ds, fe);                // fn 102b reaching fn 10a0
      ds.w8(0x107E, 0);                                // the key that started the game is spent
      champ.begin();
      palette = frontPalette;
      return;
    }
  }

  /** A key that has been pressed and let go, or the fire button: what the sequence screens wait for. */
  function anyKey(): boolean {
    if (ds.r8(0x107E) !== 0) { ds.w8(0x107E, 0); return true; }
    return (ds.r8(0x108B) & 8) !== 0;
  }

  let picking: Task<void> | undefined;
  let busy = false;
  let stopped = false;

  /** fn 35f0 from 3789: the Paused! banner, the two waits and the debug keys, one game tick at a time. */
  function pausedFrame(): void {
    if (race!.pauseFlash) {                              // 3734: a CHEATS.BIN spot was applied
      race!.pauseFlash = false;
      if (frame) for (let y = 0; y < VIEWPORT.height; y++) {
        frame.fill(0xFF, y * VIEWPORT.outWidth + VIEWPORT.outX, y * VIEWPORT.outWidth + VIEWPORT.outX + VIEWPORT.width);
      }
      if (frame) present(frame, VIEWPORT.outWidth, VIEWPORT.height);
      return;
    }
    if (race!.pauseRender) {                             // 37a4: put the race back on screen
      race!.pauseRender = false;
      frame = renderer!.render(() => race!.renderSideEffects());
      present(frame, VIEWPORT.outWidth, VIEWPORT.height);
      return;
    }
    if (race!.screenDump) {                             // fn 35bf: SCRE0.RAW, SCRE1.RAW, ...
      race!.screenDump = false;
      ds.w8(0x292D, ds.r8(0x292D) + 1);
      let name = '';
      for (let p = 0x2929; ds.r8(p) !== 0; p++) name += String.fromCharCode(ds.r8(p));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([renderer!.back.slice(0, Math.min(0xFFFA, VIEWPORT.bufSize))]));
      a.download = name;
      a.click();
      const url = a.href;
      setTimeout(() => { URL.revokeObjectURL(url); }, 0);   // Firefox has raced a same-tick revoke
      status.textContent = `wrote ${name}`;
    }
    if (race!.pauseStage === 1) { frame = renderer!.pauseFrame(); present(frame, VIEWPORT.outWidth, VIEWPORT.height); }
  }

  /** One animation frame of the race loop. 'over' when fn 3039 has left. */
  function stepRaceFrame(now: number): 'running' | 'over' | 'error' {
    acc += Math.min(0.1, (now - last) / 1000); last = now;
    if (race!.paused) {                                  // the tick counters keep running while paused
      while (acc >= TICK) {
        acc -= TICK;
        ticks++;
        const blink = Math.floor(ticks);
        ds.w8(0x26D0, blink & 0x1F); ds.w8(0x26CF, (blink >> 5) & 1);
        ds.add16(0x261F, 1);
        if (!race!.pauseStep()) { ds.w8(0x107E, 0); break; }
        pausedFrame();
      }
      return 'running';
    }
    try {
      while (acc >= TICK * ticksPerFrame) {
        acc -= TICK * ticksPerFrame;
        for (let s = 0; s < stepsPerFrame; s++) {
          ticks += ticksPerFrame / stepsPerFrame;
          const blink = Math.floor(ticks);
          ds.w8(0x26D0, blink & 0x1F); ds.w8(0x26CF, (blink >> 5) & 1);
          race!.stepPhysics(ds.r8(0x107D), ds.r8(0x107C));
          if (race!.paused) { pausedFrame(); return 'running'; }   // fn 35f0: the page drives the pause
          if (race!.over) {
            race = undefined; renderer = undefined;
            sound?.stopAll();                          // fn 3104: silence at the end of a race
            ds.w8(0x107E, 0);
            palette = frontPalette;
            present(fe.vram);
            return 'over';
          }
          if (race!.rendersThisStep) frame = renderer!.render(() => race!.renderSideEffects());
          race!.stepPost(); steps++;
          if (sound) {                                 // the ah=5, ah=8 and ah=0a calls the race made
            for (const { fn, arg } of race!.sounds) {
              if (fn === 8) { sound.play(arg, true); continue; }
              if (fn === 0x0A && sound.isPlaying(arg)) continue;
              sound.play(arg);
            }
          }
          race!.sounds.length = 0;
        }
      }
    } catch (e) {
      status.textContent = `stopped at step ${steps}: ${String(e)}`;
      if (frame) present(frame, VIEWPORT.outWidth, VIEWPORT.height);
      return 'error';
    }
    if (frame) present(frame, VIEWPORT.outWidth, VIEWPORT.height);
    return 'running';
  }

  /** A load or a step that throws: say what happened rather than freezing on the last frame. */
  const fail = (e: unknown): void => {
    status.textContent = `stopped: ${e instanceof Error ? e.message : String(e)}`;
    stopped = true;
  };

  const beginRace = (round: number, track: number): void => {
    busy = true;
    void startRace(round, track).then(() => { busy = false; }, fail);
  };

  const tick = (now: number): void => {
    if (stopped) return;
    ds.w16(0x2625, BrowserDevices.joystickCount());    // fn 3a12, kept up to date as pads come and go
    sound?.pump();
    if (intro) {                                       // SM.EXE, one frame per vertical retrace
      acc += Math.min(0.1, (now - last) / 1000); last = now;
      while (acc >= TICK) { acc -= TICK; if (!intro.step()) { intro = undefined; break; } }
      if (intro) { present(intro.vram); requestAnimationFrame(loop); return; }
      palette = frontPalette;
      acc = 0;
    }
    if (menuRace) {                                    // fn 216c: the race a two-player menu asked for
      if (!race && !busy) beginRace(menuRace.round, menuRace.track);
      if (race && renderer) {
        const r = stepRaceFrame(now);
        if (r === 'error') { stopped = true; return; }
        if (r === 'over') { menuRace = undefined; status.textContent = ''; }
      }
      requestAnimationFrame(loop);
      return;
    }
    if (!champ) {                                      // the menus
      acc += Math.min(0.1, (now - last) / 1000); last = now;
      while (acc >= TICK) { acc -= TICK; stepFrontEnd(); if (champ || menuRace) break; }
      if (!champ && !menuRace) present(fe.vram);
      requestAnimationFrame(loop);
      return;
    }
    const screen = champ.screen;
    if (screen.kind === 'race') {
      if (!race && !busy) beginRace(screen.round, screen.track);
      if (race && renderer) {
        const r = stepRaceFrame(now);
        if (r === 'error') { stopped = true; return; }
        if (r === 'over') champ.raceFinished();
      }
      requestAnimationFrame(loop);
      return;
    }
    // a front-end screen owned by the sequence
    acc += Math.min(0.1, (now - last) / 1000); last = now;
    if (screen.kind !== 'results' && screen.kind !== 'end') {
      // the screens that run their own wait loops (fn 11f8, 18d8, 1c1b, 16de, 1a4a, 1aad), driven a tick at
      // a time like the menus
      picking ??= screen.kind === 'board' ? championshipBoard(fe)
        : screen.kind === 'preRace' ? preRaceCard(fe)
        : screen.kind === 'verdict' ? verdict(fe, screen.message)
        : screen.kind === 'elimination' ? elimination(fe, screen.car)
        : screen.kind === 'champion' ? champion(fe, screen.car)
        : chooseOpponents(fe);
      status.textContent = { board: 'the championship so far', preRace: 'press fire to race', verdict: '',
        elimination: 'out of the championship', champion: 'champion!',
        chooseOpponents: 'pick the drivers you race against' }[screen.kind] ?? '';
      let done = false;
      while (acc >= TICK && !done) {
        acc -= TICK;
        timerTick(ds); pollInput(ds, undefined, devices);
        for (;;) { const r = picking.next(); if (r.done) { done = true; break; } if (r.value === 'tick') break; }
      }
      if (done) {
        picking = undefined;
        if (screen.kind === 'preRace') {                // fn 1398: the cheat lets + and - pick the race
          const key = ds.r8(0x107E);
          ds.w8(0x107E, 0);
          if (!champ.cardSkip(key)) champ.screenDone();
        } else champ.screenDone();
      }
      present(fe.vram);
      requestAnimationFrame(loop);
      return;
    }
    while (acc >= TICK) { acc -= TICK; timerTick(ds); pollInput(ds, undefined, devices); }
    if (screen.kind === 'end') {
      status.textContent = 'game over';
      present(fe.vram);
      if (anyKey()) { champ = undefined; acc = 0; status.textContent = 'arrows choose, Enter confirms'; stepFrontEnd(); }
      requestAnimationFrame(loop);
      return;
    }
    present(fe.vram);
    status.textContent = 'press any key';
    if (anyKey()) champ.screenDone();
    requestAnimationFrame(loop);
  };
  /** The race loop reports its own errors (it can say which step failed); everything else lands here. */
  const loop = (now: number): void => {
    try { tick(now); } catch (e) { fail(e); }
  };

  present(fe.vram);
  requestAnimationFrame(loop);
}

void main().catch((e: unknown) => { status.textContent = String(e); });

import { GameFiles } from '../../hal/fs/GameFiles';
import { lzDecode } from '../../data/lzcodec';
import { decodePalette } from '../../data/palette';
import { decodeTileMap } from '../../data/tilemap';
import { decodeBlocks, expandMap } from '../../data/blocks';
import { decodeVehicle } from '../../data/sprites';
import { indexedToCanvas, sheet, renderTrack } from './render';

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const out = $('#out');
let files: GameFiles | undefined;

function section(title: string): HTMLElement {
  const s = document.createElement('section');
  const h = document.createElement('h2'); h.textContent = title; s.appendChild(h);
  out.appendChild(s); return s;
}

async function showRound(round: number): Promise<void> {
  if (!files) return;
  out.textContent = '';
  const pal = decodePalette(await files.read(`GAME1/ROUND${round}.PAL`));
  const palSec = section(`Round ${round} palette`);
  const palPx = new Uint8Array(256 * 4 * 16);
  for (let i = 0; i < 256; i++) for (let y = 0; y < 16; y++) for (let x = 0; x < 4; x++) palPx[y * 1024 + i * 4 + x] = i;
  palSec.appendChild(indexedToCanvas(palPx, 1024, 16, pal));

  const banks: Uint8Array[] = [];
  for (let k = 0; k < 3; k++) {
    const name = `GAME1/ROUND${round}BR.PR${k}`;
    if (!files.has(name)) break;
    const d = lzDecode(await files.read(name)).data;
    banks.push(d);
    const sh = sheet(d, 16, 16, 32);
    section(`${name} (${d.length / 256} tiles)`).appendChild(indexedToCanvas(sh.px, sh.width, sh.height, pal, 2));
  }
  const all = new Uint8Array(banks.reduce((n, b) => n + b.length, 0));
  banks.reduce((o, b) => { all.set(b, o); return o + b.length; }, 0);

  const vh = decodeVehicle(lzDecode(await files.read(`GAME1/ROUND${round}BR.VH0`)).data, round);
  const strip = new Uint8Array(32 * vh.size * vh.size);
  vh.frames.forEach((f, i) => { for (let y = 0; y < vh.size; y++) strip.set(f.subarray(y * vh.size, (y + 1) * vh.size), y * 32 * vh.size + i * vh.size); });
  section(`Vehicle: 32 directions (${vh.size}x${vh.size}), ${vh.rawFrames} frames in file`).appendChild(indexedToCanvas(strip, 32 * vh.size, vh.size, pal, 3));
  const ex = sheet(new Uint8Array(vh.extra.flatMap(e => [...e])), vh.size, vh.size, vh.extra.length);
  section('Extra sprites (segment 5D78)').appendChild(indexedToCanvas(ex.px, ex.width, ex.height, pal, 3));

  const blk = decodeBlocks(await files.read(`GAME1/ROUND${round}BR.CT`), await files.read(`GAME1/ROUND${round}.COL`),
    await files.read(`GAME1/ROUND${round}.DIR`), await files.read(`GAME1/ROUND${round}BR.LEV`));
  for (let trk = 1; trk <= 4; trk++) {
    const name = `GAME1/ROUND${round}${trk}.MAP`;
    if (!files.has(name)) break;
    const map = decodeTileMap(await files.read(name));
    const world = expandMap(blk, map.blocks);
    const px = renderTrack(world, all);
    const sec = section(`${name}: 3072x3072 world (shown at 1/4)`);
    const c = indexedToCanvas(px, 3072, 3072, pal);
    c.style.width = '768px'; c.style.height = '768px'; c.style.imageRendering = 'pixelated';
    c.title = 'click to toggle full size';
    c.addEventListener('click', () => { const full = c.style.width === '3072px'; c.style.width = c.style.height = full ? '768px' : '3072px'; });
    sec.appendChild(c);
  }
}

async function loaded(g: GameFiles): Promise<void> {
  files = g;
  $('#status').textContent = `${g.list().length} files loaded${g.has('GAME1/ROUND1.PAL') ? '' : ' (GAME1 folder not found!)'}`;
  $('#rounds').hidden = false;
  await showRound(1);
}

// The button is only a fallback: on start we try the dev server's /MicroMac/ mirror first (see vite.config.ts).
$('#pick').addEventListener('click', () => $('#fallback').click());
$('#fallback').addEventListener('change', async (ev) => {
  const input = ev.target as HTMLInputElement;
  if (input.files?.length) await loaded(GameFiles.fromFileList(input.files));
});
for (let r = 1; r <= 9; r++) {
  const b = document.createElement('button'); b.textContent = `Round ${r}`;
  b.addEventListener('click', () => void showRound(r));
  $('#rounds').appendChild(b);
}

async function autoload(): Promise<void> {
  $('#status').textContent = 'loading ./MicroMac from the dev server…';
  try {
    const g = await GameFiles.fromServer();
    if (!g.has('GAME1/ROUND1.PAL')) throw new Error('GAME1/ROUND1.PAL not served');
    await loaded(g);
  } catch (e) {
    $('#status').textContent = `automatic load failed (${String(e)}). Use the button to pick the MicroMac folder.`;
  }
}
void autoload();

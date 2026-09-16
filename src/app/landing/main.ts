/**
 * The front page: it loads the game by itself, and runs the poll.
 *
 * The game still comes in through a dynamic import, so the engine is a second request rather than part of
 * the page, but nobody has to ask for it. Everything it needs is already in the markup, because
 * `src/app/game/main.ts` looks its elements up as soon as it is evaluated: the canvas, the stage, the view
 * picker, the status line and the folder picker.
 */
import { startHero } from './hero';

/** Vite's deployment base, read defensively: this file is also compiled without Vite's types. */
const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
const API = `${BASE}api/poll`;
const VOTED = 'micromachines/voted';
const VOTER = 'micromachines/voter';
const PICKED = 'micromachines/picked';

const $ = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

// ---------------------------------------------------------------- the hero
const hero = $('#hero'), heroCanvas = $<HTMLCanvasElement>('#hero-canvas');
if (hero && heroCanvas) startHero(hero, heroCanvas, `${BASE}mm-boat.png`, `${BASE}mm-duck.png`);

// ---------------------------------------------------------------- the game
const startButton = $<HTMLButtonElement>('#start');
const loadMessage = $('#loadmsg');
const placeholder = $('#placeholder');
const needFiles = $('#needfiles');
const canvas = $<HTMLCanvasElement>('#screen');
let loading = false;

/**
 * Take the cover off once there is something under it. Evaluating the module is not the same as the game
 * being on screen: it starts its own loading and draws its first frame a moment later, and uncovering a
 * black canvas in between looks like a failure. So wait for a pixel, and give up waiting after fifteen
 * seconds so a canvas that genuinely never paints does not hide behind the cover for ever.
 */
function uncoverWhenDrawn(): void {
  if (!placeholder) return;
  const ctx = canvas?.getContext('2d', { willReadFrequently: true });
  const until = Date.now() + 15_000;
  const look = (): void => {
    let drawn = false;
    if (ctx && canvas && canvas.width > 0) {
      const d = ctx.getImageData(0, 0, canvas.width, Math.min(canvas.height, 40)).data;
      for (let i = 0; i < d.length && !drawn; i += 4) drawn = (d[i]! | d[i + 1]! | d[i + 2]!) !== 0;
    }
    if (drawn || Date.now() > until) placeholder.remove();
    else setTimeout(look, 100);
  };
  look();
}

/** The page loads the game by itself; the button only appears if that goes wrong. */
function startGame(): void {
  if (loading) return;
  loading = true;
  if (startButton) startButton.hidden = true;
  if (loadMessage) loadMessage.textContent = 'Loading the game';
  void import('../game/main')
    .then(uncoverWhenDrawn)
    .catch((e: unknown) => {
      loading = false;
      if (loadMessage) loadMessage.textContent = `could not load the game: ${String(e)}`;
      if (startButton) startButton.hidden = false;
    });
}

startButton?.addEventListener('click', startGame);
startGame();

// The game asks for a folder when the server has no copy, and that prompt sits below the stage: get the
// placeholder out of the way as soon as it appears, or the visitor is looking at a Loading button forever.
if (needFiles && placeholder) {
  new MutationObserver(() => { if (!needFiles.hidden) placeholder.remove(); })
    .observe(needFiles, { attributes: true, attributeFilter: ['hidden'] });
}

// ---------------------------------------------------------------- the poll
interface Poll { options: { id: string; label: string }[]; counts: Record<string, number>; votes: number }

/** One colour per option, out of the page's own palette, so a filled bar reads as itself. */
const ACCENTS = ['#29ABE2', '#EC008C', '#FFE800', '#8BD450', '#F58220', '#B07CD8'];

const form = $<HTMLFormElement>('#poll');
const choices = $('#choices');
const message = $('#pollmsg');
const comment = $<HTMLTextAreaElement>('#comment');
const submit = form?.querySelector<HTMLButtonElement>('button[type=submit]') ?? null;
const picked = new Set<string>();
let changeButton: HTMLButtonElement | undefined;
let lastPoll: Poll | undefined;

/** Anything kept here is a convenience for this browser alone, and a private window simply goes without. */
function remember(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private window */ }
}
function recall(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/**
 * A random id for this browser, made once and kept. It lets a second answer replace the first instead of
 * adding another to the count. It is not an identity: nothing is derived from it, nobody else ever sees it,
 * and in a private window there is none, so that vote just cannot be changed later.
 */
function voterId(): string | undefined {
  const kept = recall(VOTER);
  if (kept !== null) return kept;
  const made = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)
    .replace(/[^A-Za-z0-9_-]/g, '');
  remember(VOTER, made);
  return recall(VOTER) ?? undefined;
}

function optionButton(o: { id: string; label: string }, i: number): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'opt';
  const fill = document.createElement('span');
  fill.className = 'fill';
  fill.style.background = ACCENTS[i % ACCENTS.length]!;
  const row = document.createElement('span');
  row.className = 'row';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = o.label;
  const pct = document.createElement('span');
  pct.className = 'pct';
  row.append(label, pct);
  b.append(fill, row);
  return b;
}

const fillOf = (b: HTMLElement): HTMLElement => b.querySelector<HTMLElement>('.fill')!;
const pctOf = (b: HTMLElement): HTMLElement => b.querySelector<HTMLElement>('.pct')!;

/** After voting: every option as a proportional bar, and which ones were yours. */
function showResults(poll: Poll): void {
  if (!choices) return;
  const total = Math.max(1, poll.votes);
  choices.textContent = '';
  poll.options.forEach((o, i) => {
    const n = poll.counts[o.id] ?? 0;
    const b = optionButton(o, i);
    b.disabled = true;
    b.style.cursor = 'default';
    if (picked.has(o.id)) b.classList.add('on');
    fillOf(b).style.width = `${(n / total * 100).toFixed(1)}%`;
    pctOf(b).textContent = `${Math.round(n / total * 100)}%${picked.has(o.id) ? ' · yours' : ''}`;
    choices.append(b);
  });
  // Hidden, not removed: the answer can be changed, and then these have to come back.
  if (comment) comment.hidden = true;
  if (submit) submit.hidden = true;
  offerChange();
  if (message) message.textContent = `${poll.votes} ${poll.votes === 1 ? 'answer' : 'answers'} so far, thank you`;
}

/** A way back to the choices for somebody who has already answered, which is also how they meet new ones. */
function offerChange(): void {
  if (!form) return;
  if (!changeButton) {
    changeButton = document.createElement('button');
    changeButton.type = 'button';
    changeButton.className = 'btn small';
    changeButton.textContent = 'Change your answer';
    changeButton.addEventListener('click', () => {
      if (changeButton) changeButton.hidden = true;
      if (comment) comment.hidden = false;
      if (submit) submit.hidden = false;
      if (message) message.textContent = '';
      if (lastPoll) showChoices(lastPoll);
    });
    form.querySelector('#pollfoot')?.prepend(changeButton);
  }
  changeButton.hidden = false;
}

/** Before voting: the counts are deliberately not shown, so nobody is nudged by what is already winning. */
function showChoices(poll: Poll): void {
  if (!choices) return;
  choices.textContent = '';
  poll.options.forEach((o, i) => {
    const b = optionButton(o, i);
    if (picked.has(o.id)) {                    // coming back to change an answer: show what it was
      b.classList.add('on');
      fillOf(b).style.width = '100%';
      pctOf(b).textContent = 'picked';
    }
    b.addEventListener('click', () => {
      const on = !picked.has(o.id);
      if (on) picked.add(o.id); else picked.delete(o.id);
      b.classList.toggle('on', on);
      fillOf(b).style.width = on ? '100%' : '0';
      pctOf(b).textContent = on ? 'picked' : '';
    });
    choices.append(b);
  });
}

async function loadPoll(): Promise<void> {
  if (!form) return;
  let poll: Poll;
  try {
    const r = await fetch(API);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    poll = await r.json() as Poll;
  } catch {
    $('#whats-next')?.remove();                // nothing behind this page to collect answers: no section
    return;
  }
  lastPoll = poll;
  // What was picked last time, so the results can mark them and a change starts from them.
  try { for (const id of JSON.parse(recall(PICKED) ?? '[]') as string[]) picked.add(id); } catch { /* not ours */ }

  // Attached before the view is chosen, and not inside the branch: somebody who has already answered can
  // come back through "Change your answer", and a form with no submit handler reloads the page instead.
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    const text = comment?.value.trim() ?? '';
    if (picked.size === 0 && text === '') {
      if (message) message.textContent = 'pick something first';
      return;
    }
    if (message) message.textContent = 'sending';
    const choiceList = [...picked];
    const voter = voterId();
    void fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        choices: choiceList,
        ...(text === '' ? {} : { comment: text }),
        ...(voter === undefined ? {} : { voter }),
      }),
    })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        remember(VOTED, new Date().toISOString());
        remember(PICKED, JSON.stringify(choiceList));
        lastPoll = await r.json() as Poll;
        showResults(lastPoll);
      })
      .catch((e: unknown) => { if (message) message.textContent = `could not send that: ${String(e)}`; });
  });

  if (recall(VOTED) !== null) showResults(poll); else showChoices(poll);
}

void loadPoll();

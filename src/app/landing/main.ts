/**
 * The front page: it loads the game by itself, and runs the poll.
 *
 * The game still comes in through a dynamic import, so the engine is a second request rather than part of
 * the page, but nobody has to ask for it. Everything it needs is already in the markup, because
 * `src/app/game/main.ts` looks its elements up as soon as it is evaluated: the canvas, the stage, the view
 * picker, the status line and the folder picker.
 */

/** Vite's deployment base, read defensively: this file is also compiled without Vite's types. */
const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
const API = `${BASE}api/poll`;
const VOTED = 'micromachines/voted';

const $ = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

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
    if (drawn || Date.now() > until) placeholder.hidden = true;
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
  new MutationObserver(() => { if (!needFiles.hidden) placeholder.hidden = true; })
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
const picked = new Set<string>();

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
  comment?.remove();
  form?.querySelector('button[type=submit]')?.remove();
  if (message) message.textContent = `${poll.votes} ${poll.votes === 1 ? 'answer' : 'answers'} so far, thank you`;
}

/** Before voting: the counts are deliberately not shown, so nobody is nudged by what is already winning. */
function showChoices(poll: Poll): void {
  if (!choices) return;
  choices.textContent = '';
  poll.options.forEach((o, i) => {
    const b = optionButton(o, i);
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
  let voted = false;
  try { voted = localStorage.getItem(VOTED) !== null; } catch { /* private window */ }
  if (voted) { showResults(poll); return; }
  showChoices(poll);

  form.addEventListener('submit', ev => {
    ev.preventDefault();
    const text = comment?.value.trim() ?? '';
    if (picked.size === 0 && text === '') {
      if (message) message.textContent = 'pick something first';
      return;
    }
    if (message) message.textContent = 'sending';
    const choiceList = [...picked];
    void fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(text === '' ? { choices: choiceList } : { choices: choiceList, comment: text }),
    })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        try { localStorage.setItem(VOTED, new Date().toISOString()); } catch { /* private window */ }
        showResults(await r.json() as Poll);
      })
      .catch((e: unknown) => { if (message) message.textContent = `could not send that: ${String(e)}`; });
  });
}

void loadPoll();

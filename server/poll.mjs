/**
 * The poll behind the landing page. Node with no dependencies, one file, votes appended to a text file.
 *
 *   GET  /api/poll   -> { options, counts, votes }
 *   POST /api/poll   -> { choices: string[], comment?: string }, answers with the same shape as GET
 *
 * Configuration, all optional:
 *   SM_POLL_PORT    port to listen on                       (default 8787)
 *   SM_POLL_FILE    where the votes go                      (default ./votes.ndjson beside this file)
 *   SM_POLL_ORIGIN  the one browser origin allowed to post  (default: same origin only, no CORS headers)
 *   SM_POLL_PROXY   set to 1 when a reverse proxy is in front, to read X-Forwarded-For
 *
 * One line of JSON per vote, appended and never rewritten, so a truncated write costs one vote and the file
 * can be read with `wc -l` and `grep`. The counts are held in memory and recomputed only at startup.
 */
import { createServer } from 'node:http';
import { appendFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The things people can ask for. Ids are stored, labels are only ever shown. */
export const OPTIONS = [
  { id: 'four-players', label: 'Play with 4 players on one machine' },
  { id: 'online', label: 'Play online' },
  { id: 'any-race', label: 'Pick any race, instead of the championship order' },
  { id: 'mobile-controls', label: 'Mobile controls' },
  { id: 'micro-machines-2', label: 'Do Micro Machines 2!' },
];

const IDS = new Set(OPTIONS.map(o => o.id));
const MAX_COMMENT = 500;
/** A browser's own id, so a second answer replaces its first. Opaque, and never used for anything else. */
const VOTER = /^[A-Za-z0-9_-]{1,64}$/;
/** Free text from the online lobby, which is a longer thing than a poll comment. */
export const MAX_FEEDBACK = 2000;
const ROOM = /^[A-Za-z]{4}$/;
const MAX_BODY = 4096;
const PER_IP = 5;                       // votes allowed from one address per window
const WINDOW_MS = 60 * 60 * 1000;

/**
 * A posted body turned into a vote, or a reason it is not one. Unknown ids are rejected rather than
 * dropped: a vote for something that does not exist means the page and this file disagree, and quietly
 * counting the rest would hide that.
 */
export function parseVote(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { error: 'expected an object' };
  const { choices, comment, voter } = body;
  if (!Array.isArray(choices)) return { error: 'choices must be an array' };
  if (choices.length > OPTIONS.length) return { error: 'too many choices' };
  for (const c of choices) {
    if (typeof c !== 'string' || !IDS.has(c)) return { error: `unknown choice: ${String(c)}` };
  }
  const unique = [...new Set(choices)];
  if (comment !== undefined && typeof comment !== 'string') return { error: 'comment must be a string' };
  if (voter !== undefined && (typeof voter !== 'string' || !VOTER.test(voter))) return { error: 'voter must be a short plain id' };
  const text = (comment ?? '').trim().slice(0, MAX_COMMENT);
  if (unique.length === 0 && text === '') return { error: 'an empty vote' };
  const vote = { choices: unique };
  if (text !== '') vote.comment = text;
  if (voter !== undefined) vote.voter = voter;
  return { vote };
}

/**
 * What somebody wrote after a race online. Kept apart from the poll: the poll is a question with five
 * answers and this is whatever they felt like saying, and mixing the two would make both harder to read.
 *
 * The room code is optional and is only there so a report of something going wrong can be lined up with
 * what the relay saw at the time. Nothing else about who they are is asked for or recorded.
 */
export function parseFeedback(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { error: 'expected an object' };
  const { text, room } = body;
  if (typeof text !== 'string') return { error: 'text must be a string' };
  const said = text.trim().slice(0, MAX_FEEDBACK);
  if (said === '') return { error: 'nothing was written' };
  if (room !== undefined && (typeof room !== 'string' || !ROOM.test(room))) {
    return { error: 'a room code is four letters' };
  }
  const note = { text: said };
  if (room !== undefined) note.room = room.toUpperCase();
  return { note };
}

/**
 * How many votes each option has, counting every option so the page never has to guess a missing key.
 *
 * One answer per browser: a later vote carrying the same `voter` replaces the earlier one, so changing your
 * answer moves it instead of adding another. The file still keeps every line, superseded ones included, so
 * nothing anybody wrote is thrown away. Votes recorded before this existed have no id and each stand alone.
 */
export function tally(votes) {
  const counts = Object.fromEntries(OPTIONS.map(o => [o.id, 0]));
  const latest = new Map();                  // Map.set keeps the first position and takes the last value
  const anonymous = [];
  for (const v of votes) {
    if (typeof v.voter === 'string') latest.set(v.voter, v); else anonymous.push(v);
  }
  const counted = [...anonymous, ...latest.values()];
  for (const v of counted) for (const c of v.choices) if (c in counts) counts[c]++;
  return { options: OPTIONS, counts, votes: counted.length };
}

/** Every vote in the file. A line that will not parse is skipped: one bad line must not lose the rest. */
export async function readVotes(file) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch { return []; }
  const votes = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const v = JSON.parse(line);
      if (Array.isArray(v?.choices)) votes.push(v);
    } catch { /* a half-written line, from a crash mid-append */ }
  }
  return votes;
}

/** Fixed-window count per address. Deliberately crude: this is a poll, not an election. */
export function makeLimiter(perWindow = PER_IP, windowMs = WINDOW_MS) {
  const seen = new Map();
  return (ip, now = Date.now()) => {
    const hit = seen.get(ip);
    if (hit === undefined || now - hit.since > windowMs) { seen.set(ip, { since: now, n: 1 }); return true; }
    if (hit.n >= perWindow) return false;
    hit.n++;
    return true;
  };
}

// ---------------------------------------------------------------- the server

const here = dirname(fileURLToPath(import.meta.url));
const FILE = process.env.SM_POLL_FILE ?? join(here, 'votes.ndjson');
const NOTES = process.env.SM_FEEDBACK_FILE ?? join(here, 'feedback.ndjson');
const PORT = Number(process.env.SM_POLL_PORT ?? 8787);
const ORIGIN = process.env.SM_POLL_ORIGIN;
const TRUST_PROXY = process.env.SM_POLL_PROXY === '1';

function addressOf(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (ORIGIN) { headers['Access-Control-Allow-Origin'] = ORIGIN; headers['Vary'] = 'Origin'; }
  res.writeHead(status, headers);
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function start() {
  const votes = await readVotes(FILE);
  const allow = makeLimiter();
  const allowNote = makeLimiter(5);

  /** POST /api/feedback: whatever somebody wants to say, straight to a file and nothing else. */
  const feedback = async (req, res) => {
    if (req.method === 'OPTIONS' && ORIGIN) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': ORIGIN,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    if (!allowNote(addressOf(req))) return send(res, 429, { error: 'that is enough for now, thank you' });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'that is not JSON' }); }
    const { note, error } = parseFeedback(body);
    if (error) return send(res, 400, { error });
    try {
      await appendFile(NOTES, `${JSON.stringify({ ...note, at: new Date().toISOString() })}\n`);
    } catch (e) {
      console.error('poll: could not write feedback:', e);
      return send(res, 500, { error: 'could not record that' });
    }
    return send(res, 200, { ok: true });
  };
  console.log(`poll: ${votes.length} votes in ${FILE}, listening on ${PORT}`);

  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? '').split('?')[0];
      if (path === '/api/feedback') return feedback(req, res);
      if (path !== '/api/poll') return send(res, 404, { error: 'not found' });

      if (req.method === 'OPTIONS' && ORIGIN) {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': ORIGIN,
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        return res.end();
      }
      if (req.method === 'GET') return send(res, 200, tally(votes));
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

      if (!allow(addressOf(req))) return send(res, 429, { error: 'that is enough for now, thank you' });

      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'that is not JSON' }); }
      const { vote, error } = parseVote(body);
      if (error) return send(res, 400, { error });

      votes.push(vote);
      try {
        await appendFile(FILE, `${JSON.stringify({ ...vote, at: new Date().toISOString() })}\n`);
      } catch (e) {
        votes.pop();                     // it never reached the disk, so it must not be counted either
        console.error('poll: could not write a vote:', e);
        return send(res, 500, { error: 'could not record that' });
      }
      return send(res, 200, tally(votes));
    })();
  });
  server.listen(PORT);
  return server;
}

// Run only when this file is the program, so the tests can import the parts above without a socket.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) void start();

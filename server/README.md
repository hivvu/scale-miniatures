# The poll service

One file, `poll.mjs`, plain Node with no dependencies at all. It answers two requests and appends one line
of JSON per vote to a text file. That is the whole thing.

```
GET  /api/poll   -> { options: [{id, label}], counts: {id: n}, votes: n }
POST /api/poll   <- { choices: [id], comment?: string }   -> the same shape as GET
```

Run it:

```bash
node server/poll.mjs                 # port 8787, votes in server/votes.ndjson
npm run poll                         # the same thing
```

## Configuration

All optional, all environment variables.

| | |
|---|---|
| `SM_POLL_PORT` | port to listen on. Default `8787`. |
| `SM_POLL_FILE` | where the votes go. Default `votes.ndjson` beside `poll.mjs`. |
| `SM_POLL_ORIGIN` | the one browser origin allowed to post. Only needed when the page and the API are on different origins; behind a single reverse proxy they are not, and leaving this unset sends no CORS headers at all. |
| `SM_POLL_PROXY` | set to `1` when a reverse proxy is in front, so the rate limit reads `X-Forwarded-For` instead of counting every visitor as the proxy. |

## The votes file

One JSON object per line, appended and never rewritten, with the time added:

```json
{"choices":["rewind","online"],"comment":"more tracks","at":"2026-09-14T18:20:00.000Z"}
```

So `wc -l` counts the answers and `grep` finds a word in the comments. A line that will not parse is
skipped when the file is read, which means a crash halfway through an append costs that one vote and
nothing else. Counts live in memory and are recomputed only at startup, so the file is never read on a
request.

Nothing else is stored. No addresses, no user agents, no cookies, no identifiers of any kind.

## How much it can be gamed

Quite a lot, and that is on purpose. The page keeps a flag in `localStorage` so an honest visitor votes
once, and the service allows five votes per address per hour so a bored one cannot flood it from a loop.
Neither stops anybody who actually wants to. It is a poll to find out what people would like, not an
election, and the page says so.

## Changing the options

Edit `OPTIONS` at the top of `poll.mjs`. The page renders whatever the service reports, so there is one
list and nothing to keep in step. Ids are what gets stored, so renaming one loses the votes already cast
for it; changing a `label` is free.

## Running it for real

Two examples in the repository, pick whichever suits: `server/poll.service` for systemd and
`docker-compose.yml` for a container. Both expect a reverse proxy in front, and there are worked nginx and
Caddy configurations in `deploy/`.

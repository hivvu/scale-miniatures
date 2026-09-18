/**
 * The poll service's rules. The HTTP shell around them is thin enough to read; what is worth pinning is
 * what it accepts, what it refuses and how it counts, because those are what a stranger can poke at.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPTIONS, parseVote, parseFeedback, MAX_FEEDBACK, tally, readVotes, makeLimiter } from '../../server/poll.mjs';

const first = OPTIONS[0]!.id, second = OPTIONS[1]!.id;

describe('what counts as a vote', () => {
  it('takes a set of known choices', () => {
    expect(parseVote({ choices: [first, second] })).toEqual({ vote: { choices: [first, second] } });
  });

  it('keeps a comment, trimmed and capped', () => {
    expect(parseVote({ choices: [], comment: '  more tracks  ' })).toEqual({ vote: { choices: [], comment: 'more tracks' } });
    const long = parseVote({ choices: [first], comment: 'x'.repeat(900) });
    expect(long.vote?.comment).toHaveLength(500);
  });

  it('leaves the comment out entirely when there is none', () => {
    expect(parseVote({ choices: [first], comment: '   ' })).toEqual({ vote: { choices: [first] } });
  });

  it('collapses a repeated choice instead of counting it twice', () => {
    expect(parseVote({ choices: [first, first, second] }).vote).toEqual({ choices: [first, second] });
  });

  it('refuses anything it does not recognise', () => {
    expect(parseVote({ choices: ['a-pony'] }).error).toMatch(/unknown choice/);
    expect(parseVote({ choices: [42] }).error).toMatch(/unknown choice/);
    expect(parseVote({ choices: 'four-players' }).error).toMatch(/must be an array/);
    expect(parseVote({ choices: [], comment: 5 }).error).toMatch(/must be a string/);
    expect(parseVote({ choices: [] }).error).toMatch(/empty/);
    expect(parseVote(null).error).toMatch(/expected an object/);
    expect(parseVote([first]).error).toMatch(/expected an object/);
    expect(parseVote({ choices: new Array(OPTIONS.length + 1).fill(first) }).error).toMatch(/too many/);
  });
});

describe('changing your answer', () => {
  it('keeps a voter id when there is one, and refuses a silly one', () => {
    expect(parseVote({ choices: [first], voter: 'abc-123_XYZ' }).vote).toEqual({ choices: [first], voter: 'abc-123_XYZ' });
    expect(parseVote({ choices: [first] }).vote).not.toHaveProperty('voter');
    expect(parseVote({ choices: [first], voter: 'x'.repeat(65) }).error).toMatch(/voter/);
    expect(parseVote({ choices: [first], voter: 'has spaces' }).error).toMatch(/voter/);
    expect(parseVote({ choices: [first], voter: 7 }).error).toMatch(/voter/);
  });

  it("replaces a browser's earlier answer instead of adding another", () => {
    const t = tally([
      { choices: [first], voter: 'aa' },
      { choices: [second], voter: 'bb' },
      { choices: [second], voter: 'aa' },        // aa changed its mind
    ]);
    expect(t.votes).toBe(2);
    expect(t.counts[first]).toBe(0);
    expect(t.counts[second]).toBe(2);
  });

  it('leaves answers from before this existed alone', () => {
    // The ones already in the file have no id, and two people who both answered the same way are two people.
    const t = tally([{ choices: [first] }, { choices: [first] }, { choices: [first], voter: 'aa' }]);
    expect(t.votes).toBe(3);
    expect(t.counts[first]).toBe(3);
  });
});

describe('counting', () => {
  it('reports every option, including the ones nobody picked', () => {
    const t = tally([{ choices: [first] }, { choices: [first, second] }]);
    expect(t.votes).toBe(2);
    expect(t.counts[first]).toBe(2);
    expect(t.counts[second]).toBe(1);
    expect(Object.keys(t.counts).sort()).toEqual(OPTIONS.map(o => o.id).sort());
  });

  it('counts nothing as zeroes rather than as an empty object', () => {
    expect(tally([]).votes).toBe(0);
    expect(Object.values(tally([]).counts).every(n => n === 0)).toBe(true);
  });
});

describe('reading the file back', () => {
  it('returns nothing for a file that is not there', async () => {
    expect(await readVotes(join(tmpdir(), 'no-such-poll-file.ndjson'))).toEqual([]);
  });

  it('skips a half-written line and keeps the rest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'poll-'));
    const file = join(dir, 'votes.ndjson');
    writeFileSync(file, `{"choices":["${first}"]}\n{"choices":[\n\n{"choices":["${second}"]}\n`);
    const votes = await readVotes(file);
    expect(votes).toHaveLength(2);
    expect(tally(votes).counts[second]).toBe(1);
  });
});

describe('the rate limit', () => {
  it('lets a few through and then stops', () => {
    const allow = makeLimiter(2, 1000);
    expect(allow('1.2.3.4', 0)).toBe(true);
    expect(allow('1.2.3.4', 10)).toBe(true);
    expect(allow('1.2.3.4', 20)).toBe(false);
    expect(allow('5.6.7.8', 20)).toBe(true);      // somebody else is not affected
    expect(allow('1.2.3.4', 2000)).toBe(true);    // and the window moves on
  });
});


describe('what somebody writes after a race', () => {
  it('takes the words and tidies them', () => {
    expect(parseFeedback({ text: '  the boats are too fast  ' }))
      .toEqual({ note: { text: 'the boats are too fast' } });
  });

  it('keeps the room code when there is one, so a report can be lined up with the relay', () => {
    expect(parseFeedback({ text: 'we desynced', room: 'bcdf' }))
      .toEqual({ note: { text: 'we desynced', room: 'BCDF' } });
    expect(parseFeedback({ text: 'hi', room: 'nope!' }).error).toMatch(/four letters/);
  });

  it('refuses an empty one, and anything that is not an object', () => {
    expect(parseFeedback({ text: '   ' }).error).toMatch(/nothing/);
    expect(parseFeedback({}).error).toMatch(/string/);
    expect(parseFeedback([]).error).toMatch(/object/);
    expect(parseFeedback(null).error).toMatch(/object/);
  });

  it('cuts off an essay rather than refusing it', () => {
    const long = 'x'.repeat(MAX_FEEDBACK + 500);
    const { note } = parseFeedback({ text: long });
    expect(note?.text).toHaveLength(MAX_FEEDBACK);
  });
});

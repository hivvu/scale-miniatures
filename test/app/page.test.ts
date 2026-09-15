/**
 * The front page's own trip hazards. Not a design test: these are the two things that have silently broken
 * the page before, and both are invisible until somebody looks at it in a browser.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

describe('index.html', () => {
  it('makes [hidden] win over its own display rules', () => {
    // The page sets `display` on ids and classes it also toggles with `.hidden`. The browser's own
    // `[hidden] { display: none }` is weaker than any of those, so without this guard the cover over the
    // game stays up while the game runs underneath it, and nothing in the console says so.
    expect(html).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });

  it('points at icon files rather than a data: URI', () => {
    // /favicon.ico and /apple-touch-icon.png are asked for by name, by crawlers and by phones, whatever the
    // page declares. Both were 404ing while the page carried its icon inline.
    expect(html).toContain('href="/favicon.ico"');
    expect(html).toContain('href="/apple-touch-icon.png"');
    expect(html).not.toContain('rel="icon" href="data:');
  });

  it('has exactly one h1, and every element the engine reaches for', () => {
    expect(html.match(/<h1[\s>]/g) ?? []).toHaveLength(1);
    for (const id of ['screen', 'stage', 'status', 'viewport', 'fullscreen', 'needfiles', 'folder']) {
      expect(html, `#${id} is what src/app/game/main.ts looks up`).toContain(`id="${id}"`);
    }
  });
});

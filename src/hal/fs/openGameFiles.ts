/**
 * Getting the visitor's copy of the game in front of the page, whichever way it is available.
 *
 * There are two: the server the page came from may keep a copy next to it (which is what the dev server
 * does, and what a private deployment can do), or the visitor points at their own installed folder. The
 * folder never leaves their machine either way, and nothing here writes anything anywhere.
 */
import { GameFiles } from './GameFiles';

/** Two files that are only both present in an *installed* copy: the game itself and one track. */
const PROOF = ['MICRO.EXE', 'GAME1/ROUND21.MAP'] as const;

/** What is wrong with a folder, in a sentence a visitor can act on; undefined when it is a good one. */
export function whatIsMissing(g: GameFiles): string | undefined {
  if (!g.has(PROOF[0])) return 'that folder has no MICRO.EXE in it';
  if (!g.has(PROOF[1])) return 'that folder has MICRO.EXE but no GAME1 folder, so it is not an installed copy';
  return undefined;
}

/**
 * The copy beside the page, or undefined when the server has none. Never throws for the ordinary case of
 * "this host does not serve game data": that is an answer, not an error.
 */
export async function fromServerIfServed(): Promise<GameFiles | undefined> {
  let g: GameFiles;
  try { g = await GameFiles.fromServer(); } catch { return undefined; }   // no manifest: nothing is served
  if (!await g.served()) return undefined;
  return whatIsMissing(g) === undefined ? g : undefined;
}

/**
 * Resolves the next time the visitor picks a folder with an installed game in it. A wrong pick is reported
 * through `onWrong` and the promise simply keeps waiting, because making them reload to try again would be
 * rude.
 */
export function fromFolderInput(input: HTMLInputElement, onWrong: (why: string) => void): Promise<GameFiles> {
  return new Promise<GameFiles>(resolve => {
    input.addEventListener('change', () => {
      if (!input.files?.length) return;
      const g = GameFiles.fromFileList(input.files);
      const missing = whatIsMissing(g);
      if (missing === undefined) resolve(g); else onWrong(missing);
    });
  });
}

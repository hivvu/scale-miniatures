/** Case-insensitive view over the user's MicroMac folder (File System Access API, <input webkitdirectory>, or a
 *  list of Files). The game data never leaves the browser. */
export class GameFiles {
  private readonly files = new Map<string, File>();

  static fromFileList(list: FileList | File[]): GameFiles {
    const g = new GameFiles();
    for (const f of Array.from(list)) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      g.add(rel, f);
    }
    return g;
  }

  static async fromDirectoryHandle(dir: FileSystemDirectoryHandle): Promise<GameFiles> {
    const g = new GameFiles();
    const walk = async (h: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      // `entries()` is not in the TS lib typings for all targets yet
      const iter = (h as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
      for await (const [name, entry] of iter) {
        if (entry.kind === 'file') g.add(prefix + name, await (entry as FileSystemFileHandle).getFile());
        else await walk(entry as FileSystemDirectoryHandle, prefix + name + '/');
      }
    };
    await walk(dir, '');
    return g;
  }

  /**
   * The copy the page is served from, if its server keeps one: `<base>MicroMac/`, with `manifest.json`
   * beside it. Everything is relative to the deployment's base, so the same build works at the root of a
   * host and under a subfolder. Throws when nothing is served there, which is the ordinary case for a
   * static build: the caller is expected to offer the folder picker instead.
   */
  static async fromServer(): Promise<GameFiles> {
    // read defensively: `import.meta.env` is Vite's, and this file is also compiled without its types
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    return GameFiles.fromHttp(`${base}MicroMac/`, `${base}manifest.json`);
  }

  /** The files listed in a manifest ({files:[{path}]}) served under an HTTP prefix. Only the manifest is
   *  fetched up front; each file is fetched on first read (with retries), so a dropped request cannot silently turn
   *  into a "missing game file" later. */
  static async fromHttp(prefix: string, manifestUrl: string): Promise<GameFiles> {
    const g = new GameFiles();
    const r = await fetch(manifestUrl);
    if (!r.ok) throw new Error(`cannot load ${manifestUrl}: HTTP ${r.status}`);
    const man = await r.json() as { files: { path: string }[] };
    for (const { path } of man.files) g.addUrl(path, prefix + path.split('/').map(encodeURIComponent).join('/'));
    return g;
  }

  private readonly urls = new Map<string, string>();
  private readonly cache = new Map<string, Promise<Uint8Array>>();

  private addUrl(rel: string, url: string): void { this.urls.set(GameFiles.key(rel), url); }

  private static key(rel: string): string {
    let key = rel.replace(/\\/g, '/').toLowerCase();
    const parts = key.split('/');
    if (parts.length > 1 && !['game1'].includes(parts[0]!)) key = parts.slice(1).join('/');
    return key;
  }

  private async fetchBytes(url: string, name: string): Promise<Uint8Array> {
    let last = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch(url);
        if (r.ok) return new Uint8Array(await r.arrayBuffer());
        last = `HTTP ${r.status}`;
      } catch (e) { last = String(e); }
      await new Promise(res => setTimeout(res, 150 * (attempt + 1)));
    }
    throw new Error(`cannot fetch game file ${name} (${url}): ${last}`);
  }

  /** Strip a leading "MicroMac/" (or any single top folder) so lookups are relative to the game root. */
  private add(rel: string, f: File): void { this.files.set(GameFiles.key(rel), f); }

  /**
   * One real request, no retries: is the server actually handing the files over, or does it only have the
   * manifest? The manifest is a committed file and a static build copies it, so it loads happily on a host
   * that serves no game data at all; without this the first failure arrives a second later, halfway into
   * loading, as a bare error under a black canvas.
   */
  async served(name = 'INTRO.PAL'): Promise<boolean> {
    const url = this.urls.get(name.toLowerCase());
    if (url === undefined) return false;
    try { return (await fetch(url)).ok; } catch { return false; }
  }

  has(name: string): boolean { const k = name.toLowerCase(); return this.files.has(k) || this.urls.has(k); }
  list(): string[] { return [...new Set([...this.files.keys(), ...this.urls.keys()])].sort(); }

  async read(name: string): Promise<Uint8Array> {
    const k = name.toLowerCase();
    const f = this.files.get(k);
    if (f) return new Uint8Array(await f.arrayBuffer());
    const url = this.urls.get(k);
    if (!url) throw new Error(`missing game file: ${name} (not in the game folder / manifest)`);
    let p = this.cache.get(k);
    if (!p) { p = this.fetchBytes(url, name); this.cache.set(k, p); }
    return (await p).slice();
  }
}

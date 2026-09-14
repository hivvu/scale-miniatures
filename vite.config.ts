import { defineConfig, type Plugin } from 'vite';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

/** Dev-only: serve the local MicroMac folder at /MicroMac/* so the viewer can auto-load with ?dev.
 *  Never part of a build; game data is not redistributed. */
function serveGameFiles(): Plugin {
  const root = join(process.cwd(), 'MicroMac');
  return {
    name: 'serve-game-files', apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const prefix = req.url?.startsWith('/MicroMac/') ? '/MicroMac/' : req.url?.startsWith('/golden/') ? '/golden/' : undefined;
        if (!prefix) return next();
        const base = prefix === '/MicroMac/' ? root : join(process.cwd(), 'build', 'golden', 'gt');
        const rel = decodeURIComponent(req.url!.slice(prefix.length).split('?')[0]!);
        const p = normalize(join(base, rel));
        // the separator matters: without it `MicroMacAnything` also passes the prefix test
        if (!p.startsWith(base + sep) || !existsSync(p) || statSync(p).isDirectory()) { res.statusCode = 404; return res.end(); }
        res.setHeader('Content-Type', 'application/octet-stream'); res.end(readFileSync(p));
      });
    },
  };
}

/** Vite only copies `public/`, and there is no `public/`. The manifest is the index a served copy of the
 *  game is read through, and it is the one piece of game metadata this repository keeps (paths, sizes and
 *  hashes, no content at all), so a build has to carry it. */
function emitManifest(): Plugin {
  return {
    name: 'emit-manifest', apply: 'build',
    generateBundle() {
      const p = join(process.cwd(), 'manifest.json');
      if (existsSync(p)) this.emitFile({ type: 'asset', fileName: 'manifest.json', source: readFileSync(p) });
    },
  };
}

export default defineConfig({
  plugins: [serveGameFiles(), emitManifest()],
  server: { port: 3000 },
  // Where the built site will live. Everything the pages ask for is relative to it (see GameFiles.fromServer),
  // so `SM_BASE=/micromachines/ npm run build` is all a deploy under a subfolder needs.
  base: process.env['SM_BASE'] ?? '/',
  build: {
    rollupOptions: {
      input: { index: 'index.html', viewer: 'viewer.html', race: 'race.html', game: 'game.html' },
    },
  },
});

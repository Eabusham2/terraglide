#!/usr/bin/env node
/**
 * Tiny static server so you can open the game.
 *
 * Browsers refuse to load ES modules and workers over file://, so the folder has
 * to be served over HTTP. This uses nothing but Node's standard library — no
 * install step, no dependencies.
 *
 *   node serve.mjs            -> http://127.0.0.1:8080
 *   node serve.mjs 3000       -> http://127.0.0.1:3000
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  // WebAssembly has to arrive as application/wasm or the browser refuses to
  // stream-compile it, which is how the Draco decoder is loaded.
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    // Keep requests inside the project directory.
    const target = normalize(join(ROOT, pathname));
    if (!target.startsWith(ROOT + sep) && target !== ROOT) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
    });
    createReadStream(target).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(err));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`TerraGlide is being served at http://${HOST}:${PORT}`);
  console.log('Press Ctrl+C to stop.');
});

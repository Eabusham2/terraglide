#!/usr/bin/env node
/**
 * The TerraGlide server.
 *
 *   node server/server.mjs                 -> http://localhost:8080, game and server
 *   PORT=3000 node server/server.mjs       -> another port
 *   node server/server.mjs --reset-password NAME NEWPASSWORD
 *   node server/server.mjs --admin NAME    -> make an account an admin
 *
 * One process, one port, nothing to install. It serves the game itself, so
 * the server's own address is playable — open it and you are joining it — and
 * it takes the WebSocket on the same port at /ws, which is what the copy on
 * GitHub Pages and the single-file downloads connect to.
 *
 * See HOSTING.md for putting it on the internet.
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { Accounts } from './accounts.mjs';
import { ROOT, loadConfig } from './config.mjs';
import { Game } from './game.mjs';
import { Store } from './store.mjs';
import { refuse, upgrade } from './ws.mjs';

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
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * What the web half will hand out: the game and nothing else.
 *
 * An allow-list rather than "everything under the folder", because this
 * folder also holds the server — and the server's data directory holds every
 * account's password hash. Nothing outside these is ever served, whatever the
 * path asks for.
 */
const PUBLIC_FILES = new Set([
  'index.html', 'terraglide.html', 'terraglide-online.html', 'terraglide.bundle.js',
  'LICENSE', 'THIRD-PARTY.md', 'README.md', 'HOSTING.md',
]);
const PUBLIC_DIRS = ['src/', 'styles/', 'vendor/', 'assets/'];
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.md', '.txt']);

function isPublic(relative) {
  if (relative.split('/').some((part) => part.startsWith('.'))) return false;
  return PUBLIC_FILES.has(relative) || PUBLIC_DIRS.some((dir) => relative.startsWith(dir));
}

const gzipCache = new Map();

function compressed(file, mtime) {
  const cached = gzipCache.get(file);
  if (cached && cached.mtime === mtime) return cached.body;
  const body = gzipSync(readFileSync(file), { level: 6 });
  gzipCache.set(file, { mtime, body });
  return body;
}

/**
 * The page, with one line added: this server serves the game, so the game it
 * serves should join it. See core/boot.js.
 */
function indexPage(file) {

  const html = readFileSync(file, 'utf8');
  return html.replace('<script>', '<script>window.__TERRAGLIDE_SERVER__ = true;</script>\n    <script>');
}

function clientAddress(req, config) {
  if (config.trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (forwarded) return forwarded;
    if (req.headers['cf-connecting-ip']) return String(req.headers['cf-connecting-ip']);
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function originAllowed(origin, config) {
  const allowed = config.allowedOrigins;
  if (allowed === '*' || allowed == null) return true;
  const list = Array.isArray(allowed) ? allowed : String(allowed).split(',');
  return list.map((s) => s.trim()).includes(String(origin ?? 'null'));
}

/** Build the bundle if this checkout does not have one — it is a build output. */
function ensureBundle() {
  const bundle = join(ROOT, 'terraglide.bundle.js');
  if (existsSync(bundle)) return;
  console.log('Building the game bundle (first run only)…');
  const result = spawnSync(process.execPath, [join(ROOT, 'tools/bundle.mjs')], { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) console.warn('Could not build the bundle; the game will load module by module instead.');
}

export function startServer(overrides = {}) {
  const config = { ...loadConfig(), ...overrides };
  const store = new Store(config.dataDir);
  const accounts = new Accounts(store, config);
  const game = new Game({ config, store, accounts });

  const http = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/api/status') {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify({ terraglide: true, ...game.publicInfo() }));
        return;
      }
      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
        return;
      }
      if (!config.serveGame) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          .end('This is a TerraGlide server. Join it from the game: Online → server address.');
        return;
      }
      let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (relative === '' || relative.endsWith('/')) relative += 'index.html';
      const target = normalize(join(ROOT, relative));
      if (!target.startsWith(ROOT + sep) || !isPublic(relative.split(sep).join('/'))) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      let info;
      try {
        info = statSync(target);
      } catch {
        info = null;
      }
      if (!info || !info.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      const type = TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream';
      const modified = info.mtime.toUTCString();
      const headers = {
        'Content-Type': type,
        'Last-Modified': modified,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      };
      if (relative === 'index.html') {
        const body = Buffer.from(indexPage(target));
        res.writeHead(200, { ...headers, 'Content-Length': body.length }).end(body);
        return;
      }
      if (req.headers['if-modified-since'] === modified) {
        res.writeHead(304, headers).end();
        return;
      }
      const gzip = COMPRESSIBLE.has(extname(target).toLowerCase())
        && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
      if (gzip) {
        const body = compressed(target, info.mtimeMs);
        res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': body.length, Vary: 'Accept-Encoding' });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      res.writeHead(200, { ...headers, 'Content-Length': info.size });
      if (req.method === 'HEAD') res.end();
      else createReadStream(target).pipe(res);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Server error');
      console.error('[http]', error);
    }
  });

  http.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== '/ws' && path !== '/') return refuse(socket, 404, 'Not Found');
    if (!originAllowed(req.headers.origin, config)) return refuse(socket, 403, 'Forbidden');
    const ws = upgrade(req, socket, head);
    if (ws) game.connect(ws, clientAddress(req, config));
  });

  const timer = setInterval(() => game.tick(), 100);
  timer.unref?.();

  const ready = new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(config.port, config.host, () => resolve(http.address()));
  });

  const stop = async () => {
    clearInterval(timer);
    for (const client of game.clients) {
      game.send(client, { t: 'kick', reason: 'The server is restarting' });
      client.ws.close(1001, 'server stopping');
    }
    const saved = game.saveAll();
    await new Promise((resolve) => http.close(resolve));
    return saved;
  };

  return { config, store, accounts, game, http, ready, stop };
}

async function cli(argv) {
  const config = loadConfig();
  const store = new Store(config.dataDir);
  const accounts = new Accounts(store, config);
  if (argv[0] === '--reset-password') {
    const [, name, password] = argv;
    const result = await accounts.resetPassword(name ?? '', password ?? '');
    store.flush();
    console.log(result.error ?? `Password for ${name} reset; they have been signed out everywhere.`);
    return result.error ? 1 : 0;
  }
  if (argv[0] === '--admin') {
    const account = accounts.get(argv[1] ?? '');
    if (!account) {
      console.log(`No account called ${argv[1]}`);
      return 1;
    }
    account.admin = true;
    accounts.save();
    store.flush();
    console.log(`${account.name} is an admin.`);
    return 0;
  }
  return null;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const code = await cli(process.argv.slice(2));
  if (code !== null) process.exit(code);
  ensureBundle();
  const server = startServer();
  const address = await server.ready.catch((error) => {
    console.error(`Could not listen on ${server.config.host}:${server.config.port}: ${error.message}`);
    process.exit(1);
  });
  const port = address.port;
  console.log(`TerraGlide server "${server.config.name}" is running.`);
  console.log(`  Play here:        http://localhost:${port}`);
  console.log(`  Others connect:   ws://<this machine's address>:${port}/ws  (wss:// behind HTTPS)`);
  console.log(`  Data is saved in: ${server.config.dataDir}`);
  console.log('Press Ctrl+C to stop.');
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      if (stopping) process.exit(1);
      stopping = true;
      console.log('\nSaving and stopping…');
      await server.stop();
      process.exit(0);
    });
  }
}
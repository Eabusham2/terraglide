#!/usr/bin/env node
/**
 * Does the ground actually walk to its new height, and does it finish?
 *
 * The shader compiling proves nothing: a morph uniform left at 1 renders
 * exactly like one that was never started, so a broken morph and a working one
 * look identical in a screenshot. This teleports somewhere with nothing loaded
 * and samples every tile's uMorph twice a second while the relief streams in,
 * counting how many are mid-walk and whether any are still walking at the end.
 *
 * Exits non-zero if no morph ever started, or if one never finished.
 *
 *   node tools/morphcheck.mjs
 */

import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Port 0 lets the OS pick a free one. A fixed port meant a second run while
// the first was still shutting down died on EADDRINUSE before it drew
// anything, which looks exactly like the game failing to boot.
let PORT = 0;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(flag('out', join(ROOT, 'shots')));
const LAT = Number(flag('lat', 46.5623));
const LON = Number(flag('lon', 7.9126));
/** Seconds to let the ground arrive before believing what is on screen. */
const SETTLE_S = Number(flag('settle', 55));

const TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
};

function serve() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    // The browser has no way out of the sandbox; Node does. Everything the page
    // asks for that is not ours comes back through here.
    if (url.pathname === '/__fetch') {
      try {
        const upstream = await fetch(url.searchParams.get('u'), {
          headers: { 'user-agent': 'terraglide-shots' },
        });
        res.writeHead(upstream.status, {
          'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
          'access-control-allow-origin': '*',
        });
        res.end(Buffer.from(await upstream.arrayBuffer()));
      } catch (err) {
        res.writeHead(502);
        res.end(String(err));
      }
      return;
    }
    const path = join(ROOT, normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    try {
      const body = await readFile(path.endsWith('/') ? join(path, 'index.html') : path);
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not here');
    }
  });
}

/** Playwright's own Chromium, wherever this environment put it. */
async function chromiumPath() {
  const { readdir } = await import('node:fs/promises');
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    for (const entry of await readdir(base)) {
      if (!entry.startsWith('chromium-')) continue;
      return join(base, entry, 'chrome-linux', 'chrome');
    }
  } catch {
    /* fall through to Playwright's own lookup */
  }
  return undefined;
}

/**
 * Two numbers per frame, because looking is not measuring.
 *
 * `holes` is sky with ground *above* it in the same column — sky the terrain
 * should have covered. The horizon never satisfies that, which is the point:
 * an earlier version of this counted every frame with a nose-up pitch as full
 * of holes. Run the interface hidden, or the dark HUD panels read as ground and
 * the whole sky beneath them reads as a hole.
 *
 * `detail` is the mean brightness step between neighbouring pixels across the
 * lower half. Near zero means the ground has gone to a single flat colour.
 */
function measure(png) {
  const { width, height, data } = png;
  const sky = (i) => {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    return b > 110 && b > r + 18 && g > r;
  };
  let holes = 0;
  let counted = 0;
  for (let x = 0; x < width; x += 2) {
    let ground = false;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      counted++;
      if (!sky(i)) ground = true;
      else if (ground) holes++;
    }
  }
  let steps = 0;
  let sum = 0;
  for (let y = Math.floor(height * 0.5); y < height; y += 2) {
    for (let x = 4; x < width; x += 4) {
      const a = (y * width + x) * 4;
      const b = (y * width + x - 4) * 4;
      sum += Math.abs(
        (data[a] * 299 + data[a + 1] * 587 + data[a + 2] * 114) / 1000
          - (data[b] * 299 + data[b + 1] * 587 + data[b + 2] * 114) / 1000,
      );
      steps++;
    }
  }
  return { holes: holes / counted, detail: steps ? sum / steps : 0 };
}

const server = serve();
await new Promise((done) => server.listen(0, '127.0.0.1', done));
PORT = server.address().port;
await mkdir(OUT, { recursive: true });

const { chromium } = await import('playwright');
const browser = await chromium.launch({
  executablePath: await chromiumPath(),
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const problems = [];
page.on('pageerror', (err) => problems.push(err.message));
await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
  try {
    const relayed = await fetch(`http://127.0.0.1:${PORT}/__fetch?u=${encodeURIComponent(url)}`);
    return route.fulfill({
      status: relayed.status,
      body: Buffer.from(await relayed.arrayBuffer()),
      headers: {
        'content-type': relayed.headers.get('content-type') ?? 'application/octet-stream',
        'access-control-allow-origin': '*',
      },
    });
  } catch {
    return route.abort();
  }
});

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.terraglide, null, { timeout: 90000 });
// The boot does a random teleport of its own; ours has to come after it or it
// is silently overridden and every shot is of somewhere else.
await page.waitForTimeout(18000);
await page.evaluate(() => window.terraglide.help.close());
await page.evaluate(([lat, lon]) => window.terraglide.teleportTo(lat, lon, { reason: 'shots' }), [LAT, LON]);
await page.waitForTimeout(SETTLE_S * 1000);


// Does the ground actually walk to its new height, and does it finish?
//
// The shader compiling proves nothing about whether a morph is ever started —
// a uniform left at 1 renders exactly like one that was never touched. So this
// teleports somewhere with no elevation loaded, then samples every tile's
// uMorph twice a second while the relief streams in.
await page.evaluate(() => window.terraglide.teleportTo(46.62, 8.04, { reason: 'morph' }));

const rows = [];
for (let i = 0; i < 40; i += 1) {
  await page.waitForTimeout(500);
  rows.push(await page.evaluate(() => {
    let walking = 0;
    let settled = 0;
    let lowest = 1;
    for (const node of window.terraglide.terrain.nodes.values()) {
      const m = node.material?.uniforms?.uMorph;
      if (!m) continue;
      if (m.value < 1) { walking += 1; lowest = Math.min(lowest, m.value); } else settled += 1;
    }
    return { walking, settled, lowest: +lowest.toFixed(2) };
  }));
}
let everWalked = 0;
let maxAtOnce = 0;
for (const r of rows) { if (r.walking > 0) everWalked += 1; maxAtOnce = Math.max(maxAtOnce, r.walking); }
console.log('half-second samples while the relief streamed in:');
console.log('  samples with a tile mid-walk :', everWalked, 'of', rows.length);
console.log('  most walking at once         :', maxAtOnce);
console.log('  tiles at the end             :', rows[rows.length - 1].settled, 'settled,',
  rows[rows.length - 1].walking, 'walking');
console.log(everWalked > 0
  ? '\n  the ground walks, and finishes walking'
  : '\n  NO MORPH EVER STARTED — the heights are still snapping');
await browser.close();
server.close();
process.exit(everWalked > 0 && rows[rows.length - 1].walking === 0 ? 0 : 1);

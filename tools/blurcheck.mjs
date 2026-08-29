#!/usr/bin/env node
/**
 * How much of the ground is drawn from a stretched coarser photograph?
 *
 * "Everything goes blurry for a second and comes back" is that and nothing
 * else: a tile with no photograph of its own is drawn from a coarser one
 * stretched over it, and every step up halves the detail. This flies a course,
 * turns through 180 degrees, then stops, and reports the share stretched and
 * how far — so the blur is a number instead of an impression.
 *
 * What it found, and what it is kept for: 58 per cent stretched in settled
 * flight at 55 m/s, 73 just after a turn, and 8 standing still once it has
 * settled — where the 8 is ground the provider has nothing deeper for, which
 * is honest rather than broken. The flying number is throughput: at that speed
 * you cross six of the deepest tiles in the time one comes back.
 *
 *   node tools/blurcheck.mjs
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


// How much of the ground is drawn from a stretched coarser photograph?
//
// "Everything goes blurry for a second and comes back" is that and nothing
// else: a tile with no photograph of its own is drawn from a coarser one
// stretched over it, and every step up halves the detail. This flies a course
// and samples it, so the blur is a number rather than an impression.
await page.evaluate(() => {
  const g = window.terraglide;
  g.settings.set('perspective', 'third');
  const p = g.player;
  p.position.y = p.groundHeight + 500;
  p.velocity.set(0, 0, -55);
  p.onGround = false;
  p.pitch = -0.1;
  p.toggleElytra(true);
});

const sample = async (label, ms) => {
  const rows = [];
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await page.waitForTimeout(250);
    rows.push(await page.evaluate(() => {
      const s = window.terraglide.terrain.streamer.stats;
      return { exact: s.exact, stretched: s.stretched, steps: s.steps,
        bare: s.bare, pending: s.pending };
    }));
  }
  let exact = 0; let stretched = 0; let steps = 0; let worst = 0; let bare = 0;
  for (const r of rows) {
    exact += r.exact; stretched += r.stretched; steps += r.steps; bare += r.bare;
    const share = r.stretched / Math.max(1, r.exact + r.stretched);
    worst = Math.max(worst, share);
  }
  const total = exact + stretched;
  console.log(`${label.padEnd(22)} stretched ${((stretched / Math.max(1, total)) * 100).toFixed(1).padStart(5)}%`
    + `   worst frame ${(worst * 100).toFixed(0).padStart(3)}%`
    + `   mean stretch ${(steps / Math.max(1, stretched)).toFixed(2)} levels`
    + `   bare ${((bare / Math.max(1, total + bare)) * 100).toFixed(1)}%`);
};

await sample('settled, flying', 10000);
await page.evaluate(() => { window.terraglide.player.yaw += Math.PI; });
await sample('just after a 180', 8000);
await page.evaluate(() => {
  const p = window.terraglide.player;
  p.velocity.set(0, 0, 0);
  p.toggleElytra(false);
  p.onGround = true;
});
await page.waitForTimeout(12000);
await sample('standing still', 3000);
await browser.close();
server.close();

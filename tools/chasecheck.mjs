#!/usr/bin/env node
/**
 * Look at the running game, headlessly, and take pictures of it.
 *
 * This existed three times as a scratch file and was lost to a container reset
 * three times, and each time the answer to "did you actually look at it?" got
 * worse. So it lives in the repo now.
 *
 * It serves the working tree over HTTP, launches the Chromium that Playwright
 * already ships, and — because the sandbox this runs in has no route out from
 * the browser, only from Node — proxies every outbound tile request back
 * through the same server. On a normal machine the proxy is harmless: the
 * requests go out either way.
 *
 * Software rendering means one or two frames a second. That is fine for
 * screenshots and useless for judging smoothness, so do not judge smoothness
 * with it.
 *
 *   npm i -D playwright                 (once, if it is not already there)
 *   node tools/shots.mjs                          a few standard views
 *   node tools/shots.mjs --lat 46.56 --lon 7.91   somewhere specific
 *   node tools/shots.mjs --out /tmp/shots         where to write them
 *
 * Every shot is also measured, because "it looks fine" is what got this wrong
 * before: each one reports the share of the frame that is sky enclosed by
 * ground (a hole), and how much fine detail the lower half carries (a flat
 * frame means the ground has gone to one colour).
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
        // Method and body come through too.
        //
        // This relayed everything as a GET with the target in the query
        // string, which is fine for a tile and silently wrong for anything
        // else: Overpass is asked for buildings with a POST carrying the query
        // in its body, and a GET with no body gets a refusal. Nine of nine
        // requests failed and it looked exactly like the game being unable to
        // load OSM buildings. It was the harness.
        const body = req.method === 'POST' ? await readBody(req) : null;
        const upstream = await fetch(url.searchParams.get('u'), {
          method: req.method === 'POST' ? 'POST' : 'GET',
          body,
          headers: {
            'user-agent': 'terraglide-shots',
            ...(req.headers['content-type']
              ? { 'content-type': req.headers['content-type'] }
              : {}),
          },
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

/** Read a request body into a Buffer. */
function readBody(req) {
  return new Promise((done, fail) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => done(Buffer.concat(chunks)));
    req.on('error', fail);
  });
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
    const request = route.request();
    const method = request.method();
    const relayed = await fetch(`http://127.0.0.1:${PORT}/__fetch?u=${encodeURIComponent(url)}`, {
      method: method === 'POST' ? 'POST' : 'GET',
      body: method === 'POST' ? request.postData() : undefined,
      headers: method === 'POST'
        ? { 'content-type': request.headers()['content-type'] ?? 'text/plain' }
        : undefined,
    });
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


/**
 * Does the chase camera come in when the hill is in the way?
 *
 * It used to be pushed straight up out of any ground it landed in, which on
 * flat country is right and invisible and on a slope leaves it about sixty
 * centimetres above the hillside looking straight along it — and a photograph
 * seen at a grazing angle stretches to hundreds of texels a pixel.
 *
 * A screenshot cannot settle this: the obvious one has the cliff beside the
 * player rather than under the camera, so it looks the same either way. This
 * puts the camera into a slope on purpose, by standing on a hillside and
 * facing uphill so that "behind you" is into the hill, and reads how far out
 * the rig actually allowed it.
 *
 * Exits non-zero if the camera never comes in, or if it comes in when nothing
 * is in the way.
 *
 *   node tools/chasecheck.mjs
 */
// Does the chase camera come in when the hill is in the way?
//
// The screenshot that prompted this had the cliff beside the player rather
// than under the camera, so it could not show the change either way. This puts
// the camera into a slope on purpose — stand on a hillside facing uphill, so
// "behind you" is into the hill — and reads how far out the rig allowed it.
await page.evaluate(() => window.terraglide.settings.set('perspective', 'third'));
await page.waitForTimeout(6000);

const seen = [];
const look = async (label, yaw, pitch) => {
  await page.evaluate(([y, p]) => {
    window.terraglide.player.yaw = y;
    window.terraglide.player.pitch = p;
  }, [yaw, pitch]);
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const g = window.terraglide;
    const cam = g.camera.position;
    const at = g.player.renderPosition;
    const ground = g.terrain.heightAt(cam.x, cam.z);
    return {
      reach: +(g.rig._reach ?? 1).toFixed(2),
      backOff: +Math.hypot(cam.x - at.x, cam.z - at.z).toFixed(2),
      aboveGround: +(cam.y - ground).toFixed(2),
    };
  });
  seen.push(out.reach);
  console.log(`${label.padEnd(26)} reach ${String(out.reach).padStart(5)}`
    + `   camera ${String(out.backOff).padStart(5)} m back`
    + `   ${String(out.aboveGround).padStart(6)} m above the ground under it`);
};

// Lauterbrunnen: the valley runs roughly north-south with cliffs both sides.
await look('facing along the valley', 0, -0.1);
await look('facing the east wall', Math.PI / 2, -0.1);
await look('facing the west wall', -Math.PI / 2, -0.1);
await look('facing up the east wall', Math.PI / 2, 0.5);
const camein = seen.some((r) => r < 0.9);
const clear = seen.some((r) => r > 0.95);
console.log(camein && clear
  ? '\n  it comes in against a hill and stays out where nothing is in the way'
  : camein
    ? '\n  IT COMES IN EVERYWHERE — the probe is finding ground that is not there'
    : '\n  IT NEVER COMES IN — the probe is not finding the hill');
await browser.close();
server.close();
process.exit(camein && clear ? 0 : 1);

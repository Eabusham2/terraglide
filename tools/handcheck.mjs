#!/usr/bin/env node
/**
 * Can you see your own hands while gliding in first person?
 *
 * It is a whole tool because it cannot be answered anywhere cheaper. Every
 * other check on the character measures the character — limb lengths, spans,
 * which side a hand is on — and the character was never what was wrong. What
 * was wrong was where the parts finished relative to the camera the rig
 * actually places, and that depends on the eye lean, the near plane, the FOV
 * of the moment and the camera's own pitch. None of it is visible from the
 * avatar alone: a first-person glide showed nothing of you at all, no arms, no
 * hands, no firework, while every model check passed.
 *
 * So this boots the game, flies it, poses a first-person glide at four look
 * angles, and reports where the fist and the firework land in the frame in
 * screen coordinates. Exits non-zero if any of them shows you nothing.
 *
 *   node tools/handcheck.mjs
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
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
try {
  await page.waitForFunction(() => !!window.terraglide, null, { timeout: 120000 });
} catch (e) {
  console.log('did not boot:', e.message);
  console.log('page problems:', problems.slice(0, 10));
  console.log('body text:', (await page.textContent('body')).slice(0, 400));
  await browser.close(); server.close(); process.exit(1);
}
// The boot does a random teleport of its own; ours has to come after it or it
// is silently overridden and every shot is of somewhere else.
await page.waitForTimeout(18000);
await page.evaluate(() => window.terraglide.help.close());
await page.evaluate(([lat, lon]) => window.terraglide.teleportTo(lat, lon, { reason: 'shots' }), [LAT, LON]);
await page.waitForTimeout(SETTLE_S * 1000);

// Each view poses the game, waits, then is both saved and measured.
const _unusedViews = [
  ['ground-level', () => { const p = window.terraglide.player; p.pitch = 0; }],
  ['ground-down', () => { const p = window.terraglide.player; p.pitch = -1.4; }],
  // Through the setting, not through whatever method the rig happens to have:
  // an optional-call that lands on nothing fails silently and the shot is of
  // first person again, which is exactly what it did.
  ['third-person', () => {
    window.terraglide.settings.set('perspective', 'third');
    window.terraglide.player.pitch = -0.15;
  }],
  ['glide', () => {
    const p = window.terraglide.player;
    p.position.y = p.groundHeight + 700;
    p.velocity.set(0, 0, -45);
    p.onGround = false;
    p.pitch = -0.25;
    p.toggleElytra(true);
  }],
  // The chase camera on a gliding player, looking down at him — the frame the
  // wings and the body actually get judged in, and the one the model has been
  // wrong in. Nose-down as well as level, because a wing that reads from
  // straight behind can still be a plank from above.
  ['glide-third', () => {
    window.terraglide.settings.set('perspective', 'third');
    const p = window.terraglide.player;
    p.position.y = p.groundHeight + 700;
    p.velocity.set(0, -6, -48);
    p.onGround = false;
    p.pitch = -0.5;
    p.toggleElytra(true);
  }],
  ['glide-first', () => {
    window.terraglide.settings.set('perspective', 'first');
    const p = window.terraglide.player;
    p.position.y = p.groundHeight + 700;
    p.velocity.set(0, -6, -48);
    p.onGround = false;
    p.pitch = -0.55;
    p.toggleElytra(true);
  }],
];


// Where every part of you ends up in the camera's own frame, in a first-person
// glide. Screen coordinates are 0..1 across and down; anything outside that, or
// with a camera-space z above -near, is not on screen however visible its flag.
await page.evaluate(() => {
  window.terraglide.settings.set('perspective', 'first');
  const p = window.terraglide.player;
  p.position.y = p.groundHeight + 700;
  p.velocity.set(0, -6, -48);
  p.onGround = false;
  p.pitch = -0.55;
  p.toggleElytra(true);
});
await page.waitForTimeout(9000);
// Where your own hands land on screen in a first-person glide.
//
// This is the measurement that was missing. Everything else about the model is
// checked against the model — limb lengths, spans, which side a hand is on —
// and the model was never what was wrong. What was wrong was where the parts
// finished relative to the camera the rig actually places, and that depends on
// the eye lean, the near plane, the FOV of the moment and the camera's pitch,
// none of which a check on the avatar alone can see. A first-person glide
// showed nothing of you at all while every model check passed.
const rows = [];
for (const pitch of [-0.9, -0.55, -0.2, 0.15]) {
  const row = await page.evaluate((pi) => {
    const g = window.terraglide;
    const a = g.avatar;
    g.player.pitch = pi;
    for (let i = 0; i < 120; i += 1) {
      g.rig.update(g.player, 1 / 60);
      a.update(g.player, 1 / 60);
    }
    a.hideWhatIsInYourEye(g.camera);
    const cam = g.camera;
    cam.updateMatrixWorld(true);
    a.root.updateMatrixWorld(true);
    const V = (x, y, z) => cam.position.clone().set(x, y, z);
    const look = (o) => {
      const m = o.matrixWorld.elements;
      const local = cam.worldToLocal(V(m[12], m[13], m[14]));
      const ndc = V(m[12], m[13], m[14]).project(cam);
      let chain = true;
      for (let n = o; n; n = n.parent) if (!n.visible) { chain = false; break; }
      return { ahead: -local.z, sx: ndc.x * 0.5 + 0.5, sy: -ndc.y * 0.5 + 0.5, chain };
    };
    // Whichever pair is actually drawn. A glide swaps the world arms for the
    // view model, so naming one of them here would measure a hidden object and
    // report a screen position nothing occupies.
    const worldArms = a.armR.pivot.visible;
    return { pitch: pi, drawn: worldArms ? 'world arms' : 'view model',
      fist: look(worldArms ? a.fistR : a.handR),
      rocket: look(worldArms ? a.rocket : a.handRocket),
      near: cam.near, fov: cam.fov };
  }, pitch);
  rows.push(row);
}
console.log(`${'pitch'.padStart(6)} ${'drawn'.padEnd(11)} ${'ahead'.padStart(6)}  `
  + `${'fist x/y'.padEnd(13)} ${'rocket x/y'.padEnd(13)} on screen?`);
let bad = 0;
for (const row of rows) {
  const inFrame = (q) => q.chain && q.ahead > row.near + 0.06
    && q.sx > 0 && q.sx < 1 && q.sy > 0 && q.sy < 1;
  const good = inFrame(row.fist) && inFrame(row.rocket);
  if (!good) bad += 1;
  console.log(`${String(row.pitch).padStart(6)} ${row.drawn.padEnd(11)} `
    + `${row.fist.ahead.toFixed(2).padStart(6)}  `
    + `${`${row.fist.sx.toFixed(2)}/${row.fist.sy.toFixed(2)}`.padEnd(13)} `
    + `${`${row.rocket.sx.toFixed(2)}/${row.rocket.sy.toFixed(2)}`.padEnd(13)} `
    + `${good ? 'yes' : 'NO — you can see nothing of yourself'}`);
}
console.log(bad === 0
  ? '\ngliding in first person, your hand and the firework are both on screen'
  : `\n${bad} of ${rows.length} look angles show you nothing of yourself`);
await browser.close();
server.close();
process.exit(bad === 0 ? 0 : 1);

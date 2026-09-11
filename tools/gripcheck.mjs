#!/usr/bin/env node
/**
 * Is the firework actually in the hand?
 *
 * Six repairs to this were made by looking at a render and deciding "that
 * reads as held", and five of them were wrong. Looking is the thing that does
 * not work here, because the scanned figure's fist is a closed lump of mesh
 * with no hole in it: nothing can be gripped by it, only overlapped, and the
 * overlap is invisible. A tube buried through the middle of that fist touches
 * it everywhere and shows you a stick hovering past the knuckles; a tube held
 * clear of it touches nothing and shows you the same picture. The two faults
 * look identical and want opposite corrections, which is exactly how five
 * goes in a row went the wrong way.
 *
 * So it is measured, from the posed rig, in two numbers:
 *
 *   nearest    how close the closest vertex of the fist comes to the rocket's
 *              own axis. Inside the tube's radius, the hand is within the tube
 *              and something is being held.
 *   offCentre  how far that axis passes from the middle of the fist, as a
 *              share of the fist's own radius. Zero is straight through the
 *              middle - buried, and the fault that reads as floating. Past one
 *              is outside the hand altogether - floating for real. Against the
 *              fingers, where a hand actually holds a thing, is just under one.
 *
 * Measured on the three settings that shipped or nearly shipped:
 *
 *   buried through the fist   nearest  9.1 mm   offCentre 0.69
 *   held clear of it         nearest 14.6 mm   offCentre 1.52
 *   against the fingers      nearest  0.8 mm   offCentre 0.94
 *
 *   node tools/gripcheck.mjs
 */
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary',
};
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('no'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const PORT = server.address().port;

let chrome;
for (const entry of await readdir('/opt/pw-browsers')) {
  if (entry.startsWith('chromium-')) chrome = join('/opt/pw-browsers', entry, 'chrome-linux', 'chrome');
}
const { chromium } = await import('playwright');
const browser = await chromium.launch({
  executablePath: chrome,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/tools/model.html?scan`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
// Standing, firework in hand, settled — the same pose the shots are taken in.
await page.evaluate(() => window.__pose('grip-front'));
const grip = await page.evaluate(() => window.__grip());
await browser.close();
server.close();

if (!grip || grip.nearest === undefined) {
  console.log('gripcheck: the scan or its rocket did not load —', JSON.stringify(grip));
  process.exit(1);
}
const held = grip.nearest < grip.radius;
const placed = grip.offCentre > 0.82 && grip.offCentre < 1.12;
const mm = (n) => `${(n * 1000).toFixed(1)} mm`;
console.log(`fist to the rocket's axis   ${mm(grip.nearest)}  (tube radius ${mm(grip.radius)})`);
console.log(`that axis off the fist's middle  ${grip.offCentre.toFixed(2)} of its radius`);
console.log(held ? '  the hand is inside the tube' : '  NOT HELD — the tube is clear of the hand');
console.log(placed ? '  and against the fingers, not through the middle'
  : (grip.offCentre <= 0.82 ? '  BURIED — the axis runs through the middle of the fist'
    : '  FLOATING — the axis passes outside the fist'));
process.exit(held && placed ? 0 : 1);

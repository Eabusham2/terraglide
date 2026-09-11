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
 * So it is measured, from the posed rig: what share of the fist's vertices lie
 * inside the tube - how much of the hand the firework actually passes through.
 * That is the quantity, and it took a second try to find it. The first version
 * measured how far the tube's axis ran from the middle of the fist, which
 * sounds like the same question and is not: it says nothing about whether the
 * tube is down among the fingers or sailing over the knuckles, and it called a
 * placement that reads as gripped from eight angles "buried".
 *
 * Calibrated against four placements, each rendered from eight cameras round
 * the hand and judged from all of them rather than from the front alone:
 *
 *   held clear of the hand           0.02   floating, obviously
 *   behind the fingers               0.14   floats from the side
 *   through the knuckles             0.19   gap from the side
 *   down through the fingers         0.26   gripped from every angle
 *
 * It is NOT in npm run check and should not be trusted over a look at the
 * renders. Twice it agreed with a placement that six cameras showed was wrong:
 * a number that counts how much of a solid fist a tube passes through cannot
 * tell you whether the result looks like a hand holding something. It is here
 * as a quick reading, not as a verdict.
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
const mm = (n) => `${(n * 1000).toFixed(1)} mm`;
const through = grip.through ?? 0;
console.log(`fist to the rocket's axis   ${mm(grip.nearest)}  (tube radius ${mm(grip.radius)})`);
console.log(`share of the fist inside the tube  ${(through * 100).toFixed(0)}%`);
console.log(through >= 0.22
  ? '  the firework passes through the fingers — held'
  : '  NOT HELD — too little of the hand is on it; it will read as floating');
process.exit(through >= 0.22 ? 0 : 1);

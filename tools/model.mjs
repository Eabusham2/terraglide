/**
 * Look at the character on its own.
 *
 * Judging the model from a screenshot of the world means judging it against
 * whatever hillside happens to be behind it, at forty pixels tall, in whatever
 * light that valley had — which is how a figure with one leg and no arms
 * survived several passes of "it looks fine to me". This puts the avatar alone
 * on a flat ground, under the game's own sun and hemisphere at their real
 * intensities, and photographs it from the angles that matter: the chase
 * camera behind a glide, the same from above, and standing from the front and
 * the side.
 *
 * It also measures. Each shot reports the mean brightness of the pixels
 * belonging to each part of the body, so "the wings are blown out" and "the
 * body is a black slab" are numbers rather than impressions.
 *
 *   node tools/model.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'shots');
await mkdir(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const body = await readFile(join(ROOT, path));
    const dot = path.slice(path.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': TYPES[dot] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('no'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const PORT = server.address().port;

async function chromiumPath() {
  const base = '/opt/pw-browsers';
  for (const entry of await readdir(base)) {
    if (entry.startsWith('chromium-')) return join(base, entry, 'chrome-linux', 'chrome');
  }
  return undefined;
}

const { chromium } = await import('playwright');
const browser = await chromium.launch({
  executablePath: await chromiumPath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));

await page.goto(`http://127.0.0.1:${PORT}/tools/model.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });

const views = ['glide-behind', 'glide-above', 'glide-side', 'stand-front', 'stand-side', 'stand-back'];
console.log(`${'view'.padEnd(13)} ${'jacket'.padStart(7)} ${'trouser'.padStart(8)} ${'skin'.padStart(6)} ${'wing'.padStart(6)}   (0-255 mean; ! = over a quarter of it above 200)`);
for (const view of views) {
  await page.evaluate((v) => window.__pose(v), view);
  await page.waitForTimeout(250);
  const shot = await page.screenshot();
  await writeFile(join(OUT, `model-${view}.png`), shot);
  const stats = await page.evaluate(() => window.__measure());
  const cell = (s, w) => (s.n === 0 ? '--'.padStart(w)
    : `${Math.round(s.mean)}${s.blown > 0.25 ? '!' : ''}`.padStart(w));
  console.log(`${view.padEnd(13)} ${cell(stats.jacket, 7)} ${cell(stats.trousers, 8)}`
    + ` ${cell(stats.skin, 6)} ${cell(stats.wing, 6)}`);
}
await browser.close();
server.close();
console.log(`\nwrote ${views.length} images to ${OUT}`);

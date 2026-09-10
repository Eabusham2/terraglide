/**
 * Photograph a GLB by itself.
 *
 *   node tools/rawmodel.mjs [--src=assets/player.glb] [--tag=NAME] [--size=1400]
 *
 * Ten views round the model and four close-ups, plus what the file actually
 * contains. See tools/rawmodel.html for why this exists separately from
 * tools/model.mjs: that one photographs the rig, this one photographs the
 * asset, and telling those two apart is the whole point.
 */
import { writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';

const ROOT = new URL('..', import.meta.url).pathname;
// Under shots/raw, which is not tracked: these are working comparisons of
// candidate files — several sets of fourteen 1400-pixel renders per session —
// and the repo carries the finished views in shots/ instead.
const OUT = join(ROOT, 'shots', 'raw');
await mkdir(OUT, { recursive: true });

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const src = arg('src', 'assets/player.glb');
const tag = arg('tag', 'raw');
const size = Number(arg('size', '1400'));
// Flat white instead of the atlas: a crease in the mesh and a line painted on
// it look the same through the photograph and want opposite repairs.
const plain = process.argv.includes('--plain');
// Bilinear off, to tell a line in the picture from a line the filtering makes.
const nearest = process.argv.includes('--nearest');
// Texture coordinates as colour, so a mark on screen can be looked up in the atlas.
const showUV = process.argv.includes('--uv');
// Position as colour, to read off where a pixel is on the body.
const showXYZ = process.argv.includes('--xyz');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    // Anything under the repo, plus the scratch files that never belong in it.
    const base = path.startsWith('/tmp/') ? '/' : ROOT;
    const body = await readFile(join(base, path));
    const dot = path.slice(path.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': TYPES[dot] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('no'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const PORT = server.address().port;

const base = '/opt/pw-browsers';
let chrome;
for (const entry of await readdir(base)) {
  if (entry.startsWith('chromium-')) chrome = join(base, entry, 'chrome-linux', 'chrome');
}
const { chromium } = await import('playwright');
const browser = await chromium.launch({
  executablePath: chrome,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: size, height: size } });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
const url = src.startsWith('/') ? src : `/${src}`;
await page.goto(`http://127.0.0.1:${PORT}/tools/rawmodel.html`
  + `?src=${encodeURIComponent(url)}&size=${size}${plain ? '&plain=1' : ''}${nearest ? '&filter=nearest' : ''}${showUV ? '&uv=1' : ''}${showXYZ ? '&xyz=1' : ''}`,
  { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });

console.log(`${src}`);
console.log('bounds', JSON.stringify(await page.evaluate(() => window.__bounds)));
for (const part of await page.evaluate(() => window.__parts)) {
  console.log(`  ${part.name.padEnd(18)} ${String(Math.round(part.triangles)).padStart(7)} tri`
    + ` ${String(part.vertices).padStart(7)} vtx  [${part.attributes.join(' ')}]`
    + `  ${part.material}${part.map ? ` map ${part.map}` : ' NO MAP'}`);
}

// Round it, then down at it, then up at it. Bearing 180 faces the model's -Z,
// which is the side a character generator puts a face on.
const views = [
  ['front', 180, 0], ['front-3q', 145, 8], ['side', 90, 0], ['back-3q', 35, 8],
  ['back', 0, 0], ['other-side', 270, 0],
  ['above', 180, 60], ['below', 180, -55], ['plan', 180, 89], ['under', 180, -89],
];
// `--views=back,side` shoots only those, which is what iterating on one repair
// wants: fourteen 1400-pixel renders is three minutes a go.
const only = arg('views', '').split(',').filter(Boolean);
for (const [name, bearing, elevation] of views.filter((v) => !only.length || only.includes(v[0]))) {
  await page.evaluate(([b, e]) => window.__view(b, e), [bearing, elevation]);
  await page.waitForTimeout(120);
  await writeFile(join(OUT, `${tag}-${name}.png`), await page.screenshot());
}
// And the places every complaint has been about: the face, the hands, the
// feet from underneath, and the back where the wings meet the jacket.
const close = [
  ['face', 180, -5, [0.5, 0.93, 0.5], 0.28],
  ['hands', 200, -10, [0.5, 0.55, 0.5], 0.55],
  ['soles', 180, -80, [0.5, 0.04, 0.5], 0.3],
  ['wings', 20, 20, [0.5, 0.72, 0.5], 0.6],
  // Down onto the back of the neck. A collar's join is on top of the shoulder,
  // so a camera at eye level sees the collar's outside and nothing of what is
  // or is not under it.
  ['nape', 180, 12, [0.5, 0.80, 0.5], 0.30],
  // Straight side-on and level, so up on the screen is up on the figure and
  // there is no projection to reason about when asking what is above what.
  ['collar-side', 90, 0, [0.5, 0.775, 0.5], 0.26],
  ['nape20', 180, 20, [0.5, 0.80, 0.5], 0.30],
  ['nape30', 180, 30, [0.5, 0.80, 0.5], 0.32],
  ['nape45', 180, 45, [0.5, 0.80, 0.5], 0.34],
  ['nape60', 180, 60, [0.5, 0.80, 0.5], 0.36],
];
for (const [name, bearing, elevation, at, wide] of close.filter((v) => !only.length || only.includes(v[0]))) {
  await page.evaluate(([b, e, a, w]) => window.__closeup(b, e, a, w), [bearing, elevation, at, wide]);
  await page.waitForTimeout(120);
  await writeFile(join(OUT, `${tag}-${name}.png`), await page.screenshot());
}
await browser.close();
server.close();
console.log(`\nwrote ${views.length + close.length} images to ${OUT} as ${tag}-*.png`);

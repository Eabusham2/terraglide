import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
const ROOT = '/home/user/terraglide/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('no'); }
});
await new Promise((d) => server.listen(0, '127.0.0.1', d));
const PORT = server.address().port;
let chrome;
for (const e of await readdir('/opt/pw-browsers')) {
  if (e.startsWith('chromium-')) chrome = join('/opt/pw-browsers', e, 'chrome-linux', 'chrome');
}
const { chromium } = await import('playwright');
const browser = await chromium.launch({ executablePath: chrome,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/tools/model.html?scan`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
console.log(JSON.stringify(await page.evaluate(() => {
  const a = window.__avatar;
  const names = a.scanBoneList.map((b, i) => i);
  const joint = Object.keys(a.scanBones).find((k) => a.scanBones[k] === a.scanBones.head);
  const headIndex = a.scanBoneList.indexOf(a.scanBones.head);
  const own = [];
  for (const skin of a.scanSkins) {
    const p = skin.geometry.getAttribute('position');
    const ix = skin.geometry.getAttribute('skinIndex');
    const wt = skin.geometry.getAttribute('skinWeight');
    for (let v = 0; v < p.count; v += 1) {
      let best = -1, most = 0;
      for (let k = 0; k < 4; k += 1) {
        if (wt.getComponent(v, k) > most) { most = wt.getComponent(v, k); best = ix.getComponent(v, k); }
      }
      if (best === headIndex && most >= 0.6) own.push([p.getX(v), p.getY(v), p.getZ(v)]);
    }
  }
  const mid = own.reduce((s, q) => [s[0] + q[0], s[1] + q[1], s[2] + q[2]], [0, 0, 0]).map((n) => n / own.length);
  let radius = 0;
  for (const q of own) radius += Math.hypot(q[0] - mid[0], q[1] - mid[1], q[2] - mid[2]);
  radius /= own.length;
  const top = Math.max(...own.map((q) => q[1]));
  const bottom = Math.min(...own.map((q) => q[1]));
  const wide = Math.max(...own.map((q) => q[0])) - Math.min(...own.map((q) => q[0]));
  // Where the drawn pieces actually ended up, in the head joint's frame.
  const pieces = a.scanFace.children.map((c) => {
    c.geometry.computeBoundingBox();
    const b = c.geometry.boundingBox;
    const at = new window.__Vec3();
    c.getWorldPosition(at);
    return { y: Number((c.position.y).toFixed(4)), x: Number(c.position.x.toFixed(4)) };
  });
  return {
    headVertices: own.length,
    middle: mid.map((n) => Number(n.toFixed(4))),
    radius: Number(radius.toFixed(4)),
    headTop: Number(top.toFixed(4)), headBottom: Number(bottom.toFixed(4)),
    headWidth: Number(wide.toFixed(4)),
    facePieces: pieces,
  };
}), null, 1));
await browser.close(); server.close();

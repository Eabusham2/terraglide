import { createServer } from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const ROOT = '/home/user/terraglide/';
const TAG = process.argv[2] ?? 'x';
const TYPES = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary' };
const server = createServer(async (req,res)=>{ const p=decodeURIComponent(new URL(req.url,'http://x').pathname);
  try{ const b=await readFile(join(ROOT,p)); res.writeHead(200,{'content-type':TYPES[p.slice(p.lastIndexOf('.'))]??'application/octet-stream'}); res.end(b);}catch{res.writeHead(404).end('no');}});
await new Promise(d=>server.listen(0,'127.0.0.1',d));
const PORT=server.address().port;
let chrome; for (const e of await readdir('/opt/pw-browsers')) if (e.startsWith('chromium-')) chrome=join('/opt/pw-browsers',e,'chrome-linux','chrome');
const { chromium } = await import('playwright');
const browser = await chromium.launch({ executablePath: chrome, args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport:{width:1000,height:1000} });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/tools/model.html?scan&size=1000`,{waitUntil:'load'});
await page.waitForFunction(()=>window.__ready===true,null,{timeout:120000});
await page.evaluate(()=>window.__pose('stand-front'));
await page.waitForTimeout(100);
for (const [tag,t,h,at,d] of [['under',25,-0.28,0.12,0.85],['low',55,-0.16,0.11,0.9],['side',90,0.16,0.10,0.95]]) {
  await page.evaluate(([a,b,c,e])=>window.__around(a, e, b, c), [t, h, at, d]);
  await page.waitForTimeout(100);
  await writeFile(`/tmp/tg/w-${TAG}-${tag}.png`, await page.screenshot());
}
await browser.close(); server.close();
console.log('done', TAG);

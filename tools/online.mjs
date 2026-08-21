#!/usr/bin/env node
/**
 * Builds the online single-file page.
 *
 * There are two ways to have TerraGlide in one file and they are opposites.
 * `tools/bundle.mjs` inlines everything — two and a half megabytes, works with
 * no network at all, and is the right answer for a plane or a locked-down
 * machine. This one inlines nothing: a kilobyte of markup that loads the
 * modules, the stylesheet and the textures from the published site. It is the
 * right answer when you want a file you can email, drop on a desktop or paste
 * into a wiki and have it always be the current version, and when you want the
 * photorealistic 3D route, which the offline bundle cannot carry because that
 * needs a module loader.
 *
 * The trick that makes it work is that a module's relative imports resolve
 * against the module's own address, not the document's. Point one `<script
 * type="module">` at the published `src/main.js` and the other sixty modules
 * follow it home on their own. Two places needed help: the tile worker, which
 * has to be same-origin and is given a blob shim (`src/tiles/workerHost.js`),
 * and the textures, which are found relative to the module rather than the page
 * (`src/core/paths.js`).
 *
 *   node tools/online.mjs                       -> the published site
 *   node tools/online.mjs https://example.com/  -> somewhere else
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_BASE = 'https://eabusham2.github.io/terraglide/';
const base = (process.argv[2] ?? DEFAULT_BASE).replace(/\/*$/, '/');
const OUT = process.argv[3] ?? join(ROOT, 'terraglide-online.html');

const html = await readFile(join(ROOT, 'index.html'), 'utf8');

// Take the body markup from index.html rather than keeping a second copy of it:
// the HUD, the boot panel and the canvas ids are all load-bearing, and two
// copies of load-bearing markup is one copy too many.
const body = html
  .replace(/[\s\S]*<body>/, '')
  .replace(/<\/body>[\s\S]*/, '')
  .replace(/\s*<script[\s\S]*?<\/script>/g, '')
  .trim();

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>TerraGlide</title>
<!--
  TerraGlide, online edition. Everything below the fold comes from
  ${base}
  so this file never goes stale and never needs rebuilding. It needs a network;
  for a copy that does not, use terraglide.html from the same place.

  Change the two URLs below to point at your own mirror. TerraGlide by
  Eabusham2 — https://github.com/eabusham2/terraglide
-->
<link rel="stylesheet" href="${base}styles/main.css">
</head>
<body>
${body}
<script type="module" src="${base}src/main.js"></script>
</body>
</html>
`;

await writeFile(OUT, page);
const kb = (Buffer.byteLength(page) / 1024).toFixed(1);
console.log(`wrote ${OUT.replace(`${ROOT}/`, '')} — ${kb} KB, loading from ${base}`);

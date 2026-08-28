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

// The online edition *is* index.html with three URLs made absolute.
//
// It used to be a second copy of the page, rebuilt from index.html's body with
// every `<script>` stripped out. That threw away the boot watchdog along with
// the module tag, so the one page most likely to fail — it depends on a remote
// host being reachable — was the only one that could not say so, and a failure
// showed as "Starting engine…" for ever. It also quietly dropped the favicon,
// the description and the colour-scheme hint, which is the rest of "the single
// file is missing things".
//
// Rewriting instead of rebuilding means the two can never drift again: whatever
// index.html grows next, this has it.
const page = html
  .replace('href="./styles/main.css"', `href="${base}styles/main.css"`)
  .replace('src="./src/main.js"', `src="${base}src/main.js"`)
  // The offline bundle the watchdog offers is not next to this file — this file
  // could be anywhere. Point at the published copy.
  .replace(/"\.\/terraglide\.html"/g, `"${base}terraglide.html"`)
  .replace(
    '<head>',
    `<head>
    <!--
      TerraGlide, online edition. Everything the page needs comes from
      ${base}
      so this file never goes stale and never needs rebuilding. It needs a
      network; for a copy that does not, use terraglide.html from the same
      place.

      Change the URLs below to point at your own mirror. TerraGlide by
      Eabusham2 — https://github.com/eabusham2/terraglide
    -->`,
  );

for (const [what, needle] of [
  ['the stylesheet', `${base}styles/main.css`],
  ['the module entry', `${base}src/main.js`],
  ['the offline bundle link', `${base}terraglide.html`],
  ['the boot watchdog', 'Could not start'],
  ['the favicon', 'rel="icon"'],
]) {
  if (!page.includes(needle)) throw new Error(`online build lost ${what} — index.html changed shape`);
}
if (page.includes('"./src/') || page.includes('"./styles/')) {
  throw new Error('online build left a relative path behind');
}

await writeFile(OUT, page);
const kb = (Buffer.byteLength(page) / 1024).toFixed(1);
console.log(`wrote ${OUT.replace(`${ROOT}/`, '')} — ${kb} KB, loading from ${base}`);

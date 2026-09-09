#!/usr/bin/env node
/**
 * Builds `terraglide.html`: the whole game in one file you can download and open
 * by double-clicking, with no server and no install.
 *
 * Browsers refuse to load ES modules over file://, so every module — including
 * the vendored three.js — is rewritten into a tiny registry of functions and
 * concatenated into a single classic script. The stylesheet is inlined too, and
 * a flag tells the tile worker to run in the page, because file:// cannot start
 * a worker either.
 *
 * The transform only has to cope with the import/export forms this project and
 * three.js actually use, which is why it is fifty lines rather than a compiler.
 *
 *   node tools/bundle.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ENTRY = join(ROOT, 'src/main.js');
const OUT = join(ROOT, 'terraglide.html');

const modules = new Map(); // id -> transformed source
const order = [];

const IMPORT_NS = /^import\s+\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"];?\s*$/;
const IMPORT_NAMED = /^import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"];?\s*$/;
const REEXPORT = /^export\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"];?\s*$/;
const EXPORT_LIST = /^export\s+\{([\s\S]*?)\};?\s*$/;
const EXPORT_DECL = /^export\s+(async\s+function|function|class|const|let|var)\s+([A-Za-z0-9_$]+)/;

/**
 * Collapse `import {\n a,\n b\n} from '...'` (and the export equivalents) into
 * a single line. Only touches statements that start a line, so a method called
 * `import` or a string containing the word is left alone.
 */
function joinStatements(source) {
  const lines = source.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(import|export)\s*\{\s*$/.test(line) || /^(import|export)\s+\{[^}]*$/.test(line)) {
      const parts = [line.trimEnd()];
      while (i + 1 < lines.length && !parts.join(' ').includes('}')) {
        i++;
        parts.push(lines[i].trim());
      }
      // Pick up the `from '...'` tail if it sits on its own line.
      while (i + 1 < lines.length && !/from\s+['"][^'"]+['"]/.test(parts.join(' '))) {
        i++;
        parts.push(lines[i].trim());
      }
      out.push(parts.join(' ').replace(/\s+/g, ' '));
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function idFor(path) {
  return relative(ROOT, path).split('\\').join('/');
}

function splitNames(list) {
  return list
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [from, to] = part.split(/\s+as\s+/).map((x) => x.trim());
      return { from, to: to ?? from };
    });
}

async function load(path) {
  const id = idFor(path);
  if (modules.has(id)) return id;
  modules.set(id, null); // reserve, so a cycle cannot loop forever

  const source = await readFile(path, 'utf8');
  // Join multi-line import/export statements onto one line first, so the
  // matchers below only ever see a whole statement.
  const lines = joinStatements(source).split('\n');
  const out = [];
  const exported = [];
  const deps = [];

  for (const line of lines) {
    let match;

    if ((match = line.match(IMPORT_NS))) {
      const dep = await load(resolve(dirname(path), match[2]));
      deps.push(dep);
      out.push(`const ${match[1]} = __tg_require(${JSON.stringify(dep)});`);
      continue;
    }

    if ((match = line.match(IMPORT_NAMED))) {
      const dep = await load(resolve(dirname(path), match[2]));
      deps.push(dep);
      const names = splitNames(match[1])
        .map((n) => (n.from === n.to ? n.from : `${n.from}: ${n.to}`))
        .join(', ');
      out.push(`const { ${names} } = __tg_require(${JSON.stringify(dep)});`);
      continue;
    }

    if ((match = line.match(REEXPORT))) {
      const dep = await load(resolve(dirname(path), match[2]));
      deps.push(dep);
      const local = `__tg_re${out.length}`;
      out.push(`const ${local} = __tg_require(${JSON.stringify(dep)});`);
      for (const n of splitNames(match[1])) {
        out.push(`__tg_exports[${JSON.stringify(n.to)}] = ${local}[${JSON.stringify(n.from)}];`);
      }
      continue;
    }

    if ((match = line.match(EXPORT_LIST))) {
      for (const n of splitNames(match[1])) exported.push([n.to, n.from]);
      continue;
    }

    if ((match = line.match(EXPORT_DECL))) {
      exported.push([match[2], match[2]]);
      out.push(line.replace(/^export\s+/, ''));
      continue;
    }

    out.push(line);
  }

  // Bindings are published after the body runs, so multi-line declarations and
  // hoisting both behave.
  for (const [name, local] of exported) {
    out.push(`__tg_exports[${JSON.stringify(name)}] = ${local};`);
  }

  let body = out.join('\n');
  // `import.meta` is a syntax error in a classic script, so it becomes the
  // module's own address — computed from its path, not the document's.
  //
  // It used to be the document's address for every module alike. That was
  // enough while the only consumer was the double-clickable build, where the
  // in-page worker flag means nobody asks for a worker URL and Three's Draco
  // loader only needs *a* valid base (an empty string is not one: `new URL(x,
  // '')` throws, and Draco builds three at module scope, so an empty base
  // turned the whole module into an exception the moment it was required).
  //
  // The hosted bundle does ask. `createTileWorker` resolves './tileWorker.js'
  // against this, and from the document's address that is
  // <site>/tileWorker.js, which does not exist — a worker that 404s silently
  // and a tile pipeline that never starts. From the module's own address it is
  // <site>/src/tiles/tileWorker.js, which is where the file is.
  body = body.replace(/import\.meta\.url/g, `__tg_url(${JSON.stringify(id)})`);

  modules.set(
    id,
    `__tg_modules[${JSON.stringify(id)}] = function (__tg_exports) {\n${body}\n};`,
  );
  order.push(id);
  return id;
}

/**
 * Modules the entry never statically imports, and which therefore have to be
 * named here or they simply are not in the file.
 *
 * They are loaded with `await import()` at runtime so that a player who never
 * turns them on never downloads them, which is right for the served copy and
 * impossible in a single one: there is no module loader behind a file:// URL
 * to resolve the specifier with. The bundle registers them under their own ids
 * and hands the page a resolver, so the same call finds them without a network.
 *
 * This is what used to make the one-file build say "photorealistic 3D is not
 * in the single-file build" — which read, reasonably, as the feature being
 * make-believe rather than as a packaging limitation.
 */
const DYNAMIC = [
  'src/world/tiles3d.js',
  'vendor/three/loaders/GLTFLoader.js',
];

const entryId = await load(ENTRY);
for (const id of DYNAMIC) await load(join(ROOT, id));
const css = await readFile(join(ROOT, 'styles/main.css'), 'utf8');
const html = await readFile(join(ROOT, 'index.html'), 'utf8');

const title = 'TerraGlide';
const body = html
  .replace(/[\s\S]*<body>/, '')
  .replace(/<\/body>[\s\S]*/, '')
  .replace(/\s*<script[\s\S]*?<\/script>/g, '');

const runtime = `
var __tg_modules = {};
var __tg_cache = {};
// Stands in for import.meta.url, which a classic script has no equivalent of.
//
// Where the *bundle* came from, not where the page is. Those are the same
// thing for the offline one-file build, and they are not the same thing for the
// online one: that page is a small local file and the bundle it pulls in comes
// from the published site. Resolving against the document there sent every
// module-relative path — the assets folder, the Draco decoder — at the folder
// beside a file:// page, which does not exist. Measured: the player model never
// loaded in the online edition, and the console said so, with
// assets/manifest.json fetched from file:// and blocked by CORS.
//
// document.currentScript is the script being executed, which is this one, and
// it carries the URL it was fetched from. An inlined bundle has no src, and
// falls back to the document as before.
var __tg_base = (function () {
  try {
    var self = document.currentScript;
    if (self && self.src) return self.src;
  } catch (e) { /* no document, or no currentScript: fall through */ }
  return (typeof document !== 'undefined' && document.baseURI) || 'about:blank';
})();
// Each module's own address, so anything resolving a path against it lands
// where the file actually is rather than beside the page.
function __tg_url(id) {
  try { return new URL(id, __tg_base).href; } catch (e) { return __tg_base; }
}
function __tg_require(id) {
  var cached = __tg_cache[id];
  if (cached) return cached.exports;
  var module = { exports: {} };
  __tg_cache[id] = module;
  var factory = __tg_modules[id];
  if (!factory) throw new Error('missing module ' + id);
  factory(module.exports);
  return module.exports;
}
`;

const bundle = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
<meta name="color-scheme" content="dark light" />
<title>${title}</title>
<!--
  Single-file build of TerraGlide. Everything is inlined so it runs by opening
  this file directly, with no server and nothing installed. Rebuild it with
  \`node tools/bundle.mjs\`.

  Covered by the TerraGlide Restricted Source Licence: private use only, no
  redistribution, no commercial use, no re-publishing map data. Map providers
  keep their own terms.
-->
<style>
${css}
</style>
</head>
<body>
${body}
<script>
// file:// cannot start a Web Worker, so tile jobs run in the page here.
window.__TERRAGLIDE_INLINE_WORKER__ = true;
${runtime}
${order.map((id) => modules.get(id)).join('\n')}
// Everything the game loads on demand is in here too. Code that would say
// \`await import('./world/tiles3d.js')\` asks this instead when it exists, so
// the on-demand features are on-demand rather than absent.
window.__TERRAGLIDE_REQUIRE__ = function (id) {
  var path = String(id);
  while (path.indexOf('../') === 0) path = path.slice(3);
  if (path.indexOf('./') === 0) path = path.slice(2);
  return __tg_require(path);
};
__tg_require(${JSON.stringify(entryId)});
</script>
</body>
</html>
`;

// A fingerprint of the sources this was built from, so a bundle that has gone
// stale can be caught rather than shipped. The single file is the artefact this
// project tells people to double-click; nothing checked that it still matched
// src, so editing a module and forgetting to rebuild shipped the old game.
const stamp = createHash('sha256');
// Hashed from the files on disk rather than from the transformed text, so the
// self test can recompute exactly the same thing from src without having to
// reproduce the transform.
for (const id of [...order].sort()) {
  stamp.update(id).update('\u0000').update(await readFile(join(ROOT, id), 'utf8'));
}
const fingerprint = stamp.digest('hex').slice(0, 16);
const stamped = bundle.replace('<head>', `<head>\n<meta name="terraglide-sources" content="${fingerprint}">`);
await writeFile(OUT, stamped);
const kb = Math.round(Buffer.byteLength(stamped) / 1024);
console.log(`wrote ${relative(ROOT, OUT)} — ${order.length} modules, ${kb} KB, sources ${fingerprint}`);

/*
  The same modules again, as one script for the hosted page.

  index.html asked the browser for seventy-seven separate ES modules, and a
  browser does not retry a module fetch that fails. So one dropped response —
  one flaky moment on wifi — ended the boot for good, with the screen still
  reading "Starting engine...". Measured, dropping requests at random:

    perfect connection    booted 3 of 3, in 2.3 s
    0.5 per cent dropped  booted 2 of 3
    1 per cent dropped    booted 0 of 3
    2 per cent dropped    booted 0 of 3
    5 per cent dropped    booted 0 of 3

  One per cent loss is an ordinary evening on home wifi, and it takes down
  every machine on that network at once, whatever the operating system or
  browser — which is the report that came back from seven of them.

  So the page loads this instead: one request rather than seventy-seven, and
  because it is a classic script the page can watch it fail and ask again,
  which is the thing the module loader will not do. No CSS or assets are
  inlined — those sit beside it on the server — so it is a fraction of the
  size of the double-clickable build.
*/
const JS_OUT = join(ROOT, 'terraglide.bundle.js');
const script = `/*
 TerraGlide, built from src/ by \`node tools/bundle.mjs\`. Do not edit.
 sources ${fingerprint}
*/
${runtime}
${order.map((id) => modules.get(id)).join('\n')}
window.__TERRAGLIDE_REQUIRE__ = function (id) {
  var path = String(id);
  while (path.indexOf('../') === 0) path = path.slice(3);
  if (path.indexOf('./') === 0) path = path.slice(2);
  return __tg_require(path);
};
window.__TERRAGLIDE_BUNDLE__ = ${JSON.stringify(fingerprint)};
__tg_require(${JSON.stringify(entryId)});
`;
await writeFile(JS_OUT, script);
console.log(`wrote ${relative(ROOT, JS_OUT)} — ${Math.round(Buffer.byteLength(script) / 1024)} KB, one request instead of ${order.length}`);

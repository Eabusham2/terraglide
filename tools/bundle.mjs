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
  // `import.meta` is a syntax error in a classic script; nothing in the bundle
  // reaches for a worker URL because the inline flag is set.
  //
  // The document's own address rather than an empty string, because an empty
  // string is not a valid base and `new URL(path, '')` throws. Three's Draco
  // loader builds three of those at module scope, so the empty string turned
  // the whole module into an exception the moment it was required — which is
  // exactly the module the photorealistic tiles need.
  body = body.replace(/import\.meta\.url/g, '__tg_base');

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
var __tg_base = (typeof document !== 'undefined' && document.baseURI) || 'about:blank';
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

await writeFile(OUT, bundle);
const kb = Math.round(Buffer.byteLength(bundle) / 1024);
console.log(`wrote ${relative(ROOT, OUT)} — ${order.length} modules, ${kb} KB`);

#!/usr/bin/env node
/**
 * Cheap sanity pass over the source: parse every module, make sure every
 * relative import points at a file that exists, and flag imports of names a
 * module does not export. No dependencies, no build step — just enough to catch
 * the mistakes that would otherwise only show up as a blank screen.
 *
 *   node tools/check.mjs
 */

import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = join(ROOT, 'src');

const problems = [];
const exportsByFile = new Map();

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (extname(entry.name) === '.js') out.push(full);
  }
  return out;
}

const IMPORT_RE = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
const EXPORT_NAMED_RE = /export\s+(?:const|let|var|function|class|async function)\s+([A-Za-z0-9_$]+)/g;
const EXPORT_LIST_RE = /export\s*\{([^}]*)\}/g;

function collectExports(source) {
  const names = new Set();
  let match;
  while ((match = EXPORT_NAMED_RE.exec(source))) names.add(match[1]);
  while ((match = EXPORT_LIST_RE.exec(source))) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name.trim());
    }
  }
  if (/export\s+default/.test(source)) names.add('default');
  return names;
}

function parseImportClause(clause) {
  const named = [];
  const braces = clause.match(/\{([^}]*)\}/);
  if (braces) {
    for (const part of braces[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0];
      if (name) named.push(name.trim());
    }
  }
  const namespace = /\*\s+as\s+/.test(clause);
  return { named, namespace };
}

const files = await walk(SRC);

// Pass 1: parse each file and record what it exports.
for (const file of files) {
  const source = await readFile(file, 'utf8');
  exportsByFile.set(file, collectExports(source));
  // Actually parse it. This used to build a `new Function` wrapping a dynamic
  // import, which only ever checked that the *wrapper* was valid JavaScript —
  // the import was never awaited, so the module itself was never read. It
  // reported 56 modules clean over a file with a stray `else`.
  //
  // `node --check` parses without executing, which is what we want: no DOM
  // needed, and the package is type: module so these are read as ESM.
  const parse = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (parse.status !== 0) {
    const detail = (parse.stderr || '').split('\n').find((l) => l.includes('Error')) ?? 'parse failed';
    problems.push(`${relative(ROOT, file)}: ${detail.trim()}`);
  }
}

// Pass 2: resolve imports.
for (const file of files) {
  const source = await readFile(file, 'utf8');
  let match;
  while ((match = IMPORT_RE.exec(source))) {
    const [, clause, specifier] = match;
    if (!specifier.startsWith('.')) {
      problems.push(`${relative(ROOT, file)}: bare import "${specifier}" (everything must be relative)`);
      continue;
    }
    const target = resolve(dirname(file), specifier);
    if (!existsSync(target)) {
      problems.push(`${relative(ROOT, file)}: imports missing file "${specifier}"`);
      continue;
    }
    const { named, namespace } = parseImportClause(clause);
    if (namespace || !exportsByFile.has(target)) continue;
    const available = exportsByFile.get(target);
    for (const name of named) {
      if (!available.has(name)) {
        problems.push(
          `${relative(ROOT, file)}: imports { ${name} } from "${specifier}", which does not export it`,
        );
      }
    }
  }
}

// Pass 3: the entry points the page actually loads must exist.
for (const required of ['index.html', 'src/main.js', 'styles/main.css', 'vendor/three/three.module.js']) {
  if (!existsSync(join(ROOT, required))) problems.push(`missing required file: ${required}`);
}

if (problems.length > 0) {
  console.error(`${problems.length} problem(s):\n`);
  for (const problem of problems) console.error('  - ' + problem);
  process.exit(1);
}

console.log(`checked ${files.length} modules — no problems found`);

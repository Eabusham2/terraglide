// Which lines of REL were directly seen (any numbered view) in [since, until): prints ranges, and with a draft,
// checks each seen line against it.
import { readFileSync } from 'node:fs';
import { fragments, loadRows } from './frags.mjs';
import { grepNumbered } from './runs.mjs';
const [rel, since, until = '2026-10-12T20:03', draft] = process.argv.slice(2);
const rows = loadRows();
const fr = [...fragments(rows, rel), ...grepNumbered(rows, rel)].filter((f) => f.t >= since && f.t < until && !f.hyps);
const seen = new Map();
for (const f of fr.sort((a, b) => (a.t < b.t ? 1 : -1))) for (const [n, t] of f.lines) if (!seen.has(n)) seen.set(n, t);
const ns = [...seen.keys()].sort((a, b) => a - b);
const ranges = []; for (const n of ns) { const r = ranges.at(-1); if (r && n === r[1] + 1) r[1] = n; else ranges.push([n, n]); }
console.log(ns.length, 'lines seen:', ranges.map(([a, b]) => (a === b ? a : a + '-' + b)).join(' '));
if (draft) {
  const D = readFileSync(draft, 'utf8').split('\n');
  for (const n of ns) if (D[n - 1] !== seen.get(n)) console.log('DIFF', n, JSON.stringify(D[n - 1]).slice(0, 90), '| seen', JSON.stringify(seen.get(n)).slice(0, 90));
}

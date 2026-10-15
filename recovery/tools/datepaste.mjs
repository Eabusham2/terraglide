// When was a pasted file's version current? Compare it with every numbered sighting of the file.
// Prints, per sighting time, how many sighted lines the paste has at the same number (exact) and how
// many it has at some offset (shifted), so copy-paste drops and duplicates show as offset changes.
import { readFileSync } from 'node:fs';
import { fragments, loadRows } from './frags.mjs';
import { grepNumbered } from './runs.mjs';
const [paste, rel, mode] = process.argv.slice(2);
const P = readFileSync(paste, 'utf8').replace(/\r/g, '').split('\n');
const rows = loadRows();
const fr = [...fragments(rows, rel), ...grepNumbered(rows, rel)].filter((f) => f.lines.size >= 3).sort((a, b) => a.t < b.t ? -1 : 1);
const idx = new Map(); P.forEach((l, i) => { if (!idx.has(l)) idx.set(l, []); idx.get(l).push(i + 1); });
let lastKey = '';
const out = [];
for (const f of fr) {
  let exact = 0, shifted = 0, none = 0; const offs = {};
  for (const [n, t] of f.lines) {
    if (P[n - 1] === t) { exact++; continue; }
    const at = idx.get(t); if (at && t.trim().length > 8) { shifted++; const o = at.reduce((b, x) => Math.abs(x - n) < Math.abs(b - n) ? x : b) - n; offs[o] = (offs[o] ?? 0) + 1; } else none++;
  }
  const tot = f.lines.size;
  out.push({ t: f.t.slice(5, 16), exact, shifted, none, tot, offs, src: f.src, range: `${Math.min(...f.lines.keys())}-${Math.max(...f.lines.keys())}` });
}
for (const o of out) if (mode === 'all' || o.exact / o.tot > 0.5 || o.shifted / o.tot > 0.5) console.log(o.t, `${o.range.padEnd(10)} exact ${o.exact}/${o.tot} shifted ${o.shifted} none ${o.none}`, Object.keys(o.offs).length ? 'offsets ' + JSON.stringify(o.offs) : '', o.src);
const first = out.find((o) => o.exact / o.tot > 0.9), last = [...out].reverse().find((o) => o.exact / o.tot > 0.9);
console.log(`paste ${paste.split('/').pop()} (${P.length} lines) vs ${rel}: ${out.length} sightings; >90% exact from ${first?.t} to ${last?.t}`);

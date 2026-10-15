// Which rebuilt files are ready to install: nothing missing, no conflicts in the final version, every view in its
// final window agrees, and no view after its last count shows a line past that count.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadRows, fragments } from './frags.mjs';
import { grepNumbered } from './runs.mjs';
const rows = loadRows();
const files = process.argv.slice(2);
for (const rel of files) {
  const k = rel.replace(/\//g, '_'); const o = `out/chain/${k}`;
  if (!existsSync(o)) { console.log(rel, 'no output'); continue; }
  const L = readFileSync(o, 'utf8').split('\n'); if (L.at(-1) === '') L.pop();
  const missing = L.filter((l) => /^@@MISSING \d+@@$/.test(l)).length;
  const spec = JSON.parse(readFileSync(`specs/${k}.safe.chain.json`, 'utf8')); const last = spec.versions.at(-1);
  const fr = [...fragments(rows, rel), ...grepNumbered(rows, rel)].filter((f) => f.t >= last.from && !f.hyps);
  let bad = 0, beyond = 0; const eg = [];
  for (const f of fr) { for (const [n, t] of f.lines) { if (n > L.length) { beyond++; continue; } if (L[n - 1] !== t && !/^@@MISSING/.test(L[n - 1])) { bad++; if (eg.length < 2) eg.push(`${f.t.slice(5, 16)} ${n}: ${JSON.stringify(t).slice(0, 60)} vs ${JSON.stringify(L[n - 1]).slice(0, 60)}`); } } }
  // a view after the last count record that reaches past the count
  const later = [...fragments(rows, rel), ...grepNumbered(rows, rel)].filter((f) => f.t >= last.from);
  const maxSeen = Math.max(0, ...later.flatMap((f) => [...f.lines.keys()]));
  const ok = !missing && !bad && !beyond && maxSeen <= L.length;
  console.log((ok ? 'READY ' : '      ') + rel.padEnd(30), 'lines', L.length, 'missing', missing, 'final-window views', fr.length, 'disagree', bad, beyond ? `beyond-end ${beyond}` : '', eg.join(' | '));
}

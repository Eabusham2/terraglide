// Check a candidate file against every numbered sighting of the repo file (optionally after a time).
// Usage: node verify.mjs <rel> <candidate> [since] [until]
import { readFileSync } from 'node:fs';
import { fragments, loadRows } from './frags.mjs';
import { grepNumbered } from './runs.mjs';
const [rel, cand, since = '', until = '9'] = process.argv.slice(2);
const C = readFileSync(cand, 'utf8').split('\n'); if (C.at(-1) === '') C.pop();
const rows = loadRows();
const fr = [...fragments(rows, rel), ...grepNumbered(rows, rel)].filter((f) => f.t >= since && f.t < until).sort((a, b) => (a.t < b.t ? -1 : 1));
let bad = 0;
for (const f of fr) {
  const maps = f.hyps ?? [f.lines];
  const res = maps.map((m) => { let ok = 0; const miss = []; for (const [n, t] of m) { if (C[n - 1] === t) ok++; else miss.push(n); } return { ok, miss, size: m.size }; });
  const best = res.reduce((a, b) => (b.miss.length < a.miss.length ? b : a));
  if (best.miss.length) bad++;
  console.log(f.t.slice(5, 19), f.agent.slice(0, 6), f.src.padEnd(26), `${best.ok}/${best.size}`, best.miss.length ? 'MISMATCH at ' + best.miss.slice(0, 8).join(',') + ' e.g. ' + JSON.stringify((f.hyps ? maps[res.indexOf(best)] : f.lines).get(best.miss[0])).slice(0, 90) + ' | have ' + JSON.stringify(C[best.miss[0] - 1] ?? null).slice(0, 60) : 'ok');
}
console.log(`${rel}: ${fr.length} sightings, ${bad} with mismatches; candidate ${C.length} lines`);

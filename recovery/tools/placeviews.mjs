// Place every numbered view of REL onto a draft of the final by content: a run of consecutive view lines whose
// lines agree with the draft's known lines at one offset (>= MIN anchors, no conflicts) fills the draft's gaps
// between its anchors (both sides anchored = 'inside'; one side = 'edge', reported but only used with --edge).
// usage: node placeviews.mjs REL DRAFT OUT [--since=ISO] [--edge] [--min=N]
import { readFileSync, writeFileSync } from 'node:fs';
import { fragments, loadRows } from './frags.mjs';
const [rel, draftPath, outPath] = process.argv.slice(2);
const opt = Object.fromEntries(process.argv.slice(5).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const MIN = Number(opt.min ?? 3); const since = opt.since ?? '';
const D = readFileSync(draftPath, 'utf8').split('\n'); if (D.at(-1) === '') D.pop();
const M = (l) => /^@@MISSING \d+@@$/.test(l);
const fr = fragments(loadRows(), rel).filter((f) => f.t >= since && f.lines.size);
// index of known draft lines by text
const byText = new Map();
D.forEach((l, i) => { if (!M(l) && l.trim().length > 3) { if (!byText.has(l)) byText.set(l, []); byText.get(l).push(i); } });
const fills = new Map(); // draft index -> {text, src}
const report = [];
for (const f of fr) {
  const nums = [...f.lines.keys()].sort((a, b) => a - b);
  // consecutive runs
  const runs = []; let cur = [];
  for (const n of nums) { if (cur.length && n !== cur.at(-1) + 1) { runs.push(cur); cur = []; } cur.push(n); }
  if (cur.length) runs.push(cur);
  for (const run of runs) {
    if (run.length < MIN + 1) continue;
    // candidate offsets from distinctive lines
    const votes = new Map();
    for (const n of run) { const t = f.lines.get(n); const at = byText.get(t); if (at && at.length <= 3) for (const i of at) { const d = i - (n - 1); votes.set(d, (votes.get(d) ?? 0) + 1); } }
    for (const [d, v] of votes) {
      if (v < MIN) continue;
      let agree = 0, conflict = 0, gapIdx = [], firstA = null, lastA = null;
      for (const n of run) {
        const i = n - 1 + d; if (i < 0 || i >= D.length) { conflict++; continue; }
        const t = f.lines.get(n);
        if (M(D[i])) gapIdx.push([i, t]);
        else if (D[i] === t) { agree++; if (firstA == null) firstA = i; lastA = i; }
        else conflict++;
      }
      if (conflict || agree < MIN || !gapIdx.length) continue;
      const inside = gapIdx.filter(([i]) => i > firstA && i < lastA);
      const edge = gapIdx.filter(([i]) => !(i > firstA && i < lastA));
      report.push({ t: f.t, src: f.src, d, agree, inside: inside.length, edge: edge.length, from: run[0], to: run.at(-1) });
      for (const [i, t] of inside.concat(opt.edge ? edge : [])) {
        const prev = fills.get(i);
        if (prev && prev.text !== t) prev.clash = (prev.clash ?? []).concat([{ text: t, t: f.t }]);
        else if (!prev) fills.set(i, { text: t, t: f.t, src: f.src });
      }
    }
  }
}
for (const r of report) console.log(`${r.t.slice(0, 19)} ${r.src} lines ${r.from}-${r.to} offset ${r.d} agree ${r.agree} fills inside ${r.inside} edge ${r.edge}`);
let clashes = 0;
for (const [i, v] of fills) if (v.clash) { clashes++; console.log('CLASH at', i + 1, JSON.stringify(v.text), v.clash.map((c) => JSON.stringify(c.text) + '@' + c.t).join(' ')); }
const out = D.slice(); for (const [i, v] of fills) if (!v.clash) out[i] = v.text;
writeFileSync(outPath, out.join('\n') + '\n');
console.log('filled', [...fills.values()].filter((v) => !v.clash).length, 'clashes', clashes, 'left', out.filter(M).length);

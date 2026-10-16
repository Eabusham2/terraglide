// Fill gaps of a final draft from any logged output that shows the file's text, placed by content: a stretch of
// output whose lines agree with the draft at one offset, with draft anchors on both sides of a gap and the gap's
// lines all inside the stretch, fills that gap. Prefixes `NN:`, `NN-`, `NN\t`, `+`/` ` (diff) are tried.
// usage: node contentfill.mjs REL DRAFT OUT [--since=ISO] [--until=ISO]
import { readFileSync, writeFileSync } from 'node:fs';
import { loadRows } from './frags.mjs';
const [rel, draftPath, outPath] = process.argv.slice(2);
const opt = Object.fromEntries(process.argv.slice(5).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const since = opt.since ?? ''; const until = opt.until ?? '9999';
const D = readFileSync(draftPath, 'utf8').split('\n'); if (D.at(-1) === '') D.pop();
const M = (l) => /^@@MISSING \d+@@$/.test(l);
const byText = new Map();
D.forEach((l, i) => { if (!M(l)) { if (!byText.has(l)) byText.set(l, []); byText.get(l).push(i); } });
const name = rel.split('/').pop();
const strips = [
  (l) => l,
  (l) => { const m = /^\s*\d+\t(.*)$/s.exec(l); return m ? m[1] : null; },
  (l) => { const m = /^\d+[:-](.*)$/s.exec(l); return m ? m[1] : null; },
  (l) => { const m = /^[ +](.*)$/s.exec(l); return m ? m[1] : null; },
  (l) => { const m = /^\s*\d+→(.*)$/s.exec(l); return m ? m[1] : null; },
];
const fills = new Map();
for (const r of loadRows()) {
  if (r.t < since || r.t > until || !r.result || typeof r.result !== 'string') continue;
  const inp = JSON.stringify(r.input ?? {});
  if (!inp.includes(name)) continue;
  const raw = r.result.split('\n');
  for (const strip of strips) {
    const L = raw.map(strip);
    let i = 0;
    while (i < L.length) {
      const c = L[i] != null ? byText.get(L[i]) : null;
      if (!c || c.length !== 1 || L[i].trim().length < 4) { i++; continue; }
      const off = c[0] - i;
      // extend forward from this anchor while the output agrees (gap lines accepted)
      let j = i, lastAnchor = i; const pend = [];
      const got = [];
      while (j + 1 < L.length && j + 1 + off < D.length) {
        const k = j + 1 + off; const t = L[j + 1];
        if (t == null) break;
        if (M(D[k])) { pend.push([k, t]); j++; continue; }
        if (D[k] !== t) break;
        j++; lastAnchor = j; if (pend.length) { got.push(...pend); pend.length = 0; }
      }
      for (const [k, t] of got) {
        const prev = fills.get(k);
        if (!prev) fills.set(k, { text: t, t: r.t, n: 1 });
        else if (prev.text === t) prev.n++;
        else (prev.clash ??= []).push({ text: t, t: r.t });
      }
      i = Math.max(i + 1, lastAnchor);
    }
  }
}
const out = D.slice(); let n = 0, clashes = 0;
const byGap = new Map();
for (const [k, v] of [...fills].sort((a, b) => a[0] - b[0])) {
  if (v.clash) { clashes++; console.log('CLASH', k + 1, JSON.stringify(v.text).slice(0, 80), '@' + v.t.slice(0, 16), v.clash.map((c) => JSON.stringify(c.text).slice(0, 60) + '@' + c.t.slice(0, 16)).join(' | ')); continue; }
  out[k] = v.text; n++;
  const g = v.t.slice(0, 16); byGap.set(g, (byGap.get(g) ?? []).concat(k + 1));
}
for (const [t, ks] of byGap) console.log(t, ks.length, 'lines', ks[0] + '..' + ks.at(-1));
writeFileSync(outPath, out.join('\n') + '\n');
console.log('filled', n, 'clashes', clashes, 'left', out.filter(M).length);

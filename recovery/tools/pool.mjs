// Pool what is known about a file across versions joined by exact diffs, then fill gaps by text matching.
// Usage: node pool.mjs <spec.json> <targetVersion> <out>
// spec: { rel, versions: [{name, from, to, count}], diffs: [{from:'V2', to:'V3', file:'diffs/x.diff'}],
//         replaces: [{from, to, old, new}] (python s.replace edits, as text) }
import { readFileSync, writeFileSync } from 'node:fs';
import { fragments, loadRows } from './frags.mjs';
import { textRuns, grepNumbered } from './runs.mjs';
const [specPath, target, out] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const rel = spec.rel;
const rows = loadRows();
const all = [...fragments(rows, rel), ...grepNumbered(rows, rel)];
const V = Object.fromEntries(spec.versions.map((v) => [v.name, { ...v, known: new Map(), conflicts: [] }]));
const put = (v, n, text, why) => {
  if (n < 1 || n > v.count) return false;
  if (v.known.has(n)) { if (v.known.get(n) !== text) v.conflicts.push({ n, have: v.known.get(n), got: text, why }); return false; }
  v.known.set(n, text); return true;
};
// 1. Each version's own window.
for (const v of Object.values(V)) {
  for (const f of all) if (f.t >= v.from && f.t < v.to && !f.hyps) for (const [n, t] of f.lines) put(v, n, t, 'win ' + f.t);
}
const settleHyps = () => {
  for (const v of Object.values(V)) for (const f of all) {
    if (!f.hyps || f.t < v.from || f.t >= v.to || f.used) continue;
    const sc = f.hyps.map((m) => { let a = 0, c = 0; for (const [n, t] of m) { if (!v.known.has(n)) continue; if (v.known.get(n) === t) a++; else c++; } return { m, a, c }; });
    const ok = sc.filter((s) => s.c === 0 && s.a > 0);
    if (ok.length === 1) { for (const [n, t] of ok[0].m) put(v, n, t, 'hyp ' + f.t); f.used = true; }
  }
};
settleHyps();
// 2. Edges: a unified diff maps old lines to new ones.
function parseHunks(text) {
  const hs = []; let h = null;
  for (const l of text.split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (m) { h = { os: +m[1], ol: +(m[2] ?? 1), ns: +m[3], nl: +(m[4] ?? 1), lines: [] }; hs.push(h); continue; }
    if (!h || l.startsWith('---') || l.startsWith('+++') || l.startsWith('diff ')) continue;
    if (l === '\\ No newline at end of file') continue;
    const op = l[0]; if (op === ' ' || op === '-' || op === '+') h.lines.push({ op, text: l.slice(1) });
  }
  return hs;
}
const edges = [];
for (const d of spec.diffs ?? []) edges.push({ from: d.from, to: d.to, hunks: parseHunks(readFileSync(d.file, 'utf8')) });
// python s.replace edits: an edge with an ordered list of {old, new}; each is placed by finding its block,
// uniquely, among the known lines of either version; the other side's position follows from the blocks before it.
for (const r of spec.replaces ?? []) edges.push({ from: r.from, to: r.to, edits: r.edits });
function findBlock(v, blk) {
  // python's replace(old, new, 1) changes the first occurrence: take the first place where the whole block is
  // known, unless an earlier place could also hold it (partly known, nothing against it).
  let firstFull = null, partials = [];
  for (let n = 1; n + blk.length - 1 <= v.count; n++) {
    let known = 0, ok = true;
    for (let i = 0; i < blk.length; i++) { if (!v.known.has(n + i)) continue; if (v.known.get(n + i) !== blk[i]) { ok = false; break; } known++; }
    if (!ok || !blk.join('').trim()) continue;
    if (known === blk.length) { firstFull = n; break; }
    if (known >= Math.min(blk.length, 2)) partials.push(n);
  }
  if (firstFull != null && !partials.length) return firstFull;
  if (firstFull == null && partials.length === 1) return partials[0];
  if (firstFull != null || partials.length) return null;
  return locateViaRuns(v, blk);
}
// A block not yet known in a version: find it in any logged text, and place it by distinctive lines next to it
// in that text whose positions in the version are known (all of them must agree).
let RUNS_FOR_LOCATE = null;
function locateViaRuns(v, blk) {
  RUNS_FOR_LOCATE ??= textRuns(rows, rel).concat(all.filter((f) => !f.hyps).map((f) => { const ns = [...f.lines.keys()].sort((a, b) => a - b); return { lines: ns.map((n) => f.lines.get(n)), contiguous: ns.every((n, i) => !i || n === ns[i - 1] + 1) }; }).filter((r) => r.contiguous));
  const head = blk.find((l) => l.trim().length > 12); if (!head) return null;
  const at = new Set();
  const byText = new Map(); for (const [n, t] of v.known) { if (t.trim().length < 16) continue; byText.set(t, byText.has(t) ? -1 : n); }
  for (const r of RUNS_FOR_LOCATE) {
    const L = r.lines;
    for (let i = 0; i + blk.length <= L.length; i++) {
      if (!blk.every((x, j) => L[i + j] === x)) continue;
      // Lines before the block vote for its start directly; lines after it vote for where it ends.
      const votes = new Map();
      for (let j = Math.max(0, i - 40); j < i; j++) { const n = byText.get(L[j]); if (n == null || n < 0) continue; const k = 'S' + (n + (i - j)); votes.set(k, (votes.get(k) ?? 0) + 1); }
      for (let j = i + blk.length; j < Math.min(L.length, i + blk.length + 40); j++) { const n = byText.get(L[j]); if (n == null || n < 0) continue; const k = 'E' + (n - (j - (i + blk.length))); votes.set(k, (votes.get(k) ?? 0) + 1); }
      const starts = [...votes].filter(([k]) => k[0] === 'S'), ends = [...votes].filter(([k]) => k[0] === 'E');
      // Only the side before the block fixes its start in this version (the block's own length here is the old one).
      if (starts.length === 1 && starts[0][1] >= 3) at.add(+starts[0][0].slice(1));
    }
  }
  return at.size === 1 ? [...at][0] : null;
}
function edgeHunks(e) {
  if (e.hunks) return e.hunks;
  if (e.done) return e.done;
  const A = V[e.from], B = V[e.to];
  const items = e.edits.map((x) => {
    // Whole lines: a block that ends (or starts) with a newline on both sides has no extra empty line.
    let o = x.old, w = x.new;
    while (o.endsWith('\n') && w.endsWith('\n')) { o = o.slice(0, -1); w = w.slice(0, -1); }
    while (o.startsWith('\n') && w.startsWith('\n')) { o = o.slice(1); w = w.slice(1); }
    const old = o.split('\n'), nw = w.split('\n'); return { old, nw, d: nw.length - old.length, os: findBlock(A, old), ns: findBlock(B, nw) }; });
  if (items.some((it) => it.os == null && it.ns == null)) return null;
  // order by position (either coordinate; deltas are small next to the distances between blocks)
  items.sort((a, b) => (a.os ?? a.ns) - (b.os ?? b.ns));
  let cum = 0;
  for (const it of items) { if (it.os == null) it.os = it.ns - cum; if (it.ns == null) it.ns = it.os + cum; if (it.ns - it.os !== cum) return null; cum += it.d; }
  e.done = items.map((it) => ({ os: it.os, ol: it.old.length, ns: it.ns, nl: it.nw.length, lines: [...it.old.map((t) => ({ op: '-', text: t })), ...it.nw.map((t) => ({ op: '+', text: t }))] }));
  return e.done;
}
function propagate() {
  let moved = 0;
  for (const e of edges) {
    const A = V[e.from], B = V[e.to]; const hs = edgeHunks(e); if (!hs) continue;
    // hunk content itself
    for (const h of hs) {
      let o = h.os, n = h.ns;
      for (const l of h.lines) {
        if (l.op === ' ') { if (put(A, o, l.text, 'hunk')) moved++; if (put(B, n, l.text, 'hunk')) moved++; o++; n++; }
        else if (l.op === '-') { if (put(A, o, l.text, 'hunk')) moved++; o++; }
        else { if (put(B, n, l.text, 'hunk')) moved++; n++; }
      }
    }
    // unchanged lines between hunks: old n -> new n + delta
    const sorted = [...hs].sort((a, b) => a.os - b.os);
    const mapOld = (n) => { let d = 0; for (const h of sorted) { if (n < h.os) break; if (n < h.os + h.ol) return null; d += h.nl - h.ol; } return n + d; };
    const mapNew = (n) => { let d = 0; for (const h of sorted) { if (n < h.ns) break; if (n < h.ns + h.nl) return null; d += h.ol - h.nl; } return n + d; };
    for (const [n, t] of [...A.known]) { const m = mapOld(n); if (m != null && put(B, m, t, `from ${e.from}`)) moved++; }
    for (const [n, t] of [...B.known]) { const m = mapNew(n); if (m != null && put(A, m, t, `from ${e.to}`)) moved++; }
  }
  return moved;
}
for (let i = 0; i < 10; i++) { const m = propagate(); settleHyps(); if (!m) break; }
for (const e of edges) console.log(`edge ${e.from}->${e.to}:`, edgeHunks(e) ? edgeHunks(e).map((h) => `${h.os}+${h.ol}->${h.ns}+${h.nl}`).join(" ") : "NOT PLACED", e.edits ? e.edits.map((x) => JSON.stringify(x.old.split("\n")[0]).slice(0, 50)).join(" / ") : "");
for (const v of Object.values(V)) {
  console.log(`${v.name} (${v.count}): known ${v.known.size}, conflicts ${v.conflicts.length}`);
  for (const c of v.conflicts.slice(0, 6)) console.log('   conflict', c.n, c.why, JSON.stringify(c.have).slice(0, 60), '|', JSON.stringify(c.got).slice(0, 60));
}
// 3. Fill gaps by text matching (both anchors, exact distance), nearest text first - in every version, then
//    propagate again, until nothing changes.
const texts = textRuns(rows, rel);
const pastes = readFileSync('pastemap.txt', 'utf8').trim().split('\n').map((l) => l.split(' ')).filter(([, r]) => r === rel)
  .map(([p]) => { const L = readFileSync('/home/user/recovery/' + p, 'utf8').replace(/\r/g, '').split('\n'); while (L.length && L.at(-1) === '') L.pop(); return { t: '2026-10-03', src: 'paste ' + p, lines: L, whole: true }; });
const runsOf = (m, t, src) => { const nums = [...m.keys()].sort((a, b) => a - b); const rs = []; let run = []; for (const n of nums) { if (run.length && n !== run.at(-1) + 1) { rs.push(run); run = []; } run.push(n); } if (run.length) rs.push(run); return rs.map((r) => ({ t, src, lines: r.map((k) => m.get(k)) })); };
const elsewhere = all.filter((f) => !f.hyps && spec.versions.every((v) => f.t < v.from || f.t >= v.to)).flatMap((f) => runsOf(f.lines, f.t, f.src));
const distinctive = (xs) => xs.join('').replace(/\s/g, '').length >= 16;
const side = (xs) => xs.join('').replace(/\s/g, '').length >= 20;
const fillStats = {};
const NO_BRIDGE = process.env.NO_BRIDGE === '1';
// Two texts joined: one carries on from the lines before the gap, the other leads into the lines after it; they
// are joined where both agree for J lines either side of the join, and the result must fill the gap exactly.
function bridge(classes, before, after, gap, J = 3) {
  const K = before.length;
  const allRuns = classes.flatMap(([cls, runs]) => runs.map((r) => ({ cls, r })));
  const F = [], B = [];
  for (const { cls, r } of allRuns) {
    const L = r.lines;
    for (let i = 0; i + K <= L.length; i++) if (before.every((x, j) => L[i + j] === x)) { F.push({ cls, r, seq: L.slice(i + K, i + K + gap + J) }); break; }
    for (let i = K; i + K <= L.length; i++) if (after.every((x, j) => L[i + j] === x)) { B.push({ cls, r, seq: L.slice(Math.max(0, i - gap - J), i) }); break; }
    if (F.length > 40 && B.length > 40) break;
  }
  const results = new Map();
  for (const f of F.slice(0, 40)) for (const g of B.slice(0, 40)) {
    if (f.r === g.r) continue;
    for (let i = J; i <= gap - J; i++) {
      const need = gap - i; if (f.seq.length < i + J || g.seq.length < need + J) continue;
      const tail = g.seq.slice(g.seq.length - need);           // what the second text gives for the gap's end
      const lead = g.seq.slice(g.seq.length - need - J, g.seq.length - need); // its lines just before that
      let ok = true;
      for (let k = 0; k < J && ok; k++) { if (f.seq[i + k] !== tail[k]) ok = false; if (f.seq[i - J + k] !== lead[k]) ok = false; }
      if (!ok) continue;
      const text = [...f.seq.slice(0, i), ...tail];
      if (text.some((x) => x === undefined)) continue;
      const key = text.join('\n'); if (!results.has(key)) results.set(key, { cls: 'bridge', text });
    }
    if (results.size > 1) return null;
  }
  return results.size === 1 ? [...results.values()][0] : null;
}
function fillVersion(T) {
  const N = T.count; const base = T.known; let filled = 0;
  const mid = (new Date(T.from).getTime() + new Date(T.to).getTime()) / 2;
  const near = (a, b) => Math.abs(new Date(a.t) - mid) - Math.abs(new Date(b.t) - mid);
  const otherVersions = Object.values(V).filter((v) => v !== T).sort(near).flatMap((v) => runsOf(v.known, v.from, v.name));
  const classes = [['repoText', texts.filter((r) => r.src === 'Bash output' && r.inRepo !== false && r.t >= T.from && r.t < T.to)], ['otherVersions', otherVersions], ['numberedElsewhere', elsewhere.slice().sort(near)], ['anyText', texts.slice().sort(near)], ['paste', pastes]];
  for (let round = 0; round < 24; round++) {
    const K = [3, 3, 2, 1][Math.min(3, round % 4)];
    let did = 0;
    for (let n = 1; n <= N; n++) {
      if (base.has(n)) continue;
      let b = n; while (b <= N && !base.has(b)) b++;
      const gap = b - n;
      const before = [], after = []; for (let k = n - K; k < n; k++) before.push(base.get(k)); for (let k = b; k < b + K; k++) after.push(base.get(k));
      const hb = n - K >= 1 && before.every((x) => x !== undefined), ha = b + K - 1 <= N && after.every((x) => x !== undefined);
      if (hb && b === N + 1 && distinctive(before)) {
        let got = null;
        for (const [cls, runs] of classes) { for (const r of runs) { if (!r.whole) continue; const L = r.lines; for (let i = 0; i + K <= L.length; i++) { if (!before.every((x, j) => L[i + j] === x)) continue; if (L.length - (i + K) === gap) got = { cls, text: L.slice(i + K) }; break; } if (got) break; } if (got) break; }
        if (got) { for (let k = 0; k < gap; k++) base.set(n + k, got.text[k]); filled += gap; did += gap; fillStats[got.cls + '(eof)'] = (fillStats[got.cls + '(eof)'] ?? 0) + gap; }
        n = b; continue;
      }
      if (!hb || !ha || !distinctive([...before, ...after]) || (K < 3 && !(side(before) && side(after)))) { n = b; continue; }
      let pick = null;
      for (const [cls, runs] of classes) {
        for (const r of runs) { const L = r.lines; for (let i = 0; i + K + gap + K <= L.length; i++) { if (!before.every((x, j) => L[i + j] === x)) continue; if (!after.every((x, j) => L[i + K + gap + j] === x)) continue; pick = { cls, text: L.slice(i + K, i + K + gap) }; break; } if (pick) break; }
        if (pick) break;
      }
      if (!pick && K === 3 && !NO_BRIDGE) pick = bridge(classes, before, after, gap);
      if (pick) { for (let k = 0; k < gap; k++) base.set(n + k, pick.text[k]); filled += gap; did += gap; fillStats[pick.cls] = (fillStats[pick.cls] ?? 0) + gap; }
      n = b;
    }
    if (!did && K === 1) break;
  }
  return filled;
}
for (let pass = 0; pass < 8; pass++) {
  let changed = 0;
  for (let i = 0; i < 10; i++) { const m = propagate(); settleHyps(); changed += m; if (!m) break; }
  for (const v of Object.values(V)) changed += fillVersion(v);
  if (!changed) break;
}
for (const e of edges) if (!edgeHunks(e)) console.log(`edge ${e.from}->${e.to}: STILL NOT PLACED`);
for (const v of Object.values(V)) console.log(`after filling: ${v.name} (${v.count}) known ${v.known.size}, conflicts ${v.conflicts.length}`);
const T = V[target]; const N = T.count; const base = T.known;
console.log(`${target}: text fills ${JSON.stringify(fillStats)}`);
// Hand-written or hand-placed lines (spec.manual: "N<TAB>text" per line), only where nothing else is known.
let manual = 0;
if (spec.manual) for (const l of readFileSync(spec.manual, 'utf8').split('\n')) { const m = /^(\d+)\t(.*)$/s.exec(l); if (m && !base.has(+m[1])) { base.set(+m[1], m[2]); manual++; } }
if (manual) console.log(`${target}: ${manual} lines from ${spec.manual}`);
const missing = []; for (let n = 1; n <= N; n++) if (!base.has(n)) missing.push(n);
const ranges = []; for (const n of missing) { if (ranges.length && ranges.at(-1)[1] === n - 1) ranges.at(-1)[1] = n; else ranges.push([n, n]); }
console.log(`${target}: missing ${missing.length}: ${ranges.slice(0, 40).map(([a, b]) => a === b ? a : `${a}-${b}`).join(' ')}`);
const lines = []; for (let n = 1; n <= N; n++) lines.push(base.has(n) ? base.get(n) : `@@MISSING ${n}@@`);
writeFileSync(out, lines.join('\n') + '\n');

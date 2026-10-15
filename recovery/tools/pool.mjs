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
// newest first: where two views in one window disagree (an edit nobody logged), the later one is the file's
for (const v of Object.values(V)) {
  for (const f of all.slice().sort((a, b) => (a.t < b.t ? 1 : -1))) if (f.t >= v.from && f.t < v.to && !f.hyps) for (const [n, t] of f.lines) put(v, n, t, 'win ' + f.t);
}
const settleHyps = () => {
  for (const v of Object.values(V)) for (const f of all) {
    if (!f.hyps || f.t < v.from || f.t >= v.to || f.used) continue;
    const sc = f.hyps.map((m) => { let a = 0, c = 0; for (const [n, t] of m) { if (!v.known.has(n)) continue; if (v.known.get(n) === t) a++; else c++; } return { m, a, c }; });
    let ok = sc.filter((s) => s.c === 0 && s.a > 0);
    // Nothing to compare with in this version: decide by what comes before the first line shown (or after the
    // last) in any version that has it - a blank there means a blank was trimmed off the output.
    if (!ok.length && f.hyps.length === 2 && sc.every((s) => s.a === 0 && s.c === 0)) {
      const [h0, h1] = f.hyps; const k0 = [...h0.keys()].sort((a, b) => a - b), k1 = [...h1.keys()].sort((a, b) => a - b);
      const top = /top of mixed|chain short/.test(f.src);
      const shown = top ? h0.get(k0[0]) : h0.get(k0.at(-1));
      const votes = { blank: 0, text: 0 };
      if (shown && shown.trim()) for (const w of Object.values(V)) for (const [n, t] of w.known) {
        if (t !== shown) continue; const nb = w.known.get(top ? n - 1 : n + 1); if (nb === undefined) continue; votes[nb === '' ? 'blank' : 'text']++;
      }
      if (votes.text && !votes.blank) ok = [sc[0]]; else if (votes.blank && !votes.text) ok = [sc[1]];
    }
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
for (const u of spec.unknown ?? []) edges.push({ from: u.from, to: u.to, unknown: true });
// An edit nobody logged: line up the two versions on distinctive lines both know, and copy across only the
// stretches between two such lines that are the same distance apart in both.
function alignUnknown(e) {
  const A = V[e.from], B = V[e.to]; let moved = 0;
  const uniq = (v) => { const m = new Map(); for (const [n, t] of v.known) { if (t.replace(/\s/g, '').length < 20) continue; m.set(t, m.has(t) ? -1 : n); } return m; };
  const ua = uniq(A), ub = uniq(B);
  const pairs = []; for (const [t, a] of ua) { const b = ub.get(t); if (a > 0 && b > 0) pairs.push([a, b]); }
  pairs.sort((x, y) => x[0] - y[0]);
  // longest chain increasing in both
  const n = pairs.length; const len = Array(n).fill(1), prev = Array(n).fill(-1);
  for (let i = 0; i < n; i++) for (let j = Math.max(0, i - 200); j < i; j++) if (pairs[j][1] < pairs[i][1] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
  let best = -1; for (let i = 0; i < n; i++) if (best < 0 || len[i] > len[best]) best = i;
  const chain = []; for (let i = best; i >= 0; i = prev[i]) chain.unshift(pairs[i]);
  // The file's start and end line up too (before line 1, after the last line).
  chain.unshift([0, 0]); chain.push([A.count + 1, B.count + 1]);
  for (let i = 0; i + 1 < chain.length; i++) {
    const [a1, b1] = chain[i], [a2, b2] = chain[i + 1];
    if (a2 - a1 !== b2 - b1) continue;
    let ok = true; for (let k = 1; k < a2 - a1 && ok; k++) { const x = A.known.get(a1 + k), y = B.known.get(b1 + k); if (x !== undefined && y !== undefined && x !== y) ok = false; }
    if (!ok) continue;
    for (let k = 1; k < a2 - a1; k++) { const x = A.known.get(a1 + k), y = B.known.get(b1 + k); if (x !== undefined && y === undefined) { if (put(B, b1 + k, x, 'unknown-edge')) moved++; } else if (y !== undefined && x === undefined) { if (put(A, a1 + k, y, 'unknown-edge')) moved++; } }
  }
  return moved;
}
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
  // Text that is not whole lines: find it inside a run of known lines of A (or the new text in B), widen to the
  // lines it touches, and make the replacement there. Unique occurrences only.
  const viaSubstring = (x) => {
    for (const [V1, find, repl, side] of [[A, x.old, x.new, 'A'], [B, x.new, x.old, 'B']]) {
      if (!find || find.length < 12) continue;
      const nums = [...V1.known.keys()].sort((a, b) => a - b);
      let hits = [];
      for (let i = 0; i < nums.length;) {
        let j = i; while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
        const start = nums[i]; const lines = nums.slice(i, j + 1).map((n) => V1.known.get(n));
        const text = lines.join('\n');
        let k = text.indexOf(find);
        while (k >= 0) { hits.push({ start, text, k, lines }); k = text.indexOf(find, k + 1); }
        i = j + 1;
      }
      if (hits.length !== 1) continue;
      const h = hits[0];
      const before = h.text.slice(0, h.k); const firstLine = before.split('\n').length - 1;
      const lastLine = (before + find).split('\n').length - 1;
      const oldLines = h.lines.slice(firstLine, lastLine + 1);
      const joined = oldLines.join('\n'); const off = before.length - (before.lastIndexOf('\n') + 1);
      const replaced = joined.slice(0, off) + repl + joined.slice(off + find.length);
      const pos = h.start + firstLine;
      return side === 'A' ? { old: oldLines, nw: replaced.split('\n'), os: pos, ns: null } : { old: replaced.split('\n'), nw: oldLines, os: null, ns: pos };
    }
    return null;
  };
  const items = e.edits.map((x) => {
    // Whole lines: a block that ends (or starts) with a newline on both sides has no extra empty line.
    let o = x.old, w = x.new;
    while (o.endsWith('\n') && w.endsWith('\n')) { o = o.slice(0, -1); w = w.slice(0, -1); }
    while (o.startsWith('\n') && w.startsWith('\n')) { o = o.slice(1); w = w.slice(1); }
    let old = o.split('\n'), nw = w.split('\n');
    let os0 = findBlock(A, old), ns0 = findBlock(B, nw);
    if (os0 == null && ns0 == null) { const sub = viaSubstring(x); if (sub) { old = sub.old; nw = sub.nw; os0 = sub.os; ns0 = sub.ns; } } return { old, nw, d: nw.length - old.length, os: os0, ns: ns0 }; });
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
    if (e.unknown) { moved += alignUnknown(e); continue; }
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
for (const e of edges) if (!e.unknown) console.log(`edge ${e.from}->${e.to}:`, edgeHunks(e) ? edgeHunks(e).map((h) => `${h.os}+${h.ol}->${h.ns}+${h.nl}`).join(" ") : "NOT PLACED", e.edits ? e.edits.map((x) => JSON.stringify(x.old.split("\n")[0]).slice(0, 50)).join(" / ") : "");
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
// Views in no window (between an unlogged change's two count records): each goes to the one version it agrees
// with (3 or more lines alike, none against) while it contradicts every other.
const orphans = all.filter((f) => !f.hyps && !spec.versions.some((v) => f.t >= v.from && f.t < v.to) && f.agent !== 'git');
function placeOrphans() {
  let moved = 0;
  for (const f of orphans) {
    if (f.placed) continue;
    const fits = [], against = [];
    for (const v of Object.values(V)) { let a = 0, c = 0; for (const [n, t] of f.lines) { if (!v.known.has(n)) continue; if (v.known.get(n) === t) a++; else c++; } if (!c && a >= 3) fits.push(v); else if (c) against.push(v); }
    if (fits.length === 1 && against.length >= 1) { for (const [n, t] of f.lines) if (put(fits[0], n, t, 'orphan ' + f.t)) moved++; f.placed = true; continue; }
    // Between the version before it in time (A) and the one after (B): contradicting one and not the other
    // puts it in the other.
    const vs = Object.values(V).slice().sort((x, y) => (x.from < y.from ? -1 : 1));
    const A = vs.filter((v) => v.to <= f.t).at(-1), B = vs.find((v) => v.from > f.t);
    if (!A || !B) continue;
    const score = (v) => { let a = 0, c = 0; for (const [n, t] of f.lines) { if (!v.known.has(n)) continue; if (v.known.get(n) === t) a++; else c++; } return { a, c }; };
    const sa = score(A), sb = score(B);
    const pick = sa.c >= 3 && sb.c === 0 && sb.a >= 2 ? B : sb.c >= 3 && sa.c === 0 && sa.a >= 2 ? A : null;
    if (pick) { for (const [n, t] of f.lines) if (n <= pick.count && put(pick, n, t, 'orphan* ' + f.t)) moved++; f.placed = true; }
  }
  return moved;
}
for (let pass = 0; pass < 8; pass++) {
  let changed = placeOrphans();
  for (let i = 0; i < 10; i++) { const m = propagate(); settleHyps(); changed += m; if (!m) break; }
  for (const v of Object.values(V)) changed += fillVersion(v);
  if (!changed) break;
}
for (const e of edges) if (!e.unknown && !edgeHunks(e)) console.log(`edge ${e.from}->${e.to}: STILL NOT PLACED`);
for (const v of Object.values(V)) console.log(`after filling: ${v.name} (${v.count}) known ${v.known.size}, conflicts ${v.conflicts.length}`);
const T = V[target]; const N = T.count; const base = T.known;
console.log(`${target}: text fills ${JSON.stringify(fillStats)}`);
// A whole copy of the file (a git diff applied, a full Read, a lone cat) with exactly the target's length that
// agrees with every line known so far: the latest one fills what is still missing.
{
  const wholes = all.filter((f) => !f.hyps && (f.whole || /^Read 1\+all/.test(f.src)) && f.lines.size === N && Math.max(...f.lines.keys()) === N)
    .sort((a, b) => (a.t < b.t ? 1 : -1));
  for (const w of wholes) {
    let clash = 0, agree = 0; for (const [n, t] of base) { if (!w.lines.has(n)) continue; if (w.lines.get(n) === t) agree++; else clash++; }
    if (clash) continue;
    let k = 0; for (const [n, t] of w.lines) if (!base.has(n)) { base.set(n, t); k++; }
    if (k) console.log(`${target}: ${k} lines from a whole copy of ${w.t} (${w.src}), agreeing with ${agree} known`);
    break;
  }
}
// Hand-written or hand-placed lines (spec.manual: "N<TAB>text" per line), only where nothing else is known.
let manual = 0;
if (spec.manual) for (const l of readFileSync(spec.manual, 'utf8').split('\n')) { const m = /^(\d+)\t(.*)$/s.exec(l); if (m && !base.has(+m[1])) { base.set(+m[1], m[2]); manual++; } }
if (manual) console.log(`${target}: ${manual} lines from ${spec.manual}`);
const missing = []; for (let n = 1; n <= N; n++) if (!base.has(n)) missing.push(n);
const ranges = []; for (const n of missing) { if (ranges.length && ranges.at(-1)[1] === n - 1) ranges.at(-1)[1] = n; else ranges.push([n, n]); }
console.log(`${target}: missing ${missing.length}: ${ranges.slice(0, 40).map(([a, b]) => a === b ? a : `${a}-${b}`).join(' ')}`);
const lines = []; for (let n = 1; n <= N; n++) lines.push(base.has(n) ? base.get(n) : `@@MISSING ${n}@@`);
writeFileSync(out, lines.join('\n') + '\n');

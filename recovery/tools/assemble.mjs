// Rebuild one version of a file: the version in a time window [from, to).
// 1. Lines seen in that window, by number (they must agree): Read, sed ranges, grep -n.
// 2. Gaps filled by text matching: the K lines either side of the gap must appear in a run of text with
//    the same number of lines between them. Sources in order: text from the window seen in the repository,
//    then numbered sightings from other times, then any other text (copies, edits), nearest in time first.
// 3. Then, only from the window's own repository text: a gap is extended from one side when K distinctive
//    lines before (or after) it match.
// Usage: node assemble.mjs <rel> <from> <to> <lineCount> <out> [--seed file]   (seed: a candidate whose
// lines are used as a last, lowest-priority source)
import { readFileSync, writeFileSync } from 'node:fs';
import { fragments, loadRows } from './frags.mjs';
import { textRuns, grepNumbered } from './runs.mjs';
const args = process.argv.slice(2);
const [rel, from, to, countArg, out] = args;
const seedAt = args.indexOf('--seed'); const seed = seedAt > 0 ? args[seedAt + 1] : null;
const N = Number(countArg);
const rows = loadRows();
const all = [...fragments(rows, rel), ...grepNumbered(rows, rel)];
const inWin = (t) => t >= from && t < to;
const base = new Map(); const conflicts = []; const srcOf = new Map();
for (const f of all.filter((f) => inWin(f.t))) for (const [n, text] of f.lines) {
  if (n > N) continue;
  if (base.has(n) && base.get(n) !== text) conflicts.push({ n, a: base.get(n), b: text, t: f.t, src: f.src });
  else { base.set(n, text); srcOf.set(n, 'win'); }
}
let hypUsed = 0; const hypLeft = [];
for (let pass = 0; pass < 2; pass++) for (const f of all) {
  if (!f.hyps || !inWin(f.t) || f.used) continue;
  const scored = f.hyps.map((m) => { let agree = 0, clash = 0; for (const [n, text] of m) { if (n > N || !base.has(n)) continue; if (base.get(n) === text) agree++; else clash++; } return { m, agree, clash }; });
  const ok = scored.filter((s) => s.clash === 0 && s.agree > 0);
  const same = ok.length > 1 && ok.every((s) => [...s.m].every(([n, t]) => ok[0].m.get(n) === t));
  if (ok.length === 1 || same) { for (const [n, text] of ok[0].m) if (n <= N && !base.has(n)) { base.set(n, text); srcOf.set(n, 'win'); } hypUsed++; f.used = true; }
  else if (pass === 1) hypLeft.push({ t: f.t, src: f.src, scores: scored.map((s) => `${s.agree}/${s.clash}`).join(' ') });
}
console.log(`${rel}: ${base.size}/${N} lines from the window, ${conflicts.length} conflicts; short outputs settled ${hypUsed}, unsettled ${hypLeft.length}`);
for (const c of conflicts.slice(0, 8)) console.log('  conflict', c.n, c.t, c.src, JSON.stringify(c.a).slice(0, 70), '|', JSON.stringify(c.b).slice(0, 70));
for (const h of hypLeft.slice(0, 5)) console.log('  unsettled', h.t, h.src, h.scores);
// Sources for text matching, in priority classes.
const mid = new Date(from).getTime() / 2 + new Date(to).getTime() / 2;
const near = (a, b) => Math.abs(new Date(a.t) - mid) - Math.abs(new Date(b.t) - mid);
const numberedRuns = (f) => { const nums = [...f.lines.keys()].sort((a, b) => a - b); const rs = []; let run = []; for (const n of nums) { if (run.length && n !== run.at(-1) + 1) { rs.push(run); run = []; } run.push(n); } if (run.length) rs.push(run); return rs.map((r) => ({ t: f.t, src: f.src, lines: r.map((k) => f.lines.get(k)) })); };
const texts = textRuns(rows, rel);
const classA = texts.filter((r) => inWin(r.t) && r.src === 'Bash output' && r.inRepo !== false).sort(near);
const classB = all.filter((f) => !inWin(f.t) && !f.hyps).flatMap(numberedRuns).sort(near);
const classC = texts.filter((r) => !classA.includes(r)).sort(near);
const classD = seed ? [{ t: from, src: 'seed', lines: readFileSync(seed, 'utf8').split('\n') }] : [];
const classes = [['A', classA], ['B', classB], ['C', classC], ['D', classD]];
const distinctive = (xs) => xs.join('').replace(/\s/g, '').length >= 16;
function fillTwoSided(K) {
  let filled = 0; const disputes = [];
  for (let n = 1; n <= N; n++) {
    if (base.has(n)) continue;
    let b = n; while (b <= N && !base.has(b)) b++;
    const gap = b - n;
    const before = []; for (let k = n - K; k < n; k++) before.push(base.get(k));
    const after = []; for (let k = b; k < b + K; k++) after.push(base.get(k));
    const haveBefore = n - K >= 1 && before.every((x) => x !== undefined);
    const haveAfter = b + K - 1 <= N && after.every((x) => x !== undefined);
    if (!(haveBefore && haveAfter) && !(n === 1 && haveAfter) && !(b === N + 1 && haveBefore)) { n = b; continue; }
    if (!distinctive([...(haveBefore ? before : []), ...(haveAfter ? after : [])])) { n = b; continue; }
    let pick = null; const cands = [];
    for (const [cls, runs] of classes) {
      for (const r of runs) {
        const L = r.lines;
        for (let i = 0; i + (haveBefore ? K : 0) + gap + (haveAfter ? K : 0) <= L.length; i++) {
          if (haveBefore && !before.every((x, j) => L[i + j] === x)) continue;
          const g0 = i + (haveBefore ? K : 0);
          if (haveAfter && !after.every((x, j) => L[g0 + gap + j] === x)) continue;
          if (!haveBefore && g0 !== 0 && n === 1) continue; // file start: the run must start there too... unknowable; skip
          cands.push({ cls, r, text: L.slice(g0, g0 + gap) });
          break;
        }
        if (cands.length >= 3) break;
      }
      if (cands.length && !pick) pick = cands[0];
      if (pick) break;
    }
    if (pick) {
      for (let k = 0; k < gap; k++) { base.set(n + k, pick.text[k]); srcOf.set(n + k, pick.cls); }
      filled += gap;
      const other = cands.find((c) => c.text.join('\n') !== pick.text.join('\n'));
      if (other) disputes.push(`${n}-${b - 1} ${pick.cls}:${pick.r.t} vs ${other.cls}:${other.r.t}`);
    }
    n = b;
  }
  return { filled, disputes };
}
function extendOneSided(K) {
  let filled = 0;
  for (let n = 1; n <= N; n++) {
    if (base.has(n)) continue;
    let b = n; while (b <= N && !base.has(b)) b++;
    const before = []; for (let k = n - K; k < n; k++) before.push(base.get(k));
    if (n - K >= 1 && before.every((x) => x !== undefined) && distinctive(before)) {
      for (const r of classA) {
        const L = r.lines; let hit = -1;
        for (let i = 0; i + K < L.length; i++) if (before.every((x, j) => L[i + j] === x)) { hit = i; break; }
        if (hit < 0) continue;
        let k = 0; while (n + k < b && hit + K + k < L.length) { base.set(n + k, L[hit + K + k]); srcOf.set(n + k, 'A1'); k++; filled++; }
        // Stop where the run ends; a run that ends early just leaves the rest for the next pass.
        if (k) break;
      }
    }
    n = b;
  }
  return filled;
}
let total = 0;
for (let round = 0; round < 6; round++) {
  const a = fillTwoSided(3); const c = a.filled ? 0 : extendOneSided(3);
  total += a.filled + c;
  if (a.disputes.length) console.log('  disputes', a.disputes.slice(0, 6).join('; '));
  if (!a.filled && !c) break;
}
const missing = []; for (let n = 1; n <= N; n++) if (!base.has(n)) missing.push(n);
const ranges = []; for (const n of missing) { if (ranges.length && ranges.at(-1)[1] === n - 1) ranges.at(-1)[1] = n; else ranges.push([n, n]); }
const cnt = {}; for (const v of srcOf.values()) cnt[v] = (cnt[v] ?? 0) + 1;
console.log(`  filled ${total}; by source ${JSON.stringify(cnt)}; still missing ${missing.length}: ${ranges.slice(0, 30).map(([a, b]) => a === b ? a : `${a}-${b}`).join(' ')}`);
const lines = []; for (let n = 1; n <= N; n++) lines.push(base.has(n) ? base.get(n) : `@@MISSING ${n}@@`);
writeFileSync(out, lines.join('\n') + '\n');
writeFileSync(out + '.src', [...Array(N)].map((_, i) => srcOf.get(i + 1) ?? '-').join('\n') + '\n');

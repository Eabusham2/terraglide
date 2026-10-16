// Whole-file views of a repo file at a moment: a `git diff` of it applied to the commit (tracked files),
// or a lone `cat FILE`. Each becomes a numbered fragment of every line.
import { execSync } from 'node:child_process';
const R = '/home/user/terraglide/';
const headCache = new Map();
function headLines(rel) {
  if (!headCache.has(rel)) { try { headCache.set(rel, execSync(`git -C /home/user/terraglide show 2c7ee70:${rel}`, { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }).toString().split('\n')); } catch { headCache.set(rel, null); } }
  const h = headCache.get(rel); if (!h) return null; const L = h.slice(); if (L.at(-1) === '') L.pop(); return L;
}
export function applyDiff(base, section) {
  const out = []; let at = 0; // index into base (0-based)
  const lines = section.split('\n');
  let i = 0; while (i < lines.length && !lines[i].startsWith('@@')) i++;
  if (i >= lines.length) return null;
  while (i < lines.length) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]); if (!m) { if (lines[i] === '' && i === lines.length - 1) break; return null; }
    const os = +m[1], ol = m[2] === undefined ? 1 : +m[2], nl = m[4] === undefined ? 1 : +m[4];
    const start = ol === 0 ? os : os - 1;
    while (at < start) out.push(base[at++]);
    i++; let seenO = 0, seenN = 0;
    while (i < lines.length && (seenO < ol || seenN < nl)) {
      const l = lines[i]; const op = l[0];
      if (l === '\\ No newline at end of file') { i++; continue; }
      if (op === ' ') { if (base[at] !== l.slice(1)) return null; out.push(base[at++]); seenO++; seenN++; }
      else if (op === '-') { if (base[at] !== l.slice(1)) return null; at++; seenO++; }
      else if (op === '+') { out.push(l.slice(1)); seenN++; }
      else if (l === '') { if (base[at] !== '') return null; out.push(base[at++]); seenO++; seenN++; } // a blank context line whose space was trimmed
      else return null;
      i++;
    }
    if (seenO !== ol || seenN !== nl) return null; // cut short
    while (i < lines.length && lines[i] === '\\ No newline at end of file') i++;
    if (i < lines.length && !lines[i].startsWith('@@')) break;
  }
  while (at < base.length) out.push(base[at++]);
  return out;
}
export function snapshots(rows, rel) {
  const out = [];
  // A tracked file as it was committed: the state before any of this work (the session's first day).
  const h = headLines(rel);
  if (h) { const m = new Map(); h.forEach((t, i) => m.set(i + 1, t)); out.push({ t: '2026-10-01T00:00:01.000Z', agent: 'git', src: 'commit 2c7ee70', lines: m, whole: h.length }); }
  const base = rel.split('/').pop();
  for (const r of rows) {
    if (r.name !== 'Bash' || !r.result || r.error || r.preview) continue;
    const cmd = r.input?.command ?? '';
    if (!cmd.includes(base)) continue;
    const cds = [...cmd.matchAll(/(?:^|[;&|\n]\s*)cd\s+(\S+)/g)].map((m) => m[1]);
    if (!cds.every((d) => d === '/home/user/terraglide' || d === R)) continue;
    // git diff sections
    const key = `diff --git a/${rel} b/${rel}\n`;
    let k = r.result.indexOf(key);
    // A diff cut by head/tail/sed may end between hunks and still apply: only trust it when the output is shorter
    // than the cut (so nothing was cut).
    const cut = [...cmd.matchAll(/git (?:-C \S+ )?diff[^;&|\n]*\|\s*(?:head\s+-n?\s*(\d+)|head\s+-(\d+)|sed -n ['"]?(\d+),(\d+)p|tail\b)/g)];
    const outLines = r.result.split('\n').length;
    const wasCut = cut.some((m) => (m[1] || m[2]) ? outLines >= +(m[1] || m[2]) - 1 : true);
    if (k >= 0 && !wasCut && /\bgit (-C \S+ )?diff\b/.test(cmd) && !/--stat|--name|-U\d|--word|--color/.test(cmd)) {
      let end = r.result.indexOf('\ndiff --git ', k + 1); const sec = r.result.slice(k, end < 0 ? undefined : end + 1);
      const h = headLines(rel);
      // a cut-short tail (head -N) is caught by the hunk counts in applyDiff
      const L = h && applyDiff(h, sec);
      if (L) { const m = new Map(); L.forEach((t, i) => m.set(i + 1, t)); out.push({ t: r.t, agent: r.agent, src: 'git diff (whole file)', lines: m, whole: L.length }); }
    }
    // a lone cat of the file
    const c = /^cat\s+(\S+)$/.exec(cmd.trim());
    if (c && (c[1] === rel || c[1] === './' + rel || c[1] === R + rel)) {
      const L = r.result.split('\n'); if (L.at(-1) === '') L.pop();
      const m = new Map(); L.forEach((t, i) => m.set(i + 1, t)); out.push({ t: r.t, agent: r.agent, src: 'cat (whole file)', lines: m, whole: L.length });
    }
  }
  return out;
}

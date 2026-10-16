// A file's whole history as a pool spec: versions split at every logged edit (Edit/Write tool calls, python
// edits, my patches after T0) and at every change in its recorded line count (an edit nobody logged). Views
// between the last record of one count and the first of the next are left out of both windows.
// Usage: node chain.mjs <rel> <out.json> [finalCount]
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadRows } from './frags.mjs';
import { part } from './splitdiff.mjs';
const [rel, out, finalArg] = process.argv.slice(2);
const R = '/home/user/terraglide/';
const END = '2026-10-12T20:00:00';
const rows = loadRows();
const inRepoCmd = (cmd) => [...cmd.matchAll(/(?:^|[;&|\n]\s*)cd\s+(\S+)/g)].map((m) => m[1]).every((d) => d === '/home/user/terraglide' || d === R);
// 1. Exact edits.
const steps = [];
const patches = { '2026-10-11T21:03:02': ['diffs/skeptic7.diff', 'diffs/swing.diff'], '2026-10-12T02:02:30': ['diffs/x7.diff'], '2026-10-12T03:06:48': ['diffs/fix.diff'], '2026-10-12T08:08:20': ['diffs/atk6.game.diff'] };
const OFFSETS = { 'diffs/swing.diff': { 'tools/servertest.mjs': { 1: 15 } } };
for (const r of rows) {
  const t = r.t.slice(0, 19);
  if (r.error) continue;
  if ((r.name === 'Edit' || r.name === 'MultiEdit') && r.input?.file_path === R + rel) {
    const eds = r.input.edits ?? [r.input];
    steps.push({ t: r.t, kind: 'replace', edits: eds.map((e) => ({ old: e.old_string, new: e.new_string, all: !!e.replace_all })) });
    continue;
  }
  if (r.name === 'Write' && r.input?.file_path === R + rel) { steps.push({ t: r.t, kind: 'write', n: r.input.content.split('\n').length - (r.input.content.endsWith('\n') ? 1 : 0) }); continue; }
  if (r.name !== 'Bash') continue;
  const cmd = r.input?.command ?? '';
  if (r.agent === 'main' && patches[t]) {
    for (const f of patches[t]) {
      let { body, net } = part(f, rel); if (!body.trim()) continue;
      const off = OFFSETS[f]?.[rel];
      if (off) { let k = 0; body = body.replace(/^@@ -(\d+)(,\d+)? \+(\d+)(,\d+)? @@/gm, (m, a, b, c, d) => { k++; const o = off[k] ?? 0; return `@@ -${+a + o}${b ?? ''} +${+c + o}${d ?? ''} @@`; }); }
      const pf = `diffs/${f.split('/').pop().replace('.diff', '')}.${rel.replace(/\//g, '_')}.diff`; writeFileSync(pf, body);
      steps.push({ t: r.t, kind: 'diff', file: pf, delta: net });
    }
    continue;
  }
  if (!cmd.includes(rel.split('/').pop()) || !/python3 - <</.test(cmd)) continue;
  // python edits on the repo's file: p='rel' with the repo as cwd, or p='/home/user/terraglide/rel'
  for (const m of cmd.matchAll(/python3 - <<'?EOF'?\n([\s\S]*?)\nEOF/g)) {
    let eds; try { eds = JSON.parse(execFileSync('python3', ['-I', 'tools/pyedits.py'], { input: m[1] }).toString()); } catch { continue; }
    eds = eds.filter((e) => e.path === R + rel || (e.path === rel && inRepoCmd(cmd)));
    if (!eds.length) continue;
    const ok = eds.filter((e) => !e.unparsed);
    if (ok.length !== eds.length) steps.push({ t: r.t, kind: 'opaque' });
    else steps.push({ t: r.t, kind: 'replace', edits: ok.map(({ old, new: nw }) => ({ old, new: nw })) });
  }
}
for (const s of steps) if (s.kind === 'replace') s.delta = s.edits.reduce((d, e) => d + (e.new.split('\n').length - e.old.split('\n').length), 0);
// 2. Recorded counts (wc -l in the repo), and whole views' lengths.
const counts = [];
for (const r of rows) { if (r.name !== 'Bash' || !r.result || !/wc -l|wc\s/.test(r.input?.command ?? '')) continue;
  if (!inRepoCmd(r.input.command)) continue;
  for (const l of r.result.split('\n')) { const m = /^\s*(\d+)\s+(\S+)$/.exec(l); if (m && (m[2] === rel || m[2] === './' + rel || m[2] === R + rel) && /wc -l/.test(r.input.command)) counts.push({ t: r.t, n: +m[1] }); } }
// whole views (a git diff applied, a lone cat, a Read to the end from line 1) say the length too
{
  const { fragments } = await import('./frags.mjs');
  for (const f of fragments(rows, rel)) if (f.whole && !f.hyps) counts.push({ t: f.t, n: f.whole, whole: true });
}
counts.sort((a, b) => (a.t < b.t ? -1 : 1));
// 3. Boundaries: exact steps, and count changes not explained by an exact step in between.
const bounds = steps.map((s) => ({ t: s.t, step: s }));
for (let i = 1; i < counts.length; i++) {
  if (counts[i].n === counts[i - 1].n) continue;
  const between = steps.filter((s) => s.t > counts[i - 1].t && s.t <= counts[i].t);
  const explained = between.length && between.every((s) => s.delta != null) && between.reduce((d, s) => d + s.delta, 0) === counts[i].n - counts[i - 1].n;
  if (explained) continue;
  // It happened somewhere after the last record of the old count and before the first of the new: the new
  // version starts at the new record; views in between belong to no window (see below).
  let at = counts[i].t;
  if (process.env.CHAIN_MODE === 'late') {
    // Alternative: the unlogged change came after the logged edits in between, and (all mine after T0 being
    // logged) before T0.
    const T0 = '2026-10-10T03:33:00';
    const cap = counts[i].t < T0 ? counts[i].t : T0;
    const lastStep = steps.filter((s) => s.t > counts[i - 1].t && s.t < cap).map((s) => s.t).sort().at(-1);
    if (counts[i - 1].t < T0) at = new Date(new Date(lastStep ?? counts[i - 1].t).getTime() + 1000).toISOString();
  }
  bounds.push({ t: at, unknown: true, after: counts[i - 1].t });
}
bounds.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
const versions = [{ name: 'V0', from: '2026-10-01T00:00:00', to: bounds[0]?.t ?? END }];
bounds.forEach((b, i) => {
  versions.push({ name: `V${i + 1}`, from: b.t, to: bounds[i + 1]?.t ?? END });
});
// Views between an unlogged change's two count records are ambiguous: cut them out of every window.
if (process.env.CHAIN_MODE !== 'late') for (const b of bounds) if (b.unknown) for (const v of versions) {
  if (v.from >= b.t) continue;
  if (v.to > b.after) v.to = v.from > b.after ? v.from : new Date(new Date(b.after).getTime() + 1000).toISOString();
}
// counts: from records inside each window, else carried by exact deltas
for (const v of versions) { const c = counts.filter((x) => x.t >= v.from && x.t < v.to); if (c.length) v.count = c.at(-1).n; }
if (finalArg) versions.at(-1).count = +finalArg;
for (let pass = 0; pass < 3; pass++) bounds.forEach((b, i) => {
  const A = versions[i], B = versions[i + 1];
  if (b.step?.delta != null) { if (A.count != null && B.count == null) B.count = A.count + b.step.delta; if (B.count != null && A.count == null) A.count = B.count - b.step.delta; }
  if (b.step?.kind === 'write' && B.count == null) B.count = b.step.n;
});
const spec = { rel, versions: versions.filter((v) => v.count != null), diffs: [], replaces: [], unknown: [] };
const names = new Set(spec.versions.map((v) => v.name));
bounds.forEach((b, i) => {
  const e = { from: `V${i}`, to: `V${i + 1}` }; if (!names.has(e.from) || !names.has(e.to)) return;
  if (b.unknown || b.step.kind === 'write' || b.step.kind === 'opaque') spec.unknown.push(e);
  else if (b.step.kind === 'diff') spec.diffs.push({ ...e, file: b.step.file });
  else spec.replaces.push({ ...e, edits: b.step.edits });
});
// Across a run of unlogged edits, also join each version to the next two: one with no views of its own must
// not cut the others off from each other.
// Line up each version with the next six directly too (whatever lies between: the equal-spacing rule only copies
// stretches nothing changed), so a version with few views of its own does not cut the chain.
for (let i = 0; i < spec.versions.length; i++) for (let j = i + 2; j <= i + 6 && j < spec.versions.length; j++) {
  spec.unknown.push({ from: spec.versions[i].name, to: spec.versions[j].name });
}
writeFileSync(out, JSON.stringify(spec, null, 1));
for (const v of versions) { const b = bounds[+v.name.slice(1) - 1]; console.log(v.name.padEnd(4), v.from.slice(5, 19), '→', v.to.slice(5, 19), String(v.count ?? '?').padStart(5), b ? (b.unknown ? 'unknown edit' : `${b.step.kind}${b.step.delta != null ? ' ' + (b.step.delta >= 0 ? '+' : '') + b.step.delta : ''}`) : ''); }

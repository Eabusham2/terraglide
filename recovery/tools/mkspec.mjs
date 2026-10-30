// Build a pool spec for one file from my logged main-chat edits after T0 (python s.replace, the exact diffs,
// sed -i line edits given by hand). Line counts come from one known count at one version, by the edits' deltas.
// Usage: node mkspec.mjs <rel> <anchorTime> <anchorCount> <out.json> [extra.json]
//   anchorTime: a time at which the file had anchorCount lines (e.g. a wc -l record).
//   extra.json: [{t, edits:[{old,new}]}] for edits that are not python replaces or diffs (sed -i ...).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadRows } from './frags.mjs';
import { part } from './splitdiff.mjs';
const [rel, anchorTime, anchorCount, out, extraPath] = process.argv.slice(2);
const T0 = '2026-10-10T03:33:00';
const END = '2026-10-12T20:00:00';
const rows = loadRows().filter((r) => r.agent === 'main' && r.t >= T0 && r.name === 'Bash');
const patches = { '2026-10-11T21:03:02': ['diffs/skeptic7.diff', 'diffs/swing.diff'], '2026-10-12T02:02:30': ['diffs/x7.diff'], '2026-10-12T03:06:48': ['diffs/fix.diff'] };
const steps = []; // {t, kind, edits|file, delta}
for (const r of rows) {
  const t = r.t.slice(0, 19);
  const cmd = r.input.command;
  const cds = [...cmd.matchAll(/(?:^|[;&|\n]\s*)cd\s+(\S+)/g)].map((m) => m[1]);
  if (cds.some((d) => d !== '/home/user/terraglide')) { if (!patches[t]) continue; }
  if (patches[t]) {
    // Where patch said a hunk landed elsewhere ("Hunk #1 succeeded at 1039 (offset 15 lines)"), move its header.
    const OFFSETS = { 'diffs/swing.diff': { 'tools/servertest.mjs': { 1: 15 } } };
    for (const f of patches[t]) {
      let { body, net } = part(f, rel); if (!body.trim()) continue;
      const off = OFFSETS[f]?.[rel];
      if (off) { let k = 0; body = body.replace(/^@@ -(\d+)(,\d+)? \+(\d+)(,\d+)? @@/gm, (m, a, b, c, d) => { k++; const o = off[k] ?? 0; return `@@ -${+a + o}${b ?? ''} +${+c + o}${d ?? ''} @@`; }); }
      const pf = `diffs/${f.split('/').pop().replace('.diff', '')}.${rel.replace(/\//g, '_')}.diff`; writeFileSync(pf, body); steps.push({ t, kind: 'diff', file: pf, delta: net });
    }
    continue;
  }
  for (const m of cmd.matchAll(/python3 - <<'EOF'\n([\s\S]*?)\nEOF/g)) {
    const eds = JSON.parse(execFileSync('python3', ['-I', 'tools/pyedits.py'], { input: m[1] }).toString()).filter((e) => e.path === rel);
    if (!eds.length) continue;
    if (eds.some((e) => e.unparsed)) console.log('UNPARSED edit at', t, eds.filter((e) => e.unparsed).map((e) => e.unparsed).join(' | '));
    const ok = eds.filter((e) => !e.unparsed);
    steps.push({ t, kind: 'replace', edits: ok.map(({ old, new: nw }) => ({ old, new: nw })), delta: ok.reduce((d, e) => d + e.new.split('\n').length - e.old.split('\n').length, 0) });
  }
}
if (extraPath && existsSync(extraPath)) for (const x of JSON.parse(readFileSync(extraPath, 'utf8'))) steps.push({ t: x.t, kind: 'replace', edits: x.edits, delta: x.edits.reduce((d, e) => d + e.new.split('\n').length - e.old.split('\n').length, 0) });
steps.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
// versions: V0 before the first step, then one after each step; a version's window runs to the next step's time
const versions = [{ name: 'V0', from: T0, to: steps[0]?.t ?? END }];
steps.forEach((s, i) => versions.push({ name: `V${i + 1}`, from: s.t, to: steps[i + 1]?.t ?? END }));
// two steps at the same time: the in-between version has an empty window
// counts: find the version current at anchorTime
const ai = versions.findIndex((v) => anchorTime >= v.from && anchorTime < v.to);
if (ai < 0) throw new Error('anchor time is in no version');
versions[ai].count = +anchorCount;
for (let i = ai + 1; i < versions.length; i++) versions[i].count = versions[i - 1].count + steps[i - 1].delta;
for (let i = ai - 1; i >= 0; i--) versions[i].count = versions[i + 1].count - steps[i].delta;
const spec = { rel, versions, diffs: [], replaces: [] };
steps.forEach((s, i) => { const e = { from: `V${i}`, to: `V${i + 1}` }; if (s.kind === 'diff') spec.diffs.push({ ...e, file: s.file }); else spec.replaces.push({ ...e, edits: s.edits }); });
writeFileSync(out, JSON.stringify(spec, null, 1));
for (const [i, v] of versions.entries()) console.log(v.name, v.from.slice(5), '→', v.to.slice(5), v.count, i ? `${steps[i - 1].kind} ${steps[i - 1].delta >= 0 ? '+' : ''}${steps[i - 1].delta}` : '');

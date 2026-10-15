// Numbered grep output inside mixed commands, checked against the pooled versions.
// usage: node mixgrep.mjs REL  -> prints runs that agree with a version and add lines it lacks
import { readFileSync } from 'node:fs';
import { loadRows } from './frags.mjs';
const rel = process.argv[2]; const base = rel.replace(/\//g, '_');
const spec = JSON.parse(readFileSync(`specs/${base}.safe.chain.json`, 'utf8'));
const vers = spec.versions.map((v) => {
  let lines = null;
  for (const f of [`out/t/${base}.${v.name}.js`]) { try { lines = readFileSync(f, 'utf8').split('\n'); } catch {} }
  return { ...v, lines };
});
const extra = process.argv[3]; // optional: final file to use for the last version
if (extra) vers.at(-1).lines = readFileSync(extra, 'utf8').split('\n');
const M = (l) => l == null || /^@@MISSING \d+@@$/.test(l);
const verAt = (t) => vers.find((v) => t >= v.from && t <= v.to);
const name = rel.split('/').pop();
const rows = loadRows();
const found = [];
for (const r of rows) {
  if (r.name !== 'Bash' || !r.result || r.error) continue;
  const cmd = r.input?.command ?? '';
  if (!cmd.includes(name)) continue;
  // a grep -n whose last argument is this file
  const re = new RegExp(String.raw`grep\s[^|;&\n]*-\w*n[^|;&\n]*\s(\S*${name.replace('.', '\\.')})(\s|$|\|)`);
  if (!re.test(cmd)) continue;
  const v = verAt(r.t); if (!v || !v.lines) continue;
  // runs of numbered lines
  const out = r.result.split('\n');
  let run = [];
  const flush = () => {
    if (run.length) {
      let agree = 0, conflict = 0, adds = [];
      for (const [n, s] of run) {
        const k = v.lines[n - 1];
        if (M(k)) adds.push([n, s]); else if (k === s) agree++; else conflict++;
      }
      if (adds.length) found.push({ t: r.t, v: v.name, agree, conflict, adds, cmd: cmd.slice(0, 160) });
    }
    run = [];
  };
  let last = 0;
  for (const l of out) {
    const x = /^(\d+)[:-](.*)$/s.exec(l);
    if (x) { const n = +x[1]; if (n <= last) flush(); run.push([n, x[2]]); last = n; continue; }
    if (l === '--') continue;
    flush(); last = 0;
  }
  flush();
}
for (const f of found) {
  console.log(`${f.t} ${f.v} agree=${f.agree} conflict=${f.conflict} adds=${f.adds.length}  ${f.cmd.replace(/\n/g, ' ')}`);
  for (const [n, s] of f.adds) console.log(`   ${n}| ${s}`);
}

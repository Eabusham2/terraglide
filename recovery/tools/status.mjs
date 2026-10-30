// Per-file recovery status table.
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { loadRows, fragments } from './frags.mjs';
const rows = loadRows();
const R = '/home/user/terraglide/';
const repo = '/home/user/terraglide';
// targets: latest wc -l in repo cwd
const target = {};
for (const r of rows) { if (r.name !== 'Bash' || !r.result || !/wc -l/.test(r.input?.command ?? '')) continue;
  const c = r.input.command; const cds = [...c.matchAll(/(?:^|[;&|\n]\s*)cd\s+(\S+)/g)].map((m) => m[1]); if (!cds.every((d) => d === repo)) continue;
  for (const l of r.result.split('\n')) { const m = /^\s*(\d+)\s+((?:\.\/)?[\w./-]+\.\w+)$/.exec(l); if (!m) continue; const f = m[2].replace(/^\.\//, '').replace(R, ''); if (f.startsWith('/')) continue; target[f] = { n: +m[1], t: r.t.slice(5, 16) }; } }
// full snapshots: Read without offset/limit (if under 2000 lines), Write
const full = {};
for (const r of rows) {
  if (r.error || !r.input?.file_path?.startsWith(R)) continue;
  const f = r.input.file_path.slice(R.length);
  if (r.name === 'Read' && r.input.offset == null && r.input.limit == null && r.result) { const n = r.result.split('\n').filter((l) => /^\d+\t/.test(l)).length; full[f] = { t: r.t.slice(5, 16), n, how: n >= 2000 ? 'Read(cut at 2000)' : 'Read' }; }
  if (r.name === 'Write') full[f] = { t: r.t.slice(5, 16), n: r.input.content.split('\n').length - 1, how: 'Write' };
}
const head = (f) => { try { return execSync(`git -C ${repo} show 2c7ee70:${f} | wc -l`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return '-'; } };
const files = [...new Set([...Object.keys(target), ...Object.keys(full)])].sort();
const pm = readFileSync('pastemap.txt', 'utf8').trim().split('\n').map((l) => l.split(' '));
const out = ['| file | target lines (when) | at 2c7ee70 | in repo now | last full copy in logs | sightings after it | pastes |', '|---|---|---|---|---|---|---|'];
for (const f of files) {
  const tg = target[f]; const h = head(f);
  const now = existsSync(`${repo}/${f}`) ? execSync(`wc -l < ${repo}/${f}`).toString().trim() : '-';
  const fu = full[f];
  const fr = fragments(rows, f).filter((x) => !fu || x.t.slice(5, 16) > fu.t);
  const pastes = pm.filter(([, rel]) => rel === f).map(([p]) => p).join(' ');
  if (tg && h !== '-' && +h === tg.n && !fu && !pastes) continue; // tracked, same count as the commit: probably unchanged
  out.push(`| ${f} | ${tg ? `${tg.n} (${tg.t})` : '?'} | ${h} | ${now} | ${fu ? `${fu.how} ${fu.n} (${fu.t})` : '-'} | ${fr.length} | ${pastes} |`);
}
console.log(out.join('\n'));

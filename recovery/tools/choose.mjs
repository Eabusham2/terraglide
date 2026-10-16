// Merge the safe and late rebuilds of each file: lines both know must agree; a line one knows fills the other.
// Then check the merge against every view in the safe chain's final window.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const files = readFileSync('open_files.txt', 'utf8').trim().split(/\s+/);
for (const rel of files) {
  const k = rel.replace(/\//g, '_');
  const a = existsSync(`out/chain/${k}`) ? readFileSync(`out/chain/${k}`, 'utf8').split('\n') : null;
  const b = existsSync(`out/late/${k}`) ? readFileSync(`out/late/${k}`, 'utf8').split('\n') : null;
  if (!a || !b) { console.log(rel, 'missing output'); continue; }
  if (a.length !== b.length) { console.log(rel.padEnd(32), `lengths differ ${a.length - 1} vs ${b.length - 1}`); continue; }
  const M = /^@@MISSING \d+@@$/;
  let disagree = 0; const where = []; const out = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (M.test(x) && M.test(y)) out.push(x);
    else if (M.test(x)) out.push(y); else if (M.test(y)) out.push(x);
    else if (x === y) out.push(x);
    else { disagree++; if (where.length < 4) where.push(i + 1); out.push(x); }
  }
  const missing = out.filter((l) => M.test(l)).length;
  writeFileSync(`out/merged/${k}`, out.join('\n'));
  const spec = JSON.parse(readFileSync(`specs/${k}.safe.chain.json`, 'utf8'));
  const from = spec.versions.at(-1).from;
  let v = ''; try { v = execFileSync('node', ['verify.mjs', rel, `out/merged/${k}`, from], { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch {}
  const mism = v.split('\n').filter((l) => /MISMATCH/.test(l) && !/have "@@MISSING/.test(l));
  console.log(rel.padEnd(32), 'lines', String(out.length - 1).padStart(5), 'missing', String(missing).padStart(5), 'disagree', String(disagree).padStart(4), where.join(','), '| final-window views', (v.trim().split('\n').at(-1) || '').replace(/^.*?: /, ''), mism.length ? `| ${mism.length} MISMATCH e.g. ${mism[0].slice(0, 120)}` : '');
}

// Full-history rebuild of every file still open: chain.mjs then pool.mjs on its last version.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const files = process.argv.slice(2);
for (const rel of files) {
  const key = rel.replace(/\//g, '_');
  let log = '';
  try { log = execFileSync('node', ['chain.mjs', rel, `specs/${key}.${process.env.CHAIN_MODE ?? 'safe'}.chain.json`], { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch (e) { console.log(rel, 'chain failed', e.message.slice(0, 200)); continue; }
  const spec = JSON.parse(readFileSync(`specs/${key}.${process.env.CHAIN_MODE ?? 'safe'}.chain.json`, 'utf8'));
  const last = spec.versions.at(-1);
  if (!last) { console.log(rel, 'no versions with a count'); continue; }
  let out = '';
  try { out = execFileSync('node', ['pool.mjs', `specs/${key}.${process.env.CHAIN_MODE ?? 'safe'}.chain.json`, last.name, `${process.env.OUT ?? 'out/chain'}/${key}`], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26, timeout: 600000 }).toString(); } catch (e) { console.log(rel, 'pool failed', e.message.slice(0, 200)); continue; }
  const miss = new RegExp(`^${last.name}: missing (\\d+)`, 'm').exec(out);
  const conf = out.split('\n').filter((l) => /^after filling/.test(l) && !/conflicts 0/.test(l)).length;
  const whole = /lines from a whole copy of (\S+)/.exec(out);
  console.log(rel.padEnd(34), 'versions', String(spec.versions.length).padStart(3), 'last', last.from.slice(5, 16), String(last.count).padStart(5), 'missing', String(miss?.[1] ?? '?').padStart(5), conf ? `CONFLICTS in ${conf} versions` : '', whole ? 'whole@' + whole[1].slice(5, 16) : '');
}

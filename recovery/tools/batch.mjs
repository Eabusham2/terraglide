// Rebuild every file: one version from Oct 10 03:33 to the end (no edits after T0), with the latest recorded
// line count, filled from all sources. Files with edits after T0 get their own chain (mkspec) separately.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const T0 = '2026-10-10T03:33:00', END = '2026-10-12T20:00:00';
const status = readFileSync('status.md', 'utf8').split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| file') );
const only = process.argv.slice(2);
const res = [];
for (const l of status) {
  const cols = l.split('|').map((c) => c.trim());
  const rel = cols[1]; const m = /^(\d+) \((\S+)\)$/.exec(cols[2]); if (!m) continue;
  if (only.length && !only.includes(rel)) continue;
  if (['server/game.mjs', 'server/ws.mjs', 'tools/servertest.mjs', 'HOSTING.md', 'server/commands.mjs', 'src/net/session.js', 'tools/selftest.mjs'].includes(rel)) continue;
  const count = +m[1], when = m[2];
  // Views are of the final version from the last recorded count on (or from T0, if that came later).
  const from = `2026-${when}:00` < T0 ? `2026-${when}:00` : T0;
  const spec = { rel, versions: [{ name: 'F', from, to: END, count }], diffs: [], replaces: [] };
  const sp = `specs/${rel.replace(/\//g, '_')}.json`; writeFileSync(sp, JSON.stringify(spec));
  const outp = `out/batch/${rel.replace(/\//g, '_')}`;
  let txt = '';
  try { txt = execFileSync('node', ['pool.mjs', sp, 'F', outp], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }).toString(); } catch (e) { txt = 'ERROR ' + e.message.slice(0, 200); }
  const known0 = /^F \(\d+\): known (\d+), conflicts (\d+)/m.exec(txt);
  const miss = /^F: missing (\d+)/m.exec(txt);
  res.push({ rel, count, when, win: known0 ? +known0[1] : null, conf: known0 ? +known0[2] : null, missing: miss ? +miss[1] : null });
  console.log(rel.padEnd(36), String(count).padStart(5), when, 'window', known0?.[1], 'conflicts', known0?.[2], 'missing', miss?.[1]);
}
writeFileSync('out/batch/_summary.json', JSON.stringify(res, null, 1));

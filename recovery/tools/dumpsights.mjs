// Dump every pre-wipe line-numbered sighting of each file (best hypothesis for cut ones) to JSON for align.
import { fragments, loadRows } from './frags.mjs';
import { grepNumbered } from './runs.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
const R = '/home/user/terraglide/';
const rows = loadRows().filter((r) => r.t < '2026-10-12T20:03');
let rels = process.argv.slice(3);
if (!rels.length) rels = execSync(`git -C ${R} diff --name-only 2c7ee70 HEAD`).toString().split('\n').filter((f) => f && !f.startsWith('recovery/') && existsSync(R + f));
const out = {};
for (const rel of rels) {
  const cur = readFileSync(R + rel, 'utf8').split('\n');
  const frs = [...fragments(rows, rel), ...grepNumbered(rows, rel)].filter((f) => f.agent !== 'git');
  out[rel] = frs.map((f) => {
    let m = f.lines;
    if (f.hyps) { // the hypothesis that agrees most with the file now, anywhere
      const set = new Set(cur); let best = null, bs = -1;
      for (const h of f.hyps) { let s = 0; for (const t of h.values()) if (set.has(t)) s++; if (s > bs) { bs = s; best = h; } }
      m = best ?? new Map();
    }
    return { t: f.t, agent: f.agent, src: f.src, hyp: !!f.hyps, lines: [...m].sort((a, b) => a[0] - b[0]) };
  }).filter((x) => x.lines.length);
}
writeFileSync(process.argv[2], JSON.stringify(out));
console.log('files', Object.keys(out).length, 'sightings', Object.values(out).reduce((n, a) => n + a.length, 0));

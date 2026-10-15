// Every recorded `wc -l` of a repo file (repo cwd), with time.
import { loadRows } from './frags.mjs';
const rel = process.argv[2]; const R = '/home/user/terraglide/';
for (const r of loadRows()) { if (r.name !== 'Bash' || !r.result || !/wc\b/.test(r.input?.command ?? '')) continue;
  const c = r.input.command; const cds = [...c.matchAll(/(?:^|[;&|\n]\s*)cd\s+(\S+)/g)].map((m) => m[1]); if (!cds.every((d) => d === '/home/user/terraglide')) continue;
  for (const l of r.result.split('\n')) { const m = /^\s*(\d+)\s+(\S+)$/.exec(l); if (m && (m[2] === rel || m[2] === './' + rel || m[2] === R + rel)) console.log(r.t.slice(0, 19), r.agent.slice(0, 8), m[1]); } }

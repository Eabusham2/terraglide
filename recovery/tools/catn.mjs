// Split a `cat -n A && echo ---- && cat -n B ...` output into files: numbering restarts at 1 for each file.
// Usage: node catn.mjs <time-prefix> <agent-prefix> <outdir> <file1> <file2> ...
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadRows } from './frags.mjs';
const [tp, ap, dir, ...files] = process.argv.slice(2);
const r = loadRows().find((x) => x.t.startsWith(tp) && x.agent.startsWith(ap) && x.name === 'Bash');
const parts = []; let cur = null;
for (const line of r.result.split('\n')) {
  const m = /^\s*(\d+)\t(.*)$/s.exec(line);
  if (!m) { if (cur && line !== '----') cur.junk.push(line); continue; }
  if (+m[1] === 1) { cur = { lines: [], junk: [] }; parts.push(cur); }
  if (cur && +m[1] === cur.lines.length + 1) cur.lines.push(m[2]); else if (cur) cur.junk.push('BAD ' + line);
}
console.log(r.t, 'parts', parts.length, 'files', files.length);
parts.forEach((p, i) => { const f = files[i] ?? `part${i}`; const out = `${dir}/${f}`; mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true }); writeFileSync(out, p.lines.join('\n') + '\n'); console.log(f, p.lines.length, 'lines', p.junk.length ? 'junk:' + JSON.stringify(p.junk.slice(0, 3)) : ''); });

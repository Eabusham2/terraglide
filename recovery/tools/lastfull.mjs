// For each repo file: its latest full Read, and every change to it recorded after that read.
import { readFileSync } from 'node:fs';
const rows = readFileSync('calls.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const R = '/home/user/terraglide/';
const last = new Map();
for (const r of rows) if (r.name === 'Read' && r.input?.file_path?.startsWith(R) && r.input.offset == null && r.input.limit == null && r.result && !r.error) last.set(r.input.file_path.slice(R.length), r);
const changes = (rel, after) => rows.filter((r) => r.t > after && (
  ((r.name === 'Edit' || r.name === 'Write') && r.input?.file_path === R + rel) ||
  (r.name === 'Bash' && (r.input?.command ?? '').includes(rel) && /python3|sed -i|patch |cp |mv |> *[^&]*\b|tee /.test(r.input.command) && !/cd \/tmp|scratchpad\/[a-z0-9]+\/copy/.test(r.input.command))));
for (const [rel, r] of [...last].sort()) {
  const ch = changes(rel, r.t);
  console.log(`${r.t.slice(5, 16)} ${String(r.result.split('\n').length).padStart(5)}L  later changes: ${String(ch.length).padStart(2)}  ${rel}`);
}

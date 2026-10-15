// Write a file's content from a stored Read result (format "N\tline"). Usage: node readfull.mjs <repo-relative path> <out> [ISO time or 'last']
import { readFileSync, writeFileSync } from 'node:fs';
const [rel, out, when = 'last'] = process.argv.slice(2);
const rows = readFileSync('calls.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const reads = rows.filter((r) => r.name === 'Read' && r.input?.file_path === `/home/user/terraglide/${rel}` && r.input.offset == null && r.input.limit == null && r.result);
const r = when === 'last' ? reads.at(-1) : reads.find((x) => x.t.startsWith(when));
if (!r) { console.log('no full read of', rel); process.exit(1); }
const lines = [];
for (const line of r.result.split('\n')) {
  const m = /^(\d+)\t(.*)$/s.exec(line);
  if (m) lines[Number(m[1]) - 1] = m[2]; else if (line.startsWith('<system-reminder>')) break;
}
const missing = lines.findIndex((l) => l === undefined);
console.log(rel, 'from', r.t, r.agent, 'lines', lines.length, missing >= 0 ? `GAP at ${missing + 1}` : 'no gaps');
if (lines.at(-1) === '') lines.pop();
writeFileSync(out, lines.join('\n') + '\n');

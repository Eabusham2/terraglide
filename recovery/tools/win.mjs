import { loadRows } from './frags.mjs';
const rows = loadRows();
const [from, to, pat] = process.argv.slice(2);
for (const r of rows) {
  if (r.t < from || r.t > to) continue;
  const s = JSON.stringify(r.input ?? {});
  if (!s.includes(pat)) continue;
  console.log(r.t, r.agent?.slice(0,8), r.name, s.slice(0, 300).replace(/\\n/g,' ⏎ '));
}

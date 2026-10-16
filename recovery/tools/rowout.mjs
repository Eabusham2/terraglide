// print the output of logged Bash rows whose command matches a regex, with the time
import { loadRows } from './frags.mjs';
const re = new RegExp(process.argv[2]); const since = process.argv[3] ?? ''; const until = process.argv[4] ?? '9999';
for (const r of loadRows()) {
  if (r.name !== 'Bash' || r.t < since || r.t > until) continue;
  const c = r.input?.command ?? ''; if (!re.test(c)) continue;
  console.log(`######## ${r.t} ${r.agent ?? ''}\n$ ${c}\n${r.result}`);
}

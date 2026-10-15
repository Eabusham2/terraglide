// Print the part of a unified diff for one file, and its net line change.
import { readFileSync } from 'node:fs';
export function part(diffPath, rel) {
  const lines = readFileSync(diffPath, 'utf8').split('\n'); const out = []; let on = false;
  for (const l of lines) { if (l.startsWith('--- ')) on = l === `--- a/${rel}`; if (on) out.push(l); }
  const body = out.join('\n') + '\n';
  let net = 0; for (const l of out) if (/^@@/.test(l)) { const m = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(l); net += +(m[2] ?? 1) - +(m[1] ?? 1); }
  return { body, net };
}
if (process.argv[2]) { const { body, net } = part(process.argv[2], process.argv[3]); if (process.argv[4]) (await import('node:fs')).writeFileSync(process.argv[4], body); console.log(process.argv[3], 'net', net); }

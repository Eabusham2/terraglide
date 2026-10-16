// Run every collected selftest regex that reads VAR (e.g. gameSrc|game|gameSource) against FILE.
import { readFileSync } from 'node:fs';
const [file, vars] = process.argv.slice(2);
const src = readFileSync(file, 'utf8');
const lines = readFileSync('/home/user/terraglide/recovery/selftest_regexes.txt', 'utf8').split('\n');
const re = new RegExp(String.raw`(!?)\/((?:\\.|[^/\\\n])+)\/([gimsuy]*)\.test\((?:${vars})\)`, 'g');
let n = 0, bad = 0;
for (const l of lines) {
  let m; re.lastIndex = 0;
  while ((m = re.exec(l))) {
    n++;
    let ok;
    try { ok = new RegExp(m[2], m[3]).test(src); } catch (e) { console.log('BAD REGEX', m[2]); continue; }
    if (m[1] === '!') ok = !ok;
    if (!ok) { bad++; console.log('FAIL', l.slice(0, 16), m[0].slice(0, 160)); }
  }
}
console.log(`${n} regexes, ${bad} failing`);

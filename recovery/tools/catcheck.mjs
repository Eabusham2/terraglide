// Does a plain `cat a b c` output equal the concatenation of candidate files? Reports the first difference.
import { readFileSync } from 'node:fs';
import { loadRows } from './frags.mjs';
const [tp, ap, ...files] = process.argv.slice(2);
const r = loadRows().find((x) => x.t.startsWith(tp) && x.agent.startsWith(ap) && x.name === 'Bash');
const want = files.map((f) => readFileSync(f, 'utf8')).join('');
const got = r.result;
const norm = (s) => s.replace(/^\n+/, '').replace(/\s+$/, '');
console.log(r.t, JSON.stringify(r.input.command).slice(0, 100));
if (norm(want).startsWith(norm(got).slice(0, norm(want).length)) && norm(got).startsWith(norm(want))) { console.log('  SAME for these files; extra output after:', norm(got).length - norm(want).length, 'chars'); }
else { const W = norm(want).split('\n'), G = norm(got).split('\n'); let i = 0; while (i < W.length && W[i] === G[i]) i++; console.log('  differs at output line', i + 1, '\n   want:', JSON.stringify(W[i]), '\n   got: ', JSON.stringify(G[i]), '\n   next got:', JSON.stringify(G.slice(i + 1, i + 4))); }

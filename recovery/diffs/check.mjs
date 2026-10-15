// Each hunk's body must have exactly the line counts its header says.
import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const lines = readFileSync(f, 'utf8').split('\n'); let bad = 0; let hunks = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]); if (!m) continue;
    hunks++; let o = +(m[2] ?? 1), n = +(m[4] ?? 1); let j = i + 1;
    while ((o > 0 || n > 0) && j < lines.length) { const c = lines[j][0]; if (c === ' ' || lines[j] === '') { o--; n--; } else if (c === '-') o--; else if (c === '+') n--; else if (c === '\\') {} else break; j++; }
    if (o !== 0 || n !== 0) { bad++; console.log(f, 'hunk at line', i + 1, lines[i], 'left over', o, n); }
  }
  console.log(f, hunks, 'hunks', bad ? `${bad} BAD` : 'all consistent');
}

// Re-run every logged grep of REL (after --since) on a candidate file and compare with what the log printed.
// The candidate is put at REL in a mirror of the repo (other files as they are now), and each grep pipeline is
// run there in bash; only output lines that belong to REL are compared (`REL:` prefixed in multi-file greps; the
// whole output for a command that is one pipeline on REL alone). A `| head -N` that cut the logged output, or a
// 2 KB preview, makes the logged lines a prefix to check, not the whole.
// usage: node grepcheck.mjs REL CANDIDATE [--since=ISO] [--until=ISO] [-v]
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadRows } from './frags.mjs';
const [rel, cand] = process.argv.slice(2);
const opt = Object.fromEntries(process.argv.slice(4).map((a) => a.replace(/^--?/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const since = opt.since ?? ''; const until = opt.until ?? '2026-10-12T20:03';
const MIR = '/tmp/claude-0/-home-user-terraglide/8985411a-491b-549e-9d82-8d44b4f321b8/scratchpad/mirror';
if (!existsSync(MIR + '/src')) { mkdirSync(MIR, { recursive: true }); execSync(`cd /home/user/terraglide && tar --exclude=.git -cf - . | (cd ${MIR} && tar -xf -)`); }
try { unlinkSync(`${MIR}/${rel}`); } catch {}
writeFileSync(`${MIR}/${rel}`, readFileSync(cand));
const name = rel.split('/').pop();
function split(cmd) { // top-level ; && || newline, quote aware
  if (/<</.test(cmd)) return null;
  const parts = []; let cur = ''; let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q) q = null; else if (c === '\\' && q === '"') cur += cmd[++i] ?? ''; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if ((c === '&' && cmd[i + 1] === '&') || (c === '|' && cmd[i + 1] === '|')) { parts.push(cur); cur = ''; i++; continue; }
    if (c === ';' || c === '\n') { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur); return parts.map((p) => p.trim()).filter(Boolean);
}
let checked = 0, bad = 0, skipped = 0;
for (const r of loadRows()) {
  if (r.name !== 'Bash' || r.t < since || r.t > until || typeof r.result !== 'string' || r.error) continue;
  const cmd = r.input?.command ?? ''; if (!cmd.includes(name)) continue;
  const parts = split(cmd); if (!parts) continue;
  let cwdRepo = true; const cmds = [];
  for (const p of parts) { const cd = /^cd\s+(\S+)$/.exec(p); if (cd) { cwdRepo = /^\/home\/user\/terraglide\/?$/.test(cd[1]); continue; } cmds.push({ p, cwdRepo }); }
  for (const { p, cwdRepo: inRepo } of cmds) {
    if (!/^grep\s/.test(p) || !inRepo) continue;
    if (!p.includes(name)) continue;
    if (/\$\(|`/.test(p)) continue;
    const first = p.split(/\s\|\s/)[0];
    const multi = / -\w*r|\s-r\b|\*|\{|\s-H\b/.test(first) || (first.match(/\s(src|server|tools|styles)\/\S+/g) ?? []).length > 1;
    const single = cmds.length === 1 && !multi;
    if (!multi && !single) { skipped++; continue; }
    if (!/\s-\w*n/.test(first) && multi === false) { /* unnumbered: still comparable */ }
    let got;
    const run = p.replace(/\s*\|\s*head\s+-?\d+\s*$/, '');
    try { got = execSync(run, { cwd: MIR, shell: '/bin/bash', encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }); } catch (e) { got = e.stdout ?? ''; }
    const want = r.result.split('\n'); const gotL = got.split('\n'); if (gotL.at(-1) === '') gotL.pop();
    const pre = new RegExp('^(\\./)?' + rel.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '[:-]');
    const mine = (L) => multi ? L.filter((l) => pre.test(l)) : L;
    const W = mine(want), G = mine(gotL);
    const head = /\|\s*head\s+-?(\d+)/.exec(p);
    const cut = r.preview || (head && want.filter((l) => l !== '').length >= Number(head[1]) - 1) || (multi && cmds.length > 1 && head);
    // tool results lose trailing blank lines
    while (W.length && W.at(-1) === '') W.pop();
    let ok;
    if (cut) { ok = W.slice(0, -1).every((l, i) => G[i] === l); }
    else ok = W.length === G.length && W.every((l, i) => G[i] === l);
    if (!multi && !W.length) continue;
    checked++;
    if (!ok) {
      bad++;
      console.log(`#### MISMATCH ${r.t.slice(0, 19)}${cut ? ' (cut)' : ''}\n$ ${p}`);
      if (opt.v || true) {
        const n = Math.max(W.length, G.length); let shown = 0;
        for (let i = 0; i < n && shown < 12; i++) if (W[i] !== G[i]) { console.log(`  log: ${JSON.stringify(W[i] ?? null).slice(0, 150)}\n  got: ${JSON.stringify(G[i] ?? null).slice(0, 150)}`); shown++; }
      }
    }
  }
}
console.log(`checked ${checked}, mismatched ${bad}, skipped (mixed single-file) ${skipped}`);

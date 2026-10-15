// Every line-numbered sighting of one repo file in the logs: {t, agent, src, lines: Map<lineNo, text>}.
// Sources: Read (with or without offset), `sed -n 'A,Bp' FILE` chains, `grep -n`/`cat -n` output.
import { readFileSync } from 'node:fs';
export function loadRows() { return readFileSync(new URL('./calls.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map(JSON.parse); }
const R = '/home/user/terraglide/';
function readLines(text) {
  const m = new Map();
  for (const line of text.split('\n')) { const x = /^(\d+)\t(.*)$/s.exec(line); if (x) m.set(Number(x[1]), x[2]); else if (line.startsWith('<system-reminder>')) break; }
  return m;
}
// Split a shell command at top-level && ; || and newlines, ignoring quoted text. Returns null if it has heredocs.
function splitCmd(cmd) {
  if (/<</.test(cmd)) return null;
  const parts = []; let cur = ''; let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q) q = null; else if (c === '\\' && q === '"') { cur += cmd[++i] ?? ''; } continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if ((c === '&' && cmd[i + 1] === '&') || (c === '|' && cmd[i + 1] === '|')) { parts.push(cur); cur = ''; i++; continue; }
    if (c === ';' || c === '\n') { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}
import { snapshots } from './snapshots.mjs';
export function fragments(rows, rel, { copies = false } = {}) {
  const out = [...snapshots(rows, rel)];
  const abs = R + rel;
  for (const r of rows) {
    if (!r.result || r.error) continue;
    if (r.name === 'Read' && r.input?.file_path === abs) { out.push({ t: r.t, agent: r.agent, src: `Read ${r.input.offset ?? 1}+${r.input.limit ?? 'all'}`, lines: readLines(r.result) }); continue; }
    if (r.name !== 'Bash') continue;
    const cmd = r.input?.command ?? '';
    if (!cmd.includes(rel.split('/').pop())) continue;
    const parts = splitCmd(cmd); if (!parts) continue;
    // cwd: a leading `cd /home/user/terraglide` (or none: the default) makes relative paths repo paths.
    let inRepo = true; const cmds = [];
    for (const p of parts) { const cd = /^cd\s+(\S+)$/.exec(p); if (cd) { inRepo = cd[1] === '/home/user/terraglide' || cd[1] === R; continue; } cmds.push({ p, inRepo }); }
    const isFile = (f, inRepo) => f === abs || (inRepo && (f === rel || f === './' + rel));
    // Case 1: the output comes only from `sed -n 'A,Bp' FILE` and `echo` commands: cut it up by the ranges.
    const seds = cmds.map(({ p, inRepo }) => { const m = /^sed -n ['"]?(\d+),(\d+)p['"]?\s+(\S+)$/.exec(p); return m ? { a: +m[1], b: +m[2], f: m[3], inRepo } : (/^echo\b/.test(p) ? { echo: p } : null); });
    if (seds.every(Boolean) && seds.some((s) => s.f && isFile(s.f, s.inRepo))) {
      let lines = r.result.split('\n'); let at = 0;
      if (lines.at(-1) === '') lines.pop();
      // A chain is only cut up when its output is exactly as long as its ranges add up to; otherwise a range
      // that came up short (end of file, a different file) shifts everything after it. Then only the first
      // range is kept, which starts at the top of the output whatever happened later.
      const expected = seds.reduce((n, s) => n + (s.echo ? 1 : s.b - s.a + 1), 0);
      // A tool result loses its leading blank lines (and trailing ones), so an output that starts or ends
      // on a blank line comes up short. Each way of putting the missing blanks back is a hypothesis;
      // assemble.mjs keeps the one that agrees with the other sightings.
      const deficit = expected - lines.length;
      if (deficit >= 1 && deficit <= 3 && !seds.some((s) => s.echo)) {
        const hyps = [];
        for (let lead = 0; lead <= deficit; lead++) {
          const L = [...Array(lead).fill(''), ...lines, ...Array(deficit - lead).fill('')];
          const m = new Map(); let at2 = 0;
          for (const s of seds) {
            const n = s.b - s.a + 1;
            if (isFile(s.f, s.inRepo)) for (let i = 0; i < n; i++) m.set(s.a + i, L[at2 + i]);
            at2 += n;
          }
          hyps.push(m);
        }
        out.push({ t: r.t, agent: r.agent, src: `sed chain short by ${deficit}`, lines: new Map(), hyps });
        continue;
      }
      if (seds.length > 1 && expected !== lines.length) {
        const first = seds[0];
        if (first.f && isFile(first.f, first.inRepo)) {
          const m = new Map(); const n = Math.min(first.b - first.a + 1, lines.length);
          for (let i = 0; i < n; i++) m.set(first.a + i, lines[i]);
          out.push({ t: r.t, agent: r.agent, src: `sed ${first.a},${first.b} (first of a chain)`, lines: m });
        }
        continue;
      }
      for (const s of seds) {
        if (s.echo) { at += 1; continue; }
        const n = s.b - s.a + 1;
        if (isFile(s.f, s.inRepo)) {
          const m = new Map(); for (let i = 0; i < n && at + i < lines.length; i++) m.set(s.a + i, lines[at + i]);
          if (seds.filter((x) => x.f).length === 1) { // single range: trust it as far as it goes
            out.push({ t: r.t, agent: r.agent, src: `sed ${s.a},${s.b}`, lines: m, single: true });
          } else out.push({ t: r.t, agent: r.agent, src: `sed ${s.a},${s.b} (chain)`, lines: m, chain: true });
        }
        at += n;
      }
      continue;
    }
    // Case 1b: a mixed command whose first or last part is `sed -n 'A,Bp'` on this file: that range is the
    // top or the bottom of the output. A blank line at the very top or bottom may have been trimmed, so both
    // readings are offered as hypotheses.
    {
      const isSed = (p) => /^sed -n ['"]?(\d+),(\d+)p['"]?\s+(\S+)$/.exec(p);
      const lines = r.result.split('\n'); if (lines.at(-1) === '') lines.pop();
      const first = cmds[0], last = cmds.at(-1);
      const mf = first && isSed(first.p), ml = last && isSed(last.p);
      if (cmds.length > 1 && mf && isFile(mf[3], first.inRepo)) {
        const a = +mf[1], n = +mf[2] - a + 1; const hyps = [];
        for (const lead of [0, 1]) { const m = new Map(); for (let i = 0; i < n - lead && i < lines.length; i++) m.set(a + lead + i, lines[i]); if (lead) m.set(a, ''); hyps.push(m); }
        out.push({ t: r.t, agent: r.agent, src: `sed ${a},${+mf[2]} (top of mixed)`, lines: new Map(), hyps });
      }
      if (cmds.length > 1 && ml && isFile(ml[3], last.inRepo)) {
        const a = +ml[1], b = +ml[2], n = b - a + 1; const hyps = [];
        for (const trail of [0, 1]) { const m = new Map(); const take = n - trail; for (let i = 0; i < take && i < lines.length; i++) m.set(b - trail - i, lines[lines.length - 1 - i]); if (trail) m.set(b, ''); hyps.push(m); }
        out.push({ t: r.t, agent: r.agent, src: `sed ${a},${b} (bottom of mixed)`, lines: new Map(), hyps });
      }
    }
    // Case 2: grep -n / cat -n on just this file: lines carry their numbers.
    for (const { p, inRepo } of cmds) {
      const g = /^(grep|rg)\s.*-n.*\s(\S+)(\s*\|\s*head\s+-?\d+)?$/.exec(p);
      const c = /^cat -n\s+(\S+)(\s*\|\s*(head|sed -n)\b.*)?$/.exec(p);
      const f = g ? g[2] : c ? c[1] : null;
      if (!f || !isFile(f, inRepo)) continue;
      if (cmds.length > 1) continue; // mixed output: skip to be safe
      const m = new Map();
      for (const line of r.result.split('\n')) {
        const x = c ? /^\s*(\d+)\t(.*)$/s.exec(line) : /^(\d+)[:-](.*)$/s.exec(line);
        if (x) m.set(Number(x[1]), x[2]);
      }
      if (m.size) out.push({ t: r.t, agent: r.agent, src: g ? 'grep -n' : 'cat -n', lines: m });
    }
  }
  return out;
}
if (process.argv[1]?.endsWith("frags.mjs") && process.argv[2]) {
  const rel = process.argv[2]; const since = process.argv[3] ?? '';
  const fr = fragments(loadRows(), rel).filter((f) => f.t >= since);
  const cover = new Set(); for (const f of fr) for (const n of f.lines.keys()) cover.add(n);
  console.log(rel, 'fragments', fr.length, 'distinct line numbers seen', cover.size);
  const bySrc = {}; for (const f of fr) { const k = f.src.split(' ')[0]; bySrc[k] = (bySrc[k] ?? 0) + 1; } console.log(bySrc);
}

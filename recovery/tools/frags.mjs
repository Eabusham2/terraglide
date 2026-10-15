// Every line-numbered sighting of one repo file in the logs: {t, agent, src, lines: Map<lineNo, text>}.
// Sources: Read (with or without offset), `sed -n 'A,Bp' FILE` chains, `grep -n`/`cat -n` output.
import { readFileSync } from 'node:fs';
let ROWS = null;
export function loadRows() {
  if (ROWS) return ROWS;
  const rows = readFileSync(new URL('./calls.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  // A result too large for the log was saved to a file, with a 2 KB preview left in its place. Where an agent
  // read that file back, the read is the whole result; otherwise keep the preview without its cut last line.
  const readBack = new Map();
  for (const r of rows) if (r.name === 'Read' && /tool-results\//.test(r.input?.file_path ?? '') && r.result && !r.input.offset && !r.input.limit) {
    const lines = []; for (const l of r.result.split('\n')) { const m = /^(\d+)\t(.*)$/s.exec(l); if (m) lines.push(m[2]); else if (l.startsWith('<system-reminder>')) break; }
    if (lines.at(-1) === '') lines.pop();
    readBack.set(r.input.file_path, lines.join('\n'));
  }
  for (const r of rows) {
    if (typeof r.result !== 'string' || !r.result.startsWith('<persisted-output>')) continue;
    const m = /saved to: (\S+)/.exec(r.result);
    if (m && readBack.has(m[1])) { r.result = readBack.get(m[1]); r.restored = true; continue; }
    const k = r.result.indexOf('Preview (first 2KB):\n');
    if (k < 0) { r.result = ''; continue; }
    let prev = r.result.slice(k + 'Preview (first 2KB):\n'.length).replace(/\n?<\/persisted-output>\s*$/, '');
    prev = prev.split('\n'); prev.pop(); // the last line may be cut
    r.result = prev.join('\n'); r.preview = true;
  }
  return (ROWS = rows);
}
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
import { execFileSync as _exec } from 'node:child_process';
// A file's first line: from the commit, else from a Read that started at line 1, else from a Write.
function firstLineOf(rows, rel) {
  try { const t = _exec('git', ['-C', '/home/user/terraglide', 'show', `2c7ee70:${rel}`], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }).toString(); return t.split('\n')[0]; } catch {}
  for (const r of rows) {
    if (r.name === 'Read' && r.input?.file_path === R + rel && (r.input.offset ?? 1) <= 1 && r.result) { const m = readLines(r.result); if (m.has(1)) return m.get(1); }
    if (r.name === 'Write' && r.input?.file_path === R + rel) return r.input.content.split('\n')[0];
  }
  return null;
}
export function fragments(rows, rel, { copies = false } = {}) {
  const out = [...snapshots(rows, rel)];
  const abs = R + rel;
  const fl = firstLineOf(rows, rel); const FIRST_LINE = new Map(fl != null && fl.trim().length >= 3 ? [[rel, fl]] : []);
  for (const r of rows) {
    if (!r.result || r.error) continue;
    if (r.name === 'Read' && r.input?.file_path === abs) {
      const m = readLines(r.result);
      // A Read that reaches the end of the file shows one more, empty line: not part of the file.
      const lim = r.input.limit ?? 2000; const last = Math.max(0, ...m.keys());
      const reachedEnd = m.size < lim;
      if (reachedEnd && m.get(last) === '') m.delete(last);
      const whole = (r.input.offset == null || r.input.offset <= 1) && reachedEnd ? m.size : undefined;
      out.push({ t: r.t, agent: r.agent, src: `Read ${r.input.offset ?? 1}+${r.input.limit ?? 'all'}`, lines: m, whole, endsAt: reachedEnd ? last - (m.has(last) ? 0 : 1) : undefined });
      continue;
    }
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
        // The last range ends the output, whatever came up short before it (a trailing blank may be trimmed).
        const last = seds.at(-1);
        if (process.env.NO_CHAINLAST !== '1' && last !== first && last.f && isFile(last.f, last.inRepo)) {
          const a = last.a, b = last.b, n = b - a + 1; const hyps = [];
          for (const trail of [0, 1]) { const m = new Map(); const take = n - trail; for (let i = 0; i < take && i < lines.length; i++) m.set(b - trail - i, lines[lines.length - 1 - i]); if (trail) m.set(b, ''); hyps.push(m); }
          out.push({ t: r.t, agent: r.agent, src: `sed ${a},${b} (last of a chain)`, lines: new Map(), hyps });
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
    // Case 1c: a mixed command that ends with a plain `cat FILE`: the file is the end of the output, and it starts
    // at the last line of the output that equals the file's own first line (from the commit), if that is found
    // exactly once in the output.
    if (process.env.NO_CATLAST !== '1' && cmds.length > 1) {
      const last = cmds.at(-1); const mc = /^cat\s+(\S+)$/.exec(last.p);
      if (mc && isFile(mc[1], last.inRepo) && FIRST_LINE.has(rel)) {
        const lines = r.result.split('\n'); if (lines.at(-1) === '') lines.pop();
        const fl = FIRST_LINE.get(rel); const at = []; lines.forEach((l, i) => { if (l === fl) at.push(i); });
        if (at.length === 1) {
          const m = new Map(); for (let i = at[0]; i < lines.length; i++) m.set(i - at[0] + 1, lines[i]);
          out.push({ t: r.t, agent: r.agent, src: 'cat (end of mixed)', lines: m, endsAt: m.size });
        }
      }
    }
    // Case 1d: `grep -n A FILE | grep -n B` (one file, the second grep numbering the first's matches): each output
    // line is index:fileLine:text. The run of indexes starting at 1 belongs to this part of the command, so
    // only parts whose first grep names this one file are read, and only when the command holds one such part.
    if (process.env.NO_GREPGREP !== '1') {
      // Split a part at its top-level pipes, quotes respected.
      const pipes = (p) => { const out = []; let cur = '', q = null; for (let i = 0; i < p.length; i++) { const ch = p[i]; if (q) { cur += ch; if (ch === q) q = null; else if (ch === '\\' && q === '"') cur += p[++i] ?? ''; continue; } if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; } if (ch === '|') { out.push(cur.trim()); cur = ''; continue; } cur += ch; } out.push(cur.trim()); return out; };
      const lastWord = (p) => { const w = p.match(/(?:'[^']*'|"(?:[^"\\]|\\.)*"|\S)+/g) ?? []; return w.at(-1); };
      const gg = cmds.filter(({ p }) => { const ps = pipes(p); return ps.length >= 2 && /^grep\s/.test(ps[0]) && /(^|\s)-\w*n/.test(ps[0]) && /^grep\s/.test(ps[1]) && /(^|\s)-\w*n/.test(ps[1]); });
      if (gg.length === 1) {
        const first = pipes(gg[0].p)[0];
        const m0 = [null, lastWord(first)];
        if (m0[1] && isFile(m0[1], gg[0].inRepo)) {
          const m = new Map(); let lastI = 0, lastN = 0;
          for (const line of r.result.split('\n')) {
            const x = /^(\d+):(\d+):(.*)$/s.exec(line);
            if (!x) continue;
            const i = Number(x[1]), n = Number(x[2]);
            if (i <= lastI || n <= lastN) break; // both counts only ever go up
            m.set(n, x[3]); lastI = i; lastN = n;
          }
          if (m.size) out.push({ t: r.t, agent: r.agent, src: 'grep -n | grep -n', lines: m });
        }
      }
    }
    // Case 2: grep -n / cat -n on just this file: lines carry their numbers.
    for (const { p, inRepo } of cmds) {
      const g = /^(grep|rg)\s.*-n.*\s(\S+)(\s*\|\s*head\s+-?\d+)?$/.exec(p);
      const c = /^cat -n\s+(\S+)(\s*\|\s*(head|sed -n)\b.*)?$/.exec(p);
      const f = g ? g[2] : c ? c[1] : null;
      if (!f || !isFile(f, inRepo)) continue;
      if (cmds.length > 1) {
        // Mixed output. A lone `cat -n FILE` (no other numbered listing in the command) is still readable: the
        // run of tab-numbered lines that starts at 1 and counts up by one.
        const others = cmds.filter((x) => x.p !== p && /(^|\s)(cat -n|grep\s.*-n|nl)\b/.test(x.p));
        if (!c || others.length || process.env.NO_MIXEDCAT === '1') continue;
        const m = new Map(); let next = 1;
        for (const line of r.result.split('\n')) {
          const x = /^\s*(\d+)\t(.*)$/s.exec(line);
          if (x && Number(x[1]) === next) { m.set(next, x[2]); next++; } else if (next > 1) break;
        }
        if (m.size) out.push({ t: r.t, agent: r.agent, src: 'cat -n (in mixed)', lines: m });
        continue;
      }
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

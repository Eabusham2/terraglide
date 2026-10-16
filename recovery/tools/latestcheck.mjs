// Is the file in the repo the LATEST version every source saw? For each file, every line any pre-wipe source
// showed (line-numbered views, greps, cat, git diffs, Edit new_strings, Writes, the user's uploads) is held
// against the file as it is now:
//  - a line seen once and not in the file now must have been taken out later: by an Edit or Write after it
//    was last seen, by a script/command after it that names the file and quotes the line, or by a later view
//    that shows its neighbours without it. Otherwise it is LOST (reported).
//  - a line in the file now that no source ever showed (and the commit did not have) is UNSEEN (mine).
//  - each Edit's new_string should be in the file unless a later change took it out.
// usage: node latestcheck.mjs [REL...]   (default: every file changed since 2c7ee70)
import { fragments, loadRows } from './frags.mjs';
import { grepNumbered } from './runs.mjs';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const R = '/home/user/terraglide/';
const WIPE = '2026-10-12T20:03';
const rows = loadRows().filter((r) => r.t < WIPE);
const VERBOSE = process.env.V === '1';
let rels = process.argv.slice(2);
if (!rels.length) {
  rels = execSync(`git -C ${R} diff --name-only 2c7ee70 HEAD`).toString().split('\n').filter((f) => f && !f.startsWith('recovery/') && existsSync(R + f));
}
// The user's uploads, mapped to repo paths by content (the best-matching file by shared lines).
const UP = ['/home/user/recovery/upload', '/home/user/recovery/upload2', '/home/user/recovery/upload3/more'];
const uploads = [];
for (const d of UP) for (const f of readdirSync(d)) { const p = `${d}/${f}`; try { uploads.push({ p, lines: readFileSync(p, 'utf8').replace(/\r\n/g, '\n').split('\n') }); } catch {} }
const sig = (l) => l.trim().length >= 12;
const nonblank = (l) => l.trim() !== '';
// Each upload goes with the repo file it shares the most lines with (of every file changed since the commit).
const allRels = execSync(`git -C ${R} diff --name-only 2c7ee70 HEAD`).toString().split('\n').filter((f) => f && !f.startsWith('recovery/') && existsSync(R + f));
const relSets = new Map(allRels.map((r) => [r, new Set(readFileSync(R + r, 'utf8').split('\n').filter(sig))]));
for (const u of uploads) {
  const s = u.lines.filter(sig); let best = null, bestHit = 0;
  for (const [r, set] of relSets) { const hit = s.filter((l) => set.has(l)).length; if (hit > bestHit) { best = r; bestHit = hit; } }
  u.rel = bestHit >= 10 && bestHit / Math.max(1, s.length) > 0.25 ? best : null; u.hit = bestHit / Math.max(1, s.length);
}
function uploadFor(rel) { return uploads.filter((u) => u.rel === rel); }
const words = (l) => new Set(l.match(/[A-Za-z_$][\w$]*|\d+/g) ?? []);
function similar(text, cur) {
  const a = words(text); if (a.size < 2) return null; let best = null, bs = 0;
  for (const l of cur) { const b = words(l); let i = 0; for (const w of a) if (b.has(w)) i++; const j = i / (a.size + b.size - i); if (j > bs) { bs = j; best = l; } }
  return bs >= 0.5 ? best : null;
}
const report = [];
for (const rel of rels) {
  const abs = R + rel; const base = rel.split('/').pop();
  const cur = readFileSync(abs, 'utf8').split('\n'); if (cur.at(-1) === '') cur.pop();
  const curSet = new Set(cur); const curTrim = new Set(cur.map((l) => l.trim()));
  let head = null; try { head = execSync(`git -C ${R} show 2c7ee70:${rel}`, { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }).toString().split('\n'); } catch {}
  const headSet = new Set(head ?? []);
  // Every sighting, with neighbours where it has line numbers.
  const seen = new Map(); // text -> {last, where: [{t, prev, next, src}]}
  const note = (text, t, src, prev, next) => {
    if (!nonblank(text)) return;
    if (!seen.has(text)) seen.set(text, { last: t, where: [] });
    const s = seen.get(text); if (t > s.last) s.last = t; s.where.push({ t, src, prev, next });
  };
  const frs = [...fragments(rows, rel), ...grepNumbered(rows, rel)].filter((f) => !f.hyps && f.agent !== 'git');
  for (const f of frs) {
    const keys = [...f.lines.keys()].sort((a, b) => a - b);
    for (const n of keys) note(f.lines.get(n), f.t, f.src, f.lines.get(n - 1), f.lines.get(n + 1));
  }
  const edits = rows.filter((r) => (r.name === 'Edit' || r.name === 'Write') && r.input?.file_path === abs && !r.error && r.result != null);
  for (const e of edits) {
    const text = e.name === 'Edit' ? e.input.new_string : e.input.content;
    const L = text.split('\n'); L.forEach((l, i) => note(l, e.t, e.name, L[i - 1], L[i + 1]));
  }
  const ups = uploadFor(rel);
  for (const u of ups) u.lines.forEach((l, i) => note(l, '2026-10-0?', 'upload ' + u.p.replace('/home/user/recovery/', ''), u.lines[i - 1], u.lines[i + 1]));
  // Later evidence that a line was taken out.
  const cmds = rows.filter((r) => r.name === 'Bash' && (r.input?.command ?? '').includes(base));
  const laterViews = frs.map((f) => ({ t: f.t, lines: f.lines }));
  const lost = [];
  for (const [text, s] of seen) {
    if (curSet.has(text) || headSet.has(text) && curSet.has(text)) continue;
    if (curTrim.has(text.trim())) continue; // whitespace only: counted apart
    const t = s.last === '2026-10-0?' ? '2026-10-01' : s.last;
    let why = null;
    for (const e of edits) if (e.t >= t) {
      if (e.name === 'Edit' && e.input.old_string.includes(text.trim())) { why = `Edit ${e.t.slice(5, 16)}`; break; }
      if (e.name === 'Write' && !e.input.content.split('\n').includes(text)) { why = `Write ${e.t.slice(5, 16)}`; break; }
    }
    if (!why) for (const c of cmds) if (c.t >= t && c.input.command.includes(text.trim().slice(0, 60))) { why = `command ${c.t.slice(5, 16)}`; break; }
    if (!why) {
      // a later numbered view showing the neighbours together without it
      const w = s.where.filter((x) => x.prev !== undefined && x.next !== undefined).at(-1);
      if (w) for (const v of laterViews) if (v.t > t) {
        for (const [n, l] of v.lines) if (l === w.prev && v.lines.has(n + 1) && v.lines.get(n + 1) !== text) { why = `view ${v.t.slice(5, 16)}`; break; }
        if (why) break;
      }
    }
    if (!why) {
      // replaced: the line most like it in the file now was seen after it was
      const like = similar(text, cur);
      if (like && seen.has(like) && seen.get(like).last > t) why = `replaced (seen ${seen.get(like).last.slice(5, 16)})`;
      else if (like) s.like = like;
    }
    if (!why) lost.push({ text, inHead: headSet.has(text), ctx: s.where.filter((x) => x.prev !== undefined || x.next !== undefined).at(-1), like: s.like, last: s.last, srcs: [...new Set(s.where.map((x) => x.src.split(' ')[0]))].join(',') });
  }
  // Lines in the file now that nobody saw (and the commit did not have).
  const unseen = cur.map((l, i) => [i + 1, l]).filter(([, l]) => nonblank(l) && !seen.has(l) && !headSet.has(l));
  // Edits whose text is not there now and nothing later took out.
  const notApplied = [];
  for (const e of edits.filter((e) => e.name === 'Edit')) {
    const ns = e.input.new_string; if (!ns.trim()) continue;
    if (cur.join('\n').includes(ns)) continue;
    const parts = ns.split('\n').filter(nonblank);
    const missing = parts.filter((l) => !curSet.has(l));
    const unexplained = missing.filter((l) => lost.some((x) => x.text === l));
    if (unexplained.length) notApplied.push({ t: e.t, n: unexplained.length, first: unexplained[0] });
  }
  report.push({ rel, lines: cur.length, seenTexts: seen.size, lost, unseen, notApplied, uploads: ups.map((u) => u.p.replace('/home/user/recovery/', '')) });
}
for (const r of report) {
  console.log(`${r.rel.padEnd(34)} ${String(r.lines).padStart(6)} lines  lost ${String(r.lost.length).padStart(4)}  unseen ${String(r.unseen.length).padStart(5)}  edits-missing ${r.notApplied.length}  uploads ${r.uploads.join(' ')}`);
  if (VERBOSE || process.argv.length > 2) {
    for (const x of r.lost.sort((a, b) => b.last.localeCompare(a.last)).slice(0, 40)) { console.log('   LOST', x.last.slice(5, 16), x.srcs.padEnd(12), JSON.stringify(x.text).slice(0, 130)); if (x.like) console.log('        now', JSON.stringify(x.like).slice(0, 130));
      if (x.inHead) console.log('        (in the commit: a deletion)');
      if (process.env.CTX === '1' && x.ctx) {
        const cur = readFileSync(R + r.rel, 'utf8').split('\n');
        const pi = cur.indexOf(x.ctx.prev), ni = cur.indexOf(x.ctx.next);
        console.log('        seen  prev', JSON.stringify(x.ctx.prev ?? '').slice(0, 100), '@', x.ctx.src, x.ctx.t.slice(5, 16));
        console.log('        seen  next', JSON.stringify(x.ctx.next ?? '').slice(0, 100));
        console.log('        now   prev at', pi + 1, 'next at', ni + 1, pi >= 0 ? '-> now after prev: ' + JSON.stringify(cur[pi + 1]).slice(0, 100) : '');
      } }
    for (const x of r.notApplied.slice(0, 10)) console.log('   EDIT', x.t.slice(5, 16), x.n, JSON.stringify(x.first).slice(0, 120));
  }
}
if (process.env.UPMAP === '1') for (const u of uploads) console.log('UP', u.p.replace('/home/user/recovery/', '').padEnd(48), u.rel, u.hit.toFixed(2));

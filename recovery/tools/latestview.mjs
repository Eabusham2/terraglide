// For each file: its line-numbered sightings, newest first, held against the file now at the same line numbers.
// The newest sightings are the best evidence of the final; any of them that disagrees is listed, with the
// changes logged after it (Edit/Write, or a command that writes the file) that could explain it.
// usage: node latestview.mjs [REL...]   N=how many newest sightings to list per file (default 4)
import { fragments, loadRows } from './frags.mjs';
import { grepNumbered } from './runs.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
const R = '/home/user/terraglide/';
const WIPE = '2026-10-12T20:03';
const rows = loadRows().filter((r) => r.t < WIPE);
const N = Number(process.env.N ?? 4);
let rels = process.argv.slice(2);
if (!rels.length) rels = execSync(`git -C ${R} diff --name-only 2c7ee70 HEAD`).toString().split('\n').filter((f) => f && !f.startsWith('recovery/') && existsSync(R + f));
const words = (l) => new Set(l.match(/[A-Za-z_$][\w$]*|\d+/g) ?? []);
function similar(text, cur) {
  const a = words(text); if (a.size < 2) return null; let best = null, bs = 0;
  for (const l of cur) { const b = words(l); let i = 0; for (const w of a) if (b.has(w)) i++; const j = i / (a.size + b.size - i); if (j > bs) { bs = j; best = l; } }
  return bs >= 0.6 ? best : null;
}
const writesFile = (cmd, base) => new RegExp(`(sed -i[^|;&]*|>\\s*\\S*|tee\\s+\\S*|cp\\s+\\S+\\s+\\S*|mv\\s+\\S+\\s+\\S*|writeFileSync\\([^)]*|open\\([^)]*['"]w)${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(cmd);
for (const rel of rels) {
  const abs = R + rel; const base = rel.split('/').pop();
  const cur = readFileSync(abs, 'utf8').split('\n'); if (cur.at(-1) === '') cur.pop();
  const frs = [...fragments(rows, rel), ...grepNumbered(rows, rel)].filter((f) => f.agent !== 'git');
  const scored = [];
  for (const f of frs) {
    const cands = f.hyps ? f.hyps : [f.lines];
    let best = null;
    for (const m of cands) {
      // at its own line numbers, or shifted by lines put in or taken out above it since
      for (const k of [0, ...Array.from({ length: 160 }, (_, i) => (i % 2 ? -1 : 1) * (1 + (i >> 1)))]) {
        let ok = 0, bad = [];
        for (const [n, t] of m) { if (cur[n - 1 + k] === t) ok++; else bad.push(n); }
        if (!best || bad.length < best.bad.length) best = { ok, bad, m, k };
        if (!bad.length) break;
      }
    }
    if (!best || !best.m.size) continue;
    scored.push({ t: f.t, agent: f.agent, src: f.src, size: best.m.size, ok: best.ok, bad: best.bad, m: best.m, k: best.k, whole: f.whole });
  }
  scored.sort((a, b) => b.t.localeCompare(a.t));
  // Which lines of the file now a sighting confirms (its line n, shifted by k, holds what it saw).
  for (const sc of scored) { sc.conf = new Set(); for (const [n, t] of sc.m) if (cur[n - 1 + sc.k] === t) sc.conf.add(n + sc.k); }
  // A differing line is settled when a later sighting confirms the line now in its place.
  for (const sc of scored) {
    sc.open = sc.bad.filter((n) => !scored.some((o) => o.t > sc.t && o.conf.has(n + sc.k)));
  }
  if (process.env.NEWEST === '1') {
    // Per line of the file now: the newest sighting that covers it, and whether it agrees.
    // Sightings that came out short or were cut (hypotheses) only count where they agree.
    const verdict = new Array(cur.length).fill(null);
    for (const sc of scored) { // newest first
      for (const [n, t] of sc.m) {
        const i = n - 1 + sc.k; if (i < 0 || i >= cur.length || verdict[i]) continue;
        if (cur[i] === t) verdict[i] = { ok: true, t: sc.t };
        else if (sc.size >= 3 && sc.ok / sc.size >= 0.5) verdict[i] = { ok: false, t: sc.t, src: sc.src, saw: t, agent: sc.agent };
      }
    }
    const bad = verdict.map((v, i) => [i, v]).filter(([, v]) => v && !v.ok);
    const cov = verdict.filter(Boolean).length;
    console.log(`${rel.padEnd(34)} ${String(cur.length).padStart(5)} lines  covered ${String(cov).padStart(5)}  newest disagrees ${bad.length}`);
    let shown = 0;
    for (const [i, v] of bad) {
      if (shown++ >= N) break;
      console.log(`   ${i + 1} @${v.t.slice(5, 16)} ${v.agent.slice(0, 6)} (${v.src}) saw ${JSON.stringify(v.saw).slice(0, 100)}\n      ${' '.repeat(String(i + 1).length)} now ${JSON.stringify(cur[i]).slice(0, 100)}`);
    }
    continue;
  }
  if (process.env.REGRESS === '1') {
    // An open line whose text now was seen BEFORE the sighting that shows something else there: the file may
    // hold an older text than the newest evidence. (Text seen anywhere in the file, earlier.)
    const firstSeen = new Map();
    for (const sc of [...scored].reverse()) for (const t of sc.m.values()) if (!firstSeen.has(t)) firstSeen.set(t, sc.t);
    const hits = [];
    for (const sc of scored) for (const n of sc.open) {
      const now = cur[n - 1 + sc.k]; const was = sc.m.get(n);
      if (now === undefined || !now.trim() || !was.trim()) continue;
      const f = firstSeen.get(now);
      if (!(f && f < sc.t && !cur.includes(was))) continue;
      if (was.trim().length < 15) continue;
      // reworded or moved: some line now shares most of its words
      const like = similar(was, cur);
      hits.push({ t: sc.t, src: sc.src, n: n + sc.k, was, now, f, like });
    }
    const strict = hits.filter((h) => !h.like);
    if (process.env.STRICT === '1') hits.splice(0, hits.length, ...strict);
    if (hits.length) {
      console.log(`${rel}: ${hits.length} lines where a newer sighting shows other text than the file now`);
      const seenKey = new Set();
      for (const h of hits.sort((a, b) => b.t.localeCompare(a.t))) {
        const key = h.n + h.was; if (seenKey.has(key)) continue; seenKey.add(key);
        if (seenKey.size > N) break;
        console.log(`   ${h.n} @${h.t.slice(5, 16)} (${h.src}) saw ${JSON.stringify(h.was).slice(0, 100)}\n      now (seen ${h.f.slice(5, 16)}) ${JSON.stringify(h.now).slice(0, 100)}`);
      }
    }
    continue;
  }
  if (process.env.OPEN === '1') {
    const open = scored.filter((sc) => sc.open.length);
    if (open.length) console.log(`${rel}: ${open.length} sightings with differing lines nothing later confirms`);
    for (const sc of open.slice(0, N)) {
      console.log(`   ${sc.t.slice(5, 16)} ${sc.agent.slice(0, 6)} ${sc.src} shift ${sc.k}: ${sc.open.length} open of ${sc.size}`);
      for (const n of sc.open.slice(0, 4)) console.log(`      ${n}: seen ${JSON.stringify(sc.m.get(n)).slice(0, 100)}\n      ${' '.repeat(String(n).length)}  now  ${JSON.stringify(cur[n - 1 + sc.k] ?? null).slice(0, 100)}`);
    }
    continue;
  }
  const changes = rows.filter((r) => ((r.name === 'Edit' || r.name === 'Write') && r.input?.file_path === abs) || (r.name === 'Bash' && writesFile(r.input?.command ?? '', base)));
  const lastChange = changes.at(-1);
  const newest = scored[0];
  const firstBad = scored.find((s) => s.bad.length);
  const allOkSince = firstBad ? scored.filter((s) => s.t > firstBad.t).length : scored.length;
  console.log(`${rel.padEnd(34)} ${String(cur.length).padStart(5)}  newest ${newest ? newest.t.slice(5, 16) + ' ' + newest.ok + '/' + newest.size : '-'}  `
    + `newest disagreeing ${firstBad ? firstBad.t.slice(5, 16) + ' ' + firstBad.bad.length + '/' + firstBad.size + ' (' + firstBad.src + ')' : 'none'}  agreeing after it ${allOkSince}  last logged change ${lastChange ? lastChange.t.slice(5, 16) : '-'}`);
  if (process.argv.length > 2) {
    for (const s of scored.filter((s) => s.bad.length).slice(0, N)) {
      const after = changes.filter((c) => c.t > s.t);
      console.log(`   ${s.t.slice(5, 16)} ${s.agent.slice(0, 6)} ${s.src}: ${s.bad.length} of ${s.size} differ (best shift ${s.k}); changes logged after it: ${after.length}${after.length ? ' (' + after.slice(0, 3).map((c) => c.name + ' ' + c.t.slice(5, 16)).join(', ') + ')' : ''}`);
      for (const n of s.bad.slice(0, 6)) console.log(`      ${n}: seen ${JSON.stringify(s.m.get(n)).slice(0, 90)}\n      ${' '.repeat(String(n).length)}  now  ${JSON.stringify(cur[n - 1 + s.k] ?? null).slice(0, 90)}`);
    }
  }
}

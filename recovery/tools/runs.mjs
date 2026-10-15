// Unnumbered text that holds runs of a file's lines, for filling gaps by anchor matching:
// Bash outputs of commands that name the file (any cwd), Reads of copies of it, Edit old/new strings,
// Write contents, and python triple-quoted old/new blocks. Each is {t, agent, src, lines: string[]}.
// Also numbered sightings from grep -n lines in mixed outputs: {t, agent, src, lines: Map}.
const R = '/home/user/terraglide/';
// Split a command at unquoted ; && || and newlines (not inside $( )), and each part into its pipeline stages
// and their words, honouring quotes. Returns [[stage words...]...] per part.
export function shellParts(cmd) {
  const parts = []; let words = [], word = '', stages = [], q = null, depth = 0;
  const endWord = () => { if (word !== '') { words.push(word); word = ''; } };
  const endStage = () => { endWord(); if (words.length) stages.push(words); words = []; };
  const endPart = () => { endStage(); if (stages.length) parts.push(stages); stages = []; };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < cmd.length) { const d = cmd[++i]; word += '$`"\\\n'.includes(d) ? d : '\\' + d; } else word += c; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '$' && cmd[i + 1] === '(') { depth++; word += '$('; i++; continue; }
    if (depth) { if (c === '(') depth++; if (c === ')') depth--; word += c; continue; }
    if (c === '\\' && i + 1 < cmd.length) { word += cmd[++i]; continue; }
    if (c === ' ' || c === '\t') { endWord(); continue; }
    if (c === '\n' || c === ';') { endPart(); continue; }
    if (c === '&' && cmd[i + 1] === '&') { endPart(); i++; continue; }
    if (c === '|' && cmd[i + 1] === '|') { endPart(); i++; continue; }
    if (c === '|') { endStage(); continue; }
    if (c === '&') { endPart(); continue; }
    word += c;
  }
  endPart();
  return parts;
}
// Replace each $( ... ) with X, matching parentheses outside quotes only.
export function stripSubshells(cmd) {
  let out = ''; let i = 0;
  while (i < cmd.length) {
    if (cmd[i] === '$' && cmd[i + 1] === '(') {
      let depth = 1, j = i + 2, q = null;
      for (; j < cmd.length && depth; j++) { const c = cmd[j]; if (q) { if (c === q) q = null; continue; } if (c === "'" || c === '"') q = c; else if (c === '(') depth++; else if (c === ')') depth--; }
      out += 'X'; i = j; continue;
    }
    out += cmd[i++];
  }
  return out;
}
export function textRuns(rows, rel) {
  const base = rel.split('/').pop();
  const runs = [];
  for (const r of rows) {
    if (r.error) continue;
    const inp = r.input ?? {};
    if (r.name === 'Read' && inp.file_path?.endsWith('/' + rel) && inp.file_path !== R + rel && r.result) {
      // A copy: split into runs of consecutive numbers.
      let run = [], last = -1;
      for (const line of r.result.split('\n')) {
        const x = /^(\d+)\t(.*)$/s.exec(line); if (!x) { if (line.startsWith('<system-reminder>')) break; continue; }
        const n = +x[1]; if (run.length && n !== last + 1) { runs.push({ t: r.t, agent: r.agent, src: 'Read copy', lines: run }); run = []; }
        run.push(x[2]); last = n;
      }
      if (run.length) runs.push({ t: r.t, agent: r.agent, src: 'Read copy', lines: run });
      continue;
    }
    if ((r.name === 'Edit' || r.name === 'MultiEdit') && inp.file_path?.endsWith('/' + rel)) {
      const edits = inp.edits ?? [inp];
      for (const e of edits) {
        if (e.old_string) runs.push({ t: r.t, agent: r.agent, src: 'Edit old', lines: e.old_string.split('\n'), partial: true });
        if (e.new_string) runs.push({ t: r.t, agent: r.agent, src: 'Edit new', lines: e.new_string.split('\n'), partial: true });
      }
      continue;
    }
    if (r.name === 'Write' && inp.file_path?.endsWith('/' + rel) && inp.content) { runs.push({ t: r.t, agent: r.agent, src: 'Write', lines: inp.content.split('\n') }); continue; }
    if (r.name !== 'Bash') continue;
    const cmd = inp.command ?? '';
    if (!cmd.includes(base)) continue;
    // python heredoc edits: old="""...""" / new="""..."""
    if (/python3? - <</.test(cmd)) {
      for (const m of cmd.matchAll(/(?:old|new)\s*=\s*"""([\s\S]*?)"""/g)) {
        if (/\\/.test(m[1])) continue; // escapes: skip rather than guess
        runs.push({ t: r.t, agent: r.agent, src: 'python block', lines: m[1].split('\n'), partial: true });
      }
    }
    const cds = [...cmd.matchAll(/(?:^|[;&|\n]\s*)cd\s+(\S+)/g)].map((m) => m[1]);
    const inRepo = cds.every((d) => d === '/home/user/terraglide' || d === R);
    // A pipe inside $( ) only computes an argument; it does not reshape what is printed.
    const outer = stripSubshells(cmd);
    if (r.result && !/\|\s*(cut|awk|tr|sort|uniq|column|fold|rev)\b/.test(outer)) runs.push({ t: r.t, agent: r.agent, src: 'Bash output', inRepo, lines: r.result.split('\n') });
  }
  return runs;
}
// Numbered sightings from grep output lines anywhere: "path:N:text" / "path-N-text" when the path is this
// file (with the command's cwd at the repo), or "N:text" when every grep in the command is on this file alone.
// A grep's pattern as a JS RegExp (basic regex: \| \( \) are operators, + ? | ( ) are literal), or null.
function grepRegex(words) {
  const flags = words.filter((x) => /^-[a-zA-Z]+$/.test(x)).join('');
  const args = words.slice(1).filter((x) => !x.startsWith('-'));
  let pat = args[0]; if (pat == null) return null;
  const ei = words.indexOf('-e'); if (ei > 0) pat = words[ei + 1];
  try {
    let src;
    if (/F/.test(flags)) src = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (/E/.test(flags)) src = pat;
    else { src = ''; for (let i = 0; i < pat.length; i++) { const c = pat[i]; if (c === '\\' && i + 1 < pat.length) { const d = pat[++i]; src += '|(){}?+'.includes(d) ? d : d === 'b' ? '\\b' : d === 'w' ? '\\w' : d === 's' ? '\\s' : d === '.' ? '\\.' : d === '\\' ? '\\\\' : '\\' + d; } else src += '|()+?{}'.includes(c) ? '\\' + c : c; } }
    if (/w/.test(flags)) src = `\\b(?:${src})\\b`;
    return new RegExp(src, /i/.test(flags) ? 'i' : '');
  } catch { return null; }
}
export function grepNumbered(rows, rel) {
  const base = rel.split('/').pop();
  const out = [];
  for (const r of rows) {
    if (r.name !== 'Bash' || r.error || !r.result) continue;
    const cmd = r.input?.command ?? '';
    if (!cmd.includes(base) || !/\bgrep\b|\brg\b/.test(cmd)) continue;
    // Anything that reshapes grep's lines (a second grep, sed, cut...) or prints only the match: skip.
    // (pipes that only pick lines - head, tail, sed -n 'A,Bp' - are fine)
    const reshaped = stripSubshells(cmd).replace(/\|\s*sed -n ['"]?\d+,\d+p['"]?/g, '').replace(/\|\s*(head|tail)(\s+-n)?(\s+-?\d+)?/g, '');
    if (/\|\s*(grep|rg|cut|awk|tr|sed|sort|uniq|column|nl|cat|xargs|paste|rev|fold)\b/.test(reshaped)) continue;
    if (/(?:^|[;&|\n]\s*)(grep|rg)\s[^|;&\n]*\s-(?:[a-zA-Z]*o|-only-matching)\b/.test(cmd)) continue;
    // cwd: in repo unless a cd elsewhere comes first
    const cds = [...cmd.matchAll(/(?:^|[;&|\n]\s*)cd\s+(\S+)/g)].map((m) => m[1]);
    const inRepo = cds.every((d) => d === '/home/user/terraglide' || d === R);
    const m = new Map();
    const pathRe = new RegExp('^(?:' + (inRepo ? '(?:\\./)?' + rel.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '|' : '') + (R + rel).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + ')([:-])(\\d+)\\1(.*)$', 's');
    for (const line of r.result.split('\n')) { const x = pathRe.exec(line); if (x) m.set(+x[2], x[3]); }
    // single-file greps: every grep/rg segment names exactly this one file and nothing else prints numbers
    const segs = cmd.split(/&&|\|\||;|\n/).map((s) => s.trim()).filter(Boolean);
    const greps = segs.filter((s) => /^(grep|rg)\b/.test(s));
    // Bare "N:text" lines come only from greps on a single file (a grep on several prints the path first).
    // Accept them when every single-file grep in the command is on this file, and none uses -h.
    const parts = shellParts(cmd);
    const grepStages = parts.map((st) => st[0]).filter((w) => w[0] === 'grep' || w[0] === 'rg');
    const isFileWord = (w) => !w.startsWith('-') && /\.(mjs|js|md|json|py|css|html|yml|yaml|toml|txt|sh)$|\*/.test(w);
    // grep [flags] PATTERN FILE... - the first word that is not a flag is the pattern (unless -e gives it).
    const info = grepStages.map((w) => {
      const flags = w.filter((x) => /^-[a-zA-Z]+$/.test(x)).join('');
      const args = []; let skipNext = false;
      for (const x of w.slice(1)) { if (skipNext) { skipNext = false; continue; } if (/^-[a-zA-Z]*[eABCmf]$/.test(x) && x !== '-n') { if (/[eABCmf]$/.test(x)) skipNext = true; continue; } if (x.startsWith('-')) continue; args.push(x); }
      const files = (/e/.test(flags) ? args : args.slice(1)).filter((x) => !x.startsWith('-'));
      return { flags, files };
    });
    const singles = info.filter((g) => g.files.length === 1 && !g.files[0].includes('*') && !/r/.test(g.flags) && !/\/$/.test(g.files[0]));
    if (info.some((g) => g.files.length === 0)) continue; // reading stdin or unclear: skip
    const allThis = singles.length > 0 && singles.every((g) => g.files[0] === R + rel || (inRepo && (g.files[0] === rel || g.files[0] === './' + rel)))
      && !info.some((g) => /h/.test(g.flags)) && singles.some((g) => /n/.test(g.flags));
    const otherNumbered = parts.some((st) => (st[0][0] === 'cat' && st[0][1] === '-n') || st[0][0] === 'nl');
    // Several single-file greps on different files: their outputs follow each other in order, and each one's
    // numbers rise. Cut the bare N:text lines where the number drops; if that gives one chunk per grep, each
    // chunk is its grep's.
    const onlyGreps = parts.every((st) => (st[0][0] === 'grep' || st[0][0] === 'rg') && st.slice(1).every((x) => x[0] === 'head' || x[0] === 'tail'));
    if (!allThis && singles.length > 1 && inRepo && onlyGreps && singles.length === info.length) {
      const bare = r.result.split('\n').filter((l) => /^\d+[:-]/.test(l));
      const nonBare = r.result.split('\n').filter((l) => l && !/^\d+[:-]/.test(l) && l !== '--');
      if (!nonBare.length) {
        // Walk the lines in order; each belongs to the current grep if its text matches that grep's pattern and
        // its number rises, otherwise to the next grep that matches.
        const res = grepStages.map((w) => grepRegex(w));
        if (res.every(Boolean)) {
          let g = 0, last = -1; const owner = []; let bad = false;
          for (const l of bare) {
            const n = parseInt(l, 10); const text = l.replace(/^\d+[:-]/, '');
            const ctx = /^\d+-/.test(l); // -A/-B context lines need not match
            let k = g;
            if (!(n > last && (ctx || res[k].test(text)))) { k = g + 1; while (k < res.length && !(ctx || res[k].test(text))) k++; }
            if (k >= res.length) { bad = true; break; }
            if (k !== g) last = -1; g = k; owner.push(g); last = n;
          }
          if (!bad) bare.forEach((l, i) => { const f = info[owner[i]].files[0]; if (!(f === R + rel || f === rel || f === './' + rel)) return; const x = /^(\d+)([:-])(.*)$/s.exec(l); if (x && !m.has(+x[1])) m.set(+x[1], x[3]); });
        }
      }
    }
    if (allThis && !otherNumbered && inRepo) for (const line of r.result.split('\n')) { if (/^[\w./-]+[:-]\d+[:-]/.test(line)) continue; const x = /^(\d+)([:-])(.*)$/s.exec(line); if (x && !m.has(+x[1])) m.set(+x[1], x[3]); }
    if (m.size) out.push({ t: r.t, agent: r.agent, src: 'grep -n (any)', lines: m });
  }
  return out;
}

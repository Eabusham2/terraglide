// Unnumbered text that holds runs of a file's lines, for filling gaps by anchor matching:
// Bash outputs of commands that name the file (any cwd), Reads of copies of it, Edit old/new strings,
// Write contents, and python triple-quoted old/new blocks. Each is {t, agent, src, lines: string[]}.
// Also numbered sightings from grep -n lines in mixed outputs: {t, agent, src, lines: Map}.
const R = '/home/user/terraglide/';
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
export function grepNumbered(rows, rel) {
  const base = rel.split('/').pop();
  const out = [];
  for (const r of rows) {
    if (r.name !== 'Bash' || r.error || !r.result) continue;
    const cmd = r.input?.command ?? '';
    if (!cmd.includes(base) || !/\bgrep\b|\brg\b/.test(cmd)) continue;
    // Anything that reshapes grep's lines (a second grep, sed, cut...) or prints only the match: skip.
    if (/\|\s*(grep|rg|cut|awk|tr|sed|sort|uniq|column|nl|cat|xargs|paste|rev|fold)\b/.test(cmd)) continue;
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
    const allThis = greps.length && greps.every((s) => { const files = s.replace(/\|.*$/, '').split(/\s+/).filter((w) => /\.(mjs|js|md|json|py|css|html|yml)$/.test(w) || w.includes('*')); return files.length === 1 && (files[0] === R + rel || (inRepo && (files[0] === rel || files[0] === './' + rel))); }) && /-n/.test(greps.join(' '));
    const otherNumbered = segs.some((s) => /^cat -n|^nl\b|^wc\b/.test(s));
    if (allThis && !otherNumbered && inRepo) for (const line of r.result.split('\n')) { const x = /^(\d+)([:-])(.*)$/s.exec(line); if (x && !m.has(+x[1])) m.set(+x[1], x[3]); }
    if (m.size) out.push({ t: r.t, agent: r.agent, src: 'grep -n (any)', lines: m });
  }
  return out;
}

// Pull every tool call and its result out of the stored events into one time-ordered list:
// {t, agent, name, input, result} - the raw material for rebuilding files.
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const calls = new Map(); const out = [];
for (const file of process.argv.slice(3)) {
  const rl = createInterface({ input: createReadStream(file) });
  for await (const line of rl) {
    const ev = JSON.parse(line); const content = ev.payload?.message?.content; if (!Array.isArray(content)) continue;
    const agent = ev.session_agent_id ?? 'main';
    for (const c of content) {
      if (c.type === 'tool_use') { const rec = { t: ev.created_at, agent, name: c.name, input: c.input, result: null }; calls.set(c.id, rec); out.push(rec); }
      else if (c.type === 'tool_result' && calls.has(c.tool_use_id)) {
        calls.get(c.tool_use_id).result = typeof c.content === 'string' ? c.content : (c.content ?? []).map((x) => x.text ?? '').join('');
        calls.get(c.tool_use_id).error = !!c.is_error;
      }
    }
  }
}
out.sort((a, b) => a.t.localeCompare(b.t));
writeFileSync(process.argv[2], out.map((r) => JSON.stringify(r)).join('\n'));
console.log('calls', out.length, 'with results', out.filter((r) => r.result != null).length);
const by = {}; for (const r of out) by[r.name] = (by[r.name] ?? 0) + 1; console.log(by);

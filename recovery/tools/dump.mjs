// Pages through this session's stored events into a JSONL file. Usage: node dump.mjs <out.jsonl> [k=v&k=v]
import { readFileSync, createWriteStream } from 'node:fs';
const [out, params = ''] = process.argv.slice(2);
const token = readFileSync(process.env.CLAUDE_SESSION_INGRESS_TOKEN_FILE, 'utf8').trim();
const base = `${process.env.SESSION_INGRESS_URL}/v1/code/sessions/${process.env.CLAUDE_CODE_REMOTE_SESSION_ID}`;
const file = createWriteStream(out);
let cursor = null, pages = 0, events = 0, bytes = 0;
do {
  const url = new URL(`${base}/worker/internal-events`);
  url.searchParams.set('limit', '1000');
  for (const kv of params.split('&').filter(Boolean)) { const [k, v] = kv.split('='); url.searchParams.set(k, v); }
  if (cursor) url.searchParams.set('cursor', cursor);
  let res;
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'anthropic-version': '2023-06-01' } });
    if (res.ok) break;
    console.error('status', res.status, 'retrying'); await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  if (!res.ok) { console.error('gave up', res.status, (await res.text()).slice(0, 200)); break; }
  const text = await res.text(); bytes += text.length;
  const body = JSON.parse(text);
  for (const e of body.data ?? []) { file.write(JSON.stringify(e) + '\n'); events++; }
  cursor = body.next_cursor || null; pages++;
  if (pages % 10 === 0) console.error(`pages ${pages} events ${events} MB ${(bytes / 1e6).toFixed(1)}`);
} while (cursor);
file.end();
console.log(`done: pages ${pages}, events ${events}, ${(bytes / 1e6).toFixed(1)} MB -> ${out}`);

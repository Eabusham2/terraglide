# Every pre-wipe log row whose input or output holds TEXT: time, agent, tool, command (short).
import json, sys
texts = sys.argv[1:]
for line in open('calls.jsonl', encoding='utf8'):
    r = json.loads(line)
    if r['t'] >= '2026-10-12T20:03': continue
    inp = json.dumps(r.get('input'), ensure_ascii=False); res = r.get('result') or ''
    for t in texts:
        where = ('in' if t in inp else '') + ('out' if t in res else '')
        if where:
            key = (r.get('input') or {}).get('command') or (r.get('input') or {}).get('file_path') or ''
            print(r['t'][5:19], r['agent'][:6], r['name'], where, repr(t[:30]), key.replace('\n', ' ')[:110])

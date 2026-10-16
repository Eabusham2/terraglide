# Every numbered line of a file in raw command outputs, for commands that read only that file (or whose output
# lines carry the file's name), so pipelines the sighting dump skipped are not lost.
# usage: python3 -I strawgrep.py REL OUT.json
import json, re, sys
rel, out = sys.argv[1:3]
base = rel.split('/')[-1]
res = []
for line in open('calls.jsonl'):
    r = json.loads(line)
    if r['t'] >= '2026-10-12T20:03' or r['name'] != 'Bash' or r.get('error'): continue
    cmd = (r.get('input') or {}).get('command') or ''
    if base not in cmd or not isinstance(r.get('result'), str): continue
    files = set(re.findall(r'[\w./-]+\.(?:mjs|js|json|md|css|html|py|sh|txt|out|log)\b', cmd))
    only = all(f.endswith(base) for f in files if not f.startswith('/tmp')) and not re.search(r'cd\s+/tmp\S*(final|copy|atk|mv)', cmd)
    got = []
    for l in r['result'].split('\n'):
        m = re.match(r'^(?:\S*' + re.escape(base) + r':)(\d+)[:-](.*)$', l)
        if m: got.append((int(m.group(1)), m.group(2))); continue
        if only:
            m = re.match(r'^(\d+)[:-](.*)$', l)
            if m: got.append((int(m.group(1)), m.group(2)))
    if got: res.append({'t': r['t'], 'agent': r['agent'], 'cmd': cmd[:300], 'lines': got})
json.dump(res, open(out, 'w'))
print(len(res), 'outputs', sum(len(x['lines']) for x in res), 'lines')

# Is a file's "final" line count (its last logged wc -l) really final? Any numbered sighting after that wc that
# shows a line past the count means the file grew later. Also: the file now against the highest line ever seen
# after its last wc. usage: python3 -I beyond.py [REL...]
import json, re, sys, os
R = '/home/user/terraglide/'
rows = [json.loads(l) for l in open('calls.jsonl', encoding='utf8')]
rows = [r for r in rows if r['t'] < '2026-10-12T20:03']
counts = {}
for r in rows:
    res = r.get('result') or ''
    if not isinstance(res, str) or 'wc' not in json.dumps(r.get('input')): continue
    for l in res.split('\n'):
        m = re.match(r'^\s*(\d+)\s+(?:/home/user/terraglide/)?(\S+)\s*$', l)
        if m and not m.group(2).startswith('/') and m.group(2) != 'total':
            counts.setdefault(m.group(2), []).append((r['t'], int(m.group(1))))
S = json.load(open('sights.json'))
rels = sys.argv[1:] or sorted(set(S) | set(counts))
for rel in rels:
    if not os.path.exists(R + rel): continue
    now = open(R + rel, encoding='utf8').read().split('\n')
    if now and now[-1] == '': now.pop()
    hist = sorted(counts.get(rel, []))
    last_t, last_n = hist[-1] if hist else ('', None)
    late = [s for s in S.get(rel, []) if s['t'] > last_t]
    top = max((n for s in late for n, _ in s['lines']), default=0)
    top_t = max((s['t'] for s in late if any(n == top for n, _ in s['lines'])), default='')
    flag = ''
    if last_n is not None and top > last_n: flag = 'GREW AFTER LAST wc'
    if top > len(now): flag += ' FILE SHORTER THAN A SIGHTING'
    if last_n is not None and len(now) != last_n and not (top > last_n): flag += ' COUNT != last wc'
    if flag or '-v' in os.environ.get('V', ''):
        print(f'{rel:40s} now {len(now):5d}  last wc {last_n} @{last_t[5:16]}  highest line seen after it {top} @{top_t[5:16]}  {flag}')

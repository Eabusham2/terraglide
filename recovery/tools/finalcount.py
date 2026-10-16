# Per file: the logged line counts over time (wc -l outputs), the final count, and since when the count has
# been final. Then every numbered sighting newer than that (grep -n lines, cat -n, numbered sed parsing) is in
# the final's numbering: each line it shows must be the file's line now, unless a same-count edit came later.
import json, re, sys, os
R = '/home/user/terraglide/'
rows = [json.loads(l) for l in open('calls.jsonl', encoding='utf8')]
rows = [r for r in rows if r['t'] < '2026-10-12T20:03']
counts = {}
for r in rows:
    res = r.get('result') or ''
    if 'wc' not in json.dumps(r.get('input')): continue
    for l in res.split('\n'):
        m = re.match(r'^\s*(\d+)\s+(?:/home/user/terraglide/)?(\S+)\s*$', l)
        if m and not m.group(2).startswith('/') and m.group(2) != 'total':
            counts.setdefault(m.group(2), []).append((r['t'], int(m.group(1))))
S = json.load(open('sights.json'))
rels = sys.argv[1:] or sorted(S)
for rel in rels:
    if not os.path.exists(R + rel): continue
    cur = open(R + rel, encoding='utf8').read().split('\n')
    if cur and cur[-1] == '': cur.pop()
    hist = sorted(counts.get(rel, []))
    if not hist: continue
    final = hist[-1][1]
    # since when: the first logged time of the last run of final counts
    since = hist[-1][0]
    for t, n in reversed(hist):
        if n != final: break
        since = t
    # the count before 'since' (for context)
    bad = []
    for s in S.get(rel, []):
        if s['t'] < since or s.get('hyp'): continue
        for n, t in s['lines']:
            if n - 1 >= len(cur) or cur[n - 1] != t:
                bad.append((s['t'], s['src'], n, t))
    status = 'count ok' if final == len(cur) else f'COUNT {len(cur)} vs final {final}'
    print(f"{rel:34s} final {final:5d} since {since[5:16]}  {status:22s} late numbered lines differing: {len(bad)}")
    for t, src, n, txt in bad[:int(os.environ.get('N', '6'))]:
        print(f"   {t[5:16]} {src[:26]:26s} {n:5d} saw {json.dumps(txt)[:90]}\n{'':45s}now {json.dumps(cur[n-1] if n-1 < len(cur) else None)[:90]}")

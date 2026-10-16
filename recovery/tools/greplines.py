# Every single-line (grep) sighting of FILE since SINCE, against the file now at that number.
import json, sys
S = json.load(open('sights.json'))
rel, since = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ''
cur = open('/home/user/terraglide/' + rel).read().split('\n')
bad = 0
for s in sorted(S[rel], key=lambda s: s['t']):
    if s['t'] < since or not s['src'].startswith('grep'): continue
    for n, t in s['lines']:
        ok = n - 1 < len(cur) and cur[n - 1] == t
        if not ok:
            bad += 1
            where = [i + 1 for i, l in enumerate(cur) if l == t]
            print(s['t'][5:16], s['agent'][:6], n, 'DIFF', 'now elsewhere at ' + str(where[:3]) if where else 'ABSENT', '|', t[:100])
print(rel, 'grep lines differing:', bad)

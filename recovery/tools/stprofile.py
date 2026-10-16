# Offset profile: for each numbered sighting since SINCE, every line that is unique in DRAFT gives
# offset = (its line number then) - (its line number in DRAFT). Steps in the offset between neighbouring
# anchors are lines the file had then that DRAFT lacks there (or the reverse, if negative).
# usage: python3 -I stprofile.py DRAFT SIGHTS REL SINCE [UNTIL]
import json, sys
draft = open(sys.argv[1]).read().split('\n')
if draft[-1] == '': draft.pop()
S = json.load(open(sys.argv[2]))[sys.argv[3]]
SINCE = sys.argv[4]; UNTIL = sys.argv[5] if len(sys.argv) > 5 else '9'
pos = {}
for i, l in enumerate(draft): pos.setdefault(l, []).append(i)
for s in sorted(S, key=lambda s: s['t']):
    if not (SINCE <= s['t'] < UNTIL): continue
    pts = []
    miss = []
    for n, t in sorted(s['lines']):
        if len(t.strip()) > 8 and len(pos.get(t, [])) == 1: pts.append((n, pos[t][0] + 1, n - pos[t][0] - 1))
        elif len(t.strip()) > 8 and t not in pos: miss.append(n)
    if not pts and not miss: continue
    prof = []
    for n, j, off in pts:
        if not prof or prof[-1][2] != off: prof.append((n, j, off))
    print(f"{s['t'][:19]} {s['src'][:26]:26s} anchors {len(pts):3d} new-to-draft {len(miss):3d}  offsets: " + ', '.join(f'{off:+d}@{n}(d{j})' for n, j, off in prof[:14]) + (' ...' if len(prof) > 14 else ''))

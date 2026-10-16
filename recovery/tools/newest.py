# Is each file the newest version the logs saw? Every sighting (sights.json, from dumpsights.mjs) is aligned
# with the file now by a real diff, run by run. Then, for every line of the file and every gap between two
# lines, the NEWEST sighting that covers it gives the verdict:
#   ok        it saw this line here
#   differs   it saw another text in this place
#   extra     it saw the lines either side of this one together, without it
#   missing   (a gap) it saw lines here that the file does not have
# usage: python3 -I newest.py SIGHTS.json [REL...]  (env N = how many problems to print per file)
import json, sys, os, difflib, bisect
R = '/home/user/terraglide/'
S = json.load(open(sys.argv[1]))
rels = sys.argv[2:] or sorted(S)
N = int(os.environ.get('N', '0'))
SINCE = os.environ.get('SINCE', '')

WIPE = '2026-10-12T20:03'
ROWS = []
for line in open(os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), 'calls.jsonl'), encoding='utf8'):
    r = json.loads(line)
    if r['t'] >= WIPE or not isinstance(r.get('result'), str) or r.get('error'): continue
    inp = r.get('input') or {}
    key = inp.get('command') or inp.get('file_path') or ''
    ROWS.append((r['t'], key, r['result']))

def runs(lines):
    out, cur = [], []
    for n, t in lines:
        if cur and n != cur[-1][0] + 1:
            out.append(cur); cur = []
        cur.append((n, t))
    if cur: out.append(cur)
    return out

for rel in rels:
    cur = open(R + rel, encoding='utf8').read().split('\n')
    if cur and cur[-1] == '': cur.pop()
    pos = {}
    for i, l in enumerate(cur): pos.setdefault(l, []).append(i)
    line_v = [None] * len(cur)        # (verdict, t, src, saw)
    gap_v = [None] * (len(cur) + 1)   # gap g is before line index g
    absent = []                       # single lines seen that are nowhere in the file now
    sights = sorted(S.get(rel, []), key=lambda s: s['t'], reverse=True)
    for s in sights:
        if s['t'] < SINCE: continue
        for run in runs(s['lines']):
            texts = [t for _, t in run]
            if len(run) < 3:
                for n, t in run:
                    if t.strip() and t not in pos: absent.append((s['t'], s['src'], n, t))
                    elif t.strip():
                        i = min(pos[t], key=lambda i: abs(i - (n - 1)))
                        if line_v[i] is None: line_v[i] = ('ok', s['t'], s['src'], t)
                continue
            # rough place: the median shift of the run's lines that are unique in the file now
            shifts = sorted(pos[t][0] - (n - 1) for n, t in run if t.strip() and len(pos.get(t, [])) == 1)
            if not shifts: continue
            k = shifts[len(shifts) // 2]
            a = max(0, run[0][0] - 1 + k - 200); b = min(len(cur), run[-1][0] - 1 + k + 200)
            sm = difflib.SequenceMatcher(None, texts, cur[a:b], autojunk=False)
            ops = sm.get_opcodes()
            eq = [o for o in ops if o[0] == 'equal']
            if not eq: continue
            # Trust a change only between two solid anchors (equal blocks of 2+ lines, or 1 non-trivial line),
            # and only when the run as a whole matched well: a short view whose two ends matched far apart is
            # not evidence of anything in between.
            matched = sum(o[2] - o[1] for o in eq)
            if matched < max(3, 0.5 * len(texts)): continue
            def solid(o): return (o[2] - o[1]) >= 2 or len(texts[o[1]].strip()) >= 12
            first, last = ops.index(eq[0]), ops.index(eq[-1])
            seq = ops[first:last + 1]
            for idx, (tag, i1, i2, j1, j2) in enumerate(seq):
                if tag != 'equal':
                    prev, nxt = seq[idx - 1], seq[idx + 1]
                    if not (solid(prev) and solid(nxt)) or (j2 - j1) > (i2 - i1) + 40: continue
                if tag == 'equal':
                    for d in range(i2 - i1):
                        j = a + j1 + d
                        if line_v[j] is None: line_v[j] = ('ok', s['t'], s['src'], texts[i1 + d])
                        if d > 0 and gap_v[j] is None: gap_v[j] = ('ok', s['t'], s['src'], None)
                elif tag == 'replace':
                    for d in range(j2 - j1):
                        j = a + j1 + d
                        if line_v[j] is None: line_v[j] = ('differs', s['t'], s['src'], texts[i1 + min(d, i2 - i1 - 1)])
                elif tag == 'insert':
                    for d in range(j2 - j1):
                        j = a + j1 + d
                        if line_v[j] is None: line_v[j] = ('extra', s['t'], s['src'], None)
                elif tag == 'delete':
                    g = a + j1
                    if gap_v[g] is None: gap_v[g] = ('missing', s['t'], s['src'], texts[i1:i2])
    bad = [(i, v) for i, v in enumerate(line_v) if v and v[0] != 'ok']
    # Settled by raw text: a later output for this file (its name in the command, or a Read of it) that
    # holds the line as it is now. Grep context (-A/-B), mixed commands and the like are not parsed above.
    base = rel.split('/')[-1]
    later = [r for r in ROWS if base in r[1] or r[1] == R + rel]
    def seen_after(text, t):
        if len(text.strip()) < 6: return None
        for rt, _, res in later:
            if rt > t and text.strip() in res: return rt
        return None
    def seen_before(text, t):
        if len(text.strip()) < 6: return None
        for rt, _, res in later:
            if rt < t and text.strip() in res: return rt
        return None
    settled = 0; keep = []
    for i, v in bad:
        if v[0] == 'differs' or v[0] == 'extra':
            when = seen_after(cur[i], v[1])
            if when: settled += 1; continue
        if v[0] == 'differs':
            b = seen_before(cur[i], v[1])
            v = v + (('OLD seen ' + b[5:16]) if b else 'GUESS',)
        keep.append((i, v))
    bad = keep
    olds = [(i, v) for i, v in bad if v[0] == 'differs' and v[4].startswith('OLD')]
    gaps = [(g, v) for g, v in enumerate(gap_v) if v and v[0] == 'missing']
    cov = sum(1 for v in line_v if v)
    # absent single lines: only those newer than every sighting confirming the line now nearest their number
    print(f"{rel:34s} {len(cur):5d} lines  covered {cov:5d}  settled-later {settled:4d}  OLD {len(olds):3d}  newest-differs {sum(1 for _, v in bad if v[0]=='differs'):4d}  newest-extra {sum(1 for _, v in bad if v[0]=='extra'):4d}  newest-missing-gaps {len(gaps):3d} ({sum(len(v[3]) for _, v in gaps)} lines)")
    if N:
        shown = 0
        items = [('L', i, v) for i, v in bad] + [('G', g, v) for g, v in gaps]
        items.sort(key=lambda x: x[1])
        for kind, i, v in items:
            if shown >= N: break
            shown += 1
            if kind == 'L':
                if os.environ.get('ONLYOLD') and not (len(v) > 4 and v[4].startswith('OLD')): continue
                print(f"   {i+1:5d} {v[0]:8s} {v[4] if len(v) > 4 else '':22s} @{v[1][5:16]} ({v[2]}) now {json.dumps(cur[i])[:110]}" + (f"\n         {'':8s} saw {json.dumps(v[3])[:110]}" if v[3] is not None else ''))
            else:
                print(f"   {i+1:5d} missing  @{v[1][5:16]} ({v[2]}) before {json.dumps(cur[i] if i < len(cur) else None)[:80]}: {len(v[3])} lines, first {json.dumps(v[3][0])[:90]}")

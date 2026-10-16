# Parser-free check: every pre-wipe tool output that names a file (a Bash command with its name, or a Read
# of it) is diffed as raw text against the file now. Line-number prefixes (grep's "N:" / "N-", cat -n's
# "  N<tab>", "path:N:") are taken off first. Between two anchors (runs of 3+ matching lines) in the same
# output, a stretch that differs is evidence about that place in the file. For every line (and every gap
# between lines) of the file, the NEWEST output that covers it decides: ok, or differs. Reported: places
# whose newest evidence differs, unless the text now there was seen in a later output (settled).
# usage: python3 -I rawalign.py REL... (env N = how many to print per file; SINCE = only outputs since)
import json, os, re, sys, difflib
R = '/home/user/terraglide/'
WIPE = '2026-10-12T20:03'
N = int(os.environ.get('N', '20'))
SINCE = os.environ.get('SINCE', '')
here = os.path.dirname(os.path.abspath(__file__))
rows = []
for line in open(os.path.join(here, 'calls.jsonl'), encoding='utf8'):
    r = json.loads(line)
    if r['t'] >= WIPE or r.get('error') or not isinstance(r.get('result'), str) or not r['result']: continue
    inp = r.get('input') or {}
    if r['name'] == 'Bash': key = inp.get('command') or ''
    elif r['name'] == 'Read': key = inp.get('file_path') or ''
    else: continue
    rows.append((r['t'], r['agent'], r['name'], key, r['result']))

PFX = [re.compile(r'^\s*\d+\t'), re.compile(r'^(?:\S+?[:-])?\d+[:-]'), re.compile(r'^\d+:\d+:')]
NUM = [re.compile(r'^\s*(\d+)\t'), re.compile(r'^(?:\S+?[:-])?(\d+)[:-]'), re.compile(r'^\d+:(\d+):')]
def segments(lines):
    """The output cut where its own line numbers jump (grep, cat -n); a run without numbers stays whole."""
    segs, cur, prev = [], [], None
    for l in lines:
        n = None
        for p in NUM:
            m = p.match(l)
            if m: n = int(m.group(1)); l = l[m.end():]; break
        if n is not None and prev is not None and n != prev + 1 and cur:
            segs.append(cur); cur = []
        prev = n
        cur.append(l)
    if cur: segs.append(cur)
    return segs

def trivial(l): return len(l.strip()) < 4

for rel in sys.argv[1:]:
    cur = open(R + rel, encoding='utf8').read().split('\n')
    if cur and cur[-1] == '': cur.pop()
    base = rel.split('/')[-1]
    line_v = [None] * len(cur); gap_v = [None] * (len(cur) + 1)
    pos = {}
    for i, l in enumerate(cur): pos.setdefault(l, []).append(i)
    mine = [r for r in rows if (base in r[3]) and r[0] >= SINCE]
    mine.sort(key=lambda r: r[0], reverse=True)
    seen_text_after = {}
    for t, agent, name, key, res in mine:
        L = res.split('\n')
        if name == 'Read' and not key.endswith('/' + rel) and key != R + rel: continue
        for S in segments(L):
            if len(S) < 3: continue
            sm = difflib.SequenceMatcher(None, S, cur, autojunk=False)
            blocks = [b for b in sm.get_matching_blocks() if b.size >= 3 and sum(1 for x in S[b.a:b.a + b.size] if not trivial(x)) >= 2]
            for b in blocks:
                for d in range(b.size):
                    j = b.b + d
                    if line_v[j] is None: line_v[j] = ('ok', t, agent)
                    if d and gap_v[j] is None: gap_v[j] = ('ok', t, agent)
            for b1, b2 in zip(blocks, blocks[1:]):
                ga = (b1.a + b1.size, b2.a); gb = (b1.b + b1.size, b2.b)
                na, nb = ga[1] - ga[0], gb[1] - gb[0]
                if na < 0 or nb < 0 or (na == 0 and nb == 0) or na > 12 or nb > 12: continue
                saw = S[ga[0]:ga[1]]
                if nb == 0:
                    g = gb[0]
                    if gap_v[g] is None: gap_v[g] = ('missing', t, agent, saw)
                elif na == 0:
                    continue  # lines now that this output went past: other views say whether they belong
                else:
                    for d in range(nb):
                        j = gb[0] + d
                        if line_v[j] is None: line_v[j] = ('differs', t, agent, saw)
    probs = [(i, v) for i, v in enumerate(line_v) if v and v[0] != 'ok'] + [(g, v) for g, v in enumerate(gap_v) if v and v[0] == 'missing']
    # settled: the text now there appears in a later output for this file
    def later(text, t):
        if len(text.strip()) < 6: return False
        return any(r[0] > t and text.strip() in r[4] for r in mine)
    keep = []
    for i, v in sorted(probs, key=lambda x: x[0]):
        if v[0] == 'differs' and later(cur[i], v[1]): continue
        keep.append((i, v))
    cov = sum(1 for v in line_v if v)
    print(f"{rel:34s} {len(cur):5d} lines  covered {cov:5d}  newest-raw-differs {sum(1 for _, v in keep if v[0]=='differs'):4d}  missing-gaps {sum(1 for _, v in keep if v[0]=='missing'):3d}")
    for i, v in keep[:N]:
        if v[0] == 'differs':
            print(f"   {i+1:5d} differs @{v[1][5:16]} {v[2][:6]} now {json.dumps(cur[i])[:100]}\n                 saw {json.dumps(v[3])[:160]}")
        else:
            print(f"   {i+1:5d} missing @{v[1][5:16]} {v[2][:6]} before {json.dumps(cur[i] if i < len(cur) else None)[:60]}: {json.dumps(v[3])[:160]}")

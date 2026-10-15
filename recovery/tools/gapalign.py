# For each gap of a partial file (FINAL with @@MISSING n@@), show the text a complete older version (OLD) has between the
# same anchors: the gap length vs the older length. Usage: gapalign.py OLD FINAL [OUT]  (OUT: FINAL with gaps filled from OLD
# where the lengths agree exactly; others left).
import sys, re
old = open(sys.argv[1]).read().split('\n'); fin = open(sys.argv[2]).read().split('\n')
if old[-1] == '': old.pop()
if fin[-1] == '': fin.pop()
M = lambda l: re.match(r'^@@MISSING \d+@@$', l)
def find(seq, start=0):
    for i in range(start, len(old) - len(seq) + 1):
        if old[i:i+len(seq)] == seq: return i
    return -1
out = []; i = 0; report = []
while i < len(fin):
    if not M(fin[i]): out.append(fin[i]); i += 1; continue
    j = i
    while j < len(fin) and M(fin[j]): j += 1
    gap = j - i
    # anchors: up to 3 known lines on each side, as many as unique
    got = None
    for k in (3, 2, 1):
        before = fin[max(0, i-k):i]; after = fin[j:j+k]
        if any(M(x) for x in before + after): continue
        a = find(before) if before else 0
        if before and a < 0: continue
        if before and find(before, a + 1) >= 0: continue
        s = a + len(before) if before else 0
        e = find(after, s) if after else len(old)
        if e < 0: continue
        got = (s, e); break
    if got:
        s, e = got; n = e - s
        report.append((i + 1, gap, n, s + 1))
        if n == gap: out += old[s:e]
        else: out += fin[i:j]
    else:
        report.append((i + 1, gap, None, None)); out += fin[i:j]
    i = j
for r in report: print('gap at %d: %d lines; older has %s (from its line %s)%s' % (r[0], r[1], r[2], r[3], '  EXACT LENGTH' if r[1] == r[2] else ''))
if len(sys.argv) > 3: open(sys.argv[3], 'w').write('\n'.join(out) + '\n'); print('left', sum(1 for x in out if M(x)))

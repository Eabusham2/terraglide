# Map each @@MISSING run of FINAL onto OLD via a diff of the known lines: the older segment between the nearest
# lines matched on either side. Usage: align2.py OLD FINAL [OUT] [--show]
#  OUT: FINAL with every gap whose older segment has the same length filled from it.
import sys, re, difflib
args = [a for a in sys.argv[1:] if not a.startswith('--')]; show = '--show' in sys.argv
old = open(args[0]).read().split('\n'); fin = open(args[1]).read().split('\n')
for X in (old, fin):
    if X and X[-1] == '': X.pop()
M = lambda l: bool(re.match(r'^@@MISSING \d+@@$', l))
# match only known lines; markers get unique junk so they never match
fk = [l if not M(l) else '\0%d' % k for k, l in enumerate(fin)]
sm = difflib.SequenceMatcher(None, fk, old, autojunk=False)
f2o = {}
for a, b, n in sm.get_matching_blocks():
    for k in range(n): f2o[a + k] = b + k
out = []; i = 0; rep = []
while i < len(fin):
    if not M(fin[i]): out.append(fin[i]); i += 1; continue
    j = i
    while j < len(fin) and M(fin[j]): j += 1
    p = i - 1
    while p >= 0 and p not in f2o: p -= 1
    q = j
    while q < len(fin) and q not in f2o: q += 1
    os_ = f2o[p] + 1 if p >= 0 else 0
    oe = f2o[q] if q < len(fin) else len(old)
    # known-but-unmatched final lines between p and q (changed text near the gap)
    changed = [k for k in range(p + 1, q) if not M(fin[k])]
    seg = old[os_:oe]
    exact = (not changed) and len(seg) == j - i
    rep.append((i + 1, j - i, len(seg), os_ + 1, len(changed), exact))
    if exact: out += seg
    else: out += fin[i:j]
    if show and not exact:
        print('---- gap at %d (%d lines), older %d..%d (%d lines), %d changed known lines nearby' % (i + 1, j - i, os_ + 1, oe, len(seg), len(changed)))
    i = j
for r in rep: print('gap at %d: %d lines; older segment %d lines from %d; %d changed known lines between anchors%s' % (r[0], r[1], r[2], r[3], r[4], '  EXACT' if r[5] else ''))
if len(args) > 2: open(args[2], 'w').write('\n'.join(out) + '\n'); print('left', sum(1 for x in out if M(x)))

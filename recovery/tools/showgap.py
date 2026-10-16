# showgap.py OLD FINAL FROM TO : show FINAL lines FROM..TO (gaps as ~~) beside the OLD segment between the matched anchors.
import sys, re, difflib
old = open(sys.argv[1]).read().split('\n'); fin = open(sys.argv[2]).read().split('\n')
a, b = int(sys.argv[3]), int(sys.argv[4])
M = lambda l: bool(re.match(r'^@@MISSING \d+@@$', l))
fk = [l if not M(l) else '\0%d' % k for k, l in enumerate(fin)]
sm = difflib.SequenceMatcher(None, fk, old, autojunk=False)
f2o = {}
for x, y, n in sm.get_matching_blocks():
    for k in range(n): f2o[x + k] = y + k
p = a - 2
while p >= 0 and p not in f2o: p -= 1
q = b
while q < len(fin) and q not in f2o: q += 1
print('FINAL %d..%d' % (p + 1, q + 1))
i = p
while i <= q and i < len(fin):
    if M(fin[i]):
        j = i
        while j < len(fin) and M(fin[j]): j += 1
        print('     ~~ %d missing (%d-%d)' % (j - i, i + 1, j)); i = j; continue
    print('%5d %s %s' % (i + 1, ' ' if i in f2o else '*', fin[i])); i += 1
os_, oe = f2o.get(p, -1), f2o.get(q, len(old))
print('OLD %d..%d' % (os_ + 1, oe + 1))
for k in range(os_, min(oe + 1, len(old))): print('%5d   %s' % (k + 1, old[k]))

# Replace a run of @@MISSING lines in a rebuilt file with given lines (the reasoned part of the recovery).
# usage: apply.py IN OUT GUESSFILE   where GUESSFILE holds blocks:  "@@ FIRST-LAST", the lines, then "@@end".
# FIRST-LAST are the numbers written in the markers ("@@MISSING n@@", the rebuild's own numbering), so a block
# finds its gap even after earlier gaps were filled with a different number of lines.
import sys, re
inp, out, gf = sys.argv[1:4]
L = open(inp).read().split('\n')
if L and L[-1] == '': L.pop()
blocks = []; cur = None
for line in open(gf).read().split('\n'):
    m = re.match(r'^@@ (\d+)-(\d+)$', line)
    if m: cur = [int(m.group(1)), int(m.group(2)), []]; continue
    if line == '@@end': blocks.append(cur); cur = None; continue
    if cur is not None: cur[2].append(line)
for a, b, lines in sorted(blocks, key=lambda x: -x[0]):
    i = L.index('@@MISSING %d@@' % a)
    for k in range(a, b + 1):
        assert L[i + k - a] == '@@MISSING %d@@' % k, (gf, k, L[i + k - a][:60])
    L[i:i + b - a + 1] = lines
left = sum(1 for x in L if re.match(r'^@@MISSING \d+@@$', x))
open(out, 'w').write('\n'.join(L) + '\n')
print(out, len(L), 'lines,', left, 'still missing')

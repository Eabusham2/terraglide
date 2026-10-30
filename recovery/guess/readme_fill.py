# README.md (696, the Oct 11 05:43 count): the pooled Oct 11 version has 49 lines nobody showed since.
#  557-580: the commit's 447-470, unchanged (the stretch is exactly as long; 581, the settings tab list,
#           gained "Online" and is known).
#  638-641: the commit's 519-522 (the close of the commands block and the selftest paragraph's start).
#  669:     the commit's assets line, unchanged (an Oct 5 diff of the README shows it as context).
#  671:     "the generators for the star catalogue and the place names" (the same diff).
#  672-690: the commit's 548-566 (vendor/three, the Licence section).
import sys, subprocess
v4, out = sys.argv[1:3]
L = open(v4).read().split('\n')
if L[-1] == '':
    L.pop()
C = subprocess.run(['git', '-C', '/home/user/terraglide', 'show', '2c7ee70:README.md'], capture_output=True, text=True).stdout.split('\n')
def put(a, lines):
    for k, s in enumerate(lines):
        assert L[a - 1 + k] == '@@MISSING %d@@' % (a + k), (a + k, L[a - 1 + k])
        L[a - 1 + k] = s
c = lambda a, b: C[a - 1:b]
put(557, c(447, 470))
put(638, c(519, 522))
put(669, c(546, 546))
put(671, ['                    the generators for the star catalogue and the place names'])
put(672, c(548, 566))
assert not any(l.startswith('@@MISSING') for l in L)
assert len(L) == 696
open(out, 'w').write('\n'.join(L) + '\n')
print('ok')

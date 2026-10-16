# tools/shots.mjs, final (389 lines): lines 1-300 from the logged `sed -n` views of Oct 5 13:53 (1,60p and
# 60,260p) and Oct 7 21:37 (200,300p), checked against Oct 7 21:38's 1,60p and 150,200p; lines 301-389 are
# the commit's 270-358. Against the commit that is +33 -2 = the `35 +-` of every stat from Oct 5 05:36 on.
# usage: python3 -I shots_build.py COMMIT_SHOTS OUT    (COMMIT_SHOTS = `git show 2c7ee70:tools/shots.mjs`)
import json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
commit_p, out_p = sys.argv[1:3]
views = json.load(open(os.path.join(here, 'shots', 'views.json')))
F = {}
for v in views:
    for k, line in enumerate(v['lines']):
        n = v['from'] + k
        assert F.get(n, line) == line, (n, v['when'])
        F[n] = line
assert sorted(F) == list(range(1, 301))
commit = open(commit_p).read().split('\n')
if commit[-1] == '': commit.pop()
assert len(commit) == 358 and commit[268] == F[300]
out = [F[n] for n in range(1, 301)] + commit[269:]
assert len(out) == 389
open(out_p, 'w').write('\n'.join(out) + '\n')
print(out_p, len(out))

# avatar.js: the final's known lines (5137) with every never-seen line filled. FINAL_TOP has lines 1-10 from the
# commit already. Usage: avatar_build.py FINAL_TOP V1_FILLED REGION_DIR OUT HEAD
import sys, re, os
F = open(sys.argv[1]).read().split('\n'); V = open(sys.argv[2]).read().split('\n'); R = sys.argv[3]
M = lambda l: bool(re.match(r'^@@MISSING \d+@@$', l))
def put(first, lines, why):
    n = len(lines)
    # Only into missing lines - or over a known line that says the same.
    bad = [(first + k, x[:40]) for k, x in enumerate(F[first - 1:first - 1 + n]) if not M(x) and x != lines[k]]
    assert not bad, (why, bad)
    F[first - 1:first - 1 + n] = lines
def region(name):
    return open(os.path.join(R, name)).read().rstrip('\n').split('\n')
put(890, region('region_0890.txt'), 'swing constants')
assert F[901] == 'const _swingTurn = new THREE.Quaternion();'
r = region('region_0903.txt')
assert r[1] == 'const _swingArm = new THREE.Quaternion();' and len(r) == 126
F[902:1028] = r  # 903-1028; 904-906 and 997 are known lines and match
assert F[996].strip().startswith('for (let i = 0; i < position.count; i++) points.push')
# 1029 and 1093 are known from the Oct 10 03:11 `grep -n | grep -n` (newer than the best store).
for n, text in [(1029, 'const _swing = new THREE.Quaternion();'), (1093, '  return new THREE.Vector3(x, y, WING_CAMBER * wingFraction(x) ** 2);')]:
    assert F[n - 1] == text or M(F[n - 1]), (n, F[n - 1])
    F[n - 1] = text
# After _swing the Oct 3 text runs on unchanged to the end of the stretch: final 1030-1194 = V1 943-1107 (1093 known).
assert V[941] == 'const _swing = new THREE.Quaternion();' and V[1005] == F[1092]
put(1030, V[942:1107], 'scratch, skin, wing helpers (Oct 3 text)')
assert F[1194] == '  }' and F[1197] == 'export class Avatar {'
put(1479, ["    // The view model's sword shares the world one's geometry and materials.",
           "    // A little bigger than life, as every first-person sword is: what is in",
           "    // your hand is the thing you are looking at. HAND_SWORD_SIZE and",
           "    // HAND_SWORD_AT, because holdSword puts it back there after a swing."], 'hand sword comment')
# The commit's doc for the scanned body is kept as it was (the Oct 9 stat leaves room for no rewrite of it), with
# nothing added; then the new once-loader's doc opens as the sword's and the firework's do.
H = open(sys.argv[5]).read().split('\n')
k = H.index('  async loadModel(base = ASSET_BASE) {')
doc = H[k - 12:k]  # "   * reconstructs what it sees ..." through "   */": 12 lines, exactly the room there is
assert doc[0].startswith('   * reconstructs what it sees') and doc[-1] == '   */', (doc[0], doc[-1])
put(1841, doc + ["  /**", "   * Load the generated mesh, once: a second call while the first is still loading gets"], 'model doc')
assert F[1854].startswith('   * the same answer rather than starting another.')
put(3951, V[3850:3924], 'poseScan tail and rocket doc (Oct 3 text)')
assert F[4024] == '  /**'
put(5069, V[4833:4860], 'updateHand poses (Oct 3 text)')
put(5096, ["    // A swing carries the hand across the frame with the blade: in toward the",
           "    // middle and up as it winds back, then down and out past its corner as it",
           "    // comes through - Minecraft's arc, from the hand's own corner. The turn of",
           "    // the blade itself is holdSword's."], 'swing comment')
assert F[5099].strip().startswith('const { lift, cut } = swingPose')
put(5102, ["      right = right.slice();",
           "      right[0] -= lift * 0.35;",
           "      right[1] -= Math.max(cut, 0) * 0.25 - Math.min(cut, 0) * 0.2;",
           "    }"], 'swing body')
put(5106, V[4860:4866], 'place hands (Oct 3 text)')
assert F[5110] == '    const sway = this.handSway;', F[5110]
left = [i + 1 for i, x in enumerate(F) if M(x)]
assert not left, left
open(sys.argv[4], 'w').write('\n'.join(F))
print('ok', len(F) - (1 if F[-1] == '' else 0), 'lines')

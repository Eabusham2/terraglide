# Fill the 19 lines the pooled Oct 6 21:57 game.js (V4, 2813 lines) lacks.
#  27-32: the providers import, exact from an Oct 5 05:55 `grep -B6` (the five names in that order).
#  61, 64: the gazetteer and combat imports (describePlace/randomFeature and findTarget are used; V2's lines).
#  84: POSITION_KEY (used; V3's line). Line 83 is the lander comment left behind when LANDER_EVERY_S moved to
#      protocol.js (an Oct 9 grep shows 83 as that comment).
#  2736-2746: never shown in any version. The end of the googleViewport call is the commit's; the doc and the
#      signature of offworldAddress(player) (called at 1540) are WRITTEN BY ME.
import sys
src, dst = sys.argv[1], sys.argv[2]
L = open(src).read().split('\n')
fill = {
    27: '  IMAGERY_PROVIDERS,',
    28: '  createElevationSource,',
    30: '  createImagerySource,',
    31: '  providerChain,',
    32: "} from './tiles/providers.js';",
    61: "import { describePlace, randomFeature } from './geo/gazetteer.js';",
    64: "import { findTarget } from './player/combat.js';",
    84: "const POSITION_KEY = 'last-position';",
}
tail = [
    '      )',
    '      .catch(() => {',
    '        /* The tiles still draw; the corner keeps the line it had. */',
    '      });',
    '  }',
    '',
    '  /**',
    '   * Where you are, off Earth, for the corner: the named place you are in or',
    '   * nearest, and how far it is back to air — your lander or the base.',
    '   */',
    '  offworldAddress(player) {',
]
for k, s in enumerate(tail): fill[2736 + k] = s
for n, s in fill.items():
    assert L[n - 1] == '@@MISSING %d@@' % n, (n, L[n - 1])
    L[n - 1] = s
assert not any(l.startswith('@@MISSING') for l in L)
open(dst, 'w').write('\n'.join(L))

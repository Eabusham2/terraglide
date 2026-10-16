# player.js: the final's known lines (views from Oct 7 on, 755 lines) with its never-seen lines filled:
#  7-22  the imports: bodies (BODY is used and nothing else imports it) and the protocol names, sorted, that the body
#        uses (exactly 13; MAX_HEALTH first at 9 as on Oct 6, and the known 16-17, 19-21 in place);
#  23-29 the commit's file doc (lines 7-13), which ends at the known 30;
#  133-137 a doc for the surge re-export at 138, worded like the oxygen one at 127-131 (mine);
#  139-179 the commit's lines 112-152 (blank, class Player, the constructor down to this.lat), which end at the known 180.
# Usage: player_build.py FINAL_PARTIAL HEAD OUT
import sys, re
F = open(sys.argv[1]).read().split('\n'); H = open(sys.argv[2]).read().split('\n')
M = lambda l: bool(re.match(r'^@@MISSING \d+@@$', l))
L = F[:]
L[6] = "import { BODY } from '../geo/bodies.js';"
L[7] = 'import {'
for i, n in enumerate(['MAX_HEALTH', 'OXYGEN_REFILL_PER_S', 'OXYGEN_SECONDS', 'REGEN_DELAY_S', 'REGEN_EVERY_S', 'ROCKET_REFILL_S', 'ROCKET_STACK']):
    L[8 + i] = '  %s,' % n
assert L[15] == '  SPEED_MODE_COOLDOWN_S,' and L[16] == '  SPEED_MODE_SECONDS,'
L[17] = '  SUFFOCATION_PER_S,'
assert L[18] == '  SURGE_BLEED_PER_S,' and L[20] == '  SWORD_SLOT,'
L[21] = "} from '../net/protocol.js';"
L[22:29] = H[6:13]
assert L[29] == ' */'
L[132:137] = ['/**', ' * Surge: what it is worth, how long it runs, and how long it takes back. The', ' * numbers live with the wire protocol, because on a server the server holds', ' * your surge to them; see net/protocol.js.', ' */']
assert L[137].startswith('export { SPEED_MODE')
L[138:179] = H[111:152]
assert L[179] == '    this.lon = 0;'
assert not any(M(x) for x in L)
open(sys.argv[3], 'w').write('\n'.join(L))

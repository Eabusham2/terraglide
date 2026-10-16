# Build tools/selftest.mjs (the final: 11622 lines) from the commit, every logged edit, the logged views and what
# no log shows, WRITTEN BY ME to the labels and numbers the final printed (see recovery/NOTES.md, "selftest.mjs").
#
#   1. The commit's file, and the eight logged edits of Oct 3-5 replayed in order (edits.json: a46d0e35's planetary
#      section - written, fixed twice in the scratchpad, put in before "Dive and zoom", its characters escaped, then
#      the Mars CTX check - aee77e2c's two Edits and a54442e4's Edit, python edit and Edit). 11135 lines.
#   2. One line the Oct 5 05:39 view shows that the replay lacks: stepGlide(..., this.env) (views.json).
#   3. The rest, from the bottom up so earlier line numbers hold:
#        the tail block before "every module still parses" (tail_fills.py: the Oct 6-11 views + fills);
#        slot C (woodland: `surveyed &&`, +3), slot B (the airborne hold: holdAltitude, +2), slot X (the compass
#        clear of the minimap, +5), slot A (the save and teleportTo, +2), the touch hotbar (six slots, +6);
#        the block of new sections after "your own legs" (block_fills.py: the Oct 9 and Oct 11 views, the Oct 11
#        05:11 edit's new text, single lines from the final's greps, and fills), and "your own legs" itself (+5).
#   4. Asserted: 11622 lines and the final's anchors. greps_check.py then re-runs every final-era grep.
#
# usage: python3 -I selftest_build.py COMMIT_SELFTEST OUT
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'selftest'))
from block_fills import build as build_block, OWN_LEGS
from tail_fills import build as build_tail
commit, out = sys.argv[1:3]
E = json.load(open(os.path.join(HERE, 'selftest', 'edits.json')))
V = json.load(open(os.path.join(HERE, 'selftest', 'views.json')))
L = open(commit).read().split('\n')
if L[-1] == '': L.pop()
assert len(L) == 10711, len(L)

# 1. The logged edits, in order, up to Oct 5 (the Oct 11 one is in the block's text).
class Box:
    def __init__(self, text): self.s = text
for e in E:
    if e['t'] >= '2026-10-06': continue
    text = '\n'.join(L) + '\n'
    if 'code' in e:
        box = Box(text)
        class F:
            def __init__(self, *a, **k): pass
            def read(self): return box.s
            def write(self, x): box.s = x
        g = {'open': F, 'print': lambda *a, **k: None, **e.get('vars', {})}
        exec(e['code'], g)
        text = box.s
    else:
        assert text.count(e['old']) == 1, (e['t'], e['old'][:60])
        text = text.replace(e['old'], e['new'], 1)
    L = text.split('\n')
    if L[-1] == '': L.pop()
assert len(L) == 11135, len(L)

def at(n, text): assert L[n - 1] == text, (n, L[n - 1], text)
# 2. The Oct 5 05:39 view's line.
at(8631, r"      /stepGlide\(player\.velocity, this\.look, player\.pitch\)/.test(controller) &&")
L[8630] = V['oct5_0539_line_8631']

# 3.
# --- edits from the bottom up, so the v7 line numbers above stay right
# tail block before "every module still parses" (v7 11106)
at(11106, "console.log('\\nevery module still parses');")
seen = {int(k): v for k, v in V['tail_oct7'].items()}
tail = build_tail(seen)
L[11105:11105] = tail
# C: v7 6910-6911, 6919-6921 (woodland, surveyed)
at(6910, "  ok('the scanned world is left alone, and so is Overpass',")
L[6909:6911] = r"""  // Nor anywhere but Earth: a wood is a survey of Earth, as a building is.
  ok('the scanned world is left alone, and so is Overpass',
    /this\.woodland\.enabled = surveyed && !photoreal && settings\.get\('woodlandRelief'\)/.test(wiring));""".split('\n')
k = L.index("  ok('and turning it off stops the photograph half as well',")
assert L[k + 1] == r"    /uWoodStrength\.value = !photoreal && settings\.get\('woodlandRelief'\) \? 1 : 0/.test(wiring)"
L[k:k + 2] = r"""  // And off Earth there is nothing surveyed to lift, so it is off there too,
  // as the buildings are.
  ok('and turning it off stops the photograph half as well',
    /uWoodStrength\.value = surveyed && !photoreal && settings\.get\('woodlandRelief'\) \? 1 : 0/.test(wiring)""".split('\n')
# B: v7 6755-6760
at(6758, "  ok('the airborne hold keeps its distance from the ground',")
L[6757:6760] = r"""  // Or at the height it was sent to, beside a friend in the air - but never
  // inside the ground either way.
  ok('the airborne hold keeps its distance from the ground',
    /Math\.max\(this\.holdAltitude, ground \+ 20\)\s*: ground \+ SPAWN_HEIGHT_M;/.test(game)
    && /Math\.abs\(this\._holdY - above\) > GROUND_JUMP_M/.test(game));""".split('\n')
# X: the minimap section, before its closing brace (v7 5780 = the stylesheet check's second line)
at(5777, "  ok('and the stylesheet knows every one of them',")
at(5779, "}")
L[5778:5778] = r"""  // Wherever it sits, the compass under it keeps clear on a narrow screen: the
  // minimap says how far down the top-right corner it reaches.
  ok('and on a narrow screen the compass keeps clear of it',
    /setProperty\('--minimap-top-right'/.test(minimap)
    && /top: calc\(var\(--minimap-top-right, 0px\) \+ 14px\)/.test(css));""".split('\n')
# A: v7 5215-5218
at(5215, "  ok('what you were doing is saved with where you were',")
L[5214:5218] = r"""  ok('what you were doing is saved with where you were',
    /flying: !player\.dead && \(!player\.onGround \|\| player\.elytraDeployed\)/.test(game));
  ok('and the spawn is told it', /reason: 'spawn', quiet: true, flying: wasFlying/.test(game));
  // And where you were sent to, when that is beside somebody in the air: the
  // height, and the way they were facing.
  ok('teleportTo takes it', /async teleportTo\(lat, lon, \{ reason = 'manual', quiet = false, flying, altitude, yaw \} = \{\}\)/.test(game));""".split('\n')
# touch: v7 3324-3329
at(3324, "  // five completely — they could not be selected at all — and at 360 wide the")
L[3323:3329] = r"""  // five completely, and at 360 wide the bar ran off the left edge as well.
  ok('the touch hotbar sits above the controls, however many rows of them there are, not across the minimap',
    /body\.touch-active \.hud-hotbar \{[\s\S]{0,200}bottom: max\(182px, calc\(var\(--touch-rows, 2\) \* 60px \+ 30px\)\)/.test(css));
  // Six slots now, the sword with the rockets: sized for five, the sixth ran
  // off the edge of a phone. The count comes from the page.
  ok('and every slot is sized to share the window, however many there are',
    /body\.touch-active \.hud-hotbar \.slot \{[\s\S]{0,120}width: min\(74px, calc\(\(100vw - 28px\) \/ var\(--slots, 6\)\)\)/.test(css)
    && /host\.style\.setProperty\('--slots', String\(SLOTS\.length\)\)/.test(readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8')));
  // Steering by the stick there is nothing to aim, so touch hides the cross;
  // with the blade out there is.
  ok('and the crosshair is back whenever the sword is out',
    /body\.touch-active:not\(\.sword-out\) \.hud-crosshair/.test(css));""".split('\n')
# block after "your own legs" (v7 1187 '}', 1188 '', 1189 wings header)
at(1189, "console.log('\\nwings that hold the body up, not hang off it');")
oct9 = V['oct9_1504_sed_1190']
v0511 = V['oct11_0511_sed_1270']
ev = [e for e in E if e['t'] == '2026-10-11T05:11:21'][0]
new = re.search(r'new="""(.*?)"""', ev['code'], re.S).group(1).replace("\\\\", "\\").split('\n')
assert len(new) == 12, len(new)
block = build_block(oct9, v0511, new)
L[1188:1188] = block
# your own legs: v7 1180-1184 -> 10 lines
at(1180, "  // The arms stay off in a glide: that one really is inside the camera.")
at(1184, "  // Guarded anyway, for the attitude no pose number predicts.")
L[1179:1184] = OWN_LEGS.split('\n')

assert len(L) == 11622, len(L)
for n, text in [(1229, "  ok('held, the blade lies out in front, near level',"),
                (1280, "console.log('\\nthe shared map, kept as runs');"),
                (1298, "console.log('\\nparties and friends, on the page');"),
                (1418, "console.log('\\nwings that hold the body up, not hang off it');"),
                (2671, "  ok('equator annual mean is tropical', near(annualMeanC(0), 27.5, 1), `${annualMeanC(0).toFixed(1)} C`);"),
                (7868, "  ok('and it goes before the unurgent backlog',"),
                (11558, "  const { cleanPlayer } = await import('../src/net/remotePlayers.js');"),
                (11593, "console.log('\\nevery module still parses');"),
                (11622, 'process.exit(failures > 0 ? 1 : 0);')]:
    at(n, text)
open(out, 'w').write('\n'.join(L) + '\n')
print('wrote', out, len(L), 'lines')

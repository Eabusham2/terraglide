# Build tools/flightcheck.mjs (the final, 396 lines) from two logged views:
#   OLD   the Oct 9 20:09 `cat tools/flightcheck.mjs` (348 lines; the same as the 20:22 sed views)
#   TAIL  the Oct 12 03:30 `sed -n 225,420p tools/flightcheck.mjs` (lines 225-396, the end of the file)
# Lines 1-224 are OLD's 1-223 and one line more. Every later sighting fits (asserted below): the Oct 12
# 03:30 sed 1,60p and its grep (13, 121, 161, 255, 270, 285, 295, 308, ...), and the 03:29 grep (79, 94, 389).
#
# The one line: the Oct 9 20:35-20:50 fixes (ledger V1) stopped trusting a teleport's height as the arrival
# ceiling; a /tpa or party teleport carries the ceiling the server worked out for whoever is there. The
# 'high' leg is sent to 30 km and dives, so without a ceiling it is put back on the Moon (x3) and Mercury
# (x4). With `ceiling: alt` all 15 worlds pass and each one's fastest honest speed is exactly what every
# logged run since Oct 9 20:51 printed. The comment line saying so is WRITTEN BY ME (its length is the
# file's logged size, below).
#
# usage: python3 -I flightcheck_build.py OLD TAIL OUT
import sys
old_p, tail_p, out = sys.argv[1:4]
O = open(old_p).read().split('\n')
T = open(tail_p).read().split('\n')
if O[-1] == '': O.pop()
if T[-1] == '': T.pop()
assert len(O) == 348 and len(T) == 172, (len(O), len(T))
assert O[217] == '  const sendTo = (alt, flying) => {', O[217]
assert O[218] == "    game.teleport(me, { lat: lat0, lon: lon0, alt, flying }, 'test');", O[218]
assert O[222] == '    p.position.set(0, alt, 0);' and T[0] == O[223], (O[222], T[0])
F = O[:218] + [
    '    // Its ceiling is that height, as a /tpa to someone flying there has.',
    "    game.teleport(me, { lat: lat0, lon: lon0, alt, flying, ceiling: alt }, 'test');",
] + O[219:223] + T
assert len(F) == 396, len(F)
want = {
    13: ' * from high up turned level, cruising in and out of a surge, landing fast and',
    79: "  const { mkdtempSync, rmSync } = await import('node:fs');",
    94: "  const dir = mkdtempSync(join(tmpdir(), 'terraglide-flight-'));",
    161: '    | (p.rocketTicksLeft > 0 ? FLAG.rocket : 0) | (p.speedActive ? FLAG.surge : 0);',
    270: "  leg('climb', () => {", 285: "  leg('pump', () => {", 295: "  leg('dive', () => {",
    308: "  leg('high', () => {", 320: "  leg('surge', () => {", 335: "  leg('cruise', () => {",
    341: "  leg('hiccup', () => {", 374: "  leg('land', () => {",
    389: '  rmSync(dir, { recursive: true, force: true });',
}
for n, s in want.items():
    assert F[n - 1] == s, (n, F[n - 1], s)
assert F[120].startswith('        console.error(JSON.stringify({ t: clock, gap: clock - before.at,'), F[120]
assert F[254].startswith('      if (t >= from && t <= to) console.error(JSON.stringify({ t: +t.toFixed(1),'), F[254]
open(out, 'w').write('\n'.join(F) + '\n')
# The Oct 10 03:29 `ls -la` (the file's last change) gave 16312 bytes. With the final newline every tool here
# has, that leaves 73 bytes for the one line nothing shows, and the comment is written to that length.
assert len(open(out, 'rb').read()) == 16312, len(open(out, 'rb').read())
print('wrote', out, len(F), 'lines')

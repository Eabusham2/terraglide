# hud.js: the Oct 5 version (728 lines) with its never-seen lines 1-24 taken from the commit (the body uses no import
# the commit lacks but OXYGEN_SECONDS and SLOTS, both in known lines), swordIcon's body written by me, and the 19
# lines the final adds (Oct 9 stat: 264 changed = the Oct 5 245 + 19 inserted), placed by the final's known lines.
# Usage: hud_edits.py V1 HEAD OUT
import sys, re
L = open(sys.argv[1]).read().split('\n'); H = open(sys.argv[2]).read().split('\n')
if L[-1] == '': L.pop()
M = lambda l: re.match(r'^@@MISSING \d+@@$', l)
for n in [1, 3, 4, 5] + list(range(7, 17)) + list(range(18, 25)):
    assert M(L[n - 1]), n
    L[n - 1] = H[n - 1]
# swordIcon: 28 lines = 8 of body, the closing brace, a blank, the commit's modeLabel (11) and a blank after it, and
# the commit's six-line start of rocketIcon's doc. (modeLabel is called and defined nowhere else; with it kept in place
# the diff from the commit is +255 -9, the Oct 9 stat's 264.)
i = L.index('function swordIcon() {') + 1
assert all(M(x) for x in L[i:i + 28])
k = H.index('function rocketIcon(colour) {')
doc = H[k - 9:k - 3]
assert doc[0] == '/**' and H[k - 3].startswith(' * Inline SVG'), doc
m = H.index('function modeLabel(player, state) {')
mode = H[m:m + 11]
assert mode[-1] == '}' and H[m + 11] == '', mode[-1]
body = r'''  return `
    <svg class="slot-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 1.6 L13.6 4.2 V15 H10.4 V4.2 Z" fill="#d9dee4" />
      <path d="M12 3.4 V14.4" stroke="#9aa4ae" stroke-width="0.9" />
      <rect x="6.8" y="15" width="10.4" height="2" rx="0.6" fill="#c8a24a" />
      <rect x="10.9" y="17" width="2.2" height="3.6" fill="#4a3424" />
      <circle cx="12" cy="21.5" r="1.4" fill="#c8a24a" />
    </svg>`;'''.split('\n')
assert len(body) == 8, len(body)
L[i:i + 28] = body + ['}', ''] + mode + [''] + doc
s = '\n'.join(L) + '\n'
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:80]
    s = s.replace(old, new)
# P1: a Chat button on the toolbar, online (+1)
rep("""          ${online ? '<button type="button" data-action="teleport">Teleport<kbd data-key="teleportMenu"></kbd></button>' : ''}
""", """          ${online ? '<button type="button" data-action="teleport">Teleport<kbd data-key="teleportMenu"></kbd></button>' : ''}
          ${online ? '<button type="button" data-action="chat">Chat<kbd data-key="chat"></kbd></button>' : ''}
""")
# P1: the slot count for the touch layout (+2; the line is the Oct 11 selftest's)
rep("""    const host = this.refs.hotbar;
    if (!host) return;
    host.innerHTML = SLOTS.map((item, index) => {""", """    const host = this.refs.hotbar;
    if (!host) return;
    // As many slots as there are, for the touch layout's widths (main.css).
    host.style.setProperty('--slots', String(SLOTS.length));
    host.innerHTML = SLOTS.map((item, index) => {""")
# P1: the crosshair comes back on a touch screen while the sword is out (+8)
rep("""    const show = player.holdingSword && state.attackCharge !== undefined;
    this.setHidden('attack-charge', !show);""", """    const show = player.holdingSword && state.attackCharge !== undefined;
    // The crosshair is what a swing aims by. A touch screen hides it - a
    // finger is not a pointer - except while the sword is out, when there is
    // nothing else to aim with: main.css shows it again for body.sword-out.
    const out = !!player.holdingSword;
    if (this.cache.get('sword-out') !== out) {
      this.cache.set('sword-out', out);
      document.body.classList.toggle('sword-out', out);
    }
    this.setHidden('attack-charge', !show);""")
# P7: the locator dot's size over 50 m to 50 km (known lines; +3)
rep("""      // Bigger when close: full size inside half a kilometre, smallest past fifty.
      const size = clamp(11 - Math.log10(Math.max(1, other.distance)) * 2.2, 4, 10);""", """      // Bigger when close, over the distances that matter: full size inside
      // fifty metres, smallest past fifty kilometres, a step every factor of
      // ten between. It used to bottom out by a kilometre and a half, so
      // somebody two kilometres off and somebody fifty looked the same.
      const size = clamp(10 - 2 * Math.log10(Math.max(1, other.distance) / 50), 4, 10);""")
# P4: party and friends ringed on the locator (known lines; +1) and on the compass (+3, +1)
rep("""      dot.title = other.name;""", """      dot.dataset.tie = other.tie ?? '';
      dot.title = other.tie ? `${other.name} (${other.tie})` : other.name;""")
rep("""      ...others.filter((o) => o.sameWorld).map((o) => ({ key: `p:${o.key}`, bearing: o.bearing, colour: o.colour, label: o.name.slice(0, 1), title: o.name })),""",
"""      ...others.filter((o) => o.sameWorld).map((o) => ({
        key: `p:${o.key}`, bearing: o.bearing, colour: o.colour, label: o.name.slice(0, 1),
        title: o.tie ? `${o.name} (${o.tie})` : o.name, tie: o.tie ?? '',
      })),""")
rep("""      node.style.setProperty('--player', mark.colour);
""", """      node.style.setProperty('--player', mark.colour);
      node.dataset.tie = mark.tie ?? '';
""")
open(sys.argv[3], 'w').write(s)
print(sys.argv[3], s.count('\n'), 'lines')

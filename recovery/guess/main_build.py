# Build styles/main.css from the pooled Oct 5-7 version (V2: the commit's 1751 lines untouched, then 1074
# appended, 2825 lines, 362 of the appended never shown) and what the Oct 6-11 work added.
#
# Facts used:
#  - Every view from Oct 5 05:24 to Oct 12 agrees with every other (1127 lines, no conflicts), and no edit of
#    the file was ever logged: it only grew at the end, apart from edits nobody looked at.
#  - Oct 6 21:59: line 2900 is `.tp-prompt.party {`, and a complete grep for `\.tp-` finds nothing else after
#    2769, so 2826-2899 holds no .tp- rule.
#  - The Oct 9 16:16 stat (still the same on Oct 11) is 1324 lines changed, and git's bar for it (+32 -1)
#    says 1 to 41 of them are deletions: the final is 1751 + 1324 - 2d lines for d changed commit lines.
#  - The selftest's regexes: `body.touch-active:not(.sword-out) .hud-crosshair` and the hotbar slot width
#    `calc((100vw - 28px) / var(--slots, 6))`.
# Everything in the gaps and the tail is WRITTEN BY ME, from the classes the rebuilt JS writes.
#
# usage: python3 -I main_build.py V2 OUT
import sys
v2, out = sys.argv[1:3]
L = open(v2).read().split('\n')
if L[-1] == '':
    L.pop()
assert len(L) == 2825
MISS = lambda s: s.startswith('@@MISSING ')


def block(text):
    """The text between the quotes, less the newline after the opening ones and the one before the closing."""
    if text.startswith('\n'):
        text = text[1:]
    if text.endswith('\n'):
        text = text[:-1]
    return text.split('\n')


def fill(a, b, text):
    """Lines a..b of V2, every one of them missing, become `text` (same count)."""
    lines = block(text)
    assert len(lines) == b - a + 1, (a, b, len(lines))
    for k, s in enumerate(lines):
        assert MISS(L[a - 1 + k]), (a + k, L[a - 1 + k])
        L[a - 1 + k] = s


def change(n, old, new):
    """A commit line the Oct 9 work changed."""
    assert L[n - 1] == old, (n, L[n - 1])
    L[n - 1] = new


fill(1831, 1947, '''
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-dim);
}

.online-note code,
.online-hint code {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text);
  overflow-wrap: anywhere;
}

.online-server {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0 0 12px;
  padding: 6px 10px;
  background: var(--panel-raised);
  border-left: 2px solid var(--accent-dim);
}

.online-server strong {
  font-size: 14px;
}

.online-server span {
  font-size: 12px;
  color: var(--text-dim);
}

.online-server em {
  font-style: normal;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-faint);
}

.online-tabs {
  display: flex;
  gap: 4px;
  margin: 0 0 10px;
}

.online-tabs button {
  flex: 1;
}

.online-tabs button.active {
  border-color: var(--accent);
  color: var(--accent);
}

.online-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 0 10px;
}

.online-form label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.online-form input {
  padding: 6px 8px;
  background: rgba(10, 10, 8, 0.6);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-transform: none;
  letter-spacing: 0;
}

.online-form input:focus {
  outline: none;
  border-color: var(--accent);
}

.online-form button[type='submit'] {
  align-self: flex-start;
}

.online-recent {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin: 0 0 10px;
  font-size: 11px;
  color: var(--text-faint);
}

.online-error {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--bad);
}

.online-actions {
  display: flex;
  gap: 6px;
}

.online-you i {
  display: inline-block;
  width: 9px;
  height: 9px;
''')
fill(1949, 1949, '''
  margin-right: 4px;
''')
fill(2041, 2050, '''
  color: var(--accent);
  font-weight: 600;
}

.chat-form {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

''')
fill(2052, 2078, '''
  display: none;
}

.chat-form input {
  width: 100%;
  padding: 6px 8px;
  background: rgba(10, 10, 8, 0.82);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}

.chat-form input:focus {
  outline: none;
  border-color: var(--accent);
}

.chat-hint {
  min-height: 14px;
  padding: 0 2px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-faint);
}

''')
fill(2096, 2099, '''
}

.players-body h3 {
  margin: 10px 0 6px;
''')
fill(2161, 2192, '''

.players-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--player, var(--accent));
}

.players-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: auto;
}

.players-tick {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-dim);
}

.players-help,
.players-empty,
.players-you {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-dim);
}

''')
fill(2194, 2203, '''
  position: absolute;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  width: min(380px, 92vw);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

''')
fill(2205, 2207, '''
  padding: 8px 10px;
  background: var(--panel-solid);
  border: 1px solid var(--line);
''')
fill(2209, 2210, '}\n\n')
fill(2213, 2214, '}\n\n')
fill(2216, 2220, '''
  font-style: normal;
  font-size: 11px;
  color: var(--text-faint);
}

''')
fill(2222, 2226, '''
  height: 3px;
  margin: 6px 0;
  background: var(--line);
}

''')
fill(2228, 2229, '''
  display: block;
  height: 100%;
''')
fill(2231, 2232, '}\n\n')
fill(2234, 2238, '''
  display: flex;
  align-items: center;
  gap: 6px;
}

''')
fill(2240, 2247, '''
  margin-left: auto;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-faint);
}

/* the death screen: the world tinted red, and the one button */

''')
fill(2264, 2369, '''
}

.death-inner h2 {
  margin: 0 0 8px;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #f6d9d4;
}

.death-cause {
  margin: 0 0 6px;
  font-size: 15px;
}

.death-score {
  margin: 0 0 16px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-dim);
}

.death-inner button {
  min-width: 160px;
  padding: 8px 18px;
  font-size: 14px;
}

.death-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--text-dim);
}

/* other worlds: a card each, and the one button that takes you there */

.travel-panel {
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(760px, 96vw);
  max-height: 88vh;
}

.travel-body {
  padding: 10px 12px 12px;
  overflow-y: auto;
}

.travel-intro {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-dim);
}

.travel-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}

.travel-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: var(--panel-raised);
  border-left: 2px solid var(--line-strong);
}

.travel-card.here {
  border-left-color: var(--accent);
}

.travel-name strong {
  display: block;
  font-size: 14px;
}

.travel-name span,
.travel-card p {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-dim);
}

.travel-card dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  margin: 0;
  font-size: 11px;
}

.travel-card dd {
  margin: 0;
}

.travel-card em {
  font-style: normal;
  color: var(--accent);
''')
fill(2410, 2410, '')
fill(2783, 2785, '''
  white-space: nowrap;
}

''')
fill(2809, 2825, '''
  width: 6px;
  height: 6px;
  margin-left: 5px;
  border-radius: 50%;
  background: var(--good);
  box-shadow: 0 0 5px var(--good);
  vertical-align: 1px;
}

.players-name em.players-talking {
  color: var(--good);
}

.players-buttons button.on {
  border-color: var(--warn);
  color: var(--warn);
}
''')
assert not any(MISS(s) for s in L)

# --- Oct 9, P1: the touch band follows the rows of buttons shown (--touch-rows, set by touch.js), the
# hotbar's slots follow how many there are (--slots, set by hud.js), and the crosshair comes back on a
# touch screen while the sword is out (body.sword-out, set by hud.js).
change(1498, '    bottom: 182px;', '    bottom: max(182px, calc(var(--touch-rows, 2) * 60px + 30px));')
change(1502, '    width: min(74px, calc((100vw - 28px) / 5));', '    width: min(74px, calc((100vw - 28px) / var(--slots, 6)));')
change(1508, '    bottom: 234px;', '    bottom: max(234px, calc(var(--touch-rows, 2) * 60px + 82px));')
change(1523, '  bottom: 234px;', '  bottom: max(234px, calc(var(--touch-rows, 2) * 60px + 82px));')
change(1526, 'body.touch-active .hud-crosshair {', 'body.touch-active:not(.sword-out) .hud-crosshair {')
change(1685, '    padding-bottom: 234px;', '    padding-bottom: max(234px, calc(var(--touch-rows, 2) * 60px + 82px));')
# --- Oct 9, PA5: the world map keeps its buttons on a narrow screen. The commit hid the whole side panel below
# 900 px; now only what is not the actions row goes (the Oct 11 selftest checks this rule).
change(1404, '  .worldmap-side {', '  .worldmap-side > :not(.worldmap-actions) {')
D = 7

# --- the tail: the Oct 6 parties and friends (to `.tp-prompt.party`, line 2900), then Oct 7 and Oct 9.
TAIL = block('''

/* parties and friends: the players panel's own sections, and the invites */

.players-dynamic {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.players-body h4 {
  margin: 8px 0 4px;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-faint);
}

.players-body h3 .players-count {
  margin-left: 6px;
  text-transform: none;
  letter-spacing: 0;
}

.players-list.party li {
  background: rgba(56, 52, 42, 0.92);
}

.players-list li.offline,
.players-list.offline li,
.players-invited {
  opacity: 0.6;
}

.players-dot.square {
  border-radius: 0;
}

.players-request {
  font-size: 12px;
}

.players-request b {
  color: var(--player, var(--accent));
}

.players-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0 0 8px;
}

.players-tick.everyone {
  display: flex;
  margin: 0 0 4px;
}

.players-add {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-top: 1px solid var(--line);
}

.players-add input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  background: rgba(10, 10, 8, 0.6);
  border: 1px solid var(--line-strong);
  color: var(--text);
  font: inherit;
}

/* A party invite, told apart from a teleport request at a glance. */
.tp-prompt.party {
  background: rgba(40, 46, 34, 0.96);
}

/* ---------- the public server ---------- */

.online-public {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 0 10px;
  padding: 8px 10px;
  background: var(--panel-raised);
  border-left: 2px solid var(--accent);
}

.online-public button {
  align-self: flex-start;
}

.online-public span {
  font-size: 12px;
  color: var(--text-dim);
}

.online-or {
  margin: 0 0 8px;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
}

/* ---------- Oct 9: proximity, passwords, parties on the move ---------- */

/* Changing your password: folded away until you ask for it. */
.online-password {
  margin: 0 0 10px;
}

.online-password summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--text-dim);
}

.online-password[open] summary {
  margin-bottom: 8px;
}

.online-password .online-form {
  margin: 0 0 6px;
}

/* A party talks over the radio, which is off until you turn it on. */
.players-note {
  margin: 0 0 8px;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--text-dim);
  border-left: 2px solid var(--warn);
  background: rgba(212, 171, 106, 0.08);
}

.players-note button {
  margin-left: 6px;
}

/* Focusable to keep the keyboard (see playersPanel.js); no ring for that. */
.players-panel:focus {
  outline: none;
}

/* Who is on each world, by the names you know, and the line that says the
   party will come along when its leader travels. */
.travel-people,
.travel-party {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}

.travel-party {
  margin: 0 0 10px;
}

/* Where a line in the chat came from, when that is another world. */
.chat-line em.chat-world {
  color: var(--accent-dim);
}

.tie-party,
.tie-friend {
  color: var(--player, var(--text));
}

.tie-party::after,
.tie-friend::after {
  content: '';
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-left: 3px;
  border-radius: 50%;
  vertical-align: 2px;
}

.tie-party::after {
  background: #fff;
}

.tie-friend::after {
  background: #e3c15a;
}

/* Your party and your friends on the compass and the locator bar: a ring,
   white for the party and gold for a friend, around the player's own colour. */
.locator-dot[data-tie='party'],
.compass-mark[data-tie='party'] {
  box-shadow: 0 0 0 2px #fff;
}

.locator-dot[data-tie='friend'],
.compass-mark[data-tie='friend'] {
  box-shadow: 0 0 0 2px #e3c15a;
}

/* An empty tank: the label says so as loudly as the toast and the tone do. */
.oxygen[data-state='low'] .oxygen-label {
  color: var(--bad);
}

/* Touch: the vitals and the chat ride above the band the controls and the
   hotbar take, whatever number of rows of buttons that band has today. */
body.touch-active .hud-vitals {
  bottom: max(232px, calc(var(--touch-rows, 2) * 60px + 80px));
}

body.touch-active .chat {
  bottom: max(300px, calc(var(--touch-rows, 2) * 60px + 148px));
  width: min(440px, calc(100vw - 24px));
}

/* A phone on its side: the credit line moves off the sixth slot. */
@media (max-height: 460px) {
  body.touch-active .hud-bottomright {
    bottom: auto;
    top: 40px;
  }

  body.touch-active .hud-vitals {
    bottom: max(150px, calc(var(--touch-rows, 2) * 46px + 58px));
  }
}

/* The compass stays clear of the minimap on a narrow screen: the minimap
   says how far down the top-right corner it reaches (minimap.js). */
@media (max-width: 700px) {
  .hud-compass {
    top: calc(var(--minimap-top-right, 0px) + 14px);
  }
}
''')
WANT = 250 - 2 * D
assert len(TAIL) == WANT, (len(TAIL), WANT)
F = L + TAIL
assert F[2899] == '.tp-prompt.party {', F[2899]
open(out, 'w').write('\n'.join(F) + '\n')
print('ok', len(F), 'lines')

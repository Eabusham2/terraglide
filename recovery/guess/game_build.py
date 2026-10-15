# Build src/game.js (2957 lines) from the draft of the final (every logged line in place, V4 aligned in:
# out/t/game.a2.js) and the filled Oct 6 21:57 version (out/t/game.v4f.js, see game_v4fill.py).
#
# Each region below is a stretch of the final nobody saw after Oct 6. They are filled from V4 where V4 has
# them, plus the Oct 9 ledger fixes, all of which the version of Oct 9 15:12-15:21 already had (its line
# numbers put every one of these insertions in place; the final is that version plus the 18-line
# friend-choices block of Oct 10). WRITTEN BY ME where it says so.
#
# usage: python3 -I game_build.py A2 V4F OUT
import sys
a2, v4f, out = sys.argv[1:4]
F = open(a2).read().split('\n')
V = open(v4f).read().split('\n')
if F[-1] == '': F.pop()
if V[-1] == '': V.pop()
assert len(F) == 2957, len(F)
MISS = lambda l: l.startswith('@@MISSING ')
v4 = lambda a, b: V[a - 1:b]  # V4 lines a..b inclusive


def put(a, lines):
    """Lines a.. of the final: missing ones are filled, known ones must agree."""
    for k, s in enumerate(lines):
        n = a + k
        if MISS(F[n - 1]):
            F[n - 1] = s
        else:
            assert F[n - 1] == s, (n, F[n - 1], s)


def same_count(n, old, new):
    """A line every log shows only from before an edit that kept the count."""
    assert F[n - 1] == old, (n, F[n - 1])
    F[n - 1] = new


# --- imports: W5 saves a full tank for a death (OXYGEN_SECONDS); PA5 names a party mark from the map.
same_count(24, "import { Player, SURGE_FACTOR } from './player/player.js';",
           "import { OXYGEN_SECONDS, Player, SURGE_FACTOR } from './player/player.js';")
same_count(68, "import { PlayersPanel, RequestPrompts } from './ui/playersPanel.js';",
           "import { PlayersPanel, RequestPrompts, askMarkName } from './ui/playersPanel.js';")

# --- R1 132-154: W2's warning marks and F6/F6b's PANEL_KEYS (144 known), then the class opens as in V4.
put(132, [
    '/** Seconds of oxygen left at which the suit says so: a toast and a tone. */',
    'const OXYGEN_WARNINGS = [60, 30, 10, 0];',
    '/**',
    ' * The keys that still reach the game while a panel with keys of its own is',
    ' * open: the players list and the teleport menu. A click in one used to hand',
    ' * the keyboard back to the page, so B dropped a waypoint and R took a random',
    ' * teleport from behind the list, and Esc opened Settings over the menu',
    ' * instead of closing it. What gets through is what opens, closes or swaps a',
    ' * panel, and the few keys a panel itself answers to. The rest wait until',
    ' * it closes. See bindEvents.',
    ' */',
    'const PANEL_KEYS = new Set([',
    "  'settings', 'help', 'worldMap', 'players', 'teleportMenu', 'online', 'travel',",
    "  'chat', 'command', 'pause', 'acceptRequest', 'denyRequest', 'pushToTalk',",
    ']);',
    '',
] + v4(133, 138) + [
    '    this.oxygenWarned = Infinity;',
])

# --- R2 375-437: the end of the online block and the lander block as in V4, PA5's party beacons (399
# known), and F6/F6b's guard opening bindEvents (438-439 from the Oct 9 15:15 view).
put(375, v4(340, 357) + [
    "    // The party's waypoints stand in the world the same way, on a server: a",
    '    // mark made for the party is somewhere to fly to, and a dot on a map is',
    '    // easy to lose from the air: a beam stands up over the hills from far',
    '    // further off. Filled each frame from the session, for this world only;',
    '    // see update().',
    '    this.partySites = { waypoints: [] };',
    '    this.partyBeacons = ONLINE ? new Beacons({',
    '      scene: this.scene,',
    '      store: this.partySites,',
    '      terrain: this.terrain,',
    '      frame: this.frame,',
    '    }) : null;',
] + v4(358, 385) + [
    "    this.input.on('action', ({ id, repeat }) => {",
    '      // While a panel that takes keys of its own is open, the game keeps out',
    '      // of them. Clicking in the players list handed the keyboard back to the',
    '      // page: B dropped a waypoint behind it, and R took a random teleport —',
    '      // a real one, with a toast and a hold, from the',
    '      // server from behind the players list. Only the keys that work panels',
    '      // get through; the dead have their own rules (see onAction).',
    '      if (this.panelHasKeys && !this.player.dead && !PANEL_KEYS.has(id)) return;',
    '      this.onAction(id, repeat);',
    '    });',
] + v4(387, 403))
assert F[398] == '    this.partyBeacons = ONLINE ? new Beacons({'

# --- R3 531-534: the map's directed teleport is off on a server (533 known).
put(531, [
    '    this.worldmap.onTeleport = (lat, lon) => {',
    '      // On a server a teleport is the server\'s to make; the map does not offer it.',
    '      if (ONLINE) return;',
    '      this.worldmap.close();',
])
# PA5: a party mark made from the map is named first (the Oct 11 selftest's text).
same_count(544, "      this.session.partyMark('', lat, lon);", '      this.session.partyMark(askMarkName(), lat, lon);')

# --- R4 1326-1338: takingKeys ends as in V4; panelHasKeys for the F6/F6b guard (1339 known).
put(1326, [
    '        || this.deathScreen.open,',
    '    );',
    '  }',
    '',
    '  /**',
    '   * A panel that keeps keys of its own is up: the players list, the teleport',
    '   * menu, or the death screen. A click in one hands the keyboard back to the',
    '   * page rather than to the panel, so while one is up only PANEL_KEYS reach',
    '   * the game; see bindEvents.',
    '   */',
    '  get panelHasKeys() {',
    '    return Boolean(',
    '      this.playersPanel?.open',
    '        || this.teleportMenu?.open',
])

# --- R5 1385-1655: update() as in V4, with PA5's party beams (+7) and W2's tank warnings (+3).
put(1385, v4(1306, 1366) + [
    '    this.beacons.update(this.camera, player);',
    '    this.siteBeacons?.update(this.camera, player);',
    "    // The party's marks on this world, as beams like everything else here.",
    '    if (this.partyBeacons) {',
    '      this.partySites.waypoints = (this.session?.partyWaypoints() ?? []).map((w) => ({',
    "        id: `party:${w.id}`, name: `${w.name} (party)`, lat: w.lat, lon: w.lon, colour: w.colour,",
    '      }));',
    '      this.partyBeacons.update(this.camera, player);',
    '    }',
    '    this.hud.setBeacons([',
    '      ...this.beacons.labels,',
    '      ...(this.siteBeacons?.labels ?? []),',
    '      ...(this.partyBeacons?.labels ?? []),',
    "    ], settings.get('units'));",
    '    // The suit refills at your lander and at the base, on the ground beside',
    '    // them — not flying past at altitude. And it says when it is running out:',
    '    // a toast and a tone at a minute, thirty seconds, ten and empty, and the',
    '    // screen edged red while there is nothing left to breathe.',
    '    if (!ON_EARTH) player.oxygenSource = this.nearAir(player);',
    '    this.warnOxygen(player);',
] + v4(1377, 1566))

# --- R6 1686-1727: the end of update() as in V4, W2's warnOxygen, W3's on-ground refill.
put(1686, v4(1597, 1605) + [
    "  /** The suit's tank, said and not only drawn: nobody reads a gauge while flying. */",
    '  warnOxygen(player) {',
    '    const left = player.needsSuit && !player.dead && !player.oxygenSource ? player.oxygen : Infinity;',
    '    if (left <= 0) this.hud.hurtFlash();',
    '    const mark = OXYGEN_WARNINGS.find((s) => left <= s && s < this.oxygenWarned);',
    '    this.oxygenWarned = left === Infinity ? Infinity : mark ?? this.oxygenWarned;',
    '    if (mark === undefined) return;',
    "    this.toast(mark > 0 ? `${Math.ceil(left)} s of oxygen left — back to your lander or the base` : 'Out of oxygen', 'bad');",
    '    try {',
    '      this.audio ??= new AudioContext();',
    '      const beep = this.audio.createOscillator();',
    '      beep.frequency.value = mark > 0 ? 880 : 440;',
    '      beep.connect(this.audio.destination);',
    '      beep.start();',
    '      beep.stop(this.audio.currentTime + 0.15);',
    '    } catch { /* no sound to be had here: the toast still says it */ }',
    '  }',
    '',
] + v4(1606, 1607) + [
    '    // On the ground, as the server has it: flying low over the base counted',
    '    // here and not there, and the gauge jumped back once a second.',
    '    if (!player.onGround) return false;',
] + v4(1608, 1617))

# --- R7 1961-1976: W1, releaseSettle hands a ground arrival over on the ground as it is now (1973 known).
put(1961, v4(1849, 1854) + [
    '    // A ground arrival off Earth is placed before any elevation exists, 1.2 m',
    "    // above a datum the ground can be kilometres under — the Moon's landing",
    '    // site is 1,926 m below it. Handed over at the held height, the release',
    '    // was a thirty-second fall to the real surface. Once the ground is real,',
    '    // the hand-over is onto it.',
    '    if (!this.holdInAir && this.groundIsReal) {',
    '      this._holdY = this.terrain.heightAt(this.player.position.x, this.player.position.z) + 1.2;',
    '    }',
] + v4(1855, 1856))

# --- R8 2264-2333: randomTeleport's end and refreshLandFraction as in V4; W5, a save made dead is the
# respawn (2314 known); onAction opens as in V4.
put(2264, v4(2139, 2176) + [
    "    // Dead, the save is the respawn: off Earth your lander or the base, and",
    '    // either way full hearts and a full tank. It kept the place you fell with',
    '    // an empty tank, so a reload brought you back alive, to suffocate again',
    '    // ten seconds later.',
    '    const player = this.player;',
    '    const at = player.dead && !ON_EARTH ? this.lander ?? BODY.spawn : player;',
    '    writeJSON(POSITION_KEY, {',
    '      lat: at.lat,',
    '      lon: at.lon,',
    '      flying: !player.dead && (!player.onGround || player.elytraDeployed),',
] + v4(2181, 2182) + [
    '      ...(ONLINE ? {} : {',
    '        health: player.dead ? player.maxHealth : player.health,',
    '        oxygen: player.dead ? OXYGEN_SECONDS : player.oxygen,',
    '      }),',
] + v4(2184, 2199))

# --- R9 2474-2497: Esc closes the players list (F6b) and the other panels before it opens Settings.
put(2474, [
    '        else if (this.playersPanel?.open) this.playersPanel.close();',
    '        else if (this.travelPanel.open) this.travelPanel.close();',
    '        // A sign-in the server is waiting for stays up; Esc is no way out of',
    '        // that one. See onlinePanel.mustStay.',
    '        else if (this.onlinePanel.open && !this.onlinePanel.mustStay) this.onlinePanel.close();',
] + v4(2335, 2353))

left = [i + 1 for i, l in enumerate(F) if MISS(l)]
assert not left, left[:20]
assert len(F) == 2957
open(out, 'w').write('\n'.join(F) + '\n')
print('ok', out)

# The block of new sections in tools/selftest.mjs between "your own legs" and "wings that hold the body up":
# final lines 1194-1417 (224 lines; v7 1188 and 1189 either side), and the five lines of "your own legs" before it
# (final 1180-1189, from v7 1180-1184). Seen: the Oct 9 15:04 sed 1190-1280 (count 11590; same numbering as the
# final up to its 1262), the Oct 11 05:11 sed 1270-1330 (before the 05:11 edit; same numbering up to 1310), the
# 05:11 edit itself, the Oct 11 05:32 sed 1290-1330 (after it), and single lines from the final's greps: 1330, 1338
# (05:50 grep), 1360 (05:32 git diff), 1388 (05:50 grep), and the Oct 9 password line (1383 then, 1410 now: every
# line the block gained after Oct 9 15:04 is above it). Everything else is WRITTEN BY ME, under these limits:
#  - the final's `git diff` (Oct 11 05:32) shows, of the block's added lines, only final 1205, 1312, 1313, 1315,
#    1316, 1320 and 1360 matching /prefs|Unsent|unsent|lot/, and puts the sworded regex at diff line 20;
#  - the Oct 9 15:04 `grep sword` (complete) lists every line then with "sword" or "password" in it;
#  - the Oct 11 05:50 greps: no other `ok(` line with near/locator/compass before 3069, "/near" only at 1388,
#    "locator" nowhere; 05:32 grep: none of its words (readUnsent, shownPrefs, not landed...) but at 1320/1321.
OWN_LEGS = r"""  // The arms stay off in a glide: that one really is inside the camera. And
  // on foot with the sword out in first person the view model is the arm
  // that holds it, as it is the arm that holds the firework in a glide.
  ok('and the arms are still the view model in a glide',
    /const handed = prone \|\| sworded;/.test(avatar)
    && /this\.armL\.pivot\.visible = !handed;/.test(avatar)
    && /this\.viewModel\.visible = handed;/.test(avatar));
  ok('and with the sword out on foot, in first person',
    /const sworded = this\.firstPerson && player\.selectedSlot === SWORD_SLOT && !player\.dead;/.test(avatar));
  // Guarded anyway, for the attitude no pose number predicts."""

# final line -> text, for the lines written here (each run starts at its key)
FILLS = {
1263: r"""    /async loadSwordModelNow\(base = ASSET_BASE\)/.test(src) && /`\$\{base\}sword\.glb`/.test(src)
    && /this\.loadingSword \?\?= this\.loadSwordModelNow\(base\)/.test(src)
    && /this\.avatar\.loadSwordModel\(\);/.test(gameSrc)
    && /this\.avatar\.loadSwordModel\(\)\.then\(\(\) => this\.avatar\.applySwordModel\(\)\)/.test(gameSrc));""",
1335: r"""    && /p\.avatar\.lastRockets = p\.pose\.rocketsFired \?\? 0;/.test(remoteSrc)
    && /const MAX_SCANNED = 6;/.test(remoteSrc) && /const SCAN_NEAR_M = 400;/.test(remoteSrc)
    && /p\.avatar\.applySwordModel\(\);/.test(remoteSrc));""",
1338: r"""  ok('a scan is given up by somebody no longer among the nearest, and its pictures freed',
    /now - p\.scanOutSince > SCAN_RELEASE_MS\) this\.dropAvatar\(p\);/.test(remoteSrc) && /if \(value\?\.isTexture\) value\.dispose\(\);/.test(remoteSrc));
  ok('switching the scan on loads it for people already met, and a hit flashes on it',
    /if \(p\.scanAsked\) this\.requestScan\(p\);/.test(remoteSrc) && /this\.applyBody\(p\);[\s\S]{0,200}this\.paint\(p\);/.test(remoteSrc));
  ok('the detailed player model says what it does now: animates, holds the sword, first person, others',
    /it walks, glides, swings and holds a firework or the generated sword/.test(settingsPanelSrc)
    && /In first person you see its hands\. Online, the players nearest you are drawn with it too\./.test(settingsPanelSrc));
  ok('the world map keeps its buttons on a narrow screen',
    /@media \(max-width: 900px\)[\s\S]{0,900}\.worldmap-side > :not\(\.worldmap-actions\) \{\s*display: none;/.test(css));
}

console.log('\na host sets the server from its environment');
{
  const { DEFAULTS, loadConfig } = await import('../server/config.mjs');
  // A host that builds from the repository has no config.json, so the server
  // is set up from its environment alone. Warnings to the log are for hosts.
  const log = console.warn;
  console.warn = () => {};
  const set = loadConfig({
    file: new URL('./no-such-config.json', import.meta.url).pathname,
    env: {
      TERRAGLIDE_MOTD: 'Welcome to the Moon', TERRAGLIDE_MAX_PLAYERS: '12', TERRAGLIDE_PVP: 'off',""",
1361: r"""      TERRAGLIDE_CONFIG: '{"rtpCooldownS": 30, "maxPlayers": 99}',
    },
  });
  console.warn = log;
  ok('the message of the day, the player limit, PvP and sign-ups each have a variable',
    set.motd === 'Welcome to the Moon' && set.maxPlayers === 12 && set.pvp === false && set.openSignups === false);
  ok('any other setting goes in as JSON, under the single variables', set.rtpCooldownS === 30 && set.maxPlayers === 12);
  ok('and a variable that is not a number is ignored, not set to NaN', set.signupsPerHour === DEFAULTS.signupsPerHour);
  const guide = readFileSync(new URL('../HOSTING.md', import.meta.url), 'utf8');
  ok('the guide lists them', ['MOTD', 'MAX_PLAYERS', 'MAX_ACCOUNTS', 'SIGNUPS_PER_HOUR', 'OPEN_SIGNUPS', 'FIRST_ACCOUNT_ADMIN', 'PVP', 'ALLOWED_ORIGINS', 'CONFIG']
    .every((name) => guide.includes(`\`TERRAGLIDE_${name}\``)));
  const server = readFileSync(new URL('../server/server.mjs', import.meta.url), 'utf8');
  ok('a server from a fresh checkout builds the online single file the guide says it hands out',
    /terraglide-online\.html/.test(server) && /tools\/online\.mjs/.test(server) && /terraglide-online\.html/.test(guide));
}

console.log('\narriving on another world, and its air');
{
  const gameSrc = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  ok('arrivals are floored at sea level on Earth only',
    /const ground = ON_EARTH \? Math\.max\(0, sampled\) : sampled;/.test(gameSrc));
  // Put down 1.2 m over a datum the Moon's landing site is 1,926 m under, the
  // hand-over was a thirty-second fall; once the ground is real it is onto it.
  ok('and a hold that ends on real ground puts you on it, not two kilometres above it',
    /if \(!this\.holdInAir && this\.groundIsReal\) \{\s*this\._holdY = this\.terrain\.heightAt\(/.test(gameSrc));
  // Filled where the server fills it, or the gauge and the server disagree.
  ok('the suit refills on the ground only, as the server has it',""",
1389: r"""  ok('the tank says so as it runs down: a minute, half a minute, ten seconds, empty',
    /const OXYGEN_WARNINGS = \[60, 30, 10, 0\];/.test(gameSrc) && /this\.warnOxygen\(player\);/.test(gameSrc));
  ok('and dead off Earth, a reload brings you back where you would get up, with a full tank',
    /const at = player\.dead && !ON_EARTH \? this\.lander \?\? BODY\.spawn : player;/.test(gameSrc)
    && /oxygen: player\.dead \? OXYGEN_SECONDS : player\.oxygen/.test(gameSrc));
}

console.log('\na panel with the keyboard keeps it');
{
  const gameSrc = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  const playersSrc = readFileSync(new URL('../src/ui/playersPanel.js', import.meta.url), 'utf8');
  const menuSrc = readFileSync(new URL('../src/ui/teleportMenu.js', import.meta.url), 'utf8');
  const chatSrc = readFileSync(new URL('../src/ui/chat.js', import.meta.url), 'utf8');
  // A click in the list gave the keyboard back to the page: B and R reached the game behind it.
  ok('while a panel with keys of its own is up, only the keys that work panels reach the game',
    /if \(this\.panelHasKeys && !this\.player\.dead && !PANEL_KEYS\.has\(id\)\) return;/.test(gameSrc));
  ok('and a click in the players list leaves the keyboard with the list',
    /button\.blur\(\);[\s\S]{0,200}this\.element\.focus\(\{ preventScroll: true \}\);/.test(playersSrc));
  ok('Escape closes the menu or the list before it opens the settings',
    /else if \(this\.teleportMenu\?\.open\) this\.teleportMenu\.close\(\);\s*else if \(this\.playersPanel\?\.open\) this\.playersPanel\.close\(\);/.test(gameSrc));
  ok('the menu\'s notice is the server\'s answer, not a guess that it was sent', /session\.on\('requestSent'/.test(menuSrc));""",
1411: r"""  ok('Tab in the chat box goes on to the next match rather than adding a space',
    /event\.key === 'Tab'\) \{\s*event\.preventDefault\(\);\s*this\.complete\(\);/.test(chatSrc));
  const touchSrc = readFileSync(new URL('../src/ui/touch.js', import.meta.url), 'utf8');
  ok('and typing into a box on a touch screen leaves the controls where they are',
    /if \(event\.target\?\.closest\?\.\('input, textarea, \[contenteditable="true"\]'\)\) return;/.test(touchSrc));
}
""",
}
SEEN_SINGLE = {
1360: "      TERRAGLIDE_OPEN_SIGNUPS: 'no', TERRAGLIDE_SIGNUPS_PER_HOUR: 'lots',",
1388: r"    /nearAir\(player\) \{[\s\S]{0,400}if \(!player\.onGround\) return false;/.test(gameSrc));",
1410: r"  ok('a /password line is not kept in the chat history', /if \(!\/\^\\\/password\\b\/i\.test\(text\)\)/.test(chatSrc));",
}


def build(oct9_view, view_0511, edit_new):
    """oct9_view: the Oct 9 15:04 sed output (line 1190 first); view_0511: the Oct 11 05:11 sed output (1270 first);
    edit_new: the 12 lines the 05:11 edit put in place of the 8 at 1311-1318. Returns final lines 1194-1417."""
    import re
    out = {}
    def put(n, t, why):
        assert n not in out, ('overlap', n, why, out[n], t)
        out[n] = t
    for k, t in enumerate(oct9_view):
        n = 1190 + k
        if 1194 <= n <= 1262: put(n, t, 'oct9')
        elif 1266 <= n <= 1278: put(n + 1, t, 'oct9+1')   # one line more above, from 1263 on
    for k, t in enumerate(view_0511):
        n = 1270 + k
        if n <= 1310:
            if n in out: assert out[n] == t, ('views disagree', n, out[n], t)
            else: put(n, t, '0511')
        elif n >= 1319: put(n + 4, t, '0511+4')
    for k, t in enumerate(edit_new): put(1311 + k, t, 'edit')
    for n, t in SEEN_SINGLE.items(): put(n, t, 'grep')
    for start, text in FILLS.items():
        for k, t in enumerate(text.split('\n')):
            put(start + k, t, 'fill')
    missing = [n for n in range(1194, 1418) if n not in out]
    assert not missing, ('gaps', missing)
    assert max(out) == 1417, max(out)
    block = [out[n] for n in range(1194, 1418)]
    allowed = {1205, 1312, 1313, 1315, 1316, 1320, 1360}
    for n in range(1194, 1418):
        t = out[n]
        if re.search(r'prefs|Unsent|unsent|lot', t): assert n in allowed, ('git diff would have shown it', n, t)
        if re.search(r'ok\(', t) and re.search(r'near|locator|compass', t): assert n in (1229, 1330, 1338), ('05:50 grep', n, t)
        if re.search(r'/near|kind: \'near\'|\'near\'', t): assert n == 1388, ('05:50 grep /near', n, t)
        assert not re.search(r'locator', t, re.I), ('locator', n, t)
        assert not re.search(r'social-prefs-unsent|PREFS_UNSENT|two lots|readUnsent|markPrefUnsent|shownPrefs|bigWaiting|BIG_FRAME|SHARED_NEW_PER_MESSAGE|not landed', t) or n in (1320, 1321), ('05:32 grep', n, t)
    return block

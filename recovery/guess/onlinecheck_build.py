# Build tools/onlinecheck.mjs (596 lines, the Oct 11 05:42 count) from the pooled draft of the final
# (scratchpad/recover/out/best/tools_onlinecheck.mjs: 460 known lines, 136 missing in 10 gaps).
#
#   346, 348-414   the F8 key checks ("keys stay with an open panel"): WRITTEN BY ME to the labels and the
#                  details the Oct 10 03:44 run printed (scratchpad/final5/s_online.out, in calls.jsonl).
#   522-545        the single-file test: the Oct 5 21:48 text (sed -n 330,383p, a5d8b1), exact.
#   547-566        "played locally there is no teleport menu": WRITTEN BY ME to its label and detail.
#   568-596        the end of the single-file block and the catch/finally tail: the Oct 5 21:48 text, exact.
#
# usage: python3 -I onlinecheck_build.py DRAFT OUT
import sys
draft, out = sys.argv[1:3]
F = open(draft).read().split('\n')
if F[-1] == '': F.pop()
assert len(F) == 596, len(F)
MISS = lambda l: l.startswith('@@MISSING ')


def put(a, b, text):
    lines = text.split('\n')
    assert len(lines) == b - a + 1, (a, b, len(lines))
    for k, s in enumerate(lines):
        n = a + k
        assert MISS(F[n - 1]), (n, F[n - 1])
        F[n - 1] = s


put(346, 346, "  const askedToasts = (await a.page.evaluate(() => window.__toasts)).filter((t) => /Asked to bring Bruno/.test(t)).length;")

put(348, 379, r"""  await a.page.evaluate(() => window.terraglide.teleportMenu.close());

  console.log('\nkeys stay with an open panel');
  // Every action that reaches the game from here on is kept a note of: B is
  // a waypoint and R a random teleport, and neither belongs behind a panel.
  await a.page.evaluate(() => {
    const g = window.terraglide;
    window.__actions = [];
    const onAction = g.onAction.bind(g);
    g.onAction = (id, repeat) => {
      window.__actions.push(id);
      return onAction(id, repeat);
    };
  });
  const pressBR = async () => {
    await a.page.evaluate(() => { window.__actions = []; });
    await a.page.keyboard.press('b');
    await a.page.keyboard.press('r');
    await sleep(600);
    return a.page.evaluate(() => window.__actions.filter((id) => id === 'waypoint' || id === 'rtp'));
  };
  // The menu open, then a click on the world beside it - not on a row, which
  // sends: the click takes the focus out of the menu, as it did for players.
  await a.page.bringToFront();
  await a.page.evaluate(() => document.activeElement?.blur?.());
  await a.page.keyboard.press('j');
  await until(a.page, () => window.terraglide.teleportMenu.open, null, { timeout: 8000 });
  const world = await a.page.evaluate(() => [[60, 280], [840, 280], [450, 90], [60, 460]]
    .find(([x, y]) => document.elementFromPoint(x, y)?.tagName === 'CANVAS'));
  await a.page.mouse.click(...world);
  const outside = await a.page.evaluate(() => !window.terraglide.teleportMenu.element.contains(document.activeElement));
  const leakedMenu = await pressBR();""")


put(381, 383, r"""    leakedMenu.length === 0 && outside, `clicked the world; focus outside: ${outside}; leaked: ${leakedMenu.join(',') || 'none'}`);
  await a.page.keyboard.press('Escape');
  const escMenu = await a.page.evaluate(() => ({ menu: window.terraglide.teleportMenu.open, settings: window.terraglide.settingsPanel.open }));""")

put(385, 394, r"""  // The players list, and a click on one of its buttons: a TPA the server
  // turns down at once (Ada has only just asked), so nobody is asked anything.
  // A click there blurred the button to the page, and B and R got through.
  for (const p of game.players.values()) if (p.key === 'ada') p.lastRequestAt.set('bruno', Date.now());
  await a.page.evaluate(() => document.activeElement?.blur?.());
  await a.page.keyboard.press('Tab');
  await until(a.page, () => window.terraglide.playersPanel.open, null, { timeout: 8000 });
  await until(a.page, () => !!document.querySelector('.players-panel [data-action="tpa"]'), null, { timeout: 10000 });
  await a.page.click('.players-panel [data-action="tpa"]');
  const leakedPanel = await pressBR();""")

put(396, 397, r"""  await a.page.keyboard.press('Escape');
  const escPanel = await a.page.evaluate(() => ({ panel: window.terraglide.playersPanel.open, settings: window.terraglide.settingsPanel.open }));""")

put(399, 409, r"""  // Tab in the chat box finishes the command, and pressed again with nothing
  // typed in between puts the next match in its place.
  await a.page.keyboard.press('t');
  await until(a.page, () => document.activeElement?.matches('.chat-form input'), null, { timeout: 8000 });
  await a.page.keyboard.type('/tp');
  const tabs = [];
  for (let i = 0; i < 3; i++) {
    await a.page.keyboard.press('Tab');
    tabs.push(await a.page.$eval('.chat-form input', (el) => el.value));
  }
  await a.page.keyboard.press('Escape');""")

put(411, 414, r"""  // The game's own onAction again: the note-taker above was on the instance.
  await a.page.evaluate(() => { delete window.terraglide.onAction; });

  console.log('\nfriends and parties');""")

# The Oct 5 21:48 view (V2 lines 330-354), the scanned-body block closing first.
put(522, 545, r"""  }

  console.log('\nthe single file joins too');
  // terraglide.html opened straight off the disk — the download, double-
  // clicked — pointed at the same server by its address. Ada and Bruno are
  // done by now, and two pages rendering in software leave a three-megabyte
  // page no CPU to be parsed with.
  for (const p of [a, b]) await p.page.context().close();
  a = null;
  b = null;
  {
    const context = await browser.newContext({ viewport: { width: 800, height: 500 } });
    const page = await context.newPage();
    await page.route('**/*', relay);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('terraglide.settings', JSON.stringify({ graphics: 'low', autoTier: 'low', resolutionScale: 0.5, buildings: false, weather: false }));
        localStorage.setItem('terraglide.help-seen', 'true');
      } catch {}
    });
    const file = `file://${join(ROOT, 'terraglide.html')}?server=${encodeURIComponent(`ws://127.0.0.1:${address.port}`)}`;
    await page.goto(file, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const reached = await page.waitForSelector('.online-panel:not([hidden]) .online-tabs', { timeout: 120000, polling: 250 })
      .then(() => true, () => false);""")

put(547, 566, r"""    // Played alone - the server's own page with ?local - there is no teleport
    // menu (game.js builds it online only): J does nothing, and no HUD button.
    await page.goto(`${BASE}?local`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await until(page, () => window.__terraglideStarted === true, null, { timeout: 120000 });
    // Really alone, with the HUD up and its buttons drawn - or the three
    // answers below would prove nothing.
    const alone = await page.evaluate(() => !window.terraglide.session && !!document.querySelector('.hud [data-action="rtp"]'));
    if (!alone) throw new Error('?local did not start a game of one, HUD and all');
    await page.bringToFront();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('j');
    await sleep(1500);
    const local = await page.evaluate(() => ({
      // on screen, in the game at all, and a way to open it
      menu: !!document.querySelector('.tp-menu:not([hidden])'),
      game: !!window.terraglide.teleportMenu,
      button: !!document.querySelector('.hud [data-action="teleport"]'),
    }));
    // Back to the world, should J have opened anything after all.
    await page.keyboard.press('Escape');""")

put(568, 596, r"""    await context.close();
  }
} catch (error) {
  failures++;
  console.log(`  FAIL ${error.message.split('\n')[0]}`);
  // What each page was doing when it stopped, so a failure says why.
  for (const p of [a, b].filter(Boolean)) {
    console.log(`    ${p.name} errors: ${p.errors.slice(-4).join(' || ') || 'none'}`);
    const state = await p.page.evaluate(() => {
      const g = window.terraglide;
      if (!g) return 'no game';
      return JSON.stringify({
        status: g.session?.net?.status,
        you: g.session?.you?.name,
        remotes: g.session?.remote?.list().map((r) => [r.name, !!r.now]),
        at: [g.player?.lat, g.player?.lon],
        fps: g.perf?.fps,
      });
    }).catch((e) => `evaluate failed: ${e.message}`);
    console.log(`    ${p.name} state: ${state}`);
  }
} finally {
  await browser.close();
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passes} passed, ${failures} failed — screenshots in shots/online/`);
process.exit(failures ? 1 : 0);""")

left = [i + 1 for i, l in enumerate(F) if MISS(l)]
assert not left, left
assert len(F) == 596
open(out, 'w').write('\n'.join(F) + '\n')
print('ok', out)

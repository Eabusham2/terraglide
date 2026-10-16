#!/usr/bin/env node
/**
 * Two players, two browsers, one server — the whole online game, driven end
 * to end in real Chromium.
 *
 * Starts the real server on a spare port with a throwaway data folder, opens
 * the game it serves in two separate browser profiles, makes an account in
 * each through the actual sign-up form, and then checks the things a player
 * would: that each sees the other in the world and on the map, that chat
 * arrives, that a /tpa can be answered with the key on the prompt and puts
 * one beside the other, and that a sword swing at someone in reach takes
 * their hearts. Screenshots of both views go to shots/online/.
 *
 *   node tools/onlinecheck.mjs            (about a minute)
 *   node tools/onlinecheck.mjs --keep     leave the browsers' screenshots only
 *
 * The browsers cannot reach the internet from a sandbox, so map tiles they ask
 * for are fetched by Node and handed back — the same arrangement tools/shots.mjs
 * uses.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/server.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = join(ROOT, 'shots', 'online');
mkdirSync(OUT, { recursive: true });

// The page the server hands out loads the bundle when there is one, so a
// bundle older than the source tests yesterday's game. Build it first.
const built = spawnSync(process.execPath, [join(ROOT, 'tools/bundle.mjs')], { cwd: ROOT, encoding: 'utf8' });
if (built.status !== 0) {
  console.log(built.stdout, built.stderr);
  process.exit(1);
}

let failures = 0;
let passes = 0;
function ok(label, condition, detail = '') {
  if (condition) passes++;
  else failures++;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
}

const dir = mkdtempSync(join(tmpdir(), 'terraglide-online-'));
const server = startServer({ port: 0, host: '127.0.0.1', dataDir: dir, saveEveryS: 3600 });
const address = await server.ready;
const BASE = `http://127.0.0.1:${address.port}/`;

const { chromium } = await import('playwright');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  // Two players means one page is always the one not in front, and Chromium
  // throttles a background page's timers — after five minutes hidden, to once
  // a minute. Every wait on that page then times out with the thing it is
  // waiting for already on screen. Both players have to be live at once.
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion'],
});

/**
 * Wait until `fn` is true in the page, by asking it from here.
 *
 * Playwright's waitForFunction polls from inside the page, on the page's own
 * timers, and a software-rendered page spending a second on every frame can
 * leave those polls queued for the whole timeout — the request prompt was on
 * screen, an evaluate a moment later found it, and the wait had still timed
 * out. Each evaluate here is its own round trip, so it sees the page as it is.
 */
async function until(page, fn, arg = null, { timeout = 20000, every = 250 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(fn, arg).catch(() => false);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`until: timeout ${timeout}ms exceeded`);
    await new Promise((r) => setTimeout(r, every));
  }
}

async function relay(route) {
  const request = route.request();
  const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('ws:') || url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
  try {
    const upstream = await fetch(url, {
      method: request.method() === 'POST' ? 'POST' : 'GET',
      body: request.method() === 'POST' ? request.postData() : undefined,
      headers: { 'user-agent': 'terraglide-onlinecheck', ...(request.headers()['content-type'] ? { 'content-type': request.headers()['content-type'] } : {}) },
    });
    await route.fulfill({
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream', 'access-control-allow-origin': '*' },
      body: Buffer.from(await upstream.arrayBuffer()),
    });
  } catch {
    await route.abort().catch(() => {});
  }
}

async function player(name) {
  const context = await browser.newContext({ viewport: { width: 900, height: 560 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // A map tile that is not there is the provider's business, not a fault.
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) {
      errors.push(`console: ${message.text().slice(0, 300)}`);
    }
  });
  await page.route('**/*', relay);
  // Two software-rendered pages at once on a small machine: the lightest
  // preset, so the frames the test waits on actually come round.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('terraglide.settings', JSON.stringify({ graphics: 'low', autoTier: 'low', resolutionScale: 0.6, buildings: false, weather: false }));
      localStorage.setItem('terraglide.help-seen', 'true');
    } catch {}
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await until(page, () => window.__terraglideStarted === true, null, { timeout: 90000 });
  await page.waitForSelector('.online-panel:not([hidden]) .online-tabs', { timeout: 90000, polling: 250 });
  await page.click('[data-action="tab-signup"]', { timeout: 60000, polling: 250 }).catch(async (error) => {
    await page.screenshot({ path: join(OUT, `stuck-${name}.png`), timeout: 120000 });
    console.log('    panel:', await page.$eval('.online-panel', (el) => el.textContent.replace(/\s+/g, ' ').slice(0, 300)));
    console.log('    status:', await page.evaluate(() => JSON.stringify({ s: window.terraglide.session.net.status, d: window.terraglide.session.net.statusDetail })));
    throw error;
  });
  await page.fill('.online-form input[name="name"]', name);
  await page.fill('.online-form input[name="password"]', 'correct horse');
  await page.click('.online-form button[type="submit"]', { timeout: 60000, polling: 250 }).catch(async (error) => {
    await page.screenshot({ path: join(OUT, `stuck-submit-${name}.png`), timeout: 120000 });
    console.log('    panel:', await page.$eval('.online-panel', (el) => el.innerHTML.replace(/\s+/g, ' ').slice(0, 600)));
    throw error;
  });
  await until(page, () => window.terraglide.session?.signedIn === true, null, { timeout: 20000 });
  return { name, context, page, errors };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let a = null;
let b = null;
try {
  console.log('\nsigning up through the form, in two browsers');
  a = await player('Ada');
  ok('Ada made an account and is signed in', true);
  b = await player('Bruno');
  ok('Bruno too', true);
  const panelGone = await a.page.$eval('.online-panel', (el) => el.hidden);
  ok('the sign-in panel gets out of the way afterwards', panelGone);

  console.log('\nseeing each other');
  await until(a.page, () => {
    const s = window.terraglide.session;
    return s.remote.list().some((p) => p.name === 'Bruno' && p.now);
  }, null, { timeout: 30000 });
  ok('Ada sees Bruno in the world', true);
  const seen = await b.page.evaluate(() => {
    const p = window.terraglide.session.remote.list().find((x) => x.name === 'Ada');
    return p ? { colour: p.colour, now: !!p.now } : null;
  });
  ok('and Bruno sees Ada, in her colour', !!seen && /^#[0-9a-f]{6}$/.test(seen.colour));
  const hud = await a.page.evaluate(() => ({
    hearts: !document.querySelector('[data-id="hearts"]').hidden,
    locatorDots: document.querySelectorAll('.locator-dot').length,
  }));
  ok('Ada\'s hearts are on show online', hud.hearts);

  console.log('\nchat');
  await a.page.keyboard.press('t');
  await a.page.waitForSelector('.chat-form:not([hidden]) input');
  await until(a.page, () => document.activeElement?.matches('.chat-form input'));
  await a.page.keyboard.type('hello from Ada');
  await a.page.keyboard.press('Enter');
  await until(b.page, () => [...document.querySelectorAll('.chat-line')].some((l) => l.textContent.includes('hello from Ada')), null, { timeout: 20000 })
    .catch(async (error) => {
      console.log('    Ada log:', await a.page.$$eval('.chat-line', (ls) => ls.map((l) => l.textContent).join(' | ')));
      console.log('    Bruno log:', await b.page.$$eval('.chat-line', (ls) => ls.map((l) => l.textContent).join(' | ')));
      throw error;
    });
  ok('a line typed in Ada\'s chat box arrives in Bruno\'s', true);

  console.log('\nteleport requests');
  // Move Bruno somewhere else first, through the server, so a teleport has
  // somewhere to go.
  const game = server.game;
  const bruno = [...game.players.values()].find((p) => p.name === 'Bruno');
  const ada = [...game.players.values()].find((p) => p.name === 'Ada');
  game.teleport(bruno, { lat: 46.62, lon: 7.95, alt: 2400, flying: true }, 'test');
  await sleep(4000);
  await a.page.evaluate(() => window.terraglide.session.chat('/tpa Bruno'));
  await until(b.page, () => !!document.querySelector('.tp-prompt'), null, { timeout: 20000 }).catch(async (error) => {
    console.log('    Ada log:', await a.page.$$eval('.chat-line', (ls) => ls.map((l) => l.textContent).join(' | ')));
    console.log('    Bruno log:', await b.page.$$eval('.chat-line', (ls) => ls.map((l) => l.textContent).join(' | ')));
    console.log('    Bruno prompts:', await b.page.evaluate(() => {
      const host = document.querySelector('.tp-prompts');
      const r = host?.getBoundingClientRect();
      return JSON.stringify({ exists: !!host, html: host?.innerHTML.slice(0, 200), rect: r && [r.x, r.y, r.width, r.height], display: host && getComputedStyle(host).display, prompts: !!window.terraglide.requestPrompts });
    }));
    console.log('    Bruno errors:', b.errors.slice(-5).join(' || '));
    console.log('    Bruno requests:', await b.page.evaluate(() => JSON.stringify([...window.terraglide.session.requests.values()])));
    throw error;
  });
  const prompt = await b.page.$eval('.tp-prompt', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  ok('Bruno gets a prompt with a countdown', /Ada wants to teleport to you/.test(prompt) && /\d+s/.test(prompt), prompt.slice(0, 80));
  let pressed = 0;
  for (; pressed < 3; pressed++) {
    await b.page.bringToFront();
    await b.page.keyboard.press('y');
    const answered = await until(b.page, () => window.terraglide.session.requests.size === 0, null, { timeout: 6000 })
      .then(() => true, () => false);
    if (answered) break;
  }
  ok('the key on the prompt answers it', pressed < 3, `${pressed + 1} press(es)`);
  await until(a.page, () => {
    const p = window.terraglide.player;
    return Math.abs(p.lat - 46.62) < 0.01 && Math.abs(p.lon - 7.95) < 0.01;
  }, null, { timeout: 45000 }).catch(async (error) => {
    console.log('    Ada at:', await a.page.evaluate(() => [window.terraglide.player.lat, window.terraglide.player.lon]));
    console.log('    Bruno requests left:', await b.page.evaluate(() => window.terraglide.session.requests.size));
    console.log('    Ada log:', await a.page.$$eval('.chat-line', (ls) => ls.slice(-3).map((l) => l.textContent).join(' | ')));
    throw error;
  });
  ok('pressing Y sends Ada to Bruno', true);
  const height = await a.page.evaluate(() => window.terraglide.player.position.y);
  ok('at Bruno\'s height, in the air beside him', height > 1500, `${height.toFixed(0)} m`);
  await sleep(2500);
  await a.page.screenshot({ path: join(OUT, 'ada-beside-bruno.png'), timeout: 120000 });
  await b.page.screenshot({ path: join(OUT, 'bruno-sees-ada.png'), timeout: 120000 });

  console.log('\na sword fight');
  // Both on the ground in a field away from spawn, facing each other.
  for (const [p, dLat] of [[ada, 0], [bruno, 2.5 / 111320]]) {
    game.teleport(p, { lat: 46.5900 + dLat, lon: 7.9300, flying: false }, 'test');
  }
  await sleep(6000);
  const attacks = [];
  const original = game.onAttack.bind(game);
  game.onAttack = (attacker, m) => {
    const before = bruno.health;
    const result = original(attacker, m);
    attacks.push({
      from: attacker.name, item: attacker.item, rtt: attacker.rtt, healthBefore: before, healthAfter: bruno.health,
      a: attacker.state && [attacker.state.lat, attacker.state.lon, attacker.state.alt, attacker.state.flags],
      b: bruno.state && [bruno.state.lat, bruno.state.lon, bruno.state.alt],
      hist: bruno.history.map((h) => [Date.now() - h.t, h.lat.toFixed(6), h.alt.toFixed(1)]),
    });
    return result;
  };
  const before = await b.page.evaluate(() => window.terraglide.player.health);
  await a.page.evaluate(async () => {
    const g = window.terraglide;
    const me = g.player;
    const other = g.session.remote.list().find((x) => x.name === 'Bruno');
    me.selectSlot(5);
    const dx = other.pose.position.x - me.position.x;
    const dz = other.pose.position.z - me.position.z;
    const dy = other.pose.position.y + 1.2 - (me.position.y + me.eyeHeight);
    me.yaw = Math.atan2(dx, -dz);
    me.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    await new Promise((r) => setTimeout(r, 300));
    g.attack();
  });
  await until(b.page, (h) => window.terraglide.player.health < h, before, { timeout: 15000 }).catch(() => {});
  const after = await b.page.evaluate(() => window.terraglide.player.health);
  ok('Ada\'s swing takes Bruno\'s hearts', after < before, `${before} -> ${after}`);
  if (!(after < before)) {
    console.log('    Ada log:', await a.page.$$eval('.chat-line', (ls) => ls.slice(-4).map((l) => l.textContent).join(' | ')));
    console.log('    attacks seen by the server:', JSON.stringify(attacks));
    console.log('    server:', JSON.stringify([ada, bruno].map((p) => ({ n: p.name, item: p.item, pending: !!p.pending, dead: p.dead, s: p.state && [p.state.lat.toFixed(6), p.state.lon.toFixed(6), p.state.alt.toFixed(1)] }))));
    console.log('    client:', await a.page.evaluate(() => {
      const g = window.terraglide;
      const o = g.session.remote.list().find((x) => x.name === 'Bruno');
      return JSON.stringify({ me: [g.player.position.x.toFixed(2), g.player.position.y.toFixed(2), g.player.position.z.toFixed(2)], slot: g.player.selectedSlot, other: o && [o.pose.position.x.toFixed(2), o.pose.position.y.toFixed(2), o.pose.position.z.toFixed(2)], visible: o?.visible, settling: g.settling });
    }));
  }
  await a.page.screenshot({ path: join(OUT, 'ada-sword.png'), timeout: 120000 });
  await b.page.screenshot({ path: join(OUT, 'bruno-hurt.png'), timeout: 120000 });

  console.log('\nthe map');
  await a.page.evaluate(() => window.terraglide.worldmap.show({ lat: window.terraglide.player.lat, lon: window.terraglide.player.lon, heading: 0 }));
  await sleep(2500);
  await a.page.screenshot({ path: join(OUT, 'map.png'), timeout: 120000 });
  const others = await a.page.evaluate(() => window.terraglide.othersForMap().map((o) => o.name));
  ok('Bruno is on Ada\'s map', others.includes('Bruno'));

  // A request on screen, for the picture: taken last, because a screenshot of
  // a software-rendered page can take longer than the forty seconds a request
  // lives — taken earlier, it let the request it was photographing run out.
  console.log('\nthe teleport menu');
  // Sent from the menu rather than typed: J, a few letters of the name, Tab
  // to TPA here, Enter.
  game.players.forEach((p) => p.lastRequestAt?.clear());
  await a.page.evaluate(() => window.terraglide.worldmap.close());
  await a.page.bringToFront();
  await a.page.evaluate(() => document.activeElement?.blur?.());
  await a.page.keyboard.press('j');
  await until(a.page, () => document.activeElement?.classList.contains('tp-search'), null, { timeout: 8000 });
  ok('J opens the teleport menu with the name box ready to type in', true);
  const everyone = await a.page.$$eval('.tp-list [data-player]', (rows) => rows.length);
  ok('which lists everyone else online before anything is typed', everyone === 1, `${everyone} row(s)`);
  await a.page.keyboard.type('zq');
  const none = await a.page.$eval('.tp-list', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  ok('a name nobody has empties the list and says so', /Nobody online has "zq"/.test(none), none.slice(0, 60));
  await a.page.keyboard.press('Backspace');
  await a.page.keyboard.press('Backspace');
  await a.page.keyboard.type('run');
  const filtered = await a.page.$$eval('.tp-list [data-player]', (rows) => rows.map((r) => r.querySelector('.tp-name').innerHTML));
  ok('part of a name, from the middle, finds Bruno and marks the match', filtered.length === 1 && /B<mark>run<\/mark>o/.test(filtered[0]), filtered.join(' | '));
  await a.page.keyboard.press('Tab');
  const mode = await a.page.$eval('.tp-mode.on', (el) => el.dataset.mode);
  ok('Tab switches TPA to TPA here', mode === 'tpahere', mode);
  await a.page.screenshot({ path: join(OUT, 'teleport-menu.png'), timeout: 120000 });
  // Every notice Ada is shown from here on, kept a note of (see below).
  await a.page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n.classList?.contains('toast')) window.__toasts.push(n.textContent);
    }).observe(document.body, { childList: true, subtree: true });
  });
  await a.page.keyboard.press('Enter');
  await until(b.page, () => !!document.querySelector('.tp-prompt'), null, { timeout: 20000 }).catch(() => {});
  const asked = await b.page.$eval('.tp-prompt', (el) => el.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
  ok('Enter sends it: Bruno is asked to come to Ada', /Ada wants you to teleport to them/.test(asked), asked.slice(0, 80));
  const closed = await a.page.evaluate(() => !window.terraglide.teleportMenu.open);
  ok('and the menu gets out of the way', closed);
  await b.page.screenshot({ path: join(OUT, 'request-prompt.png'), timeout: 120000 });
  await a.page.bringToFront();
  const sentToast = await until(a.page, () => window.__toasts.find((t) => /Asked to bring Bruno/.test(t)), null, { timeout: 10000 }).catch(() => '');
  ok('the menu\'s notice is the server\'s answer: asked', !!sentToast, sentToast);
  // Again at once: the server makes you wait, and the notice says so rather
  // than claiming it asked. "At once" is made sure of - the screenshot above
  // can take longer than the five seconds the wait lasts.
  for (const p of game.players.values()) if (p.key === 'ada') p.lastRequestAt.set('bruno', Date.now());
  await a.page.keyboard.press('j');
  await until(a.page, () => document.activeElement?.classList.contains('tp-search'), null, { timeout: 8000 });
  await a.page.keyboard.type('bru');
  await a.page.keyboard.press('Enter');
  const refusedToast = await until(a.page, () => window.__toasts.find((t) => /before asking Bruno again/.test(t)), null, { timeout: 10000 }).catch(() => '');
  const askedToasts = (await a.page.evaluate(() => window.__toasts)).filter((t) => /Asked to bring Bruno/.test(t)).length;
  ok('and when the server says no, so does the notice', !!refusedToast && askedToasts === 1, `${refusedToast} / ${askedToasts} "asked"`);
  await a.page.evaluate(() => window.terraglide.teleportMenu.close());

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
  const leakedMenu = await pressBR();
  ok('with the teleport menu open and focus outside it, B and R do not reach the game',
    leakedMenu.length === 0 && outside, `clicked the world; focus outside: ${outside}; leaked: ${leakedMenu.join(',') || 'none'}`);
  await a.page.keyboard.press('Escape');
  const escMenu = await a.page.evaluate(() => ({ menu: window.terraglide.teleportMenu.open, settings: window.terraglide.settingsPanel.open }));
  ok('and Escape closes the menu instead of opening the settings behind it', !escMenu.menu && !escMenu.settings, JSON.stringify(escMenu));
  // The players list, and a click on one of its buttons: a TPA the server
  // turns down at once (Ada has only just asked), so nobody is asked anything.
  // A click there blurred the button to the page, and B and R got through.
  for (const p of game.players.values()) if (p.key === 'ada') p.lastRequestAt.set('bruno', Date.now());
  await a.page.evaluate(() => document.activeElement?.blur?.());
  await a.page.keyboard.press('Tab');
  await until(a.page, () => window.terraglide.playersPanel.open, null, { timeout: 8000 });
  await until(a.page, () => !!document.querySelector('.players-panel [data-action="tpa"]'), null, { timeout: 10000 });
  await a.page.click('.players-panel [data-action="tpa"]');
  const leakedPanel = await pressBR();
  ok('with the players list open, B and R after clicking one of its buttons do not reach the game', leakedPanel.length === 0, leakedPanel.join(','));
  await a.page.keyboard.press('Escape');
  const escPanel = await a.page.evaluate(() => ({ panel: window.terraglide.playersPanel.open, settings: window.terraglide.settingsPanel.open }));
  ok('and Escape closes the list instead of opening the settings', !escPanel.panel && !escPanel.settings, JSON.stringify(escPanel));
  // Tab in the chat box finishes the command, and pressed again with nothing
  // typed in between puts the next match in its place.
  await a.page.keyboard.press('t');
  await until(a.page, () => document.activeElement?.matches('.chat-form input'), null, { timeout: 8000 });
  await a.page.keyboard.type('/tp');
  const tabs = [];
  for (let i = 0; i < 3; i++) {
    await a.page.keyboard.press('Tab');
    tabs.push(await a.page.$eval('.chat-form input', (el) => el.value));
  }
  await a.page.keyboard.press('Escape');
  ok('Tab in the chat box cycles through the matches', new Set(tabs).size === 3 && tabs.every((v) => /^\/tp\w* $/.test(v)), tabs.join(' | '));
  // The game's own onAction again: the note-taker above was on the instance.
  await a.page.evaluate(() => { delete window.terraglide.onAction; });

  console.log('\nfriends and parties');
  // Notices in the corner last a few seconds; at a frame a second the check
  // can come round after one has gone, so every one shown is kept a note of.
  await b.page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n.classList?.contains('toast')) window.__toasts.push(n.textContent);
    }).observe(document.body, { childList: true, subtree: true });
  });
  // Ada opens Players, types Bruno's name in the box and asks to be friends.
  await a.page.bringToFront();
  await a.page.evaluate(() => { window.terraglide.teleportMenu?.close?.(); document.activeElement?.blur?.(); });
  await a.page.keyboard.press('Tab');
  await until(a.page, () => !document.querySelector('.players-panel').hidden, null, { timeout: 8000 });
  await a.page.fill('.players-add input', 'Bruno');
  await a.page.click('.players-add [data-add="friend"]');
  await b.page.bringToFront();
  await b.page.evaluate(() => { document.activeElement?.blur?.(); window.terraglide.playersPanel.show(); });
  await until(b.page, () => !!document.querySelector('[data-action="friend-accept"]'), null, { timeout: 20000 });
  ok('a friend request typed into the Players panel shows up in the other player\'s', true);
  const notice = await b.page.evaluate(() => window.__toasts.join(' | '));
  ok('with a notice in the corner', /wants to be friends/.test(notice), notice.slice(0, 80));
  await b.page.click('[data-action="friend-accept"]');
  await until(a.page, () => window.terraglide.session.friends.friends.some((f) => f.name === 'Bruno' && f.online), null, { timeout: 20000 });
  ok('accepting it makes them friends, on both sides',
    await until(b.page, () => window.terraglide.session.isFriend('Ada'), null, { timeout: 15000 }).then(() => true, () => false));
  // Ada invites her new friend to a party from the friends list.
  await a.page.bringToFront();
  await until(a.page, () => !!document.querySelector('.players-list.friends [data-action="party-invite"]'), null, { timeout: 10000 });
  await a.page.click('.players-list.friends [data-action="party-invite"]');
  await b.page.bringToFront();
  await until(b.page, () => !!document.querySelector('.tp-prompt.party'), null, { timeout: 20000 });
  const invite = await b.page.$eval('.tp-prompt.party', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  ok('a party invite comes up like a teleport request', /Ada invites you to their party/.test(invite), invite.slice(0, 60));
  await b.page.evaluate(() => { window.terraglide.playersPanel.close(); document.activeElement?.blur?.(); });
  await b.page.keyboard.press('y');
  await until(a.page, () => window.terraglide.session.party?.members.length === 2, null, { timeout: 20000 });
  ok('and the accept key answers it: Ada and Bruno are a party', true);
  // "Teleport with the party" is a tick he makes, not one made for him.
  const unticked = await b.page.evaluate(() => window.terraglide.session.party.members.find((m) => m.name === 'Bruno')?.together === false);
  await b.page.evaluate(() => window.terraglide.playersPanel.show());
  await until(b.page, () => !!document.querySelector('input[data-together]'), null, { timeout: 10000 });
  await b.page.click('input[data-together]');
  const together = await until(b.page, () => window.terraglide.session.party.members.find((m) => m.name === 'Bruno')?.together, null, { timeout: 15000 })
    .then(() => true, () => false);
  ok('Bruno joins unticked, and ticks to come along when Ada teleports', unticked && together);
  await b.page.evaluate(() => { window.terraglide.playersPanel.close(); document.activeElement?.blur?.(); });
  // A party waypoint from the panel, seen on the other side.
  await a.page.bringToFront();
  await until(a.page, () => !!document.querySelector('[data-action="party-mark"]'), null, { timeout: 10000 });
  await a.page.click('[data-action="party-mark"]');
  await until(b.page, () => window.terraglide.session.partyWaypoints().length === 1, null, { timeout: 20000 });
  ok('a waypoint marked for the party appears for the rest of it', true);
  const compass = await b.page.evaluate(() => window.terraglide.siteMarks().some((m) => /party/.test(m.title)));
  ok('and on their compass', compass);
  await a.page.screenshot({ path: join(OUT, 'players-party.png'), timeout: 120000 });
  await a.page.evaluate(() => window.terraglide.playersPanel.close());

  for (const p of [a, b]) {
    ok(`no script errors in ${p.name}'s page`, p.errors.length === 0, p.errors.slice(0, 2).join(' | '));
  }

  console.log('\nthe scanned body, seen by others');
  {
    // Ada switches the scanned body on (Settings -> Player): whoever is near
    // her is drawn as it too, with the generated sword in hand and the swing.
    for (const [p, dLat] of [[ada, 0], [bruno, 3 / 111320]]) {
      game.teleport(p, { lat: 46.5950 + dLat, lon: 7.9350, flying: false }, 'test');
    }
    await sleep(6000);
    await b.page.evaluate(() => window.terraglide.player.selectSlot(5));
    await a.page.bringToFront();
    await a.page.evaluate(() => {
      const g = window.terraglide;
      g.settings.set('detailedPlayerModel', true);
      // Face Bruno, for the picture.
      const other = g.session.remote.list().find((x) => x.name === 'Bruno');
      if (other) g.player.yaw = Math.atan2(other.pose.position.x - g.player.position.x, -(other.pose.position.z - g.player.position.z));
      g.player.pitch = -0.1;
    });
    const bodyOf = () => {
      const o = window.terraglide.session.remote.list().find((x) => x.name === 'Bruno');
      const av = o?.avatar;
      return av ? { model: !!av.model?.visible, sword: !!av.swordModelShown, item: o.pose.selectedSlot, swings: av.lastSwings } : null;
    };
    const scanned = await until(a.page, () => {
      const o = window.terraglide.session.remote.list().find((x) => x.name === 'Bruno');
      return !!(o?.avatar?.model?.visible && o.avatar.swordModelShown);
    }, null, { timeout: 120000 }).then(() => true, () => false);
    ok('with the scanned body on, Bruno is drawn as it too, the generated sword in hand', scanned, JSON.stringify(await a.page.evaluate(bodyOf)));
    // Bruno swings at nothing; Ada's figure of him takes the swing up.
    const swingsBefore = (await a.page.evaluate(bodyOf))?.swings ?? 0;
    await b.page.bringToFront();
    await b.page.evaluate(() => window.terraglide.attack());
    await a.page.bringToFront();
    const swung = await until(a.page, (n) => {
      const o = window.terraglide.session.remote.list().find((x) => x.name === 'Bruno');
      return (o?.avatar?.lastSwings ?? 0) > n;
    }, swingsBefore, { timeout: 30000 }).then(() => true, () => false);
    ok('and his swing is drawn on it', swung);
    await a.page.screenshot({ path: join(OUT, 'scanned-others.png'), timeout: 120000 });
    await a.page.evaluate(() => window.terraglide.settings.set('detailedPlayerModel', false));
    const built = await until(a.page, () => {
      const o = window.terraglide.session.remote.list().find((x) => x.name === 'Bruno');
      return o?.avatar && !o.avatar.model?.visible && !o.avatar.swordModelShown;
    }, null, { timeout: 20000 }).then(() => true, () => false);
    ok('switching it off puts the built body and sword back, for him as for her', built);
    ok('no script errors in Ada\'s page with the scan on', a.errors.length === 0, a.errors.slice(0, 2).join(' | '));
  }

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
      .then(() => true, () => false);
    ok('terraglide.html from file:// reaches the server and asks you to sign in', reached);
    // Played alone - the server's own page with ?local - there is no teleport
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
    await page.keyboard.press('Escape');
    ok('played locally there is no teleport menu and no button for one', !local.menu && !local.game && !local.button, JSON.stringify(local));
    await context.close();
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
process.exit(failures ? 1 : 0);

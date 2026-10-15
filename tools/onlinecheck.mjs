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

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/server.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = join(ROOT, 'shots', 'online');
mkdirSync(OUT, { recursive: true });

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
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});

async function relay(route) {
  const request = route.request();
  const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('ws:')) return route.continue();
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
  const context = await browser.newContext({ viewport: { width: 1100, height: 680 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', relay);
  await page.goto(BASE);
  await page.waitForFunction(() => window.__terraglideStarted === true, null, { timeout: 90000 });
  await page.waitForSelector('.online-panel:not([hidden]) .online-tabs', { timeout: 30000 });
  await page.click('[data-action="tab-signup"]');
  await page.fill('.online-form input[name="name"]', name);
  await page.fill('.online-form input[name="password"]', 'correct horse');
  await page.click('.online-form button[type="submit"]');
  await page.waitForFunction(() => window.terraglide.session?.signedIn === true, null, { timeout: 20000 });
  return { name, context, page, errors };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  console.log('\nsigning up through the form, in two browsers');
  const a = await player('Ada');
  ok('Ada made an account and is signed in', true);
  const b = await player('Bruno');
  ok('Bruno too', true);
  const panelGone = await a.page.$eval('.online-panel', (el) => el.hidden);
  ok('the sign-in panel gets out of the way afterwards', panelGone);

  console.log('\nseeing each other');
  await a.page.waitForFunction(() => {
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
  await a.page.keyboard.type('hello from Ada');
  await a.page.keyboard.press('Enter');
  await b.page.waitForFunction(() => [...document.querySelectorAll('.chat-line')].some((l) => l.textContent.includes('hello from Ada')), null, { timeout: 5000 });
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
  await b.page.waitForSelector('.tp-prompt', { timeout: 5000 });
  const prompt = await b.page.$eval('.tp-prompt', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  ok('Bruno gets a prompt with a countdown', /Ada wants to teleport to you/.test(prompt) && /\d+s/.test(prompt), prompt.slice(0, 80));
  await b.page.screenshot({ path: join(OUT, 'request-prompt.png') });
  await b.page.keyboard.press('y');
  await a.page.waitForFunction(() => {
    const p = window.terraglide.player;
    return Math.abs(p.lat - 46.62) < 0.01 && Math.abs(p.lon - 7.95) < 0.01;
  }, null, { timeout: 8000 });
  ok('pressing Y sends Ada to Bruno', true);
  const height = await a.page.evaluate(() => window.terraglide.player.position.y);
  ok('at Bruno\'s height, in the air beside him', height > 1500, `${height.toFixed(0)} m`);
  await sleep(2500);
  await a.page.screenshot({ path: join(OUT, 'ada-beside-bruno.png') });
  await b.page.screenshot({ path: join(OUT, 'bruno-sees-ada.png') });

  console.log('\na sword fight');
  // Both on the ground in a field away from spawn, facing each other.
  for (const [p, dLat] of [[ada, 0], [bruno, 2.5 / 111320]]) {
    game.teleport(p, { lat: 46.5900 + dLat, lon: 7.9300, flying: false }, 'test');
  }
  await sleep(6000);
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
  await b.page.waitForFunction((h) => window.terraglide.player.health < h, before, { timeout: 5000 }).catch(() => {});
  const after = await b.page.evaluate(() => window.terraglide.player.health);
  ok('Ada\'s swing takes Bruno\'s hearts', after < before, `${before} -> ${after}`);
  await a.page.screenshot({ path: join(OUT, 'ada-sword.png') });
  await b.page.screenshot({ path: join(OUT, 'bruno-hurt.png') });


  console.log('\nthe map');
  await a.page.keyboard.press('Escape').catch(() => {});
  await a.page.evaluate(() => window.terraglide.worldmap.show({ lat: window.terraglide.player.lat, lon: window.terraglide.player.lon, heading: 0 }));
  await sleep(2500);
  await a.page.screenshot({ path: join(OUT, 'map.png') });
  const others = await a.page.evaluate(() => window.terraglide.othersForMap().map((o) => o.name));
  ok('Bruno is on Ada\'s map', others.includes('Bruno'));

  for (const p of [a, b]) {
    ok(`no script errors in ${p.name}'s page`, p.errors.length === 0, p.errors.slice(0, 2).join(' | '));
  }
} catch (error) {
  failures++;
  console.log(`  FAIL ${error.message.split('\n')[0]}`);
} finally {
  await browser.close();
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passes} passed, ${failures} failed — screenshots in shots/online/`);
process.exit(failures ? 1 : 0);

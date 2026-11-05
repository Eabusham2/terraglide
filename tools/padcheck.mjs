#!/usr/bin/env node
/**
 * A game controller and a VR headset, in a real browser.
 *
 * The browser has no controller plugged in and no headset, so both are made
 * up: a standard-mapping gamepad whose sticks and buttons this script sets
 * (navigator.getGamepads, replaced before the page loads), and a Meta Quest 3
 * emulated by IWER, Meta's WebXR runtime for tests (tools/vendor/iwer.min.js,
 * MIT; never part of the game). Everything else is the game as it ships:
 * walking on the stick, half a push walking slower, looking, jumping, the
 * wings, banking, rockets, the hotbar, a vibration, the menus worked from the
 * pad, a death got up from with A; then into the headset by its button, the
 * head looking, the hand controllers walking, turning and firing, the panel
 * in view, and out again.
 *
 *   node tools/padcheck.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { startServer } from '../server/server.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until the page has drawn `n` more frames. */
async function frames(page, n) {
  const start = await page.evaluate(() => window.__frames);
  const deadline = Date.now() + 60000;
  while ((await page.evaluate(() => window.__frames)) < start + n) {
    if (Date.now() > deadline) throw new Error(`frames: ${n} frames did not come in a minute`);
    await sleep(40);
  }
}

const dir = mkdtempSync(join(tmpdir(), 'terraglide-pad-'));
const server = startServer({ port: 0, host: '127.0.0.1', dataDir: dir, saveEveryS: 3600 });
const address = await server.ready;
const BASE = `http://127.0.0.1:${address.port}/`;

const { chromium } = await import('playwright');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});

async function until(page, fn, arg = null, { timeout = 20000, every = 150 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(fn, arg).catch(() => false);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`until: timeout ${timeout}ms: ${String(fn).slice(0, 90)}`);
    await sleep(every);
  }
}

/**
 * The game and nothing else: no map tiles from the providers. Flat bare
 * ground is all this needs, and a software-rendered page with the world
 * streaming in draws a frame a second.
 */
async function relay(route) {
  const url = route.request().url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
  await route.abort().catch(() => {});
}

async function open({ pad = false, headset = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', relay);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('terraglide.settings', JSON.stringify({ graphics: 'low', autoTier: 'low', resolutionScale: 0.5, buildings: false, weather: false }));
      // The controls card's own first-visit key: shown, it pauses the game.
      localStorage.setItem('terraglide.seen-intro', 'true');
    } catch {}
    window.__frames = 0;
    // Every toast, kept: they leave the screen in under three seconds.
    window.__toasts = [];
    new MutationObserver((changes) => {
      for (const change of changes) {
        for (const node of change.addedNodes) {
          if (node.classList?.contains('toast')) window.__toasts.push(node.textContent);
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  if (pad) {
    await page.addInitScript(() => {
      // One standard pad, as a browser reports an Xbox controller.
      const button = () => ({ pressed: false, touched: false, value: 0 });
      const pad = {
        id: 'Test Controller (STANDARD GAMEPAD Vendor: 045e Product: 02ea)',
        index: 0, connected: true, mapping: 'standard', timestamp: 0,
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, button),
        vibrationActuator: { playEffect: (...args) => { (window.__rumbles ??= []).push(args); return Promise.resolve('complete'); } },
      };
      window.__pad = pad;
      window.__press = (i, v = 1) => { pad.buttons[i] = { pressed: v > 0.5, touched: v > 0, value: v }; };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true });
    });
  }
  if (headset) {
    await page.addInitScript({ path: join(ROOT, 'tools/vendor/iwer.min.js') });
    await page.addInitScript(() => {
      // A Quest 3, sat still and facing ahead, eyes 1.6 m up.
      const device = new window.IWER.XRDevice(window.IWER.metaQuest3);
      device.installRuntime({ forceInstall: true });
      window.__xr = device;
      // IWER 2.7 takes an offset space's XRRigidTransform for its matrix
      // (mat4.clone of the object, which is no matrix), so every offset space
      // is the base space again. The WebXR spec, and every headset, take the
      // transform; handed its .matrix, IWER does the same.
      const proto = window.XRReferenceSpace?.prototype;
      const offset = proto?.getOffsetReferenceSpace;
      if (offset) {
        proto.getOffsetReferenceSpace = function getOffsetReferenceSpace(transform) {
          return offset.call(this, transform?.matrix ?? transform);
        };
      }
    });
  }
  await page.goto(`${BASE}?local`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await until(page, () => window.__terraglideStarted === true, null, { timeout: 120000 });
  // Frames the game draws, counted - in a headset too, where the window's own
  // animation frames stop - so an input is held for frames the game has run
  // rather than for milliseconds it may have spent on one.
  await page.evaluate(() => {
    const renderer = window.terraglide.renderer;
    const render = renderer.render.bind(renderer);
    renderer.render = (...args) => {
      window.__frames += 1;
      return render(...args);
    };
  });
  // Standing on something, the way a player would be before they pick the pad up.
  await until(page, () => window.terraglide.player.onGround && !window.terraglide.settling, null, { timeout: 120000 }).catch(() => {});
  return { context, page, errors };
}

let pad = null;
let vr = null;
try {
  console.log('\na controller');
  pad = await open({ pad: true });
  const p = pad.page;
  const toast = await until(p, () => window.__toasts.find((t) => /connected/.test(t)), null, { timeout: 10000 }).catch(() => '');
  ok(`plugging it in is said  (${toast})`, /Test Controller connected — Back shows its buttons/.test(toast));

  // Walking: the left stick, all the way and then half way.
  const pace = async (push) => {
    const before = await p.evaluate(() => ({ x: window.terraglide.player.position.x, z: window.terraglide.player.position.z, yaw: window.terraglide.player.yaw, t: performance.now() }));
    await p.evaluate((y) => { window.__pad.axes[1] = y; }, -push);
    await frames(p, 30);
    const after = await p.evaluate(() => ({ x: window.terraglide.player.position.x, z: window.terraglide.player.position.z, t: performance.now() }));
    await p.evaluate(() => { window.__pad.axes[1] = 0; });
    await frames(p, 15);
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    const along = (dx * Math.sin(before.yaw) - dz * Math.cos(before.yaw)) / Math.max(1e-6, Math.hypot(dx, dz));
    return { speed: Math.hypot(dx, dz) / ((after.t - before.t) / 1000), along };
  };
  const full = await pace(1);
  const half = await pace(0.55);
  ok(`the left stick walks you the way you face  (${full.speed.toFixed(2)} m/s, ${full.along.toFixed(3)} along)`, full.speed > 2 && full.along > 0.95);
  ok(`and half a push walks slower  (${half.speed.toFixed(2)} m/s)`, half.speed > 0.4 && half.speed < full.speed * 0.8);

  const yaw0 = await p.evaluate(() => window.terraglide.player.yaw);
  await p.evaluate(() => { window.__pad.axes[2] = 1; });
  await frames(p, 12);
  await p.evaluate(() => { window.__pad.axes[2] = 0; });
  const yaw1 = await p.evaluate(() => window.terraglide.player.yaw);
  ok(`the right stick looks round  (${(yaw1 - yaw0).toFixed(2)} rad)`, yaw1 - yaw0 > 0.6);

  // A jump, then the wings, in the air.
  await p.evaluate(() => window.__press(0, 1));
  const jumped = await until(p, () => !window.terraglide.player.onGround, null, { timeout: 2000 }).then(() => true, () => false);
  await p.evaluate(() => window.__press(0, 0));
  ok('A jumps', jumped);
  await p.evaluate(() => {
    const player = window.terraglide.player;
    player.position.y += 400;
    player.onGround = false;
    player.snapRender();
  });
  await frames(p, 3);
  await p.evaluate(() => window.__press(2, 1));
  await frames(p, 3);
  await p.evaluate(() => window.__press(2, 0));
  const wings = await until(p, () => window.terraglide.player.elytraDeployed, null, { timeout: 3000 }).then(() => true, () => false);
  ok('X opens the wings in the air', wings);
  // Half a push, held until the bank passes 0.4 rad, read the frame it does.
  // Held, a roll goes on round, and a frame on a slow machine can be a
  // second and a half long (MAX_FRAME_S): at a full push one frame carried
  // it past half a turn, where it reads as the other way round. Half a push
  // turns at most 2.6 rad in a frame.
  await p.evaluate(() => {
    const g = window.terraglide;
    window.__rolls = [];
    window.__render = g.renderer.render;
    g.renderer.render = (...args) => {
      window.__rolls.push(g.rig.roll);
      return window.__render(...args);
    };
    window.__pad.axes[0] = 0.5;
  });
  await until(p, () => window.__rolls.some((r) => Math.abs(r) > 0.4), null, { timeout: 15000 }).catch(() => {});
  const rolls = await p.evaluate(() => {
    window.__pad.axes[0] = 0;
    window.terraglide.renderer.render = window.__render;
    return window.__rolls;
  });
  const roll = rolls.find((r) => Math.abs(r) > 0.4) ?? 0;
  ok(`and the left stick banks them  (roll ${roll.toFixed(2)})`, roll > 0.4);

  // The triggers: a rocket, and a shake for it.
  const fired0 = await p.evaluate(() => window.terraglide.player.rocketsFired);
  await p.evaluate(() => window.__press(7, 1));
  await frames(p, 2);
  await p.evaluate(() => window.__press(7, 0));
  await frames(p, 2);
  const lit = await p.evaluate(() => ({ fired: window.terraglide.player.rocketsFired, rumbles: (window.__rumbles ?? []).length }));
  ok(`the right trigger fires a rocket  (${fired0} -> ${lit.fired} fired)`, lit.fired === fired0 + 1);
  ok(`and the pad shakes for it  (${lit.rumbles})`, lit.rumbles > 0);

  // The bumpers walk the hotbar.
  const slot0 = await p.evaluate(() => window.terraglide.player.selectedSlot);
  await p.evaluate(() => window.__press(5, 1));
  await frames(p, 3);
  await p.evaluate(() => window.__press(5, 0));
  await frames(p, 3);
  const slot1 = await p.evaluate(() => window.terraglide.player.selectedSlot);
  await p.evaluate(() => window.__press(4, 1));
  await frames(p, 3);
  await p.evaluate(() => window.__press(4, 0));
  await frames(p, 3);
  const slot2 = await p.evaluate(() => window.terraglide.player.selectedSlot);
  ok(`the bumpers step through the hotbar  (${slot0} -> ${slot1} -> ${slot2})`, slot1 !== slot0 && slot2 === slot0);

  // Menus: Start opens the settings, the d-pad moves, B backs out.
  const tap = async (i) => {
    await p.evaluate((b) => window.__press(b, 1), i);
    await frames(p, 3);
    await p.evaluate((b) => window.__press(b, 0), i);
    await frames(p, 3);
  };
  await tap(9);
  const settingsOpen = await until(p, () => window.terraglide.settingsPanel.open, null, { timeout: 3000 }).then(() => true, () => false);
  ok('Start opens the settings', settingsOpen);
  const focus0 = await p.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 30) ?? '');
  await tap(13);
  await tap(13);
  const focus = await p.evaluate(() => ({
    inside: !!document.activeElement?.closest('.panel'),
    text: document.activeElement?.textContent?.trim().slice(0, 30) ?? '',
  }));
  ok(`the d-pad moves through it  (${focus0 || '—'} -> ${focus.text})`, focus.inside && focus.text !== focus0);
  await tap(1);
  const closed = await until(p, () => !window.terraglide.settingsPanel.open, null, { timeout: 3000 }).then(() => true, () => false);
  ok('B backs out of it', closed);
  await tap(8);
  const help = await until(p, () => window.terraglide.help.open && !!document.querySelector('.help-pad'), null, { timeout: 3000 }).then(() => true, () => false);
  const rows = await p.evaluate(() => document.querySelectorAll('.help-pad .help-row').length);
  ok(`Back shows the controls card, with the controller's buttons on it  (${rows} rows)`, help && rows >= 16);
  await tap(1);

  // Dead, and up again with one press of A.
  await p.evaluate(() => window.terraglide.player.damage(100, { cause: 'test' }));
  const dead = await until(p, () => window.terraglide.deathScreen.open, null, { timeout: 4000 }).then(() => true, () => false);
  // The screen holds its button off for most of a second - the key that
  // killed you is not to be the one that respawns you - and A waits with it.
  await until(p, () => !document.querySelector('.death-screen button').disabled, null, { timeout: 4000 }).catch(() => {});
  await frames(p, 2);
  await tap(0);
  const up = await until(p, () => !window.terraglide.deathScreen.open && !window.terraglide.player.dead, null, { timeout: 4000 }).then(() => true, () => false);
  ok('a death is got up from with A', dead && up);

  // A panel closed with A: the thumb still on it the frame after is not a
  // jump. It was - the first frame back in the game saw A held and new.
  await until(p, () => window.terraglide.player.onGround && !window.terraglide.settling, null, { timeout: 30000 }).catch(() => {});
  await frames(p, 4);
  await p.evaluate(() => window.__press(9, 1));
  await frames(p, 3);
  await p.evaluate(() => window.__press(9, 0));
  const onClose = await until(p, () => window.terraglide.settingsPanel.open
    && document.activeElement?.textContent?.trim(), null, { timeout: 5000 }).catch(() => '');
  await p.evaluate(() => {
    window.__rise = 0;
    window.__left = false;
    const g = window.terraglide;
    const render = g.renderer.render;
    g.renderer.render = (...args) => {
      if (!g.settingsPanel.open) {
        window.__rise = Math.max(window.__rise, g.player.velocity.y);
        if (!g.player.onGround) window.__left = true;
      }
      return render(...args);
    };
    window.__press(0, 1);
  });
  await frames(p, 8);
  await p.evaluate(() => window.__press(0, 0));
  await frames(p, 4);
  const leak = await p.evaluate(() => ({ open: window.terraglide.settingsPanel.open, rise: window.__rise, left: window.__left }));
  ok(`closing a panel with A does not jump as it closes  (${onClose}; rose ${leak.rise.toFixed(2)} m/s)`,
    !leak.open && !leak.left && leak.rise < 0.5);

  // A frame that throws is not the last: three.js asks for the next frame
  // only once this one returns, and the game stood still on the first error.
  const BAD = 'padcheck: one frame that throws';
  await p.evaluate((bad) => {
    const g = window.terraglide;
    g.update = () => {
      delete g.update;
      throw new Error(bad);
    };
  }, BAD);
  const carriedOn = await frames(p, 6).then(() => true, () => false);
  ok('a frame that throws is not the last one', carriedOn);
  ok('and what it threw is still reported', pad.errors.some((error) => error.includes(BAD)));
  const unexpected = pad.errors.filter((error) => !error.includes(BAD));
  ok('no script errors with the controller', unexpected.length === 0, unexpected.slice(0, 2).join(' | '));
  await pad.context.close();
  pad = null;

  console.log('\na VR headset');
  vr = await open({ headset: true });
  const v = vr.page;
  const shown = await until(v, () => !document.querySelector('.hud [data-action="vr"]').hidden, null, { timeout: 10000 }).then(() => true, () => false);
  ok('a browser with a headset gets a VR button', shown);
  const yawBefore = await v.evaluate(() => window.terraglide.player.yaw);
  await v.click('.hud [data-action="vr"]', { force: true, timeout: 60000 });
  const presenting = await until(v, () => window.terraglide.vr.presenting, null, { timeout: 15000 }).then(() => true, () => false);
  ok('it puts you in the headset', presenting);
  await frames(v, 20);
  const placed = await v.evaluate(() => {
    const g = window.terraglide;
    const eye = g.rig.eye;
    const cam = g.camera.position;
    return { gap: Math.hypot(cam.x - eye.x, cam.y - eye.y, cam.z - eye.z), yaw: g.player.yaw, first: g.rig.perspective };
  });
  ok(`seeing from the player's eye  (${placed.gap.toFixed(2)} m from it)`, placed.gap < 0.6 && placed.first === 'first');
  ok(`facing the way they faced  (${yawBefore.toFixed(2)} -> ${placed.yaw.toFixed(2)})`, Math.abs(Math.atan2(Math.sin(placed.yaw - yawBefore), Math.cos(placed.yaw - yawBefore))) < 0.15);

  // The head turns, and the player looks where it does.
  await v.evaluate(() => {
    // A quarter turn to the right: about -y in three.js.
    const half = -Math.PI / 4;
    window.__xr.quaternion.set(0, Math.sin(half), 0, Math.cos(half));
  });
  await frames(v, 10);
  const turned = await v.evaluate(() => window.terraglide.player.yaw);
  const headTurn = Math.atan2(Math.sin(turned - placed.yaw), Math.cos(turned - placed.yaw));
  ok(`turning your head turns where you look  (${headTurn.toFixed(2)} rad)`, Math.abs(headTurn - Math.PI / 2) < 0.15);
  await v.evaluate(() => window.__xr.quaternion.set(0, 0, 0, 1));
  await frames(v, 10);

  // The right stick snaps a step round.
  const snap0 = await v.evaluate(() => window.terraglide.player.yaw);
  await v.evaluate(() => window.__xr.controllers.right.updateAxes('thumbstick', 1, 0));
  await frames(v, 8);
  await v.evaluate(() => window.__xr.controllers.right.updateAxes('thumbstick', 0, 0));
  await frames(v, 8);
  const snap1 = await v.evaluate(() => window.terraglide.player.yaw);
  const snapped = Math.atan2(Math.sin(snap1 - snap0), Math.cos(snap1 - snap0));
  ok(`the right stick turns you thirty degrees, once a push  (${((snapped * 180) / Math.PI).toFixed(1)} deg)`, Math.abs(snapped - Math.PI / 6) < 0.05);

  // The left stick walks.
  const at0 = await v.evaluate(() => ({ x: window.terraglide.player.position.x, z: window.terraglide.player.position.z }));
  await v.evaluate(() => window.__xr.controllers.left.updateAxes('thumbstick', 0, -1));
  await frames(v, 30);
  await v.evaluate(() => window.__xr.controllers.left.updateAxes('thumbstick', 0, 0));
  const at1 = await v.evaluate(() => ({ x: window.terraglide.player.position.x, z: window.terraglide.player.position.z }));
  ok(`the left hand's stick walks you  (${Math.hypot(at1.x - at0.x, at1.z - at0.z).toFixed(1)} m)`, Math.hypot(at1.x - at0.x, at1.z - at0.z) > 1.5);

  // Standing, a head turned a quarter round: the eye stays where it is.
  // An eye leant forward along the bearing swung round the body as the
  // head turned, on top of the neck's own swing. Measured between the two
  // eyes: three.js's camera for both stands a little behind them, wide
  // enough to see what either sees, and that point swings with the head.
  const eyeAt = () => v.evaluate(() => {
    const g = window.terraglide;
    const eyes = g.renderer.xr.getCamera().cameras;
    const l = eyes[0].matrixWorld.elements;
    const r = eyes[eyes.length - 1].matrixWorld.elements;
    const p = g.player.renderPosition;
    return { x: (l[12] + r[12]) / 2 - p.x, z: (l[14] + r[14]) / 2 - p.z, body: g.avatar.root.visible };
  });
  await v.evaluate(() => window.__xr.quaternion.set(0, 0, 0, 1));
  await frames(v, 6);
  const ahead = await eyeAt();
  await v.evaluate(() => window.__xr.quaternion.set(0, Math.sin(-Math.PI / 4), 0, Math.cos(-Math.PI / 4)));
  await frames(v, 6);
  const turnedEye = await eyeAt();
  await v.evaluate(() => window.__xr.quaternion.set(0, 0, 0, 1));
  await frames(v, 4);
  const swing = Math.hypot(turnedEye.x - ahead.x, turnedEye.z - ahead.z);
  ok(`turning your head on your feet does not move your eye  (${(swing * 100).toFixed(1)} cm)`, swing < 0.01);
  ok('and on your feet your own body is not drawn round your eye', !ahead.body && !turnedEye.body);
  // With the freecam out, the eye is not in the body: there it is drawn.
  await v.evaluate(() => window.terraglide.onAction('freecam'));
  await frames(v, 2);
  await v.evaluate(() => {
    const f = window.terraglide.rig.freecam.position;
    f.z += 6;
    f.y += 1;
  });
  await frames(v, 4);
  const seen = await v.evaluate(() => ({ freecam: window.terraglide.rig.isFreecam, body: window.terraglide.avatar.root.visible }));
  await v.evaluate(() => window.terraglide.onAction('freecam'));
  await frames(v, 4);
  ok('but with the freecam out it is', seen.freecam && seen.body && !(await v.evaluate(() => window.terraglide.rig.isFreecam)));

  // The right trigger lights a rocket - in the air, where rockets are lit:
  // on the ground the game says to jump first.
  await v.evaluate(() => {
    const player = window.terraglide.player;
    player.position.y += 400;
    player.onGround = false;
    player.snapRender();
  });
  await frames(v, 3);
  const before = await v.evaluate(() => window.terraglide.player.rocketsFired);
  await v.evaluate(() => window.__xr.controllers.right.updateButtonValue('trigger', 1));
  await frames(v, 3);
  await v.evaluate(() => window.__xr.controllers.right.updateButtonValue('trigger', 0));
  await frames(v, 2);
  const after = await v.evaluate(() => window.terraglide.player.rocketsFired);
  ok(`the right trigger fires a rocket in VR too  (${before} -> ${after} fired)`, after === before + 1);

  // The panel of numbers, in view.
  const hud = await v.evaluate(() => {
    const h = window.terraglide.vr.hud;
    if (!h) return null;
    const px = h.context.getImageData(30, 30, 1, 1).data;
    return { visible: h.mesh.visible, onCamera: h.mesh.parent === window.terraglide.camera, drawn: px[3] > 0 };
  });
  ok('a panel of speed, height and hearts hangs in view', !!hud && hud.visible && hud.onCamera && hud.drawn);

  // Gliding across the point where the world re-centres (every forty
  // kilometres): every frame is drawn from the eye. The one where it moved
  // was drawn from forty kilometres back - and every frame from a frame ago.
  await v.evaluate(() => {
    window.__gaps = [];
    const g = window.terraglide;
    const p = g.player;
    p.position.set(g.frame.rebaseDistance - 60, p.position.y + 800, 0);
    p.onGround = false;
    p.toggleElytra(true);
    p.velocity.set(60, 0, 0);
    p.snapRender();
    const render = g.renderer.render;
    g.renderer.render = (...args) => {
      const out = render(...args);
      const e = g.renderer.xr.getCamera().matrixWorld.elements;
      const at = p.renderPosition;
      window.__gaps.push({ x: at.x, gap: Math.hypot(e[12] - at.x, e[14] - at.z) });
      return out;
    };
  });
  const crossed = await until(v, () => window.__gaps.some((f) => f.x < 1000) && window.__gaps.length > 4, null, { timeout: 90000 }).then(() => true, () => false);
  await frames(v, 4);
  const gaps = await v.evaluate(() => window.__gaps.map((f) => f.gap));
  const worst = Math.max(...gaps);
  ok(`gliding across a re-centring, every frame is drawn from your eye  (worst ${worst.toFixed(2)} m over ${gaps.length} frames)`, crossed && worst < 0.5);
  ok('a glider sees the wings it flies on', await v.evaluate(() => window.terraglide.avatar.root.visible));
  await v.screenshot({ path: join(ROOT, 'shots', 'vr-emulated.png') });

  // The window changes size while you are in the headset: coming out, the
  // picture fits it. The game's resize used to run before three.js had
  // stopped presenting, which refuses it.
  await v.setViewportSize({ width: 1100, height: 520 });
  await frames(v, 3);
  await v.evaluate(() => window.terraglide.vr.exit());
  const out = await until(v, () => !window.terraglide.vr.presenting, null, { timeout: 5000 }).then(() => true, () => false);
  await frames(v, 3);
  const back = await v.evaluate(() => {
    const canvas = window.terraglide.renderer.domElement;
    return {
      forced: !!window.terraglide.rig.forceFirst,
      width: canvas.width,
      canvas: canvas.width / canvas.height,
      window: innerWidth / innerHeight,
      camera: window.terraglide.camera.aspect,
      auto: window.terraglide.renderer.xr.cameraAutoUpdate,
    };
  });
  ok('and out again, to the screen as it was', out && !back.forced && back.width > 0 && back.auto === true);
  ok(`sized to a window that changed meanwhile  (canvas ${back.canvas.toFixed(3)}, window ${back.window.toFixed(3)}, camera ${back.camera.toFixed(3)})`,
    Math.abs(back.canvas - back.window) < 0.02 && Math.abs(back.camera - back.window) < 0.02);
  ok('no script errors in VR', vr.errors.length === 0, vr.errors.slice(0, 2).join(' | '));
} catch (error) {
  failures++;
  console.log(`  FAIL ${error.message.split('\n')[0]}`);
  for (const run of [pad, vr].filter(Boolean)) console.log(`    errors: ${run.errors.slice(-3).join(' || ') || 'none'}`);
} finally {
  await browser.close();
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

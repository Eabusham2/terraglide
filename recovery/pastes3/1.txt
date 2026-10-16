/**
 * Honest flying, judged by the server, on every world.
 *
 *   node tools/flightcheck.mjs            every world
 *   node tools/flightcheck.mjs moon mars  just these
 *
 * The anti-cheat in server/game.mjs refuses moves faster than the game can
 * make. This is the other half of that promise: nothing the game can make is
 * refused. Each world is flown with the game's own Player and PlayerController
 * - the same rockets, glide, speed mode and walking as a real page - through
 * the patterns that push the flight model hardest: a long rocket climb and a
 * dive, dive-and-climb pumping with a Rocket V lit every second, a steep dive
 * from high up turned level, cruising in and out of a surge, landing fast and
 * running on, and a knock while walking. Its states go to the real game logic
 * ten times a second the way a browser's socket delivers them: some late and
 * bunched, and twice a stall of several seconds followed by everything at
 * once. Any move the server puts back is a failure.
 *
 * The client modules read which world they are on when they load, so each
 * world runs in a process of its own. The server runs on a clock of its own
 * too, so ten minutes of flying takes seconds.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;

if (process.argv[2] === '--world') {
  await flyOne(process.argv[3]);
} else {
  const { BODIES } = await import('../src/geo/bodies.js');
  const wanted = process.argv.slice(2);
  const worlds = wanted.length ? wanted : Object.keys(BODIES);
  const results = [];
  let next = 0;
  const run = async () => {
    while (next < worlds.length) {
      const world = worlds[next++];
      results.push(await child(world));
    }
  };
  await Promise.all(Array.from({ length: 4 }, run));
  results.sort((a, b) => worlds.indexOf(a.world) - worlds.indexOf(b.world));
  let failed = 0;
  for (const r of results) {
    const ok = r.ok;
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${r.world.padEnd(10)} ${r.line}`);
  }
  console.log(`\n${results.length - failed} of ${results.length} worlds flown without a move put back`);
  process.exit(failed ? 1 : 0);
}

function child(world) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [HERE, '--world', world], { cwd: ROOT });
    let out = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('close', (code) => {
      const last = out.trim().split('\n').pop() ?? '';
      let parsed = null;
      try { parsed = JSON.parse(last); } catch { /* fall through */ }
      resolve(parsed ? { world, ok: code === 0 && parsed.ok, line: parsed.line } : { world, ok: false, line: out.trim().slice(-400) });
    });
  });
}

async function flyOne(world) {
  // The page's storage, so the client modules boot onto this world.
  const store = new Map([['terraglide.boot', JSON.stringify({ mode: 'local', world, worlds: { local: world } })]]);
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Player, HOTBAR } = await import('../src/player/player.js');
  const { PlayerController } = await import('../src/player/controller.js');
  const { settings } = await import('../src/core/settings.js');
  const { BODIES } = await import('../src/geo/bodies.js');
  const { FLAG, OXYGEN_SECONDS, PROTOCOL_VERSION, encodeState } = await import('../src/net/protocol.js');
  const { Game } = await import('../server/game.mjs');
  const { Store } = await import('../server/store.mjs');
  const { Accounts } = await import('../server/accounts.mjs');
  const { loadConfig } = await import('../server/config.mjs');
  const { radiusOf } = await import('../server/records.mjs');

  const dir = mkdtempSync(join(tmpdir(), 'terraglide-flight-'));
  let clock = 1_000_000;
  const config = { ...loadConfig(), dataDir: dir, saveEveryS: 3600, pvp: true };
  const storeOnDisk = new Store(dir);
  const accounts = new Accounts(storeOnDisk, config);
  const game = new Game({ config, store: storeOnDisk, accounts, now: () => clock });

  // A socket that is a list: what the server sends lands in `inbox`.
  const inbox = [];
  const handlers = {};
  const ws = {
    open: true,
    bufferedAmount: 0,
    send: (text) => { inbox.push(JSON.parse(text)); return true; },
    on: (event, fn) => { handlers[event] = fn; },
    close() {}, terminate() {}, ping() {},
  };
  game.connect(ws, '127.0.0.1');
  const say = (m) => handlers.message(JSON.stringify(m), false);
  const take = (type) => {
    const i = inbox.findIndex((m) => m.t === type);
    return i < 0 ? null : inbox.splice(i, 1)[0];
  };
  say({ t: 'hello', v: PROTOCOL_VERSION, client: 'flightcheck' });
  say({ t: 'signup', name: 'Pilot', password: 'hunter22' });
  // Signing up hashes a password, which takes real time.
  let auth = null;
  for (let i = 0; i < 400 && !auth; i++) {
    await new Promise((r) => setTimeout(r, 10));
    auth = take('auth');
  }
  if (!auth?.ok) return finish(false, `could not sign in: ${JSON.stringify(auth)}`);
  const me = game.byKey.get('pilot');
  if (world !== me.world) game.moveWorld(me, world);
  const spawnAt = game.spawnOf(world);
  const radius = radiusOf(world);
  const lat0 = spawnAt.lat + 0.3;
  const lon0 = spawnAt.lon + 0.3;

  // The page. Flat ground at nought, so a landing is a landing.
  settings.set('rocketSupply', 'unlimited');
  const flat = {
    heightAt: () => 0, meshHeightAt: () => null, hasElevationAt: () => true, bedAt: () => 0,
    isWaterAt: () => false,
  };
  const frame = { toLocal: () => ({ x: 0, z: 0 }), toGeo: () => ({ lat: lat0, lon: lon0 }) };
  const p = new Player(frame);
  const c = new PlayerController({ player: p, terrain: flat, buildings: null });
  const ROCKET_V = HOTBAR.length - 1;
  const geo = () => ({
    lat: lat0 + (-p.position.z / radius) * 180 / Math.PI,
    lon: lon0 + (p.position.x / (radius * Math.cos(lat0 * Math.PI / 180))) * 180 / Math.PI,
  });
  const flags = () => (p.onGround ? FLAG.ground : 0) | (p.elytraDeployed ? FLAG.elytra : 0)
    | (p.rocketTicksLeft > 0 ? FLAG.rocket : 0) | (p.speedActive ? FLAG.surge : 0);
  const state = (seq) => {
    const at = geo();
    return encodeState({
      seq, lat: at.lat, lon: at.lon, alt: p.position.y, agl: p.position.y,
      vel: [p.velocity.x, p.velocity.y, -p.velocity.z], yaw: p.yaw, pitch: p.pitch, roll: 0,
      flags: flags(), item: ROCKET_V,
    });
  };

  // A deterministic wobble for the network.
  let seed = 12345 + world.length * 97;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  let seq = 1;
  let corrections = 0;
  const putBack = [];
  let kicked = null;
  let peak = 0;
  let t = 0; // page seconds
  // Messages on their way: delivered at `at` on the server's clock.
  const wire = [];
  let stallUntil = -1;
  const deliverDue = () => {
    wire.sort((a, b) => a.at - b.at);
    while (wire.length && wire[0].at <= clock) say(wire.shift().m);
  };
  const serverStep = (ms) => {
    // The server's own tick every tenth of a second, in step with the clock.
    const end = clock + ms;
    while (clock < end) {
      clock = Math.min(end, clock + 100);
      deliverDue();
      me.oxygen = OXYGEN_SECONDS; // breathing is not what this checks
      game.tick();
    }
  };
  const readInbox = () => {
    for (let m; (m = inbox.shift());) {
      if (m.t === 'correct') {
        corrections++;
        putBack.push(`${t.toFixed(1)}s`);
        const dz = -(m.lat - lat0) * Math.PI / 180 * radius;
        const dx = (m.lon - lon0) * Math.PI / 180 * radius * Math.cos(lat0 * Math.PI / 180);
        p.position.set(dx, Number.isFinite(m.alt) ? m.alt : p.position.y, dz);
        p.velocity.set(0, 0, 0);
        p.stopRockets();
      } else if (m.t === 'kick') {
        kicked = m.reason;
      } else if (m.t === 'teleport') {
        teleported = m;
      }
    }
  };
  let teleported = null;

  // Sent somewhere by the server, the way anyone is, and arrived.
  const sendTo = (alt, flying) => {
    game.teleport(me, { lat: lat0, lon: lon0, alt, flying }, 'test');
    readInbox();
    const tp = teleported;
    teleported = null;
    p.position.set(0, alt, 0);
    p.velocity.set(0, 0, flying ? -20 : 0);
    p.onGround = !flying;
    p.elytraDeployed = flying;
    p.stopRockets();
    say({ t: 'arrived', tid: tp.tid });
    say(state(seq++));
    serverStep(100);
    readInbox();
  };

  // One physics tick of the page, and every other one a state on the wire.
  const step = (input = {}) => {
    const full = { forward: false, back: false, left: false, right: false, sprint: false, crouch: false, jump: false, ...input };
    c.update(1 / 20, full);
    t += 1 / 20;
    peak = Math.max(peak, Math.hypot(p.velocity.x, Math.max(0, p.velocity.y), p.velocity.z) * p.speedMultiplier);
    if (Math.round(t * 20) % 2 === 0) {
      // Most arrive in about the same time; some are held up and bunch.
      const late = random() < 0.12 ? 100 + random() * 250 : random() * 20;
      const at = Math.max(clock + late, stallUntil);
      wire.push({ at, m: state(seq++) });
    }
    serverStep(50);
    readInbox();
  };
  const stall = (seconds) => { stallUntil = clock + seconds * 1000; };
  const fire = () => { p.selectSlot(ROCKET_V); p.fireRocket(); };
  const seconds = (n, each) => { for (let i = 0; i < n * 20; i++) each(i); };

  const legs = [];
  const leg = (name, body) => {
    const before = corrections;
    body();
    legs.push(`${name}${corrections > before ? ` x${corrections - before}` : ''}`);
  };

  // 1. From the ground: open the wings and climb on rockets for two minutes.
  leg('climb', () => {
    sendTo(0, false);
    // Wait out the arrival, standing.
    seconds(1, () => step());
    p.position.y = 2;
    p.onGround = false;
    p.toggleElytra(true);
    p.velocity.set(0, 10, -20);
    seconds(120, (i) => {
      p.pitch = 1.1;
      if (i % 40 === 0) fire();
      step();
    });
  });
  // 2. Pumping: dive two seconds, climb two, a Rocket V every second.
  leg('pump', () => {
    seconds(120, (i) => {
      p.pitch = Math.floor(i / 40) % 2 ? 0.8 : -1.2;
      if (p.position.y < 800) p.pitch = 0.9;
      if (i % 20 === 0) fire();
      if (i === 60 * 20) stall(3);
      step();
    });
  });
  // 3. Straight down for as long as there is height, then level with a rocket.
  leg('dive', () => {
    let pulled = false;
    seconds(120, (i) => {
      if (!pulled && p.position.y < 1500) {
        pulled = true;
        fire();
      }
      p.pitch = pulled ? 0.05 : -1.5;
      if (pulled && i % 40 === 0) fire();
      step();
    });
  });
  // 4. From thirty kilometres, sent there: dive and climb, and pump.
  leg('high', () => {
    sendTo(30000, true);
    seconds(31, () => { p.pitch = 0; step(); });
    seconds(120, (i) => {
      p.pitch = i < 200 ? -0.785 : Math.floor(i / 40) % 2 ? 0.8 : -1.2;
      if (p.position.y < 800) p.pitch = 0.9;
      if (i % 20 === 0) fire();
      if (i === 90 * 20) stall(6);
      step();
    });
  });
  // 5. Cruising in and out of a surge, with a dive inside one.
  leg('surge', () => {
    seconds(130, (i) => {
      const inCycle = i % (42 * 20);
      if (inCycle === 20) p.startSpeedMode();
      p.pitch = inCycle > 4 * 20 && inCycle < 7 * 20 ? -0.6 : 0.15;
      if (p.position.y < 800) p.pitch = 0.9;
      if (i % 40 === 0) fire();
      step();
    });
  });
  // 6. Down fast onto the ground and on at a run, with a jump and a knock.
  leg('land', () => {
    seconds(60, (i) => {
      if (!p.onGround) {
        p.pitch = p.position.y > 60 ? -0.5 : -0.05;
        if (i % 40 === 0 && p.position.y > 200) fire();
      }
      step({ forward: p.onGround, sprint: p.onGround, jump: p.onGround && i % 60 === 0 });
      if (p.onGround && i % 200 === 100) p.knock(9, 4, 0);
    });
  });

  const ok = corrections === 0 && !kicked && !me.dead && game.players.has(me.id);
  const line = `${ok ? 'nothing put back' : `${corrections} put back at ${putBack.slice(0, 6).join(', ')}`}`
    + `${kicked ? `; kicked: ${kicked}` : ''}; fastest honest ${Math.round(peak)} m/s`
    + `; legs ${legs.join(' ')}`;
  rmSync(dir, { recursive: true, force: true });
  return finish(ok, line);

  function finish(good, text) {
    console.log(JSON.stringify({ ok: good, line: text }));
    process.exit(good ? 0 : 1);
  }
}

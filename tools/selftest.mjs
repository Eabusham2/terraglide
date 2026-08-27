#!/usr/bin/env node
/**
 * Headless checks for the parts that are pure maths: projection round-trips, the
 * local frame, the glide model, the rocket boost, the climate curve and the
 * water classifier. No browser, no dependencies.
 *
 *   node tools/selftest.mjs
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { LocalFrame } from '../src/geo/frame.js';
import {
  bearing,
  destination,
  haversine,
  latToNormY,
  lonToNormX,
  normXToLon,
  normYToLat,
  quadKey,
  randomLatLon,
} from '../src/geo/mercator.js';
import { annualMeanC, climateAt } from '../src/geo/climate.js';
import { solarPosition } from '../src/geo/sun.js';
import { isWaterPixel } from '../src/geo/water.js';
import { stepGlide, stepRocket, rocketTicks, rocketPowerFor, rocketTopSpeed, TICK } from '../src/player/elytra.js';
import { Autopilot } from '../src/player/autopilot.js';
import { UNLOCK_CODE, cheats } from '../src/core/cheats.js';
import { resolvePlace } from '../src/ui/cheatPanel.js';
import {
  applyMatrix,
  boundingSphereOf,
  ecefToGeodetic,
  ecefToLocalMatrix,
  enuBasis,
  geodeticToEcef,
  screenSpaceError,
} from '../src/geo/ecef.js';

let failures = 0;
let checks = 0;

function ok(name, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`  ok    ${name}${detail ? '  (' + detail + ')' : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`);
  }
}

function near(a, b, tolerance) {
  return Math.abs(a - b) <= tolerance;
}

console.log('\nprojection');
{
  for (const [lat, lon] of [
    [0, 0],
    [51.5074, -0.1278],
    [-33.8688, 151.2093],
    [64.1466, -21.9426],
    [-54.8, -68.3],
  ]) {
    const backLat = normYToLat(latToNormY(lat));
    const backLon = normXToLon(lonToNormX(lon));
    ok(`round trip ${lat},${lon}`, near(backLat, lat, 1e-9) && near(backLon, lon, 1e-9));
  }
  ok('quadkey of 3/3/5', quadKey({ z: 3, x: 3, y: 5 }) === '213', quadKey({ z: 3, x: 3, y: 5 }));

  const london = { lat: 51.5074, lon: -0.1278 };
  const paris = { lat: 48.8566, lon: 2.3522 };
  const d = haversine(london, paris);
  ok('London to Paris ~344 km', near(d / 1000, 344, 6), `${(d / 1000).toFixed(1)} km`);
  ok('bearing London to Paris is south-east', bearing(london, paris) > 2.0 && bearing(london, paris) < 2.9);

  const moved = destination(london, Math.PI / 2, 10000);
  ok('destination 10 km east lands 10 km away', near(haversine(london, moved), 10000, 1));
}

console.log('\nlocal frame');
{
  const frame = new LocalFrame(46.56, 7.91);
  const origin = frame.toWorld(46.56, 7.91);
  ok('anchor is the origin', near(origin.x, 0, 1e-6) && near(origin.z, 0, 1e-6));

  const north = frame.toWorld(46.57, 7.91);
  ok('north is -Z', north.z < 0, `z=${north.z.toFixed(1)}`);
  const east = frame.toWorld(46.56, 7.92);
  ok('east is +X', east.x > 0, `x=${east.x.toFixed(1)}`);

  // One kilometre out, world metres should match real ground metres closely.
  const target = destination({ lat: 46.56, lon: 7.91 }, 1.1, 1000);
  const world = frame.toWorld(target.lat, target.lon);
  const worldDistance = Math.hypot(world.x, world.z);
  ok('1 km maps to ~1000 world units', near(worldDistance, 1000, 3), `${worldDistance.toFixed(1)}`);

  const back = frame.toGeo(world.x, world.z);
  ok('world -> geo round trip', near(back.lat, target.lat, 1e-7) && near(back.lon, target.lon, 1e-7));

  // Tiles must be exact squares in this frame — the whole point of using mercator.
  // Tile corners: x grows eastward, z grows southward (north edge is smaller z).
  const size = frame.worldTileSize(12);
  const a = frame.normToWorld(0.5, 0.4);
  const b = frame.normToWorld(0.5 + 1 / 4096, 0.4 + 1 / 4096);
  ok(
    'tile is square',
    near(b.x - a.x, size, 1e-3) && near(b.z - a.z, size, 1e-3),
    `${size.toFixed(1)} m, dx=${(b.x - a.x).toFixed(1)}, dz=${(b.z - a.z).toFixed(1)}`,
  );

  const antimeridian = new LocalFrame(0, 179.9);
  const across = antimeridian.toWorld(0, -179.9);
  ok('longitude wrap takes the short way', Math.abs(across.x) < 30000, `${(across.x / 1000).toFixed(1)} km`);
}

console.log('\nelytra flight model');
{
  const look = (pitch) => ({ x: 0, y: Math.sin(pitch), z: -Math.cos(pitch) });
  const cruising = () => ({ x: 0, y: 0, z: -38 });

  // A steady shallow dive builds to a sensible speed and settles there.
  const diving = { x: 0, y: 0, z: 0 };
  let drop = 0;
  let forward = 0;
  for (let tick = 0; tick < 300; tick++) {
    stepGlide(diving, look(-0.35), -0.35);
    drop -= diving.y * TICK;
    forward += Math.hypot(diving.x, diving.z) * TICK;
  }
  const speed = Math.hypot(diving.x, diving.y, diving.z);
  ok('dive reaches a sensible glide speed', speed > 25 && speed < 80, `${speed.toFixed(1)} m/s`);
  ok('glide ratio beats freefall', forward / drop > 1.2, `${(forward / drop).toFixed(2)} : 1`);

  // Gravity is never off. Look level and hold: you sink, always.
  const level = cruising();
  for (let tick = 0; tick < 400; tick++) stepGlide(level, look(0), 0);
  ok('level flight sinks — you cannot float', level.y < -1, `${level.y.toFixed(2)} m/s vertical`);
  ok('level flight keeps a useful speed', Math.hypot(level.x, level.z) > 15,
    `${Math.hypot(level.x, level.z).toFixed(1)} m/s forward`);

  // Flaring out of a dive buys real height — that is the whole technique.
  const fast = { x: 0, y: 0, z: 0 };
  for (let tick = 0; tick < 200; tick++) stepGlide(fast, look(-0.8), -0.8);
  const diveSpeed = Math.hypot(fast.x, fast.y, fast.z);
  let climbed = 0;
  for (let tick = 0; tick < 70; tick++) {
    stepGlide(fast, look(0.55), 0.55);
    climbed += fast.y * TICK;
  }
  ok('a dive builds real speed', diveSpeed > 50, `${diveSpeed.toFixed(0)} m/s`);
  ok('flaring converts speed into altitude', climbed > 25, `+${climbed.toFixed(0)} m`);

  // The invariant that matters here is the opposite of a perpetual motion
  // check, and deliberately so: a dive-and-flare cycle *has* to be able to end
  // higher than it started, or the 45/45 is not a technique, it is a story.
  // What keeps it honest is the pair of checks in "The 45/45" section — no
  // fixed angle may climb, and a hurried rhythm must still lose height.
  let bestCycle = -Infinity;
  let bestShape = '';
  for (const [dive, flare, diveTicks, flareTicks] of [
    [-0.5, 0.5, 40, 40], [-0.35, 0.35, 60, 60], [-0.7, 0.6, 30, 45], [-0.6, 0.45, 35, 50],
    [-0.9, 0.7, 25, 40], [-0.2, 0.2, 100, 100], [-0.8, 0.55, 20, 60], [-1.0, 0.8, 40, 40],
    [-0.3, 0.15, 90, 120], [-0.45, 0.55, 50, 50], [-0.15, 0.6, 120, 30], [-1.2, 0.9, 60, 60],
  ]) {
    const velocity = cruising();
    let altitude = 0;
    for (let tick = 0; tick < diveTicks; tick++) {
      stepGlide(velocity, look(dive), dive);
      altitude += velocity.y * TICK;
    }
    for (let tick = 0; tick < flareTicks; tick++) {
      stepGlide(velocity, look(flare), flare);
      altitude += velocity.y * TICK;
    }
    if (altitude > bestCycle) {
      bestCycle = altitude;
      bestShape = `${dive}/${flare}`;
    }
  }
  ok('a well-shaped dive-flare cycle ends higher than it started', bestCycle > 0,
    `best was +${bestCycle.toFixed(1)} m at ${bestShape}`);

  // Flown well it still goes a very long way.
  let best = 0;
  for (const pitch of [-0.05, -0.1, -0.15, -0.25]) {
    const velocity = cruising();
    let altitude = 1000;
    let distance = 0;
    let tick = 0;
    while (altitude > 0 && tick < 200000) {
      stepGlide(velocity, look(pitch), pitch);
      altitude += velocity.y * TICK;
      distance += Math.hypot(velocity.x, velocity.z) * TICK;
      tick++;
    }
    best = Math.max(best, distance / 1000);
  }
  // Kilometres of ground from a kilometre up, which is the glide ratio in the
  // units a player thinks in. Drag was raised to bring this down from a ten to
  // one cruise; it still has to be a long way, and it still has to end.
  ok('a good angle glides a long way', best > 4.5 && best < 12, `${best.toFixed(1)} km from 1 km up`);

  // Rockets accelerate along the look vector.
  const boosted = { x: 0, y: 0, z: -10 };
  const levelLook = { x: 0, y: 0, z: -1 };
  for (let tick = 0; tick < rocketTicks(3); tick++) stepRocket(boosted, levelLook, 1, tick / rocketTicks(3));
  ok('rocket boosts toward look direction', Math.hypot(boosted.x, boosted.y, boosted.z) > 25,
    `${Math.hypot(boosted.x, boosted.y, boosted.z).toFixed(1)} m/s`);
  // Minecraft's own lifetime formula: 10N + 6 ticks. This was briefly "the
  // number is the burn in seconds", because the label said so; matching
  // Minecraft is the instruction, and the label prints the real burn instead.
  for (const [duration, ticks] of [[1, 16], [2, 26], [3, 36], [4, 46], [5, 56]]) {
    ok(`rocket ${duration} burns for Minecraft's ${ticks} ticks`,
      rocketTicks(duration) === ticks, `${(ticks * TICK).toFixed(1)} s`);
  }
  // A bigger rocket pushes harder as well as longer, in exactly the proportion
  // its burn is longer. This is the one place the flight model departs from
  // Minecraft, and only because it was asked for: vanilla gives every firework
  // the same 1.5 blocks a tick, so a Rocket V there is a Rocket I that lasts
  // longer. Thrust is now `10N + 6` over Rocket I's sixteen, so slot one is
  // unchanged at vanilla's figure and the rest follow the durations exactly.
  ok('rocket I is still vanilla\u2019s own push', rocketPowerFor(1) === 1);
  for (const [duration, power] of [[2, 1.625], [3, 2.25], [4, 2.875], [5, 3.5]]) {
    ok(`rocket ${duration} pushes ${power}x, the same ratio as its burn`,
      Math.abs(rocketPowerFor(duration) - power) < 1e-9
      && Math.abs(rocketPowerFor(duration) - rocketTicks(duration) / rocketTicks(1)) < 1e-9);
  }

  // What that actually gets you, flown through the real tick. Each is slower
  // than its thrust ratio because drag rises with speed, and each is faster
  // than the one below it, which is the whole point of the change.
  {
    const speeds = [1, 2, 3, 4, 5].map((d) => rocketTopSpeed(d));
    ok('every rocket is faster than the one below it',
      speeds.every((v, i) => i === 0 || v > speeds[i - 1] + 5),
      speeds.map((v) => `${Math.round(v)} m/s`).join(' '));
    ok('rocket I still settles at Minecraft\u2019s 33 m/s',
      Math.abs(speeds[0] - 33.5) < 1);
    ok('and rocket V at about 107', Math.abs(speeds[4] - 107) < 2);
  }

  // Minecraft accelerates you toward 1.5 blocks/tick, which is 30 m/s. Held
  // level that is where a rocket settles you — the famous "elytra and rockets
  // cruise at about 33 m/s" figure, once the glide tick has had its say.
  {
    const fromRest = { x: 0, y: 0, z: 0 };
    const ticks = rocketTicks(3);
    for (let tick = 0; tick < ticks; tick++) {
      stepRocket(fromRest, levelLook, 1, tick / ticks);
      stepGlide(fromRest, levelLook, 0);
    }
    const reached = Math.hypot(fromRest.x, fromRest.y, fromRest.z);
    ok('rockets cruise at Minecraft\u2019s 33 m/s', near(reached, 33, 3), `${reached.toFixed(1)} m/s`);
  }

  // The push is flat for the whole burn, which is what Minecraft does; what
  // slows you afterwards is drag.
  {
    const early = { x: 0, y: 0, z: -20 };
    const late = { x: 0, y: 0, z: -20 };
    stepRocket(early, levelLook, 1, 0);
    stepRocket(late, levelLook, 1, 1);
    ok('the push does not fade across the burn',
      near(Math.hypot(early.x, early.z), Math.hypot(late.x, late.z), 0.001));
  }

  // A rocket pulls your speed *toward* its own from either direction. Fired
  // while already diving you slow down, which is not a bug: it is what 1.5
  // blocks a tick means when you are doing three and a half.
  {
    const fast = { x: 0, y: 0, z: -70 };
    const ticks = rocketTicks(3);
    for (let tick = 0; tick < ticks; tick++) stepRocket(fast, levelLook, 1, tick / ticks);
    ok('and firing one while faster than it slows you toward it',
      Math.hypot(fast.x, fast.z) < 70 && Math.hypot(fast.x, fast.z) > 25,
      `${Math.hypot(fast.x, fast.z).toFixed(0)} m/s`);
  }
}

console.log('\nclimate and sun');
{
  ok('equator annual mean is tropical', near(annualMeanC(0), 27.5, 1), `${annualMeanC(0).toFixed(1)} C`);
  ok('60 degrees is cold', annualMeanC(60) < 0 && annualMeanC(60) > -12, `${annualMeanC(60).toFixed(1)} C`);
  ok('poles are frozen', annualMeanC(90) < -15, `${annualMeanC(90).toFixed(1)} C`);

  const july = new Date(Date.UTC(2026, 6, 15));
  const january = new Date(Date.UTC(2026, 0, 15));
  const berlinSummer = climateAt({ lat: 52.52, elevationM: 34, date: july, landFraction: 0.8 });
  const berlinWinter = climateAt({ lat: 52.52, elevationM: 34, date: january, landFraction: 0.8 });
  ok('Berlin is warmer in July than January', berlinSummer.avgC > berlinWinter.avgC + 10,
    `${berlinSummer.avgC.toFixed(1)} vs ${berlinWinter.avgC.toFixed(1)} C`);
  ok('Berlin July reads as summer', berlinSummer.season === 'Summer');

  const sydneyJuly = climateAt({ lat: -33.87, date: july, landFraction: 0.5 });
  ok('southern hemisphere flips the season', sydneyJuly.season === 'Winter', sydneyJuly.season);

  const highAltitude = climateAt({ lat: 46.5, elevationM: 3000, date: july, landFraction: 0.8 });
  const valley = climateAt({ lat: 46.5, elevationM: 600, date: july, landFraction: 0.8 });
  ok('lapse rate cools the mountain', valley.avgC - highAltitude.avgC > 12,
    `${(valley.avgC - highAltitude.avgC).toFixed(1)} C colder`);

  const noon = solarPosition(new Date(Date.UTC(2026, 5, 21, 12, 0)), 51.5, 0);
  const midnight = solarPosition(new Date(Date.UTC(2026, 5, 21, 0, 0)), 51.5, 0);
  ok('sun is up at midsummer noon in London', noon.altitudeDeg > 55, `${noon.altitudeDeg.toFixed(1)} deg`);
  ok('sun is down at midnight', midnight.altitudeDeg < 0, `${midnight.altitudeDeg.toFixed(1)} deg`);
}

console.log('\nwater classifier');
{
  ok('deep ocean is water', isWaterPixel(18, 34, 62));
  ok('shallow sea is water', isWaterPixel(40, 92, 126));
  ok('map-style blue is water', isWaterPixel(170, 211, 223));
  ok('forest is not water', !isWaterPixel(56, 76, 52));
  ok('desert is not water', !isWaterPixel(178, 158, 120));
  ok('snow is not water', !isWaterPixel(232, 236, 240));
  ok('cloud is not water', !isWaterPixel(224, 226, 230));
  ok('city grey is not water', !isWaterPixel(120, 120, 124));
}

console.log('\nNothing is generated');
{
  const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  // The rule the whole project is judged on, checked mechanically rather than
  // by reading: there is no generator, nothing imports one, and no code path
  // paints a square nobody has surveyed.
  ok('the terrain generator is gone', !existsSync(new URL('../src/tiles/procedural.js', import.meta.url)));
  for (const file of [
    'tiles/elevation.js', 'tiles/streamer.js', 'tiles/tileJobs.js',
    'ui/mapTiles.js', 'geo/water.js',
  ]) {
    ok(`${file} does not reach for a generator`, !/procedural/i.test(read(file)));
  }
  const providers = read('tiles/providers.js');
  ok('no provider generates its own tiles', !/kind: 'synthetic'/.test(providers));
  ok('and none of them is offered as an offline world',
    !/id: 'offline'/.test(providers) && !/id: 'procedural'/.test(providers));
  const jobs = read('tiles/tileJobs.js');
  ok('a tile job with no URL is an error rather than an invitation',
    /no imagery URL for this tile/.test(jobs) && /no elevation URL for this tile/.test(jobs));
}

console.log('\ncheats');
{
  ok('locked to begin with', cheats.unlocked === false);
  ok('no cheat is active by default', cheats.active === false);

  // Letters on their own belong to the game, not to the code.
  ok('a stray letter is passed through', cheats.offerKey({ code: 'KeyT' }) === '');
  ok('backquote arms the code', cheats.offerKey({ code: 'Backquote' }) === 'consume');
  // Once armed the letters are swallowed, so typing the code cannot fire the
  // teleport and map keys that live on r, g, l and d.
  const eaten = [...'terraglid'].map((c) => cheats.offerKey({ code: `Key${c.toUpperCase()}` }));
  ok('the code eats its own keystrokes', eaten.every((r) => r === 'consume'), eaten.join(','));
  ok('the last letter unlocks', cheats.offerKey({ code: 'KeyE' }) === 'unlock');
  ok('typing the code unlocks', cheats.unlocked === true);

  cheats.set('gameSpeed', 999);
  ok('game speed is clamped', cheats.gameSpeed === 8, `${cheats.gameSpeed}x`);
  cheats.set('playerSpeed', -20);
  ok('player speed is clamped', cheats.playerSpeed === 0.1, `${cheats.playerSpeed}x`);
  cheats.set('nonsense', 5);
  ok('unknown dials are ignored', cheats.nonsense === undefined);
  cheats.toggle('fly');
  ok('fly toggles', cheats.fly === true);
  ok('active reports the change', cheats.active === true);
  ok('labels list what is on', cheats.labels.includes('fly'), cheats.labels.join(', '));

  // Locking is what a page reload does: every dial back to the default.
  cheats.lock();
  ok('locking puts everything back', !cheats.active && !cheats.unlocked && cheats.gameSpeed === 1);

  cheats.offerKey({ code: 'Backquote' });
  const typed = [...UNLOCK_CODE].map((c) => ({ code: `Key${c.toUpperCase()}` }));
  typed.splice(3, 1);
  const results = typed.map((event) => cheats.offerKey(event));
  ok('a mistyped code does not unlock', cheats.unlocked === false);
  ok('and gives the keys back once it breaks', results.slice(-3).every((r) => r === ''));
  ok('the chord unlocks', cheats.offerKey({ code: 'Backquote', ctrlKey: true, shiftKey: true }) === 'unlock');
  ok('backquote then opens the panel', cheats.offerKey({ code: 'Backquote' }) === 'panel');

  ok('coordinates resolve', resolvePlace('48.8566, 2.3522')?.lat === 48.8566);
  ok('a city name resolves', Math.round(resolvePlace('Reykjavik')?.lat ?? 0) === 64);
  ok('nonsense does not resolve', resolvePlace('qzqzqz') === null);
  ok('nothing does not resolve', resolvePlace('  ') === null);
}

console.log('\nauto-travel');
{
  // A stand-in player and a flat world: enough to check the steering laws.
  const player = {
    lat: 0,
    lon: 0,
    yaw: Math.PI, // facing due south, target is due east
    pitch: 0,
    position: { x: 0, y: 500, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    groundHeight: 0,
    onGround: false,
    elytraDeployed: true,
    horizontalSpeed: 30,
    rocketTicksLeft: 0,
    altitudeAboveGround: 500,
    toggleElytra(v) {
      this.elytraDeployed = v;
    },
  };
  const terrain = { heightAt: () => 0 };
  const notices = [];
  let rockets = 0;
  const auto = new Autopilot({
    player,
    terrain,
    fireRocket: () => rockets++,
    onNotice: (m) => notices.push(m),
  });
  const idle = { forward: false, back: false, left: false, right: false, jump: false };

  ok('idle until engaged', auto.active === false);
  auto.engage(0, 1, 'east'); // one degree of longitude east of 0,0
  ok('engages on a target', auto.active === true);

  for (let i = 0; i < 120; i++) auto.step(1 / 20, idle);
  const yawDegrees = ((auto.player.yaw * 180) / Math.PI + 360) % 360;
  ok('turns onto the bearing', near(yawDegrees, 90, 3), `${yawDegrees.toFixed(1)}°`);
  ok('holds a cruise height', auto.cruiseTarget() > 200, `${auto.cruiseTarget().toFixed(0)} m`);

  // Well below the cruise line it should climb, and spend rockets doing it.
  player.position.y = 20;
  player.altitudeAboveGround = 20;
  rockets = 0;
  for (let i = 0; i < 20; i++) auto.step(1 / 20, idle);
  ok('climbs when low', player.pitch > 0.1, `pitch ${player.pitch.toFixed(2)}`);
  ok('spends rockets to climb', rockets > 0, `${rockets} fired`);

  // Above it, the nose drops instead.
  player.position.y = 4000;
  for (let i = 0; i < 20; i++) auto.step(1 / 20, idle);
  ok('descends when high', player.pitch < 0, `pitch ${player.pitch.toFixed(2)}`);

  auto.step(1 / 20, { ...idle, forward: true });
  ok('a movement key cancels it', auto.active === false);
  ok('and says so', notices.some((n) => n.includes('cancelled')), notices.join(' | '));

  // Arriving: it stows the wings and hands the controls back.
  player.position.y = 30;
  player.altitudeAboveGround = 8;
  auto.engage(0, 0.0002, 'right here');
  auto.step(1 / 20, idle);
  ok('stows the wings on arrival', player.elytraDeployed === false);
  player.onGround = true;
  auto.step(1 / 20, idle);
  ok('lets go once you are down', auto.active === false);
}

console.log('\nearth-centred coordinates');
{
  // Known values: the equator on the prime meridian sits on the semi-major axis.
  const equator = geodeticToEcef(0, 0, 0);
  ok('0,0 is on the X axis at the equatorial radius',
    near(equator.x, 6378137, 0.5) && near(equator.y, 0, 1e-6) && near(equator.z, 0, 1e-6),
    `${equator.x.toFixed(0)} m`);

  const pole = geodeticToEcef(90, 0, 0);
  ok('the north pole is on Z at the polar radius', near(pole.z, 6356752.3, 1) && near(pole.x, 0, 1e-3),
    `${pole.z.toFixed(0)} m`);

  const east = geodeticToEcef(0, 90, 0);
  ok('90 east is on the Y axis', near(east.y, 6378137, 0.5) && near(east.x, 0, 1e-3));

  // Round trips, including somewhere with height.
  for (const [lat, lon, height] of [[51.5074, -0.1278, 0], [-33.8688, 151.2093, 120], [46.56, 7.91, 3400]]) {
    const ecef = geodeticToEcef(lat, lon, height);
    const back = ecefToGeodetic(ecef.x, ecef.y, ecef.z);
    ok(`ECEF round trip ${lat},${lon}`,
      near(back.lat, lat, 1e-7) && near(back.lon, lon, 1e-7) && near(back.height, height, 1e-3));
  }

  // The local basis has to be orthonormal or everything placed with it shears.
  const { east: e, north: n, up: u } = enuBasis(46.56, 7.91);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const len = (a) => Math.hypot(a.x, a.y, a.z);
  ok('the local basis is unit length', near(len(e), 1, 1e-12) && near(len(n), 1, 1e-12) && near(len(u), 1, 1e-12));
  ok('the local basis is orthogonal',
    near(dot(e, n), 0, 1e-12) && near(dot(e, u), 0, 1e-12) && near(dot(n, u), 0, 1e-12));

  // The matrix that moves real 3D tiles into the game's frame.
  const lat = 46.56;
  const lon = 7.91;
  const m = ecefToLocalMatrix(lat, lon, 0);
  const anchor = geodeticToEcef(lat, lon, 0);
  const atOrigin = applyMatrix(m, anchor.x, anchor.y, anchor.z);
  ok('the anchor lands on the origin',
    near(atOrigin.x, 0, 1e-6) && near(atOrigin.y, 0, 1e-6) && near(atOrigin.z, 0, 1e-6));

  const up = geodeticToEcef(lat, lon, 1000);
  const above = applyMatrix(m, up.x, up.y, up.z);
  ok('1 km of height maps to +1000 on Y', near(above.y, 1000, 1e-3), `${above.y.toFixed(3)}`);

  const northOf = geodeticToEcef(lat + 0.01, lon, 0);
  const northLocal = applyMatrix(m, northOf.x, northOf.y, northOf.z);
  ok('north maps to -Z, as the game expects', northLocal.z < -1000 && northLocal.z > -1200,
    `z=${northLocal.z.toFixed(0)}`);

  const eastOf = geodeticToEcef(lat, lon + 0.01, 0);
  const eastLocal = applyMatrix(m, eastOf.x, eastOf.y, eastOf.z);
  ok('east maps to +X', eastLocal.x > 700 && eastLocal.x < 800, `x=${eastLocal.x.toFixed(0)}`);

  // Distances have to survive the move, or tiles land in the wrong place.
  const a = geodeticToEcef(46.56, 7.91, 0);
  const b = geodeticToEcef(46.57, 7.92, 250);
  const ecefDistance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const la = applyMatrix(m, a.x, a.y, a.z);
  const lb = applyMatrix(m, b.x, b.y, b.z);
  const localDistance = Math.hypot(la.x - lb.x, la.y - lb.y, la.z - lb.z);
  ok('the transform is rigid — distances are preserved', near(ecefDistance, localDistance, 1e-6),
    `${ecefDistance.toFixed(3)} vs ${localDistance.toFixed(3)}`);

  // Bounding volumes, in all three shapes the 3D Tiles spec allows.
  const sphere = boundingSphereOf({ sphere: [1, 2, 3, 40] });
  ok('a sphere volume is read', sphere.radius === 40 && sphere.x === 1);
  const box = boundingSphereOf({ box: [0, 0, 0, 10, 0, 0, 0, 20, 0, 0, 0, 30] });
  ok('a box volume encloses its diagonal', near(box.radius, Math.hypot(10, 20, 30), 1e-9));
  const region = boundingSphereOf({ region: [0.1, 0.8, 0.11, 0.81, 0, 200] });
  ok('a region volume gets a centre and radius', region !== null && region.radius > 0);
  ok('an unknown volume is refused', boundingSphereOf({ nonsense: true }) === null);
  ok('a missing volume is refused', boundingSphereOf(undefined) === null);

  // Screen-space error: the number the tile tree refines on.
  const closeUp = screenSpaceError(100, 100, 900, 1.2);
  const farAway = screenSpaceError(100, 10000, 900, 1.2);
  ok('closer tiles show more error', closeUp > farAway * 50, `${closeUp.toFixed(0)} vs ${farAway.toFixed(1)}`);
  ok('a perfect tile has no error', screenSpaceError(0, 100, 900, 1.2) === 0);
}

// ---------------------------------------------------------------------------
console.log('\nThe body you can see');
{
  // The avatar is the one piece of three.js code worth checking without a
  // browser: its orientation bugs are the ones that got shipped twice — facing
  // backwards, and gliding upside down — and they are pure arithmetic.
  const THREE = await import('../vendor/three/three.module.js');
  const { Avatar } = await import('../src/player/avatar.js');

  const scene = new THREE.Scene();
  const avatar = new Avatar(scene);
  avatar.setVisible(true);

  /** A stand-in player. Nothing here needs the real one. */
  const makePlayer = (over = {}) => ({
    position: new THREE.Vector3(),
    renderPosition: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    height: 1.7, scale: 1, pitch: 0, yaw: 0,
    mode: 'walk', onGround: true, swimming: false,
    elytraDeployed: false, horizontalSpeed: 0,
    ...over,
  });
  /** Run the avatar to a steady state. */
  const settle = (player, frames = 240) => {
    for (let i = 0; i < frames; i++) avatar.update(player, 1 / 60);
    scene.updateMatrixWorld(true);
  };
  const worldDir = (object, local) =>
    local.clone().applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion()));
  const lookVector = (yaw, pitch) =>
    new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch),
    );

  // The head/body split: shoulders lag, then stop at the limit.
  {
    const player = makePlayer({ yaw: 0 });
    settle(player);
    player.yaw = Math.PI / 2;
    avatar.update(player, 1 / 60);
    ok('the shoulders lag a sharp turn rather than snapping', Math.abs(avatar.bodyYaw) < 0.2,
      `${avatar.bodyYaw.toFixed(3)} rad after one frame`);
    settle(player);
    const twist = Math.abs(Math.PI / 2 - avatar.bodyYaw);
    ok('and settle exactly one neck-twist behind', near(twist, 0.87, 0.05), `${twist.toFixed(3)} rad`);
  }

  // Walking leads with the direction of travel; reversing must not spin you.
  {
    const walk = (vx, vz) => {
      const player = makePlayer({ yaw: 0, velocity: new THREE.Vector3(vx, 0, vz) });
      player.horizontalSpeed = Math.hypot(vx, vz);
      avatar.bodyYaw = 0;
      settle(player);
      return (avatar.bodyYaw * 180) / Math.PI;
    };
    ok('walking forward keeps the shoulders square', near(walk(0, -5), 0, 1));
    ok('strafing right turns them right', near(walk(5, 0), 50, 2), `${walk(5, 0).toFixed(0)}°`);
    ok('strafing left turns them left', near(walk(-5, 0), -50, 2));
    ok('walking backwards does not spin you round', near(walk(0, 5), 0, 1), `${walk(0, 5).toFixed(0)}°`);
  }

  // The head faces where you look, whatever the shoulders are doing.
  {
    let worst = 1;
    for (const yaw of [0, 1.1, 2.4, -2.0, 3.0]) {
      const player = makePlayer({ yaw });
      avatar.bodyYaw = 0;
      settle(player);
      worst = Math.min(worst, worldDir(avatar.head, new THREE.Vector3(0, 0, -1)).dot(lookVector(yaw, 0)));
    }
    ok('the head always faces where you look', worst > 0.99, `worst alignment ${worst.toFixed(3)}`);
  }

  // First person draws the whole body and puts the camera where the eyes are,
  // which is in front of the spine. That lean is what keeps the chest out of
  // your face; get it wrong and glancing down is a wall of jacket.
  {
    const player = makePlayer();
    avatar.setFirstPerson(true);
    settle(player);
    const rig = readFileSync(new URL('../src/camera/cameraRig.js', import.meta.url), 'utf8');
    const lean = Number(/const EYE_FORWARD = ([\d.]+)/.exec(rig)?.[1]);
    const torsoHalfDepth = 0.15 / 2;
    ok('the camera leans out to where a face is', lean > torsoHalfDepth,
      `${lean} of height, chest front at ${torsoHalfDepth}`);
    // ...but only just, and this is the number that decides whether looking
    // down finds a body. The chest top sits 0.13 of a height below the eye and
    // its front face 0.075 in front of the spine, so the angle at which the
    // chest enters the view is atan(0.13 / (lean - 0.075)) below horizontal —
    // and with a vertical field of view of 78 degrees the bottom of the frame
    // is only 39 degrees below wherever you are pointing. Lean too far and
    // that angle goes past ninety: the chest is *behind* the camera and no
    // amount of looking down will find it, which is what used to happen.
    const chestAngle = (Math.atan2(0.94 - 0.81, lean - torsoHalfDepth) * 180) / Math.PI;
    ok('and close enough that glancing down finds your chest', chestAngle < 80,
      `chest enters the view ${chestAngle.toFixed(0)}\u00b0 below level`);
    ok('and not so far that your feet are behind you', lean < 0.25, `${lean}`);
    ok('the body itself stays where the body is', Math.abs(avatar.body.position.z) < 0.01,
      avatar.body.position.z.toFixed(3));

    // The whole body, minus the head you are looking out of. This is the
    // thing the mod does and the thing that was wrong before: a pair of
    // floating boots is not a first-person body.
    ok('the chest is drawn', avatar.torso.visible);
    ok('both arms are drawn', avatar.armL.pivot.visible && avatar.armR.pivot.visible);
    ok('the legs are drawn', avatar.legL.pivot.visible && avatar.legR.pivot.visible);
    ok('the head is not, because you are inside it', !avatar.head.visible);
    ok('and there is no second arm floating in the corner', !avatar.viewModel.visible);

    avatar.setFirstPerson(false);
    settle(player);
    ok('third person puts the model back on the spot',
      Math.abs(avatar.body.position.z) < 0.01, avatar.body.position.z.toFixed(3));
  }

  // Upright on the ground, along the flight path in the air, never inverted.
  {
    let worstUp = 1;
    for (const pitch of [-0.8, -0.3, 0, 0.3, 0.8]) {
      const player = makePlayer({ yaw: 0.6, pitch });
      settle(player);
      worstUp = Math.min(worstUp, worldDir(avatar.body, new THREE.Vector3(0, 1, 0)).y);
    }
    ok('standing, the body stays the right way up', worstUp > 0.9, `worst up.y ${worstUp.toFixed(2)}`);

    let worstAlign = 1;
    for (const pitch of [-0.9, -0.4, 0, 0.4, 0.9]) {
      const player = makePlayer({
        yaw: 0.6, pitch, mode: 'glide', onGround: false,
        velocity: new THREE.Vector3(0, -8, -20), elytraDeployed: true,
      });
      settle(player);
      // The body's own long axis must lie along the flight path — that is the
      // check that would have caught the character gliding upside down.
      const axis = worldDir(avatar.body, new THREE.Vector3(0, 1, 0));
      worstAlign = Math.min(worstAlign, axis.dot(lookVector(0.6, pitch)));
    }
    ok('gliding, the body lies along the flight path and never inverts',
      worstAlign > 0.99, `worst alignment ${worstAlign.toFixed(3)}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\nReal data first, invention last');
{
  // The project's rule, as something a machine can check: what stands in the
  // world comes from provider data or from the imagery, and the generated
  // parts are confined to the generated world or to a stated fallback.
  const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

  const buildings = read('world/buildings.js');
  ok('buildings take their colour from the photograph',
    /sampleImageryAt\(this\.frame/.test(buildings));
  ok('and the invented grey is only a placeholder',
    /placeholder|not arrived/.test(buildings));

  // Scenery is gone. The trees, scrub and rock were generated shapes on a
  // hashed grid, planted wherever a survey — or, failing that, the colour of a
  // pixel — suggested vegetation. Over Kansas farmland that is a forest to the
  // horizon, and the grid it stands on is the pattern you could see through it.
  // The photograph already shows the trees that are there.
  ok('there is no generated scenery left to plant',
    !existsSync(new URL('../src/world/scatter.js', import.meta.url)) &&
    !existsSync(new URL('../src/world/landclass.js', import.meta.url)));
  ok('and nothing still asks for it',
    !/Scatter|scatter\./.test(read('game.js')) && !/scenery/.test(read('core/settings.js')));

  // Unmeasured ground reads as sea level and says so. It used to read as
  // invented relief, which is a different and much worse kind of wrong.
  const elevation = read('tiles/elevation.js');
  ok('unmeasured ground is flat and honest about it',
    /Nothing loaded here yet, and nothing to be done about it/.test(elevation) &&
    !/proceduralElevation/.test(elevation));
  const streamer = read('tiles/streamer.js');
  ok('a tile no provider will serve stays bare rather than being painted',
    /if \(url === null\) \{\s*\n\s*entry\.state = STATE_BARE;/.test(streamer));
  ok('and every provider is asked before it gives up',
    /attempt <= this\.standbys\.length/.test(streamer));
  ok('the terrain is never hidden wholesale for photogrammetry',
    /this\.terrain\.group\.visible = true;/.test(read('game.js')) &&
    !/terrain\.group\.visible = !photoreal/.test(read('game.js')));
  ok('and steps aside one square at a time instead',
    /this\.covered3d\(\(x0 \+ x1\) \/ 2, \(z0 \+ z1\) \/ 2\)\) return;/.test(read('world/terrain.js')));
  ok('and the ground you are looking at is asked for first',
    /this\.draw\(tile, x0, z0, size, this\.viewDistance\(/.test(read('world/terrain.js')));
  ok('and the ground falls through to a standby before it gives up',
    /setStandbys\(/.test(read('game.js')));
  const shaderSrc = read('world/shaders.js');
  ok('ground with no photograph yet is neutral, not a guessed biome',
    /groundNotLoaded/.test(shaderSrc) &&
    !/vec3 arid|vec3 sand|vec3 grass|vec3 forest/.test(shaderSrc));
  ok('and there is no invented pattern printed over the real imagery',
    !/detailNoise/.test(shaderSrc));

  // Photogrammetry, where a key allows it, replaces all of the above.
  const game = read('game.js');
  ok('real 3D tiles take precedence over the extruded footprints',
    /photoreal[\s\S]{0,160}buildings\.setVisible/.test(game));
}

// ---------------------------------------------------------------------------
console.log('\nInfrastructure from OpenStreetMap');
{
  const source = readFileSync(new URL('../src/world/buildings.js', import.meta.url), 'utf8');
  // Structures are what make a skyline read: bridges, masts, chimneys,
  // turbines. Google Earth's 3D is convincing largely because it has them.
  for (const kind of ['bridge', 'chimney', 'water_tower', 'silo', 'gasometer']) {
    ok(`${kind} is asked for`, source.includes(kind));
  }
  ok('pylons and turbines are asked for', /power.*tower|generator/.test(source));

  // Only things with height get geometry. A road at ground level is already in
  // the satellite image draped on the terrain, so drawing a ribbon on top
  // re-draws it — and OSM's centreline never lines up exactly with the road in
  // the photograph, so you would see two roads slightly apart.
  ok('ordinary roads are left to the imagery',
    !/highway.*motorway\|trunk|highway"~/.test(source));
  ok('only bridges are asked for', /way\["highway"\]\["bridge"\]/.test(source));
  ok('and only bridges are collected',
    /element\.tags\.highway && element\.tags\.bridge/.test(source));
  ok('in the same Overpass request as the buildings',
    (source.match(/overpass\.query/g) ?? []).length === 1);
  ok('a tagged width beats the class default',
    /Number\(tags\.width\)[\s\S]{0,80}ROAD_WIDTH_M/.test(source));
  ok('lane count is used where width is not', /lanes \* 3\.1/.test(source));
  ok('the deck is lifted by its OSM layer', /Number\(tags\.layer\)[\s\S]{0,60}LAYER_HEIGHT_M/.test(source));
  ok('and has an underside', /DECK_THICKNESS_M/.test(source));
  // isStructure() claimed anything tagged `bridge`, and ran first — so every
  // viaduct was extruded as a block of flats and the deck path never saw it.
  ok('a highway on a bridge is a deck, not a building',
    /function isStructure[\s\S]{0,400}tags\.highway\) return false/.test(source));
  ok('deck colour comes from the photograph',
    /emitBridgeDeck[\s\S]{0,900}sampleImageryAt/.test(source));

  // Nodes are both way vertices and structures in their own right. Collecting
  // them with an `else` made the mast branch unreachable and silently dropped
  // every one of them, so the loop must not be an if/else chain over type.
  ok('a tagged node can be both a vertex and a structure',
    !/if \(element\.type === 'node'\) nodes\.set[\s\S]{0,80}else if \(element\.type === 'node'/.test(source));

  // A measured height must win over the estimate for its kind, and the two
  // must be distinguishable — an estimated height is an estimate of a real
  // structure's real height, but the player is entitled to know which is which.
  ok('a measured height wins over the estimate',
    /const measured = Number\(tags\.height\)/.test(source)
      && /clamp\(measured \|\| MAST_HEIGHT_M/.test(source));
  ok('buildings distinguish measured from estimated',
    /const measured = taggedHeight > 0 \|\| taggedLevels > 0/.test(source));
  ok('and the split is counted', /stats\.measured/.test(source) && /stats\.estimated/.test(source));
  ok('nothing is raised on a guessed height at all',
    /const STRUCTURES_NEED_HEIGHT = true/.test(source) &&
    /if \(!measured\) return null;/.test(source));
  ok('and the readout says how much was measured',
    /status\(\) \{[\s\S]{0,600}% measured/.test(source));
}

// ---------------------------------------------------------------------------
console.log('\nThe HUD fits the window');
{
  // Five 118px slots plus gaps is a shade over 600px, centred, with the
  // location panel and the attribution in the bottom corners on the same row.
  // Below about 1180px those three collide and the hotbar's panel background
  // covers the text under it — measured at 900x620, which is an ordinary
  // Chromebook split window, not a corner case.
  const css = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8');
  ok('the corners step above the hotbar on a narrow window',
    /@media \(max-width: 1180px\)[\s\S]{0,220}hud-bottomright[\s\S]{0,80}bottom:/.test(css));
  // Not a fixed breakpoint: the numbers have to agree with each other. Five
  // slots and their gaps must fit inside the window at which the labels are
  // still being shown, or the bar overflows the screen for a band of widths.
  // They did not — the slot grew from 118px to 134px to fit a burn time and a
  // real top speed, and the breakpoint stayed at 660.
  const slotWidth = Number(/\.hud-hotbar \.slot \{[\s\S]{0,400}?width: (\d+)px/.exec(css)?.[1]);
  const barGap = Number(/\.hud-hotbar \{[\s\S]{0,200}?gap: (\d+)px/.exec(css)?.[1]);
  const shedAt = Number(
    /@media \(max-width: (\d+)px\)[\s\S]{0,320}?slot-label[\s\S]{0,80}?display: none/.exec(css)?.[1],
  );
  ok('and the hotbar itself sheds width before it overflows',
    Number.isFinite(slotWidth) && Number.isFinite(barGap) && Number.isFinite(shedAt)
      && slotWidth * 5 + barGap * 4 <= shedAt);

  // A touch screen shrinks the slot to 74px, which is an icon and a keycap
  // wide. The name and the burn-and-speed line were left in it and truncated
  // mid-word; on a touch screen you pick a rocket by its colour.
  ok('and a touch-sized slot drops them too',
    /body\.touch-active \.hud-hotbar \.slot \.slot-label[\s\S]{0,120}display: none/.test(css));

  // The touch hotbar used to run across the top, where the minimap is. On a
  // 390x844 phone the two overlapped by 133x44px, which hid rockets four and
  // five completely — they could not be selected at all — and at 360 wide the
  // bar ran eleven pixels off the left edge as well.
  ok('the touch hotbar sits above the controls, not across the minimap',
    /body\.touch-active \.hud-hotbar \{[\s\S]{0,160}bottom: 182px/.test(css));
  ok('and five slots are sized to the window rather than to a fixed width',
    /body\.touch-active \.hud-hotbar \.slot \{[\s\S]{0,120}width: min\(74px, calc\(\(100vw - 28px\) \/ 5\)\)/.test(css));

  // A phone on its side is 390px tall and the four things wanting the left
  // edge came to 431px of content, so they overlapped instead of overflowing:
  // the location panel sat on the toolbar, 282x91px of collision.
  ok('a short window shrinks what wants the left edge',
    /@media \(max-height: 460px\)[\s\S]{0,1400}\.location-figures[\s\S]{0,60}display: none/.test(css));
  ok('and brings the controls down with it',
    /@media \(max-height: 460px\)[\s\S]{0,1400}\.touch-stick \{[\s\S]{0,120}height: 92px/.test(css));

  // The licence requires the provider credits to stay on screen, and pale grey
  // text with nothing behind it is not on screen over pale ground.
  ok('the provider credits stay legible over any ground',
    /\.hud-bottomright \{[\s\S]{0,700}text-shadow:/.test(css));

  // The slot label has to fit the slot and has to be true. It read
  // "dur 5 - pwr 5", which was neither, then "5s", which was not the burn,
  // then the burn alone — which was true but only half of what a rocket is now
  // that a bigger one pushes harder too. It carries both, and the speed is
  // measured by flying the real tick rather than quoted, so it cannot drift
  // away from the physics.
  const player = readFileSync(new URL('../src/player/player.js', import.meta.url), 'utf8');
  const hud = readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
  ok('the slot carries the real burn and the real top speed',
    /burnSeconds: rocketTicks\(duration\) \/ 20,/.test(player)
    && /topSpeed: rocketTopSpeed\(duration\),/.test(player));
  ok('and the HUD prints them in the units the player chose',
    /formatSpeed\(item\.topSpeed, settings\.get\('units'\)\)/.test(hud));
}

// ---------------------------------------------------------------------------
console.log('\nProviders and detail budgets');
{
  const { IMAGERY_PROVIDERS } = await import('../src/tiles/providers.js');
  const { DEFAULT_SETTINGS: DEFAULTS } = await import('../src/core/settings.js');

  // Azure is Microsoft's current imagery, and the place Bing is being retired
  // to. It is imagery only — the 3D option deliberately does not offer it.
  const azure = IMAGERY_PROVIDERS.find((p) => p.id === 'azure');
  ok('Azure Maps is offered for imagery', !!azure);
  ok('and it is keyed', azure?.needsKey === 'azureKey');
  ok('and it carries attribution', /Microsoft/.test(azure?.attribution ?? ''));
  ok('a key setting exists for it', 'azureKey' in DEFAULTS);

  // Every keyed provider must name a setting that actually exists, or the
  // panel offers a provider nobody can ever supply a key for.
  const missing = IMAGERY_PROVIDERS
    .filter((p) => p.needsKey && !(p.needsKey in DEFAULTS))
    .map((p) => p.id);
  ok('every keyed provider names a real setting', missing.length === 0, missing.join(', '));

  // Nothing may be drawn on screen without saying whose it is. That is the
  // licence's condition and every provider's own, so it is checked rather
  // than remembered.
  const unattributed = IMAGERY_PROVIDERS
    .filter((p) => p.kind !== 'synthetic' && !(p.attribution ?? '').trim())
    .map((p) => p.id);
  ok('every provider carries attribution', unattributed.length === 0, unattributed.join(', '));

  const byId = Object.fromEntries(IMAGERY_PROVIDERS.map((p) => [p.id, p]));
  // The point of the keyless additions: a good flight map with no account at
  // all, and a second one anywhere the first has nothing.
  for (const id of ['esri', 'sentinel2', 'usgs', 'gibs']) {
    ok(`${id} is offered without a key`, byId[id] && byId[id].needsKey === null);
  }
  ok('exactly one provider is the recommended one',
    IMAGERY_PROVIDERS.filter((p) => p.recommended).length === 1);
  ok('and it needs no key',
    IMAGERY_PROVIDERS.find((p) => p.recommended)?.needsKey === null);

  // Drawn maps are not flight imagery: a street map draped over terrain looks
  // like a mistake, so they are offered to the flat maps only.
  for (const id of ['esri-street', 'openfreemap']) {
    ok(`${id} is kept out of the flight-imagery menu`, byId[id]?.hidden === true);
  }

  // NASA's near-real-time products lag the pass, and a date that has not
  // finished processing answers with a transparent tile — a hole in the world
  // rather than an error. The template is dated a few days back for that.
  const { gibsDate } = await import('../src/tiles/providers.js');
  // The streamer calls prepare() for every queued tile whose source is not
  // ready — every tile on screen, every frame. A handshake that failed used to
  // be retried on every one of those, so a Google key that cannot open a
  // session hammered a metered endpoint for as long as the game was open.
  const providerSrc = readFileSync(new URL('../src/tiles/providers.js', import.meta.url), 'utf8');
  ok('a failed handshake waits before it is tried again',
    /if \(this\.state === 'error' && Date\.now\(\) < \(this\.retryAt \?\? 0\)\) return;/.test(providerSrc));
  ok('and the wait doubles, capped at a minute',
    /Math\.min\(60000, 2000 \* Math\.pow\(2, this\.handshakeFailures - 1\)\)/.test(providerSrc));
  ok('and resets as soon as one succeeds',
    /this\.handshakeFailures = 0;/.test(providerSrc));

  // tile.openstreetmap.org answers a browser on a third-party site with HTTP
  // 200 and a picture reading "Access blocked", which is worse than an error
  // because the game would draw it. It is not in the list at all.
  ok('OpenStreetMap raster tiles are not fetched', byId.osm === undefined);

  ok('the GIBS template carries a date', /\{date\}/.test(byId.gibs?.template ?? ''));
  const lag = (Date.now() - Date.parse(`${gibsDate()}T00:00:00Z`)) / 86400000;
  ok('and the date asked for is safely in the past', lag >= 2.5 && lag <= 4.5, `${lag.toFixed(1)} days`);

  // The vector provider hands over geometry; only the flat maps can draw it.
  ok('OpenFreeMap decodes as vector', byId.openfreemap?.kind === 'openmaptiles');
  const providerSource = readFileSync(new URL('../src/tiles/providers.js', import.meta.url), 'utf8');
  ok('and the worker is told so', /kind === 'openmaptiles'\) return 'vector'/.test(providerSource));
  ok('its tile template is fetched rather than hard-coded',
    /prepareOpenMapTiles/.test(providerSource) && !/openfreemap\.org\/planet\/\d/.test(providerSource));

  // The detail dial has to be monotonic or the labels lie: lower detail must
  // mean a looser error target and a smaller memory ceiling, every step.
  const source = readFileSync(new URL('../src/world/tiles3d.js', import.meta.url), 'utf8');
  ok('the 3D detail budgets are wired to the setting', /world3dDetail/.test(source));
  ok('and nothing still reads a fixed budget', !/MAX_SSE|MAX_LOADED|MAX_ACTIVE/.test(source));
  const tiers = [...source.matchAll(/(low|medium|high|ultra): \{ sse: (\d+), loaded: (\d+)/g)]
    .map(([, name, sse, loaded]) => ({ name, sse: +sse, loaded: +loaded }));
  ok('all four detail tiers are defined', tiers.length === 4, tiers.map((t) => t.name).join(', '));
  let monotonic = true;
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].sse >= tiers[i - 1].sse || tiers[i].loaded <= tiers[i - 1].loaded) monotonic = false;
  }
  ok('and they get steadily heavier', monotonic,
    tiers.map((t) => `${t.name} sse${t.sse}/${t.loaded}`).join(' '));
  ok('the default detail is a real tier',
    tiers.some((t) => t.name === DEFAULTS.world3dDetail));
}

// ---------------------------------------------------------------------------
console.log('\nThe imagery goes as deep as it is actually flown, per square');
{
  const { IMAGERY_PROVIDERS } = await import('../src/tiles/providers.js');
  const esri = IMAGERY_PROVIDERS.find((p) => p.id === 'esri');
  const { SHARPNESS_FLOOR, SHARPNESS_RATIO, SHARPNESS_FROM_ZOOM, measureSharpness } =
    await import('../src/tiles/sharpness.js');

  // Nineteen is Esri's global guarantee, not their ceiling, and twenty was the
  // next guess. No single number works: measured per-pixel contrast down the
  // levels, twenty-one is real over Vienna (x0.75) and a resample on the
  // Jungfrau (x0.32). Pick the city's number and every valley pays sixteen
  // requests a square for a blur; pick the valley's and the city stays a smear.
  ok('the published maximum is a stop, not a coverage claim', esri.maxZoom >= 22);

  // Because the depth is measured per square instead.
  ok('a resample is told from a real level by how much contrast it keeps',
    SHARPNESS_RATIO > 0.35 && SHARPNESS_RATIO < 0.55);
  ok('and featureless ground is not descended into at all', SHARPNESS_FLOOR > 0);
  // A verdict on a tile covering a thousand kilometres would stop the quadtree
  // subdividing anywhere inside it — one at zoom 1 blocked the whole planet
  // and the Meseta drew zoom 5 and loaded nothing.
  ok('and the question is only asked where it means anything',
    SHARPNESS_FROM_ZOOM >= 14);

  // The measurement itself has to survive being handed nothing.
  ok('an unmeasurable tile has no opinion rather than a wrong one',
    measureSharpness(null, () => null) === 0
    && measureSharpness({ width: 4, height: 4 }, () => null) === 0);

  const streamer = readFileSync(new URL('../src/tiles/streamer.js', import.meta.url), 'utf8');
  ok('the streamer records what each tile carried',
    /noteSharpness\(entry\.tile, msg\.sharpness\)/.test(streamer));
  ok('and the quadtree stops where there is nothing finer for that square',
    /atFinest\(tile\)/.test(streamer)
    && /!this\.streamer\.atFinest\(tile\)/.test(
      readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8')));
  ok('the verdict is inherited by everything under it',
    /while \(z >= SHARPNESS_FROM_ZOOM\)/.test(streamer));
  ok('a square nobody has flown is written off rather than re-asked',
    /this\.barren\.add\(entry\.key\)/.test(streamer));
  ok('and a level a whole region lacks pulls the depth back',
    /reviewDepth\(z\)/.test(streamer));
}

// ---------------------------------------------------------------------------
console.log('\nThe snow line is a property of the place, not of your altitude');
{
  const { snowLineM, climateAt } = await import('../src/geo/climate.js');
  const august = new Date(Date.UTC(2025, 7, 15));

  // The 155 in snowLineM is 1000 / 6.5 — the environmental lapse rate turned
  // round — so it wants the sea-level average. It was being handed the average
  // at the ground under your feet, which already has the lapse rate in it, so
  // the rate went in twice and the answer moved with the camera.
  const valley = climateAt({ lat: 46.54, elevationM: 800, date: august });
  const massif = climateAt({ lat: 46.54, elevationM: 3970, date: august });
  ok('two heights in one place give one sea-level average',
    Math.abs(valley.seaLevelAvgC - massif.seaLevelAvgC) < 0.001);
  ok('and so one snow line, wherever you are standing',
    snowLineM(valley.seaLevelAvgC) === snowLineM(massif.seaLevelAvgC));
  ok('which is not what the old input did',
    Math.abs(snowLineM(valley.avgC) - snowLineM(massif.avgC)) > 1000,
    `${Math.round(snowLineM(valley.avgC))} m vs ${Math.round(snowLineM(massif.avgC))} m`);

  // And the number itself has to be about right, or the tint is in the wrong
  // place however stable it is. August in the Alps: the real snow line runs
  // around three thousand metres.
  const alpine = snowLineM(massif.seaLevelAvgC);
  ok('August in the Alps puts it near three thousand metres',
    alpine > 2400 && alpine < 3800, `${Math.round(alpine)} m`);
  // Standing high used to collapse it to the clamp, which painted 45% flat
  // white over every piece of flat ground above 600 m in view.
  ok('and standing on the massif no longer collapses it to the floor',
    snowLineM(massif.seaLevelAvgC) > -400);

  const sky = readFileSync(new URL('../src/world/sky.js', import.meta.url), 'utf8');
  ok('the sky feeds it the sea-level average',
    /snowLineM\(this\.climate\.seaLevelAvgC\)/.test(sky));
}

// ---------------------------------------------------------------------------
console.log('\nA wood reads as a canopy');
{
  const wood = readFileSync(new URL('../src/world/woodland.js', import.meta.url), 'utf8');
  const shaders = readFileSync(new URL('../src/world/shaders.js', import.meta.url), 'utf8');
  const wiring = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');

  // Where, from the survey and only from the survey. The photograph cannot
  // say: scored over six Esri tiles, Cambridgeshire farmland is greener and
  // rougher at crown scale than the Amazon is.
  ok('the mask comes from the OpenStreetMap survey',
    /way\["natural"="wood"\]/.test(wood) && /way\["landuse"="forest"\]/.test(wood));
  ok('and relations are read, outer rings only',
    /member\.role !== 'outer'/.test(wood));
  ok('through the same queue the buildings use, so Overpass is asked once',
    /import \{ overpass \}/.test(wood) && /overpass\.inflight/.test(wood));
  ok('a refusal leaves nothing drawn and is retried, not cached as a hole',
    /state = 'failed'/.test(wood) && /this\.tiles\.delete\(key\)/.test(wood));

  // No geometry. Both earlier attempts built some and both measured worse.
  ok('nothing is built and no mesh is added',
    !/new THREE\.Mesh/.test(wood) && !/scene\.add/.test(wood));
  ok('the leaf type rides in the mask so one sample answers both',
    /LEAF_WEIGHT/.test(wood) && /needleleaved: 0\.82/.test(wood));

  ok('the ground shader reads it at the photograph\u2019s own resolution',
    /uniform sampler2D uWoodMask/.test(shaders) && /float canopyField\(vec2 world\)/.test(shaders));
  ok('and does nothing at all where nothing is mapped',
    /float wood = 0\.0;/.test(shaders) && /if \(uHasWood > 0\.5\)/.test(shaders)
    && /uWoodMask: \{ value: BLACK_PIXEL \}/.test(shaders));
  ok('crowns are shaded, not stood up \u2014 the ground does not move',
    !/uWood[\s\S]{0,400}position\.y/.test(shaders));
  ok('the scanned world is left alone, and so is Overpass',
    /this\.woodland\.enabled = !photoreal && settings\.get\('woodlandRelief'\)/.test(wiring));
  ok('and it can be turned off', /woodlandRelief: true/.test(
    readFileSync(new URL('../src/core/settings.js', import.meta.url), 'utf8')));
}

// ---------------------------------------------------------------------------
console.log('\nGoogle imagery asks for what Google asks for');
{
  const providers = readFileSync(new URL('../src/tiles/providers.js', import.meta.url), 'utf8');
  const wiring = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  // `region` is a required field on createSession and this used to leave it
  // out, on the reasoning that a region identifier picks whose borders and
  // labels you get and a satellite session draws neither. True, and beside the
  // point: without it there is no session, and with no session there are no
  // tiles. That was "Google Maps not working".
  ok('createSession sends the region it requires',
    /body: JSON\.stringify\(\{ mapType: 'satellite', language, region \}\)/.test(providers));
  ok('and takes it from the browser rather than pinning everyone to one country',
    /const region = localeRegion\(\) \?\? 'US'/.test(providers));

  // Their policy: the attribution is the string the viewport request returns,
  // not a constant in our source. It differs from place to place because the
  // imagery does — Airbus, Maxar or a national mapping agency alongside Google.
  ok('the viewport request exists and is asked the right question',
    /tile\.googleapis\.com\/tile\/v1\/viewport/.test(providers)
    && /north: view\.north\.toFixed\(6\)/.test(providers));
  ok('and what comes back is what gets shown',
    /if \(this\.googleCopyright\) return this\.googleCopyright;/.test(providers));
  ok('the game asks again when you have moved far enough to matter',
    /refreshGoogleAttribution\(player\)/.test(wiring)
    && /now - \(this\.googleViewedAt \?\? -Infinity\) < 60000/.test(wiring));

  // maxZoomRects says how far in the imagery actually goes for each patch of
  // the viewport, which is the difference between stopping at the last real
  // zoom and asking for tiles that were never flown.
  ok('and remembers how far in Google actually flew',
    /googleMaxZoomAt\(lat, lon\)/.test(providers)
    && /r\.west <= r\.east/.test(providers));

  const units = readFileSync(new URL('../src/core/units.js', import.meta.url), 'utf8');
  ok('the browser region is read once, where the units are read',
    /export function localeRegion\(\)/.test(units));
}

// ---------------------------------------------------------------------------
console.log('\nGenerated art stays where it belongs');
{
  // The rule, stated once so it cannot drift: nothing generated may stand in
  // for real map data. There used to be a second group here — foliage and rock
  // for the generated world — and the check was that the manifest kept saying
  // two different things about the two groups. The generated world is gone, so
  // the honest version of that check is that the group is gone with it and
  // what remains is only ever the player's own kit.
  const manifest = JSON.parse(
    readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'),
  );
  ok('nothing generated dresses the ground any more', !manifest.textures);
  ok('and the two files it used to name are not in the download',
    !existsSync(new URL('../assets/foliage.jpg', import.meta.url))
    && !existsSync(new URL('../assets/rock.jpg', import.meta.url)));
  ok('kit textures are declared', ['jacket', 'trousers', 'wing', 'rocket']
    .every((part) => !!manifest.kit?.[part]));
  ok('and the rule is written down where both loaders read it',
    /stand in for real map data/i.test(manifest.rule ?? ''));

  const avatar = readFileSync(new URL('../src/player/avatar.js', import.meta.url), 'utf8');
  ok('the player kit is not gated on a provider', !/imageryProvider/.test(avatar));

  // Every file the manifest names has to actually be there, or a player gets a
  // silent fallback and no idea why the world looks flat.
  // The generated character mesh: real, optional, and honest about what it is.
  ok('the player mesh is declared', !!manifest.model?.player);
  ok('and says it cannot animate', /skeleton|animate/i.test(manifest.model?.note ?? ''));
  {
    const glb = new URL(`../assets/${manifest.model.player}`, import.meta.url);
    ok('the mesh is present', existsSync(glb));
    const size = statSync(glb).size;
    ok('and small enough to be worth downloading', size < 1_200_000,
      `${Math.round(size / 1024)} KB`);
    ok('and is a real GLB', readFileSync(glb).subarray(0, 4).toString() === 'glTF');
  }
  const avatar2 = readFileSync(new URL('../src/player/avatar.js', import.meta.url), 'utf8');
  ok('it is off by default and first person never uses it',
    /detailedPlayerModel'\) && !this\.firstPerson/.test(avatar2));
  ok('and the single-file build never asks for it',
    /__TERRAGLIDE_INLINE_WORKER__[\s\S]{0,200}detailedPlayerModel/.test(avatar2));

  for (const file of Object.values(manifest.kit)) {
    if (!file.endsWith('.jpg') && !file.endsWith('.png')) continue;
    const path = new URL(`../assets/${file}`, import.meta.url);
    ok(`${file} is present`, existsSync(path) && statSync(path).size > 1024);
  }
}

console.log('\nThe 45/45, and what it takes to make it hold');
{
  const { stepGlide, TICK: T } = await import('../src/player/elytra.js');

  // Hold one attitude until the speed settles, and report where it settles.
  const settle = (pitchDeg, from = 30, seconds = 150) => {
    const pitch = (pitchDeg * Math.PI) / 180;
    const look = { x: 0, y: Math.sin(pitch), z: -Math.cos(pitch) };
    const v = { x: 0, y: 0, z: -from };
    for (let t = 0; t < 20 * seconds; t++) stepGlide(v, look, pitch);
    return v;
  };

  // Minecraft publishes these numbers for the elytra and the model has to land
  // on all of them, or it is not Minecraft's. None of them involve the climb
  // term, which is the only constant that differs.
  {
    const level = settle(0);
    ok('level flight sinks about a sixth of a block a tick, which is vanilla\u2019s figure',
      near(-level.y * T, 0.15, 0.01), `${(-level.y * T).toFixed(4)} b/t`);
    ok('and glides about ten to one',
      near(-level.z / -level.y, 10.1, 0.4), `${(-level.z / -level.y).toFixed(2)}:1`);
    const dive = settle(-90, 0);
    ok('and a vertical dive terminates at 3.92 blocks a tick, also vanilla\u2019s',
      near(Math.hypot(dive.x, dive.y, dive.z) * T, 3.92, 0.02),
      `${(Math.hypot(dive.x, dive.y, dive.z) * T).toFixed(3)} b/t`);
  }

  // Nose up and wait must never be a way to gain height, at any angle. If it
  // were, the climb term would be a gift rather than a technique.
  {
    let worst = -Infinity;
    for (const angle of [5, 10, 20, 30, 40, 50, 60, 70]) {
      worst = Math.max(worst, settle(angle).y);
    }
    ok('holding any fixed angle still sinks \u2014 there is no nose-up exploit',
      worst < -0.5, `best constant climb still loses ${(-worst).toFixed(2)} m/s`);
  }

  /**
   * The manoeuvre, flown on a metronome: so many seconds nose down, so many
   * nose up, repeat. This is what a player does, and the cadence is the skill.
   */
  const porpoise = (angle, seconds, minutes = 6) => {
    const rad = (deg) => (deg * Math.PI) / 180;
    const v = { x: 0, y: -20, z: -70 };
    const phase = Math.round(20 * seconds);
    let y = 0, markY = 0;
    const markT = 20 * 90, total = 20 * 60 * minutes;
    for (let t = 0; t < total; t++) {
      const down = Math.floor(t / phase) % 2 === 0;
      const pitch = rad(down ? -angle : angle);
      const look = { x: 0, y: Math.sin(pitch), z: -Math.cos(pitch) };
      stepGlide(v, look, pitch);
      y += v.y * T;
      if (t === markT) markY = y;
    }
    return (y - markY) / ((total - markT) * T);
  };

  // What the manoeuvre is actually worth in vanilla, measured rather than
  // asserted. It does not hold altitude — nothing in this model does, which is
  // the finding — but it roughly halves the sink, and the rhythm decides how
  // much. That is the honest version of "the 45/45 works".
  const level = -settle(0).y;
  const flown = -porpoise(40, 6);
  ok('flying the 45/45 on a rhythm roughly halves the sink',
    flown < level * 0.6, `${flown.toFixed(2)} m/s against ${level.toFixed(2)} m/s level`);
  ok('and flying it too fast throws that away',
    -porpoise(40, 1.5) > flown, `${(-porpoise(40, 1.5)).toFixed(2)} m/s hurried`);
  ok('but no rhythm at any angle actually holds altitude, which is vanilla',
    [30, 35, 40, 45, 50].every((a) => [3, 4, 5, 6, 8].every((t) => porpoise(a, t, 4) < 0)));

  const { DEFAULT_SETTINGS: DS } = await import('../src/core/settings.js');
  ok('and there is only one flight model to choose from', !('glideModel' in DS));
}

console.log('\nPut back on the ground when the ground turns up');
{
  // Both layers stand things on the terrain and both read the height once.
  // Before the relief for a square arrives every height there is exactly sea
  // level and `hasElevationAt` is false, so a wood is dropped rather than
  // planted and a building is founded at zero — and nothing asked again,
  // because nothing about the wood or the building had changed.
  const terrainSource = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');
  ok('the terrain says when new relief has landed', /get elevationVersion\(\)/.test(terrainSource));

  const { Buildings } = await import('../src/world/buildings.js');
  // A bare stand-in: the only thing under test is when a tile is rebuilt.
  let ground = 0;
  const layer = Object.create(Buildings.prototype);
  layer.terrain = { heightAt: () => ground, elevationVersion: 0 };
  layer.frame = { toWorld: (lat, lon, out) => Object.assign(out ?? {}, { x: 0, y: 0, z: 0 }) };
  layer.stats = { buildings: 0 };
  layer.tiles = new Map();
  layer.lastRefound = 0;
  let rebuilds = 0;
  layer.disposeTile = () => {};
  layer.buildTile = (record) => {
    rebuilds++;
    record.groundAt = layer.tileGround(record);
    record.counts = { buildings: 0 };
  };
  const record = {
    tile: { z: 15, x: 100, y: 100 },
    state: 'ready',
    data: {},
    colliders: [],
    groundAt: 0,
    counts: { buildings: 0 },
  };
  layer.tiles.set('t', record);

  const pass = (advanceMs = 1000) => {
    layer.lastRefound -= advanceMs;
    layer.watchElevation();
  };

  pass();
  ok('a tile founded on ground that has not moved is left alone', rebuilds === 0, `${rebuilds}`);

  // The relief for this square lands and the ground turns out to be a hill.
  ground = 412;
  pass();
  ok('and rebuilt once the ground under it moves', rebuilds === 1, `${rebuilds}`);

  // This is the part that matters: elevation streams for a minute, so a rule
  // that watched the version alone would rebuild on every one of a hundred
  // tiles and never settle. Watching the height settles as soon as the DEM
  // for this square has arrived.
  layer.terrain.elevationVersion = 99;
  for (let i = 0; i < 20; i++) pass();
  ok('and not again while the ground stays put, however much else lands',
    rebuilds === 1, `${rebuilds} rebuilds`);

  // Movement below a metre is not worth the work.
  ground = 412.4;
  pass();
  ok('a few centimetres is not worth rebuilding for', rebuilds === 1, `${rebuilds}`);

  // And the gap keeps a burst from turning into a stutter.
  ground = 900;
  layer.lastRefound = performance.now();
  layer.watchElevation();
  ok('rebuilds are spaced out', rebuilds === 1, `${rebuilds}`);
}

console.log('\nPicking the preset by measuring, once, when asked');
{
  const { Benchmark, TIERS } = await import('../src/core/benchmark.js');
  const { settings: S } = await import('../src/core/settings.js');
  S.set('fpsTarget', 60);

  // A machine that can hold 60 at High and not at Ultra.
  const speeds = { low: 4, medium: 8, high: 15, ultra: 40 };
  const frame = () => Promise.resolve(speeds[S.get('graphics')] ?? 16);

  {
    const bench = new Benchmark();
    const result = await bench.run({ frameMs: 16 }, frame, 60);
    ok('the benchmark tries every preset', result.results.length === TIERS.length);
    ok('and settles on the heaviest one that held the target', result.pick === 'high',
      `${result.results.map((r) => `${r.tier} ${r.fps.toFixed(0)}`).join(', ')}`);
    ok('and it really did move the setting', S.get('graphics') === 'high');
  }
  {
    // Nothing holds the target: take the lightest and turn the detail down.
    const slow = { low: 60, medium: 90, high: 140, ultra: 260 };
    const bench = new Benchmark();
    S.set('detailLimit', 100);
    const result = await bench.run({ frameMs: 60 }, () => Promise.resolve(slow[S.get('graphics')]), 60);
    ok('a machine that cannot hold the target lands on the lightest preset', result.pick === 'low');
    ok('and the detail dial takes up the slack', S.get('detailLimit') < 100,
      `${S.get('detailLimit')}%`);
  }
  {
    // The measurement itself must not be polluted by a turned-down dial.
    const bench = new Benchmark();
    S.set('resolutionScale', 0.6);
    S.set('detailLimit', 40);
    let sawScale = 1;
    await bench.run({ frameMs: 16 }, () => {
      sawScale = Math.min(sawScale, S.get('resolutionScale'));
      return Promise.resolve(speeds[S.get('graphics')]);
    }, 60);
    ok('it measures at full resolution whatever the slider said', sawScale === 1);
    ok('and puts your own settings back afterwards', S.get('resolutionScale') === 0.6);
  }
  S.reset?.();
}

console.log('\nSpeed mode, fireworks and the pause key');
{
  const { Player } = await import('../src/player/player.js');
  const { settings: S } = await import('../src/core/settings.js');
  const frame = { setAnchor() {}, toGeo: () => ({ lat: 0, lon: 0 }) };
  const player = new Player(frame);

  ok('at rest the multiplier is one', near(player.speedMultiplier, 1, 1e-9));
  const restingRocket = player.rocketPower;

  // Speed mode comes on like a switch: the blend runs up over a moment, so
  // step the clock rather than expecting it instantly.
  player.startSpeedMode();
  for (let i = 0; i < 200; i++) player.tickTimers(1 / 60);
  ok('speed mode doubles the running', near(player.speedMultiplier, 2, 1e-6),
    `${player.speedMultiplier}`);
  ok('and doubles the firework on top of it',
    near(player.rocketPower, restingRocket * 2, 1e-6),
    `${player.rocketPower} vs ${restingRocket}`);

  // A stronger slot multiplies with it rather than replacing it: that is the
  // reason to save a Rocket V for the burst.
  player.selectSlot(4);
  const strong = player.rocketPower;
  player.speedBlend = 1;
  ok('a stronger slot and the burst multiply', near(strong, player.rocketPower * 2, 1e-6),
    `${strong} vs ${player.rocketPower}`);

  // Dropping the burst bleeds away rather than halving between two frames,
  // and a burning firework holds it up while it does.
  player.speedBlend = 2;
  player.speedActive = false;
  player.rocketTicksLeft = 0;
  for (let i = 0; i < 30; i++) player.tickTimers(1 / 60);
  const freeFall = player.speedBlend;
  player.speedBlend = 2;
  player.rocketTicksLeft = 100;
  for (let i = 0; i < 30; i++) player.tickTimers(1 / 60);
  ok('and a firework still burning slows the bleed', player.speedBlend > freeFall,
    `${player.speedBlend.toFixed(3)} burning vs ${freeFall.toFixed(3)} not`);

  // Escape is the pause key, and a menu is what pausing looks like.
  const gameSource = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  ok('any modal panel counts as paused',
    /get paused\(\)[\s\S]{0,600}settingsPanel\.open[\s\S]{0,120}worldmap\.open/.test(gameSource));
  ok('and so does the pause key on its own, with no panel over the view',
    /pausedByKey/.test(gameSource) && /pause: 'Key/.test(readFileSync(new URL('../src/core/keybinds.js', import.meta.url), 'utf8')));
  ok('and a paused frame advances the clock by nothing',
    /this\.update\(this\.paused \? 0 : elapsed \* cheats\.gameSpeed\)/.test(gameSource));
  ok('the frame is still drawn while paused, so tiles keep arriving',
    /this\.paused \? 0[\s\S]{0,120}renderer\.render/.test(gameSource));
  const binds = readFileSync(new URL('../src/core/keybinds.js', import.meta.url), 'utf8');
  ok('Escape is the key that does it', /settings: 'Escape'/.test(binds));

  // The menu has to say which providers cost you an account.
  const { providerLabel, IMAGERY_PROVIDERS: LIST } = await import('../src/tiles/providers.js');
  const esri = LIST.find((p) => p.id === 'esri');
  ok('a keyless provider says so', /keyless/.test(providerLabel(esri)), providerLabel(esri));
  ok('and still says it is recommended', /recommended/.test(providerLabel(esri)));
  const google = LIST.find((p) => p.id === 'google');
  ok('a keyed one says that instead', /needs a key/.test(providerLabel(google)),
    providerLabel(google));
  ok('and every provider on the list is a real one',
    LIST.every((p) => p.kind !== 'synthetic'));
  ok('so every label says either keyless or needs a key',
    LIST.every((p) => /keyless|needs a key/.test(providerLabel(p))));
  S.reset?.();
}

console.log('\nWhat a person is looking at goes first');
{
  const { MapTileCache } = await import('../src/ui/mapTiles.js');
  const cache = new MapTileCache();
  const dispatched = [];
  cache.source = { descriptor: { id: 'test', maxZoom: 19 }, urlFor: (t) => `x/${t.z}` };
  cache.load = (job) => { dispatched.push(job); };   // never completes, so the queue builds

  // Colour sampling asks once per building and will happily ask thousands of
  // times; the minimap asks for the eight tiles somebody is looking at. First
  // come first served meant the eight sat behind the thousands and never
  // arrived — over a city the minimap was simply black with nothing failing.
  for (let i = 0; i < 40; i++) cache.get(16, 1000 + i, 2000, false);
  const before = dispatched.length;
  cache.get(14, 5, 6, true);
  const urgentAt = dispatched.findIndex((j) => j.tile.z === 14);
  ok('an urgent tile is dispatched even with a queue in front of it', urgentAt >= 0);
  ok('and it goes before the unurgent backlog',
    urgentAt >= before - 1, `dispatched at ${urgentAt} of ${dispatched.length}`);

  // And the backlog cannot grow without bound.
  const deep = new MapTileCache();
  deep.source = cache.source;
  // A real fetch holds a slot until it answers, which is what lets a backlog
  // build up at all; a stub that returns instantly never queues anything.
  deep.load = () => { deep.active++; };
  for (let i = 0; i < 4000; i++) deep.get(16, i, 1, false);
  ok('an unurgent flood is dropped rather than queued', deep.queue.length < 200,
    `${deep.queue.length} queued of 4000 asked`);
  ok('and nothing is remembered that was never queued', deep.tiles.size < 200,
    `${deep.tiles.size} tiles tracked`);
  // Urgent work still gets in when the backlog is full.
  deep.get(14, 9, 9, true);
  ok('urgent work is never dropped', [...deep.tiles.keys()].some((k) => k.startsWith('14')));
}

console.log('\nA tile that is culled is still a tile that needs rebuilding');
{
  const terrain = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');
  // A node built before its relief arrived is flat at sea level and its cull
  // box says so. Over ground four hundred metres up that box is nowhere near
  // the mesh, so the frustum rejects it — and the rebuild pass only walked
  // the *drawn* list, so a rejected node could never be refreshed. The tile
  // stayed a hole for as long as you stood there.
  ok('stale bounds are not trusted for culling',
    /builtVersion === \(this\.elevation\.version \?\? 0\)/.test(terrain) &&
    /measured \? cached\.minY : -200/.test(terrain));
  ok('and the rebuild pass walks every node, not only the drawn ones',
    /invalidateStale\([\s\S]{0,2000}for \(const node of this\.nodes\.values\(\)\)[\s\S]{0,1600}node\.dirty = true/.test(terrain));
  ok('it still skips nodes that are already current',
    /node\.builtVersion === version \|\| !node\.mesh \|\| node\.dirty\) continue/.test(terrain));
  // Stamping a node with the current version means "this is up to date", and
  // a node that is up to date is never rebuilt again. Doing that to everything
  // past six kilometres certified most of the world as finished while it was
  // still flat, which is where the terraces came from.
  ok('and never certifies a distant mesh as up to date to avoid rebuilding it',
    !/builtVersion = version;/.test(terrain));
  ok('the staleness test looks at the whole tile, not just its middle',
    /const bestZoom = this\.elevationZoomFor\(x0, z0, size\);/.test(terrain) &&
    /node\.builtElevZoom = this\.elevationZoomFor\(x0, z0, size\);/.test(terrain));
}

console.log('\nBuildings are painted once the photograph arrives');
{
  const src = readFileSync(new URL('../src/world/buildings.js', import.meta.url), 'utf8');
  // A roof takes its colour from the aerial image of that roof, sampled once
  // when the tile is built. Overpass answers long before the imagery does, so
  // almost every building kept the flat grey fallback for ever.
  ok('empty colour samples are counted', /this\.unpainted = \(this\.unpainted \?\? 0\) \+ 1/.test(src));
  ok('and remembered on the tile', /record\.unpainted = this\.unpainted/.test(src));
  ok('a tile with grey in it is repainted once a sample succeeds',
    /const repaint = \(record\.unpainted \?\? 0\) > 0 &&[\s\S]{0,80}!== null/.test(src));
  ok('and ground with genuinely no imagery is not retried for ever',
    /if \(!moved && !repaint\) continue/.test(src));
}

console.log('\nA map falls through rather than inventing');
{
  const source = readFileSync(new URL('../src/ui/mapTiles.js', import.meta.url), 'utf8');
  // A provider with no URL has failed its handshake. There is nothing to
  // invent in its place any more; the tile is simply not drawn.
  ok('nothing invents a tile',
    !/invent\(/.test(source) && !/procedural/i.test(source));
  ok('and a real one that is not ready falls through to the next',
    /not ready`\);\s*continue;/.test(source));
  ok('the chain is first choice, then standbys',
    /\[this\.source, \.\.\.this\.fallbacks\]/.test(source));
  ok('and it never asks a provider for a zoom it does not serve',
    /tile\.z > \(source\.descriptor\?\.maxZoom \?\? Infinity\)\) continue/.test(source));
}

console.log('\nVector tiles, read by hand');
{
  const { decodeVectorTile, POLYGON } = await import('../src/tiles/vectorTile.js');
  // A tile encoder, just big enough to make one to read back. Protocol
  // buffers: a varint is base-128 low group first, a field header is the
  // field number shifted up three with the wire type underneath.
  const varint = (n) => {
    const out = [];
    while (n > 127) {
      out.push((n & 127) | 128);
      n = Math.floor(n / 128);
    }
    out.push(n);
    return out;
  };
  const tag = (field, wire) => varint((field << 3) | wire);
  const len = (bytes) => [...varint(bytes.length), ...bytes];
  const str = (v) => [...new TextEncoder().encode(v)];
  const zig = (n) => (n < 0 ? -n * 2 - 1 : n * 2);

  // A ten-by-ten square, as the command stream encodes one: move, three
  // lines, close, every coordinate a delta from the last.
  const square = [
    (1 << 3) | 1, ...varint(zig(0)), ...varint(zig(0)),
    (3 << 3) | 2,
    ...varint(zig(10)), ...varint(zig(0)),
    ...varint(zig(0)), ...varint(zig(10)),
    ...varint(zig(-10)), ...varint(zig(0)),
    (1 << 3) | 7,
  ];
  const feature = [
    ...tag(3, 0), ...varint(POLYGON),
    ...tag(2, 2), ...len([...varint(0), ...varint(0)]),
    ...tag(4, 2), ...len(square),
  ];
  const layer = (name) => [
    ...tag(15, 0), ...varint(2),
    ...tag(1, 2), ...len(str(name)),
    ...tag(3, 2), ...len(str('class')),
    ...tag(4, 2), ...len([...tag(1, 2), ...len(str('lake'))]),
    ...tag(5, 0), ...varint(4096),
    ...tag(2, 2), ...len(feature),
  ];
  const tile = new Uint8Array([
    ...tag(3, 2), ...len(layer('water')),
    ...tag(3, 2), ...len(layer('poi')),
  ]);

  const layers = decodeVectorTile(tile);
  ok('both layers come back', layers.size === 2, [...layers.keys()].join(','));
  const water = layers.get('water');
  ok('the extent is read, not assumed', water.extent === 4096);
  ok('one feature, a polygon', water.features.length === 1 && water.features[0].type === POLYGON);
  ok('its tag resolves through both side tables',
    water.features[0].properties.class === 'lake', JSON.stringify(water.features[0].properties));
  const ring = water.features[0].rings[0];
  ok('deltas accumulate into real coordinates',
    ring.join(',') === '0,0,10,0,10,10,0,10', ring.join(','));

  const filtered = decodeVectorTile(tile, new Set(['water']));
  ok('a layer nobody draws is never decoded',
    filtered.size === 1 && filtered.has('water'), [...filtered.keys()].join(','));

  // Negative deltas are the case zigzag exists for, and getting the sign
  // wrong draws a ring inside out rather than failing.
  ok('a negative delta comes back negative', ring[6] === 0 && ring[4] === 10);

  // A tile is bytes off the network from a host we do not control, so the
  // reader has to survive nonsense rather than trust it. The dangerous one is
  // a geometry command claiming more points than the tile could possibly
  // hold: reading past the end returns zero instead of stopping, so an
  // unbounded loop would sit there for minutes on the thread that draws.
  {
    const huge = new Uint8Array([
      ...tag(3, 2),
      ...len([
        ...tag(1, 2), ...len(str('water')),
        ...tag(5, 0), ...varint(4096),
        ...tag(2, 2), ...len([
          ...tag(3, 0), ...varint(POLYGON),
          // MoveTo claiming sixteen million points, in a four-byte tile.
          ...tag(4, 2), ...len([...varint((1 << 24) | 1), 0, 0, 0, 0]),
        ]),
      ]),
    ]);
    const started = Date.now();
    const out = decodeVectorTile(huge);
    ok('a geometry count larger than the tile cannot hang the reader',
      Date.now() - started < 500, `${Date.now() - started} ms`);
    ok('and it still returns something usable', out.has('water'));
  }

  // Truncation mid-varint, and a tile that is not a tile at all.
  ok('a truncated tile does not throw', (() => {
    try {
      decodeVectorTile(tile.slice(0, Math.floor(tile.length / 2)));
      return true;
    } catch {
      return false;
    }
  })());
  ok('random bytes do not hang or throw', (() => {
    const noise = new Uint8Array(512);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 37 + 11) & 0xff;
    const started = Date.now();
    try {
      decodeVectorTile(noise);
    } catch {
      /* refusing is fine; hanging is not */
    }
    return Date.now() - started < 500;
  })());
}

console.log('\nA provider only gets asked as deep as it answers');
{
  const { ImageryStreamer } = await import('../src/tiles/streamer.js');
  const worker = { addEventListener() {}, postMessage() {} };
  const make = (maxZoom = 19) => {
    const s = new ImageryStreamer(worker, null);
    s.source = { maxZoom, synthetic: false, urlFor: () => 'x', ready: true };
    return s;
  };
  const fail = (s, z, n) => {
    for (let i = 0; i < n; i++) {
      s.zoomRecord(z).failed++;
      s.reviewDepth(z);
    }
  };

  {
    const s = make();
    s.zoomRecord(16).loaded = 3;
    fail(s, 17, 8);
    ok('a level that refuses everything while the one above answers is dropped',
      s.maxUsefulZoom === 16, `z${s.maxUsefulZoom}`);
  }
  {
    // A regional provider refuses every level outside its coverage. That is
    // not a depth problem and lowering the zoom would not help.
    const s = make();
    fail(s, 17, 20);
    fail(s, 16, 20);
    fail(s, 15, 20);
    ok('a provider with no coverage here is not mistaken for a shallow one',
      s.maxUsefulZoom === 19, `z${s.maxUsefulZoom}`);
  }
  {
    const s = make();
    s.zoomRecord(16).loaded = 3;
    fail(s, 17, 8);
    s.zoomRecord(17).loaded = 1;
    s.reviewDepth(17);
    ok('and one tile arriving puts the level back', s.maxUsefulZoom === 19, `z${s.maxUsefulZoom}`);
  }
  {
    const s = make(15);
    ok('the published maximum still applies', s.maxUsefulZoom === 15);
  }
  {
    const terrainSource = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');
    ok('the terrain asks for the smaller of the ceiling and what is served',
      /Math\.min\(ceiling, this\.streamer\.maxUsefulZoom\)/.test(terrainSource));
    // "As detailed as possible" is not a tick any more, it is simply how it
    // works: the only ceiling is the one you set, and the deepest any provider
    // publishes is 22.
    const { DEFAULT_SETTINGS: D } = await import('../src/core/settings.js');
    ok('there is no tick to forget to turn on', !('maxTileZoomAuto' in D));
    ok('and the ceiling starts at the deepest zoom anyone serves', D.maxTileZoom === 22);
    ok('which the detail dial scales down with everything else',
      /detailLimit'\) \/ 100/.test(terrainSource));
  }
}

console.log('\nThe wheel, in whole steps');
{
  const { WheelSteps } = await import('../src/ui/wheel.js');
  const notch = (w, deltaY, deltaMode = 0, t = 0) =>
    w.read({ deltaY, deltaMode, timeStamp: t });

  {
    // A mouse arrives in whole clicks and every click should count, however
    // slowly it is turned. Accumulating those was worse than not accumulating:
    // a deliberate one-click-at-a-time scroll never reached the threshold and
    // the map never zoomed at all.
    const w = new WheelSteps(2);
    ok('one notch of a mouse wheel is one step', notch(w, -100, 0, 0) === 1);
    ok('and so is the next one', notch(w, -100, 0, 100) === 1);
    ok('and one a whole second later, which is the case that was broken',
      notch(w, -100, 0, 1100) === 1);
    // Browsers disagree about how big a click is; none of them is wrong and
    // all of them mean one click.
    for (const size of [53, 100, 114, 120, 133]) {
      ok(`a browser whose notch is ${size} still means one click`,
        new WheelSteps(2).read({ deltaY: -size, deltaMode: 0, timeStamp: 0 }) === 1);
    }
    // Two clicks in one event, which is what a fast flick of a real wheel
    // looks like, should be two.
    ok('a double click in one event is two steps',
      new WheelSteps(2).read({ deltaY: -240, deltaMode: 0, timeStamp: 0 }) === 2);
  }
  {
    // Down then up has to get back to where it started. Rounding finer than
    // the step is what let the world map zoom in but never out.
    const w = new WheelSteps(2);
    let z = 6;
    for (const [d, t] of [[-100, 0], [-100, 100], [100, 200], [100, 300]]) z += notch(w, d, 0, t) * 0.5;
    ok('two notches out undo two notches in', near(z, 6, 1e-9), `${z}`);
  }
  {
    // A trackpad: a flick is a stream of small deltas, not one big one.
    const w = new WheelSteps(2);
    let steps = 0;
    for (let i = 0; i < 20; i++) steps += Math.abs(notch(w, -12, 0, i * 12));
    ok('a trackpad flick moves a couple of levels, not twenty',
      steps >= 1 && steps <= 2, `${steps} steps from 20 events`);
  }
  {
    // Lines and pages are notches too, not pixels.
    const w = new WheelSteps(1);
    ok('a line-mode wheel counts as a notch', notch(w, -3, 1, 0) === 1);
    const p = new WheelSteps(1);
    ok('and a page-mode one does too', notch(p, -1, 2, 0) === 1);
  }
  {
    // One enormous delta is still one gesture.
    const w = new WheelSteps(1);
    ok('a single huge delta cannot skip the whole range', notch(w, -4000, 0, 0) <= 3);
  }
  {
    // A trackpad fragment left over from a minute ago is not part of this
    // gesture and must not be added to it.
    const w = new WheelSteps(2);
    notch(w, -12, 0, 0);
    ok('a stale fragment is forgotten', w.accumulated !== 0 && notch(w, -12, 0, 5000) === 0);
    ok('and it really was dropped rather than kept', Math.abs(w.accumulated) < 0.2, `${w.accumulated}`);
  }
}

console.log('\nElevation that arrives as numbers rather than pixels');
{
  const grid = await import('../src/tiles/elevationGrid.js');
  const { TileSource, ELEVATION_PROVIDERS, findProvider } = await import('../src/tiles/providers.js');

  // The published algorithm's own worked example.
  ok('the polyline encoder matches Google\u2019s worked example',
    grid.encodePolyline([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]) === '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    grid.encodePolyline([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]));

  const tile = { z: 12, x: 2048, y: 1362 };
  const bounds = grid.tileBounds(tile);
  ok('a tile\u2019s north edge is above its south edge', bounds.north > bounds.south,
    `${bounds.north.toFixed(3)} vs ${bounds.south.toFixed(3)}`);
  ok('and its west edge is left of its east edge', bounds.west < bounds.east);

  const points = grid.googleSamplePoints(tile, 4);
  ok('the sample grid starts at the north-west corner and ends at the south-east',
    near(points[0][0], bounds.north, 1e-9) && near(points[0][1], bounds.west, 1e-9) &&
    near(points[15][0], bounds.south, 1e-9) && near(points[15][1], bounds.east, 1e-9));

  // Bing counts from the south-west; every raster decoder here counts from the
  // north-west. Getting that wrong mirrors the terrain about its own middle,
  // which is the kind of bug that looks like plausible scenery.
  const side = 4;
  const ascending = [];
  for (let row = 0; row < side; row++) for (let col = 0; col < side; col++) ascending.push(row * 100);
  const bing = grid.decodeBingElevation(
    { resourceSets: [{ resources: [{ elevations: ascending }] }] }, side, side,
  );
  ok('Bing\u2019s south-first rows are flipped to north-first',
    bing[0] === 300 && bing[side * (side - 1)] === 0,
    `top ${bing[0]} m, bottom ${bing[side * (side - 1)]} m`);

  const google = grid.decodeGoogleElevation(
    { status: 'OK', results: ascending.map((elevation) => ({ elevation })) }, side, side,
  );
  ok('Google\u2019s rows are already north-first and stay that way',
    google[0] === 0 && google[side * (side - 1)] === 300);
  let refused = false;
  try {
    grid.decodeGoogleElevation({ status: 'REQUEST_DENIED', error_message: 'no key' }, 4, 4);
  } catch { refused = true; }
  ok('a refused Google request is an error, not a flat plain', refused);

  const bigger = grid.resampleGrid(Float32Array.from(ascending), side, 7);
  ok('a small grid stretches to the size the mesh wants, corners intact',
    bigger.length === 49 && near(bigger[0], 0, 1e-6) && near(bigger[42], 300, 1e-6),
    `${bigger[0]} to ${bigger[42]}`);
  ok('and interpolates between them rather than stepping',
    bigger[21] > 100 && bigger[21] < 200, `${bigger[21].toFixed(1)} m halfway down`);

  const keys = { bingKey: 'BKEY', googleKey: 'GKEY' };
  const bingSource = new TileSource(findProvider(ELEVATION_PROVIDERS, 'bing-elevation'), keys);
  const bingUrl = bingSource.urlFor(tile);
  ok('the Bing URL asks for the tile\u2019s own rectangle, south first',
    bingUrl.includes(`bounds=${bounds.south.toFixed(6)},${bounds.west.toFixed(6)}`) &&
    bingUrl.includes('rows=32&cols=32'));
  ok('and the worker is told to read it as a grid', bingSource.decode === 'bing-elevation');
  ok('it is capped shallow, because each tile costs a request',
    findProvider(ELEVATION_PROVIDERS, 'bing-elevation').maxZoom <= 12);
  // Google's Elevation API sends no CORS headers at all — it is a server-side
  // API, and a browser cannot call it whatever key you hold. It was in the
  // list and it could only ever fail with "Failed to fetch", so it is not in
  // the list any more.
  ok('and Google elevation is not offered, because a browser cannot reach it',
    !ELEVATION_PROVIDERS.some((p) => p.id === 'google-elevation'));
}

console.log('\nDive and zoom: what a pull-up is worth');
{
  const look = (pitch) => ({ x: 0, y: Math.sin(pitch), z: -Math.cos(pitch) });
  // Dive to build speed, then flare. A zoom climb out of a fast dive has to be
  // worth real height — that is the manoeuvre the whole model is tuned around.
  const zoom = (dive, climb, target) => {
    const v = { x: 0, y: 0, z: -30 };
    let y = 0;
    let peak = 0;
    for (let i = 0; i < 400 && Math.hypot(v.x, v.y, v.z) < target; i++) {
      stepGlide(v, look(dive), dive);
      y += v.y * TICK;
    }
    for (let i = 0; i < 400; i++) {
      stepGlide(v, look(climb), climb);
      y += v.y * TICK;
      peak = Math.max(peak, y);
      if (v.y < 0 && i > 6) break;
    }
    return peak;
  };
  let best = -Infinity;
  for (const dive of [-0.3, -0.5, -0.7, -0.9, -1.2]) {
    for (const climb of [0.2, 0.35, 0.5, 0.7, 0.9, 1.2]) {
      for (const target of [40, 55, 70, 85]) best = Math.max(best, zoom(dive, climb, target));
    }
  }
  ok('a dive and zoom ends higher than it started', best > 10,
    `${best.toFixed(1)} m at best, which is what makes the porpoise pay`);
  {
    const controller = readFileSync(new URL('../src/player/controller.js', import.meta.url), 'utf8');
    ok('and the controller has exactly one wing to call',
      /stepGlide\(player\.velocity, this\.look, player\.pitch\)/.test(controller) &&
      !/glideModel/.test(controller));
  }
}

console.log('\nWalking, jumping and falling like Minecraft');
{
  const { Player } = await import('../src/player/player.js');
  const { PlayerController } = await import('../src/player/controller.js');
  const frame = { setAnchor() {}, toGeo: () => ({ lat: 0, lon: 0 }) };
  const flat = {
    heightAt: () => 0, bedAt: () => 0, meshHeightAt: () => null,
    hasElevationAt: () => true, isWaterAt: () => false,
  };
  const rig = () => {
    const player = new Player(frame);
    return { player, controller: new PlayerController({ player, terrain: flat, buildings: null }) };
  };
  const keys = (over = {}) => ({
    forward: false, back: false, left: false, right: false,
    jump: false, sprint: false, crouch: false, ...over,
  });
  const run = (r, frames, over) => { for (let i = 0; i < frames; i++) r.controller.update(1 / 60, keys(over)); };

  {
    const r = rig();
    r.player.position.set(0, 4000, 0);
    r.player.onGround = false;
    run(r, 60 * 30);
    ok('a fall reaches terminal velocity and stops there',
      near(-r.player.velocity.y, 78.4, 0.5), `${(-r.player.velocity.y).toFixed(1)} m/s`);
  }
  {
    const r = rig();
    r.player.onGround = true;
    run(r, 180, { forward: true });
    ok('walking is 4.32 m/s', near(r.player.horizontalSpeed, 4.32, 0.05),
      `${r.player.horizontalSpeed.toFixed(2)} m/s`);
    run(r, 180, { forward: true, sprint: true });
    ok('sprinting is 5.61 m/s', near(r.player.horizontalSpeed, 5.61, 0.05),
      `${r.player.horizontalSpeed.toFixed(2)} m/s`);
  }
  {
    const r = rig();
    r.player.onGround = true;
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      r.controller.update(1 / 60, keys({ jump: i < 2 }));
      peak = Math.max(peak, r.player.position.y);
    }
    // Two frames at 60 Hz is shorter than one 20 Hz physics tick, so this also
    // pins the buffering: without it the tap falls between ticks and is lost.
    ok('a tap of jump clears a block and a quarter', near(peak, 1.25, 0.06), `${peak.toFixed(2)} m`);
  }
  {
    // The gesture a player actually makes, from standing: tap jump to leave
    // the ground, tap it again once airborne. That is the double jump, and it
    // is what used to do nothing at all — the old rule wanted two taps *after*
    // you were already in the air, which is four presses from standing.
    const r = rig();
    r.player.onGround = true;
    const tap = (frames = 12) => { run(r, 1, { jump: true }); run(r, frames); };
    tap();
    ok('one tap of jump leaves the ground', !r.player.onGround);
    tap();
    ok('a second tap in the air opens the wings', r.player.elytraDeployed);
    tap();
    ok('and a third stows them again', !r.player.elytraDeployed);

    const held = rig();
    held.player.onGround = true;
    run(held, 240, { jump: true });
    ok('holding jump down never opens them', !held.player.elytraDeployed);

    // The press that launches you must not come back round as an airborne
    // press on the very next frame and open the wings from standing.
    const launch = rig();
    launch.player.onGround = true;
    launch.controller.update(1 / 60, keys({ jump: true }));
    for (let i = 0; i < 30; i++) launch.controller.update(1 / 60, keys());
    ok('leaving the ground on its own does not open them', !launch.player.elytraDeployed);

    // A frame slow enough to hold two presses still counts two.
    const slow = rig();
    slow.player.position.set(0, 300, 0);
    slow.player.onGround = false;
    slow.controller.update(1 / 5, keys({ jump: true, jumpPresses: 1 }));
    ok('one press while already airborne opens them', slow.player.elytraDeployed);
  }
  {
    const r = rig();
    r.player.onGround = true;
    r.player.startSpeedMode();
    run(r, 60);
    ok('speed mode is worth exactly two', near(r.player.speedMultiplier, 2, 0.01));
    r.player.stopSpeedMode();
    run(r, 30);
    const half = r.player.speedMultiplier;
    run(r, 60 * 8);
    ok('and bleeds off rather than switching off', half > 1.4 && half < 2,
      `${half.toFixed(2)}x half a second later`);
    ok('and does get all the way back to one', near(r.player.speedMultiplier, 1, 0.02),
      `${r.player.speedMultiplier.toFixed(2)}x`);
  }
  {
    const r = rig();
    r.player.onGround = true;
    r.player.position.set(0, 0, 0);
    run(r, 90);
    ok('standing still leaves the feet on the ground, not in it',
      near(r.player.position.y, 0, 0.001), `${r.player.position.y.toFixed(3)} m`);
  }
  {
    // The drawn position has to advance on *every* frame, not only on the
    // frames that happen to carry a physics tick. At 120 Hz that is one frame
    // in six; the other five held still, and holding still for five frames and
    // then jumping is exactly what flying fast looked like on a good monitor.
    const r = rig();
    r.player.position.set(0, 500, 0);
    r.player.onGround = false;
    r.player.elytraDeployed = true;
    run(r, 120);
    const steps = [];
    let last = r.player.renderPosition.clone();
    for (let i = 0; i < 120; i++) {
      r.controller.update(1 / 120, keys());
      steps.push(r.player.renderPosition.distanceTo(last));
      last = r.player.renderPosition.clone();
    }
    const still = steps.filter((d) => d < 1e-6).length;
    const biggest = Math.max(...steps);
    const smallest = Math.min(...steps);
    ok('the drawn position moves on every frame at 120 Hz', still === 0,
      `${still} of ${steps.length} frames held still`);
    ok('and moves by about the same amount each time',
      biggest < smallest * 2.5, `${smallest.toFixed(4)} to ${biggest.toFixed(4)} m`);
  }
  {
    // A teleport is not motion, so it must not be smeared across a frame.
    const r = rig();
    r.player.position.set(0, 200, 0);
    run(r, 4);
    r.player.position.set(9000, 200, -9000);
    r.controller.update(1 / 60, keys());
    ok('and jumps straight to a teleport rather than interpolating into it',
      r.player.renderPosition.distanceTo(r.player.position) < 1,
      `${r.player.renderPosition.distanceTo(r.player.position).toFixed(1)} m behind`);
  }
}

console.log('\nthe map you have actually seen');
{
  const { Exploration } = await import('../src/ui/exploration.js');
  const e = new Exploration();
  e.visit(51.5, -0.12, 100, 3000);
  const eight = [...e.cells].filter((k) => k.startsWith('8/'));
  ok('walking somewhere records the coarse tile you are standing in',
    eight.length === 1, eight.join(',') || 'nothing at level 8');
  const [, x, y] = eight[0].split('/').map(Number);
  ok('and the world map still knows you were there four levels out',
    e.isExplored(4, x >> 4, y >> 4));
  ok('and eight levels out', e.isExplored(2, x >> 6, y >> 6));
  ok('but not somewhere you have never been',
    !e.isExplored(4, (((x >> 4) + 3) % 16 + 16) % 16, y >> 4));
  const before = e.isExplored(4, x >> 4, y >> 4);
  e.visit(-33.9, 151.2, 100, 3000);
  ok('and a new visit does not stale the cached coarse answer',
    before && e.isExplored(4, x >> 4, y >> 4));
}

console.log('\ndetail follows your eyes');
{
  const terrainSource = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');
  ok('the split threshold is weighted by where you are looking',
    /const line = size \* this\.lodFactor \* this\.splitScale\(/.test(terrainSource));
  // Borrow the method rather than standing a whole quadtree up: it is pure
  // arithmetic on the view vector, and that is the whole of the behaviour.
  const { Terrain } = await import('../src/world/terrain.js');
  const probe = { _viewX: 0, _viewZ: -1, splitScale: Terrain.prototype.splitScale };
  const ahead = probe.splitScale(0, -10000, 0, 0, 10000, 500);
  const behind = probe.splitScale(0, 10000, 0, 0, 10000, 500);
  const across = probe.splitScale(10000, 0, 0, 0, 10000, 500);
  ok('ground you are facing subdivides from further away', ahead > across,
    `${ahead.toFixed(2)} vs ${across.toFixed(2)} across`);
  ok('and ground behind you from closer', behind < across,
    `${behind.toFixed(2)} vs ${across.toFixed(2)}`);
  ok('by well under a level either way, so turning round is not a rebuild',
    ahead / behind < 2, `${(ahead / behind).toFixed(2)}x`);
  ok('and ground underfoot is never coarsened for facing away',
    probe.splitScale(0, 300, 0, 0, 300, 500) === 1);
}

console.log('\nthe edge of the loaded world');
{
  const { EDGE_SECTORS } = await import('../src/world/edgeWall.js');
  const { Terrain } = await import('../src/world/terrain.js');
  const probe = { edgeProfile: new Float32Array(EDGE_SECTORS), noteEdge: Terrain.prototype.noteEdge };
  probe.edgeProfile.fill(24000);
  // A tile 100 km due north, 2 km across.
  probe.noteEdge(-1000, -101000, 1000, -99000, 0, 0);
  const north = probe.edgeProfile[0];
  ok('distant ground pushes the wall out in its own direction',
    north > 100000 && north < 102000, `${Math.round(north)} m north`);
  ok('and leaves the rest of the ring where the ground actually stops',
    probe.edgeProfile[EDGE_SECTORS / 2] === 24000,
    `${Math.round(probe.edgeProfile[EDGE_SECTORS / 2])} m south`);
  const wide = [...probe.edgeProfile].filter((v) => v > 24000).length;
  ok('over a narrow wedge rather than half the sky', wide <= 5, `${wide} sectors`);
  const gameSource = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  ok('and the game hands the wall the measured edge, not the setting',
    /edgeWall\.update\(this\.camera, this\.terrain\.edgeProfile\)/.test(gameSource));
}

console.log('\nwhere the photogrammetry actually is');
{
  const { Tiles3D } = await import('../src/world/tiles3d.js');
  const THREE = await import('../vendor/three/three.module.js');
  // Borrow the two methods rather than connecting to Google: they are
  // arithmetic over a box and a frame, and that is the whole of the behaviour.
  const { LocalFrame: LF } = await import('../src/geo/frame.js');
  const frame = new LF();
  frame.setAnchor(51.5, -0.12);
  const probe = {
    frame,
    coverage: new Set(),
    visible: new Set(['a']),
    loaded: new Map([['a', { object: null, bounds: new THREE.Box3(
      new THREE.Vector3(-400, 0, -400), new THREE.Vector3(400, 60, 400)) }]]),
    buildCoverage: Tiles3D.prototype.buildCoverage,
    covers: Tiles3D.prototype.covers,
  };
  probe.buildCoverage();
  ok('a loaded tile claims the ground under it', probe.covers(0, 0),
    `${probe.coverage.size} cells`);
  ok('and not the ground a kilometre away', !probe.covers(3000, 3000));
  ok('and nothing at all before anything has loaded',
    !new Set().size && !Tiles3D.prototype.covers.call({ coverage: new Set(), frame }, 0, 0));
  // A root tile's box spans a continent and says nothing about what is loaded.
  probe.loaded.set('big', { bounds: new THREE.Box3(
    new THREE.Vector3(-9e5, 0, -9e5), new THREE.Vector3(9e5, 9e4, 9e5)) });
  probe.visible.add('big');
  const before = probe.coverage.size;
  probe.buildCoverage();
  ok('and a tile whose box spans a continent claims nothing',
    probe.coverage.size === before, `${probe.coverage.size} vs ${before} cells`);
}

console.log('\nwhat the world says about itself');
{
  const terrain = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');
  // Unmeasured ground reads back as exactly sea level, and treating that as
  // "at sea" put you in the open ocean on the top of Uluru.
  ok('nothing is called water until its depth has been measured',
    /isWaterAt\(x, z\) \{[\s\S]{0,900}hasDataAt\(this\._norm\.nx, this\._norm\.ny\)\) return false;/.test(terrain));
  const geo = readFileSync(new URL('../src/geo/geocode.js', import.meta.url), 'utf8');
  ok('and a place with no street address is not announced as water',
    !/label: 'Open water'/.test(geo) && /label: 'Unmapped location'/.test(geo));
  ok('and a lookup that fails says so rather than locating for ever',
    /backoffUntil = performance\.now\(\)[\s\S]{0,600}emit\('address', \{ label: 'Address unavailable'/.test(geo));
}

console.log('\nphotograph where you have been, drawn map where you have not');
{
  const renderer = readFileSync(new URL('../src/ui/mapRenderer.js', import.meta.url), 'utf8');
  // Tiles are published at whole zooms. The view moves in half steps, and
  // handing a half step straight to the lookup asked for `6.5/x/y` — which no
  // provider has and no cache holds — so half the zoom levels drew nothing.
  ok('the map fetches whole zooms and scales them to the view',
    /const tileZoom = Math\.max\(0, Math\.min\(22, Math\.round\(zoom\)\)\);/.test(renderer) &&
    /const tileScale = Math\.pow\(2, zoom - tileZoom\);/.test(renderer));
  ok('and never asks a cache for a fractional zoom',
    !/resolve\(zoom,/.test(renderer) && !/isExplored\(zoom,/.test(renderer));
  // The fog is the difference between two real pictures of the world, not a
  // wash laid over one of them: photograph where you have been, drawn street
  // map where you have not.
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  ok('the unexplored half is a drawn map, not the photograph dimmed',
    /paint\(ctx, layers\.street, STREET_BLANK\)/.test(renderer)
    && !/grayscale/.test(renderer) && !/asMap/.test(renderer));
  ok('and it comes from its own cache and its own keyless providers',
    /export const streetTiles/.test(readFileSync(new URL('../src/ui/mapTiles.js', import.meta.url), 'utf8'))
    && /imageryProvider: 'esri-street'/.test(game)
    && /imageryProvider: 'openfreemap'/.test(game));
  ok('so swapping which satellite you fly over does not change the fog',
    /streetTiles\.setSource\(createImagerySource\(\{ \.\.\.settings\.values, imageryProvider: 'esri-street' \}\)\)/.test(game));

  // The edge follows what you could see from where you stood — exploration
  // records by horizon, not by the square you are in — and is then feathered,
  // because the record is kept on a grid and what it records is not.
  ok('the photograph is cut to the explored shape',
    /globalCompositeOperation = 'destination-in'/.test(renderer)
    && /layers\.exploration\.isExplored\(maskZoom/.test(renderer));
  ok('with a soft edge rather than a staircase of squares',
    /const FOG_FEATHER = 0\.45;/.test(renderer) && /filter = `blur\(/.test(renderer));
  ok('the mask is blurred once, composited once',
    /blurring them one at a time and/.test(renderer));
  ok('and the scratch canvases match the real backing store',
    /Math\.round\(width \* pixelRatio\)/.test(renderer)
    && /target\.setTransform\(pixelRatio, 0, 0, pixelRatio, 0, 0\)/.test(renderer));
  ok('with the photograph simply drawn everywhere when there is no fog to draw',
    /if \(!pair\) \{\n    paint\(ctx, layers\.tiles, '#161a1f'\);/.test(renderer));
}

console.log('\nphotogrammetry that stays put');
{
  const { Tiles3D } = await import('../src/world/tiles3d.js');
  const THREE = await import('../vendor/three/three.module.js');

  // A parent with four children, REPLACE refinement, all near enough that the
  // error test wants to refine. Coordinates are ECEF-ish but the arithmetic
  // does not care: what is being tested is which content ends up drawn.
  const makeTree = () => ({
    boundingVolume: { sphere: [0, 0, 0, 4000] },
    geometricError: 900,
    refine: 'REPLACE',
    content: { uri: 'parent.glb' },
    children: [0, 1, 2, 3].map((i) => ({
      boundingVolume: { sphere: [i * 300 - 450, 0, 0, 200] },
      geometricError: 2,
      content: { uri: `kid${i}.glb` },
    })),
  });

  const probe = (loaded) => ({
    budget: { sse: 16, active: 8 },
    tilesets: new Map(),
    loaded: new Map(loaded.map((u) => [u, {}])),
    pending: new Set(),
    copyrights: new Set(),
    visible: new Set(),
    wanted: [],
    _matrix2: new THREE.Vector3(),
    _ecefToLocal: new THREE.Matrix4(),
    _camX: 0, _camZ: 0, _viewX: 1, _viewZ: 0,
    requestTileset() {},
    traverse: Tiles3D.prototype.traverse,
    want: Tiles3D.prototype.want,
  });

  const cam = new THREE.Vector3(0, 0, 0);
  const nothing = probe([]);
  const readyA = nothing.traverse(makeTree(), new THREE.Matrix4(), cam, 900, 1.2, 0);
  ok('a coarse tile keeps drawing while its replacements are still loading',
    nothing.visible.has('parent.glb') && !readyA,
    [...nothing.visible].join(','));
  ok('and the replacements are all asked for', nothing.wanted.length === 5,
    `${nothing.wanted.length} wanted`);

  const all = probe(['kid0.glb', 'kid1.glb', 'kid2.glb', 'kid3.glb']);
  const readyB = all.traverse(makeTree(), new THREE.Matrix4(), cam, 900, 1.2, 0);
  ok('and lets go once they have actually arrived',
    readyB && !all.visible.has('parent.glb') && all.visible.size === 4,
    [...all.visible].join(','));

  const some = probe(['kid0.glb', 'kid1.glb', 'kid2.glb']);
  some.traverse(makeTree(), new THREE.Matrix4(), cam, 900, 1.2, 0);
  ok('one missing child is enough to hold the coarse tile',
    some.visible.has('parent.glb'));

  // Ordering: looking along +x, the tile at +450 should be fetched before the
  // one at -450 even though both are the same distance away.
  const order = nothing.wanted.filter((w) => w.uri.startsWith('kid'));
  const ahead = order.find((w) => w.uri === 'kid3.glb');
  const behind = order.find((w) => w.uri === 'kid0.glb');
  ok('content in front of you is fetched before content behind you',
    ahead.order < behind.order, `${ahead.order.toFixed(0)} vs ${behind.order.toFixed(0)}`);
  const sorted = [...nothing.wanted].sort((a, b) => a.order - b.order);
  ok('and the nearest of all is fetched first',
    sorted[0].order <= sorted[sorted.length - 1].order);
}

console.log('\ngraded as one photograph');
{
  const shaders = readFileSync(new URL('../src/world/shaders.js', import.meta.url), 'utf8');
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  const weather = readFileSync(new URL('../src/world/weather.js', import.meta.url), 'utf8');
  // No film curve anywhere. Every colour in this scene is already
  // display-referred — the imagery is a finished photograph, the sky colours
  // are authored as the colours they should be — so a tone curve only grades
  // a picture that was graded once already. Measured: no combination of
  // lighting gain and exposure returns the source within seventeen levels,
  // because the curve crushes shadows and compresses highlights by design.
  ok('the photograph is not re-graded on its way to the screen',
    /gl_FragColor = vec4\(lit, 1\.0\);/.test(shaders) && !/toneMap\(/.test(shaders));
  ok('and the renderer does not grade it either',
    /toneMapping = THREE\.NoToneMapping/.test(game) && !/ACESFilmic/.test(game));
  ok('relief modulates the photograph rather than relighting it',
    /float relief = \(0\.82 \+ 0\.18 \* wrapped\) \* \(0\.94 \+ 0\.06 \* sky\);/.test(shaders) &&
    /vec3 lit = albedo \* relief \* shade;/.test(shaders));
  ok('and ground with no photograph still gets the full relief treatment',
    /vec3 bare = groundNotLoaded\(flatness\)/.test(shaders));

  // The shadow has to be cast by the cloud that is actually drawn, or it is
  // just a second pattern moving over the ground on its own.
  ok('the cloud shadow samples the field the deck draws, at the same scale',
    /hit \* 0\.00042 \+ vec2\(uCloudTime \* 0\.0035, uCloudTime \* 0\.0018\)/.test(shaders) &&
    /vWorld\.xz \* 0\.00042 \+ vec2\(uTime \* 0\.0035, uTime \* 0\.0018\)/.test(weather));
  ok('and with the same threshold, so cover means the same on both',
    /0\.62 - uCloudCover \* 0\.55, 0\.92 - uCloudCover \* 0\.42/.test(shaders) &&
    /0\.62 - uCover \* 0\.55, 0\.92 - uCover \* 0\.42/.test(weather));
  ok('the deck publishes its own state for the ground to read',
    /this\.shared\.uCloudTime\.value = this\.time;/.test(weather));
  ok('and casts nothing when no deck is drawn',
    /uCloudCover\.value = this\.deck\.visible \? this\.state\.cloudCover : 0;/.test(weather));
  ok('the shadow darkens the sun, not the sky',
    /uSunColor \* wrapped \* shade/.test(shaders));
}

console.log('\nno seam where two zooms meet');
{
  const terrain = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');
  // Resolving *something* was treated as being fine. A tile could sit at
  // sixty-four times magnification off a distant ancestor for as long as its
  // own photograph took to arrive, because the ancestor request only ran when
  // there was nothing at all — so the intermediate zooms were never asked for.
  // Beside a tile that did get its own photograph, that is a hard straight
  // line across the sea, and no amount of geometry work would have removed it.
  ok('a heavily stretched tile still asks for the zooms in between',
    /if \(resolved\.scale < 0\.25\) this\.streamer\.requestAncestors\(node\.tile, priority\);/.test(terrain));
  ok('and a tile with nothing at all still asks for them too',
    /uHasTexture\.value = 0;[\s\S]{0,700}requestAncestors\(node\.tile, priority\)/.test(terrain));
}

console.log('\nApple Maps, for the parts Apple actually publishes');
{
  const { appleMaps } = await import('../src/geo/appleMaps.js');
  const { settings: S } = await import('../src/core/settings.js');
  const before = S.get('appleMapsToken');

  S.set('appleMapsToken', '');
  ok('nothing happens without a token', !appleMaps.available);
  let threw = '';
  await appleMaps.accessToken().catch((e) => { threw = String(e.message); });
  ok('and asking for one says so plainly rather than hanging',
    /no Apple Maps token/.test(threw), threw);

  S.set('appleMapsToken', '  eyJhbGciOiJFUzI1NiJ9.test  ');
  ok('a pasted token is trimmed before use', appleMaps.token === 'eyJhbGciOiJFUzI1NiJ9.test');
  ok('and switches the source on', appleMaps.available);

  // Minting is cached against the token it was minted from, so replacing the
  // token in Settings cannot leave a stale access token in play.
  appleMaps.access = 'stale';
  appleMaps.mintedFrom = 'a-different-token';
  appleMaps.expires = performance.now() + 1e6;
  ok('a replaced token invalidates the access token it minted',
    appleMaps.mintedFrom !== appleMaps.token);

  S.set('appleMapsToken', before ?? '');
  appleMaps.access = '';
  appleMaps.mintedFrom = '';
  appleMaps.expires = 0;

  const client = readFileSync(new URL('../src/geo/appleMaps.js', import.meta.url), 'utf8');
  ok('the Server API is called, not a tile endpoint that does not exist',
    /https:\/\/maps-api\.apple\.com\/v1/.test(client) &&
    !/tile|satellite|elevation/i.test(client.replace(/\/\*[\s\S]*?\*\//g, '')));
  const geo = readFileSync(new URL('../src/geo/geocode.js', import.meta.url), 'utf8');
  ok('and it takes precedence over the keyless fallback when present',
    /if \(appleMaps\.available\)/.test(geo));
  ok('the credit follows whoever answered',
    /Geocoding: Apple Maps/.test(readFileSync(new URL('../src/game.js', import.meta.url), 'utf8')));
}

console.log('\nthe sea is not black');
{
  const shaders = readFileSync(new URL('../src/world/shaders.js', import.meta.url), 'utf8');
  const terrain = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');

  // Deep ocean photographed from orbit really is nearly black — measured over
  // the Strait of Gibraltar, the raw Esri pixels are (3, 12, 19). What lifts it
  // is the sky it reflects, and that only runs where the shader knows it is
  // water. Keying that off surveyed bathymetry meant five of the eighty tiles
  // standing at sea level in that view got it, and seventy-five did not.
  ok('water is recognised by the surface being clamped to sea level',
    /float wet = uMeasured \* \(1\.0 - smoothstep\(0\.0, 2\.0, vHeight\)\);/.test(shaders));
  ok('and not by whether anyone surveyed the depth under it',
    !/float wet = smoothstep\(0\.0, 3\.0, depth\);/.test(shaders));
  ok('with a guard, so unmeasured ground does not come up as ocean',
    /uMeasured\.value = node\.builtElevZoom >= 0 \? 1 : 0;/.test(terrain));

  // A stand-in and the finer tiles under it are exactly coplanar over flat
  // water, and the depth test cannot separate them.
  ok('a stand-in is sunk so the detail wins the depth test',
    /uSink\.value =\s*\n?\s*node\.tile\.z < requestedTile\.z \? 0\.25 \* \(requestedTile\.z - node\.tile\.z\) : 0;/.test(terrain));
  ok('by moving it, because polygon offset cannot bias a depth the shader writes',
    /worldPos\.y -= sink \+ uCurvature/.test(shaders) && !/polygonOffset/.test(terrain));

  // The skirt hides the crack between two levels of detail. The crack is
  // bounded by the relief along the shared edge, not by how wide the tile
  // happens to be — and it is measured point by point, so the seaward half of
  // a coastal tile's edge hangs nothing while the headland half keeps its
  // curtain. Over open water that is the difference between a dotted grid and
  // a clean sea: 208 stray dark pixels in a patch of the Strait of Gibraltar
  // before, 39 after.
  ok('the skirt is sized by the relief along the edge it has to cover',
    /drops\[i\] = clamp\(\(hi - lo\) \* 0\.6, 0, cap\);/.test(terrain));
  ok('so a level stretch of edge hangs no curtain at all',
    /Math\.max\(0, i - SKIRT_REACH\)/.test(terrain) && !/relief \* 0\.6 \+ 1/.test(terrain));
  ok('and each of the four edges is measured separately',
    /const skirtTop = edgeDrop/.test(terrain)
    && /const skirtBottom = edgeDrop/.test(terrain)
    && /const skirtLeft = edgeDrop/.test(terrain)
    && /const skirtRight = edgeDrop/.test(terrain));
}

console.log('\nmetric or imperial, worked out rather than assumed');
{
  const units = readFileSync(new URL('../src/core/units.js', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/core/settings.js', import.meta.url), 'utf8');

  ok('the starting units come from the browser, not from a hard-coded default',
    /units: defaultUnits\(\),/.test(settings) && /import \{ defaultUnits \} from '\.\/units\.js';/.test(settings));
  ok('and it reads the region out of the language tags',
    /navigator\.languages/.test(units) && /new Intl\.Locale\(tag\)\.maximize\(\)\.region/.test(units));

  // The four are the whole of it: the United States, Liberia and Myanmar do not
  // use the metric system for everyday distance, and the United Kingdom still
  // signs its roads in miles. Everywhere else is metric.
  const listed = units.match(/IMPERIAL_REGIONS = new Set\(\[([^\]]*)\]\)/);
  const regions = listed ? listed[1].match(/'[A-Z]{2}'/g).map((r) => r.slice(1, -1)) : [];
  ok('the imperial list is US, GB, LR and MM',
    regions.join(',') === 'US,GB,LR,MM', regions.join(','));

  // Intl is what does the work, so check it lands where the code expects. A
  // bare 'en' maximizes to the United States, which is why the tag has to be
  // taken as the browser gives it rather than trimmed to a language.
  const regionOf = (tag) => new Intl.Locale(tag).maximize().region;
  ok('en-US is a region the browser can name', regionOf('en-US') === 'US');
  ok('en-GB too', regionOf('en-GB') === 'GB');
  ok('and a bare language still resolves', regionOf('fr') === 'FR' && regionOf('ja') === 'JP');
  ok('so France and Japan come out metric',
    !regions.includes(regionOf('fr')) && !regions.includes(regionOf('ja')));
  ok('and the United States comes out imperial', regions.includes(regionOf('en-US')));
  ok('metric is what you get when nothing can be read',
    /\} catch \{[\s\S]*?\}\s*return 'metric';/.test(units));
}

console.log('\none north marker on the minimap, not two');
{
  const minimap = readFileSync(new URL('../src/ui/minimap.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8');
  const renderer = readFileSync(new URL('../src/ui/mapRenderer.js', import.meta.url), 'utf8');

  // There used to be an HTML "N" pinned over the corner as well as the compass
  // the canvas draws. With the map rotating under it the two disagreed: the
  // HTML one turned with the map, the drawn one stayed with the compass.
  ok('the HTML north label is gone', !/minimap-north/.test(minimap) && !/minimap-north/.test(css));
  ok('and nothing still tries to rotate it', !/northLabel/.test(minimap));
  ok('the canvas compass is the one that is left',
    /compass: true,/.test(minimap) && /function drawCompass/.test(renderer));
}

console.log('\nnothing left that makes the world up');
{
  const buildings = readFileSync(new URL('../src/world/buildings.js', import.meta.url), 'utf8');
  const controller = readFileSync(new URL('../src/player/controller.js', import.meta.url), 'utf8');
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  const elevation = readFileSync(new URL('../src/tiles/elevation.js', import.meta.url), 'utf8');
  const providers = readFileSync(new URL('../src/tiles/providers.js', import.meta.url), 'utf8');
  const help = readFileSync(new URL('../src/ui/help.js', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../src/ui/settingsPanel.js', import.meta.url), 'utf8');

  // A footprint and a height are surveyed. A door, a floor slab every three
  // metres and a stair shaft in the corner are not — they were fitted to the
  // footprint because a sealed box felt worse to walk into. That is exactly
  // the kind of invention this project does not do, so it is gone and a
  // building is the shell somebody measured.
  ok('buildings have no invented interior', !/DOOR_WIDTH|stairPoint|enterable/.test(buildings));
  ok('and nothing still reads one', !/collider\.floors|collider\.stair/.test(controller));
  ok('nor climbs one', !/CLIMB_SPEED|this\.climbing/.test(controller));
  ok('nor arrives inside one', !/Arrived indoors/.test(game));
  ok('a building is solid: inside its footprint, the roof is the ground',
    /Solid: the ground inside a footprint is its roof/.test(controller));

  // There is no generated provider and no generated relief either, so the
  // branches that served them are dead weight and the copy that promised them
  // is a lie.
  ok('no provider claims to generate tiles', !/synthetic/.test(providers) && !/synthetic/.test(elevation));
  ok('and the height field says plainly that it falls back to sea level',
    /get givenUp\(\)/.test(elevation) && !/get invented\(\)/.test(elevation));
  ok('nothing in the interface still offers a generated world',
    !/generated world/.test(help) && !/generated world/.test(panel) && !/generated terrain/.test(game));
}

console.log('\nnot asking for photographs nobody has');
{
  const streamer = readFileSync(new URL('../src/tiles/streamer.js', import.meta.url), 'utf8');

  // Esri serves zoom 19 over a town and stops at 17 over a glacier a valley
  // away, so a refusal is about the square rather than the zoom. Measured over
  // the Bernese Alps: 157 imagery failures across 39 squares, because every
  // refusal was followed by Sentinel-2, USGS and GIBS in turn — none of which
  // publishes anything at zoom 18 at all. Skipping the standbys that cannot
  // reach that deep took it to 62, and 17% more ground had arrived by the same
  // moment (410 tiles to 479).
  ok('a standby is only tried if it publishes that zoom',
    /canServe\(source, z\)/.test(streamer)
    && /source\.descriptor\?\.maxZoom \?\? 19\) >= z/.test(streamer));
  ok('and the attempt counter steps over the ones that cannot',
    /nextAttempt\(entry\)/.test(streamer)
    && /!this\.canServe\(this\.standbys\[attempt - 1\], entry\.tile\.z\)/.test(streamer));
  ok('a square nobody has is remembered rather than re-asked every twenty seconds',
    /this\.barren = new Set\(\)/.test(streamer) && /this\.barren\.add\(entry\.key\)/.test(streamer));
  ok('and the squares inside it are never asked at all',
    /underBarren\(tile\)/.test(streamer) && /entry\.state = STATE_BARE;\n      return entry;/.test(streamer));
  ok('but only four levels up, so one refusal cannot write off a continent',
    /i < 4 && z > 1/.test(streamer));
  ok('and moving somewhere else forgets it', /this\.barren\.clear\(\);/.test(streamer));
}
console.log('\nthe ground is the photograph, at the brightness the photograph has');
{
  const shaders = readFileSync(new URL('../src/world/shaders.js', import.meta.url), 'utf8');

  // Measured straight down over the Champ de Mars from 124 m, against the raw
  // Esri tile for the same 90 m square: the game drew it at 0.618 of its
  // brightness and 0.73 of its contrast. The cloud shadow was almost the whole
  // of it — an overcast sky took 62% of the light off a picture that was taken
  // in sunshine. In the same band as the relief it is 0.909 and 0.962.
  ok('cloud shadow modulates around one rather than relighting the ground',
    /return 1\.0 - density \* 0\.18;/.test(shaders));
  ok('in the same band the relief uses, so neither can grade the photograph',
    /float relief = \(0\.82 \+ 0\.18 \* wrapped\)/.test(shaders));
  ok('and nothing runs a tone curve over it',
    !/toneMapping/.test(shaders) && !/uExposure/.test(shaders));
}
console.log('\nno band along the horizon');
{
  const wall = readFileSync(new URL('../src/world/edgeWall.js', import.meta.url), 'utf8');
  const weather = readFileSync(new URL('../src/world/weather.js', import.meta.url), 'utf8');
  const shaders = readFileSync(new URL('../src/world/shaders.js', import.meta.url), 'utf8');

  // The pale strip above the mountains was the wall at the edge of the loaded
  // world, and it was there because that shader never converted to the output
  // colour space: it wrote linear numbers into an sRGB framebuffer, so the fog
  // colour came out (181, 201, 224) where the sky beside it, from that same
  // colour, came out (214, 225, 237). Eighty-four levels, full width. The cloud
  // deck had the omission too, which is why an overcast sky was a dark smear.
  //
  // Anything that writes a pixel converts on the way out. No exceptions — this
  // check walks every shader in the project rather than naming the two that
  // were wrong.
  for (const [name, src] of [['terrain, sky and clouds', shaders], ['the edge wall', wall], ['the weather deck', weather]]) {
    const writes = (src.match(/gl_FragColor\s*=/g) ?? []).length;
    const converts = (src.match(/#include <colorspace_fragment>/g) ?? []).length;
    ok(`${name} converts every pixel it writes to the output colour space`,
      writes > 0 && writes === converts, `${writes} written, ${converts} converted`);
  }

  // And the rim is painted the colour the sky is in that direction, scattering
  // included, so it matches near the sun as well as away from it. Measured over
  // the Alps at 2 km: the rim was 84 levels off the sky above it, and is now
  // within 3 across the whole strip.
  ok('the wall rim takes the sky\u2019s own forward scattering',
    /pow\(toward, 9\.0\) \* 0\.34 \+ pow\(toward, 2\.0\) \* 0\.11/.test(wall)
    && /pow\(toward, 9\.0\) \* 0\.34 \+ pow\(toward, 2\.0\) \* 0\.11/.test(shaders));
  ok('and follows the sky down past the horizon',
    /smoothstep\(0\.0, -0\.12, vDir\.y\)/.test(wall) && /smoothstep\(0\.0, -0\.12, up\)/.test(shaders));
  ok('with the darkening held back until well below the rim',
    /smoothstep\(0\.02, 0\.30, vDepth\)/.test(wall));
}
console.log('\nthe sea has no seams in it, from any height');
{
  const shaders = readFileSync(new URL('../src/world/shaders.js', import.meta.url), 'utf8');
  const terrain = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');

  // Two artefacts, one cause, and they pull in opposite directions.
  //
  // A stand-in is sunk so the finer tiles drawn over it win the depth test.
  // Sinking the whole tile put a half-metre step between it and any neighbour
  // that was not sunk, and from three hundred metres up at a grazing angle you
  // look straight through that step at the haze behind: a bright line across
  // the water, 123 pixels of it over the Strait of Gibraltar.
  //
  // A curtain on the tile edges hides it — and a curtain deep enough to do that
  // is itself visible from higher up, edge-on, as the dotted grid. Sweeping the
  // floor from nothing to two metres took the line from 123 to 0 and the dark
  // speckle at 1400 m from 23 to 287. There is no depth that is right for both.
  //
  // So the step goes instead of being hidden. The sink tapers to nothing over
  // the outermost few per cent of the tile, so neighbours meet exactly along
  // their shared edge while the middle — all the finer tiles ever cover — sinks
  // as far as it ever did. Both measurements then read zero.
  ok('the stand-in sink tapers to nothing at the tile edge',
    /float edgeFade = min\(min\(uv\.x, 1\.0 - uv\.x\), min\(uv\.y, 1\.0 - uv\.y\)\);/.test(shaders)
    && /float sink = uSink \* smoothstep\(0\.0, 0\.03, edgeFade\);/.test(shaders));
  ok('and it is the tapered sink that moves the geometry, not the flat one',
    /worldPos\.y -= sink \+ uCurvature/.test(shaders) && !/worldPos\.y -= uSink \+/.test(shaders));
  ok('so a level edge still hangs no curtain at all',
    /drops\[i\] = clamp\(\(hi - lo\) \* 0\.6, 0, cap\);/.test(terrain));
}
console.log('\nthe world map is not a black square');
{
  const tiles = readFileSync(new URL('../src/ui/mapTiles.js', import.meta.url), 'utf8');
  const world = readFileSync(new URL('../src/ui/worldmap.js', import.meta.url), 'utf8');
  const renderer = readFileSync(new URL('../src/ui/mapRenderer.js', import.meta.url), 'utf8');

  // Open the world map over a city and it drew nothing: an empty grid with a
  // compass on it. Two faults, both of them about what happens before a tile
  // has landed.
  //
  // The lookup walked at most five levels up for something to stretch, and the
  // overview the maps always keep sits at zoom 6 — from zoom 12 that is six
  // steps. The one tile set guaranteed to be in the cache was exactly one level
  // out of reach.
  ok('the tile lookup walks all the way up for something to stretch',
    /resolve\(z, x, y, maxSteps = 24\)/.test(tiles));

  // But only the photograph may be stretched that far. A drawn map is not
  // scale-free: its labels and road casings are sized for their own zoom, so
  // four levels of stretch writes the city's name across the whole city and
  // draws residential streets at motorway width. Next to a sharp tile that
  // reads as a broken map rather than a loading one — which is exactly what
  // walking to the top did to the world map before this cap existed.
  ok('but a drawn map may be stretched one level and no further',
    /this\.maxStretch = 24;/.test(tiles)
    && /const steps = Math\.min\(maxSteps, this\.maxStretch\);/.test(tiles)
    && /streetTiles\.maxStretch = 1;/.test(readFileSync(new URL('../src/game.js', import.meta.url), 'utf8')));
  ok('and a square of it that has not arrived is blank paper, not a hole',
    /const STREET_BLANK = '#eceae3';/.test(renderer)
    && /paint\(ctx, layers\.street, STREET_BLANK\)/.test(renderer));
  ok('and asks for a coarse tile as well as the sharp one when it finds nothing',
    /if \(z > 4\) this\.get\(z - 4, x >> 4, y >> 4, false\);/.test(tiles));

  // And it repaints only when marked dirty. The satellite cache marked it; the
  // street cache did not — and with the fog on, the street map is what fills
  // everywhere you have not been, which on a map opened somewhere new is all
  // of it.
  ok('a street tile arriving redraws the world map',
    /this\.street\?\.onTileLoaded\?\.\(\(\) => \{/.test(world));
  ok('and so does exploring somewhere new',
    /this\.exploration\.on\('change', \(\) => \{/.test(world));

  // A drawn map with no photography on it at all, for reading rather than
  // looking at.
  ok('the world map can be asked for the drawn map only',
    /data-drawn/.test(world) && /mapDrawnOnly/.test(world));
  ok('and the renderer draws just the street layer when it is',
    /const drawnOnly = !!options\.drawnOnly && !!layers\.street;/.test(renderer)
    && /if \(drawnOnly\) \{\n    paint\(ctx, layers\.street/.test(renderer));
}

console.log('\nbuildings wear the roof the survey gave them');
{
  const b = readFileSync(new URL('../src/world/buildings.js', import.meta.url), 'utf8');

  // OpenStreetMap records roof:shape on a great many buildings and it was all
  // being thrown away: every building was a box with a flat lid. A gabled house
  // twelve metres tall with a four-metre roof now comes out as fourteen
  // triangles — eight of wall, four of slope, two of gable end — measured in
  // the browser, with its apex four metres above its eaves.
  ok('the roof shape is read from the survey',
    /tags\['roof:shape'\]/.test(b) && /tags\['roof:height'\]/.test(b) && /tags\['roof:levels'\]/.test(b));
  ok('and a part that starts above the ground starts there',
    /tags\.min_height/.test(b) && /tags\['building:min_level'\]/.test(b));
  ok('walls stop at the eaves rather than running through the roof',
    /const eaves = base \+ height - roofHeight;/.test(b));
  ok('ridges, hips, lean-tos, pyramids and domes are all built',
    /gabled\|round\|hipped/.test(b) && /skillion\|lean_to/.test(b) && /dome\|onion\|round/.test(b));

  // The one rule: no shape without a surveyed height for it. "Gabled" with no
  // roof height would mean choosing one, and choosing one is inventing.
  ok('but nothing is drawn without a height that was surveyed',
    /roofHeight > 0\.2 && roofShape && roofShape !== 'flat'/.test(b));
}
console.log('\nthe grid over the sea was the depth tint');
{
  const shaders = readFileSync(new URL('../src/world/shaders.js', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/core/settings.js', import.meta.url), 'utf8');

  // The water was tinted darker and bluer with depth, from a sea bed that
  // arrives as a per-vertex attribute. So the tint is a piecewise-linear field
  // sampled on the terrain mesh, and two tiles at different levels of detail
  // sample it at different resolutions: along every edge where they meet, it
  // steps. Amplified six times, the difference the tint made is bounded by
  // hard polygon edges with square corners, and it moved 39,104 pixels of open
  // sea by up to 77 levels. That is the dotted grid, the wedges and the long
  // straight lines, all of it.
  //
  // A photograph of the sea from orbit already shows deep water dark and a
  // sandbank pale — over the Strait the raw Esri pixels run from (3, 12, 19) in
  // the channel to (150, 168, 170) over the Tarifa shallows. Nothing replaces
  // it because nothing needs to.
  ok('the water is not tinted by a per-vertex sea bed',
    !/smoothstep\(2\.0, 900\.0, depth\)/.test(shaders) && !/float depth = max\(0\.0, -vBed\)/.test(shaders));
  ok('and the sea is still lifted by the sky it reflects, which is per-fragment',
    /float fresnel = 0\.08 \+ 0\.92 \* pow\(1\.0 - facing, 5\.0\);/.test(shaders));

  // Half the ground was drawn from a stretched ancestor for the first half
  // minute because the request width was set for the six-connections-per-host
  // era. Flying the Strait and counting the share of drawn ground wearing its
  // own photograph: 41% / 42% / 49% at 4, 12 and 24 seconds before; 71% / 81% /
  // 87% after.
  ok('the streamer is allowed enough requests in flight to fill the ground',
    /maxConcurrentRequests: 26,/.test(settings) && !/maxConcurrentRequests: 6,/.test(settings));
}
console.log('\nwhat you uncover is a circle');
{
  const e = readFileSync(new URL('../src/ui/exploration.js', import.meta.url), 'utf8');
  const terrain = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');

  // A horizon is a circle, and the patch left on the map was a square with
  // soft corners. The record is kept per zoom, each level reaching at most four
  // tiles either way — deliberately, so fine detail only lands near you — but
  // the circle test underneath was measured against the *full* seen radius. Once
  // that radius passes four tiles every cell in the nine-by-nine block passes
  // the test, so the test stopped doing anything and what got recorded was the
  // block. At level 16 that is any time you can see more than about two and a
  // half kilometres, which is any time you are off the ground.
  ok('the reach cap shrinks the radius rather than squaring the shape',
    /const levelRadius = Math\.min\(mercatorRadius, reach \* tileMetres\);/.test(e));
  ok('and the circle is measured against that',
    /distance > Math\.max\(levelRadius, tileMetres \* 0\.5\)/.test(e)
    && !/distance > Math\.max\(mercatorRadius/.test(e));

  // The ground itself has always ended on a circle: the quadtree measures to
  // the nearest point of each tile, not to its centre and not per axis, so the
  // corners never poke out past the sides.
  ok('and the ground it draws ends on a smooth curve too',
    /const flatDist = Math\.hypot\(dx, dz\);/.test(terrain)
    && /const reach = renderDistance \* this\.squircle\(dx, dz\);/.test(terrain)
    && /if \(flatDist > reach\) \{/.test(terrain));
}
console.log('\nthere is sea behind the sea');
{
  const sea = readFileSync(new URL('../src/world/seaFloor.js', import.meta.url), 'utf8');
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  const shaders = readFileSync(new URL('../src/world/shaders.js', import.meta.url), 'utf8');

  // The last of the grid was a line of bright specks strung along the tile
  // edges. They are cracks — a stand-in sunk so the finer tiles win the depth
  // test, a curvature bend sampled at two vertex spacings — a pixel or two
  // wide, and through them you saw the sky dome's below-horizon tint, which is
  // far paler than deep water.
  //
  // Curtains cannot win that: swept from nothing to three metres the bright
  // specks went 20, 1, 0, 0, 0 while the dark ones went 0, 43, 206, 335, 266.
  // Putting sea behind the sea does: 26 bright specks became 3.
  ok('a sheet of sea sits below the surface',
    /export class SeaFloor/.test(sea) && /const DEPTH_M = 12;/.test(sea));
  ok('bent by the same curvature as the ground, so it stays underneath',
    /world\.y -= uCurvature \* \(d \* d\) \/ \(2\.0 \* uEarthRadius\);/.test(sea));
  ok('and wearing the same Fresnel as the surface, so a crack matches its edges',
    /float fresnel = 0\.08 \+ 0\.92 \* pow\(1\.0 - facing, 5\.0\);/.test(sea)
    && /float fresnel = 0\.08 \+ 0\.92 \* pow\(1\.0 - facing, 5\.0\);/.test(shaders));
  ok('it is a disc, not a square, so it ends where the ground ends',
    /new THREE\.CircleGeometry\(1, 96\)/.test(sea));
  ok('drawn behind the ground and in front of the sky',
    /this\.mesh\.renderOrder = -2;/.test(sea));
  ok('and it converts to the output colour space like everything else',
    /#include <colorspace_fragment>/.test(sea));
  ok('the game builds it and follows the camera with it',
    /new SeaFloor\(this\.scene, this\.shared\)/.test(game)
    && /this\.seaFloor\.update\(this\.camera, this\.terrain\.farDistance\)/.test(game));

  // And it paints sea only. A disc a hundred kilometres across, twelve metres
  // under sea level, is far below the Spanish plateau and therefore hidden by
  // it — right up until you arrive and the ground has not streamed in yet.
  // Then it was what showed through: twelve point eight per cent of the frame
  // slate blue at twenty-five seconds over the Meseta, against two point three
  // with no sheet at all. Two point two now.
  ok('and only over ground the elevation field says is sea',
    /uniform sampler2D uMask/.test(sea)
    && /texture2D\(uMask, muv\)\.r < 0\.5\) discard/.test(sea));
  ok('with unmeasured ground left alone rather than claimed',
    /hasDataAt\(nx, ny, MASK_ZOOM\)/.test(sea)
    && /const sea =\s*\n?\s*known &&/.test(sea));
  ok('the mask is published whole, never half of one sweep and half of another',
    /this\.sweepRow >= MASK/.test(sea)
    && /this\.maskTexture\.image\.data\.set\(this\.pending\)/.test(sea));
  ok('and nothing is drawn before the first sweep lands',
    /uHasMask < 0\.5\) discard/.test(sea));
  ok('the game sweeps it off the same elevation the ground is built from',
    /this\.seaFloor\.updateMask\(this\.terrain, this\.camera, this\.terrain\.farDistance\)/.test(game));

  // Reading it from zoom nine rather than the finest tile loaded saves six
  // levels of walking down the pyramid, sixteen thousand times a sweep, for an
  // answer that is thrown away at a kilometre and a half a texel anyway.
  const elev = readFileSync(new URL('../src/tiles/elevation.js', import.meta.url), 'utf8');
  ok('and the field can be asked coarsely, which is what that costs less',
    /sampleCoarse\(nx, ny, topZoom\)/.test(elev)
    && /hasDataAt\(nx, ny, topZoom = this\.maxZoom\)/.test(elev));
}
console.log('\nthe world ends on a squircle');
{
  const terrain = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');

  // A circle is the honest shape for "how far can I see", but a screen is not
  // round: the corners of the view are the first place a circular edge shows
  // itself. A squircle of exponent four keeps the setting's distance along the
  // axes and reaches 1.19 times further on the diagonals, which costs a few per
  // cent of the tiles and keeps the horizon still as you turn.
  ok('the cull is a squircle, not a circle or a square',
    /squircle\(dx, dz\)/.test(terrain) && /Math\.pow\(c \* c \* c \* c \+ s \* s \* s \* s, 0\.25\)/.test(terrain));
  ok('and the far edge follows the same shape',
    /this\.farDistance \* this\.squircle\(dx, dz\)/.test(terrain));
  ok('so the wall that closes the world lands on it rather than inside it',
    /this\.edgeProfile\[i\] = renderDistance \* this\.squircle\(/.test(terrain));
  ok('a tile the camera is standing in gets one rather than a divide by zero',
    /if \(r < 1e-6\) return 1;/.test(terrain));

  // Checked in the browser over the Strait: the recorded reach per sector came
  // back 91.4 km along the axes and 117.6 km on the diagonals.
}
console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures > 0 ? 1 : 0);

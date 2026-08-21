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
import { stepGlide, stepGlideMinecraft, stepRocket, rocketTicks, rocketPowerFor, TICK } from '../src/player/elytra.js';
import { Autopilot } from '../src/player/autopilot.js';
import { UNLOCK_CODE, cheats } from '../src/core/cheats.js';
import { resolvePlace } from '../src/ui/cheatPanel.js';
import { proceduralElevation } from '../src/tiles/procedural.js';
import { classify, parseFeatures, pointInRing } from '../src/world/landcover.js';
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
  ok('a dive builds real speed', diveSpeed > 60, `${diveSpeed.toFixed(0)} m/s`);
  ok('flaring converts speed into altitude', climbed > 25, `+${climbed.toFixed(0)} m`);

  // The invariant that matters: no dive-and-flare cycle may end up higher than
  // it started. If one ever does, the model is a perpetual motion machine and
  // you can porpoise to orbit.
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
  ok('no dive-flare cycle gains height', bestCycle < 0,
    `best was ${bestCycle.toFixed(1)} m at ${bestShape}`);

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
  // The slot number is the burn in seconds. It used to be Minecraft's raw
  // entity lifetime, which made "dur 5" last 2.8 s — the label was lying.
  for (const duration of [1, 2, 3, 4, 5]) {
    ok(`rocket ${duration} burns for exactly ${duration} s`,
      near(rocketTicks(duration) * TICK, duration, 0.001));
  }
  ok('a bigger rocket carries more powder', rocketPowerFor(5) > rocketPowerFor(1));
  ok(
    'the powder ramp compounds rather than adding',
    rocketPowerFor(5) - rocketPowerFor(4) > rocketPowerFor(2) - rocketPowerFor(1) + 0.01,
    `IV->V ${(rocketPowerFor(5) - rocketPowerFor(4)).toFixed(3)} vs I->II ${(rocketPowerFor(2) - rocketPowerFor(1)).toFixed(3)}`,
  );
  ok('but duration is the main thing you buy — power ramps gently',
    rocketPowerFor(5) < rocketPowerFor(1) * 2.2,
    `${rocketPowerFor(1).toFixed(2)} to ${rocketPowerFor(5).toFixed(2)}`);

  // Minecraft accelerates you toward 1.5 blocks/tick, which is 30 m/s. A
  // plain rocket fired from a standstill should land right about there.
  {
    const fromRest = { x: 0, y: 0, z: 0 };
    const ticks = rocketTicks(1);
    for (let tick = 0; tick < ticks; tick++) stepRocket(fromRest, levelLook, rocketPowerFor(1), tick / ticks);
    const reached = Math.hypot(fromRest.x, fromRest.y, fromRest.z);
    ok('a rocket I reaches Minecraft\'s ~30 m/s', near(reached, 30, 4), `${reached.toFixed(1)} m/s`);
  }

  // And what slows you afterwards is drag, not the rocket fading — which is
  // how Minecraft behaves and what "slows down over time" actually means.
  {
    const boosted2 = { x: 0, y: 0, z: -20 };
    const ticks = rocketTicks(3);
    for (let tick = 0; tick < ticks; tick++) stepRocket(boosted2, levelLook, rocketPowerFor(3), tick / ticks);
    const atBurnout = Math.hypot(boosted2.x, boosted2.y, boosted2.z);
    for (let tick = 0; tick < 60; tick++) stepGlide(boosted2, levelLook, 0);
    const later = Math.hypot(boosted2.x, boosted2.y, boosted2.z);
    ok('speed bleeds off after burnout', later < atBurnout - 3,
      `${atBurnout.toFixed(1)} to ${later.toFixed(1)} m/s over 3 s`);
  }

  // The kick fades across the burn rather than holding flat.
  const early = { x: 0, y: 0, z: -20 };
  const late = { x: 0, y: 0, z: -20 };
  stepRocket(early, levelLook, 1, 0);
  stepRocket(late, levelLook, 1, 1);
  ok('a rocket kicks hardest at ignition',
    Math.hypot(early.x, early.z) > Math.hypot(late.x, late.z));
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

console.log('\ngenerated world');
{
  let land = 0;
  let sea = 0;
  let highest = -Infinity;
  for (let i = 0; i < 400; i++) {
    const p = randomLatLon();
    const h = proceduralElevation(lonToNormX(p.lon), latToNormY(p.lat), 6);
    if (h > 0) land++;
    else sea++;
    highest = Math.max(highest, h);
  }
  const landShare = land / (land + sea);
  ok('generated world has both land and sea', landShare > 0.15 && landShare < 0.75,
    `${(landShare * 100).toFixed(0)}% land`);
  ok('generated world has mountains', highest > 1200, `peak ${highest.toFixed(0)} m`);

  // Determinism: the same point must always return the same height.
  const a = proceduralElevation(0.312, 0.447, 6);
  const b = proceduralElevation(0.312, 0.447, 6);
  ok('generation is deterministic', a === b);

  // Continuity: no cliffs between adjacent samples at the same detail.
  let maxJump = 0;
  for (let i = 0; i < 200; i++) {
    const nx = 0.3 + i * 1e-6;
    maxJump = Math.max(
      maxJump,
      Math.abs(proceduralElevation(nx, 0.4, 6) - proceduralElevation(nx + 1e-6, 0.4, 6)),
    );
  }
  ok('generated terrain is continuous', maxJump < 5, `largest step ${maxJump.toFixed(2)} m`);
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

console.log('\nOpenStreetMap land cover');
{
  // What counts as what. These are the tags the scenery actually keys off.
  ok('needleleaved wood is conifer', classify({ natural: 'wood', leaf_type: 'needleleaved' }).kind === 'conifer');
  ok('broadleaved wood is broadleaf', classify({ natural: 'wood', leaf_type: 'broadleaved' }).kind === 'broadleaf');
  ok('untyped forest is mixed', classify({ landuse: 'forest' }).kind === 'mixed');
  ok('scrub is bush', classify({ natural: 'scrub' }).kind === 'bush');
  ok('bare rock is rock', classify({ natural: 'bare_rock' }).kind === 'rock');
  ok('scree is rock', classify({ natural: 'scree' }).kind === 'rock');
  ok('orchards are planted closer', classify({ landuse: 'orchard' }).spacing === 10);
  ok('a building is not scenery', classify({ building: 'yes' }) === null);
  ok('an unrelated way is not scenery', classify({ highway: 'residential' }) === null);
  ok('no tags at all is not scenery', classify({}) === null);

  // A canned Overpass reply, shaped exactly as `out geom` returns one.
  const response = {
    elements: [
      {
        type: 'way',
        id: 1,
        tags: { natural: 'wood', leaf_type: 'needleleaved' },
        geometry: [
          { lat: 46.5, lon: 7.9 },
          { lat: 46.5, lon: 7.91 },
          { lat: 46.51, lon: 7.91 },
          { lat: 46.51, lon: 7.9 },
          { lat: 46.5, lon: 7.9 },
        ],
      },
      { type: 'way', id: 2, tags: { building: 'house' }, geometry: [{ lat: 46.5, lon: 7.9 }, { lat: 46.5, lon: 7.901 }, { lat: 46.501, lon: 7.901 }, { lat: 46.5, lon: 7.9 }] },
      { type: 'way', id: 3, tags: { natural: 'wood' }, geometry: [{ lat: 46.5, lon: 7.9 }, { lat: 46.5, lon: 7.901 }] },
      { type: 'node', id: 4, lat: 46.505, lon: 7.905, tags: { natural: 'tree', leaf_type: 'broadleaved' } },
      { type: 'node', id: 5, lat: 46.506, lon: 7.906, tags: { amenity: 'bench' } },
    ],
  };
  const parsed = parseFeatures(response);
  ok('the wood is picked up', parsed.areas.length === 1 && parsed.areas[0].kind === 'conifer', `${parsed.areas.length} areas`);
  ok('the building is not', !parsed.areas.some((a) => a.id === 2));
  ok('a two-point way is not an area', !parsed.areas.some((a) => a.id === 3));
  ok('the mapped tree is picked up', parsed.points.length === 1 && parsed.points[0].lat === 46.505);
  ok('a bench is not a tree', !parsed.points.some((p) => p.lat === 46.506));
  ok('an empty response yields nothing', parseFeatures({ elements: [] }).areas.length === 0);
  ok('a missing response yields nothing', parseFeatures(undefined).areas.length === 0);

  // Point in polygon: a square, then an L that a naive test gets wrong.
  const square = [0, 0, 100, 0, 100, 100, 0, 100];
  ok('inside the square', pointInRing(square, 50, 50));
  ok('outside the square', !pointInRing(square, 150, 50));
  ok('outside on the other axis', !pointInRing(square, 50, -10));
  const ell = [0, 0, 100, 0, 100, 40, 40, 40, 40, 100, 0, 100];
  ok('inside the arm of the L', pointInRing(ell, 20, 80));
  ok('in the notch of the L is outside', !pointInRing(ell, 80, 80), 'the bit an axis-aligned test gets wrong');
  ok('inside the base of the L', pointInRing(ell, 80, 20));
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

  // In first person the model steps back so you look over your chest, not
  // into it. The invariant: the front face of the torso must not sit in front
  // of the eye. Get this wrong and glancing down fills the screen with jacket.
  {
    const player = makePlayer();
    avatar.setFirstPerson(true);
    settle(player);
    const torsoHalfDepth = 0.15 / 2;
    const chestFront = avatar.body.position.z - torsoHalfDepth;
    ok('first person keeps the chest behind the eye', chestFront > -0.02,
      `chest front at z=${chestFront.toFixed(3)}, forward is -Z`);
    // ...but only just. Push it further and the legs leave the view entirely
    // when you look down, which loses the point of drawing a body at all.
    ok('and not so far back that the legs vanish', avatar.body.position.z < 0.11,
      `offset ${avatar.body.position.z.toFixed(3)} of height`);

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

  const scatter = read('world/scatter.js');
  ok('scenery prefers surveyed land cover', /parseFeatures|record\.areas/.test(scatter));
  ok('and only reads the image where the survey is silent',
    /placedNothing\(counts\)[\s\S]{0,160}fillFromImagery/.test(scatter));
  ok('the imagery fallback can be turned off', /sceneryFromImagery/.test(scatter));

  // Generated textures stay in the generated world; the player's kit is exempt
  // because no provider publishes a photograph of your jacket.
  ok('generated scenery textures are gated to the offline world',
    /imageryProvider'\) === 'offline'/.test(scatter));

  // Elevation must never invent relief under real imagery. It may invent it
  // once the provider has been given up on, but then the imagery has to be
  // invented too, or the two disagree — which is how real mountains got
  // painted ocean blue.
  const elevation = read('tiles/elevation.js');
  ok('relief is only invented when nothing real is coming',
    /return this\.invented \? proceduralElevation/.test(elevation));
  ok('and "invented" means generated, or a provider given up on',
    /get invented\(\)[\s\S]{0,160}synthetic \|\| this\.unreachable/.test(elevation));
  const streamer = read('tiles/streamer.js');
  ok('invented imagery is only allowed over invented relief',
    /mayGenerate[\s\S]{0,80}STATE_BARE/.test(streamer));
  ok('and an invented tile is thrown away the moment real relief arrives',
    /entry\.generated = url === null/.test(streamer) &&
    /if \(!entry\.generated\) continue;[\s\S]{0,200}texture\.dispose\(\)/.test(streamer));
  ok('the terrain does not vanish for one photogrammetry tile',
    /photorealFrames[\s\S]{0,120}>= 3/.test(read('game.js')));
  ok('and the ground you are looking at is asked for first',
    /this\.draw\(tile, x0, z0, size, this\.viewDistance\(/.test(read('world/terrain.js')));
  ok('and the game keeps the two in step',
    /setMayGenerate\(this\.elevation\.invented\)/.test(read('game.js')));
  const shaderSrc = read('world/shaders.js');
  ok('bare ground is coloured from the elevation, not from a flat fill',
    /groundWithoutImagery/.test(shaderSrc) && !/uFallbackColor/.test(shaderSrc));
  ok('and the sea is decided by the depth under it, not the height of it',
    /if \(depth < -0\.5\)/.test(shaderSrc));

  // Photogrammetry, where a key allows it, replaces all of the above.
  const game = read('game.js');
  ok('real 3D tiles take precedence over the game\'s own scenery',
    /photoreal[\s\S]{0,120}scatter/.test(game));
}

// ---------------------------------------------------------------------------
console.log('\nLand cover read off the photograph');
{
  const { classifyPixel, COVER, COVER_DENSITY, COVER_KIND } =
    await import('../src/world/landclass.js');

  // Where OSM has nothing, the aerial image is the second source. The rule it
  // must never break: nothing grows where the picture says nothing grows.
  const cases = [
    ['dark forest canopy', [34, 64, 30], COVER.forest],
    ['pine plantation', [28, 52, 34], COVER.forest],
    ['pasture', [120, 148, 82], COVER.grass],
    ['meadow', [138, 160, 96], COVER.grass],
    ['grey rock', [128, 126, 122], COVER.rock],
    ['scree', [150, 145, 138], COVER.rock],
    ['ploughed earth', [140, 112, 78], COVER.rock],
    ['deep water', [22, 44, 78], COVER.none],
    ['shallow sea', [40, 90, 120], COVER.none],
    ['snow', [236, 240, 244], COVER.none],
    ['cloud', [228, 228, 230], COVER.none],
    ['asphalt', [62, 62, 64], COVER.none],
    ['dark asphalt', [48, 48, 50], COVER.none],
    ['deep shadow', [18, 20, 22], COVER.none],
  ];
  for (const [label, [r, g, b], want] of cases) {
    ok(`${label} reads as ${['nothing', 'grass', 'forest', 'rock'][want]}`,
      classifyPixel(r, g, b) === want);
  }

  // The three that must never grow anything, stated as one invariant.
  ok('water, snow and tarmac never grow anything',
    [[22, 44, 78], [236, 240, 244], [55, 55, 57]]
      .every(([r, g, b]) => COVER_DENSITY[classifyPixel(r, g, b)] === 0));

  ok('forest is denser than scrub', COVER_DENSITY[COVER.forest] > COVER_DENSITY[COVER.grass]);
  ok('each cover class plants something', [COVER.grass, COVER.forest, COVER.rock]
    .every((c) => !!COVER_KIND[c]));
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
  ok('strict mode refuses to estimate at all',
    (source.match(/structuresNeedHeight/g) ?? []).length >= 2);
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
  ok('and the hotbar itself sheds width before it overflows',
    /@media \(max-width: 660px\)[\s\S]{0,260}slot-label[\s\S]{0,60}display: none/.test(css));

  // The slot hint has to fit the slot, and has to be true. It read
  // "dur 5 - pwr 5", which was neither.
  const player = readFileSync(new URL('../src/player/player.js', import.meta.url), 'utf8');
  ok('the slot hint states seconds and the real multiplier',
    /hint: `\$\{duration\}s[\s\S]{0,60}rocketPowerFor\(duration\)\.toFixed/.test(player));
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
  for (const id of ['osm', 'esri-street', 'openfreemap']) {
    ok(`${id} is kept out of the flight-imagery menu`, byId[id]?.hidden === true);
  }

  // NASA's near-real-time products lag the pass, and a date that has not
  // finished processing answers with a transparent tile — a hole in the world
  // rather than an error. The template is dated a few days back for that.
  const { gibsDate } = await import('../src/tiles/providers.js');
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
console.log('\nGenerated art stays where it belongs');
{
  // The rule, stated once so it cannot drift: generated textures may dress the
  // *generated* world and the player's own kit, and may never stand in for
  // real map data. The manifest is the contract both loaders read, so the
  // check is that it keeps saying two different things about the two groups.
  const manifest = JSON.parse(
    readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'),
  );
  ok('scenery textures are declared', !!manifest.textures?.foliage && !!manifest.textures.rock);
  ok('kit textures are declared', ['jacket', 'trousers', 'wing', 'rocket']
    .every((part) => !!manifest.kit?.[part]));
  ok('the two groups are kept apart', manifest.textures !== manifest.kit);

  const scatter = readFileSync(new URL('../src/world/scatter.js', import.meta.url), 'utf8');
  ok('scenery textures are gated on the generated world',
    /imageryProvider'\) === 'offline'/.test(scatter));

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

  for (const file of [...Object.values(manifest.textures), ...Object.values(manifest.kit)]) {
    if (!file.endsWith('.jpg') && !file.endsWith('.png')) continue;
    const path = new URL(`../assets/${file}`, import.meta.url);
    ok(`${file} is present`, existsSync(path) && statSync(path).size > 1024);
  }
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

  const scatterSource = readFileSync(new URL('../src/world/scatter.js', import.meta.url), 'utf8');
  ok('the scenery watches it', /watchElevation\(\)/.test(scatterSource));
  ok('and replanting is throttled, because relief arrives in a burst',
    /ELEVATION_SETTLE_MS/.test(scatterSource));

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

console.log('\nPicking the preset by measuring');
{
  const { AutoQuality, TIERS } = await import('../src/core/autoQuality.js');
  const { settings: S } = await import('../src/core/settings.js');
  S.set('autoQuality', true);
  S.set('fpsTarget', 60);
  S.set('resolutionScale', 1);

  // Run the governor for a while at a given frame time and render scale.
  const run = (q, seconds, frameMs, scale) => {
    const moves = [];
    for (let t = 0; t < seconds; t += 1 / 30) {
      const tier = q.update(1 / 30, { frameMs, scale });
      if (tier) moves.push(tier);
    }
    return moves;
  };

  {
    // Late frames, but the resolution governor still has room. That is its
    // problem to solve first, and two knobs pulling at once is how adaptive
    // things end up hunting.
    S.set('graphics', 'high');
    const q = new AutoQuality();
    q.settle = 0;
    ok('nothing moves while the render scale can still absorb it',
      run(q, 40, 40, 1).length === 0);
  }
  {
    // Floored and still late: now it is a preset problem.
    S.set('graphics', 'high');
    const q = new AutoQuality();
    q.settle = 0;
    const moves = run(q, 40, 40, 0.55);
    ok('a floored scale and late frames drops a tier', moves[0] === 'medium', moves.join(','));
    ok('and it drops one at a time, not to the bottom', moves.length <= 3, moves.join(','));
  }
  {
    // Real headroom at full scale climbs back — slowly.
    S.set('graphics', 'low');
    const q = new AutoQuality();
    q.settle = 0;
    const early = run(q, 10, 6, 1);
    ok('ten seconds of headroom is not yet enough to climb', early.length === 0, early.join(','));
    const later = run(q, 30, 6, 1);
    ok('but half a minute is', later[0] === 'medium', later.join(','));
  }
  {
    // The important one: a tier that proved too heavy must not be climbed
    // straight back into the moment the lighter one runs comfortably.
    S.set('graphics', 'high');
    const q = new AutoQuality();
    q.settle = 0;
    // Twenty seconds is one drop and its quiet period, so the ceiling under
    // test is the tier it just came off.
    const dropped = run(q, 20, 40, 0.55);
    ok('one sustained spell drops exactly one tier', dropped.join(',') === 'medium', dropped.join(','));
    ok('the setting really did move', S.get('graphics') === 'medium', S.get('graphics'));
    ok('dropping marks the tier it came from', q.ceiling === TIERS.indexOf('high'), `${q.ceiling}`);
    const back = run(q, 120, 6, 1);
    ok('and it will not climb back into it', back.length === 0, back.join(','));
  }
  {
    // Switched off, it must not touch anything.
    S.set('graphics', 'ultra');
    S.set('autoQuality', false);
    const q = new AutoQuality();
    q.settle = 0;
    ok('off means off', run(q, 60, 90, 0.55).length === 0);
    ok('and the preset is left alone', S.get('graphics') === 'ultra');
    S.set('autoQuality', true);
  }
  {
    // Picking one by hand is a statement about what you want.
    S.set('graphics', 'medium');
    const q = new AutoQuality();
    q.ceiling = 3;
    q.overFor = 99;
    q.reset();
    ok('a hand-picked preset clears the ceiling', q.ceiling === null);
    ok('and gives the new one a quiet period', q.settle > 0);
  }
  S.set('graphics', 'high');
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
    /get paused\(\)[\s\S]{0,220}settingsPanel\.open[\s\S]{0,120}worldmap\.open/.test(gameSource));
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
  const offline = LIST.find((p) => p.id === 'offline');
  ok('and the generated world claims neither', !/key/.test(providerLabel(offline)),
    providerLabel(offline));
  S.reset?.();
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
    ok('the terrain asks for the smaller of the setting and what is served',
      /Math\.min\(wanted, this\.streamer\.maxUsefulZoom\)/.test(terrainSource));
    // "As detailed as possible" has to mean no ceiling of our own, not a
    // large number we picked — a number that is right for one provider is
    // wrong for the next.
    ok('and on auto there is no ceiling of our own',
      /maxTileZoomAuto'\) \? Infinity : settings\.get\('maxTileZoom'\)/.test(terrainSource));
    const { DEFAULT_SETTINGS: D } = await import('../src/core/settings.js');
    ok('auto is the default', D.maxTileZoomAuto === true);
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
  const googleSource = new TileSource(findProvider(ELEVATION_PROVIDERS, 'google-elevation'), keys);
  const googleUrl = googleSource.urlFor(tile);
  // Four hundred and eighty-four points written out longhand is about eleven
  // kilobytes of URL; encoded and escaped it is a quarter of that, which is
  // what makes one request per tile possible at all.
  ok('the Google URL sends its points encoded rather than one by one',
    googleUrl.includes('locations=enc:') && googleUrl.length < 8192,
    `${googleUrl.length} characters for ${grid.GOOGLE_SIDE ** 2} points`);
  ok('both are capped shallow, because each tile costs a request',
    findProvider(ELEVATION_PROVIDERS, 'bing-elevation').maxZoom <= 12 &&
    findProvider(ELEVATION_PROVIDERS, 'google-elevation').maxZoom <= 12);
}

console.log('\nTwo wings: one honest, one Minecraft\u2019s');
{
  const look = (pitch) => ({ x: 0, y: Math.sin(pitch), z: -Math.cos(pitch) });
  // Dive to build speed, then flare. The honest model can never end higher
  // than it started; Minecraft's can, and that is the whole difference.
  const zoom = (step, dive, climb, target) => {
    const v = { x: 0, y: 0, z: -30 };
    let y = 0;
    let peak = 0;
    for (let i = 0; i < 400 && Math.hypot(v.x, v.y, v.z) < target; i++) {
      step(v, look(dive), dive);
      y += v.y * TICK;
    }
    for (let i = 0; i < 400; i++) {
      step(v, look(climb), climb);
      y += v.y * TICK;
      peak = Math.max(peak, y);
      if (v.y < 0 && i > 6) break;
    }
    return peak;
  };
  const bestNet = (step) => {
    let best = -Infinity;
    for (const dive of [-0.3, -0.5, -0.7, -0.9, -1.2]) {
      for (const climb of [0.2, 0.35, 0.5, 0.7, 0.9, 1.2]) {
        for (const target of [40, 55, 70, 85]) best = Math.max(best, zoom(step, dive, climb, target));
      }
    }
    return best;
  };
  const honest = bestNet(stepGlide);
  const minecraft = bestNet(stepGlideMinecraft);
  ok('the honest wing cannot end a dive and zoom higher than it started',
    honest < 3, `${honest.toFixed(1)} m at best`);
  ok("and Minecraft's can, by a lot", minecraft > 10,
    `${minecraft.toFixed(1)} m, which is what makes endless climbing possible`);
  ok('the two are actually different models',
    /settings\.get\('glideModel'\) === 'minecraft' \? stepGlideMinecraft/.test(
      readFileSync(new URL('../src/player/controller.js', import.meta.url), 'utf8'),
    ));
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
    const r = rig();
    r.player.position.set(0, 300, 0);
    r.player.onGround = false;
    const tap = () => { run(r, 1, { jump: true }); run(r, 1); };
    tap(); tap();
    ok('two taps in the air open the wings', r.player.elytraDeployed);
    tap(); tap();
    ok('and two more stow them', !r.player.elytraDeployed);

    const held = rig();
    held.player.onGround = true;
    run(held, 60, { jump: true });
    ok('holding jump off the ground does not open them', !held.player.elytraDeployed);

    // A frame slow enough to contain both taps still counts two of them.
    const slow = rig();
    slow.player.position.set(0, 300, 0);
    slow.player.onGround = false;
    slow.controller.update(1 / 5, keys({ jump: true, jumpPresses: 2 }));
    ok('two taps inside one slow frame still count as two', slow.player.elytraDeployed);
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

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures > 0 ? 1 : 0);

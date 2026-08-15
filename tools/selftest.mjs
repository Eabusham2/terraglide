#!/usr/bin/env node
/**
 * Headless checks for the parts that are pure maths: projection round-trips, the
 * local frame, the glide model, the rocket boost, the climate curve and the
 * water classifier. No browser, no dependencies.
 *
 *   node tools/selftest.mjs
 */

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
import { stepGlide, stepRocket, rocketTicks, rocketPowerFor, TICK } from '../src/player/elytra.js';
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
  ok('a good angle glides a long way', best > 6 && best < 20, `${best.toFixed(1)} : 1`);

  // Rockets accelerate along the look vector.
  const boosted = { x: 0, y: 0, z: -10 };
  const levelLook = { x: 0, y: 0, z: -1 };
  for (let tick = 0; tick < rocketTicks(3); tick++) stepRocket(boosted, levelLook, 1, tick / rocketTicks(3));
  ok('rocket boosts toward look direction', Math.hypot(boosted.x, boosted.y, boosted.z) > 25,
    `${Math.hypot(boosted.x, boosted.y, boosted.z).toFixed(1)} m/s`);
  ok('rocket III burns for ~1.8 s', near(rocketTicks(3) * TICK, 1.8, 0.05));
  ok('rocket I is shorter than rocket V', rocketTicks(1) < rocketTicks(5));
  ok('a bigger rocket carries more powder', rocketPowerFor(5) > rocketPowerFor(1) * 1.8);

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

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures > 0 ? 1 : 0);

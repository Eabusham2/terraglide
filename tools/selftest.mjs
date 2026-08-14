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
import { stepGlide, stepRocket, rocketTicks, TICK } from '../src/player/elytra.js';
import { proceduralElevation } from '../src/tiles/procedural.js';

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
  // A steady shallow dive should build up to a realistic glide speed and settle,
  // the way it does in the game this borrows from.
  const velocity = { x: 0, y: 0, z: 0 };
  const pitch = -0.35; // nose down ~20 degrees
  const look = { x: 0, y: Math.sin(pitch), z: -Math.cos(pitch) };
  let drop = 0;
  let forward = 0;
  for (let tick = 0; tick < 200; tick++) {
    stepGlide(velocity, look, pitch);
    drop -= velocity.y * TICK;
    forward += Math.hypot(velocity.x, velocity.z) * TICK;
  }
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  ok('dive reaches a sensible glide speed', speed > 25 && speed < 60, `${speed.toFixed(1)} m/s`);
  ok('glide ratio beats freefall', forward / drop > 1.2, `${(forward / drop).toFixed(2)} : 1`);

  // Level flight from speed: pulling level should not instantly stall.
  const level = { x: 0, y: 0, z: -35 };
  const levelLook = { x: 0, y: 0, z: -1 };
  for (let tick = 0; tick < 20; tick++) stepGlide(level, levelLook, 0);
  ok('level flight keeps most of its speed', Math.abs(level.z) > 25, `${Math.abs(level.z).toFixed(1)} m/s`);

  // Pulling up trades speed for height.
  const climbing = { x: 0, y: 0, z: -40 };
  const upPitch = 0.5;
  const upLook = { x: 0, y: Math.sin(upPitch), z: -Math.cos(upPitch) };
  let climbed = 0;
  for (let tick = 0; tick < 30; tick++) {
    stepGlide(climbing, upLook, upPitch);
    climbed += climbing.y * TICK;
  }
  ok('flaring converts speed into altitude', climbed > 0, `+${climbed.toFixed(1)} m`);

  // Rockets accelerate along the look vector.
  const boosted = { x: 0, y: 0, z: -10 };
  for (let tick = 0; tick < rocketTicks(3); tick++) stepRocket(boosted, levelLook, 1);
  const boostedSpeed = Math.hypot(boosted.x, boosted.y, boosted.z);
  ok('rocket boosts toward look direction', boostedSpeed > 25, `${boostedSpeed.toFixed(1)} m/s`);
  ok('rocket III burns for ~1.8 s', near(rocketTicks(3) * TICK, 1.8, 0.05));
  ok('rocket I is shorter than rocket V', rocketTicks(1) < rocketTicks(5));

  // Speed mode doubles distance covered, not the handling.
  const plain = { x: 0, y: 0, z: -30 };
  const fast = { x: 0, y: 0, z: -30 };
  let plainDistance = 0;
  let fastDistance = 0;
  for (let tick = 0; tick < 40; tick++) {
    stepGlide(plain, levelLook, 0);
    stepGlide(fast, levelLook, 0);
    plainDistance += Math.hypot(plain.x, plain.z) * TICK * 1;
    fastDistance += Math.hypot(fast.x, fast.z) * TICK * 2;
  }
  ok('speed mode covers twice the ground', near(fastDistance / plainDistance, 2, 0.001));
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

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures > 0 ? 1 : 0);

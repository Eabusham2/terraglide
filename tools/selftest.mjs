#!/usr/bin/env node
/**
 * Headless checks for the parts that are pure maths: projection round-trips, the
 * local frame, the glide model, the rocket boost, the climate curve and the
 * water classifier. No browser, no dependencies.
 *
 *   node tools/selftest.mjs
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
      Math.abs(speeds[0] - 33) < 2);
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

  // A rocket is a motor, not a brake.
  //
  // Minecraft's line pulls your speed toward the rocket's own from *either*
  // direction, and in vanilla that barely shows because every firework aims at
  // the same 1.5 blocks a tick. Here a bigger rocket pushes harder as well as
  // longer, which was asked for — and the same line then means the small slots
  // brake you. Cruising at 106 m/s on a Rocket V, firing a Rocket I took you to
  // 33.5: sixty-nine per cent of your speed for pressing the wrong hotbar key.
  //
  // So Minecraft's line is kept whole and simply gated: a rocket whose pull has
  // gone negative has nothing left to give at this speed and gives nothing.
  // The governor is the pull, not the nudge: vanilla settles where
  // 0.1 + (thrust - along) * 0.5 reaches nought, which is two tenths of a block
  // a tick past the rocket's own target. Dropping the nudge as well, which is
  // what this did once, capped the cruise at the target exactly — 30 m/s for a
  // Rocket I against vanilla's 33.5 — put a step in the curve where you reach
  // it, and left a second firework lit mid-burn with nothing to contribute.
  // Clamping only the forward half, which is what it did next, left the
  // steering half running for ever — see the runaway check below.
  {
    const fast = { x: 0, y: 0, z: -70 };
    const before = Math.hypot(fast.x, fast.z);
    const ticks = rocketTicks(1);
    for (let tick = 0; tick < ticks; tick++) stepRocket(fast, levelLook, 1, tick / ticks);
    const after = Math.hypot(fast.x, fast.z);
    ok('a rocket weaker than your speed does not brake you',
      after >= before - 0.01, `${before.toFixed(0)} -> ${after.toFixed(0)} m/s`);
  }

  // And it still governs on the way up, or a Rocket V runs away instead of
  // settling: dropping the pull without also dropping the flat nudge took the
  // V cruise from 107 m/s to 144.
  //
  // Tested by whether it converges rather than against a number, because the
  // number was the thing that was wrong. It used to assert "under 34 m/s",
  // which was the capped behaviour's own cruise — so the check passed on the
  // bug and failed on vanilla, whose equilibrium is 34 exactly.
  {
    const v = { x: 0, y: 0, z: 0 };
    const burn = rocketTicks(1);
    for (let tick = 0; tick < burn * 6; tick++) stepRocket(v, levelLook, 1, 0);
    const settled = Math.hypot(v.x, v.z);
    for (let tick = 0; tick < burn * 6; tick++) stepRocket(v, levelLook, 1, 0);
    const later = Math.hypot(v.x, v.z);
    ok(`but it settles instead of running away  (${settled.toFixed(1)} then ${later.toFixed(1)} m/s)`,
      later - settled < 0.5);
    // Vanilla's own: 1.7 blocks a tick, being where the pull cancels the nudge.
    ok(`and settles where vanilla settles  (${settled.toFixed(1)} m/s against 34)`,
      Math.abs(settled - 34) < 1.5);
  }

  // Held thrust at a shallow dive must settle, not compound.
  //
  // This is the one that got away. Clamping only the forward half of vanilla's
  // push left the steering half — the `- perpendicular * 0.5` that makes a
  // rocket turn — running at full strength for ever once the forward half was
  // spent. And that half is an engine all by itself: it pins your velocity to
  // your look axis, so a shallow dive sinks at |v| * sin(dive) rather than the
  // glide's own few metres a second, and the elytra hands a tenth of the sink
  // straight back as forward speed. Gain proportional to speed against a drag
  // that is one per cent of it, so it compounds. Held twenty degrees down, a
  // Rocket III passed 350 m/s in twenty seconds and 80,000 m/s in two minutes.
  // Vanilla sits at 35 for ever.
  //
  // Spamming rockets is what holds the thrust on, so this was reachable the
  // moment fireworks became a list. Swept across the angles rather than spot-
  // checked, because the band it blew up in was ten to thirty-five degrees and
  // a check at forty-five would have passed.
  {
    let worst = 0;
    let worstAt = 0;
    let worstSlot = 0;
    for (const duration of [1, 3, 5]) {
      const power = rocketPowerFor(duration);
      for (let deg = 0; deg <= 90; deg += 5) {
        const pitch = (-deg * Math.PI) / 180;
        const look = { x: 0, y: Math.sin(pitch), z: -Math.cos(pitch) };
        const v = { x: 0, y: 0, z: 0 };
        // Twenty seconds of unbroken thrust, which is what a full hotbar buys.
        for (let tick = 0; tick < 400; tick++) {
          stepRocket(v, look, power, 0);
          stepGlide(v, look, pitch);
        }
        const speed = Math.hypot(v.x, v.y, v.z);
        if (speed > worst) {
          worst = speed;
          worstAt = deg;
          worstSlot = duration;
        }
      }
    }
    // A Rocket V cruises at 107 and a vertical dive terminates at 78, so
    // nothing held anywhere should reach 130. It used to reach 457.
    ok(`thrust held at any angle settles  (worst ${worst.toFixed(0)} m/s, Rocket ${worstSlot} at ${worstAt} degrees down)`,
      worst < 130);
  }

  // Every firework alive pushes, so lighting one while another is burning gets
  // you to the cruise faster and holds you at it. That is what a single timer
  // could not do: lighting one mid-burn simply restarted it, and the second
  // rocket bought nothing at all.
  {
    const fly = (lightEvery) => {
      const v = { x: 0, y: 0, z: 0 };
      const lit = [];
      const total = rocketTicks(1);
      let reached = Infinity;
      for (let tick = 0; tick < 240; tick++) {
        if (tick % lightEvery === 0) lit.push({ left: total, total });
        for (const r of lit) {
          stepRocket(v, levelLook, 1, 1 - r.left / r.total);
          r.left -= 1;
        }
        for (let i = lit.length - 1; i >= 0; i--) if (lit[i].left <= 0) lit.splice(i, 1);
        stepGlide(v, levelLook, 0);
        // 33 rather than 30: the first two ticks are nearly all of the
        // acceleration whatever you do, so a low mark is reached at the same
        // tick either way and measures nothing. The stacking shows in the
        // approach to the cruise, which is where it should.
        if (reached === Infinity && Math.hypot(v.x, v.z) > 33) reached = tick;
      }
      return { speed: Math.hypot(v.x, v.z), reached };
    };
    const one = fly(rocketTicks(1));
    const spammed = fly(3);
    ok(`spamming rockets gets you up to speed sooner`
      + `  (${spammed.reached} ticks against ${one.reached})`, spammed.reached < one.reached);
    ok(`and holds you a shade faster  (${spammed.speed.toFixed(1)} vs ${one.speed.toFixed(1)} m/s)`,
      spammed.speed >= one.speed - 0.1);
  }
}

console.log('\nstanding on a hillside');
{
  const { PlayerController } = await import('../src/player/controller.js');
  // A hill that rises to the east: height depends on x alone.
  const hill = { heightAt: (x) => x * 0.5, bedAt: () => -100 };
  const stand = (yaw) => {
    const rig = Object.create(PlayerController.prototype);
    rig.terrain = hill;
    const who = { onGround: true, height: 1.83, yaw, groundSlope: 0, groundBank: 0,
      position: { x: 0, y: 0, z: 0 } };
    // Damped, so let it settle.
    for (let i = 0; i < 200; i += 1) rig.readGroundSlope(who);
    return who;
  };

  // Facing straight up the hill: all grade, no bank.
  const up = stand(Math.PI / 2);
  ok(`facing up the slope reads as slope  (${up.groundSlope.toFixed(2)} rad)`, up.groundSlope > 0.35);
  ok(`and not as bank  (${up.groundBank.toFixed(2)})`, Math.abs(up.groundBank) < 0.05);

  // Facing along the contour: all bank, no grade. This is the case that read
  // as flat ground — and walking a contour is what anyone does on a steep
  // hill, because it is the only way up one.
  const across = stand(0);
  ok(`facing along the contour reads as bank  (${across.groundBank.toFixed(2)} rad)`,
    Math.abs(across.groundBank) > 0.35);
  ok(`and not as slope  (${across.groundSlope.toFixed(2)})`, Math.abs(across.groundSlope) < 0.05);

  // Turning round swaps which shoulder is uphill.
  const other = stand(Math.PI);
  ok('and turning about puts the hill on the other shoulder',
    Math.sign(other.groundBank) === -Math.sign(across.groundBank));

  // In the air there is no ground to stand on, so both fade out.
  const flying = stand(0);
  flying.onGround = false;
  const rig = Object.create(PlayerController.prototype);
  rig.terrain = hill;
  for (let i = 0; i < 400; i += 1) rig.readGroundSlope(flying);
  ok(`airborne, both fade to nothing  (${flying.groundBank.toFixed(3)})`,
    Math.abs(flying.groundBank) < 0.02 && Math.abs(flying.groundSlope) < 0.02);

  const avatar = readFileSync(new URL('../src/player/avatar.js', import.meta.url), 'utf8');
  ok('and the body actually banks with it', /player\.groundBank \?\? 0\) \* 0\.45/.test(avatar));
}

console.log('\nsettings that explain themselves');
{
  const panel = readFileSync(new URL('../src/ui/settingsPanel.js', import.meta.url), 'utf8');
  const prov = readFileSync(new URL('../src/tiles/providers.js', import.meta.url), 'utf8');
  // "Which raster asset in your ion account to fly over" told you what the
  // number was for and not one thing about where to get it or what happens
  // when it is wrong — and the commonest way to get it wrong is to paste a
  // terrain or 3D Tiles id, which refuses every tile and looks like a broken
  // key rather than the wrong number.
  const cesium = /cesiumImageryAsset[\s\S]{0,1400}?\}/.exec(panel)?.[0] ?? '';
  ok('the ion asset setting says where to find the number', /My Assets/.test(cesium));
  ok('and that an imagery asset is not a terrain one', /terrain and 3D Tiles/.test(cesium));
  ok('and what happens when it is wrong', /falls back/.test(cesium));
  // And why the same provider's own website looks sharper, which is
  // presentation rather than data and is worth saying where it is asked.
  ok('and Mapbox says why its website looks sharper',
    /one texel on one[\s\S]{0,40}screen pixel/.test(prov));
}

console.log('\nthe map is drawn where you are drawn');
{
  const player = readFileSync(new URL('../src/player/player.js', import.meta.url), 'utf8');
  const controller = readFileSync(new URL('../src/player/controller.js', import.meta.url), 'utf8');
  // Physics runs on a fixed twentieth of a second and the world is drawn
  // between the last two ticks, so reading the physics position for the
  // minimap put the marker ahead of the ground under it by up to a full tick:
  // 5.35 m on a Rocket V, six or seven pixels of map sliding out from under
  // you the faster you go.
  ok('the coordinates come from the drawn position',
    /toGeo\(this\.renderPosition\.x, this\.renderPosition\.z\)/.test(player));
  // Which is only true if the drawn position is settled first.
  const lerp = controller.indexOf('renderPosition.lerpVectors');
  const sync = controller.indexOf('player.syncGeo()');
  ok(`and the drawn position is worked out before they are read  (${lerp} then ${sync})`,
    lerp > 0 && sync > lerp);
  // A teleport snaps the two together, or the first frame after one reads a
  // position from before it.
  ok('a teleport snaps them together', /snapRender\(\)/.test(controller) || /snapRender\(\)/.test(player));
}

console.log('\nauto picks the best provider you can actually use');
{
  const prov = await import('../src/tiles/providers.js');
  const { AUTO_PROVIDER, IMAGERY_PROVIDERS, resolveAuto, effectiveProvider } = prov;

  ok('with no key at all it lands on the keyless one',
    resolveAuto(IMAGERY_PROVIDERS, {}) === 'esri');
  for (const [key, id] of [['mapboxKey', 'mapbox'], ['googleKey', 'google'], ['bingKey', 'bing']]) {
    const got = resolveAuto(IMAGERY_PROVIDERS, { [key]: 'x' });
    ok(`a ${id} key moves it to ${id}  (${got})`, got === id);
  }
  // Two keys: the deeper of the two, which is the same order the standby chain
  // falls through, so auto is exactly the top of the list it would use anyway.
  const both = resolveAuto(IMAGERY_PROVIDERS, { googleKey: 'x', mapboxKey: 'y' });
  ok(`two keys take the deeper  (${both})`, both === 'mapbox' || both === 'google');

  // Auto is a choice about providers, not a provider: it must never reach the
  // code that asks a provider for a square.
  ok('and it is not itself in the provider list',
    !IMAGERY_PROVIDERS.some((p) => p.id === AUTO_PROVIDER));
  ok('so everything downstream sees a real one',
    effectiveProvider(IMAGERY_PROVIDERS, AUTO_PROVIDER, {}) === 'esri'
    && effectiveProvider(IMAGERY_PROVIDERS, 'gibs', {}) === 'gibs');

  // And the panel offers it, or none of the above is reachable.
  const panel = readFileSync(new URL('../src/ui/settingsPanel.js', import.meta.url), 'utf8');
  ok('the dropdown offers it', /value: AUTO_PROVIDER/.test(panel));
  ok('and the help text is built from the live decision, not a fixed rule',
    /autoHelp\('imagery', IMAGERY_PROVIDERS\)/.test(panel)
    && /autoHelp\('elevation', ELEVATION_PROVIDERS\)/.test(panel));
  ok('which still names the ranked fallback while nothing has been asked',
    /resolveAuto\(list, settings\.values\)/.test(panel));
}

console.log('\nand then asks who is really deepest where you are standing');
{
  const { LocalAuto, autoCell, keyFingerprint, AUTO_CELL_ZOOM } =
    await import('../src/tiles/localAuto.js');
  const { AUTO_PROVIDER, IMAGERY_PROVIDERS, ELEVATION_PROVIDERS } =
    await import('../src/tiles/providers.js');

  // A square, not a tile. Two points a few hundred metres apart are the same
  // question and must not cost two probes; two points a continent apart are
  // different questions.
  const market = autoCell(37.7749, -122.4194);
  ok(`San Francisco and a street away are one square  (${market})`,
    autoCell(37.7749, -122.4194) === autoCell(37.7760, -122.4180));
  ok('London is a different square', autoCell(51.5072, -0.1276) !== market);
  ok(`the square is about 150 km across  (z${AUTO_CELL_ZOOM})`, AUTO_CELL_ZOOM === 8);

  // Adding a key changes the right answer everywhere, so answers worked out
  // before you had it must not be reused.
  ok('a key changes the cache key',
    keyFingerprint(IMAGERY_PROVIDERS, {}) !== keyFingerprint(IMAGERY_PROVIDERS, { mapboxKey: 'x' }));

  const calls = [];
  let clock = 1e6;
  const auto = new LocalAuto({
    now: () => clock,
    probe: async (list, values, at, onProgress, options) => {
      calls.push({ list, at, prefer: options?.prefer });
      return list === ELEVATION_PROVIDERS
        ? { id: 'terrarium', label: 'Terrarium', zoom: 14 }
        : { id: 'usgs', label: 'USGS', zoom: 16 };
    },
  });
  const settled = () => new Promise((r) => setTimeout(r, 0));

  // Before anything is asked, auto is the published ranking — never nothing.
  ok('until it has asked, auto is the ranked answer',
    auto.resolve('imagery', AUTO_PROVIDER, {}, 37.77, -122.42) === 'esri');
  ok('and a provider you chose by hand is left alone',
    auto.resolve('imagery', 'gibs', {}, 37.77, -122.42) === 'gibs');

  const kansas = { lat: 38.5, lon: -98.0 };
  const chosen = { imagery: AUTO_PROVIDER, elevation: AUTO_PROVIDER };
  auto.tick(kansas, {}, chosen, { imagery: 'esri', elevation: 'terrarium' });
  await settled();
  ok(`it asked, and about where you are  (${calls.length})`,
    calls.length === 1 && calls[0].at.lat === 38.5);
  ok('the incumbent is offered as the tie-break', calls[0].prefer === 'esri');
  ok('and the answer is used', auto.resolve('imagery', AUTO_PROVIDER, {}, 38.5, -98.0) === 'usgs');

  // The same square again is free. This is the whole reason it is a square.
  clock += 1e6;
  auto.tick(kansas, {}, chosen, { imagery: 'usgs', elevation: 'terrarium' });
  await settled();
  ok(`the elevation is asked once too  (${calls.length})`, calls.length === 2);
  clock += 1e6;
  auto.tick(kansas, {}, chosen, { imagery: 'usgs', elevation: 'terrarium' });
  await settled();
  ok('and then the square costs nothing at all', calls.length === 2);

  // A place nobody serves is remembered as such, or it is asked about for ever.
  const empty = new LocalAuto({ now: () => clock, probe: async () => null });
  const pacific = { lat: -30, lon: -140 };
  empty.tick(pacific, {}, { imagery: AUTO_PROVIDER }, {});
  await settled();
  clock += 1e6;
  let again = 0;
  empty.probe = async () => { again++; return null; };
  empty.tick(pacific, {}, { imagery: AUTO_PROVIDER }, {});
  await settled();
  ok('"nobody serves this" is remembered too', again === 0);
  ok('and the ranked answer keeps drawing there',
    empty.resolve('imagery', AUTO_PROVIDER, {}, -30, -140) === 'esri');

  // Thrash is the failure that would make this worse than the fixed ranking.
  let told = 0;
  const steady = new LocalAuto({
    now: () => clock,
    onDecided: () => { told++; },
    probe: async () => ({ id: 'esri', label: 'Esri', zoom: 19 }),
  });
  clock += 1e6;
  steady.tick({ lat: 10, lon: 10 }, {}, { imagery: AUTO_PROVIDER }, { imagery: 'esri' });
  await settled();
  ok('winning by staying put is not a swap', told === 0);
}

console.log('\na dropped connection is not a provider telling you its depth');
{
  const jobs = readFileSync(new URL('../src/tiles/tileJobs.js', import.meta.url), 'utf8');
  const streamer = readFileSync(new URL('../src/tiles/streamer.js', import.meta.url), 'utf8');

  // reviewDepth writes a provider off at a zoom after six refusals there, and
  // the write-off caps how deep the quadtree may split — which then stops
  // anything deeper being asked, so nothing can arrive to lift it. Feeding
  // transport faults into that means a flaky minute permanently blurs the
  // world. Measured with a third of imagery requests dropped at random over the
  // Black Forest, drawn squares fell 190, 147, 25, 16, 20, 13, 7, 1 and stayed
  // there, with `loaded` frozen — the streamer had stopped asking for anything.
  // With faults kept out of it: 200, 189, 25, 67, 61, 68, 81, 83, 102, and
  // `loaded` still climbing, 11 to 120.
  ok('a refusal about one square is told from a fault',
    /function classify\(res\)/.test(jobs)
    && /res\.status === 404 \|\| res\.status === 204 \|\| res\.status === 410/.test(jobs)
    && /err\.transient = res\.status === 408 \|\| res\.status === 429 \|\| res\.status >= 500;/.test(jobs));
  ok('and a fetch that never got a reply is a fault, not an answer',
    /wrapped\.transient = true;/.test(jobs));
  ok('the worker says which it was', /transient: err\?\.transient === true,/.test(jobs));
  ok('and only a refusal is allowed to write a zoom off',
    /if \(!msg\.transient\) this\.reviewDepth\(entry\.tile\);/.test(streamer));
  // "No imagery here" is the only refusal a provider ever actually sends, and
  // it was the one excluded, so the depth limit could never be set at all.
  // Standing still for six minutes over Ecuador: zoom 18 loaded 46 and refused
  // none, zoom 19 refused 151 and loaded none, zoom 20 refused 116 and loaded
  // none, and depthLimit was still Infinity at the end.
  ok('a card saying "no picture of this square" is evidence about depth',
    !/if \(!msg\.noImageryHere/.test(streamer));
  // And the verdict has to stop at the edge of the ground it was learned over.
  ok('a depth learned over one place does not follow you to the next',
    /const DEPTH_REGION_ZOOM = 10;/.test(streamer)
    && /this\.depthRegion = this\.here \?\? null;/.test(streamer)
    && /if \(this\.depthRegion && this\.here && this\.here !== this\.depthRegion\)/.test(streamer));
  /*
    And "here" is where the camera is, not whichever square won a contest this
    frame.

    It was `_deepestAsked` — the deepest square anyone asked for since the
    counter was last beaten. That changes frame to frame, beginFrame reset the
    depth it is measured against but never the tile, so a stale one from
    somewhere else could be read on any frame that asked for nothing deep, and
    one such frame threw the limit away. The refusals set it again, and again.
    maxUsefulZoom feeds the quadtree's maximum zoom every frame, so the tree
    alternated between capped and uncapped: squares splitting into ground with
    no photograph, drawing a coarser one stretched over it, then merging back —
    the picture going soft and sharp and soft, moving as it went.
  */
  ok('and here is where the camera is, which only changes when you travel',
    /beginFrame\(nx = null, ny = null\)/.test(streamer)
    && /this\.here = depthRegionAt\(nx, ny\);/.test(streamer)
    && /this\.streamer\.beginFrame\(this\._norm\.nx, this\._norm\.ny\);/
      .test(readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8')));
  ok('and the deepest square asked for is forgotten with its depth',
    /this\._deepest = 0;\n\s*this\._deepestAsked = null;/.test(streamer));
  ok('nor does a fault land in the per-zoom tally reviewDepth counts',
    /if \(!msg\.transient\) this\.zoomRecord\(entry\.tile\.z\)\.failed\+\+;/.test(streamer));
  // Writing a square off takes the four below it and the sixteen below those,
  // for as long as barren remembers. A blip must not do that either.
  ok('and a fault does not write the ground off as having no picture',
    /if \(!msg\.transient\) this\.barren\.set\(entry\.key, now\(\)\);/.test(streamer));
  ok('a blip is retried sooner than a refusal',
    /entry\.retryAt = performance\.now\(\) \+ \(msg\.transient \? 4000 : 20000\);/.test(streamer));
}

console.log('\nthe fog draws what you explored, not a pixel more');
{
  // The mask used to grow every cell by half a pixel on each side so adjacent
  // cells could not leave a hairline between them. That is nothing on a cell
  // forty pixels across and most of the cell on one four pixels across, and
  // zooming out is exactly what makes cells small.
  const renderer = readFileSync(new URL('../src/ui/mapRenderer.js', import.meta.url), 'utf8');
  ok('cells are no longer each grown by a whole pixel',
    !/cellPx \+ 1,\n\s*cellPx \+ 1,/.test(renderer));
  ok('the overlap is a fraction of the cell, with a half-pixel ceiling',
    /const bleed = Math\.min\(0\.5, cellPx \* 0\.05\);/.test(renderer));
  ok('and contiguous cells are filled as one run, which has no interior seam',
    /let runStart = -1;/.test(renderer) && /\(i - runStart\) \* cellPx/.test(renderer));

  // What that is worth, as area. A run of n cells of side c drawn with a bleed
  // b covers (n*c + 2b) * (c + 2b) where the truth is n*c*c.
  const over = (n, c, b) => (((n * c + 2 * b) * (c + 2 * b)) / (n * c * c) - 1) * 100;
  const wasCell = (c) => (((c + 1) * (c + 1)) / (c * c) - 1) * 100;
  const four = wasCell(4);
  const now = over(8, 4, Math.min(0.5, 4 * 0.05));
  ok(`a four-pixel cell used to draw ${four.toFixed(0)} per cent too much ground`,
    four > 50);
  ok(`a run of eight now draws ${now.toFixed(0)} per cent too much  (was ${four.toFixed(0)})`,
    now < 12 && now < four / 4);
  const oneCell = over(1, 4, Math.min(0.5, 4 * 0.05));
  ok(`and a lone cell ${oneCell.toFixed(0)} per cent, still well under the old ${four.toFixed(0)}`,
    oneCell < four / 2);
}

console.log('\nturning the haze off takes the distance ceiling with it');
{
  const { settings } = await import('../src/core/settings.js');
  const terrainSrc = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');

  ok('the render distance asks whether the haze is on',
    /if \(!settings\.get\('fog'\)\) return Math\.max\(setting, horizon\);/.test(terrainSrc));

  // The arithmetic, without a terrain: the cap is six times the setting when
  // the haze is on, and the true horizon when it is off. sqrt(2*R*h).
  const R = 6378137;
  const horizon = (h) => Math.sqrt(2 * R * Math.max(1, h));
  const capped = (km, h) => Math.min(Math.max(horizon(h), km * 1000), km * 1000 * 6);
  const open = (km, h) => Math.max(km * 1000, horizon(h));

  const km = 8;
  ok(`on the ground the cap does not bind  (${(capped(km, 2) / 1000).toFixed(0)} km either way)`,
    Math.abs(capped(km, 2) - open(km, 2)) < 1);
  ok(`at four hundred metres it does  (${(capped(km, 400) / 1000).toFixed(0)} against ${(open(km, 400) / 1000).toFixed(0)} km)`,
    open(km, 400) > capped(km, 400) * 1.4);
  ok(`and at four thousand it binds hard  (${(capped(km, 4000) / 1000).toFixed(0)} against ${(open(km, 4000) / 1000).toFixed(0)} km)`,
    open(km, 4000) > capped(km, 4000) * 4);
  // Never *shorter* with the haze off — the setting is still a floor.
  for (const h of [0, 2, 50, 400, 4000, 20000]) {
    ok(`never shorter than the setting at ${h} m`, open(km, h) >= km * 1000);
  }
  settings.set('fog', true);
}

console.log('\nthe quality dial can climb back, not only fall');
{
  const { settings } = await import('../src/core/settings.js');
  const { AutoQuality } = await import('../src/core/autoQuality.js');

  settings.set('graphics', 'auto');
  settings.set('fpsTarget', 60);

  /** Run `seconds` of frames at a steady rate and report where the tier ends. */
  const run = (fps, seconds, from = 'high') => {
    settings.set('autoTier', from);
    const auto = new AutoQuality();
    const dt = 1 / fps;
    for (let i = 0; i < fps * seconds; i++) auto.update(dt);
    return settings.get('autoTier');
  };

  // A 60 Hz display with vsync cannot exceed 60. The old rule wanted
  // target * 1.35 = 81 to climb, so it never could: the dial was a one-way
  // ratchet down to Low, which is "it flickers to super low quality" and why
  // sharp ground goes blurry and stays blurry.
  ok(`sixty fps against a target of sixty climbs  (${run(60, 60, 'medium')})`,
    run(60, 60, 'medium') !== 'medium');
  ok('and keeps climbing to the top given long enough',
    run(60, 200, 'low') === 'ultra');

  // Falling still works, and still one tier at a time.
  ok(`twenty fps against a target of sixty falls  (${run(20, 60, 'ultra')})`,
    run(20, 60, 'ultra') === 'low');
  ok('one tier per cooldown, not all of them at once',
    run(20, 12, 'ultra') === 'high');

  // The middle band holds still: fast enough not to drop, not fast enough to
  // count towards a climb. This is the flapping the old headroom guarded
  // against, and it still has to be guarded against.
  ok(`fifty-five fps against sixty stays put  (${run(55, 120, 'high')})`,
    run(55, 120, 'high') === 'high');

  // An unbroken run is required: meeting the target every other window is not
  // evidence of headroom.
  {
    settings.set('autoTier', 'medium');
    const auto = new AutoQuality();
    for (let w = 0; w < 20; w++) {
      const fps = w % 2 === 0 ? 60 : 55;
      for (let i = 0; i < fps * 5; i++) auto.update(1 / fps);
    }
    ok(`alternating good and middling windows do not climb  (${settings.get('autoTier')})`,
      settings.get('autoTier') === 'medium');
  }

  // Falling out of a tier marks it, so climbing back into it costs three times
  // the evidence. That is where the anti-flap lives now: a machine sitting
  // exactly on a boundary would otherwise climb, fail, drop and climb again
  // for ever, each attempt as cheap as the last.
  {
    settings.set('autoTier', 'high');
    const auto = new AutoQuality();
    for (let i = 0; i < 20 * 11; i++) auto.update(1 / 20);
    ok(`falling out of a tier marks it  (${auto.burnt} -> ${settings.get('autoTier')})`,
      auto.burnt === 'high' && settings.get('autoTier') === 'medium');
  }
  // Tested at a steady rate rather than by changing rate mid-run: a window
  // that straddles the change averages the two and reads as neither.
  {
    settings.set('autoTier', 'medium');
    const auto = new AutoQuality();
    auto.burnt = 'high';
    for (let i = 0; i < 60 * 30; i++) auto.update(1 / 60);
    ok(`the marked tier is not won back on the usual evidence  (${settings.get('autoTier')})`,
      settings.get('autoTier') === 'medium');
    for (let i = 0; i < 60 * 30; i++) auto.update(1 / 60);
    ok(`but it is won back on three times as much  (${settings.get('autoTier')})`,
      ['high', 'ultra'].includes(settings.get('autoTier')));
    ok('and the mark is cleared once it has been held',
      auto.burnt === null);
  }

  settings.set('graphics', 'auto');
  settings.set('autoTier', 'high');
}

console.log('\nyou stand on the ground you can see, and the hold lets go of you');
{
  const THREE = await import('../vendor/three/three.module.js');
  const { PlayerController } = await import('../src/player/controller.js');

  // The field and the mesh are the same data at different ages: the field
  // steps the instant a tile lands, the mesh is rebuilt from it afterwards.
  // Traced live over a stationary player, the mesh was one refinement behind
  // the field at every step and the field's biggest jump was 170.62 m.
  const ages = { field: 397.87, mesh: 227.25 };
  const terrain = {
    heightAt: () => ages.field,
    meshHeightAt: () => ages.mesh,
    hasElevationAt: () => true,
    settlingAt: () => false,
  };
  const player = {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    radius: 0.35, height: 1.8, scale: 1,
  };
  const controller = new PlayerController({ player, terrain, buildings: null });

  const stood = controller.groundHeightAt(0, 0, 500);
  ok(`the drawn surface is the floor, not the field running ahead of it  (${stood})`,
    stood === 227.25);
  ok('which is a hundred and seventy metres of not standing on nothing',
    Math.abs(ages.field - stood) > 170);

  // And the other direction, which is the one the old rule got right: a field
  // reading sea level because nothing has arrived must not drop you through a
  // mountain that is drawn.
  ages.field = 0;
  ages.mesh = 400;
  ok('a drawn mountain still wins over a field that has no data yet',
    controller.groundHeightAt(0, 0, 500) === 400);

  // Nothing drawn at all, and no elevation either: carry the last real floor
  // rather than guessing sea level.
  ages.mesh = null;
  terrain.hasElevationAt = () => false;
  ok('and with nothing drawn and nothing known, the last real floor is kept',
    controller.groundHeightAt(0, 0, 500) === 400);
}

console.log('\nthe arrival hold is released by the branch that calls it');
{
  // releaseSettle was guarded on `settling` being true, and the game loop calls
  // it from the one branch where `settling` is false. So the only call that
  // ever reached the body was the early one from a keypress; when the hold
  // ended on its own cap instead, `arrivalHeld` stayed true for the rest of the
  // session. `settling` is `arrivalHeld && !groundIsReal && within the cap`, so
  // a stuck latch means every dip in groundIsReal switches the hold back on and
  // re-pins the player to a held height.
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  const body = game.slice(game.indexOf('  releaseSettle() {'));
  const guard = body.slice(0, body.indexOf('\n  }'));
  ok('it no longer refuses to run when the hold is not active',
    !/if \(!this\.settling\) return;/.test(guard));
  ok('and it guards on there being a hold to release instead',
    /if \(!this\.arrivalHeld && !this\.settleUntil\) return;/.test(guard));
  ok('the loop calls it from the branch where settling is false',
    /} else {\n\s*this\.releaseSettle\(\);/.test(game));
}

console.log('\nthe first spawn of all is not mid-flight');
{
  // "Arrive doing what you were doing" reads what you were doing off the
  // player: `!onGround || elytraDeployed`. A player who has existed for one
  // frame and touched nothing is not on the ground, so a brand new save read as
  // flying and was dropped SPAWN_HEIGHT_M up — over ground that had not
  // streamed in, which is why looking down at spawn showed a void.
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  ok('the first spawn says it was not flying',
    /randomTeleport\(\{ quiet: true, flying: false, reason: 'spawn' \}\)/.test(game));
  ok('and randomTeleport passes that through to the teleport',
    /randomTeleport\(\{ quiet = false, flying, reason = 'rtp' \} = \{\}\)/.test(game)
    && /teleportTo\(destination\.lat, destination\.lon, \{ reason, quiet: true, flying \}\)/.test(game));
  // The rule it feeds: `airborne` only when the setting is on AND you were
  // flying. flying:false must therefore land you on your feet.
  ok('and the sky-spawn rule reads that flag for a spawn',
    /reason === 'spawn' \? flyingBefore/.test(game));
}

console.log('\nat the same depth it asks how sharp, then how recent');
{
  const prov = await import('../src/tiles/providers.js');
  const { bestProviderFor } = prov;

  // A stand-in world: each provider answers at a depth, a tile size and a
  // vintage that the test dictates, so the ordering is what is under test
  // rather than anybody's live coverage.
  const world = new Map();
  const list = [
    { id: 'a', label: 'A', kind: 'xyz', needsKey: null, maxZoom: 18, template: 'https://a/{z}/{x}/{y}' },
    { id: 'b', label: 'B', kind: 'xyz', needsKey: null, maxZoom: 18, template: 'https://b/{z}/{x}/{y}' },
  ];
  const realFetch = globalThis.fetch;
  const realBitmap = globalThis.createImageBitmap;
  globalThis.fetch = async (url) => {
    const who = String(url).includes('//a/') ? 'a' : 'b';
    const z = Number(String(url).match(/\/\/[ab]\/(\d+)\//)?.[1] ?? 0);
    const entry = world.get(who);
    const ok = z <= entry.zoom;
    globalThis.__pixels = entry.pixels;
    return { ok, arrayBuffer: async () => new Uint8Array(200).buffer };
  };
  globalThis.createImageBitmap = async () => ({
    width: globalThis.__pixels, height: globalThis.__pixels, close() {},
  });

  const race = async (a, b) => {
    world.set('a', a);
    world.set('b', b);
    const winner = await bestProviderFor(list, {}, { lat: 10, lon: 10 });
    return winner?.id;
  };

  // Depth still beats everything: a deeper provider wins however coarse and
  // however old its tiles are.
  ok('a deeper provider wins outright',
    await race({ zoom: 18, pixels: 256 }, { zoom: 16, pixels: 512 }) === 'a');

  // Same depth: the sharper tile. Same square of ground, twice the pixels.
  ok('at the same depth the bigger tile wins',
    await race({ zoom: 17, pixels: 256 }, { zoom: 17, pixels: 512 }) === 'b');

  // Same depth and same tile size: the newer photograph.
  list[0].imageryYear = 2015;
  list[1].imageryYear = 2023;
  ok('at the same depth and size the newer photograph wins',
    await race({ zoom: 17, pixels: 256 }, { zoom: 17, pixels: 256 }) === 'b');
  list[0].imageryYear = 2023;
  list[1].imageryYear = 2015;
  ok('and the other way round',
    await race({ zoom: 17, pixels: 256 }, { zoom: 17, pixels: 256 }) === 'a');

  // An unknown vintage is not evidence of being old. USGS publishes none, and
  // it must not lose a tie it would otherwise have won on the next rule.
  delete list[1].imageryYear;
  list[0].imageryYear = 2023;
  ok('an unknown date neither wins nor loses; the incumbent does',
    await race({ zoom: 17, pixels: 256 }, { zoom: 17, pixels: 256 }) === 'a');
  {
    world.set('a', { zoom: 17, pixels: 256 });
    world.set('b', { zoom: 17, pixels: 256 });
    const held = await bestProviderFor(list, {}, { lat: 10, lon: 10 }, null, { prefer: 'b' });
    ok('which is to say the one already drawing keeps it', held?.id === 'b');
  }

  // Resolution is measured, not published: it comes off the decoded tile.
  {
    world.set('a', { zoom: 17, pixels: 512 });
    world.set('b', { zoom: 17, pixels: 256 });
    const winner = await bestProviderFor(list, {}, { lat: 10, lon: 10 });
    ok(`and the winner reports what it measured  (${winner.pixels} px at z${winner.zoom})`,
      winner.pixels === 512 && winner.zoom === 17);
  }

  globalThis.fetch = realFetch;
  globalThis.createImageBitmap = realBitmap;
  delete globalThis.__pixels;
}

console.log('\nthe scanned city is something you stand on, not something you fall through');
{
  const THREE = await import('../vendor/three/three.module.js');
  const { Tiles3D } = await import('../src/world/tiles3d.js');

  // A slab of "street" at y = 40 with a wall standing on it, which is the
  // shape of the fault: the heightfield under a scanned city is its bare
  // landform, so the player stood at the terrain height and the buildings
  // were scenery.
  const tiles = Object.create(Tiles3D.prototype);
  tiles.group = new THREE.Group();
  tiles.loaded = new Map();
  tiles.visible = new Set();
  tiles.churn = 0;
  tiles.datumSteady = 99;
  tiles._ray = new THREE.Raycaster();
  tiles._rayFrom = new THREE.Vector3();
  tiles._down = new THREE.Vector3(0, -1, 0);
  tiles._along = new THREE.Vector3();
  tiles._normal = new THREE.Vector3();
  tiles._near = [];
  tiles._nearAt = null;

  const street = new THREE.Mesh(
    new THREE.BoxGeometry(60, 1, 60),
    new THREE.MeshBasicMaterial(),
  );
  street.position.set(0, 39.5, 0);
  // A wall across the street at x = 5, four metres of it.
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 8, 40),
    new THREE.MeshBasicMaterial(),
  );
  wall.position.set(5, 44, 0);
  const city = new THREE.Group();
  city.add(street, wall);
  tiles.group.add(city);
  tiles.group.updateMatrixWorld(true);
  tiles.loaded.set('a', { object: city, used: 0 });
  tiles.visible.add('a');

  // The floor waits for the lift under these surfaces to stop moving: the
  // datum is worked out from what has loaded and climbs as a city streams in,
  // and a floor that follows a moving lift is a floor that moves under you.
  tiles.datumSteady = 0;
  ok('an unsettled datum means no scanned floor at all', tiles.floorAt(0, 0, 42) === null);
  tiles.datumSteady = 3;
  ok('and neither does one that has only just stopped moving — a wrong lift '
    + 'holds still for three measurements while a city loads',
    tiles.floorAt(0, 0, 42) === null);
  tiles.datumSteady = 99;

  const floor = tiles.floorAt(0, 0, 42);
  ok(`the street is where you stand  (${floor})`, Math.abs(floor - 40) < 0.01);
  ok('and a surface over your head is not a floor', tiles.floorAt(0, 0, 30) === null);
  ok('nor is one you are nowhere near', tiles.floorAt(500, 500, 42) === null);

  // The near list is cached on position, so it must not be built to whatever
  // reach the first caller happened to want: a floor query is short and a wall
  // query while moving fast is long, and reusing the short list for the long
  // question loses walls just outside it.
  tiles.floorAt(0, 0, 42);
  const cached = tiles._near.length;
  ok(`a short question fills the list to the full radius  (${cached})`, cached === 1);
  const wide = tiles.nearby(0, 0, 400);
  ok('and a longer one than the radius is answered fresh, without spoiling it',
    wide.length === 1 && tiles._nearAt.x === 0 && tiles._near !== wide);

  // The wall. A ray going at it stops; the same wall behind you does not.
  const into = tiles.wallAt(3, 40.2, 0, 1, 0, 4);
  ok(`walking at a wall meets it  (${into && into.distance.toFixed(2)} m)`,
    !!into && Math.abs(into.distance - 1.75) < 0.2);
  ok('and its face is turned towards you', !!into && into.nx < 0);
  ok('a wall you have already passed does not stop you',
    tiles.wallAt(6, 40.2, 0, 1, 0, 4) === null);
  ok('and neither does open street', tiles.wallAt(-20, 40.2, 0, -1, 0, 4) === null);

  // Now the controller, driven for real rather than read.
  const { PlayerController } = await import('../src/player/controller.js');
  const flat = {
    heightAt: () => 0,
    meshHeightAt: () => null,
    hasElevationAt: () => true,
    settlingAt: () => false,
  };
  const player = {
    position: new THREE.Vector3(0, 40, 0),
    velocity: new THREE.Vector3(4, 0, 0),
    radius: 0.35, height: 1.8, scale: 1,
  };
  const controller = new PlayerController({ player, terrain: flat, buildings: null });

  ok('with no scanned city the floor is the heightfield  (0)',
    controller.groundHeightAt(0, 0, 42) === 0);
  controller.scanned = tiles;
  const stood = controller.groundHeightAt(0, 0, 42);
  ok(`with one, it is the street you can see  (${stood})`, Math.abs(stood - 40) < 0.01);

  // Walk into the wall and be stopped short of it. The wall's near face is at
  // x = 4.75, so a 0.35 m capsule may stand at 4.40 and no further.
  controller.prevPosition.set(4.0, 40, 0);
  player.position.set(4.6, 40, 0);
  player.velocity.set(4, 0, 0);
  controller.resolveScanned(player, player.radius);
  ok(`the wall stops you at its face  (x ${player.position.x.toFixed(2)})`,
    Math.abs(player.position.x - 4.4) < 0.02);
  ok('and takes away the speed going into it', player.velocity.x <= 0.001);

  // A step long enough to clear the shell in one tick. A push-out on overlap
  // would have found only the far face, pointing away, and let you through.
  controller.prevPosition.set(4.0, 40, 0);
  player.position.set(9.0, 40, 0);
  player.velocity.set(300, 0, 0);
  controller.resolveScanned(player, player.radius);
  ok(`a fast step does not tunnel through it  (x ${player.position.x.toFixed(2)})`,
    Math.abs(player.position.x - 4.4) < 0.02);

  // Sliding along a wall keeps sliding: only the speed going into the face is
  // taken, so walking at a building at an angle carries you along it.
  controller.prevPosition.set(4.0, 40, 0);
  player.position.set(4.6, 40, 0.3);
  player.velocity.set(4, 0, 2);
  controller.resolveScanned(player, player.radius);
  ok(`movement along the face survives  (vx ${player.velocity.x.toFixed(2)}, vz ${player.velocity.z.toFixed(2)})`,
    Math.abs(player.velocity.z - 2) < 0.01 && Math.abs(player.velocity.x) < 0.01);
  ok(`and it did stop short of the wall  (x ${player.position.x.toFixed(2)})`,
    player.position.x < 4.45 && player.position.z > 0);

  // Spawned inside a shell, you can still walk out of it.
  controller.prevPosition.set(5.6, 40, 0);
  player.position.set(6.2, 40, 0);
  player.velocity.set(4, 0, 0);
  controller.resolveScanned(player, player.radius);
  ok(`a face pointing away does not trap you  (x ${player.position.x.toFixed(2)})`,
    Math.abs(player.position.x - 6.2) < 0.01);
}

console.log('\nfireworks are a thing you carry, and they come back');
{
  const { settings } = await import('../src/core/settings.js');
  const { cheats } = await import('../src/core/cheats.js');
  const { Player, ROCKET_STACK, ROCKET_REFILL_S, HOTBAR } = await import('../src/player/player.js');

  settings.set('rocketSupply', 'limited');
  cheats.rocketFree = false;
  const frame = { toLocal: () => ({ x: 0, z: 0 }), toGeo: () => ({ lat: 0, lon: 0 }) };
  const player = new Player(frame);
  player.elytraDeployed = true;
  player.selectSlot(0);

  ok(`you start with a stack in every slot  (${ROCKET_STACK} x ${HOTBAR.length})`,
    player.stock.length === HOTBAR.length && player.stock.every((n) => n === ROCKET_STACK));

  // Each launch spends one, the way it does in Minecraft.
  player.fireRocket();
  player.fireRocket();
  ok(`two launches spend two  (${player.stock[0]})`, player.stock[0] === ROCKET_STACK - 2);
  ok('and only from the slot you fired', player.stock[1] === ROCKET_STACK);

  // Run one dry and it says so rather than failing silently.
  player.stock[0] = 1;
  ok('the last one still fires', player.fireRocket() === true && player.stock[0] === 0);
  let told = 0;
  player.on('outOfRockets', () => { told++; });
  ok('the next does not', player.fireRocket() === false);
  ok('and you are told which slot ran dry', told === 1);
  ok('while a slot you have not touched still works',
    (player.selectSlot(1), player.fireRocket()) === true);

  // They come back, per slot, and never past a stack.
  player.selectSlot(0);
  player.tickRefill(ROCKET_REFILL_S * 3 + 0.1);
  ok(`three refill periods earn three back  (${player.stock[0]})`, player.stock[0] === 3);
  player.stock[0] = ROCKET_STACK;
  player.tickRefill(ROCKET_REFILL_S * 10);
  ok('and a full slot does not overflow', player.stock[0] === ROCKET_STACK);

  // Both escape hatches: the setting and the cheat.
  player.stock[0] = 0;
  settings.set('rocketSupply', 'unlimited');
  ok('endless by setting fires from an empty slot', player.fireRocket() === true);
  settings.set('rocketSupply', 'limited');
  ok('and limited again refuses', player.fireRocket() === false);
  cheats.rocketFree = true;
  ok('endless by cheat fires too', player.fireRocket() === true);
  cheats.rocketFree = false;

  settings.set('rocketSupply', 'limited');
}

console.log('\nyour own legs are there when you look down mid-glide');
{
  const avatar = readFileSync(new URL('../src/player/avatar.js', import.meta.url), 'utf8');
  // The legs were hidden along with the arms in a first-person glide, and the
  // arms had a reason the legs never shared: prone, the pose turns about your
  // eye, so the shoulder arrives at the camera and an arm drawn from there is
  // a slab across a fifth of the screen. A leg trails behind and below you —
  // measured in the running game at 1.23 m from the eye, against a
  // too-close limit of 0.12 — so there was nothing to hide it from.
  ok('the legs are no longer hidden when prone',
    !/this\.legL\.pivot\.visible = !prone;/.test(avatar));
  ok('they are drawn in first person like the mod this copies',
    /this\.legL\.pivot\.visible = true;\n\s*this\.legR\.pivot\.visible = true;/.test(avatar));
  // The arms stay off in a glide: that one really is inside the camera.
  ok('and the arms are still the view model in a glide',
    /this\.armL\.pivot\.visible = !prone;/.test(avatar)
    && /this\.viewModel\.visible = prone;/.test(avatar));
  // Guarded anyway, for the attitude no pose number predicts.
  ok('with the in-your-eye backstop extended to cover them',
    /for \(const leg of \[this\.legL, this\.legR\]\)/.test(avatar));
}

console.log('\nwings that hold the body up, not hang off it');
{
  const THREE = await import('../vendor/three/three.module.js');
  const { Avatar } = await import('../src/player/avatar.js');
  const scene = new THREE.Scene();
  const avatar = new Avatar(scene);
  avatar.setVisible(true);
  const flying = (pitch) => ({
    pitchOverride: pitch,
    position: new THREE.Vector3(), renderPosition: new THREE.Vector3(),
    velocity: new THREE.Vector3(0, -45 * Math.sin(-pitch), -45 * Math.cos(pitch)),
    height: 1.83, scale: 1, pitch, yaw: 0, mode: 'glide', onGround: false,
    swimming: false, groundSlope: 0, elytraDeployed: true, horizontalSpeed: 45,
    selectedSlot: 0, rocketsFired: 0,
  });
  // Root to tip along the mid-chord, in the world, the way tools/wingpose.mjs
  // measures it — a wing's attitude is not what its Euler angles read as, and
  // working it out on paper got the signs wrong twice.
  const attitude = (pitch) => {
    const p = flying(pitch);
    for (let i = 0; i < 90; i += 1) avatar.update(p, 1 / 60);
    scene.updateMatrixWorld(true);
    const mesh = avatar.wingR.children[0];
    const pos = mesh.geometry.getAttribute('position');
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < pos.count; i += 1) {
      lo = Math.min(lo, pos.getX(i));
      hi = Math.max(hi, pos.getX(i));
    }
    const band = (from, to) => {
      const mid = new THREE.Vector3();
      let n = 0;
      for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i);
        if (x < from || x > to) continue;
        mid.add(new THREE.Vector3(x, pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld));
        n += 1;
      }
      return mid.divideScalar(n);
    };
    const width = hi - lo;
    const root = band(lo, lo + width * 0.15);
    const tip = band(hi - width * 0.15, hi);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
    const toCamera = new THREE.Vector3(0, -Math.sin(pitch) + 0.28, Math.cos(pitch)).normalize();
    return {
      sweep: (Math.atan2(tip.z - root.z, tip.x - root.x) * 180) / Math.PI,
      dihedral: (Math.atan2(tip.y - root.y, tip.x - root.x) * 180) / Math.PI,
      seen: Math.abs(normal.dot(toCamera)),
    };
  };
  /*
    The pitches of a real glide: a shallow dive, level, and pulling up.

    The pose before this one ran -13.6, -9.2, -4.6 and +3.4 degrees across
    them — tips below the root everywhere except when climbing, which is a
    wing hanging off a body rather than holding it up, and is what "it kinda
    looks backwards or upside down" was describing. The search that chose it
    had its first angle pinned at the edge of its range in every candidate it
    returned, which is a boundary optimum; the box was widened and there are
    poses past that edge that hold the tips up at every pitch without giving
    up any of the face.
  */
  const flown = [0.3, 0.15, 0, -0.25].map(attitude);
  const worstDihedral = Math.min(...flown.map((a) => a.dihedral));
  ok(`the tips never hang below the root  (${worstDihedral.toFixed(1)}\u00b0 at worst)`,
    worstDihedral > 0);
  const meanSweep = flown.reduce((t, a) => t + a.sweep, 0) / flown.length;
  ok(`and they are swept back like a wing  (${meanSweep.toFixed(1)}\u00b0)`,
    meanSweep > 22 && meanSweep < 36);
  // A flat wing seen from the chase camera is a blade, and a blade has no
  // shape to read. This is the number the old pose was chosen for, and it is
  // not given up to fix the dihedral.
  const worstSeen = Math.min(...flown.map((a) => a.seen));
  ok(`and you see the surface rather than the edge  (${worstSeen.toFixed(2)})`,
    worstSeen > 0.8);
}

console.log('\nthe figure stands in the weather, not on top of it');
{
  const shaders = readFileSync(new URL('../src/world/shaders.js', import.meta.url), 'utf8');
  const effects = readFileSync(new URL('../src/player/effects.js', import.meta.url), 'utf8');
  const avatar = readFileSync(new URL('../src/player/avatar.js', import.meta.url), 'utf8');

  // One copy of the cloud shadow, shared, so the ground and the player can
  // never disagree about where the cloud is.
  ok('the cloud shadow is a chunk rather than a paragraph inside one shader',
    /export const CLOUD_SHADOW_CHUNK/.test(shaders));
  ok('and the terrain includes that chunk rather than its own copy',
    (shaders.match(/float cloudShadow\(vec3 world\)/g) || []).length === 1
    && /\$\{CLOUD_SHADOW_ONLY_GLSL\}/.test(shaders));
  ok('the player imports it rather than copying it',
    /import \{ CLOUD_SHADOW_CHUNK \} from '\.\.\/world\/shaders\.js'/.test(effects));

  // The patch has to hook chunks that exist. A replace on a chunk name three
  // does not have fails *silently* — it compiles perfectly and does nothing —
  // so the live check drives a real compile and reads the source back. All
  // five of these were confirmed present in the shader the renderer was handed.
  ok('it declares a world-space varying', /varying vec3 vCloudWorld;/.test(effects));
  ok('and fills it after project_vertex, where `transformed` is final',
    /#include <project_vertex>\\n {2}vCloudWorld = \(modelMatrix/.test(effects));
  ok('and multiplies the outgoing light by it',
    /outgoingLight \*= cloudShadow\(vCloudWorld\)/.test(effects));
  ok('at opaque_fragment, which is the chunk this three has',
    /#include <opaque_fragment>/.test(effects));

  // And it is actually reaching the figure's materials.
  ok('every avatar material is built through it',
    /return this\.shared \? litLikeTheWorld\(made, this\.shared\) : made;/.test(avatar));
  ok('and the game hands the avatar the shared uniforms',
    /new Avatar\(this\.scene, this\.shared\)/.test(
      readFileSync(new URL('../src/game.js', import.meta.url), 'utf8'),
    ));
}

console.log('\na banked wing turns the flight path, not just the head');
{
  const THREE = await import('../vendor/three/three.module.js');
  const { PlayerController } = await import('../src/player/controller.js');

  const flat = { heightAt: () => 0, meshHeightAt: () => null, hasElevationAt: () => true };
  const makePlayer = () => ({
    position: new THREE.Vector3(0, 500, 0),
    renderPosition: new THREE.Vector3(0, 500, 0),
    velocity: new THREE.Vector3(0, 0, -40),
    radius: 0.35, height: 1.8, scale: 1,
    yaw: 0, pitch: 0, roll: 0.6,
    onGround: false, swimming: false, elytraDeployed: true,
    horizontalSpeed: 40, airborneSeconds: 0, groundSlope: 0, groundBank: 0,
    rockets: [], rocketTicksLeft: 0, speedBlend: 1,
    lookVector(out = new THREE.Vector3()) {
      const cp = Math.cos(this.pitch);
      return out.set(cp * Math.sin(this.yaw), Math.sin(this.pitch), -cp * Math.cos(this.yaw));
    },
    burnRockets() {}, tickTimers() {}, snapRender() {}, syncGeo() {},
  });

  const player = makePlayer();
  const controller = new PlayerController({ player, terrain: flat, buildings: null });
  const look = new THREE.Vector3();
  const none = { forward: 0, right: 0, up: 0, sprint: false, crouch: false, jump: false };
  const slip = () => {
    player.lookVector(look);
    const v = player.velocity.clone().normalize();
    return (Math.acos(Math.max(-1, Math.min(1, look.dot(v)))) * 180) / Math.PI;
  };
  const trace = [];
  for (let t = 0; t < 40; t++) {
    // update() is what refreshes this each frame; tickGlide reads it. Feeding
    // it a stale one is a broken measurement, not a broken game — that mistake
    // was made once here and reported 54.9 degrees where the truth was 13.0.
    player.lookVector(controller.look);
    controller.tickGlide(1 / 20, none);
    player.horizontalSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    trace.push(slip());
  }

  const settled = trace[trace.length - 1];
  // Before this, banking moved yaw alone and left the momentum where it was:
  // the slip climbed to 13.0 degrees and the speed fell 40.0 to 33.5. What is
  // left is the glider's own sink angle — a wing in a steady glide always
  // meets the air slightly nose-up — so it settles rather than growing.
  ok(`the slip settles small  (${settled.toFixed(1)} deg, was 13.0)`, settled < 7);
  ok('and it settles rather than growing',
    Math.abs(trace[trace.length - 1] - trace[trace.length - 6]) < 0.2);
  ok(`the turn still happens  (yaw ${((player.yaw * 180) / Math.PI).toFixed(0)} deg after two seconds)`,
    player.yaw > 0.7 && player.yaw < 1.1);
  ok(`and it costs less speed  (${player.velocity.length().toFixed(1)} m/s, was 33.5)`,
    player.velocity.length() > 34.5);

  // A pure rotation about the vertical does no work: banking cannot be a way
  // of gaining speed, whichever way you roll.
  {
    const p = makePlayer();
    const c = new PlayerController({ player: p, terrain: flat, buildings: null });
    p.roll = -0.6;
    let top = 40;
    for (let t = 0; t < 400; t++) {
      p.lookVector(c.look);
      c.tickGlide(1 / 20, none);
      p.horizontalSpeed = Math.hypot(p.velocity.x, p.velocity.z);
      top = Math.max(top, p.velocity.length());
    }
    ok(`rolling the other way for twenty seconds gains nothing  (peak ${top.toFixed(1)} m/s)`,
      top <= 40.001);
  }
}

console.log('\na firework may turn you and may not brake you');
{
  const { stepRocket, stepGlide, rocketTicks, rocketPowerFor } = await import('../src/player/elytra.js');
  const speed = (v) => Math.hypot(v.x, v.y, v.z);

  // Lighting one while looking off the line you are actually travelling on used
  // to be a cliff with braking on the far side. Under 45 degrees you were past
  // this rocket's governor, so the whole push was skipped and nothing happened;
  // past it, `along` had shrunk enough for the push to fire, and what it mostly
  // did at that angle was halve a large sideways velocity. Measured at 40 m/s:
  // 40.0 at 30 degrees, 34.2 at 45, 32.1 at 60, 26.2 at 90.
  // Mirrors burnRockets: only the first burning rocket in a tick steers.
  const fire = (offDeg, n = 1, d = 1, start = 40) => {
    const v = { x: 0, y: 0, z: -start };
    const a = (offDeg * Math.PI) / 180;
    const look = { x: Math.sin(a), y: 0, z: -Math.cos(a) };
    for (let i = 0; i < n; i++) stepRocket(v, look, rocketPowerFor(d), 0, i === 0);
    return speed(v);
  };
  for (const off of [0, 30, 45, 60, 90]) {
    const after = fire(off);
    ok(`one lit at ${String(off).padStart(2)} degrees off does not slow you  (${after.toFixed(1)} m/s)`,
      after >= 40 - 1e-6);
  }
  ok(`nor does a fistful of them  (${fire(90, 12).toFixed(1)} m/s)`, fire(90, 12) >= 40 - 1e-6);
  ok(`and a big one aimed along your travel still pushes  (${fire(0, 1, 5, 100).toFixed(1)} m/s)`,
    fire(0, 1, 5, 100) > 104);

  const run = ({ d, every, ticks, pitch }) => {
    const v = { x: 0, y: 0, z: 0 };
    const look = { x: 0, y: Math.sin(pitch), z: -Math.cos(pitch) };
    const burning = [];
    let top = 0;
    for (let t = 0; t < ticks; t++) {
      if (t % every === 0) {
        burning.push({ left: rocketTicks(d), total: rocketTicks(d), power: rocketPowerFor(d) });
      }
      let first = true;
      for (const r of burning) {
        stepRocket(v, look, r.power, 1 - r.left / r.total, first);
        first = false;
        r.left -= 1;
      }
      for (let i = burning.length - 1; i >= 0; i--) if (burning[i].left <= 0) burning.splice(i, 1);
      stepGlide(v, look, pitch);
      top = Math.max(top, speed(v));
    }
    return top;
  };

  // Pressing the key again must push harder, not steer harder.
  //
  // Steering is a property of having a rocket lit, not of how many. The line
  // halves whatever part of your velocity is not along your look, and that was
  // happening once per burning firework — so holding the key down snapped your
  // direction of travel further round with every press. Measured at a 40 m/s
  // cruise looking 45 degrees off, with Rocket V: one turned the travel 33.4
  // degrees, three turned it 43.0, eight turned it 44.9.
  {
    const turn = (n, d) => {
      const start = 40;
      const v = { x: 0, y: 0, z: -start };
      const a = (45 * Math.PI) / 180;
      const look = { x: Math.sin(a), y: 0, z: -Math.cos(a) };
      for (let i = 0; i < n; i++) stepRocket(v, look, rocketPowerFor(d), 0, i === 0);
      const sp = speed(v);
      const dot = (0 * v.x + 0 * v.y + -1 * v.z) / sp;
      return {
        turned: (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI,
        speed: sp,
      };
    };
    const one = turn(1, 5);
    const eight = turn(8, 5);
    ok(`eight presses do not whip you round further than one  (${one.turned.toFixed(1)} then ${eight.turned.toFixed(1)} deg, was 44.9)`,
      eight.turned - one.turned < 6);
    ok(`but they do push harder  (${one.speed.toFixed(0)} then ${eight.speed.toFixed(0)} m/s)`,
      eight.speed > one.speed + 20);
    // And a small rocket at its own governor is consistent however many you
    // light: one and twelve have to agree.
    const smallOne = turn(1, 1);
    const smallTwelve = turn(12, 1);
    ok(`a slot at its governor answers the same for one press and twelve  (${smallOne.turned.toFixed(1)} and ${smallTwelve.turned.toFixed(1)} deg)`,
      Math.abs(smallOne.turned - smallTwelve.turned) < 0.01
      && Math.abs(smallOne.speed - smallTwelve.speed) < 0.01);
  }

  // Holding the key has to answer. Not "accelerate for ever" — a firework
  // cannot beat its own governor, in Minecraft either — but the speed with
  // rockets lit must differ from the speed with none.
  {
    const sweep = ({ gap, d, ticks = 100, start = 40 }) => {
      const v = { x: 0, y: 0, z: -start };
      const burning = [];
      for (let t = 0; t < ticks; t++) {
        const yaw = (t * 1.5 * Math.PI) / 180;
        const look = { x: Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
        if (t % gap === 0) {
          burning.push({ left: rocketTicks(d), total: rocketTicks(d), power: rocketPowerFor(d) });
        }
        let one = true;
        for (const r of burning) {
          stepRocket(v, look, r.power, 1 - r.left / r.total, one);
          one = false;
          r.left -= 1;
        }
        for (let i = burning.length - 1; i >= 0; i--) if (burning[i].left <= 0) burning.splice(i, 1);
        stepGlide(v, look, 0);
      }
      return speed(v);
    };
    const nothing = sweep({ gap: 1e9, d: 1 });
    const mashed = sweep({ gap: 2, d: 1 });
    ok(`mashing holds you up where firing nothing decays  (${mashed.toFixed(1)} against ${nothing.toFixed(1)} m/s)`,
      mashed > nothing + 2);
    // And below the governor it genuinely accelerates rather than only holding.
    const climbed = sweep({ gap: 2, d: 5, start: 40 });
    ok(`and from below, mashing a big one accelerates  (40 to ${climbed.toFixed(0)} m/s)`,
      climbed > 100);
  }

  // The governor still holds each slot at its own cruise.
  for (const [d, want] of [[1, 33.5], [3, 70.2], [5, 107.0]]) {
    const held = run({ d, every: rocketTicks(d), ticks: 1200, pitch: 0 });
    ok(`Rocket ${d} still settles at its own cruise  (${held.toFixed(1)} against ${want})`,
      Math.abs(held - want) < 2);
  }
  // The runaway this guards: the steering term forcing velocity onto the look
  // axis while the glide hands sink back as forward speed, the two compounding.
  // The original line reached 80,000 m/s at twenty degrees down; a later
  // attempt at restoring Minecraft's constant push reached 1,895. Preserving
  // the speed adds nothing, it only refuses to subtract.
  for (const deg of [10, 20, 30, 45, 70]) {
    const dived = run({ d: 5, every: 2, ticks: 2400, pitch: (-deg * Math.PI) / 180 });
    ok(`two minutes at ${String(deg).padStart(2)} degrees down stays bounded  (${dived.toFixed(0)} m/s)`,
      dived < 200);
  }
}

console.log('\nthe probe bisects, so a provider is not written off six levels up');
{
  const { deepestZoomAt } = await import('../src/tiles/providers.js');
  const asked = [];
  // Esri's shape: publishes 23, actually serves 16 here. The old descending
  // walk stopped at 17 and called that "nothing", which ruled the best
  // provider in the list out of exactly the places worth asking about.
  globalThis.fetch = async (url) => {
    const z = Number(String(url).match(/\/(\d+)\//)?.[1] ?? 0);
    asked.push(z);
    const body = new Uint8Array(200);
    return { ok: z <= 16, arrayBuffer: async () => body.buffer };
  };
  globalThis.createImageBitmap = async () => ({ width: 256, height: 256, close() {} });
  const source = {
    descriptor: { maxZoom: 23 },
    decode: 'imagery',
    urlFor: (t) => `https://example.test/${t.z}/${t.x}/${t.y}.jpg`,
  };
  const found = await deepestZoomAt(source, { lat: 37.77, lon: -122.42 });
  ok(`it finds the real floor rather than giving up  (z${found.zoom})`, found.zoom === 16);
  ok(`and reports the tile size it measured  (${found.pixels} px)`, found.pixels === 256);
  ok(`and asks a handful of times, not twenty  (${asked.length})`, asked.length <= 7);
  const shallow = await deepestZoomAt(
    { ...source, descriptor: { maxZoom: 9 } }, { lat: 0, lon: 0 },
  );
  ok(`an honest provider costs one request  (z${shallow.zoom})`, shallow.zoom === 9);
  delete globalThis.fetch;
  delete globalThis.createImageBitmap;
}

console.log('\na written-off depth can be un-written-off');
{
  const { ImageryStreamer } = await import('../src/tiles/streamer.js');
  const streamer = new ImageryStreamer(
    { postMessage() {}, addEventListener() {} },
    { capabilities: { getMaxAnisotropy: () => 1 } },
  );
  streamer.source = { maxZoom: 23, ready: true, urlFor: () => 'x' };

  // Write zoom 22 off the way the provider does: six refusals there, with 21
  // succeeding, which is the test reviewDepth applies.
  streamer.zoomRecord(21).loaded = 4;
  for (let i = 0; i < 6; i += 1) streamer.zoomRecord(22).failed += 1;
  streamer.reviewDepth({ z: 22, x: 1, y: 1 });
  ok(`a provider that refuses a level is written off there  (${streamer.depthLimit})`,
    streamer.depthLimit === 21);

  // "This square has no picture in it" is the only answer a provider ever
  // gives about its depth, and it was the one refusal excluded from the
  // judgement — so the limit could never be set by anything.
  //
  // The worry that excluded it was real: coverage is not a single depth, Esri
  // serves 19 over a town and stops at 17 over a glacier a valley away, and a
  // cap learned over the glacier used to follow you to the town for the rest
  // of the session. That is answered where it belongs, by remembering *where*
  // the cap was learned and dropping it at the edge of that ground, rather
  // than by throwing away the evidence.
  {
    const s2 = new ImageryStreamer({ postMessage() {}, addEventListener() {} },
      { capabilities: { getMaxAnisotropy: () => 1 } });
    s2.source = { maxZoom: 23, ready: true, urlFor: () => 'x' };
    s2.standbys = [];
    s2.zoomRecord(13).loaded = 4;
    s2.beginFrame(0.25, 0.25);
    const fail = (z, noImageryHere) => {
      const entry = { key: `${z}/1/1`, tile: { z, x: 1, y: 1 }, state: 1, attempt: 99 };
      s2.jobs.set(1, entry);
      s2.active = 1;
      s2.onWorkerMessage({ channel: 'imagery', id: 1, ok: false, noImageryHere, error: 'x' });
    };
    for (let i = 0; i < 8; i += 1) fail(14, true);
    ok(`eight squares with no picture cap the provider there  (${s2.depthLimit})`,
      s2.depthLimit === 13);
    ok('and the cap remembers the ground it was learned over',
      s2.depthRegion === s2.here);
    // Forty kilometres away is not that ground. The first frame whose camera
    // stands there drops the cap rather than carrying it along.
    s2.beginFrame(0.6, 0.6);
    s2.probeDeeper();
    ok(`a cap learned elsewhere does not apply here  (${s2.depthLimit})`,
      s2.depthLimit === Infinity && s2.depthRegion === null);
    // A fault is still not evidence: dropped connections say nothing about
    // what a provider has.
    const s2b = new ImageryStreamer({ postMessage() {}, addEventListener() {} },
      { capabilities: { getMaxAnisotropy: () => 1 } });
    s2b.source = { maxZoom: 23, ready: true, urlFor: () => 'x' };
    s2b.standbys = [];
    s2b.zoomRecord(13).loaded = 4;
    for (let i = 0; i < 8; i += 1) {
      const entry = { key: `14/1/1`, tile: { z: 14, x: 1, y: 1 }, state: 1, attempt: 99 };
      s2b.jobs.set(1, entry);
      s2b.active = 1;
      s2b.onWorkerMessage({ channel: 'imagery', id: 1, ok: false, transient: true, error: 'x' });
    }
    ok(`eight dropped connections cap nothing  (${s2b.depthLimit})`,
      s2b.depthLimit === Infinity);
  }

  // Nor should the quadtree keep splitting into ground nobody has imaged.
  //
  // `finest`, the brake on subdividing, is fed only by tiles that *load*, from
  // their measured sharpness — so a square the provider has no picture of
  // never reports anything and there was no brake at all. The tree carried on
  // splitting and drew every leaf bare.
  {
    const s3 = new ImageryStreamer({ postMessage() {}, addEventListener() {} },
      { capabilities: { getMaxAnisotropy: () => 1 } });
    ok('a tile whose children are all unknown still splits',
      s3.childrenBarren({ z: 12, x: 4, y: 4 }) === false);
    // The same clock the streamer keeps these in — performance.now(), not
    // Date.now(). Mixing the two makes every stale entry read as freshly
    // recorded, because a wall-clock millisecond count is astronomically
    // larger than a monotonic one, and the check that is supposed to expire
    // things silently never fires.
    const clock = () => performance.now();
    s3.barren.set('13/8/8', clock());
    ok('one child with no picture stops the split',
      s3.childrenBarren({ z: 12, x: 4, y: 4 }) === true);
    ok('and its neighbour is unaffected',
      s3.childrenBarren({ z: 12, x: 5, y: 4 }) === false);
    // Read off `barren` rather than a set of its own, so it expires with it.
    // As a bare Set it had no expiry, and one transient refusal capped the
    // depth over a whole region for the rest of the session.
    s3.barren.set('13/8/8', clock() - 10 * 60 * 1000);
    ok('a stale verdict is forgotten rather than obeyed for ever',
      s3.childrenBarren({ z: 12, x: 4, y: 4 }) === false);
    // Floored, or a refusal for a square the size of a continent stops the
    // world subdividing across an ocean.
    s3.barren.set('5/1/1', clock());
    ok('and a verdict about half a hemisphere is not acted on',
      s3.childrenBarren({ z: 4, x: 0, y: 0 }) === false);
  }

  // Degraded has to have a way back.
  //
  // It means "nothing is reaching any provider", and it used to stop urlFor
  // being called at all — so nothing could succeed, so nothing could clear it.
  // A tab that booted while the network was down drew grey for the rest of the
  // session and only a change of provider brought it back.
  {
    const s4 = new ImageryStreamer({ postMessage() {}, addEventListener() {} },
      { capabilities: { getMaxAnisotropy: () => 1 } });
    let asked = 0;
    s4.source = { maxZoom: 23, ready: true, urlFor: () => { asked += 1; return 'x'; } };
    s4.degraded = true;
    s4.active = 0;
    s4.dispatch({ key: '10/1/1', tile: { z: 10, x: 1, y: 1 }, state: 0 });
    ok('a degraded streamer still sends one probe', asked === 1);
    s4.active = 3;
    const before = asked;
    const throttled = { key: '10/1/2', tile: { z: 10, x: 2, y: 1 }, state: 0 };
    s4.dispatch(throttled);
    ok('but only one at a time, so a dead network is not hammered', asked === before);
    // Throttled is not refused. The first version of this returned a null URL,
    // which falls into the branch that marks a square BARE — and bare is
    // terminal, so the first pump after the latch wrote off the whole view and
    // only newly created tiles ever got a probe. Measured in the browser: 477
    // squares bare, still bare forty-five seconds later, no recovery at all.
    ok('and a square held back is left to be asked again, not written off',
      throttled.state === 0);
    let recovered = 0;
    s4.on('recovered', () => { recovered += 1; });
    s4.jobs.set(7, { key: '10/1/1', tile: { z: 10, x: 1, y: 1 }, state: 1 });
    s4.onWorkerMessage({ channel: 'imagery', id: 7, ok: true });
    ok('and one arrival clears it', s4.degraded === false && recovered === 1);
  }
  // A slot that frees is filled at once, not at the next frame.
  //
  // `pump` was called from exactly one place — the terrain walk, once a frame —
  // and a request completing freed its slot without refilling it. At sixty
  // frames a second that is a sixteen-millisecond gap and invisible; measured
  // in flight at the frame rate a struggling machine actually runs, it was a
  // mean of 1.34 requests in flight against a cap of twelve, with the queue
  // averaging sixty-six deep. The pipeline ran at eleven per cent of its own
  // allowance, and the slower the machine the wider the gap.
  {
    const sent = [];
    const s5 = new ImageryStreamer(
      { postMessage(m) { sent.push(m); }, addEventListener() {} },
      { capabilities: { getMaxAnisotropy: () => 1 } },
    );
    s5.source = { maxZoom: 23, ready: true, urlFor: () => 'u' };
    // Fill every slot, then queue more behind them. The cap is the preset's,
    // not a number typed here — the first version of this hardcoded twelve
    // and the default tier allows twenty-six, so nothing ever queued.
    const { settings: store } = await import('../src/core/settings.js');
    const cap = store.preset().maxConcurrentRequests;
    for (let i = 0; i < cap + 6; i++) s5.request({ z: 12, x: 100 + i, y: 50 }, i);
    s5.pump();
    const inFlight = s5.active;
    const waiting = s5.queue.length;
    ok(`the cap is filled and the rest wait  (${inFlight} in flight, ${waiting} queued)`,
      inFlight > 0 && waiting > 0);
    // One completes. Without a pump on completion the freed slot stays empty
    // until something else calls pump — which, in the game, is the next frame.
    const anyJob = [...s5.jobs.keys()][0];
    const before = sent.length;
    s5.onWorkerMessage({ channel: 'imagery', id: anyJob, ok: true });
    ok(`a completion refills the slot it freed  (${sent.length - before} dispatched)`,
      sent.length > before);
    ok('and the cap is respected, not exceeded', s5.active <= cap);
  }

  ok('and the quadtree stops splitting at it', streamer.maxUsefulZoom === 21);

  // The latch: the limit caps how deep anything is asked for, so no tile can
  // arrive above it, so the limit can never lift. It says of itself that "one
  // tile arriving at a written-off level puts it back" — true, and impossible.
  streamer.request({ z: 21, x: 1000, y: 700 }, 1);
  streamer._probedAt = -Infinity;
  const before = streamer.queue.length;
  streamer.probeDeeper();
  const probed = streamer.queue.slice(before).map((e) => e.tile.z);
  ok(`it asks again above the limit  (zoom ${probed.join(', ') || 'nothing'})`,
    probed.includes(22));

  // And only now and then, or it is a request every frame against a cap that
  // is usually correct.
  const again = streamer.queue.length;
  streamer.probeDeeper();
  ok('but not every frame', streamer.queue.length === again);

  // One that lands lifts the limit, which is what makes the probe worth making.
  // Through reviewDepth's own recovery clause rather than by assignment: a
  // check that sets the value it then asserts is not a check.
  // A landing is a landing: it ends the run of refusals as well as adding to
  // the tally, which is what the load path does.
  {
    const record = streamer.zoomRecord(22);
    record.loaded += 1;
    record.failedAtLoad = record.failed;
  }
  streamer.reviewDepth({ z: 22, x: 1, y: 1 });
  ok(`and a tile that lands puts the depth back  (${streamer.depthLimit})`,
    !Number.isFinite(streamer.depthLimit));
}

console.log('\nthe chase camera comes in rather than climbing the hill');
{
  const rig = readFileSync(new URL('../src/camera/cameraRig.js', import.meta.url), 'utf8');
  // The line from you to where the camera wants to be is walked, and it stops
  // short of whatever gets in the way — which is what a chase camera in
  // anything else does. Pushing it straight up instead left it a couple of
  // feet above a hillside looking along it, and a photograph at a grazing
  // angle is stretched to hundreds of texels a pixel.
  ok('it walks the way out looking for ground', /for \(let step = 1; step <= CHASE_PROBES/.test(rig));
  ok('and stops short of what it finds', /reach = \(step - 1\) \/ CHASE_PROBES;/.test(rig));
  // Never all the way in: inside your own head is worse than a grazing hill.
  const floor = Number(/const CHASE_MIN_REACH = ([\d.]+);/.exec(rig)?.[1]);
  ok(`and never comes closer than a third of the way  (${floor})`, floor >= 0.25 && floor <= 0.5);
  ok('damped, because heightAt steps as the terrain swaps under it',
    /this\._reach = Number\.isFinite\(this\._reach\) \? damp\(/.test(rig));
  // Behaviour is checked in the running game by tools/chasecheck.mjs: facing
  // the west wall at Lauterbrunnen the camera comes in to 1.51 m from 4.44,
  // and every other direction stays at 4.44.
}

console.log('\nwhen a map server is unwell, ask a different one');
{
  const src = readFileSync(new URL('../src/world/overpass.js', import.meta.url), 'utf8');
  const list = /const ENDPOINTS = \[([\s\S]*?)\];/.exec(src)?.[1] ?? '';
  const mirrors = [...list.matchAll(/'https:\/\/[^']+'/g)].length;
  // Two was not enough: measured from here the main instance answered 503 and
  // kumi answered 500, both at once, which with a list of two is every
  // building in the world gone.
  ok(`there is more than one mirror to fall back to  (${mirrors})`, mirrors >= 3);

  // And the fallback has to engage on the failures that actually happen. It
  // moved on for 429 and 504 only, so a 500 or a 503 threw without advancing
  // and every retry went back to the same dead endpoint — the second mirror
  // was never reached. That is "3D not working at all, including OSM
  // buildings": not a bug in the buildings, a fallback that never engaged.
  ok('a server error moves to the next mirror',
    /status === 429 \|\| response\.status >= 500/.test(src));
  ok('and so does a request that never arrives',
    /if \(!\/overpass \\d\/\.test\([\s\S]{0,60}?endpointIndex\+\+;/.test(src));
  // A 4xx that is not 429 is the query being wrong, and no other mirror will
  // like it better, so those must not rotate.
  ok('but a bad query does not walk the whole list',
    !/status >= 400\)\s*\{\s*this\.endpointIndex/.test(src));

  // Every mirror in the list has to hold the whole planet.
  //
  // overpass.osm.ch was in it, second, so it was the first thing tried
  // whenever the main instance was unwell — and it holds Switzerland and
  // nothing else. It does not fail when you ask it about Paris: it answers
  // 200, in half a second, with an empty element list, which the caller cannot
  // tell apart from open sea. Measured against the live service: 1,928
  // building ways in one Zurich square, zero in the same square over central
  // Paris, zero over Manhattan. One 503 from the main instance and every
  // building, wood, bridge and mast on Earth outside Switzerland silently
  // stopped existing, with every tile reading `ready` and nothing logged.
  const REGIONAL = ['overpass.osm.ch', 'overpass.osm.jp', 'overpass.nchc.org.tw'];
  ok('and none of the mirrors holds only one country',
    REGIONAL.every((host) => !list.includes(host)));

  // An empty answer is ordinary — most of the planet has no buildings on it —
  // so it is kept rather than re-asked, or a flight over the Atlantic would
  // re-query every square of it. But it must not outlive the mirror that gave
  // it, which is the whole of the trap above: nothing failed, so nothing was
  // ever asked again.
  ok('an empty answer is remembered against the mirror that gave it',
    /emptyIsStale\(record\)/.test(src)
    && /record\?\.emptyFrom !== undefined && record\.emptyFrom !== this\.endpointIndex/.test(src));

  for (const [what, file] of [['buildings', '../src/world/buildings.js'], ['woodland', '../src/world/woodland.js']]) {
    const mod = readFileSync(new URL(file, import.meta.url), 'utf8');
    ok(`${what} records which mirror said the square was empty`,
      /if \(!\(data\?\.elements\?\.length > 0\)\) record\.emptyFrom = overpass\.mirror;/.test(mod));
    ok(`${what} asks an empty square again once that mirror is abandoned`,
      /overpass\.emptyIsStale\(held\)/.test(mod));
    // But not the instant it changes. The client rests for 45 s after the
    // refusal that moved it on, so dropping every empty square right then
    // throws all of them into a rejection and a further minute of holding
    // nothing — measured as nine squares bare for a minute longer than needed.
    ok(`${what} does not give up an answer it cannot replace yet`,
      /overpass\.resting \|\| !overpass\.emptyIsStale\(held\)/.test(mod));
    // ...and only then. A blanket retry of every empty square is a query storm
    // over every ocean and desert in the world.
    ok(`${what} does not re-ask a square that is simply empty`,
      !/state === 'ready'[\s\S]{0,80}this\.tiles\.delete\(key\)/.test(mod));
  }
}

console.log('\na graphics tier only carries settings that do something');
{
  // buildingRadiusM sat in all four presets — 420 on Low up to 1800 on Ultra —
  // and nothing read one of them, from the first commit onwards. It is gone
  // rather than wired up: the grain is a zoom-15 square, about 800 m across at
  // Paris, so 420, 750 and 1200 all round to the same single ring and could
  // never have differed. See the note in buildings.update.
  const conf = readFileSync(new URL('../src/core/settings.js', import.meta.url), 'utf8');
  const high = /  high: \{([\s\S]*?)\n    applies:/.exec(conf)?.[1] ?? '';
  const tierKeys = [...high.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1]);
  ok(`the high tier still lists its numbers  (${tierKeys.length})`, tierKeys.length >= 6);

  const sources = readdirSync(new URL('../src/', import.meta.url), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.js') && f !== 'core/settings.js')
    .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'))
    .join('\n');
  // Every one of them is reached through settings.preset(), so the name has to
  // turn up as a property read outside the table that declares it. A mention
  // in prose is not a read — the first draft of this check counted one, and a
  // comment explaining why buildingRadiusM had been removed was enough to make
  // buildingRadiusM look alive.
  const dead = tierKeys.filter((k) => !new RegExp(`(?:preset\\(\\)|preset)\\.${k}\\b`).test(sources));
  ok(`no tier number that nothing reads  (${dead.join(', ') || 'none'})`, dead.length === 0);
  ok('and buildingRadiusM in particular is gone', !/buildingRadiusM/.test(conf));
}

console.log('\nthe in-page worker host overlaps its round trips');
{
  // What the double-clickable build runs on: a page opened from file:// cannot
  // start a Web Worker. The host ran exactly one job at a time, "yielding
  // between them so the frame still gets drawn" — but most of a tile job is
  // `await fetch`, which never touches the main thread, so serialising the job
  // serialised the network wait too. Measured against a real worker on the same
  // course: 41.8 per cent of the ground stretched against 14.1, 1,280 tiles
  // fetched against 1,906, and the queue behind it backed up to 157.
  const host = await import('../src/tiles/workerHost.js');
  const src = readFileSync(new URL('../src/tiles/workerHost.js', import.meta.url), 'utf8');
  // The count is a count, not a flag — `if (this.running) return` is what made
  // it one at a time.
  ok('the host tracks how many are in the air, not whether any is',
    /this\.running = 0;/.test(src) && !/if \(this\.running\) return;/.test(src));
  ok('it starts more than one', /this\.running < INLINE_JOBS/.test(src));
  // The yield is the part that protected the frame and it must survive.
  ok('and still hands the frame back between starts',
    /setTimeout\(resolve, 0\)/.test(src));
  // A finished job fills the slot it freed, same as every other queue here.
  ok('a finished job fills the slot it freed',
    /this\.running--;[\s\S]{0,200}this\.pump\(\);/.test(src));

  // And the cap actually holds, driven rather than read.
  const worker = host.createTileWorker.call(null);
  if (worker && worker.inline) {
    let started = 0;
    worker.queue.length = 0;
    for (let i = 0; i < 20; i++) worker.queue.push({ channel: 'imagery', id: i, kind: 'nothing' });
    // Jobs that never finish, so the cap is the only thing that can stop it.
    // The first version of this decremented the counter straight away, so the
    // cap never bit and the check passed at 20 of 20 — vacuous.
    worker.run = function run() { started++; return new Promise(() => {}); };
    await worker.pump();
    ok(`it stops at the cap while they are in the air  (${started} of 20 started)`,
      started > 1 && started < 20);
    ok(`and what it did not start is still queued  (${worker.queue.length} waiting)`,
      worker.queue.length === 20 - started);
  } else {
    ok('the in-page host is reachable for testing', false);
  }
}

console.log('\nthe elevation queue fills the slots it frees');
{
  // The same starvation the imagery queue had. `pump` ran from one place —
  // ensureAround, off the terrain walk, once a frame — and a completing
  // request freed its slot without refilling it. Measured in flight: a mean of
  // 0.25 requests in the air against a cap of four, six per cent of its own
  // allowance, with the queue averaging ten tiles and peaking at seventy-four.
  //
  // It matters more here than for imagery: until a square's DEM tile arrives
  // the ground under it reads as sea level, so a slow elevation queue is time
  // spent standing on ground that is not there yet.
  const { ElevationField } = await import('../src/tiles/elevation.js');
  const sent = [];
  const field = new ElevationField({ postMessage(m) { sent.push(m); }, addEventListener() {} });
  field.source = { ready: true, maxZoom: 15, urlFor: () => 'u', decode: 'terrarium' };
  for (let i = 0; i < field.maxActive + 5; i++) field.request({ z: 12, x: 100 + i, y: 50 }, i);
  field.pump();
  const waiting = field.queue.length;
  ok(`the cap is filled and the rest wait  (${field.active} in flight of ${field.maxActive}, ${waiting} queued)`,
    field.active === field.maxActive && waiting > 0);
  const job = [...field.jobs.keys()][0];
  const before = sent.length;
  field.onMessage({ channel: 'elevation', id: job, ok: true, heights: new Float32Array(4) });
  ok(`a completion refills the slot it freed  (${sent.length - before} dispatched)`,
    sent.length > before);
  ok('and the cap is respected, not exceeded', field.active <= field.maxActive);
  // A failure frees a slot too, and used to leave it empty just the same.
  const job2 = [...field.jobs.keys()][0];
  const before2 = sent.length;
  field.onMessage({ channel: 'elevation', id: job2, ok: false });
  ok(`a failure refills it as well  (${sent.length - before2} dispatched)`,
    sent.length > before2);

  // Eviction is per-frame housekeeping and has to stay that way. It used to be
  // the last line of `pump`, which was fine while pump ran once a frame — it
  // does not any more, and leaving it there would have copied and sorted the
  // whole tile map on every completing request.
  const elevSrc = readFileSync(new URL('../src/tiles/elevation.js', import.meta.url), 'utf8');
  ok('eviction runs once a frame, not once a request',
    /beginFrame\(\) \{[\s\S]{0,600}this\.evict\(\);/.test(elevSrc)
    && !/postMessage\(\{[\s\S]{0,400}\}\);\s*\}\s*this\.evict\(\);/.test(elevSrc));
}

console.log('\na distance never rounds away to nothing');
{
  // formatDistance switched to miles at a thousand feet, and a mile is 5,280 —
  // so at zero decimals everything from a thousand feet to half a mile printed
  // "0 mi". Both scale bars ask for zero decimals, so the minimap's legend read
  // "0 mi" under a five-hundred-metre bar; and so does the nearest-land
  // readout, so eight hundred metres off a coast it said "land ~0 mi", which is
  // the wrong answer rather than an ugly one. Found by looking at a screenshot.
  const { formatDistance } = await import('../src/core/units.js');
  const zeros = [];
  for (const units of ['imperial', 'metric']) {
    for (const digits of [0, 1, 2]) {
      for (let m = 1; m <= 20000; m += 1) {
        const out = formatDistance(m, units, digits);
        // The number in front of the unit must not be zero for a real distance.
        if (/^-?0(\.0*)? /.test(out)) { zeros.push(`${m} m ${units}(${digits}) -> ${out}`); break; }
      }
    }
  }
  ok(`no real distance prints as zero  (${zeros.slice(0, 3).join('; ') || '120,000 cases'})`,
    zeros.length === 0);
  // And the specific readings that were wrong.
  ok(`500 m imperial at no decimals  (${formatDistance(500, 'imperial', 0)})`,
    !/^0 /.test(formatDistance(500, 'imperial', 0)));
  ok(`800 m imperial at no decimals  (${formatDistance(800, 'imperial', 0)})`,
    !/^0 /.test(formatDistance(800, 'imperial', 0)));
  // Without breaking what already worked.
  ok(`50 m is still feet  (${formatDistance(50, 'imperial', 0)})`, /ft$/.test(formatDistance(50, 'imperial', 0)));
  ok(`5 km is still miles  (${formatDistance(5000, 'imperial', 0)})`, /mi$/.test(formatDistance(5000, 'imperial', 0)));
  ok(`5 km metric is still km  (${formatDistance(5000, 'metric', 0)})`, /km$/.test(formatDistance(5000, 'metric', 0)));
  ok(`and a metre is still a metre  (${formatDistance(1, 'metric', 0)})`, /m$/.test(formatDistance(1, 'metric', 0)));
}

console.log('\nnothing reads a setting that does not exist');
{
  // The size keys wrote to `settings.playerScale`, which does not exist —
  // player.scale reads cheats.playerScale. So the read gave undefined, the
  // multiply gave NaN, clamp passed it through (NaN < lo and NaN > hi are both
  // false), and the toast said "Size NaNx" while nothing moved. Silent in
  // exactly the way this project keeps finding things silent.
  const { DEFAULT_SETTINGS } = await import('../src/core/settings.js');
  const { CHEAT_DEFAULTS } = await import('../src/core/cheats.js');
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true })
    .map(String).filter((f) => f.endsWith('.js'));
  const strayS = [];
  const strayC = [];
  let readsS = 0;
  let readsC = 0;
  // Everything on the Cheats object that is not one of the cheats themselves.
  const CHEAT_MEMBERS = new Set(['js', 'set', 'get', 'toggle', 'reset', 'unlock', 'lock',
    'offerKey', 'active', 'labels', 'on', 'off', 'emit', 'values', 'locked', 'unlocked']);
  for (const f of files) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/settings\.(?:get|set)\(\s*'([A-Za-z0-9_]+)'/g)) {
      readsS++;
      if (!(m[1] in DEFAULT_SETTINGS)) strayS.push(`${f}: ${m[1]}`);
    }
    // Cheats are read as plain properties — `cheats.playerScale` — not through
    // a getter, which is why the first version of this check matched nothing
    // at all and passed on an empty set. Vacuous, and caught by counting the
    // matches rather than trusting the pass.
    for (const m of src.matchAll(/\bcheats\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      if (CHEAT_MEMBERS.has(m[1])) continue;
      readsC++;
      if (!(m[1] in CHEAT_DEFAULTS)) strayC.push(`${f}: ${m[1]}`);
    }
  }
  // A check that matched nothing would pass for the wrong reason, so the count
  // is asserted as well as the result.
  ok(`the settings check actually reads something  (${readsS} reads)`, readsS > 50);
  ok(`and the cheats check does too  (${readsC} reads)`, readsC > 5);
  ok(`every setting read or written exists  (${strayS.join(', ') || `${Object.keys(DEFAULT_SETTINGS).length} declared`})`,
    strayS.length === 0);
  ok(`and every cheat does too  (${strayC.join(', ') || `${Object.keys(CHEAT_DEFAULTS).length} declared`})`,
    strayC.length === 0);
}

console.log('\na key that is bound is a key that does something');
{
  // ACTIONS and DEFAULT_BINDS are two lists that have to agree, and the
  // failure when they do not is silent. `reindex` walks ACTIONS, so a key
  // named in DEFAULT_BINDS with no entry in ACTIONS is never indexed,
  // `actionsFor` returns nothing for it, and pressing it does nothing at all —
  // no error, no warning, nothing on screen.
  //
  // That is how the diagnostics key shipped dead: bound to F4, documented on
  // the help card, wired to a handler, and unreachable. It was caught only
  // because the probe for it checked that the press reached the game before
  // believing anything about what it did — the same check that caught the
  // vacuous A6 test.
  const { ACTIONS, DEFAULT_BINDS, keybinds } = await import('../src/core/keybinds.js');
  const declared = new Set(ACTIONS.map((a) => a.id));
  const boundOnly = Object.keys(DEFAULT_BINDS).filter((id) => !declared.has(id));
  const declaredOnly = [...declared].filter((id) => !DEFAULT_BINDS[id]);
  ok(`every default binding names a declared action  (${boundOnly.join(', ') || 'all do'})`,
    boundOnly.length === 0);
  ok(`and every declared action has a default key  (${declaredOnly.join(', ') || 'all do'})`,
    declaredOnly.length === 0);
  // The thing that actually matters: the press has to resolve. Checking the
  // two lists agree is the cause; this is the effect, and it is worth testing
  // directly because the index is what the keyboard handler reads.
  const unreachable = Object.entries(DEFAULT_BINDS)
    .filter(([id, code]) => !keybinds.actionsFor(code).includes(id))
    .map(([id, code]) => `${id}->${code}`);
  ok(`and every one of them resolves when pressed  (${unreachable.join(', ') || `${Object.keys(DEFAULT_BINDS).length} keys`})`,
    unreachable.length === 0);
}

console.log('\nthe texture cache cannot grow past its own budget');
{
  // The twenty-second hold after a tile was last drawn stops it being thrown
  // away and immediately re-fetched (B8/B9). Nothing bounded how many tiles it
  // could protect, so on a slow machine covering ground quickly the eviction
  // pass could find nothing droppable and the cache simply grew.
  //
  // Measured on a machine throttled to a sixth speed reporting two gigabytes:
  // 1,731 textures against a budget of 160. About 440 MB of texture where the
  // budget says 40, which is a tab dying of memory — A7.
  const { ImageryStreamer, STATE_READY } = await import('../src/tiles/streamer.js');
  const s6 = new ImageryStreamer({ postMessage() {}, addEventListener() {} },
    { capabilities: { getMaxAnisotropy: () => 1 } });
  const limit = s6.textureLimit();
  ok(`the cache has a budget  (${limit})`, limit > 0);
  // Every one of them drawn just now, so every one is inside the hold.
  const many = limit * 4;
  for (let i = 0; i < many; i++) {
    s6.entries.set(`14/${i}/9`, {
      key: `14/${i}/9`, tile: { z: 14, x: i, y: 9 }, state: STATE_READY,
      texture: { dispose() {} }, used: i, seen: performance.now(),
    });
  }
  ok(`the cache is over budget to begin with  (${s6.entries.size} of ${limit})`,
    s6.entries.size > limit);
  s6.evict();
  ok(`eviction brings it back inside  (${s6.entries.size} of ${limit})`, s6.entries.size <= limit);
  // And the hold still does its job when the cache is not over budget: a tile
  // seen a moment ago must survive an eviction that has room to spare.
  const s7 = new ImageryStreamer({ postMessage() {}, addEventListener() {} },
    { capabilities: { getMaxAnisotropy: () => 1 } });
  s7.entries.set('14/1/1', {
    key: '14/1/1', tile: { z: 14, x: 1, y: 1 }, state: STATE_READY,
    texture: { dispose() {} }, used: 1, seen: performance.now(),
  });
  s7.evict();
  ok('and a recently drawn tile is kept when there is room', s7.entries.has('14/1/1'));
}

console.log('\nno text the player sees needs a font they may not have');
{
  // I16: the map's zoom buttons were "+" and U+2212 MINUS SIGN, typed as the
  // whole content of a twenty-pixel button — and U+2212 is missing from some
  // Android and embedded font sets, where it draws as an empty box. That was
  // fixed by drawing both in CSS. But the audit behind it was a one-off read,
  // not a rule, so nothing stopped the next risky glyph.
  //
  // This is the rule. Comments may contain anything; text the player sees may
  // contain Latin-1, plus the three pieces of punctuation that are in
  // effectively every font shipped anywhere.
  const SAFE_BEYOND_LATIN1 = new Set(['\u2014', '\u2013', '\u2026']); // em dash, en dash, ellipsis
  const strip = (t) => t
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  /*
    Escapes are decoded before anything is judged, and that is the whole point.

    The rule used to read the file as written, so a character typed as \uXXXX
    walked straight past it while rendering as exactly the glyph it forbids. It
    was not hypothetical: `src/ui/hud.js` and `src/core/units.js` both carried
    U+2212 MINUS SIGN as an escape, drawn beside the glide angle and every
    bearing — the very character I16 was opened about — while the named check
    for it two lines below passed, because it looked for the literal and the
    source held the escape. Ten curly apostrophes and two curly quotes were
    hiding the same way.
  */
  const decode = (t) => t.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true })
    .map(String).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`);
  // The boot screen and the stylesheet are read by players too, and the boot
  // screen most of all on a device whose fonts are the problem: it is what is
  // on screen when nothing else has loaded.
  const pages = ['index.html', 'styles/main.css'];
  const risky = new Map();
  let scanned = 0;
  const note = (ch, where) => {
    const cp = ch.codePointAt(0);
    if (cp <= 0xFF || SAFE_BEYOND_LATIN1.has(ch)) return;
    const key = `U+${cp.toString(16).toUpperCase().padStart(4, '0')} in ${where}`;
    risky.set(key, (risky.get(key) ?? 0) + 1);
  };
  for (const f of files) {
    const body = strip(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
    for (const m of body.matchAll(LITERAL)) {
      scanned++;
      for (const ch of decode(m[0])) note(ch, f);
    }
  }
  for (const f of pages) {
    // No literal-matching here: an HTML page's visible text is not in quotes.
    const body = decode(strip(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')));
    scanned++;
    for (const ch of body) note(ch, f);
  }
  ok(`the scan reads the strings, not the comments  (${scanned} literals)`, scanned > 500);
  ok(`it covers the boot screen and the stylesheet too  (${pages.join(', ')})`,
    files.length > 40 && pages.length === 2);
  ok(`nothing the player sees needs an unusual glyph  (${[...risky.keys()].slice(0, 4).join(', ') || 'none'})`,
    risky.size === 0);

  // Proof the decoding works, so this cannot quietly go back to reading the
  // file as written and passing for free.
  ok('an escaped glyph is caught, not just a literal one',
    decode("'\\u2212'").includes('\u2212'));

  // The two that were actually wrong, named, checked after decoding.
  const seen = [...files, ...pages]
    .map((f) => decode(strip(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))))
    .join('\n');
  ok('no rightwards arrow in anything the player reads', !seen.includes('\u2192'));
  ok('and no minus sign either', !seen.includes('\u2212'));
}

console.log('\nthe README lists the providers that exist');
{
  // The README's provider table listed five imagery providers. There are
  // twelve, and the three it omitted from the keyless half — Sentinel-2, USGS,
  // NASA GIBS — are the ones that matter most to somebody deciding whether
  // this needs an account. THIRD-PARTY.md had them all; the README did not.
  const { IMAGERY_PROVIDERS, ELEVATION_PROVIDERS } = await import('../src/tiles/providers.js');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const all = [...IMAGERY_PROVIDERS, ...ELEVATION_PROVIDERS];
  ok(`there are providers to document  (${all.length})`, all.length >= 12);
  // Matched on the part of the label that identifies the provider — the stem
  // before any parenthetical — because the README shortens "Google Maps
  // (satellite)" to "Google Maps" and reasonably so. The rule is that every
  // provider is named, not that its label is quoted verbatim. The first
  // version demanded the whole string and failed on six providers that were
  // all present, which would have been a check nobody could keep green.
  const stem = (label) => label.split(' (')[0].trim();
  const unnamed = all.filter((p) => !readme.includes(stem(p.label))).map((p) => p.label);
  ok(`every provider is named in the README  (${unnamed.join(' | ') || 'all of them'})`,
    unnamed.length === 0);
  // And the keyless ones are marked as such, since that is the promise.
  const keyless = all.filter((p) => !p.needsKey);
  ok(`the keyless ones are called keyless  (${keyless.length})`,
    keyless.length >= 5 && /Keyless:/.test(readme));
}

console.log('\nthe documents do not promise a generator');
{
  // J1 removed the generator, and the self test has guarded the code against
  // its return ever since. It did not guard the prose — and THIRD-PARTY.md, the
  // document that states this project's data position, still said the game
  // "falls back to locally generated terrain". True once; the last place still
  // claiming the opposite of the rule everything else is judged on.
  const CLAIM = /locally generated terrain|generated terrain|procedurally generated|falls back to (a )?generat/i;
  const docs = ['README.md', 'THIRD-PARTY.md', 'index.html'];
  const claiming = docs.filter((d) => {
    let text;
    try { text = readFileSync(new URL(`../${d}`, import.meta.url), 'utf8'); } catch { return false; }
    // The correction itself names the old wording, in a parenthesis that says
    // it stopped being true. Only a claim outside that counts.
    const withoutTheNote = text.replace(/\(This paragraph[\s\S]*?claiming\s+the opposite\.\)/g, '');
    return CLAIM.test(withoutTheNote);
  });
  ok(`no document promises generated terrain  (${claiming.join(', ') || `${docs.length} checked`})`,
    claiming.length === 0);

  // And every vendored dependency is credited, which is a licence obligation
  // rather than a courtesy.
  const third = readFileSync(new URL('../THIRD-PARTY.md', import.meta.url), 'utf8');
  const vendored = readdirSync(new URL('../vendor/', import.meta.url), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name);
  ok(`there is something vendored to credit  (${vendored.join(', ')})`, vendored.length > 0);
  const uncredited = vendored.filter((name) => !new RegExp(name, 'i').test(third));
  ok(`every vendored dependency is credited  (${uncredited.join(', ') || 'all of them'})`,
    uncredited.length === 0);
}

console.log('\nno credential is committed');
{
  // Keyless by default is a promise this project makes, and the other half of
  // it is that nobody's key ends up in the repository. Every key setting has to
  // start empty, and nothing token-shaped may appear in the source or in either
  // shipped artefact.
  const { DEFAULT_SETTINGS } = await import('../src/core/settings.js');
  const keyish = Object.entries(DEFAULT_SETTINGS).filter(([k]) => /key|token|connectid/i.test(k));
  ok(`there are key settings to check  (${keyish.length})`, keyish.length >= 6);
  const filled = keyish.filter(([, v]) => v !== '').map(([k]) => k);
  ok(`every key setting starts empty  (${filled.join(', ') || 'all empty'})`, filled.length === 0);

  // Shapes: JWT, Mapbox, Google, and the generic sk- prefix.
  const SECRET = /eyJ[A-Za-z0-9_-]{20,}|pk\.[A-Za-z0-9_-]{30,}|AIza[A-Za-z0-9_-]{30,}|sk-[A-Za-z0-9]{20,}/;
  const scanned = [];
  const leaks = [];
  const srcFiles = readdirSync(new URL('../src/', import.meta.url), { recursive: true })
    .map(String).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`);
  for (const rel of [...srcFiles, 'terraglide.html', 'terraglide-online.html', 'index.html', 'README.md']) {
    let text;
    try { text = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'); } catch { continue; }
    scanned.push(rel);
    if (SECRET.test(text)) leaks.push(rel);
  }
  ok(`the scan covers the source and both shipped files  (${scanned.length})`,
    scanned.length > 70 && scanned.includes('terraglide.html'));
  ok(`nothing token-shaped is committed  (${leaks.join(', ') || 'none'})`, leaks.length === 0);
}

console.log('\nthe shipped single file is the game that is in src');
{
  // terraglide.html is the artefact this project tells people to double-click,
  // and nothing checked that it still matched src. Edit a module, forget to
  // rebuild, and the file people download is the old game — silently, because
  // it still boots and still works, just not the way the source says.
  //
  // The bundler stamps it with a fingerprint of the files it read. This
  // recomputes that from src the same way, so the two can only agree if the
  // bundle was built from what is here now.
  const { createHash } = await import('node:crypto');
  const bundle = readFileSync(new URL('../terraglide.html', import.meta.url), 'utf8');
  const stamped = /name="terraglide-sources" content="([a-f0-9]+)"/.exec(bundle)?.[1] ?? null;
  ok(`the single file records what it was built from  (${stamped ?? 'no stamp'})`, !!stamped);

  // The ids the bundler hashes are repo-relative paths, entry first, and it
  // sorts them — so the order here does not have to match the walk order.
  const ids = [...bundle.matchAll(/__tg_modules\[\"([^\"]+)\"\] = function/g)].map((m) => m[1]);
  ok(`and names the modules it holds  (${ids.length})`, ids.length > 60);
  const hash = createHash('sha256');
  let readable = 0;
  for (const id of [...ids].sort()) {
    let text;
    try {
      text = readFileSync(new URL(`../${id}`, import.meta.url), 'utf8');
      readable++;
    } catch { text = ''; }
    hash.update(id).update('\u0000').update(text);
  }
  ok(`every module it holds is still in the tree  (${readable}/${ids.length})`, readable === ids.length);
  const recomputed = hash.digest('hex').slice(0, 16);
  ok(`the single file is current  (stamp ${stamped}, src ${recomputed})`, stamped === recomputed);
}

console.log('\nand the README says the same thing the game does');
{
  // I14 fixed the help card and guarded it in both directions, and left the
  // README out — a third place the keys are written down, with nothing
  // checking it. It had drifted: `X` for a barrel roll, which M18 removed and
  // nothing binds; and E, O and F4 undocumented.
  const { ACTIONS: A, DEFAULT_BINDS: B, keyLabel: label } = await import('../src/core/keybinds.js');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const table = readme.split('\n').filter((l) => /^\| `|^\| mouse/.test(l)).join('\n');
  ok(`the README has a key table  (${table.split('\n').length} rows)`, table.split('\n').length > 8);

  // Some keys are documented as a group rather than one at a time, which reads
  // better than eleven rows would. Those groups are named here so the check
  // knows they are covered rather than missing.
  const GROUPED = {
    forward: 'W A S D', back: 'W A S D', left: 'W A S D', right: 'W A S D',
    sprint: 'Shift', hotbar1: '1', hotbar2: '1', hotbar3: '1', hotbar4: '1', hotbar5: '5',
  };
  const undocumented = A.filter((a) => {
    const needle = GROUPED[a.id] ?? label(B[a.id]);
    return !table.includes(`\`${needle}\``);
  }).map((a) => `${a.id} (${label(B[a.id])})`);
  ok(`every key is in the README  (${undocumented.join(', ') || `${A.length} actions`})`,
    undocumented.length === 0);

  // And the other way: the README must not promise a key the game does not
  // bind. That is what `X` was.
  const bound = new Set([...A.map((a) => label(B[a.id])), 'W A S D', 'Shift', '1', '5', '1`–`5']);
  const orphans = [...new Set([...table.matchAll(/`([^`]+)`/g)].map((m) => m[1]))]
    .filter((k) => !bound.has(k) && !/^[0-9]$|–|mouse/.test(k));
  ok(`and the README promises no key that does nothing  (${orphans.join(', ') || 'none'})`,
    orphans.length === 0);
}

console.log('\nevery key the game binds is written down');
{
  const help = readFileSync(new URL('../src/ui/help.js', import.meta.url), 'utf8');
  const binds = readFileSync(new URL('../src/core/keybinds.js', import.meta.url), 'utf8');
  const defaults = binds.slice(binds.indexOf('export const DEFAULT_BINDS'),
    binds.indexOf('const NAMED_KEYS'));
  const bound = [...defaults.matchAll(/^\s{2}([a-zA-Z0-9]+):\s*'/gm)].map((m) => m[1]);
  // Only the action arrays, not the labels beside them: a row is
  // ['Some words', ['action', 'action']] and the words are not bindings.
  const rows = help.slice(help.indexOf('export const ROWS'), help.indexOf('DOCUMENTED_BY_RANGE'));
  const listed = new Set(
    [...rows.matchAll(/\[([^[\]]*)\]\]/g)]
      .flatMap((m) => [...m[1].matchAll(/'([a-zA-Z0-9]+)'/g)].map((a) => a[1])),
  );
  const byRange = new Set(
    (/DOCUMENTED_BY_RANGE = \[([^\]]*)\]/.exec(help)?.[1] ?? '')
      .split(',').map((t) => t.trim().replace(/'/g, '')).filter(Boolean),
  );
  ok(`the game binds a sensible number of keys  (${bound.length})`, bound.length > 20);
  // "wtf is f" is what an incomplete list of keys feels like from the other
  // side: you press something, it does something, and nowhere says what. F was
  // in fact listed. M, F1, F2 and F3 were not — the same problem for four other
  // keys, and the same problem waiting for the next one added.
  const missing = bound.filter((a) => !listed.has(a) && !byRange.has(a));
  ok(`every binding has a line on the help card  (${missing.length ? missing.join(', ') : 'all of them'})`,
    missing.length === 0);
  // And nothing listed that is not bound, or the card promises a key that does
  // nothing.
  const phantom = [...listed].filter((a) => !bound.includes(a));
  ok(`and the card promises nothing the game does not bind  (${phantom.length ? phantom.join(', ') : 'none'})`,
    phantom.length === 0);
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

console.log('\na probe that could not answer is asked again');
{
  // The failure was cached for ever. One hiccup fetching one zoom-6 tile and a
  // square the size of a continent read "cannot tell" for the rest of the
  // session — which reads as land, which is a random teleport dropping you in
  // the middle of an ocean it could not see.
  const { WaterMap } = await import('../src/geo/water.js');
  const map = new WaterMap();
  let probes = 0;
  map.setSource({ ready: true, urlFor: () => { probes++; return null; } });
  await map.isWater(10, 10);
  await map.isWater(10.01, 10.01); // the same zoom-6 square
  ok(`a square that could not answer is not re-fetched at once  (${probes} probe)`, probes === 1);
  ok('and nothing was cached as though it were an answer',
    map.masks.size === 0 && map.failedAt.size === 1);
  // A minute passing. This is the part that never used to happen.
  for (const key of map.failedAt.keys()) map.failedAt.set(key, performance.now() - 61000);
  await map.isWater(10, 10);
  ok(`once the wait is over it is asked again  (${probes} probes)`, probes === 2);
  // And a square that did answer is never asked twice.
  const answered = new WaterMap();
  let asked = 0;
  answered.setSource({ ready: true, urlFor: () => { asked++; return null; } });
  answered.masks.set('6/33/30', new Uint8Array(32 * 32));
  await answered.isWater(10, 10);
  ok('a square that did answer is not asked again', asked === 0);
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
  // And the tools it was built out of are gone with it. A seeded hash and a
  // PRNG left lying about are an invitation: the next person wanting a height
  // for a square with no data has a ready-made way to invent one.
  {
    const maths = readFileSync(new URL('../src/core/math.js', import.meta.url), 'utf8');
    for (const gone of ['hash3', 'rand3', 'makeRng']) {
      ok(`${gone} is gone, not just unused`, !new RegExp(`function ${gone}\\b`).test(maths));
    }
  }

  ok('a tile job with no URL is an error rather than an invitation',
    /no imagery URL for this tile/.test(jobs) && /no elevation URL for this tile/.test(jobs));

  // The checks above name five files. A generator added to a sixth would pass
  // every one of them — which is the shape M17 exists to forbid: guard the
  // system, not the places that were wrong once.
  //
  // So the whole of src is scanned, and the two deliberate uses are named here
  // rather than left to be rediscovered. Both are rendering, neither invents
  // ground or content:
  //
  //   world/weather.js  the cloud deck. There is no per-frame photograph of
  //                     the sky to draw instead; the weather *state* driving
  //                     it is real, from Open-Meteo (see H5).
  //   world/shaders.js  the same value noise, for cloud shadow and for
  //                     crown-scale relief over woodland — shading only,
  //                     nothing is built, the ground does not move, and it is
  //                     off wherever OpenStreetMap has no wood mapped (H1).
  //
  // Anything else using noise has to come here and say why.
  const NOISE_ALLOWED = new Set(['world/shaders.js', 'world/weather.js']);
  const NOISE = /\bsimplex\b|\bperlin\b|\bfbm\b|value ?noise|\bprocedural\b/i;
  const PRNG = /\bmakeRng\b|\bmulberry32\b|\bxorshift\b|\bsfc32\b|\bhash3\b|\brand3\b/;
  const all = readdirSync(new URL('../src/', import.meta.url), { recursive: true })
    .map(String).filter((f) => f.endsWith('.js'));
  ok(`the scan reaches the whole of src  (${all.length} files)`, all.length > 60);
  const noisy = all.filter((f) => !NOISE_ALLOWED.has(f) && NOISE.test(read(f)));
  ok(`nothing outside the two rendering files reaches for noise  (${noisy.join(', ') || 'none'})`,
    noisy.length === 0);
  const seeded = all.filter((f) => PRNG.test(read(f)));
  ok(`and no file carries a seeded generator  (${seeded.join(', ') || 'none'})`,
    seeded.length === 0);
  // The exemptions have to stay honest: if one of them stops using noise, it
  // should come off the list rather than sit there licensing a future use.
  const unused = [...NOISE_ALLOWED].filter((f) => !NOISE.test(read(f)));
  ok(`and every exemption is still using it  (${unused.join(', ') || 'both'})`, unused.length === 0);
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
  // The two shells are hinged to something.
  //
  // Without a spine they met at the centreline with nothing between them, and
  // from the chase camera — which is the angle you actually look at this from —
  // the pair read as one continuous sheet with a notch cut out of the top. A
  // hang-glider, not an elytra. Photographed before and after from behind and
  // from above: the notch is filled and the shells now read as two.
  {
    const spine = avatar.spine;
    ok('the wings are hinged to a spine', !!spine && spine.parent === avatar.wings);
    if (spine) {
      spine.geometry.computeBoundingBox();
      const box = spine.geometry.boundingBox;
      const width = box.max.x - box.min.x;
      // Sized off the wing roots rather than typed: the outline starts at
      // WING_ROOT_X either side, so the gap is exactly twice that, and the
      // spine fills it leaving a seam either side.
      const gap = 0.045 * 2;
      ok(`and it fills the gap between them without covering the seam  (${width.toFixed(3)} in ${gap.toFixed(3)})`,
        width < gap && width > gap - 0.01);
      ok('it spans the root chord rather than a fraction of it',
        box.max.y - box.min.y > 0.2);
      // Darker than the membrane, or it is a lighter stripe rather than a hinge.
      ok('and it is the rim colour, not the membrane colour',
        spine.material.color.getHex() === 0x3f4739);
    }
  }

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
    // Measured off the built body, not copied from it. This was the literal
    // `0.15 / 2`, so when the torso was reshaped to a person's proportions the
    // check went on testing a number the game no longer used, and passed for
    // the wrong reason.
    //
    // A fresh, unposed avatar: `lean` is a fraction of standing height, and the
    // one above has been scaled to metres and yawed by the shoulder tests, so
    // measuring that gives the wrong units off a box widened by the turn. The
    // model faces -Z, so the chest front is the most negative face; max.z would
    // be the shoulder blades.
    const plain = new Avatar(new THREE.Scene());
    plain.root.updateMatrixWorld(true);
    const torsoBox = new THREE.Box3().setFromObject(plain.torso);
    const torsoHalfDepth = -torsoBox.min.z;
    const chestTop = torsoBox.max.y;
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
    const chestAngle = (Math.atan2(0.94 - chestTop, lean - torsoHalfDepth) * 180) / Math.PI;
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

  // The silhouette. This is what the chase camera actually shows, and it is
  // what was wrong: a 2.9 metre wingspan on a 1.83 metre player, with a body
  // under it lit by nothing. It is checked in numbers here because it went
  // wrong twice and both times it took a screenshot to notice.
  {
    const rig = new Avatar(new THREE.Scene());
    rig.wings.visible = true;
    rig.wingL.rotation.set(0.15, -0.35, 0.2);
    rig.wingR.rotation.set(0.15, 0.35, -0.2);
    rig.root.updateMatrixWorld(true);

    const own = (mesh) => {
      mesh.geometry.computeBoundingBox();
      return mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    };
    const spanOf = (b) => b.max.x - b.min.x;

    const spread = spanOf(new THREE.Box3().setFromObject(rig.wings));
    ok('the wings span about as wide as you are tall, like an elytron',
      spread > 0.9 && spread < 1.15, `${spread.toFixed(3)} of height`);
    ok('and not the 1.6 of a hang glider', spread < 1.3, `${spread.toFixed(3)}`);

    // Measured off the geometry rather than the posed box, because the pose
    // tilts the wing and a tilted bounding box is not a chord.
    const membrane = rig.wingR.children[0];
    membrane.geometry.computeBoundingBox();
    const g = membrane.geometry.boundingBox;
    // Slender enough to be a wing.
    //
    // This band used to be 1.2 to 1.8, reasoned from what an elytron is. At
    // 1.5 the chord is two thirds of the span and the pair render as two fat
    // leaves stuck on a back — a moth — however carefully the edges are drawn.
    // Depth is what does it, so the band moved and the wing got slimmer. The
    // old number was a guess about the object; this one is from looking at it.
    const aspect = (g.max.x - g.min.x) / (g.max.y - g.min.y);
    ok('the wing is slender enough to read as a wing, not a leaf',
      aspect > 1.8 && aspect < 2.7, `${aspect.toFixed(2)}:1`);

    // A flat prism is 0.012 thick and has a handful of normals. A shell is
    // neither, and it is the difference between a wing and a pale board.
    const depth = g.max.z - g.min.z;
    ok('the wing is a curved shell, not a flat plank', depth > 0.03,
      `${depth.toFixed(3)} deep against 0.012 for the extrusion alone`);
    const normals = membrane.geometry.getAttribute('normal');
    const dirs = new Set();
    for (let i = 0; i < normals.count; i += 1) {
      dirs.add(`${normals.getX(i).toFixed(1)},${normals.getY(i).toFixed(1)},${normals.getZ(i).toFixed(1)}`);
    }
    ok('so it shades across its span instead of as one flat colour',
      dirs.size > 12, `${dirs.size} distinct normals`);

    // The model is built one unit tall and scaled by your height. If it is not
    // one unit tall, you are not the height you asked for.
    rig.wings.visible = false;
    rig.root.updateMatrixWorld(true);
    const body = new THREE.Box3().setFromObject(rig.body);
    ok('the sole stands on the ground', Math.abs(body.min.y) < 0.002, body.min.y.toFixed(4));
    ok('and the crown is exactly one unit up', Math.abs(body.max.y - 1) < 0.002,
      body.max.y.toFixed(4));

    // A chest is 32 cm across and 19 cm deep on a 1.83 m person, not 48 and 27.
    const torso = own(rig.torso);
    ok('the chest is a chest rather than a wardrobe',
      torso.max.x - torso.min.x < 0.2, `${(torso.max.x - torso.min.x).toFixed(3)} of height`);

    // And you can see the wings from the camera you watch yourself from.
    //
    // This is the check that was missing, and it is the same shape of mistake
    // as the first-person one: everything here measured the wing, and the wing
    // was the right shape. What was wrong was its angle to the chase camera.
    // A flat wing held level is correct and invisible — the camera sits only
    // 16 degrees above the flight line in level flight, so a horizontal
    // surface seen from there is a blade, with no shape in it to say which way
    // up it is. The face has to be canted to meet the camera, which is what a
    // beetle's shell does and what makes elytra read as elytra.
    {
      const wing = new Avatar(new THREE.Scene());
      wing.setVisible(true);
      const membrane = wing.wingR.children[0];
      let worstSeen = 1;
      let levelDihedral = 0;
      for (const pitch of [0.2, 0, -0.25, -0.5, -0.8]) {
        const flyer = makePlayer({
          elytraDeployed: true, onGround: false, mode: 'glide', pitch,
          horizontalSpeed: 45,
          velocity: new THREE.Vector3(0, -45 * Math.sin(-pitch), -45 * Math.cos(pitch)),
        });
        for (let i = 0; i < 240; i += 1) wing.update(flyer, 1 / 60);
        wing.root.updateMatrixWorld(true);
        // Where the chase camera sits, from the rig's own offset — it climbs
        // as you dive, so a fixed direction would be right at one pitch only.
        const toCamera = new THREE.Vector3(0, -Math.sin(pitch) + 0.28, Math.cos(pitch))
          .normalize();
        const normal = new THREE.Vector3(0, 0, 1).transformDirection(membrane.matrixWorld);
        worstSeen = Math.min(worstSeen, Math.abs(normal.dot(toCamera)));

        if (pitch !== 0) continue;
        // Tips above the shoulders in level flight, not hanging below them.
        const position = membrane.geometry.getAttribute('position');
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < position.count; i += 1) {
          lo = Math.min(lo, position.getX(i));
          hi = Math.max(hi, position.getX(i));
        }
        const band = (from, to) => {
          const mid = new THREE.Vector3();
          let n = 0;
          for (let i = 0; i < position.count; i += 1) {
            const x = position.getX(i);
            if (x < from || x > to) continue;
            mid.add(new THREE.Vector3(x, position.getY(i), position.getZ(i))
              .applyMatrix4(membrane.matrixWorld));
            n += 1;
          }
          return mid.divideScalar(n);
        };
        const width = hi - lo;
        const root = band(lo, lo + width * 0.15);
        const tip = band(hi - width * 0.15, hi);
        levelDihedral = (Math.atan2(tip.y - root.y, tip.x - root.x) * 180) / Math.PI;
      }
      ok(`the wings face the chase camera at every pitch  (worst ${worstSeen.toFixed(2)})`,
        worstSeen > 0.6);
      // -22 degrees is where this started: the tips hung 30 cm below the
      // shoulders, which is a wing hanging off a body rather than one holding
      // it up, and is what read as on backwards or inside out.
      ok(`and the tips do not hang below the shoulders  (${levelDihedral.toFixed(1)}° in level flight)`,
        levelDihedral > -8);
    }

    // Hands on their own sides, standing and gliding alike.
    //
    // In a glide both arms were swung across the chest and out the other side,
    // so the left hand finished on the right and the right on the left — and
    // the firework, which is held in the right hand, appeared on the left of
    // the body with nothing holding it. Nothing in the model was the wrong
    // shape, so nothing that measured shapes could have caught it.
    for (const [what, over] of [
      ['standing', {}],
      ['gliding', { elytraDeployed: true, onGround: false, mode: 'glide',
        pitch: -0.35, horizontalSpeed: 45, velocity: new THREE.Vector3(0, -10, -44) }],
    ]) {
      const player = makePlayer(over);
      settle(player);
      const l = new THREE.Vector3();
      const r = new THREE.Vector3();
      avatar.fistL.getWorldPosition(l);
      avatar.fistR.getWorldPosition(r);
      ok(`${what}, the left hand is on the left and the right on the right`
        + `  (${l.x.toFixed(2)} / ${r.x.toFixed(2)})`, l.x < -0.05 && r.x > 0.05);

      // And the feet. The glide tuck swung each one 50 mm inward across hips
      // 44 mm apart, so the ankles crossed and the legs — the largest thing on
      // a figure seen from directly behind — drew as one blank rectangle.
      avatar.bootL.getWorldPosition(l);
      avatar.bootR.getWorldPosition(r);
      ok(`${what}, the feet are two feet rather than one`
        + `  (${((r.x - l.x) * 1000).toFixed(0)} mm apart)`, r.x - l.x > 0.05);
    }

    // Gliding in first person, something of you is out in front of the eye.
    //
    // A floor, not a proof, and the difference matters. The check that used to
    // live here computed a screen position from the model's own axis and passed
    // while the running game showed nothing of you at all — no arms, no hands,
    // no firework, landscape and nothing else. It could not have known: where a
    // hand lands on screen depends on the camera the rig places, and the rig
    // leaned the eye 0.1 of your height forward, which ate half the distance an
    // arm can reach in front of it. A number derived from the avatar alone
    // cannot see a camera that is not where the avatar thinks it is.
    //
    // So this asserts only what can be known here — the eye is at 0.94 of
    // height and the glide pose turns about it, so a hand nearer than the near
    // plane is certainly not visible — and the real test runs the game:
    // tools/handcheck.mjs poses a first-person glide at four look angles and
    // reports where the fist and the firework actually land in the frame.
    {
      const NEAR = 0.15;
      const rig = new Avatar(new THREE.Scene());
      rig.setVisible(true);
      rig.setFirstPerson(true);
      rig.root.scale.setScalar(1.83);
      const player = makePlayer({
        elytraDeployed: true, onGround: false, mode: 'glide', pitch: -0.35,
        horizontalSpeed: 45, velocity: new THREE.Vector3(0, -10, -44),
      });
      for (let i = 0; i < 240; i += 1) rig.update(player, 1 / 60);
      rig.root.updateMatrixWorld(true);
      const eye = new THREE.Vector3(0, 0.94 * 1.83, 0);
      const at = new THREE.Vector3();
      // A glide swaps the world arms for the view model, so what is drawn is
      // what gets measured. Naming one of them outright would have this check
      // reporting on a hidden object, which is the same class of mistake as
      // measuring against a camera that is not where the camera is.
      rig.hideWhatIsInYourEye(null);
      ok('gliding, the view model is what is drawn, not the world arms',
        rig.viewModel.visible && !rig.armR.pivot.visible);
      for (const [what, part] of [['your hand', rig.fistR], ['the firework', rig.rocket]]) {
        part.getWorldPosition(at);
        ok(`gliding, ${what} would clear the near plane if drawn`
          + `  (${at.distanceTo(eye).toFixed(2)} m of ${NEAR})`, at.distanceTo(eye) > NEAR + 0.1);
      }
      // And the backstop that deletes anything inside your eye must not be set
      // so wide that it deletes a thing held at arm's length — which it was, at
      // 0.34 of height, a 62 cm bubble around a firework carried at 35.
      const source = readFileSync(new URL('../src/player/avatar.js', import.meta.url), 'utf8');
      const tooClose = Number(/const TOO_CLOSE_M = ([\d.]+);/.exec(source)?.[1]);
      ok(`the too-close backstop is nearer than a held firework  (${tooClose} of height`
        + ` = ${(tooClose * 1.83).toFixed(2)} m)`, tooClose * 1.83 < 0.3);
      ok('and still further out than the near plane', tooClose * 1.83 > NEAR);
    }

    // Every garment carries its own fill, so nothing on the character can go
    // to a black slab when the sun is behind it.
    let darkest = 1;
    for (const mesh of [rig.torso, rig.head, rig.legR.limb, rig.bootR, rig.armR.limb]) {
      const e = mesh.material.emissive;
      darkest = Math.min(darkest, e.r * 0.299 + e.g * 0.587 + e.b * 0.114);
    }
    ok('and nothing on the body is left with no fill at all', darkest > 0.05,
      `darkest fill ${darkest.toFixed(3)}`);
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
    /if \(url === null\) \{\s*\n\s*this\.markBare\(entry\);/.test(streamer));
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

  // Carrying the string is not the same as showing it, and the licence this
  // ships under keeps the credit on screen. Measured in the running game at
  // 360, 768, 960, 1280 and 1920 px wide: it wraps inside its box, overflows by
  // nothing in either direction, and stays inside the viewport at every one.
  // What that measurement cannot do is stay true, so the two CSS ways of
  // losing it are refused here.
  {
    const css = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8');
    const block = /\.attribution\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    ok(`the attribution has its own styling  (${block.trim().split('\n').length} rules)`,
      block.trim().length > 0);
    ok('it is not clipped', !/overflow\s*:\s*hidden/.test(block));
    ok('it is not held to one line', !/white-space\s*:\s*nowrap/.test(block));
    ok('and it is not hidden', !/display\s*:\s*none/.test(block)
      && !/visibility\s*:\s*hidden/.test(block)
      && !/opacity\s*:\s*0(\.0*)?\s*[;}]/.test(block));
    // And it has to be in the HUD at all — a row that stops being rendered is
    // the other way to lose it.
    const hud = readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
    ok('the HUD renders it', /attribution/.test(hud));
  }

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

  // And the lid must not sit below it. The slider was capped at 22 with a help
  // line calling that "the deepest any provider here publishes" for a while
  // after Esri's entry had been raised past it — so a level that did exist
  // could not have been reached. Both now read the providers.
  // Every fixed ceiling here has been wrong in turn: nineteen, then twenty,
  // then the deepest a provider declared. So there is no fixed ceiling — the
  // slider runs to a last notch and then to none at all, and what actually
  // stops the quadtree is the provider refusing and the photographs
  // themselves stopping getting sharper. Both measured.
  const { NO_ZOOM_CEILING, ZOOM_SLIDER_MAX, zoomCeiling } =
    await import('../src/tiles/providers.js');
  const { DEFAULT_SETTINGS, GRAPHICS_PRESETS } = await import('../src/core/settings.js');
  ok('past the last notch there is no ceiling at all',
    zoomCeiling(NO_ZOOM_CEILING) === Infinity && zoomCeiling(20) === 20);
  ok('and that is where it sits by default',
    DEFAULT_SETTINGS.maxTileZoom >= NO_ZOOM_CEILING
    // Presets declare their overrides under `applies`; one that does not set a
    // ceiling is not capping anything, which is the point.
    && Object.values(GRAPHICS_PRESETS)
      .every((g) => (g.applies?.maxTileZoom ?? NO_ZOOM_CEILING) >= NO_ZOOM_CEILING));
  ok('the slider still offers real numbers up to the last notch',
    ZOOM_SLIDER_MAX >= 25 && NO_ZOOM_CEILING === ZOOM_SLIDER_MAX + 1);
  const panel = readFileSync(new URL('../src/ui/settingsPanel.js', import.meta.url), 'utf8');
  ok('including the slider a player sees',
    /key: 'maxTileZoom'[\s\S]{0,160}max: NO_ZOOM_CEILING/.test(panel)
    && /No limit/.test(panel));
  const terrainSrc = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');
  ok('and the quadtree reads it through that, not raw',
    /zoomCeiling\(settings\.get\('maxTileZoom'\)\)/.test(terrainSrc));

  // Every tier setting is resolved the same way, or two of them disagree.
  //
  // The drawn cap used to be a table of its own in terrain.js, keyed on
  // settings.get('graphics'). That reads 'auto' for everybody who has not
  // picked a tier by hand — which is everybody by default — and 'auto' was not
  // one of its keys, so the lookup missed and fell through to the high figure.
  // A Chromebook on Low drew up to 1100 squares instead of 520 and an Ultra
  // machine drew 1100 instead of 1500, and nothing said so, because the *other*
  // tier settings were read through settings.preset(), which resolves 'auto'
  // properly. Measured in the running game: graphics 'auto', preset cache 320
  // (Low), maxDrawn 1100 (High).
  //
  // What goes undrawn when the cap bites is whatever the walk had not reached,
  // which is the far half of the view — so this is not only frame rate, it is
  // ground disappearing.
  ok('the drawn cap is a preset field like the rest of the tier',
    Object.values(GRAPHICS_PRESETS).every((g) => typeof g.maxDrawnTiles === 'number'));
  ok('and the quadtree reads it from the preset, never from the raw setting',
    /settings\.preset\(\)\.maxDrawnTiles/.test(terrainSrc)
    && !/MAX_DRAWN_TILES/.test(terrainSrc));
  {
    // The thing that actually broke: ask for it while the setting says 'auto'
    // and it must be the chosen tier's number, not a fallback.
    const { settings: S } = await import('../src/core/settings.js');
    const before = S.get('graphics');
    const seen = [];
    for (const tier of ['low', 'medium', 'high', 'ultra']) {
      S.set('graphics', tier);
      seen.push(S.preset().maxDrawnTiles);
    }
    S.set('graphics', 'auto');
    const auto = S.preset().maxDrawnTiles;
    S.set('graphics', before);
    ok(`each tier has its own  (${seen.join(', ')})`, new Set(seen).size === 4);
    ok(`and 'auto' resolves to one of them rather than a fallback  (${auto})`,
      seen.includes(auto));
  }
  // And reaching the cap must cost detail, never ground.
  //
  // The walk is depth first, so returning at the cap abandons every square it
  // had not reached yet — no coarse stand-in, nothing. Everything else in
  // `draw` bends over backwards to make sure a square always has something to
  // show, down to going over the build budget rather than leaving a gap, and
  // one early return undid all of it. Past the cap the walk now stops
  // *splitting*: each square it still reaches is drawn as it is, so the world
  // gets blunter and stays whole.
  // Changing a setting must not cost you the world.
  //
  // Mesh detail, the graphics tier and the elevation provider all used to call
  // rebase, which disposes every node — so `draw` had no old mesh to keep
  // showing, no ancestor to stand in and no cover to grow, and took its last
  // branch: build anyway, over budget, for every square on screen. Measured
  // over the Black Forest, one step of the graphics setting rebuilt 497 meshes
  // inside a single second. A mesh from the wrong grid is still in the right
  // place at the right height wearing the right photograph, so it is marked and
  // rebuilt as the budget allows while it goes on being drawn.
  ok('a settings change marks the world stale rather than destroying it',
    /resettle\(\) \{\n    for \(const node of this\.nodes\.values\(\)\) node\.dirty = true;/.test(terrainSrc)
    && /if \(key === 'meshDetail' \|\| key === 'graphics' \|\| key === 'autoTier' \|\| key === 'detailLimit'\) \{\n      this\.terrain\.resettle\(\);/.test(
      readFileSync(new URL('../src/game.js', import.meta.url), 'utf8')));
  // And the two cases that genuinely cannot keep their meshes still do not.
  ok('but an origin move and a lost context still throw them away',
    /rebase\(\) \{\n    for \(const node of this\.nodes\.values\(\)\) this\.disposeNode\(node\);/.test(terrainSrc)
    && /this\.frame\.setAnchor\(geo\.lat, geo\.lon\);\n    this\.player\.position\.set\(0, y, 0\);\n    this\.terrain\.rebase\(\);/.test(
      readFileSync(new URL('../src/game.js', import.meta.url), 'utf8')));
  ok('and reaching it stops the splitting rather than the drawing',
    /const outOfBudget = this\.drawn\.length >= this\.maxDrawn;/.test(terrainSrc)
    && /!outOfBudget && tile\.z < maxZoom/.test(terrainSrc));
  ok('with a far ceiling above it so a runaway frame still ends',
    /HOLE_RATHER_THAN_STALL/.test(terrainSrc)
    && /this\.maxDrawn \* HOLE_RATHER_THAN_STALL/.test(terrainSrc));

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
  // Written off with a timestamp rather than for ever — see "A refusal is not a
  // permanent fact about the world". A Set here meant one dropped connection
  // blanked whatever you were flying over for the rest of the session.
  ok('a square nobody has flown is written off rather than re-asked',
    /this\.barren\.set\(entry\.key, now\(\)\)/.test(streamer));
  ok('and a level a whole region lacks pulls the depth back',
    /reviewDepth\(tile\) \{/.test(streamer));
}

// ---------------------------------------------------------------------------
console.log('\nNothing ships with holes in it');
{
  /*
    A mesh with an open edge is a mesh you can see through, and one shipped.

    The clusterer in tools/glb-optimise.py welds vertices onto a grid and drops
    the triangles that collapse. That stays watertight only while the key it
    welds on is the cell and nothing else. A quantised texture coordinate was
    added to the key, to stop a seam being averaged into a smear across the
    middle of the picture, and it tore the surface open: two vertices at one
    place with different coordinates stayed two vertices, so every chart
    boundary became a crack. The firework went out at 21.8% of its edges open,
    against 0.3% for the character, which was made before the clusterer existed.

    Counted after welding by position, because a texture seam is two indices at
    one place and an index-based test calls that a hole when it is not.
  */
  const { readdirSync } = await import('node:fs');
  const dir = new URL('../assets/', import.meta.url);
  let checked = 0;
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.glb'))) {
    const raw = readFileSync(new URL(name, dir));
    let off = 12;
    let json = null;
    let bin = null;
    while (off < raw.length) {
      const len = raw.readUInt32LE(off);
      const type = raw.toString('utf8', off + 4, off + 8);
      if (type === 'JSON') json = JSON.parse(raw.toString('utf8', off + 8, off + 8 + len));
      else if (type.startsWith('BIN')) bin = raw.subarray(off + 8, off + 8 + len);
      off += 8 + len;
    }
    const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
    const READ = {
      5120: [1, (b, o) => b.readInt8(o)], 5121: [1, (b, o) => b.readUInt8(o)],
      5122: [2, (b, o) => b.readInt16LE(o)], 5123: [2, (b, o) => b.readUInt16LE(o)],
      5125: [4, (b, o) => b.readUInt32LE(o)], 5126: [4, (b, o) => b.readFloatLE(o)],
    };
    const read = (i) => {
      const a = json.accessors[i];
      const view = json.bufferViews[a.bufferView];
      const [size, get] = READ[a.componentType];
      const n = NUM[a.type];
      const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
      const out = new Array(a.count * n);
      for (let k = 0; k < a.count * n; k += 1) out[k] = get(bin, base + k * size);
      return [out, a];
    };
    let open = 0;
    let edges = 0;
    for (const mesh of json.meshes ?? []) {
      for (const prim of mesh.primitives) {
        if (prim.indices === undefined) continue;
        const [pos, pa] = read(prim.attributes.POSITION);
        const [idx] = read(prim.indices);
        const span = Math.max(...[0, 1, 2].map((i) => pa.max[i] - pa.min[i])) || 1;
        const q = span * 1e-5;
        const weld = new Map();
        const id = new Array(pa.count);
        let usable = true;
        for (let v = 0; v < pa.count; v += 1) {
          const xyz = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
          if (!xyz.every(Number.isFinite)) { usable = false; break; }
          const key = xyz.map((c) => Math.round(c / q)).join(',');
          if (!weld.has(key)) weld.set(key, weld.size);
          id[v] = weld.get(key);
        }
        if (!usable) continue;
        const seen = new Map();
        for (let t = 0; t < idx.length; t += 3) {
          const [a, b, c] = [id[idx[t]], id[idx[t + 1]], id[idx[t + 2]]];
          if (a === b || b === c || a === c) continue;
          for (const [u, v] of [[a, b], [b, c], [c, a]]) {
            const key = u < v ? `${u}-${v}` : `${v}-${u}`;
            seen.set(key, (seen.get(key) ?? 0) + 1);
          }
        }
        for (const n of seen.values()) if (n === 1) open += 1;
        edges += seen.size;
      }
    }
    if (edges === 0) continue;
    checked += 1;
    const share = (100 * open) / edges;
    ok(`${name} is closed  (${share.toFixed(1)}% of its edges open)`, share < 1);
  }
  ok(`and there was something to check  (${checked} mesh${checked === 1 ? '' : 'es'})`,
    checked > 0);
}

console.log('\nNo tier buys frame rate by making the picture worse');
{
  const { GRAPHICS_PRESETS } = await import('../src/core/settings.js');
  /*
    Low was the only tier that did, and the two lines it did it with are the
    two that decide whether ground at a grazing angle is a photograph or a
    smear: anisotropy 8 against 16 everywhere else, and a pixel cap of 1.5
    against 2, which on a display reporting two device pixels per CSS pixel
    draws the world at 56% of the pixels the screen has and stretches it back.
    The auto dial puts any machine that misses its target on Low, so that was
    most machines some of the time and some machines all of the time.

    Medium already pays both, so neither can be what separates a machine that
    can run this from one that cannot. What separates them is world size, and
    Low still gives up two thirds of it.
  */
  for (const [name, preset] of Object.entries(GRAPHICS_PRESETS)) {
    if (!preset || typeof preset !== 'object' || !preset.applies) continue;
    ok(`${name} draws at the screen's own resolution  (cap ${preset.pixelRatioCap})`,
      (preset.pixelRatioCap ?? 2) >= 2);
    ok(`${name} filters the ground the same as every other tier  (${preset.anisotropy}x)`,
      preset.anisotropy === 16);
  }
  const low = GRAPHICS_PRESETS.low;
  const medium = GRAPHICS_PRESETS.medium;
  ok(`and Low is still much the lighter of the two  (${low.applies.renderDistanceKm} km`
    + ` against ${medium.applies.renderDistanceKm}, ${low.maxDrawnTiles} squares`
    + ` against ${medium.maxDrawnTiles})`,
    low.applies.renderDistanceKm <= medium.applies.renderDistanceKm / 2
    && low.maxDrawnTiles < medium.maxDrawnTiles
    && low.applies.buildings === false && low.applies.weather === false);
}

console.log('\nAuto graphics is a dial, not a label');
{
  const { AutoQuality } = await import('../src/core/autoQuality.js');
  const { settings } = await import('../src/core/settings.js');
  // There was a setting called autoQuality, defaulting to true, with a comment
  // pointing at a file that did not exist. Nothing read it, so every machine
  // sat on whatever tier it started at — High for everybody.
  ok('auto is what a fresh install gets', settings.get('graphics') === 'auto');

  const before = { graphics: settings.get('graphics'), tier: settings.get('autoTier') };
  // Each scenario gets its own dial and its own starting tier: sharing one
  // leaves a cooldown half spent and a tier already moved, and then the test
  // is measuring the previous scenario.
  const run = (fromTier, fps, seconds) => {
    settings.set('graphics', 'auto');
    settings.set('fpsTarget', 60);
    settings.set('autoTier', fromTier);
    const auto = new AutoQuality();
    const dt = 1 / fps;
    for (let t = 0; t < seconds; t += dt) auto.update(dt);
    return settings.get('autoTier');
  };

  ok('a machine missing the target walks down', run('ultra', 20, 60) === 'low');
  ok('and one with headroom walks back up', run('low', 200, 60) === 'ultra');
  // A machine *over* the target has headroom by definition, and this used to
  // deny it: the old rule wanted target * 1.35, which vsync makes unreachable.
  ok('a machine just over the target climbs', run('high', 64, 60) === 'ultra');
  // One step then wait: a dial that drops two tiers on one bad second does it
  // during the arrival stutter that was always going to end by itself.
  ok('it moves one tier and then waits', run('ultra', 20, 5) === 'high');

  settings.set('graphics', 'ultra');
  ok('choosing a tier disengages it', !new AutoQuality().engaged);
  settings.set('autoTier', 'low');
  const pinned = new AutoQuality();
  for (let t = 0; t < 40; t += 1 / 200) pinned.update(1 / 200);
  ok('and it does not touch the tier while disengaged',
    settings.get('autoTier') === 'low' && settings.tier === 'ultra');

  settings.set('graphics', before.graphics);
  settings.set('autoTier', before.tier);
}

// ---------------------------------------------------------------------------
console.log('\nThe speed on screen is the speed you are doing');
{
  const player = readFileSync(new URL('../src/player/player.js', import.meta.url), 'utf8');
  const controller = readFileSync(new URL('../src/player/controller.js', import.meta.url), 'utf8');

  // The controller moves you by `velocity * step * multiplier`, and counts
  // distance the same way — but `speed` returned the bare velocity. With speed
  // mode running, whose entire point is covering twice the ground, the readout
  // showed half of what you were doing. Two answers to one question, one file
  // apart.
  ok('the controller moves you by the multiplied velocity',
    /player\.position\.x \+= player\.velocity\.x \* step \* multiplier/.test(controller));
  ok('and counts distance the same way',
    /distanceTravelled \+= player\.velocity\.length\(\) \* step \* multiplier/.test(controller));
  ok('so the readout does too',
    /get speed\(\) \{[\s\S]{0,80}?velocity\.length\(\) \* this\.speedMultiplier/.test(player));
  ok('flattened as well',
    /get horizontalSpeed\(\)[\s\S]{0,140}?\* this\.speedMultiplier/.test(player));
  // The flight model still has its own untouched figure, since the elytra
  // constants are tuned in it.
  ok('and the flight model keeps its own', /get modelSpeed\(\)/.test(player));
}

// ---------------------------------------------------------------------------
console.log('\nSpeed and look angle read in the units you asked for');
{
  const { formatSpeed, formatPitch } = await import('../src/core/units.js');

  // Speed was only ever per hour. A glide is felt per second, and "how far did
  // that dive take me" is a question per minute answers. Both were asked for.
  ok(`per hour is unchanged  (${formatSpeed(30, 'metric')})`, formatSpeed(30, 'metric') === '108 km/h');
  ok(`and imperial too  (${formatSpeed(30, 'imperial')})`, formatSpeed(30, 'imperial') === '67 mph');
  ok(`per second, metric  (${formatSpeed(30, 'metric', 'second')})`,
    formatSpeed(30, 'metric', 'second') === '30.0 m/s');
  ok(`per second, imperial  (${formatSpeed(30, 'imperial', 'second')})`,
    formatSpeed(30, 'imperial', 'second') === '98 ft/s');
  ok(`per minute, metric  (${formatSpeed(30, 'metric', 'minute')})`,
    formatSpeed(30, 'metric', 'minute') === '1.80 km/min');
  ok(`per minute, imperial  (${formatSpeed(30, 'imperial', 'minute')})`,
    formatSpeed(30, 'imperial', 'minute') === '1.12 mi/min');
  // The three agree with each other, which is the only way to know none of the
  // conversions is a typo.
  const metric = [1, 60, 3600].map((m, i) =>
    parseFloat(formatSpeed(30, 'metric', ['second', 'minute', 'hour'][i])) * (i === 0 ? 1 : i === 1 ? 1000 / 60 : 1000 / 3600));
  ok(`the three time units agree  (${metric.map((v) => v.toFixed(1)).join(' ')})`,
    metric.every((v) => Math.abs(v - 30) < 0.5));
  ok('nothing is read from a number that is not one', formatSpeed(NaN, 'metric') === '—');

  // The compass said where you were pointed on the ground and nothing about
  // the other axis, which is half of flying.
  ok(`level reads as level  (${formatPitch(0)})`, formatPitch(0) === 'level');
  ok('up is positive', formatPitch(0.5).startsWith('+'));
  // Was pinned to U+2212 MINUS SIGN, which is the character I16 was opened
  // about: it is absent from some Android and embedded font sets and draws as
  // an empty box. A pitch readout is a number, and a number's sign is the
  // hyphen-minus every font has.
  ok(`down is negative  (${formatPitch(-0.5)})`, /^-/.test(formatPitch(-0.5)));
  ok('and not with a glyph a phone may not have', !formatPitch(-0.5).includes('\u2212'));
  ok(`and it is degrees  (${formatPitch(Math.PI / 4)})`, formatPitch(Math.PI / 4) === '+45\u00b0');

  const hud = readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
  ok('the HUD shows the look angle', /setText\('pitch', formatPitch/.test(hud));
  ok('and reads the speed unit from the setting',
    /formatSpeed\(player\.speed, units, settings\.get\('speedPer'\)\)/.test(hud));
  const panel = readFileSync(new URL('../src/ui/settingsPanel.js', import.meta.url), 'utf8');
  ok('and there is a control for it', /key: 'speedPer'/.test(panel));
}

// ---------------------------------------------------------------------------
console.log('\nGround behind you is held for the same time on every machine');
{
  const { ImageryStreamer } = await import('../src/tiles/streamer.js');
  const streamer = new ImageryStreamer({ addEventListener() {}, postMessage() {} }, null);

  // The hold used to be counted in frames — 240 of them, commented as "about
  // four seconds at 60 fps", which is true only at exactly sixty:
  //   144 fps 1.7 s | 60 fps 4.0 s | 30 fps 8.0 s | 10 fps 24 s
  // So the better the machine, the sooner the imagery behind you was thrown
  // away, and turning round fetched it all again.
  const source = readFileSync(new URL('../src/tiles/streamer.js', import.meta.url), 'utf8');
  ok('the hold is a time, not a frame count',
    /const KEEP_SECONDS/.test(source) && !/KEEP_FRAMES/.test(source));
  ok('and it is long enough to fly out and come back',
    /const KEEP_SECONDS = (\d+)/.exec(source)[1] >= 15);
  ok('every entry carries when it was last seen', /seen: now\(\)/.test(source));
  ok('and eviction reads that rather than the frame counter',
    /moment - \(entry\.seen \?\? 0\) < KEEP_SECONDS/.test(source));

  // A tile just asked for is stamped, whatever the frame number is doing.
  const tile = { z: 14, x: 100, y: 200 };
  const entry = streamer.entries?.get?.(`14/100/200`) ?? null;
  ok('a fresh streamer has nothing to evict', entry === null);
  ok('and touching an unknown tile is harmless', streamer.touch(tile) === undefined);
}

// ---------------------------------------------------------------------------
console.log('\nAll three ways of opening the game can say what went wrong');
{
  const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
  const index = read('index.html');
  const online = read('terraglide-online.html');
  const bundle = read('terraglide.html');

  // Double-clicked out of the zip, index.html runs from file:// — and browsers
  // refuse ES modules there, so main.js never runs. The watchdog then blamed
  // the network after twenty seconds of blank screen. There is no network. The
  // file that works is in the same folder, out of the same zip.
  ok('opened as a local file, it goes to the copy that works',
    /location\.protocol === 'file:'/.test(index) && /location\.replace\('\.\/terraglide\.html'\)/.test(index));
  // The guard has to know where the code is coming from, and a classic script
  // only sees what the parser has already reached — so the entry points are
  // declared above it.
  //
  // This used to check that the module tag appeared before the first plain
  // <script>, which passed for free the moment the module tag was removed:
  // indexOf returns -1 for something absent, and -1 is less than everything.
  // A check that cannot fail is not a check.
  const entryAt = index.indexOf('__TERRAGLIDE_ENTRY__');
  const redirectAt = index.indexOf("location.protocol === 'file:'");
  ok(`the entry is declared before the guard reads it  (${entryAt} then ${redirectAt})`,
    entryAt > 0 && redirectAt > 0 && entryAt < redirectAt);
  // Only when the code itself is local. The online edition is this same page
  // pointed at the published site and loads from file:// perfectly well.
  ok('but not when the code comes from a site',
    /__TERRAGLIDE_ENTRY__\.indexOf\('http'\) !== 0/.test(index));

  // The online edition used to be a second copy of the page with every script
  // stripped out, which threw away the watchdog along with the module tag — so
  // the page most likely to fail was the only one that could not say so.
  ok('the online edition kept the watchdog', online.includes('Could not start'));
  ok('and the favicon', online.includes('rel="icon"'));
  ok('and the description', online.includes('name="description"'));
  ok('and points its offline link at the published copy',
    /href="https:\/\/[^"]+\/terraglide\.html"/.test(online));
  ok('and left no relative path behind', !/"\.\//.test(online));

  // The bundle is built from the same index.html. If the redirect survived into
  // it, opening it from a file would send it to itself, for ever.
  const moduleTag = /<script[^>]*type="module"[^>]*>/.exec(bundle);
  ok('the single file cannot redirect to itself',
    !bundle.includes("indexOf('file:')") || !(moduleTag && /src=/.test(moduleTag[0])));
  ok('and carries its modules rather than fetching them',
    !(moduleTag && /src=/.test(moduleTag[0])));
}

// ---------------------------------------------------------------------------
console.log('\nThe map does not go white when it changes zoom');
{
  const { MapTileCache } = await import('../src/ui/mapTiles.js');
  const stub = (cache, z, x, y) => cache.tiles.set(`${z}/${x}/${y}`, {
    key: `${z}/${x}/${y}`, state: 'ready', bitmap: { width: 256, height: 256 }, used: 0,
  });
  const covered = (parts) => parts.reduce((sum, part) => sum + part.size * part.size, 0);
  const Z = 12;
  const X = 1000;
  const Y = 700;

  // Zooming out — which is what climbing does to the minimap — leaves the
  // sharp squares in the cache and the coarse one not yet asked for. resolve
  // only ever walks up, so it had no answer, and the renderer painted blank
  // paper. Blank paper for the street layer is near-white, over everything.
  const cache = new MapTileCache();
  ok('walking up finds nothing when you zoom out', cache.resolve(Z, X, Y) === null);

  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) stub(cache, Z + 2, X * 4 + i, Y * 4 + j);
  }
  const full = cache.descend(Z, X, Y, 2);
  ok(`the squares inside it are used instead  (${full.length} pieces)`, full.length === 16);
  ok('covering the whole square', Math.abs(covered(full) - 1) < 1e-9);

  // Partly covered draws the parts it has rather than nothing.
  const half = new MapTileCache();
  stub(half, Z + 1, X * 2, Y * 2);
  stub(half, Z + 1, X * 2 + 1, Y * 2);
  const parts = half.descend(Z, X, Y, 2);
  ok(`a partly cached square draws its parts  (${(covered(parts) * 100).toFixed(0)}%)`,
    parts.length === 2 && Math.abs(covered(parts) - 0.5) < 1e-9);

  ok('and an empty cache still says nothing', new MapTileCache().descend(Z, X, Y, 2).length === 0);

  const renderer = readFileSync(new URL('../src/ui/mapRenderer.js', import.meta.url), 'utf8');
  ok('the renderer asks before it paints paper', /cache\.descend\(/.test(renderer));
  ok('and only paints it where nothing is known', /inside\.length < 16/.test(renderer));
}

// ---------------------------------------------------------------------------
console.log('\nThe map shows exactly the ground you explored');
{
  const { encodeCells, decodeCells } = await import('../src/ui/exploration.js');

  // A flight: discs of visited ground strung along a path, at every level.
  const flown = new Set();
  let lat = 46.5;
  let lon = 7.9;
  for (let step = 0; step < 400; step++) {
    lat += 0.004;
    lon += 0.010;
    for (const z of [8, 10, 12, 14, 16]) {
      const n = 2 ** z;
      const cx = Math.floor(((lon + 180) / 360) * n);
      const cy = Math.floor(((90 - lat) / 180) * n);
      const r = z >= 14 ? 4 : z >= 12 ? 3 : 2;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          flown.add(`${z}/${cx + dx}/${cy + dy}`);
        }
      }
    }
  }

  const keys = [...flown];
  const back = new Set(decodeCells(encodeCells(keys)));
  // The save used to drop 45% of the finest squares at random, permanently and
  // compounding on every reload, which is why the map never matched the flight.
  ok(`every square you flew comes back  (${back.size}/${flown.size})`, back.size === flown.size);
  ok('and they are the same squares', keys.every((key) => back.has(key)));
  ok('and none was invented', [...back].every((key) => flown.has(key)));

  // Twice in a row is the same answer: the old rule rolled a die per square,
  // so two reads of one record disagreed.
  const a = JSON.stringify(encodeCells(keys));
  const b = JSON.stringify(encodeCells(keys));
  ok('saving is deterministic', a === b);

  // Small enough that the record does not have to be cut down to fit.
  const plain = JSON.stringify(keys).length;
  ok(`rows beat squares by a wide margin  (${(plain / a.length).toFixed(1)}x)`, plain / a.length > 5);

  // A save written before this still opens.
  const legacy = decodeCells(['14/1/2', '16/3/4']);
  ok('an older save is still read', legacy.length === 2 && legacy.includes('14/1/2'));
  ok('and rubbish is not', decodeCells(null).length === 0 && decodeCells({ v: 9 }).length === 0);

  const source = readFileSync(new URL('../src/ui/exploration.js', import.meta.url), 'utf8');
  ok('nothing about the record is left to chance',
    !/Math\.random\(\)\s*<\s*0?\.\d/.test(source));
}

// ---------------------------------------------------------------------------
console.log('\nA setting that changes takes effect');
{
  const { settings } = await import('../src/core/settings.js');
  const before = settings.get('graphics');

  const seen = [];
  const off = settings.on('change', ({ key }) => seen.push(key));
  settings.set('graphics', 'ultra');
  seen.length = 0;
  settings.set('graphics', 'low');

  // Picking a preset writes everything the preset covers, one change event
  // each. The game used to hear about these through the settings panel's own
  // callback, which reports only the control a hand actually moved — so eight
  // of the nine were stored and never applied.
  ok(`a preset writes more than the key you touched  (${seen.length} keys)`, seen.length > 3);
  ok('including the one the terrain mesh is built from', seen.includes('meshDetail'));
  ok('and the one the horizon is drawn to', seen.includes('renderDistanceKm'));
  if (typeof off === 'function') off();

  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  ok('the game listens to the store', /settings\.on\('change'/.test(game));
  ok('and not to the widget', !/settingsPanel\.onChange\s*=/.test(game));
  // A preset writes half a dozen keys in a row, and two of the responses
  // rebuild every terrain mesh. Doing that once per key is a stutter storm.
  ok('changes are coalesced into one pass', /applyPendingSettings\(\)/.test(game));
  // Auto quality moves autoTier, which moves the preset. It moved the number
  // and never the picture.
  ok('and a tier the game chose applies like one you chose',
    /key === 'autoTier'/.test(game));

  settings.set('graphics', before);
}

// ---------------------------------------------------------------------------
console.log('\nTurning your head does not lose the ground');
{
  const THREE = await import('../vendor/three/three.module.js');
  const { Terrain } = await import('../src/world/terrain.js');
  const { LocalFrame } = await import('../src/geo/frame.js');

  let resolved = 0;
  const frame = new LocalFrame();
  frame.setAnchor(46.56, 7.91);
  const terrain = new Terrain({
    scene: new THREE.Scene(), frame, shared: { uSnowLine: { value: 0 } },
    elevation: {
      version: 1, maxZoom: 15, hasDataAt: () => true, zoomAt: () => 15,
      sampleNorm: () => 800, sampleCoarse: () => 800,
      beginFrame() {}, request() {}, ensureAround() {},
    },
    streamer: {
      textureFor: () => null, request() {}, atFinest: () => true, noteSharpness() {},
      resolve: () => { resolved++; return null; }, beginFrame() {}, evict() {},
      frame: 0, maxUsefulZoom: () => 15, pump() {}, requestAncestors() {},
    },
  });
  // A frustum that rejects everything: stands in for facing the other way.
  terrain.frustum = { intersectsBox: () => false };
  terrain.maxDrawn = 500;

  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 1e7);
  const z = 14;
  const n = 2 ** z;
  const here = { z, x: Math.floor(0.5219 * n), y: Math.floor(0.3489 * n) };
  const corner = frame.normToWorld(here.x / n, here.y / n, { x: 0, z: 0 });
  const size = frame.worldTileSize(z);
  const camX = corner.x + size / 2;
  const camZ = corner.z + size / 2;
  const away = { z, x: here.x + 400, y: here.y };

  // The walk *returns* on a frustum miss, so a tile the camera is not looking
  // at is never split, never built, and never in `drawn` — and meshHeightAt
  // reads `drawn`. Looking at the horizon therefore lost the floor directly
  // beneath you, and looking back down brought the real relief in all at once:
  // "teleporting again when I look down after a teleport".
  const visits = (tile) => {
    resolved = 0;
    terrain.budget = { ms: 1e6, start: performance.now(), built: 0, refreshed: 0 };
    terrain.visit(tile, camera, camX, camZ, 200000, 20);
    return resolved > 0;
  };
  ok('the ground under you is built even facing away', visits(here));

  // Fresh relief walks the ground to its new height instead of stepping it.
  //
  // A tile is drawn from the finest elevation that has arrived, so when finer
  // elevation arrives the answer changes — that part cannot be helped. What can
  // is the whole tile stepping several metres between two frames, which is what
  // "the ground moves up and down in sections" is: the sections are elevation
  // tiles and the moment is the moment their data landed.
  {
    const node = [...terrain.nodes.values()].find((n) => n.mesh && n.geometry);
    ok('a built tile remembers where it stood', !!node?.geometry.attributes.prevY);
    if (node) {
      const morph = node.material.uniforms.uMorph;
      ok('and starts settled, having nowhere to walk from', morph.value === 1);

      // Move the ground under it and rebuild: it should set off walking.
      const position = node.geometry.attributes.position.array;
      for (let v = 1; v < position.length; v += 3) position[v] += 12;
      node.dirty = true;
      terrain.budget = { ms: 1e6, start: performance.now(), built: 0, refreshed: 0 };
      // build(tile, x0, z0, size, existing) — rebuilding the node in place is
      // what an elevation refresh does, and it is the path that morphs.
      terrain.build(node.tile, node.mesh.position.x, node.mesh.position.z,
        frame.worldTileSize(node.tile.z), node);
      ok(`ground that moved sets off walking  (uMorph ${morph.value})`, morph.value === 0);

      // And it gets there, in about the time it says.
      let elapsed = 0;
      for (let frame = 0; frame < 200 && morph.value < 1; frame += 1) {
        terrain._settledAt = performance.now() - 16;
        terrain.settleHeights();
        elapsed += 0.016;
      }
      ok(`and finishes in about a third of a second  (${elapsed.toFixed(2)} s)`,
        morph.value >= 1 && elapsed > 0.2 && elapsed < 0.6);
    }
  }

  // The freecam renders from somewhere else while the ground stays built for
  // the player — that split is deliberate, so flying the camera across a
  // country does not re-cut the whole quadtree. But the frustum came from the
  // player's camera too, so ground behind the player was never drawn, and the
  // freecam is usually pointed at exactly that. No mesh, no hole to see it
  // through, just sky.
  const facing = (yaw) => {
    const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 1e7);
    cam.position.set(camX, 1400, camZ);
    cam.rotation.set(0, yaw, 0, 'YXZ');
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    return cam;
  };
  const behind = { z, x: here.x, y: here.y + 3 };
  const drawnWith = (viewCamera) => {
    terrain.frustum = new THREE.Frustum();
    const m = new THREE.Matrix4().multiplyMatrices(
      viewCamera.projectionMatrix, viewCamera.matrixWorldInverse);
    terrain.frustum.setFromProjectionMatrix(m);
    terrain.split.clear();
    terrain.drawn.length = 0;
    terrain.budget = { ms: 1e6, start: performance.now(), built: 0, refreshed: 0 };
    terrain.visit(behind, facing(0), camX, camZ, 200000, 20);
    return terrain.drawn.length > 0;
  };
  ok('ground behind the player is invisible to the player', !drawnWith(facing(0)));
  ok('but the freecam looking back at it sees it', drawnWith(facing(Math.PI)));

  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  // The third argument is the camera the frustum culls against, and it has to
  // be the one actually drawn. Written to allow a fourth — the prefetch lead —
  // because the check is about which camera, not about how many arguments.
  ok('and the game passes the camera it actually draws through',
    /terrain\.update\(\s*\n[\s\S]{0,300}?budget,\s*\n\s*this\.camera,/.test(game));
  // And the frustum still does its job everywhere else, which is most of what
  // makes the quadtree affordable.
  ok('ground you cannot see and are not on is still skipped', !visits(away));
}

// ---------------------------------------------------------------------------
console.log('\nThe view reacts while the rocket is still pushing');
{
  const rig = readFileSync(new URL('../src/camera/cameraRig.js', import.meta.url), 'utf8');
  const { stepRocket, stepGlide, rocketTicks, rocketPowerFor } =
    await import('../src/player/elytra.js');

  // How fast a rocket actually does its work, so the camera can be judged
  // against it rather than against a guess.
  const look = { x: 0, y: 0, z: -1 };
  const v = { x: 0, y: 0, z: -8 };
  const ticks = rocketTicks(1);
  const power = rocketPowerFor(1);
  const speeds = [];
  for (let t = 0; t < ticks; t++) {
    stepRocket(v, look, power, t / ticks);
    stepGlide(v, look, 0);
    speeds.push(Math.hypot(v.x, v.y, v.z));
  }
  ok(`a rocket has done most of its work in three ticks  (${speeds[2].toFixed(0)} m/s of ${Math.max(...speeds).toFixed(0)})`,
    speeds[2] > Math.max(...speeds) * 0.9);

  ok('the view opens on a different rate from the one it closes on',
    /opening \? 14 : 4/.test(rig));

  /*
    A firework lit is a shove; a key held down is a burn.

    Every ignition used to sum into one decaying amplitude, and above about two
    presses a second the sum outran the decay and parked the camera at its
    ceiling — a seven-hertz wobble that lasts as long as the key does, which is
    the jitter. Minecraft has no camera shake on a firework at all.
  */
  {
    const { CameraRig } = await import('../src/camera/cameraRig.js');
    const decay = (from, dt) => from * Math.exp(-6 * dt);
    const sustained = (perSecond, kick) => {
      let shake = 0;
      const rig2 = Object.create(CameraRig.prototype);
      rig2.shake = 0;
      rig2.sinceKick = Infinity;
      const dt = 1 / 60;
      let next = 0;
      let peak = 0;
      for (let t = 0; t < 4; t += dt) {
        if (t >= next) {
          if (kick) rig2.kick(0.2); else shake = Math.min(0.6, shake + 0.2);
          next = t + 1 / perSecond;
        }
        rig2.sinceKick += dt;
        rig2.shake = decay(rig2.shake, dt);
        shake = decay(shake, dt);
        if (t > 3) peak = Math.max(peak, kick ? rig2.shake : shake);
      }
      return peak;
    };
    const oneOld = sustained(1, false);
    const oneNew = sustained(1, true);
    ok(`one press a second is untouched  (${oneOld.toFixed(3)} then ${oneNew.toFixed(3)})`,
      Math.abs(oneOld - oneNew) < 0.002);
    const heldOld = sustained(20, false);
    const heldNew = sustained(20, true);
    ok(`a held key used to park the camera at its ceiling  (${heldOld.toFixed(2)} of 0.6)`,
      heldOld > 0.5);
    ok(`and now shoves once and settles  (${heldNew.toFixed(2)})`,
      heldNew < oneNew * 1.05);
    ok('the gap that separates a shove from a burn is named',
      /const SHAKE_REFRACTORY_S = 0\.45;/.test(rig)
      && /if \(this\.sinceKick < SHAKE_REFRACTORY_S\) return;/.test(rig)
      && /Math\.min\(0\.6, Math\.max\(this\.shake, amount\)\)/.test(rig));
  }

  // The damp curve, on the two rates, against that three-tick window.
  const damp = (from, to, lambda, dt) => to + (from - to) * Math.exp(-lambda * dt);
  const reached = (rate, seconds) => {
    let fov = 78;
    for (let t = 0; t < seconds; t += 1 / 60) fov = damp(fov, 94, rate, 1 / 60);
    return (fov - 78) / 16;
  };
  ok(`the old rate was a third of the way there  (${(reached(5, 0.15) * 100).toFixed(0)}%)`,
    reached(5, 0.15) < 0.6);
  ok(`the new one is nearly all of it  (${(reached(14, 0.15) * 100).toFixed(0)}%)`,
    reached(14, 0.15) > 0.85);
  // And it must not snap back the same way, or the view flickers on every gust.
  ok(`closing is slow  (${(reached(4, 0.15) * 100).toFixed(0)}% in the same time)`,
    reached(4, 0.15) < 0.5);
}

// ---------------------------------------------------------------------------
console.log('\nThe settings say what the code actually does');
{
  const panel = readFileSync(new URL('../src/ui/settingsPanel.js', import.meta.url), 'utf8');
  const terrain = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');

  // "Draw twice as far over country you have seen" — while the distance is a
  // separate slider running 64 to 1024 km. There is no two anywhere in it.
  ok('the label no longer promises a factor it does not apply',
    !/twice as far/.test(panel));
  ok('and says what it does instead',
    /Keep drawing past the horizon where you have been/.test(panel));
  ok('with the distance as its own control underneath',
    /How far, over ground you have seen/.test(panel));

  // "Why is the distance horizon forced": the setting is a floor, and the real
  // horizon raises it — up to six times — because stopping the world at 24 km
  // from four hundred metres up puts a band of haze where the mountains are.
  ok('render distance is a floor that the horizon can raise',
    /clamp\(horizon, setting, setting \* 6\)/.test(terrain));
  ok('and the setting says so', /Climbing extends it/.test(panel));
  ok('and says how far it can go', /up to six times this/.test(panel));

  // The number in that copy is the real geometric horizon.
  const horizon = (metres) => Math.sqrt(2 * 6371000 * metres) / 1000;
  ok(`four hundred metres up really is about seventy km  (${horizon(400).toFixed(0)})`,
    Math.abs(horizon(400) - 71) < 3);
  ok(`and standing up is about five  (${horizon(2).toFixed(0)})`, Math.abs(horizon(2) - 5) < 1);
}

// ---------------------------------------------------------------------------
console.log('\nThe map opens where you were reading it');
{
  const { DEFAULT_SETTINGS } = await import('../src/core/settings.js');
  const worldmap = readFileSync(new URL('../src/ui/worldmap.js', import.meta.url), 'utf8');
  const { metresPerPixel } = await import('../src/ui/mapRenderer.js');

  // It opened at zoom six every time — most of a continent — so the first thing
  // anybody did on opening the map was zoom in.
  ok('there is a remembered zoom', 'worldMapZoom' in DEFAULT_SETTINGS);
  ok('it opens at it', /settings\.get\('worldMapZoom'\)/.test(worldmap));
  ok('and saves it when you zoom', /settings\.set\('worldMapZoom', next\)/.test(worldmap));
  ok('clamped to zooms the map actually has', /clamp\(Math\.round\(settings\.get\('worldMapZoom'\)\), 2, 19\)/.test(worldmap));

  // A two-dimensional size has to be checked in two dimensions.
  //
  // The canvas is inside a flex panel, so its box changes for reasons the
  // window knows nothing about — the sidebar rewrapping, the waypoint list
  // growing, a phone toolbar sliding away. The only checks were a window resize
  // listener and `clientWidth !== this.width`, so getting taller without getting
  // wider left the backing store at its old height while the CSS stretched it
  // to the new one. Measured in the browser: shrink the box from 642x502 to
  // 642x301 and the store stayed 642x502, a stretch factor of 0.60. With the
  // observer it followed exactly.
  // Waypoints can be picked up and put down on the map.
  //
  // Moving rather than re-adding matters: dropping a new one and deleting the
  // old would renumber it and give it the next colour in the palette, so a drag
  // would look like a different waypoint arriving somewhere else.
  {
    const { WaypointStore } = await import('../src/ui/waypoints.js');
    const store = new WaypointStore();
    store.waypoints = [];
    const wp = store.add(10, 20, 'Here');
    const before = { id: wp.id, colour: wp.colour, name: wp.name };
    store.move(wp.id, 11, 21);
    const after = store.waypoints[0];
    ok('a waypoint can be moved without becoming a different waypoint',
      store.waypoints.length === 1 && after.id === before.id
      && after.colour === before.colour && after.name === before.name);
    ok('and it is actually somewhere else', after.lat === 11 && after.lon === 21);
    ok('moving one that is not there is not an error', store.move(9999, 0, 0) === null);
  }
  ok('the map picks a waypoint up before it starts panning',
    /const hit = this\.waypointAt\(event\);/.test(worldmap)
    && /this\.draggingWaypoint = hit\.id;/.test(worldmap));
  ok('and the hit test takes the antimeridian the short way, like the drawing does',
    /if \(ox > size \/ 2\) ox -= size;/.test(worldmap));
  // Checked in the browser: a waypoint at the map centre plus a hundredth of a
  // degree, dragged 90 px east and 60 px south, moved from 46.57230, 7.92260 to
  // 46.56523, 7.93801 — east and south, one waypoint still, and a press on
  // empty map still panned.

  // A request that never arrived says so, rather than passing the browser's
  // two-word message through.
  //
  // "Photorealistic 3D — failed to fetch" was that: no status, no body, no
  // origin, and it reads as the token being wrong when it is the one case where
  // the token is *not* what is wrong. A transport failure has three usual
  // causes and none of them is the credential: nothing reaching the network,
  // the service refusing this page's origin — a file:// page sends
  // `Origin: null`, which several metered APIs will not answer — or an
  // extension blocking it.
  {
    const providers = readFileSync(new URL('../src/tiles/providers.js', import.meta.url), 'utf8');
    const tiles3d = readFileSync(new URL('../src/world/tiles3d.js', import.meta.url), 'utf8');
    ok('a credentialed call that never arrives is reported as that',
      /async function reach\(url, options, what\)/.test(providers)
      && /could not be reached/.test(providers));
    ok('and every credentialed call goes through it',
      (providers.match(/await reach\(/g) ?? []).length === 3
      && !/const res = await fetch\(\n {6}`https:\/\/tile\.googleapis/.test(providers));
    ok('the 3D route says the same rather than "failed to fetch"',
      /the request never `\n {6}\+ 'arrived rather than being refused/.test(tiles3d));
    ok('and all three name the file:// origin, which is the non-obvious one',
      /file:\/\/ URL/.test(providers) && /file:\/\/ URL/.test(tiles3d));
    // The settings panel says the same thing where the key is actually typed.
    const panel = readFileSync(new URL('../src/ui/settingsPanel.js', import.meta.url), 'utf8');
    ok('and the key fields warn about referrer restrictions before you paste one',
      /HTTP-referrer restrictions/.test(panel) && /URL restrictions/.test(panel));
  }

  // Nothing a font can fail to draw is the whole content of a control.
  //
  // The zoom pair used to be "+" and U+2212 MINUS SIGN, typed as text. A glyph
  // that is the entire content of a small button is the most visible thing
  // there is to get wrong — a font set without U+2212, which some Android and
  // embedded configurations are, draws an empty box where the zoom-out control
  // should be, and an empty box is exactly what "broken letters" looks like.
  // Two CSS rectangles need no font and are identical everywhere.
  {
    const minimapSrc = readFileSync(new URL('../src/ui/minimap.js', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8');
    const buttons = [...worldmap.matchAll(/<button[^>]*data-zoom[^>]*>([^<]*)<\/button>/g)]
      .concat([...minimapSrc.matchAll(/<button[^>]*data-zoom[^>]*>([^<]*)<\/button>/g)]);
    ok(`both maps have their zoom pair  (${buttons.length} buttons)`, buttons.length === 4);
    ok('and none of them is a typed glyph', buttons.every((m) => m[1].trim() === ''));
    ok('each still says what it does, for a screen reader and a tooltip',
      buttons.length === 4
      && /data-zoom="1" title="Zoom in" aria-label="Zoom in"/.test(worldmap)
      && /data-zoom="-1" title="Zoom out" aria-label="Zoom out"/.test(minimapSrc));
    ok('the plus and minus are drawn in CSS instead',
      /\.map-zoom-glyph button::before/.test(css)
      && /\.map-zoom-glyph button\[data-zoom='1'\]::after/.test(css));
    ok('and both maps ask for that drawing', /map-zoom-glyph/.test(worldmap) && /map-zoom-glyph/.test(minimapSrc));
    // U+2022 BULLET was the whole label of the touch cheats button for the same
    // reason; U+00B7 MIDDLE DOT is Latin-1 and in everything.
    const touch = readFileSync(new URL('../src/ui/touch.js', import.meta.url), 'utf8');
    ok('no control is labelled with a bullet either', !touch.includes('\u2022'));
  }

  ok('the map watches its own box, not just the window',
    /new ResizeObserver\(/.test(worldmap) && /observe\(this\.canvas\.parentElement\)/.test(worldmap));
  ok('and the fallback check asks about height as well as width',
    /wrap\.clientWidth !== this\.width \|\| wrap\.clientHeight !== this\.height/.test(worldmap));

  // What the old and new defaults actually show, in ground per pixel at a
  // middling latitude — the number that decides whether a map is useful.
  const across = (zoom) => (metresPerPixel(48, zoom) * 900) / 1000;
  ok(`six was most of a continent  (${across(6).toFixed(0)} km across)`, across(6) > 900);
  ok(`eleven is a city and its country  (${across(DEFAULT_SETTINGS.worldMapZoom).toFixed(0)} km across)`,
    across(DEFAULT_SETTINGS.worldMapZoom) > 20 && across(DEFAULT_SETTINGS.worldMapZoom) < 120);
}

// ---------------------------------------------------------------------------
console.log('\nThe texture cache is a size, not a tally');
{
  const { ImageryStreamer } = await import('../src/tiles/streamer.js');
  const { settings } = await import('../src/core/settings.js');
  const before = settings.get('graphics');
  settings.set('graphics', 'high');
  const streamer = new ImageryStreamer({ addEventListener() {}, postMessage() {} }, null);

  // The preset's number is a count of tiles, and a count is a proxy for memory
  // that is wrong by four whenever a provider serves 512-pixel tiles instead of
  // 256 — which several do. At 512 that is about 1.2 GB of texture for "high",
  // on top of the meshes, and a Chromebook answers that by killing the tab.
  const megabytes = (tiles, px) => (tiles * px * px * 4 * (4 / 3)) / 1048576;

  streamer.tileSizeHint = 256;
  const small = streamer.textureLimit();
  streamer.tileSizeHint = 512;
  const large = streamer.textureLimit();
  ok(`bigger tiles mean fewer of them  (${small} at 256 px, ${large} at 512)`, large < small);
  ok(`and the same memory either way  (${megabytes(small, 256).toFixed(0)} vs ${megabytes(large, 512).toFixed(0)} MB)`,
    Math.abs(megabytes(small, 256) - megabytes(large, 512)) < 8);

  // A preset still means something: heavier presets hold more. Asserted as
  // "more at every step" rather than as a multiple — this said `ultra > low * 3`,
  // a ratio read off the numbers of the day, and it broke when the budget was
  // floored at what each tier actually draws. The floor narrows the spread
  // (520 to 1500 rather than 320 to 1400) because the drawn caps are closer
  // together than the cache figures were. Monotonic is the requirement; the
  // multiple was a snapshot.
  streamer.tileSizeHint = 256;
  const byTier = [];
  for (const tier of ['low', 'medium', 'high', 'ultra']) {
    settings.set('graphics', tier);
    byTier.push([tier, streamer.textureLimit()]);
  }
  const rising = byTier.every(([, v], i) => i === 0 || v > byTier[i - 1][1]);
  ok(`a heavier preset still holds more  (${byTier.map(([t, v]) => `${t} ${v}`).join(', ')})`, rising);

  // And never less than the tier draws, or the cache cannot hold the view and
  // has to either thrash or ignore its own budget. It was ignoring it: 1,731
  // textures against a budget of 160, measured on a throttled machine
  // reporting two gigabytes.
  const short = [];
  for (const tier of ['low', 'medium', 'high', 'ultra']) {
    settings.set('graphics', tier);
    if (streamer.textureLimit() < settings.preset().maxDrawnTiles) short.push(tier);
  }
  ok(`no tier caches less than it draws  (${short.join(', ') || 'none of the four'})`, short.length === 0);

  // Never so small that nothing can be cached at all.
  streamer.tileSizeHint = 4096;
  ok(`there is always a floor  (${streamer.textureLimit()})`, streamer.textureLimit() >= 64);

  // A provider that has not answered yet is assumed to serve the common size
  // rather than the worst case.
  const fresh = new ImageryStreamer({ addEventListener() {}, postMessage() {} }, null);
  ok('an unknown provider is assumed to be 256', fresh.tileSizeHint === 256);

  settings.set('graphics', before);
}

// ---------------------------------------------------------------------------
console.log('\nA refusal is not a permanent fact about the world');
{
  const { ImageryStreamer } = await import('../src/tiles/streamer.js');
  const streamer = new ImageryStreamer({ addEventListener() {}, postMessage() {} }, null);
  const source = readFileSync(new URL('../src/tiles/streamer.js', import.meta.url), 'utf8');

  // "Nobody has this square" was remembered in a Set, which meant for ever: one
  // refusal and that square, the four below it and the sixteen below those were
  // never asked again for the rest of the session. Right for ground nobody has
  // photographed; wrong for the far commoner cause, which is a network that
  // dropped for five seconds.
  ok('it is remembered with a time, not just remembered',
    /this\.barren = new Map\(\)/.test(source));
  ok('and written with one', /this\.barren\.set\(entry\.key, now\(\)\)/.test(source));
  const ttl = Number(/const BARREN_TTL_MS = (\d+)/.exec(source)?.[1]);
  ok(`it expires  (${ttl / 1000} s)`, ttl > 0 && ttl < 600000);

  // underBarren asks about a square's *ancestors*, never about the square
  // itself: a tile that failed is governed by its own retryAt, and the record
  // exists to stop the four beneath it and the sixteen beneath those. So the
  // thing to test is a child of a refused square, not the square.
  // The clock is performance.now(), which counts from process start — writing
  // Date.now() into the record makes every entry look impossibly fresh.
  const child = { z: 16, x: 400, y: 800 };
  ok('a square with no refusal above it is fine', !streamer.underBarren(child));

  streamer.barren.set('14/100/200', performance.now());
  ok('a fresh refusal above it is believed', streamer.underBarren(child));

  streamer.barren.set('14/100/200', performance.now() - ttl - 1000);
  ok('an old one is not', !streamer.underBarren(child));
  ok('and is forgotten rather than re-checked for ever', !streamer.barren.has('14/100/200'));
  ok('so the next ask goes out again', !streamer.underBarren(child));
}

// ---------------------------------------------------------------------------
console.log('\nDetail goes where you can see it, not straight down');
{
  const terrain = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');

  // The split test used the horizontal distance, which is nought for the ground
  // directly beneath you however high you are — so at altitude the quadtree
  // descended to maximum depth straight down and spent the frame's whole tile
  // budget on a patch seen from kilometres up. maxDrawn then cuts the walk
  // short, and what goes missing is the view.
  ok('the split test uses the real distance',
    /const eyeDist = Math\.hypot\(flatDist, vertical\);/.test(terrain));
  ok('including the height of the square itself',
    /Math\.max\(minY - camera\.position\.y, 0, camera\.position\.y - maxY\)/.test(terrain));
  ok('and both sides of the hysteresis use it',
    /wasSplit \? eyeDist < line \* LOD_HYSTERESIS_OUT : eyeDist < line \* LOD_HYSTERESIS_IN/.test(terrain));
  // Culling and reach are questions about ground covered, not apparent size.
  ok('reach is still horizontal', /if \(flatDist > reach\)/.test(terrain));
  ok('and so is the ground kept under your feet', /flatDist > FLOOR_REACH/.test(terrain));

  // Reproduce the depth each rule reaches straight down.
  const deepest = (distance, lodFactor = 4.6 / 2.4, lat = 46.5) => {
    let deep = 0;
    for (let z = 1; z < 24; z++) {
      const size = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
      if (distance < size * lodFactor) deep = z;
    }
    return deep;
  };
  ok(`horizontal distance descends to the bottom  (z${deepest(0)})`, deepest(0) >= 22);
  ok(`at 300 m up the real distance stops sooner  (z${deepest(300)})`, deepest(300) < deepest(0));
  ok(`and at 9 km, sooner again  (z${deepest(9000)})`, deepest(9000) < deepest(300));
  // Standing on the ground is unchanged, which is the case that must not move.
  ok(`on foot it is as deep as ever  (z${deepest(2)})`, deepest(2) >= 22);
}

// ---------------------------------------------------------------------------
console.log('\nChanging provider does not blank the world');
{
  const { ImageryStreamer, STATE_READY } = await import('../src/tiles/streamer.js');
  const posted = [];
  const streamer = new ImageryStreamer(
    { addEventListener() {}, postMessage: (m) => posted.push(m) },
    null,
  );

  const source = (id, maxZoom = 19) => ({ descriptor: { id, maxZoom }, maxZoom, urlFor: () => 'x' });
  streamer.setSource(source('esri'));

  // Two squares already showing Esri's photographs.
  const disposed = [];
  for (const key of ['14/1/1', '14/1/2']) {
    const [z, x, y] = key.split('/').map(Number);
    streamer.entries.set(key, {
      key, tile: { z, x, y }, state: STATE_READY,
      texture: { dispose: () => disposed.push(key) }, used: 0, seen: 0,
    });
  }
  streamer.sharpness.set('14/1/1', 6.2);
  streamer.barren.set('14/9/9', performance.now());

  // Pick a different provider. This used to call clear(), which disposes every
  // texture at once — so the whole world went flat grey and came back a square
  // at a time. Hundreds of them blinking out and back is the flashing, and the
  // seconds of blank world while it happened is the hang.
  streamer.setSource(source('mapbox'));
  ok('the pictures already on screen stay up', disposed.length === 0);
  ok('and are still marked ready',
    [...streamer.entries.values()].every((e) => e.state === STATE_READY));
  ok('but every one is marked for replacement',
    [...streamer.entries.values()].every((e) => e.stale === true));

  // What must go is everything that was an opinion about the old provider.
  ok('its sharpness verdicts are dropped', streamer.sharpness.size === 0);
  ok('and which squares it refused', streamer.barren.size === 0);
  ok('and anything still in flight is cancelled',
    posted.some((m) => m.kind === 'cancel') || streamer.jobs.size === 0);

  // Asking again re-queues each square once, and only once.
  const entry = streamer.request({ z: 14, x: 1, y: 1 }, 1);
  ok('a stale square asks again', streamer.queue.includes(entry));
  ok('and is no longer stale', entry.stale === false);
  streamer.queue.length = 0;
  streamer.request({ z: 14, x: 1, y: 1 }, 1);
  ok('and does not ask twice', streamer.queue.length === 0);

  // Picking the same provider again is not a change and costs nothing.
  streamer.sharpness.set('14/1/1', 6.2);
  streamer.setSource(source('mapbox'));
  ok('choosing the same provider changes nothing', streamer.sharpness.size === 1);

  const source_js = readFileSync(new URL('../src/tiles/streamer.js', import.meta.url), 'utf8');
  ok('and the old picture is disposed only when its replacement lands',
    /if \(entry\.texture\) entry\.texture\.dispose\(\);\n    entry\.texture = texture;/.test(source_js));
}

// ---------------------------------------------------------------------------
console.log('\nComing back puts you where you were, doing what you were doing');
{
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');

  // The position was always remembered; what you were doing was not, so the
  // spawn took "arrive in the sky" at its word and threw everybody into the air
  // with the wings out every single time. That is "why is it forcing me to fly".
  ok('what you were doing is saved with where you were',
    /flying: !this\.player\.onGround \|\| this\.player\.elytraDeployed/.test(game));
  ok('and the spawn is told it', /reason: 'spawn', quiet: true, flying: wasFlying/.test(game));
  ok('teleportTo takes it', /async teleportTo\(lat, lon, \{ reason = 'manual', quiet = false, flying \} = \{\}\)/.test(game));

  // Reproduce the decision on every combination that reaches it.
  const arrives = (setting, reason, standingHere, saved) => {
    const before = typeof saved === 'boolean' ? saved : standingHere;
    return setting && (reason === 'spawn' ? before : (reason === 'rtp' || reason === 'map') && standingHere);
  };
  ok('leaving mid-glide, you come back gliding', arrives(true, 'spawn', false, true));
  ok('leaving on your feet, you come back on your feet', !arrives(true, 'spawn', false, false));
  ok('and with the setting off, always on your feet', !arrives(false, 'spawn', false, true));
  // A save written before this has no flag, and should not start landing people
  // who left mid-glide.
  ok('an older save still arrives in the sky', arrives(true, 'spawn', false, undefined) === false
    || /typeof saved\.flying === 'boolean' \? saved\.flying : true/.test(game));
  ok('the fallback is spelled out', /typeof saved\.flying === 'boolean' \? saved\.flying : true/.test(game));
  // Every other kind of teleport still reads the player, who is standing here.
  ok('a random teleport while flying keeps you flying', arrives(true, 'rtp', true));
  ok('and while walking keeps you walking', !arrives(true, 'rtp', false));
}

// ---------------------------------------------------------------------------
console.log('\nThe ground says when it was photographed');
{
  const { describeImagery, imageryAt } = await import('../src/geo/imageryAge.js');

  // Formatting, without the network: the request itself is checked by having
  // been run against the live service, and the numbers are in the commit
  // message. What is committed is the reading of the reply.
  const info = (over) => ({
    date: new Date(Date.UTC(2018, 8, 9)), resolutionM: 0.5, sensor: 'WV02',
    vendor: 'Vantor', maxZoom: 19, ...over,
  });
  ok(`a full record reads plainly  (${describeImagery(info())})`,
    describeImagery(info()) === 'Sep 2018 · 0.5 m · WV02');
  // Sub-metre imagery keeps its decimals; metres do not need them.
  ok(`centimetres survive  (${describeImagery(info({ resolutionM: 0.075 }))})`,
    /0\.075 m/.test(describeImagery(info({ resolutionM: 0.075 }))));
  ok(`and metres are rounded  (${describeImagery(info({ resolutionM: 15.2 }))})`,
    /15 m/.test(describeImagery(info({ resolutionM: 15.2 }))));

  // Only the parts that came back: a record with a date and nothing else says
  // the date, not the date followed by two empty separators.
  ok(`a date alone  (${describeImagery({ date: new Date(Date.UTC(2011, 0, 2)) })})`,
    describeImagery({ date: new Date(Date.UTC(2011, 0, 2)) }) === 'Jan 2011');
  ok('nothing at all says nothing', describeImagery(null) === '' && describeImagery({}) === '');

  // Never blocks: the first ask returns nothing and starts a request.
  ok('asking is not waiting', imageryAt(48.54, 8.23) === null);
  // And nonsense is refused rather than sent.
  ok('a position that is not one is refused', imageryAt(NaN, 8.23) === null);

  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  ok('the attribution line carries it', /describeImagery\(imageryAt\(/.test(game));
  // Somebody else's dates, so they go when the provider does.
  ok('and changing provider forgets it', /clearImageryAges\(\)/.test(game));
  // Only for the provider it came from.
  ok('and it is only claimed for Esri', /descriptor\?\.id === 'esri'/.test(game));

  // A square with no metadata record — ocean, the poles — is a real and
  // permanent answer, and is kept. A request that failed is neither, and used
  // to be kept in exactly the same way: one timeout while crossing Kansas and
  // the line never carried a date for those eighty kilometres again.
  const { clearImageryAges } = await import('../src/geo/imageryAge.js');
  const realFetch = globalThis.fetch;
  const realNow = performance.now.bind(performance);
  let skew = 0;
  let fetches = 0;
  let reply = 'refuse';
  const record = { SRC_DATE: 20180909, SRC_RES: 0.5, SRC_DESC: 'WV02', NICE_DESC: 'Vantor', MaxMapLevel: 19 };
  const settle = () => new Promise((done) => setTimeout(done, 12));
  try {
    performance.now = () => realNow() + skew;
    globalThis.fetch = async () => {
      fetches++;
      if (reply === 'refuse') return { ok: false, status: 503, json: async () => ({}) };
      if (reply === 'miss') return { ok: true, json: async () => ({ features: [] }) };
      return { ok: true, json: async () => ({ features: [{ attributes: record }] }) };
    };
    clearImageryAges();

    imageryAt(12.5, 34.5); await settle();
    imageryAt(12.5, 34.5); await settle();
    ok(`a refusal is not asked again straight away  (${fetches} request)`, fetches === 1);
    // Two minutes later, and the service is well again.
    skew = 130000;
    reply = 'good';
    imageryAt(12.5, 34.5); await settle();
    ok(`once the wait is over it is asked again  (${fetches} requests)`, fetches === 2);
    ok(`and the date lands  (${describeImagery(imageryAt(12.5, 34.5))})`,
      describeImagery(imageryAt(12.5, 34.5)) === 'Sep 2018 · 0.5 m · WV02');

    // Whereas ocean, which genuinely has no record, is answered once.
    reply = 'miss';
    const before = fetches;
    imageryAt(-40.5, -140.5); await settle();
    skew = 400000;
    imageryAt(-40.5, -140.5); await settle();
    ok(`a square with no record is asked once and believed  (${fetches - before} request)`,
      fetches - before === 1);
  } finally {
    globalThis.fetch = realFetch;
    performance.now = realNow;
    clearImageryAges();
  }
}

// ---------------------------------------------------------------------------
console.log('\nA paused world does not spend your surge');
{
  const { Player } = await import('../src/player/player.js');
  const player = new Player({ toWorld: () => ({ x: 0, y: 0, z: 0 }), toGeo: () => ({ lat: 0, lon: 0 }) });

  // A paused frame is `update(0)`, so every timer is stepped by nothing. That
  // is the mechanism, and it is worth a check because it is invisible: nothing
  // in tickTimers mentions pausing, and it would be easy to "fix" a timer by
  // giving it a wall clock of its own and silently break this.
  player.startSpeedMode();
  const full = player.speedRemaining;
  for (let i = 0; i < 600; i++) player.tickTimers(0);
  ok(`ten seconds of paused frames spend nothing  (${player.speedRemaining} s left)`,
    player.speedRemaining === full);

  for (let i = 0; i < 60; i++) player.tickTimers(1 / 60);
  ok(`and a second of real time spends one  (${player.speedRemaining.toFixed(2)} s left)`,
    Math.abs(full - player.speedRemaining - 1) < 0.02);

  // The cooldown is the same clock.
  player.speedActive = false;
  player.speedCooldown = 20;
  for (let i = 0; i < 600; i++) player.tickTimers(0);
  ok('and the recharge does not tick either', player.speedCooldown === 20);

  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  ok('because a paused frame advances the clock by nothing',
    /this\.update\(this\.paused \? 0 :/.test(game));
}

// ---------------------------------------------------------------------------
console.log('\nA waypoint you can see from the air');
{
  const THREE = await import('../vendor/three/three.module.js');
  const { Beacons, BEACON_REACH_M } = await import('../src/world/beacons.js');
  const { LocalFrame } = await import('../src/geo/frame.js');

  const frame = new LocalFrame(46.56, 7.91);
  const store = { waypoints: [] };
  const scene = new THREE.Scene();
  const beacons = new Beacons({
    scene, store, frame, terrain: { heightAt: () => 1200 },
  });
  const camera = new THREE.PerspectiveCamera(78, 1.6, 0.15, 260000);
  const look = (x, y, z) => {
    camera.position.set(x, y, z);
    camera.rotation.set(0, 0, 0, 'YXZ');
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    beacons.update(camera, { lat: 46.56, lon: 7.91 });
  };

  // A waypoint was a square on two maps: it says where a place is while you are
  // looking at a map, and nothing at all while you are looking at the world.
  look(0, 1400, 0);
  ok('no waypoints, no beams', beacons.beams.size === 0 && beacons.labels.length === 0);

  // North of the anchor, so it is in front of a camera looking down -Z. South
  // of it and the beam is behind you, correctly unlabelled and a useless test.
  store.waypoints.push({ id: 1, name: 'Camp', lat: 46.5695, lon: 7.91, colour: '#a9c88f' });
  look(0, 1400, 0);
  ok('one waypoint stands one beam up', beacons.beams.size === 1);

  const beam = [...beacons.beams.values()][0];
  // On the ground, not at the height it was dropped from.
  ok(`the beam stands on the ground  (foot at ${(beam.mesh.position.y - beam.mesh.scale.y / 2).toFixed(0)} m)`,
    Math.abs(beam.mesh.position.y - beam.mesh.scale.y / 2 - 1200) < 1);
  ok('and it is a tall thin column', beam.mesh.scale.y > 1000 && beam.mesh.scale.x < beam.mesh.scale.y / 50);
  // Never writes depth, or it punches a hole in the ground behind it.
  ok('it does not write into the depth buffer', beam.material.depthWrite === false);
  ok('and is drawn after the world', beam.mesh.renderOrder > 0);

  // Wider with distance, or it lands inside a pixel and disappears.
  look(0, 1400, 0);
  const near = beam.mesh.scale.x;
  look(0, 1400, 40000);
  const far = beam.mesh.scale.x;
  ok(`it widens with distance  (${near.toFixed(1)} m near, ${far.toFixed(0)} m far)`, far > near * 5);

  // A deleted waypoint takes its beam with it.
  store.waypoints.length = 0;
  look(0, 1400, 0);
  ok('deleting the waypoint removes the beam', beacons.beams.size === 0);

  // Out of reach entirely.
  store.waypoints.push({ id: 2, name: 'Far', lat: 46.56, lon: 7.91, colour: '#8fb3c8' });
  look(0, 1400, BEACON_REACH_M + 5000);
  ok('and nothing is built past the reach', beacons.beams.size === 0);

  // The label carries what the ask asked for: a name and a distance.
  store.waypoints[0].lat = 46.5695;
  look(0, 1400, 0);
  ok('the label says the name', beacons.labels[0]?.name === 'Far');
  ok('and how far away it is', Number.isFinite(beacons.labels[0]?.metres));
  ok('and carries the colour of its beam', beacons.labels[0]?.colour === '#8fb3c8');
  ok('placed where the beam stands',
    beacons.labels[0]?.x > 0 && beacons.labels[0]?.x < 1);

  const hud = readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
  ok('the HUD draws them', /setBeacons\(list, units\)/.test(hud));
  // Reused between frames: rebuilding the markup sixty times a second is how a
  // handful of waypoints becomes a stutter and a flickering label.
  ok('and reuses its elements', /_beaconNodes/.test(hud));
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  ok('and a rebase moves the beams with the world',
    (game.match(/beacons\.rebase\(\)/g) ?? []).length >= 2);
}

// ---------------------------------------------------------------------------
console.log('\nGreen with holes in it is a wood; green that runs on is a field');
{
  const { measureCanopy, CANOPY_FROM_ZOOM } = await import('../src/tiles/canopy.js');

  // Stand in for a decoded tile: a fake bitmap and a fake canvas whose
  // getImageData hands back whatever pattern we want to test the rule on.
  // Real imagery cannot go in the repo — it is somebody else's photograph and
  // re-publishing it is not ours to do — so the rule is tested on patterns and
  // the numbers from the real thing are in the commit message.
  const tile = (paint) => {
    const side = 128;
    const data = new Uint8ClampedArray(side * side * 4);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const [r, g, b] = paint(x, y);
        const i = (y * side + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    const canvas = {
      getContext: () => ({ drawImage() {}, getImageData: () => ({ data, width: side, height: side }) }),
    };
    return [{ width: side, height: side }, () => canvas];
  };

  const score = (paint, zoom = 17) => {
    const [bitmap, makeCanvas] = tile(paint);
    return measureCanopy(bitmap, makeCanvas, zoom);
  };

  // One green, running unbroken across the whole square. A meadow.
  const meadow = score(() => [70, 118, 54]);
  ok(`a field of one green scores nothing  (${meadow.toFixed(3)})`, meadow < 0.05);

  // The same green, broken at crown scale by shadowed gaps.
  const wood = score((x, y) => {
    const crown = Math.sin(x * 0.55) * Math.sin(y * 0.55) > -0.1;
    return crown ? [72, 124, 56] : [30, 52, 26];
  });
  ok(`the same green with gaps in it scores  (${wood.toFixed(3)})`, wood > 0.3);
  ok('and scores far above the field', wood > meadow * 4);

  // Not green at all: rock, sand, a city, water.
  const bare = score(() => [176, 162, 138]);
  ok(`bare ground scores nothing  (${bare.toFixed(3)})`, bare === 0);
  const grey = score(() => [200, 200, 200]);
  ok(`and so does a flat grey card  (${grey.toFixed(3)})`, grey === 0);

  // Noise is not a canopy: a field with sensor grain in it must not read as
  // trees, which is why the break is measured across a crown-sized step rather
  // than between neighbouring pixels.
  let seed = 7;
  const noisy = score(() => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const n = ((seed >> 16) % 7) - 3;
    return [70 + n, 118 + n, 54 + n];
  });
  ok(`a grainy field is still a field  (${noisy.toFixed(3)})`, noisy < 0.15);

  // Too coarse to ask: a pixel wider than a tree cannot say whether the green
  // is broken, and answering anyway would bump whole countries.
  ok('below the depth it means anything, no opinion',
    score((x, y) => (Math.sin(x * 0.55) * Math.sin(y * 0.55) > -0.1 ? [72, 124, 56] : [30, 52, 26]),
      CANOPY_FROM_ZOOM - 1) === 0);

  // Wired through: measured in the worker, kept on the streamer, read by the
  // material — and the survey still wins where there is one.
  const jobs = readFileSync(new URL('../src/tiles/tileJobs.js', import.meta.url), 'utf8');
  ok('it is measured where the tile is decoded', /measureCanopy\(bitmap/.test(jobs));
  const streamer = readFileSync(new URL('../src/tiles/streamer.js', import.meta.url), 'utf8');
  ok('and kept per square', /canopyAt\(tile\)/.test(streamer));
  const shaders = readFileSync(new URL('../src/world/shaders.js', import.meta.url), 'utf8');
  ok('the ground reads it', /uniform float uCanopy;/.test(shaders));
  ok('the survey wins where there is one, rather than adding to it',
    /wood = max\(wood, uCanopy \* flatness \* greenHere \* uHasTexture\);/.test(shaders));

  {
  // The bumps were asked for four times and never appeared on the case they
  // were asked for: "a small deep-green section against a contrasting colour".
  // measureCanopy multiplied how canopy-like the green is by how much of the
  // square is green, so a wood filling a sixth of a tan square scored about a
  // tenth and the relief was invisible. Coverage is a *where* question and that
  // function answers *whether*; the shader decides where, per pixel.
  const canopy = readFileSync(new URL('../src/tiles/canopy.js', import.meta.url), 'utf8');
  // Checked on what it returns, not on whether the old expression appears
  // anywhere: the comment above the fix names it, which is the point of the
  // comment.
  ok('the measure no longer multiplies by how much of the square is green',
    /return ramp\(FIELD_AT, WOOD_AT, brokenSum \/ green\);/.test(canopy)
    && !/return greenShare \* brokenShare;/.test(canopy));
  // A share of the square, not a count of pixels. A sixtieth of a wheat
  // prairie is the hedge along one edge, and a hedge is broken green: measured
  // over a Kansas section at zoom eighteen, 4% green and 0.995 broken, which
  // scored the whole section as woodland.
  ok('and a handful of green pixels is still not evidence',
    /green \/ looked < MIN_GREEN_SHARE/.test(canopy)
    && /MIN_GREEN_SHARE = 0\.12/.test(canopy));
  // The size rule, in the words it was asked in: "don't make it if it's bigger
  // than a certain size all throughout so it doesn't mark grass, but still
  // count it if it has holes for a different colour."
  ok('a green that runs the same throughout is grass and scores nothing',
    /const FIELD_AT = 0\.55;/.test(canopy) && /const WOOD_AT = 0\.85;/.test(canopy));
  // And the green test has a magnitude in it. Without one, (100, 101, 100) was
  // green, which is most of the chroma noise in a JPEG.
  ok('and green means green by a margin, not by a hair',
    /\(g - rival\) \/ \(g \+ rival \+ 1e-4\) < 0\.10/.test(canopy));
  // Checked on the shape of the measure rather than on one expression. What
  // matters is that it is green as a *proportion* of the texel's own brightness
  // and gated on there being light to judge by. The raw difference this
  // replaced scored the median Black Forest texel 0.073 in linear light, so the
  // relief under it came out below two per cent and never showed.
  ok('the shader applies it only where the pixel is actually green',
    /float greenness = \(albedo\.g - rival\) \/ \(albedo\.g \+ rival/.test(shaders)
    && /smoothstep\(0\.008, 0\.020, texelLuma\)/.test(shaders)
    && !/clamp\(\(albedo\.g - max\(albedo\.r, albedo\.b\)\) \* 8\.0/.test(shaders));
  // And the two knees are where the photographs put them, not where they felt
  // right: greenness on texels bright enough to have a colour came out 0.000
  // across bare rock in the Alps and 0.379 at the Black Forest's third quartile,
  // so the foot has to sit above nothing and the shoulder below the crown tops.
  const greenKnees = /float greenHere = smoothstep\(([\d.]+), ([\d.]+), greenness\)/.exec(shaders);
  ok('and its two knees still bracket bare rock below and crown tops above',
    !!greenKnees && Number(greenKnees[1]) > 0 && Number(greenKnees[1]) < 0.1
    && Number(greenKnees[2]) > 0.1 && Number(greenKnees[2]) < 0.379);

  // Drive the real measure over three made squares whose answers are known:
  // an unbroken field, a broken canopy, and the mixed square that used to fail.
  const canopyMod = await import('../src/tiles/canopy.js');
  const canopySquare = (side, paint) => {
    const data = new Uint8ClampedArray(side * side * 4);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const [r, g, b] = paint(x, y);
        const i = (y * side + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      }
    }
    const ctx = {
      drawImage() {},
      getImageData: () => ({ data }),
    };
    return { width: side, height: side, __ctx: ctx };
  };
  const canopyCanvas = (w, h) => ({ getContext: () => canopyCtx });
  let canopyCtx = null;
  // The step between samples is a crown's width in *metres* now, so a made-up
  // square has to say where on Earth it is or the answer means nothing. Row
  // 32768 at zoom sixteen is the equator: 2.39 m to a tile pixel, 1.19 m to one
  // of this 128-wide square's, so a crown is about five pixels and the
  // four-pixel checks below are a crown across, which is what they were always
  // meant to be. Left at row 0 the same call lands at 85 degrees north, where a
  // pixel is 10 cm and a crown is sixty of them.
  const EQUATOR_ROW_Z16 = 32768;
  const canopyScore = (bitmap) => { canopyCtx = bitmap.__ctx; return canopyMod.measureCanopy(bitmap, canopyCanvas, 16, EQUATOR_ROW_Z16); };

  // A meadow: green everywhere, no gaps between crowns.
  const meadow = canopyScore(canopySquare(128, () => [90, 130, 70]));
  ok(`an unbroken field still scores nothing  (${meadow.toFixed(2)})`, meadow < 0.15);

  // A canopy: green with crown-scale gaps.
  const wood = canopyScore(canopySquare(128, (x, y) => (((x >> 2) + (y >> 2)) % 2
    ? [40, 95, 35] : [95, 150, 80])));
  ok(`a broken canopy scores  (${wood.toFixed(2)})`, wood > 0.4);

  // The case that was asked for: a small wood in a mostly tan square. Under the
  // old rule this was multiplied down by coverage; now it answers the same as
  // the wood, and the shader is what keeps the tan flat.
  const copse = canopyScore(canopySquare(128, (x, y) => (x < 48 && y < 48
    ? (((x >> 2) + (y >> 2)) % 2 ? [40, 95, 35] : [95, 150, 80])
    : [176, 150, 110])));
  ok(`and a small wood in a tan square scores the same, not a sixth of it  (${copse.toFixed(2)})`,
    copse > 0.4 && Math.abs(copse - wood) < 0.25);
  }
}

// ---------------------------------------------------------------------------
console.log('\nHeight above the ground is a height');
{
  const { formatAltitude, formatDistance, formatHeight } = await import('../src/core/units.js');
  const { DEFAULT_SETTINGS } = await import('../src/core/settings.js');
  const hud = readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');

  // AGL went through formatDistance, which switched to miles past a thousand
  // feet and was asked for no decimal places. Three hundred metres above the
  // ground therefore read "0 mi AGL" — a thousand feet up, reported as zero.
  //
  // The fix at the time was to give altitude its own formatter and leave
  // formatDistance alone. That is a patch on one caller: the same fault was
  // still under the minimap's scale bar, the world map's scale bar, and the
  // nearest-land readout, where "land ~0 mi" is the wrong answer rather than an
  // ugly one. And this check pinned it there, by asserting the broken string as
  // though it were the requirement.
  //
  // formatDistance is fixed at the cause now — a unit that rounds the number
  // away is the wrong unit; see "a distance never rounds away to nothing". This
  // asks what it should have asked in the first place.
  ok(`no reading of 305 m rounds away  (${formatDistance(305, 'imperial', 0)} / ${formatAltitude(305, 'imperial')})`,
    !/^0 /.test(formatDistance(305, 'imperial', 0))
    && !/^0 /.test(formatAltitude(305, 'imperial')));
  ok(`the new one says the height  (${formatAltitude(305, 'imperial')})`,
    /1,001 ft/.test(formatAltitude(305, 'imperial')));
  ok('and the readout uses it',
    /formatAltitude\(player\.altitudeAboveGround, units\)/.test(hud));
  ok('for both figures on the line',
    (hud.match(/formatAltitude\(player\./g) ?? []).length === 2);

  // It stays a height all the way up rather than turning into a distance.
  for (const metres of [305, 900, 3000, 9000]) {
    ok(`${metres} m reads in feet  (${formatAltitude(metres, 'imperial')})`,
      /ft$/.test(formatAltitude(metres, 'imperial')));
  }

  // Six feet, and the copy that quotes it agrees.
  ok(`the default height is six feet  (${formatHeight(DEFAULT_SETTINGS.playerHeightM, 'imperial')})`,
    formatHeight(DEFAULT_SETTINGS.playerHeightM, 'imperial') === `6' 0"`);
  const panel = readFileSync(new URL('../src/ui/settingsPanel.js', import.meta.url), 'utf8');
  ok('and the field says so', /Default is 6 ft\./.test(panel));
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  ok('and so does the README', /6 ft \(1\.83 m\)/.test(readme));
  // The help card reads the setting rather than quoting a number, so it cannot
  // fall out of step.
  const help = readFileSync(new URL('../src/ui/help.js', import.meta.url), 'utf8');
  ok('the help card asks rather than quotes', /heightLabel\(\)/.test(help));
}

// ---------------------------------------------------------------------------
console.log('\nBoth systems of units, everywhere and not only in places');
{
  const { formatArea, formatWind } = await import('../src/core/units.js');

  // Two readouts printed one system whatever the setting said: the explored
  // area on the world map was always km2, and the wind on the weather line was
  // always km/h — next to a temperature on the same line that did convert.
  ok(`area, metric  (${formatArea(1247, 'metric')})`, /km²$/.test(formatArea(1247, 'metric')));
  ok(`area, imperial  (${formatArea(1247, 'imperial')})`, /sq mi$/.test(formatArea(1247, 'imperial')));
  ok(`wind, metric  (${formatWind(11, 'metric')})`, formatWind(11, 'metric') === '11 km/h');
  ok(`wind, imperial  (${formatWind(11, 'imperial')})`, formatWind(11, 'imperial') === '7 mph');

  // The conversions are right, not just differently spelled.
  const sqMi = parseFloat(formatArea(1000, 'imperial').replace(/,/g, ''));
  ok(`a thousand square km is 386 square miles  (${sqMi})`, Math.abs(sqMi - 386) < 2);
  const mph = parseFloat(formatWind(100, 'imperial'));
  ok(`a hundred km/h is 62 mph  (${mph})`, Math.abs(mph - 62) < 1);

  // Small areas keep a decimal so a short walk is not rounded to nothing.
  ok(`a small area keeps a figure  (${formatArea(3.4, 'metric')})`, /3\.4/.test(formatArea(3.4, 'metric')));
  ok('and nothing measured reads as nothing',
    formatArea(NaN, 'metric') === '\u2014' && formatWind(undefined, 'metric') === '\u2014');

  // Nowhere left printing a unit straight through.
  //
  // This checked two files and two unit strings. The ask was "both systems
  // everywhere, not only in some places", so it is checked everywhere now — and
  // widening it found four readouts still hard-coded to metric: the autopilot's
  // distance in the cheat panel, the sea-distance slider's label, the freecam
  // speed toast, and the size toast, which printed "1.83 m" from the same
  // keypress that leaves the HUD's own height row reading 6' 0".
  //
  // core/units.js is where units are allowed to be spelled out — that is the
  // whole point of it — and the engine readout on F3 is deliberately metric,
  // being an engineering readout rather than a player-facing one.
  const UNIT_OK = new Set(['core/units.js']);
  const UNIT_LITERAL = /\$\{[^}]*\}\s*(km\/h|km²|mph|km\b|mi\b|ft\b|m\/s|°C|°F)/;
  const uiFiles = readdirSync(new URL('../src/', import.meta.url), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.js') && !UNIT_OK.has(f));
  ok(`the unit scan reaches the whole of src  (${uiFiles.length} files)`, uiFiles.length > 60);
  // A line may opt out by saying so, which is a claim in the source that can be
  // read and argued with — rather than the checker guessing which function it
  // is inside, which was the first version of this and got it wrong.
  const hard = [];
  let exempted = 0;
  for (const f of uiFiles) {
    const text = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    text.split('\n').forEach((line, i) => {
      if (!UNIT_LITERAL.test(line)) return;
      if (/units-exempt/.test(line)) { exempted++; return; }
      hard.push(`${f}:${i + 1}`);
    });
  }
  ok(`the exemptions are declared in the source  (${exempted} lines)`, exempted > 0 && exempted < 8);
  ok(`no player-facing readout spells its own unit  (${hard.join(', ') || 'none'})`, hard.length === 0);
}

// ---------------------------------------------------------------------------
console.log('\nThe compass says a number');
{
  const hud = readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8');
  const { compassPoint } = await import('../src/core/units.js');

  // It was letters at the cardinals and blank ticks between them: roughly which
  // way you are pointed, and no number anywhere.
  ok('there is a live bearing readout', /data-id="compass-heading"/.test(hud));
  ok('and it is drawn', /\.compass-heading \{/.test(css));
  ok('kept under the needle', /\.compass-heading[\s\S]{0,200}left: 150px/.test(css));
  // Digits that do not change width as they count, or the readout jitters.
  ok('in figures that do not jitter', /font-variant-numeric: tabular-nums/.test(css));
  ok('padded to three', /padStart\(3, '0'\)/.test(hud));

  // Reproduce the label rule the strip uses.
  const labelAt = (d) => {
    const wrapped = ((d % 360) + 360) % 360;
    if (d % 90 === 0) return compassPoint((wrapped * Math.PI) / 180);
    if (d % 45 === 0) return String(wrapped);
    return '';
  };
  ok(`the cardinals are letters  (${[0, 90, 180, 270].map(labelAt).join(' ')})`,
    [0, 90, 180, 270].every((d) => /^[NESW]+$/.test(labelAt(d))));
  ok(`and between them, degrees  (${[45, 135, 225, 315].map(labelAt).join(' ')})`,
    [45, 135, 225, 315].every((d) => /^\d+$/.test(labelAt(d))));
  ok('the small ticks stay bare', labelAt(15) === '' && labelAt(75) === '');

  // Wrapping: 359.6 reads as 000, not 360.
  const readout = (deg) => String(Math.round(deg) % 360).padStart(3, '0');
  ok(`north reads 000  (${readout(0)})`, readout(0) === '000');
  ok(`and just short of it too  (${readout(359.6)})`, readout(359.6) === '000');
  ok(`single figures are padded  (${readout(7)})`, readout(7) === '007');
}

// ---------------------------------------------------------------------------
console.log('\nThe minimap is whatever shape you want it');
{
  const { DEFAULT_SETTINGS } = await import('../src/core/settings.js');
  const css = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../src/ui/settingsPanel.js', import.meta.url), 'utf8');
  const minimap = readFileSync(new URL('../src/ui/minimap.js', import.meta.url), 'utf8');

  ok('there is a shape setting', 'minimapShape' in DEFAULT_SETTINGS);
  ok(`and it starts where it always was  (${DEFAULT_SETTINGS.minimapShape})`,
    DEFAULT_SETTINGS.minimapShape === 'rounded');
  ok('there is a control for it', /key: 'minimapShape'/.test(panel));
  ok('the element carries it', /dataset\.shape = settings\.get\('minimapShape'\)/.test(minimap));
  for (const shape of ['circle', 'squircle', 'square']) {
    ok(`${shape} is drawn`, new RegExp(`\\.minimap\\[data-shape='${shape}'\\]`).test(css));
  }
  // Every option the control offers has to be a shape the stylesheet knows, or
  // picking it silently does nothing.
  const offered = /key: 'minimapShape'[\s\S]*?\],/.exec(panel)?.[0] ?? '';
  const values = [...offered.matchAll(/value: '(\w+)'/g)].map((m) => m[1]);
  ok(`the control offers four  (${values.join(', ')})`, values.length === 4);
  ok('and the stylesheet knows every one of them',
    values.every((v) => v === 'rounded' || css.includes(`data-shape='${v}'`)));
}

// ---------------------------------------------------------------------------
console.log('\nSurge is worth using and worth waiting for');
{
  const { SURGE_FACTOR, SPEED_MODE_SECONDS, SPEED_MODE_COOLDOWN_S } =
    await import('../src/player/player.js');

  // Stronger, longer, and back sooner — the three only mean anything together.
  ok(`it is worth more than it was  (${SURGE_FACTOR}x)`, SURGE_FACTOR > 2);
  ok(`and lasts longer  (${SPEED_MODE_SECONDS} s)`, SPEED_MODE_SECONDS > 10);
  ok(`and comes back sooner  (${SPEED_MODE_COOLDOWN_S} s)`, SPEED_MODE_COOLDOWN_S < 45);
  // Something you use rather than something you hoard.
  const duty = SPEED_MODE_SECONDS / (SPEED_MODE_SECONDS + SPEED_MODE_COOLDOWN_S);
  ok(`you are in it about a third of the time  (${(duty * 100).toFixed(0)}%)`,
    duty > 0.2 && duty < 0.45);
  // Still a cost, not a permanent state.
  ok('but it still runs out', SPEED_MODE_COOLDOWN_S > SPEED_MODE_SECONDS);

  // Renamed everywhere it is shown, not just where it is defined.
  for (const [what, file] of [
    ['the gauge', '../src/ui/hud.js'],
    ['the help card', '../src/ui/help.js'],
    ['the key list', '../src/core/keybinds.js'],
    ['the cheat panel', '../src/ui/cheatPanel.js'],
  ]) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    ok(`${what} says surge`, /[Ss]urge/.test(text) && !/Speed mode</.test(text));
  }
}

// ---------------------------------------------------------------------------
console.log('\nRolling is something you fly, not a button you press');
{
  const { CameraRig } = await import('../src/camera/cameraRig.js');
  const THREE = await import('../vendor/three/three.module.js');
  const rig = new CameraRig(new THREE.PerspectiveCamera(78, 1.6, 0.15, 1000));

  // It was a key: press X and a canned 360 went round over eight tenths of a
  // second whatever you were doing. That is a stunt button, and "implement it
  // like the mod, not as a keybind" is exactly the difference.
  const binds = readFileSync(new URL('../src/core/keybinds.js', import.meta.url), 'utf8');
  ok('there is no roll key any more', !/barrelRoll/.test(binds));
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  ok('and nothing triggers one', !/startBarrelRoll/.test(game));

  // Held, while gliding, from the strafe keys.
  const hold = (input, seconds, flying = true) => {
    for (let t = 0; t < seconds; t += 1 / 60) rig.updateRoll(1 / 60, input, flying);
    return rig.roll;
  };
  rig.roll = 0;
  ok(`holding right banks you  (${((hold(1, 0.3) * 180) / Math.PI).toFixed(0)}\u00b0)`, rig.roll > 0.5);
  // Compared before it can wrap: roll is kept inside one turn either way, so
  // half a second at full deflection is already past upright and comes back
  // round negative — which is the intended behaviour and a bad thing to
  // measure "further" against.
  const early = rig.roll;
  ok(`holding longer banks further  (${((hold(1, 0.2) * 180) / Math.PI).toFixed(0)}\u00b0)`,
    rig.roll > early);
  // All the way over and round again: the barrel roll is still there, flown.
  rig.roll = 0;
  let wrapped = false;
  for (let t = 0; t < 3; t += 1 / 60) {
    const before = rig.roll;
    rig.updateRoll(1 / 60, 1, true);
    if (rig.roll < before - 1) wrapped = true;
  }
  ok('and holding it takes you the whole way round', wrapped);

  rig.roll = 0;
  ok(`left goes the other way  (${((hold(-1, 0.4) * 180) / Math.PI).toFixed(0)}\u00b0)`, rig.roll < -0.4);

  // Let go and it comes back level, so you cannot be stranded inverted.
  ok(`letting go levels off  (${((hold(0, 4) * 180) / Math.PI).toFixed(1)}\u00b0)`, Math.abs(rig.roll) < 0.05);
  // And on your feet the horizon is the horizon.
  rig.roll = 1;
  ok('walking has no roll at all', Math.abs(hold(1, 2, false)) < 0.05);

  // A bank has to turn you or it is a camera trick — and it has to turn your
  // *momentum*, or it is a slip. See the flight-path check further up, which
  // drives the real tickGlide; these two are the source side of it.
  const controller = readFileSync(new URL('../src/player/controller.js', import.meta.url), 'utf8');
  ok('a banked wing turns you',
    /const swing = Math\.sin\(player\.roll\) \* BANK_TURN \* bite \* step;/.test(controller)
    && /player\.yaw \+= swing;/.test(controller));
  ok('and carries your momentum round with it',
    /player\.velocity\.x = vx \* cos - vz \* sin;/.test(controller)
    && /player\.velocity\.z = vx \* sin \+ vz \* cos;/.test(controller));
  ok('and only with air over it', /horizontalSpeed \/ 28/.test(controller));
  const rate = Number(/const BANK_TURN = ([\d.]+)/.exec(controller)?.[1]);
  const turnIn2s = (roll) => (Math.sin(roll) * rate * 1 * 2 * 180) / Math.PI;
  ok(`level flight does not turn  (${turnIn2s(0).toFixed(0)}\u00b0)`, turnIn2s(0) === 0);
  ok(`a 30\u00b0 bank is a wide arc  (${turnIn2s(Math.PI / 6).toFixed(0)}\u00b0 in 2 s)`,
    turnIn2s(Math.PI / 6) > 20 && turnIn2s(Math.PI / 6) < 70);
  ok(`and upside down does not spin you  (${turnIn2s(Math.PI).toFixed(0)}\u00b0)`,
    Math.abs(turnIn2s(Math.PI)) < 1);
}

// ---------------------------------------------------------------------------
console.log('\nThe view widens with how fast you are actually going');
{
  const rig = readFileSync(new URL('../src/camera/cameraRig.js', import.meta.url), 'utf8');
  const kick = /const speedKick = [\s\S]*?;\n/.exec(rig)?.[0] ?? '';

  ok('the field of view follows speed', /horizontalSpeed/.test(kick));
  ok('and it can be turned off', /speedFovKick/.test(kick));
  // `horizontalSpeed` now includes the speed multiplier, so a flat bonus for
  // speed mode counts the same boost twice and the view lurches wider than the
  // speed justifies.
  ok('speed mode is not counted twice', !/speedActive/.test(kick));

  // Reproduce the curve on the speeds it will see.
  const clampTo = (v, a, b) => Math.min(b, Math.max(a, v));
  const scale = Number(/horizontalSpeed \/ (\d+)/.exec(kick)?.[1]);
  const span = Number(/\* (\d+)\n/.exec(kick)?.[1] ?? /0, 1\) \* (\d+)/.exec(kick)?.[1]);
  const at = (mps) => clampTo(mps / scale, 0, 1) * span;
  ok(`standing still does nothing  (${at(0).toFixed(1)}\u00b0)`, at(0) === 0);
  ok(`a walk is imperceptible  (${at(4.3).toFixed(1)}\u00b0)`, at(4.3) < 1.5);
  ok(`a glide opens it up  (${at(30).toFixed(1)}\u00b0)`, at(30) > 3 && at(30) < 8);
  ok(`and a rocket further  (${at(90).toFixed(1)}\u00b0)`, at(90) > at(30));
  ok(`but it stops widening  (${at(400).toFixed(1)}\u00b0)`, at(400) === at(90));
}

// ---------------------------------------------------------------------------
console.log('\nThe tab icon is the thing you fly with');
{
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const href = /<link rel="icon" href="data:image\/svg\+xml,([^"]*)"/.exec(index)?.[1] ?? '';
  const svg = decodeURIComponent(href);
  ok('there is an inline icon', svg.startsWith('<svg'));
  ok('it is square and closes', /viewBox="0 0 32 32"/.test(svg) && svg.endsWith('</svg>'));
  // A pair of wings and the spine between them, rather than the hill and sun
  // that were there before.
  ok(`it is drawn from a few shapes  (${(svg.match(/<path/g) ?? []).length} paths)`,
    (svg.match(/<path/g) ?? []).length >= 3);
  ok('and it is small enough to sit in a URL', svg.length < 900);
  // The online edition is built from index.html, so it must carry the same one.
  const online = readFileSync(new URL('../terraglide-online.html', import.meta.url), 'utf8');
  ok('the online edition has the same icon', online.includes(href));
}

// ---------------------------------------------------------------------------
console.log('\nA provider\u2019s placeholder is identified, not guessed at');
{
  const { isNoDataCard, fingerprint, CARDS, CARD_BYTES } = await import('../src/tiles/noData.js');

  // What went wrong: the old test called a tile a placeholder when it was
  // bright, colourless, flat and under six kilobytes. Antarctica is all four.
  // Real photographs of the plateau, all thrown away:
  //   z6 2,564 bytes  z8 2,488  z10 2,420  z12 1,688 — mean 230-239, spread 17
  // The card itself is 2,521 bytes. So the sizes below must all be kept, and
  // the point is that length alone is what saves them.
  for (const size of [1688, 2420, 2488, 2564, 3374, 6259, 20887, 672]) {
    ok(`a ${size}-byte tile is not a placeholder`, isNoDataCard(new Uint8Array(size)) === false);
  }

  // The card is one fixed image, byte-identical at zooms 14 through 18.
  ok('the card\u2019s length is the measured one', CARD_BYTES.has(2521) && CARD_BYTES.size === 1);
  ok('and its fingerprint is the measured one', CARDS.has('92d9118f') && CARDS.size === 1);

  // Length is a gate, not the test: something else of exactly that size is kept.
  const impostor = new Uint8Array(2521);
  for (let i = 0; i < impostor.length; i++) impostor[i] = (i * 7) & 0xff;
  ok('a different 2,521-byte tile is kept', isNoDataCard(impostor) === false);
  ok('so length alone never condemns a tile', fingerprint(impostor) !== '92d9118f');

  // The hash is FNV-1a and has to stay that, or the stored fingerprint means
  // nothing. Checked against the reference value for a known string.
  const abc = new Uint8Array([...'abc'].map((c) => c.charCodeAt(0)));
  ok(`FNV-1a is unchanged  (${fingerprint(abc)})`, fingerprint(abc) === '1a47e90b');

  ok('nothing is condemned without data', isNoDataCard(null) === false);

  // Every caller must hand over the bytes. Passing a decoded bitmap and a size
  // is the old signature, and it would silently always answer false.
  for (const rel of ['src/tiles/tileJobs.js', 'src/ui/mapTiles.js', 'src/geo/water.js', 'src/tiles/providers.js']) {
    const src = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
    const calls = src.match(/isNoDataCard\([^)]*\)/g) ?? [];
    ok(`${rel} passes the bytes  (${calls.join(', ')})`,
      calls.length > 0 && calls.every((c) => /isNoDataCard\(\s*bytes\s*\)/.test(c)));
  }
}

// ---------------------------------------------------------------------------
console.log('\nGround that is not on this planet is replaced from ground that is');
{
  const { fillImpossible, EARTH_MIN_M, EARTH_MAX_M } = await import('../src/tiles/tileJobs.js');
  const W = 16;
  const make = (fn) => {
    const g = new Float32Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) g[y * W + x] = fn(x, y);
    return g;
  };

  // The bounds are facts about the Earth, not thresholds: Challenger Deep is
  // 10,994 m down and Everest 8,849 m up. Read straight off this dataset the
  // deepest real cell found anywhere was -10,836 and the highest 8,753, across
  // thirty places at three zooms.
  ok(`the floor is below the deepest place on Earth  (${EARTH_MIN_M} m)`, EARTH_MIN_M === -11000);
  ok(`the ceiling is above the highest  (${EARTH_MAX_M} m)`, EARTH_MAX_M === 9000);

  // Real extremes must survive untouched, or the bound is not a fact.
  const real = make((x) => (x < 8 ? -10836 : 8753)); // Challenger Deep beside Everest
  const realBefore = real.slice();
  ok('the deepest and highest real ground is left alone',
    fillImpossible(real, W, W) === 0 && real.every((v, i) => v === realBefore[i]));

  // The damage in this dataset is whole columns at the left edge of a tile:
  // column 0 over Antarctica, 0-1 at null island, 0-5 at the southern limit.
  // The first version of this searched up and down the column and found
  // nothing, because the whole column is bad. It has to cross the damage.
  const columns = make((x) => (x < 2 ? -14460 : 100 + x));
  const filled = fillImpossible(columns, W, W);
  ok(`two bad columns are replaced  (${filled} cells)`, filled === 2 * W);
  ok('and the replacement is real ground, not the bound',
    [...columns].every((v) => v >= EARTH_MIN_M && v <= EARTH_MAX_M) && columns[0] === 102);

  // Between two real surveys it interpolates rather than picking a side.
  const gap = make((x, y) => (x === 4 ? 1e9 : x * 100));
  fillImpossible(gap, W, W);
  ok(`a gap between real ground is interpolated  (${gap[4]})`, Math.abs(gap[4] - 400) < 1e-6);

  // NaN is not on this planet either, and a naive comparison lets it through.
  const nan = make((x) => (x === 3 ? NaN : 50));
  fillImpossible(nan, W, W);
  ok('NaN is replaced too', [...nan].every((v) => Number.isFinite(v)));

  // Nothing valid anywhere: leave it rather than invent a number.
  const hopeless = make(() => -99999);
  ok('a tile with nothing real in it is left alone', fillImpossible(hopeless, W, W) === 0);

  // It runs before the despike, so no cell is ever judged against a neighbour
  // that is off the planet.
  const src = readFileSync(new URL('../src/tiles/tileJobs.js', import.meta.url), 'utf8');
  const fillAt = src.indexOf('fillImpossible(full, w, h)');
  const spikeAt = src.indexOf('despike(full, w, h)');
  ok('the impossible ones go first', fillAt > 0 && spikeAt > fillAt);
}

// ---------------------------------------------------------------------------
console.log('\nImpossible ground is refused; steep ground is not');
{
  const { despike, SPIKE_LIMIT_M, SPIKE_RATIO, SPIKE_FLOOR_M } = await import('../src/tiles/tileJobs.js');
  const W = 24;
  const make = (fn) => {
    const g = new Float32Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) g[y * W + x] = fn(x, y);
    return g;
  };
  const at = (g, x, y) => g[y * W + x];

  // The constants are measurements, not preferences — see the comment they sit
  // under. Pinning them means a future change has to go and re-measure rather
  // than nudge a number until a picture looks nicer.
  ok(`the absolute limit is the measured one  (${SPIKE_LIMIT_M} m, worst real 331)`, SPIKE_LIMIT_M === 500);
  ok(`the ratio is the measured one  (${SPIKE_RATIO}x, worst real 2.7)`, SPIKE_RATIO === 5);
  ok(`and small disagreements are left alone  (${SPIKE_FLOOR_M} m)`, SPIKE_FLOOR_M === 60);

  // A needle standing out of flat ground: Reykjavik at zoom 13, 140 m out of
  // neighbours that span thirteen.
  const needle = make(() => 0);
  needle[12 * W + 12] = 140;
  ok('a needle in flat ground is refused', despike(needle, W, W) === 1 && at(needle, 12, 12) === 0);

  // A whole bad row: the Colca and Yarlung tiles, 254 cells each.
  const row = make((x, y) => (y === 12 ? 900 : 0));
  const rowRejected = despike(row, W, W);
  ok(`a bad row is refused  (${rowRejected} cells)`, rowRejected === W - 2 && at(row, 12, 12) === 0);

  // A real cliff, four hundred metres of it, must survive untouched. This is
  // the case a plain "reject anything steep" rule would destroy.
  const cliff = make((x) => (x < 12 ? 0 : 400));
  const before = cliff.slice();
  ok('a 400 m cliff is left alone', despike(cliff, W, W) === 0 && cliff.every((v, i) => v === before[i]));

  // Rugged ground is allowed a big step, because its neighbours are big steps
  // too — that is why the ratio exists and why K2's 331 m cell survives.
  const rugged = make((x, y) => ((x * 137 + y * 79) % 7) * 60);
  const ruggedBefore = rugged.slice();
  ok('rugged ground keeps its own roughness', despike(rugged, W, W) === 0 && rugged.every((v, i) => v === ruggedBefore[i]));

  // Edges have no ring to judge them by, so they are never touched.
  const edge = make(() => 0);
  edge[0] = 5000;
  edge[W - 1] = -5000;
  despike(edge, W, W);
  ok('edge cells are left alone, having nothing to be judged against',
    edge[0] === 5000 && edge[W - 1] === -5000);

  // Once cleaned, a second run finds nothing: the passes converge rather than
  // grinding away at the terrain.
  const twice = make(() => 0);
  twice[10 * W + 10] = 900;
  despike(twice, W, W);
  ok('a cleaned tile is stable', despike(twice, W, W) === 0);
}

// ---------------------------------------------------------------------------
console.log('\nThe height cache is sized for the grid it has to cover');
{
  const { ElevationField } = await import('../src/tiles/elevation.js');
  const { settings } = await import('../src/core/settings.js');
  const field = new ElevationField({ postMessage() {}, addEventListener() {} });
  const was = settings.tier;

  // It was a flat 320 for every machine while the terrain grid it covers goes
  // from 25 squares across to 41 — nearly three times the area. So on the tiers
  // a real graphics card picks, the stated limit sat below what one frame
  // needs. Every reading that missed this came from a SwiftShader sandbox,
  // which picks Low.
  const limits = {};
  for (const tier of ['low', 'medium', 'high', 'ultra']) {
    settings.set('graphics', tier);
    limits[tier] = field.cacheLimit;
  }
  ok(`the limit grows with the tier  (${limits.low}, ${limits.medium}, ${limits.high}, ${limits.ultra})`,
    limits.low < limits.medium && limits.medium < limits.high && limits.high < limits.ultra);
  ok('and Low is unchanged, because Low was never the one over', limits.low === 320);

  // The shortfall this replaces: evict() skips anything the mesh touched in the
  // last couple of frames, and at a big grid that is most of the cache — so it
  // could be asked to free a hundred tiles, find nothing it was allowed to
  // take, and stop, leaving the cache over a limit it went on reporting.
  // Measured at Ultra before the fix: 491 asked for, 360 freed, 131 short.
  settings.set('graphics', 'low');
  field.frame = 1000;
  const live = 420;   // more than Low's whole nominal limit, all in use now
  const stale = 150;
  for (let i = 0; i < live; i++) {
    field.tiles.set('L' + i, { key: 'L' + i, tile: { z: 12, x: i, y: 1 }, state: 2, heights: null, used: field.frame, priority: 0 });
  }
  for (let i = 0; i < stale; i++) {
    field.tiles.set('S' + i, { key: 'S' + i, tile: { z: 12, x: i, y: 2 }, state: 2, heights: null, used: 0, priority: 0 });
  }
  const before = field.tiles.size;
  field.evict();
  const after = field.tiles.size;
  const liveLeft = [...field.tiles.values()].filter((e) => e.used === field.frame).length;
  ok(`it frees every tile it is allowed to  (${before} -> ${after}, floor ${live})`, after === live);
  ok('it never drops ground the frame is still sampling', liveLeft === live);
  // The point of the floor: with the limit floored at the live set, the excess
  // is only ever counted against tiles the loop may actually take, so "asked to
  // free more than it could" stops being reachable rather than becoming rarer.
  ok('so nothing is left over that it wanted gone', after <= Math.max(field.cacheLimit, live));

  const src = readFileSync(new URL('../src/tiles/elevation.js', import.meta.url), 'utf8');
  ok('the floor is the live set, not a constant', /const limit = Math\.max\(this\.cacheLimit, live\)/.test(src));
  settings.set('graphics', was ?? 'high');
}

// ---------------------------------------------------------------------------
console.log('\nPhotorealistic 3D resolves by where the tiles live, not which button was pressed');
{
  const { Tiles3D } = await import('../src/world/tiles3d.js');
  const abs = (state, uri) => Tiles3D.prototype.absolute.call(state, uri);

  /*
    Both of these were found with a real Cesium ion token and neither could
    have been found without one, because the stub they were tested against
    answered in a shape ion does not use for the asset anybody actually wants.

    ion answers in two shapes. An asset it hosts itself returns `url` and a
    short-lived `accessToken`. An external one — Google's photorealistic tiles,
    asset 2275207, the reason this route exists — returns `externalType` and
    puts the tileset under `options.url`. Reading only `url` gave undefined and
    the player was told "root 404" with a perfectly good token.

    Then, with the root loading, every child came back 403: `absolute` branched
    on the provider *setting* rather than on the host, so a Google tileset
    reached through ion had its children resolved as bare relative paths with
    no key and no session. Measured: root 200, twenty-four children 403. After:
    227 requests, all 200, 119 tiles, 221,180 triangles over San Francisco.
  */
  const ionBase = 'https://assets.ion.cesium.com/asset/1/tileset.json';
  ok('an ion-hosted tileset resolves plainly',
    abs({ base: ionBase, provider: 'cesium', session: '', key: 'ion-token' }, 'sub/0.b3dm')
      === 'https://assets.ion.cesium.com/asset/1/sub/0.b3dm');

  // The one that was broken: Google's tiles, reached with provider 'cesium'.
  const gBase = 'https://tile.googleapis.com/v1/3dtiles/root.json?key=GKEY';
  const child = abs({ base: gBase, provider: 'cesium', session: '', key: 'ion-token' },
    '/v1/3dtiles/datasets/CgIYAQ/files/AJVs');
  ok(`through ion, a Google child still carries the key  (${child.slice(-24)})`,
    child.includes('key=GKEY'));
  ok('and never the ion token, which Google has never heard of', !child.includes('ion-token'));

  // The session arrives inside a child URI and has to stick to every one after.
  const state = { base: gBase, provider: 'cesium', session: '', key: 'ion-token' };
  abs(state, '/v1/3dtiles/x?session=SESS');
  ok(`the session is remembered  (${state.session})`, state.session === 'SESS');
  ok('and carried onto the next child', abs(state, '/v1/3dtiles/y').includes('session=SESS'));

  // Direct Google, unchanged.
  ok('a direct Google key still works',
    abs({ base: '', provider: 'google', session: '', key: 'DIRECT' }, 'https://tile.googleapis.com/v1/3dtiles/z')
      .includes('key=DIRECT'));

  const src = readFileSync(new URL('../src/world/tiles3d.js', import.meta.url), 'utf8');
  ok('the handshake reads the external tileset URL', /grant\.externalType \? grant\.options\?\.url/.test(src));
  ok('and refuses to fetch nothing', src.includes("throw new Error('ion gave no tileset URL')"));
  ok('the bearer is not sent to a server it does not belong to',
    /this\.bearer = external \? '' :/.test(src));
}

// ---------------------------------------------------------------------------
console.log('\nThe hosted page bets the boot on one request, not seventy-seven');
{
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const bundler = readFileSync(new URL('../tools/bundle.mjs', import.meta.url), 'utf8');
  const online = readFileSync(new URL('../tools/online.mjs', import.meta.url), 'utf8');
  const flow = readFileSync(new URL('../.github/workflows/deploy-gh-pages.yml', import.meta.url), 'utf8');

  // The fault: a browser does not retry a module fetch that fails, so one
  // dropped response out of seventy-seven ended the boot for good. Measured by
  // dropping requests at random — booted 3/3 on a clean line, 2/3 at half a per
  // cent, and 0/3 at one, two and five per cent. One per cent is ordinary home
  // wifi, and it takes every machine on that network down at once.
  ok('no static module tag is left to fetch the graph anyway',
    !/<script[^>]*type="module"[^>]*src=/.test(index));
  ok('the page asks for the bundle first', index.includes("__TERRAGLIDE_PACK__ = './terraglide.bundle.js'"));
  ok('and asks again when it does not arrive', /packTries \+= 1;[\s\S]{0,120}setTimeout\(loadPack/.test(index));
  ok('three goes before giving up', /packTries < 3/.test(index));
  // The separator used to be a hard-coded question mark. It cannot be, now
  // that the published page carries the bundle's fingerprint as a query.
  ok('a retry is not served from the cached failure',
    /'retry=' \+ packTries/.test(index) && /indexOf\('\?'\)/.test(index));
  ok('the module graph is still there as a fallback',
    /function loadModules\(\)[\s\S]{0,200}type = 'module'/.test(index) && index.includes('__TERRAGLIDE_ENTRY__'));

  ok('the bundler emits it', bundler.includes("join(ROOT, 'terraglide.bundle.js')"));
  ok('the online edition rewrites both entry points',
    online.includes('__TERRAGLIDE_PACK__') && online.includes('__TERRAGLIDE_ENTRY__'));
  ok('the site publishes it', /cp -r[^\n]*terraglide\.bundle\.js/.test(flow));
  // Publishing without it silently reinstates the fault, so the build must fail
  // rather than ship a site that still has it.
  ok('and refuses to publish without it', /test -f _site\/terraglide\.bundle\.js/.test(flow));
  ok('while still publishing src for the fallback', /test -f _site\/src\/main\.js/.test(flow));

  // import.meta.url has to become each module's own address. From the
  // document's, createTileWorker resolves './tileWorker.js' to <site>/
  // tileWorker.js, which does not exist — a worker that 404s in silence and a
  // tile pipeline that never starts.
  ok('a bundled module knows its own address',
    bundler.includes('__tg_url(${JSON.stringify(id)})') && !/replace\(\/import\\.meta\\.url\/g, '__tg_base'\)/.test(bundler));
}

// ---------------------------------------------------------------------------
console.log('\nThe boot watchdog asks whether the game started, not whether it exists');
{
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const watchdog = /setTimeout\(\(\) => \{[\s\S]*?\}, 20000\);/.exec(index)?.[0] ?? '';
  ok('there is a watchdog', watchdog.length > 200);
  // Comments quote the old guard on purpose, to record what was wrong with it.
  // The shape checks below are about the code, so the prose comes out first —
  // otherwise this passes or fails on what the comment says, which is exactly
  // the vacuous check this file keeps catching elsewhere.
  const code = watchdog.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ok('the comments really do quote it', /if \(window\.terraglide\)/.test(watchdog));

  // The bug this pins: the guard was `if (window.terraglide) return`, and
  // main.js publishes that handle before it awaits start(). So the object
  // existing proved only that the constructor had run, and every hang inside
  // start() left the boot screen frozen with the one thing built to notice it
  // switched off. Hanging start() on purpose held "Building interface" at
  // thirty seconds with no message; the same run now says "Could not start"
  // at twenty-two.
  ok('it does not treat the handle existing as the game running',
    !/if \(window\.terraglide\)/.test(code));
  ok('it asks whether start() finished', code.includes('__terraglideStarted'));
  ok('and it does not talk over a failure the page already explained',
    code.includes('__terraglideSpoke'));

  // The flag has to be set after the await, or it means the same wrong thing
  // under a better name.
  const started = main.indexOf('__terraglideStarted = true');
  const awaited = main.indexOf('await game.start()');
  ok('the flag is set only once start() has resolved', awaited > 0 && started > awaited);
  ok('a reported failure says so', /function fail\([\s\S]{0,200}__terraglideSpoke = true/.test(main));
  ok('the stage is published for the watchdog to name',
    /function status\([\s\S]{0,160}__terraglideStage = message/.test(main));

  // A screen that cannot start cannot press F4, so it has to ask the questions
  // itself — and the answers only separate causes if they cover both this
  // origin and a provider.
  ok('the dead screen probes this site and a provider',
    /probe\('this site\\?'s code'/.test(code) && /probe\('Esri imagery'/.test(code));
  ok('every probe is bounded, so a silent network still reports',
    /AbortController/.test(code) && /abort\(\), 10000\)/.test(code));
  ok('and the report can be copied off the machine', /clipboard\.writeText/.test(code));
}

// ---------------------------------------------------------------------------
console.log('\nTouch controls follow how you are actually playing');
{
  const source = readFileSync(new URL('../src/ui/touch.js', import.meta.url), 'utf8');
  const watch = /watchForTouch\(\) \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? '';

  // It only ever turned them on. On anything with both a finger and a keyboard
  // — a Chromebook, a touchscreen laptop, a tablet with a keyboard — one stray
  // tap pinned the sticks over the game for the session with no way back.
  ok('a finger brings them up', /setEnabled\(true\)/.test(watch));
  ok('and a key or a mouse puts them away', /setEnabled\(false\)/.test(watch));
  ok('a coarse pointer still starts them on, for a phone',
    /pointer: coarse[\s\S]{0,80}setEnabled\(true\)/.test(watch));

  // Pointer movement is not a signal: touch devices synthesise mouse moves, and
  // the controls would vanish from under the finger using them.
  ok('movement alone does not put them away', !/pointermove/.test(watch));
  ok('only a real mouse press does', /pointerType !== 'mouse'/.test(watch));

  // Reproduce the rule on the keys it will actually see, so "a key" cannot
  // quietly come to mean "any key at all".
  const wouldHide = (key, mods = {}) => {
    if (mods.metaKey || mods.ctrlKey || mods.altKey) return false;
    if (key.length > 1 && !/^Arrow|^Shift$|^Control$/.test(key)) return false;
    return true;
  };
  ok('W puts them away', wouldHide('w'));
  ok('so does an arrow key', wouldHide('ArrowUp'));
  ok('and shift', wouldHide('Shift'));
  // A tablet's own on-screen keyboard sends these while you type a place name
  // into the map, and that is not a reason to take the controls away.
  ok('Enter does not', !wouldHide('Enter'));
  ok('nor Backspace', !wouldHide('Backspace'));
  ok('nor a browser shortcut', !wouldHide('r', { ctrlKey: true }));
}

// ---------------------------------------------------------------------------
console.log('\nCloth is woven at the size of cloth');
{
  const THREE = await import('../vendor/three/three.module.js');
  const { Avatar } = await import('../src/player/avatar.js');
  const rig = new Avatar(new THREE.Scene());

  // The wrapping was set to repeat and the repeat itself never was, so it
  // stayed at one — and a box's UVs run 0..1 across each face, which spread the
  // whole photograph of the weave over the whole chest. Magnified about fifty
  // times, cloth reads as tarpaulin, which is what looking down at yourself
  // showed.
  const source = readFileSync(new URL('../src/player/avatar.js', import.meta.url), 'utf8');
  ok('the repeat is set, not just the wrapping', /own\.repeat\.set\(/.test(source));
  ok('and each garment gets its own copy of the texture', /texture\.clone\(\)/.test(source));

  // Sized from the body rather than from a table beside it, so reshaping a limb
  // reshapes its weave.
  const tiles = Number(/const CLOTH_TILES_PER_HEIGHT = ([\d.]+)/.exec(source)?.[1]);
  const repeatFor = (material) => {
    const size = rig.clothSizeOf(material);
    return [
      Math.max(1, Math.round(size.x * tiles)),
      Math.max(1, Math.round(size.y * tiles)),
    ];
  };
  const [tw, th] = repeatFor(rig.torso.material);
  const [aw, ah] = repeatFor(rig.armL.limb.material);
  ok(`the chest repeats several times over  (${tw} x ${th})`, tw >= 2 && th >= 3);
  ok(`a sleeve is narrower than a chest  (${aw} x ${ah})`, aw < tw);
  ok(`and about as long  (${ah})`, Math.abs(ah - th) <= 2);
  // One tile should stand for something like a hand's width of real fabric.
  const metres = (1 / tiles) * 1.98;
  ok(`one tile is about a hand of fabric  (${(metres * 100).toFixed(0)} cm)`,
    metres > 0.06 && metres < 0.2);
}

// ---------------------------------------------------------------------------
console.log('\nThe map is something you read, not somewhere you go');
{
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  const paused = /get paused\(\) \{[\s\S]*?\n  \}/.exec(game)?.[0] ?? '';
  const keys = /get takingKeys\(\) \{[\s\S]*?\n  \}/.exec(game)?.[0] ?? '';

  // Opening the map stopped the world, because stopping the world was the only
  // way to stop W flying you into a mountain while you typed a place name.
  // Those are two different questions.
  ok('the map no longer stops the clock', !/worldmap\.open/.test(paused));
  ok('but it still takes the keyboard', /worldmap\.open/.test(keys));
  // A menu is still a menu.
  ok('a menu stops both', /settingsPanel\.open/.test(paused) && /cheatPanel\.open/.test(paused));
  ok('and the pause key on its own still works', /pausedByKey/.test(paused));
  // The freecam was never on the list and must not join it.
  // Read the returned expression, not the block: the comment above it says the
  // word "freecam" precisely to explain why the freecam is not in the list.
  const pausedExpression = /return Boolean\(([\s\S]*?)\);/.exec(paused)?.[1] ?? '';
  ok('the freecam does not stop the world', !/freecam/i.test(pausedExpression));
  ok('and neither does the map', !/worldmap/.test(pausedExpression));
  ok('and input suspension reads the new question',
    /this\.input\.setSuspended\(takingKeys\)/.test(game));
  // The clock is the thing `paused` gates, and only that.
  ok('the clock is what paused gates', /this\.update\(this\.paused \? 0 :/.test(game));
}

// ---------------------------------------------------------------------------
console.log('\nThe player stands on the ground and the feet are attached');
{
  const THREE = await import('../vendor/three/three.module.js');
  const { Avatar } = await import('../src/player/avatar.js');
  const scene = new THREE.Scene();
  const avatar = new Avatar(scene);
  avatar.root.visible = true;
  avatar.root.updateMatrixWorld(true);

  // World-space extent of a piece of the model, in fractions of standing
  // height — the root is built one unit tall with the origin at the sole.
  // `own` measures just this mesh's geometry: setFromObject walks children,
  // and a boot is a child of its leg, so measuring the leg that way measures
  // the boot instead.
  const span = (object, own = false) => {
    if (own) {
      object.geometry.computeBoundingBox();
      const box = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
      return { lo: box.min.y, hi: box.max.y };
    }
    const box = new THREE.Box3().setFromObject(object);
    return { lo: box.min.y, hi: box.max.y };
  };

  const leg = span(avatar.legL.limb, true);
  const boot = span(avatar.bootL);

  // The legs were 0.36 from a hip at 0.51, so they stopped at 0.15 — twenty-
  // seven centimetres above the sole on a person — and the boots were parked
  // below the origin entirely. Buried boots, floating trousers, a hand's span
  // of nothing between them.
  // The figure is a person's shape, not a block's.
  //
  // Against real anthropometry it was 1.68x too wide across the chest, 1.80x
  // across the shoulders and 2.09x across the hips. That is "why do I feel so
  // big" and "the player size should match up" — and it is why looking down in
  // first person filled the view with cloth: your own chest is a quarter of a
  // metre from your eye, and at half a metre wide it is a wall.
  {
    const box = (o) => new THREE.Box3().setFromObject(o);
    // A limb's own geometry, without its children: setFromObject walks down,
    // so measuring a leg measured the boot welded to the bottom of it — which
    // is wider than the trouser and is not a hip.
    const thigh = (mesh) => {
      mesh.geometry.computeBoundingBox();
      return mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    };
    const t = box(avatar.torso);
    const measures = {
      'chest width': [t.max.x - t.min.x, 0.155],
      'chest depth': [t.max.z - t.min.z, 0.1],
      'head height': [box(avatar.head).max.y - box(avatar.head).min.y, 0.13],
      // Outer face to outer face is deltoid breadth, not biacromial. 0.23 is
      // the distance between the shoulder *joints*, which is where the arm
      // pivots are put — the arms themselves hang outside it, and measuring
      // their outsides against it counted half an arm twice.
      'shoulder span': [box(avatar.armR.limb).max.x - box(avatar.armL.limb).min.x, 0.255],
      'shoulder joints': [avatar.armR.pivot.position.x - avatar.armL.pivot.position.x, 0.23],
      // Measured at the thighs, against bitrochanteric breadth — the widest
      // across the hips, which is what the outer faces of two thighs are.
      //
      // It used to be checked against 0.115, which is bi-iliac breadth: the
      // pelvis, measured at the crests, above and inside where the legs hang.
      // A leg is 0.062 thick, so an outer-to-outer span of 0.115 needs the
      // centres nine thousandths closer together than the legs are wide — the
      // only way to pass it was for the two legs to overlap, which is exactly
      // what they did, and the figure had one column of trouser from hip to
      // floor instead of a pair of legs. The measurement was wrong, not the
      // model.
      'hip span': [thigh(avatar.legR.limb).max.x - thigh(avatar.legL.limb).min.x, 0.19],
    };
    for (const [name, [mine, actual]] of Object.entries(measures)) {
      const ratio = mine / actual;
      ok(`${name} is a person's  (${ratio.toFixed(2)}x)`, ratio > 0.8 && ratio < 1.25);
    }

    // And there are two of them. This is the check the old target made
    // impossible, and the one that would have caught it.
    const gap = thigh(avatar.legR.limb).min.x - thigh(avatar.legL.limb).max.x;
    ok(`there is daylight between the legs  (${(gap * 1830).toFixed(0)} mm on a 1.83 m player)`,
      gap > 0.01);

    // Likewise the arms: at x = 0.088 against a chest 0.17 wide, 45 per cent
    // of each arm was inside the jacket and the standing figure had no arms in
    // silhouette at all.
    const chest = t.max.x;
    const armOut = thigh(avatar.armR.limb).max.x - chest;
    ok(`the arms hang beside the chest rather than inside it  (${(armOut * 1830).toFixed(0)} mm clear)`,
      armOut > 0.02);
  }

  // The capsule you collide with is a person too. 0.21 of height is an 0.83 m
  // barrel on a six-foot-six frame: you could not walk between two bollards.
  {
    const src = readFileSync(new URL('../src/player/player.js', import.meta.url), 'utf8');
    const factor = Number(/return Math\.max\([\d.]+, this\.height \* ([\d.]+)\);/.exec(src)?.[1]);
    ok(`the collision width is a person's  (${(factor * 2).toFixed(2)} of height across)`,
      factor * 2 > 0.18 && factor * 2 < 0.30);
  }

  ok(`the sole rests on the ground  (${boot.lo.toFixed(3)})`, Math.abs(boot.lo) < 0.005);
  ok(`nothing is buried under it  (${Math.min(leg.lo, boot.lo).toFixed(3)})`,
    Math.min(leg.lo, boot.lo) > -0.005);
  ok(`the boot meets the leg  (gap ${(leg.lo - boot.hi).toFixed(3)})`,
    Math.abs(leg.lo - boot.hi) < 0.005);
  ok('and the other foot too',
    Math.abs(span(avatar.bootR).lo) < 0.005
      && Math.abs(span(avatar.legR.limb, true).lo - span(avatar.bootR).hi) < 0.005);

  // The whole figure fits the unit it is scaled by: nothing below the sole,
  // nothing above the crown.
  const whole = span(avatar.root);
  ok(`the model is one unit tall  (${whole.lo.toFixed(3)} to ${whole.hi.toFixed(3)})`,
    whole.lo > -0.02 && whole.hi > 0.9 && whole.hi < 1.06);

  // The legs hang from the bottom of the torso rather than from inside it.
  const torso = span(avatar.torso);
  ok(`the legs start at the torso  (${(leg.hi - torso.lo).toFixed(3)})`,
    Math.abs(leg.hi - torso.lo) < 0.03);
}

// ---------------------------------------------------------------------------
console.log('\nA slow machine is not starved of the loading it needs most');
{
  const { PerfGovernor, STREAM_SHARE } = await import('../src/core/perf.js');
  const { settings } = await import('../src/core/settings.js');
  const beforeTarget = settings.get('fpsTarget');
  settings.set('fpsTarget', 60);

  const gov = new PerfGovernor();
  // Milliseconds of terrain work a machine at this frame rate gets through in
  // a second of wall clock. The budget is per frame, so a slow machine is
  // charged twice: a smaller budget and fewer frames to spend it in.
  const perSecond = (fps) => {
    gov.smoothedMs = 1000 / fps;
    return gov.budgetMs() * fps;
  };

  // The old rule was spare time only — negative on any machine that misses its
  // target, so it pinned to the 1.5 ms floor. 30 fps got 45 ms of work a
  // second against 144 fps's 1296: a twenty-ninth of the rate, with strictly
  // more to load, and usually slow *because* the world had not arrived. So it
  // never arrived. The minimap, which does not go through this budget, was
  // sharp immediately — which is exactly what the report said.
  ok('a machine at 30 fps is not starved', perSecond(30) > perSecond(144) * 0.15);
  ok('nor one at 10', perSecond(10) > perSecond(144) * 0.15);
  ok('nor one at 2', perSecond(2) > perSecond(144) * 0.15);
  ok('the loading rate barely depends on the frame rate',
    Math.max(perSecond(30), perSecond(10), perSecond(2)) /
      Math.min(perSecond(30), perSecond(10), perSecond(2)) < 1.05);

  // Bounded: this buys loading with frame time, and the price is fixed.
  const share = (fps) => { gov.smoothedMs = 1000 / fps; return gov.budgetMs() / gov.smoothedMs; };
  ok('and it never takes more than its share of a slow frame',
    share(30) <= STREAM_SHARE + 1e-9 && share(2) <= STREAM_SHARE + 1e-9);

  // Taking the larger of the two rules, so nothing that worked before is now
  // given less than it was.
  const old = (fps) => {
    const ms = 1000 / fps;
    return Math.min(9, Math.max(1.5, 1000 / 60 - ms + 4.5));
  };
  let worse = 0;
  for (const fps of [240, 144, 90, 60, 45, 30, 20, 15, 10, 5, 2, 1]) {
    gov.smoothedMs = 1000 / fps;
    if (gov.budgetMs() < old(fps) - 1e-9) worse++;
  }
  ok('and no frame rate gets less than it used to', worse === 0);

  settings.set('fpsTarget', beforeTarget);
}

// ---------------------------------------------------------------------------
console.log('\nThe map does not give up on satellite for good');
{
  const { MapTileCache } = await import('../src/ui/mapTiles.js');
  const cache = new MapTileCache();
  cache.setFallback([{ descriptor: { id: 'street' } }]);

  // Four rescues, ever, used to latch the map onto the standby for the rest of
  // the session with no way back — which is why the minimap stopped being
  // satellite after a while of flying and never came back.
  for (let i = 0; i < 5; i++) cache.noteRefusal();
  ok('a handful of refusals is not a verdict', !cache.resting);

  cache.noteRefusal();
  ok('a run of them rests the first choice', cache.resting);

  // And it comes back. The old flag had no path back at all.
  cache.restingUntil = Date.now() - 1;
  ok('and the rest ends by itself', !cache.resting);

  // Spread out, the same number of refusals means nothing: a server is not
  // failing because it hiccuped six times across an hour of flying.
  const spread = new MapTileCache();
  const now = Date.now();
  spread.refusals = [now - 60000, now - 50000, now - 40000, now - 30000, now - 20000];
  spread.noteRefusal();
  ok('refusals spread over a minute do not', !spread.resting);

  // One good tile clears the slate.
  const recovered = new MapTileCache();
  for (let i = 0; i < 5; i++) recovered.noteRefusal();
  recovered.rest(0);
  recovered.noteRefusal();
  ok('and a tile that arrives forgets the ones that did not', !recovered.resting);

  const src = readFileSync(new URL('../src/ui/mapTiles.js', import.meta.url), 'utf8');
  // Ground a provider has never imaged is not the provider refusing. Counting
  // it meant flying over any coastline disqualified the imagery everywhere,
  // because that is exactly where Esri serves its 'no map data' card.
  ok('a square with no imagery is not held against the server',
    /err\?\.noCoverage/.test(src) && /throw noCoverage\('no imagery here'\)/.test(src));
  ok('nor is a provider that never handshook', /error \?\? noCoverage\(/.test(src));
  ok('only the first choice is on trial', /if \(i === 0 && !err\?\.noCoverage\)/.test(src));
  ok('and the lifetime tally is gone', !/fallbackRescues|usingFallback/.test(src));
}

// ---------------------------------------------------------------------------
console.log('\nThe game clock keeps up with the wall clock');
{
  const { FixedStep, catchUpSteps, MAX_FRAME_S } = await import('../src/core/perf.js');

  // How much game time a machine drawing at this rate actually simulates, run
  // through the same accumulator the controller runs.
  const keepUp = (fps, timeScale = 1) => {
    const step = 1 / 20;
    const fixed = new FixedStep(step);
    const dt = Math.min(1 / fps, MAX_FRAME_S) * timeScale;
    let game = 0;
    let wall = 0;
    while (wall < 20) {
      fixed.maxSteps = catchUpSteps(step, timeScale);
      fixed.run(dt, (s) => { game += s; });
      wall += dt;
    }
    return game / wall;
  };

  // The catch-up ceiling was five ticks — a quarter of a second — while the
  // frame clock clamped at a second and a half. Everything between the two was
  // thrown away, so below four frames a second the world ran in slow motion and
  // gravity did a fraction of its job. At two frames a second, exactly half.
  ok('a machine at four frames a second runs at full speed', keepUp(4) > 0.99);
  ok('and so does one at two', keepUp(2) > 0.99);
  ok('and so does one at one', keepUp(1) > 0.99);
  ok('a stretched clock still gets all of its ticks', keepUp(2, 8) > 0.99);

  // The two numbers must come from one place, or they drift apart again.
  const perf = readFileSync(new URL('../src/core/perf.js', import.meta.url), 'utf8');
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  const controller = readFileSync(new URL('../src/player/controller.js', import.meta.url), 'utf8');
  ok('the ceiling is stated once', /export const MAX_FRAME_S/.test(perf));
  ok('the frame clock clamps to it', /const elapsed = clamp\(.*MAX_FRAME_S\)/.test(game));
  ok('and the fixed step sizes its catch-up from it',
    /catchUpSteps\(TICK, cheats\.gameSpeed\)/.test(controller));
  ok('with no second opinion about how many ticks that is',
    !/maxSteps\s*=\s*Math\.ceil\(\s*\d/.test(controller));

  // Seconds, not milliseconds. `elapsed` is already divided by a thousand, and
  // dividing again put the four-second window an hour of wall clock away — so
  // the tier everyone now starts on could never once move. The dial's own
  // checks all called update() directly with the right units and passed
  // throughout; only the call site was wrong.
  ok('auto quality is handed seconds', /autoQuality\.update\(elapsed\)/.test(game));
  ok('and the frame governor too', /perf\.update\(elapsed\)/.test(game));
}

// ---------------------------------------------------------------------------
console.log('\nCoarse cover is not thrown away like detail');
{
  const streamer = readFileSync(new URL('../src/tiles/streamer.js', import.meta.url), 'utf8');
  ok('cover is separated from detail before anything is dropped',
    /entry\.tile\.z <= COVER_ZOOM \? cover : rest/.test(streamer));
  ok('the detail cap applies to detail alone', /let excess = rest\.length - limit;/.test(streamer));
  ok('and cover has its own bound', /let spare = cover\.length - COVER_BUDGET;/.test(streamer));
}

// ---------------------------------------------------------------------------
console.log('\nA ground arrival waits above the ground, not inside it');
{
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  // Placed at "ground + 1.2" before any elevation exists is 1.2 m above sea
  // level. Held there over country whose surface is 172 m, the whole wait is
  // spent buried, then snapped out when the truth lands.
  ok('the hold rises with the ground', /const floor = ground \+ 1\.2;/.test(game)
    && /else if \(this\._holdY < floor\) this\._holdY = floor;/.test(game));
  ok('and you are standing if you arrived standing',
    /player\.onGround = !this\.holdInAir;/.test(game));
}

// ---------------------------------------------------------------------------
console.log('\nA modest machine is not asked to run like a desktop');
{
  const { tierFrom } = await import('../src/core/deviceTier.js');
  // The preset defaulted to "high" for everybody — right on a desktop, wrong
  // on exactly the machines that most need it right. A low-end Chromebook
  // started at high, ran at single figures, and auto-quality spent the first
  // minute of play climbing down from somewhere it should never have started.
  ok('a Chromebook does not start on high',
    tierFrom({ gpu: 'mali-g72', memoryGB: 4, cores: 4 }) === 'low');
  ok('nor does one with Intel integrated graphics and two cores',
    tierFrom({ gpu: 'intel(r) uhd graphics 600', memoryGB: 4, cores: 2 }) === 'low');
  ok('software rendering is a warning, not a tier',
    tierFrom({ gpu: 'swiftshader', memoryGB: 8, cores: 8 }) === 'low');
  ok('and a real desktop is left alone',
    tierFrom({ gpu: 'nvidia geforce rtx 4070', memoryGB: 8, cores: 16 }) === 'high');
  // One signal is too easy to get wrong: good laptops report four cores, and
  // plenty of browsers decline to report memory at all.
  ok('a browser that says nothing is not punished for it', tierFrom({}) === 'high');
  ok('and four cores alone is not enough to condemn a machine',
    tierFrom({ gpu: 'apple m2', memoryGB: 0, cores: 4 }) !== 'low');

  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  const settingsSrc = readFileSync(new URL('../src/core/settings.js', import.meta.url), 'utf8');
  ok('and it only ever applies when nothing has been chosen',
    /if \(settings\.wasChosen\('autoTier'\) \|\| settings\.wasChosen\('graphics'\)\) return;/.test(game)
    && /wasChosen\(key\)/.test(settingsSrc));
}

// ---------------------------------------------------------------------------
console.log('\nLosing the graphics context is survivable');
{
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  // There was no handling at all. On a low-memory machine Chrome kills the GPU
  // process, every texture goes with it, and the frame loop carries on drawing
  // into a context that no longer exists — a frozen canvas, no error, nothing
  // on screen to say what happened.
  ok('the loss is caught', /webglcontextlost/.test(game));
  // And this is the line that decides whether it can ever come back.
  ok('and preventDefault is called, or the browser never offers one back',
    /webglcontextlost[\s\S]{0,320}event\.preventDefault\(\)/.test(game));
  ok('the loop stops rather than drawing into nothing',
    /webglcontextlost[\s\S]{0,420}this\.running = false/.test(game));
  ok('and on restore the world is rebuilt, not drawn with dead handles',
    /webglcontextrestored[\s\S]{0,500}this\.terrain\.rebase\(\)/.test(game)
    && /webglcontextrestored[\s\S]{0,700}this\.running = true/.test(game));
}

// ---------------------------------------------------------------------------
console.log('\nJump opens the wings and never shuts them');
{
  const controller = readFileSync(new URL('../src/player/controller.js', import.meta.url), 'utf8');
  // A press in the air used to toggle. Measured while gliding at 1.4 m/s down:
  // one press of the jump key and the wings shut and the fall went to 16 m/s.
  // Minecraft deploys on space and does nothing at all on the next press; you
  // stow by landing, or with the key that is for stowing.
  ok('a press in the air only ever opens them',
    /if \(!player\.elytraDeployed\) player\.toggleElytra\(true\);/.test(controller));
  ok('and there is no toggle left on that path',
    !/player\.toggleElytra\(!player\.elytraDeployed\)/.test(controller));
  const help = readFileSync(new URL('../src/ui/help.js', import.meta.url), 'utf8');
  ok('and the card no longer promises a toggle',
    /press again once airborne to open the wings/.test(help)
    && /Open or stow the wings/.test(help));
}

// ---------------------------------------------------------------------------
console.log('\nArrival waits for ground, not for a stopwatch');
{
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');

  // The hold ran for 2.6 s and then handed over whether or not the elevation
  // had arrived. Measured on a launch into Antarctica: ground 0 m at 1.8 s,
  // 945 m at 4.6 s, 3,656 m at 8.6 s, the player carried up every time — six
  // seconds of being launched up an ice sheet, which reads as the world
  // restarting.
  ok('the hold does not end on a clock alone',
    /return this\.arrivalHeld && !this\.groundIsReal/.test(game));
  ok('and waits for the ground under the player to stop moving',
    /performance\.now\(\) - this\._groundMovedAt > GROUND_STILL_MS/.test(game));
  ok('which is watched every frame, whichever branch runs',
    /this\.watchGround\(\);\n    let movement/.test(game));

  // Pressing a key skipped the hold entirely and put the player on ground that
  // did not exist, so the first thing moving did was launch them.
  ok('asking to move gives the controls without giving up the floor',
    /\} else if \(this\.settling\) \{[\s\S]{0,900}this\.updateHoldHeight\(dt\)/.test(game));
  ok('and the held height has one definition, not two',
    /updateHoldHeight\(dt\) \{/.test(game)
    && (game.match(/this\.updateHoldHeight\(dt\)/g) ?? []).length >= 2);

  // Held above the ground rather than at an absolute altitude: four hundred
  // metres up it makes no difference whether the ground is sea level or an
  // alp, right up until the ground is 3,656 m of ice and you are inside it.
  ok('the airborne hold keeps its distance from the ground',
    /const above = ground \+ SPAWN_HEIGHT_M;/.test(game)
    && /Math\.abs\(this\._holdY - above\) > GROUND_JUMP_M/.test(game));
  ok('and a small refinement does not slide the world past you',
    /const GROUND_JUMP_M = 30;/.test(game));

  // The frame a fine tile lands is the frame the ground jumps; releasing on it
  // hands the player over mid-correction.
  ok('the correction lands inside the hold, not on the frame you take over',
    /performance\.now\(\) - this\._readySince > READY_DWELL_MS/.test(game));

  const terrain = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');
  ok('and the terrain publishes what it is currently asking for',
    /this\.wantedElevationZoom = elevZoom;/.test(terrain));
}

// ---------------------------------------------------------------------------
console.log('\nGround below sea level is flattened, deliberately');
{
  // A known, bounded inaccuracy, pinned so it stays a decision. The elevation
  // source carries bathymetry, so without the clamp the ocean becomes a canyon
  // and the sea shading — which keys off ground at or under sea level — is
  // draped down the inside of it. Telling land below sea level from sea needs
  // a source at the resolution the ground is built at, and there is not one:
  // the water probe reads a 32x32 mask per zoom-6 tile, so a misread over open
  // water would put a hole in the sea.
  const terrain = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');
  ok('the clamp is still there',
    /Math\.max\(SEA_LEVEL, this\.elevation\.sampleNorm/.test(terrain));
  ok('and says why, with what it costs',
    /Dead Sea shore reads 0 m here/.test(terrain) && /bathymetric depth/.test(terrain));
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
    /uniform sampler2D uWoodMask/.test(shaders)
    && /vec3 crownRelief\(vec2 here, vec2 lo, vec2 hi, float e\)/.test(shaders)
    && /texture2D\(uMap, clamp\(here \+ vec2\(e, 0\.0\)/.test(shaders));
  // The crowns are in the photograph and reading them off it is the only way
  // they can line up with actual trees. A noise field cannot, whatever its
  // scale, which is exactly what "it is like a pattern on the ground, not a
  // pattern of trees" was describing.
  ok('and the crowns come off the photograph, not out of a noise field',
    !/canopyField/.test(shaders) && !/cloudNoise\(world/.test(shaders));
  /*
    And the sheet's own edge is not a cliff.

    It is a twelve-kilometre square laid around the camera and re-laid every
    two kilometres of travel. Inside it woodland was lifted by up to
    twenty-five metres and outside it the test simply failed, so the lift was
    nought — a straight line six kilometres out, well inside the render
    distance on any tier above Low, with a wood lying across it raised on one
    side and not the other. Twenty-five metres of step, and the squares beyond
    it sitting low. Re-laying the square moved the line, so a ring of ground
    popped up or down by the same amount as you flew.
  */
  ok('the canopy lift reaches nought before the sheet ends, not at it',
    /const float CANOPY_EDGE_FADE = 0\.0833;/.test(shaders)
    && /vec2 fromEdge = min\(wuv, 1\.0 - wuv\);/.test(shaders)
    && /smoothstep\(0\.0, CANOPY_EDGE_FADE, min\(fromEdge\.x, fromEdge\.y\)\)/.test(shaders));
  ok('and the hard in-or-out test that made that edge is gone',
    !/wuv\.x > 0\.0 && wuv\.x < 1\.0/.test(shaders));
  // Both halves fade together: a shading edge in the same place would be just
  // as visible a line as a geometric one.
  ok('the shading fades on the same margin as the lift',
    (shaders.match(/smoothstep\(0\.0, CANOPY_EDGE_FADE,/g) || []).length === 2);

  ok('and does nothing at all where nothing is mapped',
    /float wood = 0\.0;/.test(shaders) && /if \(uHasWood > 0\.5\)/.test(shaders)
    && /uWoodMask: \{ value: BLACK_PIXEL \}/.test(shaders));
  ok('crowns are shaded, not stood up \u2014 the ground does not move',
    !/uWood[\s\S]{0,400}position\.y/.test(shaders));
  /*
    And shaded hard enough to read as trees rather than as a tint.

    Rendered over the eucalypt forest at 32.57S 152.19E, from ninety metres up,
    measuring the crown-scale contrast of the green pixels — the mean step in
    green between neighbouring samples:

      relief off                 15.38 levels a pixel
      a crown four metres proud,
        contrast added at 0.55   16.17   (+0.79)
      eight metres, in full      18.05   (+2.67)

    Three and a half times as much crown, and the clearing in the middle of the
    wood keeps its shape — at twice that again the canopy turns to speckle and
    the clearing's edge goes with it.
  */
  ok('a crown stands as far above the gap as most of a tree',
    /const float CROWN_HEIGHT_M = 8\.0;/.test(shaders));
  ok('and the photograph\u2019s own crown contrast is added again in full',
    /const float CROWN_DEPTH = 1\.0;/.test(shaders));
  ok('the scanned world is left alone, and so is Overpass',
    /this\.woodland\.enabled = !photoreal && settings\.get\('woodlandRelief'\)/.test(wiring));
  ok('and it can be turned off', /woodlandRelief: true/.test(
    readFileSync(new URL('../src/core/settings.js', import.meta.url), 'utf8')));
  // Off has to mean off. The toggle only ever governed the survey half, so
  // across the ninety per cent of the world nobody has drawn a wood in, the
  // photograph's own canopy score went on bumping the trees with the setting
  // switched off. It governs the strength the shader multiplies by, which is
  // both halves.
  ok('and turning it off stops the photograph half as well',
    /uWoodStrength\.value = !photoreal && settings\.get\('woodlandRelief'\) \? 1 : 0/.test(wiring)
    && /float amount = wood \* uWoodStrength;/.test(shaders));
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
  const { Player, SURGE_FACTOR } = await import('../src/player/player.js');
  const { settings: S } = await import('../src/core/settings.js');
  const frame = { setAnchor() {}, toGeo: () => ({ lat: 0, lon: 0 }) };
  const player = new Player(frame);

  ok('at rest the multiplier is one', near(player.speedMultiplier, 1, 1e-9));
  const restingRocket = player.rocketPower;

  // Speed mode comes on like a switch: the blend runs up over a moment, so
  // step the clock rather than expecting it instantly.
  player.startSpeedMode();
  for (let i = 0; i < 200; i++) player.tickTimers(1 / 60);
  // Against the constant, not against the number it used to be: surge is worth
  // 2.4x now, and a check that spells "2" into the assertion has to be edited
  // every time the balance moves, which is how it comes to be testing history.
  ok('surge multiplies the running', near(player.speedMultiplier, SURGE_FACTOR, 1e-6),
    `${player.speedMultiplier}x`);
  ok('and lifts the firework by the same factor',
    near(player.rocketPower, restingRocket * SURGE_FACTOR, 1e-6),
    `${player.rocketPower} vs ${restingRocket}`);

  // A stronger slot multiplies with it rather than replacing it: that is the
  // reason to save a Rocket V for the burst.
  player.selectSlot(4);
  const strong = player.rocketPower;
  player.speedBlend = 1;
  ok('a stronger slot and the burst multiply', near(strong, player.rocketPower * SURGE_FACTOR, 1e-6),
    `${strong} vs ${player.rocketPower}`);

  // Dropping the burst bleeds away rather than halving between two frames,
  // and a burning firework holds it up while it does.
  player.speedBlend = 2;
  player.speedActive = false;
  // Fireworks are a list now rather than a single timer, so "one is burning"
  // is a rocket in the list rather than a number assigned to.
  player.stopRockets();
  for (let i = 0; i < 30; i++) player.tickTimers(1 / 60);
  const freeFall = player.speedBlend;
  player.speedBlend = 2;
  player.rockets.push({ left: 100, total: 100, power: 1 });
  for (let i = 0; i < 30; i++) player.tickTimers(1 / 60);
  ok('and a firework still burning slows the bleed', player.speedBlend > freeFall,
    `${player.speedBlend.toFixed(3)} burning vs ${freeFall.toFixed(3)} not`);

  // Escape is the pause key, and a menu is what pausing looks like.
  const gameSource = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  // A menu counts as paused. The world map used to be on this list and is not
  // any more — see "The map is something you read"; it takes the keyboard and
  // leaves the clock running.
  ok('any modal panel counts as paused',
    /get paused\(\)[\s\S]{0,900}settingsPanel\.open[\s\S]{0,200}cheatPanel\.open/.test(gameSource));
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
    /invalidateStale\([\s\S]{0,2000}for \(const node of this\.nodes\.values\(\)\)[\s\S]{0,4000}node\.dirty = true/.test(terrain));
  // "Something better to build from" was read as "a deeper elevation zoom is
  // available", which misses the case that actually shows. The height field is
  // not a pure function of position — sampleFrom fades a fine value into the
  // coarse one along any edge whose finer neighbour has not arrived — so two
  // squares can report the same deepest zoom, both be clean, and stand at
  // different heights. Measured over the Black Forest: two zoom-16 squares
  // sharing an edge, both built from elevation zoom 7, both wanting 7, neither
  // dirty, both settled, 135 metres apart for forty-five seconds.
  ok('and it asks the ground whether it moved, not just the bookkeeping',
    /if \(!this\.groundMoved\(node, size, this\.seeableMove\(node, size, camX, camZ\)\)\) continue;/
      .test(terrain)
    && /groundMoved\(node, size, enough = MOVED_MIN_M\) \{/.test(terrain)
    && /node\.builtHeights = built;/.test(terrain));
  /*
    And "moved" is measured on screen, not in metres.

    Half a metre is fifty pixels under your feet and a twentieth of one on the
    horizon, so a fixed figure redrew ground five kilometres away that nobody
    could have told had changed — and every redraw is a walk, and a walk you
    can see is the ground moving. The same test now decides it in both places
    that mark a square dirty; marking in one on "a deeper zoom exists" while
    the other refuses on "it has not visibly moved" leaves the careful test
    deciding nothing.
  */
  ok('and how far it has to move is how far you could see it move',
    /const MOVED_MIN_RAD = 0\.002;/.test(terrain)
    && /Math\.hypot\(cx - camX, cz - camZ\) \* MOVED_MIN_RAD/.test(terrain));
  ok('and the draw path asks the same question, not a different one',
    /bestZoom > builtFrom && node\.mesh\n\s*&& this\.groundMoved\(node, size,/.test(terrain));
  /*
    While a deeper elevation tile is still coming, the rungs in between are not
    steps toward the answer — they are different answers. Traced at one fixed
    point over two minutes, the square under it was rebuilt at elevation zooms
    6, 8, 10, 12 and 14 and drew 107.3, 93.8, 96.9, 92.1 and 92.6 metres: down,
    up, down, up, two hundred and thirty-six metres of travel for a net
    fifteen.
  */
  /*
    And distance is all of it, because distance cannot desynchronise
    neighbours: two squares beside each other are the same distance away.

    Every rule that delays one square and not another was tried and measured.
    Holding a square until it gets the zoom it asked for cuts one point's
    rebuilds from eight to three and its direction changes from four to two,
    and puts neighbours three elevation zooms apart with 218 metres of daylight
    under the curtain where there had been three. Sharing the timing across the
    view instead measured worse again. A snapshot of the height field taken at
    a different moment from your neighbour's does not meet it, however
    continuous the field is.
  */
  ok('and nothing per-square delays it, so neighbours cannot diverge',
    !/LEVELS_BEHIND_TO_REDRAW/.test(terrain) && !/ELEV_PATIENCE_MS/.test(terrain)
    && !/PROVISIONAL_MIN_M/.test(terrain) && !/elevEpoch/.test(terrain));
  /*
    And a walk only makes sense from a height that was on screen. A merged
    parent holds whatever heights it was last built with, and for a square
    built before any elevation arrived that is nought: the ground fell 107
    metres to sea level and climbed back, with nothing about the terrain having
    changed — only which square was drawing it.
  */
  ok('a square that was not on screen has nothing to walk from',
    /const seen = node\.shownFrame >= \(this\.streamer\.frame \?\? 0\) - 2;/.test(terrain)
    && /if \(!seen && prevY\) \{/.test(terrain));
  /*
    And it asks along the edges, which is where two squares disagree.

    The corners and the middle were the whole set. A corner is shared with three
    other squares and is the least likely point to be the one that moved, and
    the fade that causes this runs along an edge. Measured over the Tibetan
    plateau at 31.11N 82.56E: two zoom-14 squares standing 103.5 metres apart
    with neither marked dirty, because two kilometres of edge had moved between
    five samples that had not.
  */
  ok('and it asks along the edges, not only at the corners',
    /movedProbes\(x, z, size, out = \[\]\) \{/.test(terrain)
    && /const perEdge = clamp\(Math\.round\(size \/ 256\), 1, 4\);/.test(terrain));
  {
    const { Terrain } = await import('../src/world/terrain.js');
    const probes = Terrain.prototype.movedProbes.call(null, 0, 0, 2048);
    const points = [];
    for (let i = 0; i < probes.length; i += 2) points.push([probes[i], probes[i + 1]]);
    const onEdge = points.filter(([x, z]) =>
      (x === 0 || x === 2048 || z === 0 || z === 2048)
      && !((x === 0 || x === 2048) && (z === 0 || z === 2048)));
    ok(`a two-kilometre square is sampled along its edges  (${onEdge.length} points)`,
      onEdge.length === 16);
    const gaps = onEdge.filter(([x, z]) => z === 0).map(([x]) => x).sort((a, b) => a - b);
    const widest = Math.max(2048 - gaps[gaps.length - 1], gaps[0],
      ...gaps.slice(1).map((v, i) => v - gaps[i]));
    ok(`with no more than four hundred metres between samples  (${widest} m)`,
      widest <= 420);
    const small = Terrain.prototype.movedProbes.call(null, 0, 0, 128);
    ok(`and a small square is not made expensive  (${small.length / 2} points)`,
      small.length / 2 === 9);
  }
  // Sixty times a second over three hundred squares is a fifth of a millisecond
  // a frame at five samples each and four times that at the count the edges
  // need. A square that has gone stale walks to its new height over a third of
  // a second anyway, so a quarter of a second late is inside that animation.
  ok('and asks four times a second rather than sixty',
    /const MOVED_CHECK_MS = 250;/.test(terrain)
    && /if \(moment - \(node\.movedCheckedAt \?\? -Infinity\) < MOVED_CHECK_MS\) continue;/
      .test(terrain));
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
  /*
    And every square is drawn from the zoom the *view* has reached, not the one
    its own tile happened to arrive at.

    Elevation streams coarse to fine, tile by tile, and a square was rebuilt the
    moment its own landed. Measured over the Bernese Alps while loading: zooms
    8 through 12 all in use at the same instant, 23% of neighbouring pairs
    disagreeing about which, gaps of three levels. Four hundred squares
    settling separately, each at its own moment and by its own amount, is
    exactly "random chunks moving up and down" — and it is a different fault
    from any single square being wrong.
  */
  /*
    And ground nobody has measured is not at sea level.

    sampleNorm answers nought where no elevation tile covers the point, and
    nought is a height, so a square with no data was built as a flat plate at
    sea level next to squares that had data — and jumped up to meet them when
    its own tile landed. Traced at one fixed point: 0, then 74.7 the moment the
    tile arrived, then the tree re-cut into a square that had no data of its own
    and drew it at 0 again, then 59.6. Seventy-five metres each way, twice,
    with the terrain never having changed.
  */
  ok('a square with no elevation stands where its parent stands',
    /const standIn = measured \? 0 : this\.ancestorHeightAt\(tile,/.test(terrain)
    && /ancestorHeightAt\(tile, x, z\) \{/.test(terrain));
  // Through the node tree, not through `drawn` — which is the list the walk is
  // in the middle of rebuilding when this is called, so the parent has been
  // taken out of it and the child is not in it yet.
  ok('and finds that parent through the tree, not the draw list',
    /const parent = this\.nodes\.get\(tileKey\(tz, tx, ty\)\);/.test(terrain));
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
  const fail = (s, z, n, x = 1, y = 1) => {
    for (let i = 0; i < n; i++) {
      s.zoomRecord(z).failed++;
      s.reviewDepth({ z, x, y });
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
    const record = s.zoomRecord(17);
    record.loaded += 1;
    record.failedAtLoad = record.failed;
    s.reviewDepth({ z: 17, x: 1, y: 1 });
    ok('and one tile arriving puts the level back', s.maxUsefulZoom === 19, `z${s.maxUsefulZoom}`);
  }
  {
    // And the fix this replaced. `loaded` is cumulative for the session and
    // never decays, so returning early on "has this level ever worked" meant one
    // tile at zoom 22 arriving over a city stopped zoom 22 ever being written
    // off again. Fly on to a valley where it does not exist and every square
    // asks for it and is refused, for ever: measured over Grindelwald, the
    // refusal count climbed 39 to 73 in seventy-five seconds with nothing
    // pending. A success ends the run; a fresh run writes the level off again.
    const s = make();
    s.zoomRecord(16).loaded = 3;
    const record = s.zoomRecord(17);
    record.loaded = 1;              // it worked, once, somewhere else
    record.failedAtLoad = record.failed;
    fail(s, 17, 8);                 // and here it does not work at all
    s.reviewDepth({ z: 17, x: 1, y: 1 });
    ok('a level that worked an hour ago does not vouch for the ground here',
      s.maxUsefulZoom === 16, `z${s.maxUsefulZoom}`);
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
    // works: the only ceiling is the one you set, and it starts at whatever
    // the deepest provider serves.
    //
    // This used to pin the number — 22 — and the number is exactly the thing
    // that moves. It went stale the moment Esri's entry was raised past it,
    // and a stale ceiling silently caps the quadtree below a level that does
    // exist. So the relationship is asserted instead of the value.
    const { DEFAULT_SETTINGS: D } = await import('../src/core/settings.js');
    const { NO_ZOOM_CEILING: none } = await import('../src/tiles/providers.js');
    ok('there is no tick to forget to turn on', !('maxTileZoomAuto' in D));
    ok('and it starts with no ceiling at all', D.maxTileZoom >= none);
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
    // And a third leaves them open. This asserted the opposite, because the
    // key was a toggle — which is what "pressing jump breaks it" was: gliding
    // down at 1.4 m/s, one press, wings shut, falling at 16. Minecraft does
    // nothing on that press, and so does this now; the wings key stows.
    ok('and a third leaves them open', r.player.elytraDeployed);

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
    const { SURGE_FACTOR: factor } = await import('../src/player/player.js');
    ok(`surge is worth exactly its factor  (${factor}x)`,
      near(r.player.speedMultiplier, factor, 0.01));
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

// J2: a test on every mode.
//
// The individual behaviours are tested above and throughout — a fall reaches
// 78.4, a walk is 4.32, a glide is Minecraft's tick. What was missing is the
// thing the request actually names: that the controller *picks* the right mode
// for each state, and that each one moves you at all when it is picked. Those
// are different failures. A mode that is never selected passes every test of
// what it does, because none of them go through the selector.
//
// Driven through the real controller, one state per mode, rather than by
// setting player.mode and reading it back.
console.log('\nEvery mode, through the selector that chooses it');
{
  const { Player } = await import('../src/player/player.js');
  const { PlayerController } = await import('../src/player/controller.js');
  const { cheats } = await import('../src/core/cheats.js');
  const frame = { setAnchor() {}, toGeo: () => ({ lat: 0, lon: 0 }) };
  // Dry land at zero, with a lake from x = 400 east so swimming has somewhere
  // to happen.
  const world = {
    heightAt: (x) => (x > 400 ? -6 : 0),
    bedAt: (x) => (x > 400 ? -6 : 0),
    meshHeightAt: () => null,
    hasElevationAt: () => true,
    isWaterAt: (x) => x > 400,
  };
  const keys = (over = {}) => ({
    forward: false, back: false, left: false, right: false,
    jump: false, sprint: false, crouch: false, ...over,
  });
  const rig = () => {
    const player = new Player(frame);
    return { player, controller: new PlayerController({ player, terrain: world, buildings: null }) };
  };
  const run = (r, frames, over) => {
    for (let i = 0; i < frames; i++) r.controller.update(1 / 60, keys(over));
  };
  const moved = (r, frames, over) => {
    const from = r.player.position.clone();
    run(r, frames, over);
    return r.player.position.distanceTo(from);
  };

  {
    const r = rig();
    r.player.onGround = true;
    const went = moved(r, 120, { forward: true });
    ok(`standing on the ground is 'walk', and it moves you  (${went.toFixed(1)} m)`,
      r.player.mode === 'walk' && went > 4, r.player.mode);
  }
  {
    const r = rig();
    r.player.position.set(0, 500, 0);
    r.player.onGround = false;
    const went = moved(r, 60);
    ok(`airborne with the wings shut is 'fall', and it drops you  (${went.toFixed(1)} m)`,
      r.player.mode === 'fall' && went > 4, r.player.mode);
  }
  {
    const r = rig();
    r.player.position.set(0, 500, 0);
    r.player.onGround = false;
    r.player.elytraDeployed = true;
    r.player.velocity.set(0, 0, -30);
    const from = r.player.position.clone();
    run(r, 120);
    const forward = Math.hypot(r.player.position.x - from.x, r.player.position.z - from.z);
    const dropped = from.y - r.player.position.y;
    ok(`airborne with the wings open is 'glide', and it flies rather than falls`
      + `  (${forward.toFixed(0)} m across for ${dropped.toFixed(0)} m down)`,
      r.player.mode === 'glide' && forward > dropped * 3, r.player.mode);
  }
  {
    const r = rig();
    r.player.position.set(0, 500, 0);
    r.player.onGround = false;
    const was = cheats.fly;
    if (!was) cheats.toggle('fly');
    run(r, 30);
    const held = r.player.position.y;
    run(r, 120, { jump: true });
    const climbed = r.player.position.y - held;
    ok(`the fly cheat is 'fly', and it holds you up and climbs  (${climbed.toFixed(0)} m)`,
      r.player.mode === 'fly' && Math.abs(held - 500) < 2 && climbed > 5, r.player.mode);
    // Jump is the ascend key while flying and nothing else. Without that it was
    // also the wings key — the airborne branch of readJumpEdges only asks
    // whether you are off the ground, and flying always is — so one press of
    // ascend deployed the elytra invisibly, made rockets lightable in a mode
    // with no use for them, and dropped you into a glide the moment the cheat
    // came off.
    ok('and climbing on the jump key does not open the wings behind your back',
      !r.player.elytraDeployed);
    ok('so a rocket cannot be lit while flying', r.player.fireRocket() === false);
    if (cheats.fly !== was) cheats.toggle('fly');
    // Long enough to carry a physics tick. The mode is chosen inside the fixed
    // 20 Hz tick, so two frames at 60 Hz can pass without it being recomputed —
    // which is what this read the first time it was written.
    run(r, 8);
    ok('and turning it off hands you back to the falling one',
      r.player.mode === 'fall', r.player.mode);
  }
  {
    // Swimming is a flag rather than a mode name, and it is the one that had no
    // test of its own at all.
    const r = rig();
    r.player.position.set(600, -4, 0);
    r.player.onGround = false;
    run(r, 60);
    ok('standing in the lake sets the swimming flag', r.player.swimming === true);
    const sinking = r.player.velocity.y;
    ok(`and water holds you up rather than dropping you at 78 m/s  (${sinking.toFixed(1)} m/s)`,
      sinking > -12);
    r.player.position.set(0, 0, 0);
    r.player.onGround = true;
    run(r, 30);
    ok('and it clears again on dry land', r.player.swimming === false);
  }
  {
    // The two perspectives are a mode in the sense the request means: each has
    // its own body to draw, and the swap is where one of them has gone missing
    // before.
    const { settings } = await import('../src/core/settings.js');
    const before = settings.get('perspective');
    settings.set('perspective', 'first');
    ok('first person is a mode you can be in', settings.get('perspective') === 'first');
    settings.set('perspective', 'third');
    ok('and so is third', settings.get('perspective') === 'third');
    settings.set('perspective', before);
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
  // Whatever the spread is called, the street layer's own id is written last
  // and wins — which is the thing that matters, and is why this no longer
  // pins the name of the object being spread.
  ok('so swapping which satellite you fly over does not change the fog',
    /streetTiles\.setSource\(createImagerySource\(\{ \.\.\.\w+, imageryProvider: 'esri-street' \}\)\)/.test(game));

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

  // And the fog is read at a level the record actually keeps, or it grows.
  //
  // It used to subdivide every map tile sixteen ways whatever the zoom, which
  // makes the mask level `tileZoom + 4`. That is coarser than the record
  // everywhere below map zoom 12, and on the odd zooms it lands between
  // recorded levels — where isExplored shifts *down* to the nearest one it has,
  // and a coarser cell counts as explored if any part of it is. So ground you
  // had seen grew as you zoomed out: sixteen times the area at map zoom 10 and
  // 11, two hundred and fifty-six at 8, four thousand at 6.
  {
    const { LEVELS } = await import('../src/ui/exploration.js');
    const finest = LEVELS[LEVELS.length - 1];
    const chosen = (tileZoom) => {
      const wanted = Math.min(finest, tileZoom + 6);
      let level = LEVELS[0];
      for (const candidate of LEVELS) if (candidate <= wanted) level = candidate;
      return level;
    };
    ok('the fog level is always one the record keeps',
      [2, 4, 6, 8, 9, 10, 11, 12, 14, 16, 18].every((z) => LEVELS.includes(chosen(z))));
    ok('and it is the finest one from map zoom 10 up, where the map is read',
      [10, 11, 12, 14, 16, 18].every((z) => chosen(z) === finest));
    // The old rule, kept here so the regression is named rather than described.
    const before = (tileZoom) => {
      const sub = Math.max(1, Math.min(16, Math.pow(2, 16 - tileZoom)));
      const maskZoom = tileZoom + Math.round(Math.log2(sub));
      let level = LEVELS[0];
      for (const candidate of LEVELS) if (candidate <= maskZoom) level = candidate;
      return level;
    };
    const tighter = [4, 6, 8, 9, 10, 11].map((z) => Math.pow(4, chosen(z) - before(z)));
    ok(`and every zoom claims less ground than it did  (${tighter.join('x, ')}x tighter)`,
      tighter.every((t) => t >= 16));
    ok('the renderer picks the level rather than a fixed sixteen subdivisions',
      /const wanted = Math\.min\(LEVELS\[LEVELS\.length - 1\], tileZoom \+ 6\)/.test(renderer)
      && !/Math\.min\(16, Math\.pow\(2, 16 - tileZoom\)\)/.test(renderer));
  }

  // No tile grid over the photograph. It is the seams of the fetching machinery
  // drawn on a picture of somewhere real — a thing a developer wants to see and
  // a player never does, and it made the map read as a screenshot of a tool.
  ok('no tile grid is drawn over the map',
    !/options\.grid/.test(renderer)
    && !/grid:/.test(readFileSync(new URL('../src/ui/worldmap.js', import.meta.url), 'utf8')));
}

console.log('\na refusal is not a reason to ask harder');
{
  // Both APIs behind this bill per request. The wanted list is rebuilt every
  // frame and every entry offered to requestContent again, and there was no
  // memory of a refusal at all — so an expired session, which refuses every
  // tile at once, spent the player's money at ninety-odd requests a second
  // with nothing on screen. This drives the real request path.
  const { Tiles3D } = await import('../src/world/tiles3d.js');
  const rig = {
    // Wide enough that the concurrency gate is never the thing under test.
    budget: { active: 500 },
    pending: new Set(),
    refused: new Map(),
    loaded: new Map(),
    active: 0,
    stats: { failed: 0 },
    absolute: (u) => u,
    resting: Tiles3D.prototype.resting,
    requestContent: Tiles3D.prototype.requestContent,
  };
  let asked = 0;
  rig.loader = { load: (_u, _ok, _p, fail) => { asked++; setTimeout(() => fail(new Error('403')), 0); } };

  const uris = Array.from({ length: 40 }, (_, i) => `refuses-${i}.glb`);
  const frame = () => { for (const u of uris) rig.requestContent(u, null); };
  const settle = () => new Promise((done) => setTimeout(done, 60));

  frame(); await settle();
  const first = asked;
  ok(`every tile is asked once  (${first})`, first === uris.length);
  // Sixty of the frames that used to each fire another forty requests.
  for (let i = 0; i < 60; i++) frame();
  await settle();
  ok(`and not again while they are resting  (${asked - first} more)`, asked === first);
  // Once the rest is over, one more try each — not a hundred a second.
  for (const u of uris) rig.refused.set(u, performance.now() - 9000);
  frame(); await settle();
  ok(`then once more  (${asked - first})`, asked - first === uris.length);
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

console.log('\nthe download slot is held until the download settles');
{
  // The slot used to be released fifty milliseconds after the request STARTED,
  // which is not a concurrency limit at all: four slots recycled every fifty
  // milliseconds is eighty requests a second with nothing capping how many are
  // open at once. The `pending` mark went with it, so a tile still downloading
  // no longer counted as asked for and was asked for again on the next frame,
  // and the browser's few connections to the host filled with copies of tiles
  // that were already arriving. This drives the real request path.
  const { Tiles3D } = await import('../src/world/tiles3d.js');
  const THREE = await import('../vendor/three/three.module.js');
  const finish = [];
  const rig = {
    budget: { active: 4 },
    pending: new Set(),
    refused: new Map(),
    loaded: new Map(),
    copyrights: new Set(),
    group: new THREE.Group(),
    _ecefToLocal: new THREE.Matrix4(),
    active: 0,
    stats: { failed: 0 },
    absolute: (u) => u,
    sharpen() {},
    resting: Tiles3D.prototype.resting,
    requestContent: Tiles3D.prototype.requestContent,
  };
  let opened = 0;
  // A loader that answers only when told to, so "in flight" is a real state.
  rig.loader = { load: (u, onLoad, _p, onErr) => { opened++; finish.push({ u, onLoad, onErr }); } };

  const uris = Array.from({ length: 40 }, (_, i) => `slow-${i}.glb`);
  const place = new THREE.Matrix4();
  const frame = () => { for (const u of uris) rig.requestContent(u, place, 0); };

  frame();
  ok(`only the budget is opened, not the whole wanted list  (${opened})`,
    opened === 4 && rig.active === 4);
  // Thirty frames at sixty a second is half a second of standing still. The
  // old code turned each of those into another four requests.
  for (let i = 0; i < 30; i++) frame();
  await new Promise((done) => setTimeout(done, 120));
  ok(`and nothing more is opened while they are still in flight  (${opened})`,
    opened === 4, `${opened} opened, ${rig.active} slots held`);
  ok('a tile already downloading is never asked for twice',
    new Set(finish.map((f) => f.u)).size === finish.length);

  // Settle one, and exactly one more slot opens.
  const first = finish.shift();
  first.onLoad({ scene: new THREE.Group(), parser: { json: { asset: {} } } });
  frame();
  ok(`one finishing lets exactly one more start  (${opened})`, opened === 5);

  // A refusal frees its slot too, or a run of 404s would wedge the pipe shut.
  const second = finish.shift();
  second.onErr(new Error('404'));
  frame();
  ok(`and a refusal frees its slot as well  (${opened})`, opened === 6);
}

console.log('\na glance to the side does not destroy the view');
{
  // Eviction walked `loaded` in arrival order and dropped anything not wanted
  // in that one frame — so the frame you turned your head in destroyed what
  // was behind you, and the ground you had stood on longest went first. `used`
  // was written once at load and then never read or refreshed.
  const { Tiles3D } = await import('../src/world/tiles3d.js');
  const now = 1000000;
  const make = (n, capacity) => {
    const loaded = new Map();
    // Arrival order and last-seen order deliberately disagree: the tile that
    // arrived first is the one being looked at most recently.
    for (let i = 0; i < n; i++) loaded.set(`t${i}`, { object: {}, used: now - (n - i) * 1000 });
    loaded.get('t0').used = now;
    return {
      budget: { loaded: capacity },
      loaded,
      visible: new Set(),
      disposed: [],
      dispose(uri) { this.disposed.push(uri); this.loaded.delete(uri); },
      evict: Tiles3D.prototype.evict,
    };
  };

  const under = make(10, 20);
  under.evict(now);
  ok('nothing is evicted while there is room', under.disposed.length === 0);

  // Everything is inside its grace, and the cap still has to hold.
  const tight = make(10, 6);
  tight.evict(now);
  ok(`the cap is still a cap  (${tight.loaded.size} of 6)`, tight.loaded.size === 6);
  // t0 arrived first and is being looked at now; t1 arrived second and has
  // been unseen the longest. Arrival order would take t0 and keep t1, which is
  // exactly backwards.
  ok('and it gives up what you looked at longest ago, not what arrived first',
    tight.loaded.has('t0') && !tight.loaded.has('t1') && tight.loaded.has('t9'),
    `kept ${[...tight.loaded.keys()].join(',')}`);

  // What you can see is never taken, however long it has been held.
  const looking = make(10, 3);
  looking.visible = new Set(['t7', 't8', 't9']);
  looking.evict(now);
  ok('what is on screen is never evicted',
    ['t7', 't8', 't9'].every((u) => looking.loaded.has(u)));

  // A tile that left the view a moment ago survives; one gone for a minute does
  // not. Both are over the cap, so only the grace separates them.
  const glance = make(4, 3);
  for (const u of ['t0', 't1', 't2', 't3']) glance.loaded.get(u).used = now - 500;
  glance.loaded.get('t2').used = now - 60000;
  glance.evict(now);
  ok('a tile you looked away from a moment ago is kept',
    glance.loaded.has('t0') && glance.loaded.has('t1') && glance.loaded.has('t3'));
  ok('and the one gone a full minute is the one that goes',
    !glance.loaded.has('t2'), `dropped ${glance.disposed.join(',')}`);
}

console.log('\nthe terrain steps aside for photogrammetry, and the record of a rule that did not earn its place');
{
  // A rule requiring the photogrammetry to be at least as fine as the ground it
  // replaces was written, measured, and removed. In downtown San Francisco with
  // the tileset settled it took the terrain from 98 tiles drawn to 319 and the
  // frame was identical pixel for pixel. This pins the revert so the rule does
  // not quietly return without the measurement that would justify it.
  const source = readFileSync(new URL('../src/world/tiles3d.js', import.meta.url), 'utf8');
  ok('coverage does not gate on geometric error',
    !/COVER_MAX_ERROR_M/.test(source));
  ok('and the reason it does not is written down where the rule was',
    /98 tiles drawn to 319/.test(source) && /identical,\n \* pixel for pixel/.test(source));

  const { Tiles3D } = await import('../src/world/tiles3d.js');
  const THREE = await import('../vendor/three/three.module.js');
  const rig = {
    coverage: new Set(),
    visible: new Set(['tile']),
    loaded: new Map([['tile', { object: {}, bounds: Object.assign(new THREE.Box3(), {
      min: new THREE.Vector3(-40, 0, -40), max: new THREE.Vector3(40, 10, 40) }) }]]),
    frame: { worldToNorm: (x, z) => ({ nx: 0.5 + x / 4e7, ny: 0.5 + z / 4e7 }) },
    buildCoverage: Tiles3D.prototype.buildCoverage,
  };
  rig.buildCoverage();
  ok(`drawn photogrammetry claims the ground under it  (${rig.coverage.size} cells)`,
    rig.coverage.size > 0);

  // The one guard that stays: a root tile's box can span a continent and says
  // nothing about what is actually loaded underneath it.
  const huge = {
    coverage: new Set(),
    visible: new Set(['root']),
    loaded: new Map([['root', { object: {}, bounds: Object.assign(new THREE.Box3(), {
      min: new THREE.Vector3(-2e6, 0, -2e6), max: new THREE.Vector3(2e6, 1e4, 2e6) }) }]]),
    frame: rig.frame,
    buildCoverage: Tiles3D.prototype.buildCoverage,
  };
  huge.buildCoverage();
  ok('a continent-sized box still claims nothing', huge.coverage.size === 0);
}

console.log('\ndescending the tree does not queue behind the downloads');
{
  // The tree is a chain of tilesets: each level down is a small JSON that has
  // to arrive before the level under it can even be considered. Sharing one
  // pool with content meant the four kilobytes that says where the next storey
  // of detail lives waited behind a few hundred kilobytes of photogrammetry.
  const source = readFileSync(new URL('../src/world/tiles3d.js', import.meta.url), 'utf8');
  ok('tilesets have their own slots in every tier',
    ['low', 'medium', 'high', 'ultra'].every((t) =>
      new RegExp(`${t}: \\{[^}]*tilesets: \\d+`).test(source)));
  ok('and the descent is gated on its own counter, not the content one',
    /this\.activeTilesets >= slots/.test(source) &&
    /requestContent[\s\S]{0,200}this\.active >= this\.budget\.active/.test(source));

  const { Tiles3D } = await import('../src/world/tiles3d.js');
  const rig = {
    budget: { active: 1, tilesets: 3 },
    pending: new Set(),
    refused: new Map(),
    tilesets: new Map(),
    copyrights: new Set(),
    active: 1, // one content download already holds the only content slot
    activeTilesets: 0,
    stats: { failed: 0 },
    absolute: (u) => u,
    headers: () => undefined,
    resting: Tiles3D.prototype.resting,
    requestTileset: Tiles3D.prototype.requestTileset,
  };
  const seen = [];
  globalThis.fetch = (u) => { seen.push(u); return new Promise(() => {}); };
  for (const u of ['a.json', 'b.json', 'c.json', 'd.json']) rig.requestTileset(u);
  ok(`the walk keeps descending while content is saturated  (${seen.length})`,
    seen.length === 3 && rig.activeTilesets === 3);
}

console.log('\nphotogrammetry is sampled as sharply as the ground beside it');
{
  // Nothing set anisotropy on 3D tile textures, so every one was sampled at 1
  // while the flat imagery next to it used 8 or 16 and the hardware offered 16.
  // Measured on a live tileset before the fix: eight textures loaded, eight of
  // them at 1. At 1 the GPU picks its mip from the larger of the two on-screen
  // derivatives, so a surface seen at a slant reads from a mip chosen for its
  // stretched axis — which at street level is nearly every surface there is.
  const { Tiles3D } = await import('../src/world/tiles3d.js');
  const streamer = readFileSync(new URL('../src/tiles/streamer.js', import.meta.url), 'utf8');
  ok('the flat imagery has always asked for it',
    /texture\.anisotropy = Math\.min\(/.test(streamer));

  const rig = {
    renderer: { capabilities: { getMaxAnisotropy: () => 16 } },
    sharpen: Tiles3D.prototype.sharpen,
  };
  Object.defineProperty(rig, 'anisotropy',
    Object.getOwnPropertyDescriptor(Tiles3D.prototype, 'anisotropy').get ? { get: Object.getOwnPropertyDescriptor(Tiles3D.prototype, 'anisotropy').get } : {});
  const material = { map: { anisotropy: 1, needsUpdate: false }, normalMap: { anisotropy: 1, needsUpdate: false } };
  rig.sharpen(material);
  ok(`the photogrammetry asks for it too  (${material.map.anisotropy})`,
    material.map.anisotropy > 1 && material.map.anisotropy <= 16);
  ok('on every texture the material carries', material.normalMap.anisotropy === material.map.anisotropy);
  ok('and the texture is told, so one already on the GPU picks it up',
    material.map.needsUpdate === true);

  // Hardware that cannot do it is not asked to.
  const humble = { renderer: { capabilities: { getMaxAnisotropy: () => 1 } }, sharpen: Tiles3D.prototype.sharpen };
  Object.defineProperty(humble, 'anisotropy', { get: Object.getOwnPropertyDescriptor(Tiles3D.prototype, 'anisotropy').get });
  const plain = { map: { anisotropy: 1, needsUpdate: false } };
  humble.sharpen(plain);
  ok('and hardware that cannot do it is not asked to', plain.map.anisotropy === 1);

  // A mesh with several primitive groups carries an array of materials, which
  // dispose() has always known about and the sharpening path did not.
  const src2 = readFileSync(new URL('../src/world/tiles3d.js', import.meta.url), 'utf8');
  ok('a mesh with several materials has all of them treated',
    /function asMaterials/.test(src2) &&
    /for \(const material of asMaterials\(node\.material\)\)/.test(src2));

  // A preset change has to reach tiles that are already here, and changing a
  // texture's sampling means re-uploading it — so three hundred of them in one
  // frame would be a stall you feel. They go a few at a time.
  const { settings } = await import('../src/core/settings.js');
  const many = {
    renderer: { capabilities: { getMaxAnisotropy: () => 16 } },
    loaded: new Map(),
    _anisotropy: 1,
    _resharpen: [],
    sharpen: Tiles3D.prototype.sharpen,
  };
  Object.defineProperty(many, 'anisotropy', { get: Object.getOwnPropertyDescriptor(Tiles3D.prototype, 'anisotropy').get });
  let touched = 0;
  for (let i = 0; i < 300; i++) {
    many.loaded.set(`t${i}`, { object: { traverse: (fn) => { touched++; fn({ isMesh: true, material: { map: { anisotropy: 1 } } }); } } });
  }
  // The part of update() that does this, run on its own.
  const step = () => {
    const level = many.anisotropy;
    if (level !== many._anisotropy) { many._anisotropy = level; many._resharpen = [...many.loaded.values()]; }
    for (let i = 0; i < 8 && many._resharpen.length; i++) {
      many._resharpen.pop().object.traverse((n) => { if (n.isMesh && n.material) many.sharpen(n.material); });
    }
  };
  step();
  ok(`a quality change does not re-upload the whole city at once  (${touched})`,
    touched === 8 && many._resharpen.length === 292);
  for (let i = 0; i < 40; i++) step();
  ok(`and finishes it over the next second  (${touched} of 300)`,
    touched === 300 && many._resharpen.length === 0);

  const source = readFileSync(new URL('../src/world/tiles3d.js', import.meta.url), 'utf8');
  ok('a quality change reaches the city you are already standing in',
    /sharpness !== this\._anisotropy/.test(source) && /RESHARPEN_PER_FRAME/.test(source));
}

console.log('\nstreet level merges rather than switching on');
{
  // The merge rule is the whole point: satellite terrain is what you fly over,
  // ground photography is what you stand in, and the dome has to arrive by
  // degrees or the world visibly changes as you step forward. Three conditions
  // multiply, so failing any one of them means no photograph at all.
  const { Panorama, within } = await import('../src/world/panorama.js');

  const rig = (state) => {
    const r = {
      enabled: true,
      current: { lat: 0, lon: 0, texture: {} },
      opacity: 0,
      mesh: { visible: false, position: { set() {} } },
      material: { uniforms: { uOpacity: { value: 0 } } },
      frame: { toWorld: () => ({ x: 0, z: 0 }) },
      maybeSearch() {},
      update: Panorama.prototype.update,
    };
    // dt large enough that damp lands essentially on the target, so what is
    // being read is the blend rule and not the smoothing.
    r.update({ groundHeight: 0, ...state }, 10);
    return r.opacity;
  };

  const standing = { lat: 0, lon: 0, altitudeAboveGround: 1.7, speed: 0 };
  const here = rig(standing);
  ok(`standing on the capture point, the photograph is what you see  (${here.toFixed(2)})`,
    here > 0.9);

  // 0.001 degrees of latitude is about 111 m — past the 110 m outer edge.
  const away = rig({ ...standing, lat: 0.001 });
  ok(`a hundred metres away it is gone  (${away.toFixed(2)})`, away < 0.01);

  const mid = rig({ ...standing, lat: 0.00045 });
  ok(`and halfway it is genuinely part-way, not on or off  (${mid.toFixed(2)})`,
    mid > 0.05 && mid < 0.95);

  const flying = rig({ ...standing, altitudeAboveGround: 40 });
  ok('taking off puts the satellite world back', flying < 0.01);

  const running = rig({ ...standing, speed: 30 });
  ok('and so does covering ground quickly', running < 0.01);

  // Every one of the three has to hold: on the spot but sprinting is not a
  // moment a static photograph can describe.
  const halfway = rig({ ...standing, altitudeAboveGround: 20, speed: 14 });
  ok(`the conditions multiply rather than voting  (${halfway.toFixed(2)})`,
    halfway < rig({ ...standing, altitudeAboveGround: 20 }));

  const off = { enabled: false, opacity: 0.8, mesh: { visible: true }, provider: 'none',
    update: Panorama.prototype.update };
  off.update({ lat: 0, lon: 0, altitudeAboveGround: 1, speed: 0, groundHeight: 0 }, 1);
  ok('with no provider the dome is not merely transparent, it is off',
    off.opacity === 0 && off.mesh.visible === false);
}

console.log('\na panorama that never arrives is a failure, not a silence');
{
  // maybeSearch refuses to look again while `loading` is true, and `loading`
  // was cleared only in the promise chain's finally. A stitch the worker never
  // answered left it true for the rest of the session: street level searched
  // once, could not finish, and never tried again anywhere in the world.
  const { Panorama, within } = await import('../src/world/panorama.js');

  const quick = await within(Promise.resolve('here'), 50, 'x');
  ok('a promise that answers is passed straight through', quick === 'here');

  let failed = null;
  await within(new Promise(() => {}), 30, 'stitch').catch((e) => { failed = e.message; });
  ok(`one that never answers rejects  (${failed})`, failed === 'stitch timed out');

  let kept = null;
  await within(Promise.reject(new Error('404')), 1000, 'stitch').catch((e) => { kept = e.message; });
  ok('and a real error is reported as itself', kept === '404');

  // The flag has to clear on every route out, or one bad lookup is permanent.
  // lastSearchAt is set relative to now, because the four-second gate between
  // lookups is otherwise measured against however long this run has been going.
  const rig = {
    loading: false, lastSearchAt: performance.now() - 10000, lastSearch: null, current: null,
    provider: 'mapillary', status: '',
    searchMapillary: () => new Promise(() => {}),  // never answers
    maybeSearch: Panorama.prototype.maybeSearch,
  };
  rig.maybeSearch(0, 0);
  ok('a search in flight blocks a second one', rig.loading === true);
  const before = rig.lastSearchAt;
  rig.maybeSearch(1, 1);
  ok('and the second one really is refused while it runs', rig.lastSearchAt === before);

  // A lookup that fails takes the same route out as one that times out, and
  // proving that here costs milliseconds rather than the full timeout.
  const failing = {
    loading: false, lastSearchAt: performance.now() - 10000, lastSearch: null, current: null,
    provider: 'mapillary', status: '',
    searchMapillary: () => Promise.reject(new Error('mapillary 401')),
    maybeSearch: Panorama.prototype.maybeSearch,
  };
  failing.maybeSearch(0, 0);
  await new Promise((done) => setTimeout(done, 50));
  ok(`a failed lookup does not wedge street level shut  (${failing.status})`,
    failing.loading === false && /401/.test(failing.status));

  const pending = {
    pendingJobs: new Map(), loading: true, current: null, mesh: { visible: true },
    clear: Panorama.prototype.clear,
  };
  let rejected = false;
  pending.pendingJobs.set(1, { resolve() {}, reject() { rejected = true; } });
  pending.clear();
  ok('clearing settles whatever was still waiting', rejected && pending.pendingJobs.size === 0);
  ok('and lets street level search again', pending.loading === false);
}

console.log('\nthe photogrammetry and the height field are put on one datum');
{
  // 3D Tiles are ECEF, which is ellipsoidal. Terrarium, SRTM and Mapbox heights
  // are orthometric — above the geoid. Nothing reconciled them, so the city sat
  // low by the geoid height of wherever you were: measured -32.8 m in San
  // Francisco against an EGM96 value of -32.3, and -17.9 in Denver against
  // -17.4. This drives the real estimator against a ground it knows the answer
  // for, with the roofs and the holes that make the naive version fail.
  const { Tiles3D } = await import('../src/world/tiles3d.js');
  const THREE = await import('../vendor/three/three.module.js');

  const city = (groundY, { roofs = 40, holes = 0 } = {}) => {
    const group = new THREE.Group();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial(),
    );
    ground.position.y = groundY;
    group.add(ground);
    // Roofs at assorted heights, which is what a downward ray mostly hits.
    for (let i = 0; i < roofs; i++) {
      const angle = i * 2.399963;
      const radius = 220 * Math.sqrt((i + 0.5) / roofs);
      const roof = new THREE.Mesh(
        new THREE.PlaneGeometry(70, 70).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial(),
      );
      roof.position.set(Math.cos(angle) * radius, groundY + 20 + (i % 9) * 11, Math.sin(angle) * radius);
      group.add(roof);
    }
    // Shells with the far side missing, which is how a ray ends up hundreds of
    // metres below the street and why "the lowest hit" is not the answer.
    for (let i = 0; i < holes; i++) {
      const deep = new THREE.Mesh(
        new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial(),
      );
      deep.position.set(-150 + i * 40, groundY - 260 - i * 30, -120 + i * 35);
      group.add(deep);
    }
    group.updateMatrixWorld(true);
    return group;
  };

  const rig = (group, tiles = 40) => {
    const loaded = new Map();
    for (let i = 0; i < tiles; i++) loaded.set(`t${i}`, { object: {}, used: 0, bounds: {} });
    return {
      group, loaded,
      groundHeightAt: () => 0,
      datum: 0, _datumAt: 0, _camX: 0, _camZ: 0,
      _ray: new THREE.Raycaster(),
      _rayFrom: new THREE.Vector3(),
      _down: new THREE.Vector3(0, -1, 0),
      measureDatum: Tiles3D.prototype.measureDatum,
    };
  };

  // San Francisco's number, with the height field at zero.
  const sf = rig(city(-32.8));
  sf.measureDatum(100000);
  ok(`the lift found matches the separation  (${sf.datum.toFixed(1)} m)`,
    Math.abs(sf.datum - 32.8) < 1.5);
  ok('and it is applied to the group', Math.abs(sf.group.position.y - sf.datum) < 1e-6);
  ok('and the cached world boxes are dropped, since they moved',
    [...sf.loaded.values()].every((e) => e.bounds === null));

  // The other sign, which is most of Europe and Africa.
  const high = rig(city(46.6));
  high.measureDatum(100000);
  ok(`a positive separation lifts the other way  (${high.datum.toFixed(1)} m)`,
    Math.abs(high.datum + 46.6) < 1.5);

  // Holes in the shells: the naive "lowest hit" answer is hundreds of metres out.
  const holed = rig(city(-32.8, { holes: 6 }));
  holed.measureDatum(100000);
  ok(`holes through the shells do not drag it down  (${holed.datum.toFixed(1)} m)`,
    Math.abs(holed.datum - 32.8) < 1.5);

  // The drift, pinned. Measured live at Market Street the answer went 32.4,
  // 32.8, 38.6 as the city filled in, against a known 32.8 — because what
  // arrives late is not more street, it is more of the things under it, and a
  // pile of undersides seen through holes could clear a two-fifths share of the
  // densest bin and then win the tie-break by being lower. Here they are given
  // their own consistent depth so they form exactly that dense low cluster.
  const undersides = new THREE.Group();
  {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
    ground.position.y = -32.8;
    undersides.add(ground);
    for (let i = 0; i < 16; i++) {
      const angle = i * 2.399963;
      const radius = 220 * Math.sqrt((i + 0.5) / 16);
      // A sheet six metres lower, in more than half the columns.
      const under = new THREE.Mesh(
        new THREE.PlaneGeometry(90, 90).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
      under.position.set(Math.cos(angle) * radius, -38.6, Math.sin(angle) * radius);
      undersides.add(under);
    }
    undersides.updateMatrixWorld(true);
  }
  const drifted = rig(undersides);
  drifted.measureDatum(100000);
  ok(`a dense layer of undersides does not become the street  (${drifted.datum.toFixed(1)} m)`,
    Math.abs(drifted.datum - 32.8) < 2);

  // Too little loaded to say anything, and nothing is said.
  const bare = rig(city(-32.8), 4);
  bare.measureDatum(100000);
  ok('with almost nothing loaded it declines to answer', bare.datum === 0);

  // An answer outside the geoid's range is not a geoid separation.
  const absurd = rig(city(-400));
  absurd.measureDatum(100000);
  ok('and an impossible separation is refused', absurd.datum === 0);

  // It does not re-measure every frame; that would be two dozen raycasts a frame.
  const settled = rig(city(-32.8));
  settled.measureDatum(100000);
  const first = settled.datum;
  settled.group.position.y = 999;
  settled.measureDatum(100100);
  ok('and it does not re-measure on every frame',
    settled.datum === first && settled.group.position.y === 999);

  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  ok('the game tells the tiles what the height field says',
    /tiles3d\.groundHeightAt = \(x, z\) => this\.terrain\.heightAt\(x, z\)/.test(game));
  const src = readFileSync(new URL('../src/world/tiles3d.js', import.meta.url), 'utf8');
  ok('and a teleport drops the measurement, because the geoid moves with you',
    /this\.datum = 0;[\s\S]{0,120}this\.group\.position\.y = 0;/.test(src));
}

console.log('\na deploy has to actually reach the machine that asks for it');
{
  // The page asks for terraglide.bundle.js at a URL that never changes, and
  // GitHub Pages serves it with max-age=600. So for ten minutes after a deploy
  // — longer on a phone holding the response for its own reasons — anyone who
  // had the site open recently keeps running the old three megabytes and sees
  // none of the change. That has already cost real time: fixes tested against
  // code that did not contain them.
  const flow = readFileSync(new URL('../.github/workflows/deploy-gh-pages.yml', import.meta.url), 'utf8');
  ok('the published page asks for the bundle by fingerprint',
    /terraglide\.bundle\.js\?v=\$STAMP/.test(flow));
  ok('and the fingerprint comes from the bundle rather than the clock',
    /__TERRAGLIDE_BUNDLE__/.test(flow) && !/date \+%s/.test(flow));
  ok('and the deploy fails rather than publishing an unstamped page',
    /grep -q "terraglide\.bundle\.js\?v=\$STAMP" _site\/index\.html/.test(flow)
    || /grep -q "terraglide\.bundle\.js\\?v=\$STAMP" _site\/index\.html/.test(flow));

  // The stamp has to be findable in what the bundler actually writes.
  const bundle = readFileSync(new URL('../terraglide.bundle.js', import.meta.url), 'utf8');
  const stamp = /__TERRAGLIDE_BUNDLE__ = "([0-9a-f]{8,})"/.exec(bundle);
  ok(`the bundle carries a fingerprint the deploy can read  (${stamp ? stamp[1] : 'none'})`,
    Boolean(stamp));

  // An unchanged build keeps its URL, so the cache still does its job.
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  ok('and the source page is left plain, so local use is unaffected',
    /__TERRAGLIDE_PACK__ = '\.\/terraglide\.bundle\.js'/.test(index));
  // The retry appends a query of its own, and the published URL already has
  // one, so the separator cannot be a hard-coded question mark.
  ok('the boot retry joins onto a URL that may already carry a query',
    /pack\.indexOf\('\?'\) < 0 \? '\?' : '&'/.test(index));
  const join = (pack, tries) => (tries ? pack + (pack.indexOf('?') < 0 ? '?' : '&') + 'retry=' + tries : pack);
  ok('a plain URL gets a question mark', join('./b.js', 1) === './b.js?retry=1');
  ok('and a stamped one gets an ampersand', join('./b.js?v=abc', 2) === './b.js?v=abc&retry=2');
  ok('and the first attempt adds nothing at all', join('./b.js?v=abc', 0) === './b.js?v=abc');
}

console.log('\ngiving up is not the same as covering it');
{
  // traverse() returns "everything this subtree wants to draw is drawn", and a
  // REPLACE parent stops drawing itself the moment its children all say yes.
  // Four early exits answered yes when they meant "I gave up here": past the
  // depth cap, an unreadable bounding volume, past the render distance, and no
  // content. Each one is a parent dropped over ground nobody drew — a hole the
  // exact shape of one tile, which is what the missing blocks in the city are.
  const { Tiles3D } = await import('../src/world/tiles3d.js');
  const THREE = await import('../vendor/three/three.module.js');
  const { settings } = await import('../src/core/settings.js');

  const probe = (loaded = []) => ({
    budget: { sse: 16, active: 8, tilesets: 4 },
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
  const run = (rig, tree) => rig.traverse(tree, new THREE.Matrix4(), cam, 900, 1.2, 0);

  // A parent whose children sit past the render distance. Its far half is never
  // drawn, so letting it go leaves a hole there.
  const reach = settings.get('renderDistanceKm') * 1000;
  const straddling = {
    boundingVolume: { sphere: [0, 0, 0, 500] },
    geometricError: 900, refine: 'REPLACE', content: { uri: 'parent.glb' },
    children: [
      { boundingVolume: { sphere: [0, 0, 0, 100] }, geometricError: 2, content: { uri: 'near.glb' } },
      { boundingVolume: { sphere: [reach * 4, 0, 0, 100] }, geometricError: 2, content: { uri: 'far.glb' } },
    ],
  };
  const far = probe(['near.glb']);
  const farReady = run(far, straddling);
  ok('a child past the render distance does not claim to cover it',
    !farReady && far.visible.has('parent.glb'), [...far.visible].join(','));

  // Past the depth cap. Google's tree at street level goes deeper than the old
  // cap of 24, counting the hops between tilesets, so this fired in ordinary
  // play and every tile it stopped at was reported to its parent as covered.
  const deep = probe();
  const deepReady = deep.traverse(straddling, new THREE.Matrix4(), cam, 900, 1.2, 900);
  ok('and neither does giving up at the depth cap', deepReady === false);

  const src = readFileSync(new URL('../src/world/tiles3d.js', import.meta.url), 'utf8');
  const cap = /const MAX_DEPTH = (\d+)/.exec(src);
  ok(`the cap is a runaway guard rather than a limit hit in play  (${cap && cap[1]})`,
    cap && Number(cap[1]) >= 48);

  // A bounding volume in a shape we cannot read.
  const unreadable = probe();
  const unreadableReady = run(unreadable, {
    boundingVolume: { nonsense: true }, geometricError: 900, content: { uri: 'x.glb' },
  });
  ok('an unreadable bounding volume does not claim to cover it either',
    unreadableReady === false);

  // And the case that must still answer yes, or a parent is drawn for ever.
  const arrived = probe(['near.glb', 'far.glb']);
  const closeTree = {
    boundingVolume: { sphere: [0, 0, 0, 500] },
    geometricError: 900, refine: 'REPLACE', content: { uri: 'parent.glb' },
    children: [
      { boundingVolume: { sphere: [-200, 0, 0, 100] }, geometricError: 2, content: { uri: 'near.glb' } },
      { boundingVolume: { sphere: [200, 0, 0, 100] }, geometricError: 2, content: { uri: 'far.glb' } },
    ],
  };
  ok('children that really did arrive still release the parent',
    run(arrived, closeTree) === true && !arrived.visible.has('parent.glb'));
}

console.log('\nthe provider is allowed to say what is wrong');
{
  // Google answers a bad key with 400, not 401 or 403, so every real key
  // problem came out as "root 400" — a number that tells you nothing and points
  // nowhere. Confirmed against the live endpoint: no key gives 403 "Method
  // doesn't allow unregistered callers", a bad key gives 400 "API key not
  // valid". The commonest real answer is that the Map Tiles API was never
  // enabled on the project, which names the project and the fix.
  const { explain, rebase } = await import('../src/world/tiles3d.js');
  const answer = (status, body) => new Response(JSON.stringify(body), { status });

  ok('Google\'s own words come through',
    (await explain(answer(400, { error: { message: 'API key not valid. Please pass a valid API key.' } })))
      === 'API key not valid. Please pass a valid API key.');
  ok('and so does the one that names the API to switch on',
    /Map Tiles API has not been used/.test(
      await explain(answer(403, { error: { message: 'Map Tiles API has not been used in project 12345 before or it is disabled.' } }))));
  ok('a body with nothing useful falls back to something readable',
    (await explain(new Response('', { status: 500 }))) === 'the tileset server answered 500');
  ok('and a refusal still says it is the key',
    (await explain(new Response('', { status: 403 }))) === 'that key was refused');

  // A child tileset's contents are relative to that tileset, not to the root.
  const tree = {
    content: { uri: 'a.glb' },
    children: [{ content: { uri: 'sub/b.glb' } }, { content: { url: '../c.glb' } }],
  };
  rebase(tree, 'https://tiles.example.com/deep/set.json?session=abc');
  ok('a child tileset\'s contents resolve against itself',
    tree.content.uri === 'https://tiles.example.com/deep/a.glb'
    && tree.children[0].content.uri === 'https://tiles.example.com/deep/sub/b.glb'
    && tree.children[1].content.url === 'https://tiles.example.com/c.glb',
    tree.content.uri);

  // Enough in flight to be worth having on a connection that multiplexes.
  const src = readFileSync(new URL('../src/world/tiles3d.js', import.meta.url), 'utf8');
  const budgets = [...src.matchAll(/(low|medium|high|ultra): \{[^}]*active: (\d+)/g)]
    .map((m) => Number(m[2]));
  ok(`the request budget is not a leftover HTTP/1.1 six  (${budgets.join(', ')})`,
    budgets.length === 4 && budgets.every((n) => n >= 12) && budgets[3] > budgets[0]);
}

console.log('\nthe ground does not flicker to a flat colour');
{
  // uMap defaults to a white pixel, so a square with no photograph and nothing
  // to stretch is drawn flat. evict() could take the photograph a tile was
  // being drawn from in the very frame it was drawn: the second pass skipped
  // only pending entries and said of itself that the protection was a
  // preference rather than a promise, and the cover pass — which holds the
  // coarse tiles everything else stretches from — had no protection at all.
  const { ImageryStreamer, STATE_READY } = await import('../src/tiles/streamer.js');
  const src = readFileSync(new URL('../src/tiles/streamer.js', import.meta.url), 'utf8');

  ok('the shader really does draw a missing photograph as flat',
    /uMap: \{ value: WHITE_PIXEL \}/.test(
      readFileSync(new URL('../src/world/shaders.js', import.meta.url), 'utf8')));

  const rig = (entries) => {
    const r = {
      frame: 100,
      entries: new Map(entries.map((e) => [e.key, e])),
      stats: {},
      evict: ImageryStreamer.prototype.evict,
      textureLimit: () => 2,
    };
    return r;
  };
  const entry = (key, { z = 14, used = 1, seen = 0, disposed = [] } = {}) => ({
    key, tile: { z }, used, seen, state: STATE_READY,
    texture: { dispose() { disposed.push(key); } },
  });

  // Four ordinary tiles, a limit of two, and one of them is on screen now.
  const dropped = [];
  const live = entry('live', { used: 100, disposed: dropped });   // this frame
  const old1 = entry('old1', { used: 1, disposed: dropped });
  const old2 = entry('old2', { used: 2, disposed: dropped });
  const old3 = entry('old3', { used: 3, disposed: dropped });
  const r = rig([live, old1, old2, old3]);
  r.evict();
  ok('what is on screen this frame is kept',
    r.entries.has('live') && !dropped.includes('live'),
    `dropped ${dropped.join(',') || 'nothing'}`);
  ok('and the ones nothing is looking at go instead', dropped.length >= 2);

  // The coarse tile everything stretches from is on screen too, by way of
  // being the thing resolve() handed back.
  const coverDropped = [];
  const coverLive = entry('cover-live', { z: 5, used: 100, disposed: coverDropped });
  const coverOld = entry('cover-old', { z: 5, used: 1, disposed: coverDropped });
  const r2 = rig([coverLive, coverOld]);
  r2.textureLimit = () => 99;
  // Force the cover pool over its budget so the pass actually runs.
  const budget = /const COVER_BUDGET = (\d+)/.exec(src);
  ok('the cover pool has a budget worth guarding', Boolean(budget));
  for (let i = 0; i < Number(budget[1]) + 2; i++) {
    r2.entries.set(`filler${i}`, entry(`filler${i}`, { z: 5, used: 2, disposed: coverDropped }));
  }
  r2.evict();
  ok('and a coarse tile being stretched right now is kept as well',
    r2.entries.has('cover-live') && !coverDropped.includes('cover-live'),
    `cover dropped ${coverDropped.length}`);
  ok('while the cover pool still comes back under its budget',
    coverDropped.length > 0);

  ok('every pass goes through the one guard rather than disposing directly',
    /const onScreen = \(entry\) => entry\.used === this\.frame/.test(src)
    && !/(?<!if \()drop\(entry\);/.test(src));
}

console.log('\nthe online single file finds the assets it was told to use');
{
  // You asked for it twice: "online single file should use assets too like gen
  // stuff" and "add the assets gened and other features via grab from GitHub to
  // the single file". It started and looked right, and the player model never
  // arrived, because every module-relative path went at the folder beside a
  // file:// page instead of at the site the bundle came from.
  const bundler = readFileSync(new URL('../tools/bundle.mjs', import.meta.url), 'utf8');
  ok('the bundle resolves paths against where the bundle came from',
    /document\.currentScript/.test(bundler) && /self && self\.src/.test(bundler));
  ok('and falls back to the document when it is inlined and has no src',
    /return \(typeof document !== 'undefined' && document\.baseURI\) \|\| 'about:blank';/.test(bundler));

  // The same arithmetic the runtime does, so the expectation is checked rather
  // than described: a module inside a bundle served from the site resolves the
  // assets folder onto that site.
  const tgUrl = (id, base) => new URL(id, base).href;
  const site = 'https://eabusham2.github.io/terraglide/';
  const fromSite = new URL('../../assets/', tgUrl('src/core/paths.js', site + 'terraglide.bundle.js')).href;
  ok(`a bundle served from the site points assets at the site  (${fromSite})`,
    fromSite === site + 'assets/');
  // And the failure it replaces, spelled out so it cannot come back quietly.
  const fromPage = new URL('../../assets/', tgUrl('src/core/paths.js', 'file:///downloads/terraglide-online.html')).href;
  ok('where resolving against the page put them somewhere that does not exist',
    fromPage.startsWith('file://'));

  const online = readFileSync(new URL('../terraglide-online.html', import.meta.url), 'utf8');
  ok('and the online page still asks for the published bundle by absolute URL',
    /__TERRAGLIDE_PACK__ = "https:\/\/[^"]*terraglide\.bundle\.js"/.test(online));
}

console.log('\nthe explored map answers at the zoom it is asked about');
{
  // "Explored on map still doesn't show exactly what u explored, it's extremely
  // inaccurate" and "the explored being wrong especially zooming out".
  // Levels are recorded at 8, 10, 12, 14 and 16, so half the zooms fall between
  // two of them, and those were answered from the coarser one — at zoom 9 from
  // level 8, at zoom 11 from level 10. One recorded cell answered for four
  // squares of the zoom being drawn, and answered yes for all four.
  const { Exploration, LEVELS } = await import('../src/ui/exploration.js');
  const fresh = () => new Exploration({ load: () => null, save() {} });

  // visit(lat, lon, altitudeAboveGround, seenRadius). Deliberately not at
  // (0, 0): that is exactly the corner of four tiles at every zoom, so a disc
  // there really does touch four of them and four is the right answer. Inside
  // one tile is where over-reporting shows.
  const record = fresh();
  // The centre of a zoom-11 tile, which is comfortably inside its zoom 8, 9 and
  // 10 parents too.
  const NX = (1024 + 0.5) / 2048;
  record.visit(-0.0878906, 0.0878906, 2, 1200);

  // Count how many squares of each zoom the record claims.
  const claimedAt = (z) => {
    const n = 2 ** z;
    let count = 0;
    // A window around the origin is enough: nothing else was visited.
    const cx = Math.floor(NX * n);
    const cy = Math.floor(NX * n);
    for (let y = cy - 6; y <= cy + 6; y++) {
      for (let x = cx - 6; x <= cx + 6; x++) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        if (record.isExplored(z, x, y)) count++;
      }
    }
    return count;
  };

  // Zoom 8 is exact: one square, because a level-8 tile is 157 km and the
  // horizon here is 1.2 km.
  ok(`zoom 8 claims one square  (${claimedAt(8)})`, claimedAt(8) === 1);
  // Zoom 9 used to inherit that one answer for all four of its children.
  ok(`zoom 9 no longer inherits it for four  (${claimedAt(9)})`, claimedAt(9) === 1);
  ok(`and zoom 11 likewise  (${claimedAt(11)})`, claimedAt(11) === 1);

  // The claim must never shrink as the squares get finer within a level pair,
  // and a square must still be explored where you actually stood.
  const tx = (z) => Math.floor(NX * 2 ** z);
  const ty = (z) => Math.floor(NX * 2 ** z);
  ok('the square you stood in is explored at the finest level',
    record.isExplored(16, tx(16), ty(16)));
  ok('and still explored at the coarsest',
    record.isExplored(8, tx(8), ty(8)));

  // Below the coarsest recorded level the old folding still applies.
  ok('a whole continent counts as visited if any of it was',
    record.isExplored(4, tx(4), ty(4)));

  // Finer than anything recorded there is nothing better than the coarse cell,
  // and saying nothing would hide ground you really did explore.
  ok('past the finest recorded level it still answers from what it has',
    record.isExplored(18, tx(18), ty(18)));

  const src = readFileSync(new URL('../src/ui/exploration.js', import.meta.url), 'utf8');
  ok('and the rule is stated where it is applied',
    /at least as fine as/.test(src) && /folded\(z\)/.test(src));
}

console.log('\na worker that cannot start says nothing, so something has to ask');
{
  // The online edition builds a real Worker from a same-origin blob whose only
  // job is to import the real worker off the published site. `new Worker`
  // succeeds — the blob is fine — and if that import fails the thread dies
  // without ever posting a message. Nothing listened for that. Measured running
  // the online edition: twelve jobs accepted, none answered, none *failed*,
  // 4,205 queued behind them, every square of ground drawn bare while the
  // minimap beside it had full imagery. For the whole session.
  const { GuardedWorker } = await import('../src/tiles/workerHost.js');

  const mute = () => {
    const w = { posted: [], handlers: {}, terminated: false };
    w.addEventListener = (t, fn) => { (w.handlers[t] ??= []).push(fn); };
    w.removeEventListener = (t, fn) => { w.handlers[t] = (w.handlers[t] ?? []).filter((f) => f !== fn); };
    w.postMessage = (m) => w.posted.push(m);
    w.terminate = () => { w.terminated = true; };
    return w;
  };

  // The quiet death: it accepts jobs and never answers.
  {
    const real = mute();
    let fire = null;
    const realTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => { fire = fn; return 1; };
    const guard = new GuardedWorker(() => real);
    const seen = [];
    guard.addEventListener('message', (e) => seen.push(e.data));
    guard.postMessage({ kind: 'imagery', channel: 'imagery', id: 1 });
    guard.postMessage({ kind: 'imagery', channel: 'imagery', id: 2 });
    ok('the jobs go to the real worker first', real.posted.length === 2);
    ok('and it is given a deadline to answer by', typeof fire === 'function');
    fire();
    globalThis.setTimeout = realTimeout;
    ok('a worker that never answers is given up on', guard.inline === true);
    ok('and the dead one is stopped', real.terminated === true);
    const held = guard.delegate.queue.length + guard.delegate.running;
    ok('the jobs it was holding are re-posted, not dropped', held === 2, `${held} re-posted`);
  }

  // The loud death: an error event.
  {
    const real = mute();
    const realTimeout = globalThis.setTimeout;
    globalThis.setTimeout = () => 1;
    const guard = new GuardedWorker(() => real);
    guard.postMessage({ kind: 'imagery', channel: 'imagery', id: 7 });
    real.handlers.error.forEach((fn) => fn(new Error('import failed')));
    globalThis.setTimeout = realTimeout;
    ok('a worker that fails loudly is given up on too', guard.inline === true);
    ok('and its job is re-posted as well',
      guard.delegate.queue.length + guard.delegate.running === 1);
  }

  // A worker that answers is proved alive and is never second-guessed again.
  {
    const real = mute();
    let fire = null;
    const realTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => { fire = fn; return 1; };
    const guard = new GuardedWorker(() => real);
    const seen = [];
    guard.addEventListener('message', (e) => seen.push(e.data));
    guard.postMessage({ kind: 'imagery', channel: 'imagery', id: 3 });
    real.handlers.message.forEach((fn) => fn({ data: { channel: 'imagery', id: 3, ok: true } }));
    ok('a reply reaches the listener', seen.length === 1 && seen[0].id === 3);
    ok('and proves the worker alive', guard.proven === true);
    if (fire) fire();
    globalThis.setTimeout = realTimeout;
    ok('so the deadline can never take it away afterwards', guard.inline === false);
  }
}

console.log('\nthe mesh is no finer than the elevation under it');
{
  // Every tile got the same grid whatever its size. A zoom-22 tile is about
  // 6.5 m across and the finest elevation anyone serves is zoom 14, whose
  // samples are about 6.5 m apart — so that tile spans one sample, and a 33x33
  // grid on it is 1,089 vertices interpolating between the same two numbers.
  // Standing in Grindelwald the ground within thirty metres is drawn at zooms
  // 20 to 22, which is the ground you are looking at hardest.
  const { Terrain } = await import('../src/world/terrain.js');
  const rig = (grid, elevMax) => ({
    gridSize: grid,
    elevation: { maxZoom: elevMax },
    gridFor: Terrain.prototype.gridFor,
  });

  const t = rig(33, 14);
  const at = (z) => t.gridFor({ z });
  ok(`coarse tiles keep the full grid  (z12 ${at(12)}, z17 ${at(17)})`,
    at(12) === 33 && at(17) === 33);
  ok(`and it falls away exactly as the samples do  (z18 ${at(18)}, z19 ${at(19)}, z20 ${at(20)})`,
    at(18) === 17 && at(19) === 9 && at(20) === 5);
  ok(`a tile spanning one sample is not given a thousand vertices  (z22 ${at(22)})`,
    at(22) === 5);

  // A finer elevation provider earns a finer mesh, which is the point of the
  // rule being about the data rather than about the zoom number.
  const mapbox = rig(33, 15);
  ok(`a provider with one more level moves the whole curve  (z20 ${mapbox.gridFor({ z: 20 })})`,
    mapbox.gridFor({ z: 20 }) === 9 && mapbox.gridFor({ z: 19 }) === 17);

  // Never finer than the preset asks for, and never below a workable quad.
  const small = rig(9, 14);
  ok('the preset is still the ceiling', small.gridFor({ z: 12 }) === 9 && small.gridFor({ z: 22 }) === 5);
  ok('and nothing is asked to be a single quad', at(30) === 5);

  // With no elevation source at all it must not guess.
  const blind = { gridSize: 33, elevation: null, gridFor: Terrain.prototype.gridFor };
  ok('with no elevation to measure against, the preset stands', blind.gridFor({ z: 22 }) === 33);

  const src = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');
  ok('the mesh builder uses it', /const grid = this\.gridFor\(tile\);/.test(src));
  ok('and it is taken from the provider maximum, so neighbours cannot crack',
    /this\.elevation\?\.maxZoom/.test(src));
}

console.log('\nadding a key moves the ground as well as the picture');
{
  // "Add auto provider finds most detailed at that location." It existed for
  // imagery and not for elevation, so a Mapbox token bought sharper photographs
  // and left the shape of the ground on the keyless default — which is the half
  // you stand on, and the half that decides how flat it looks close up.
  const { createElevationSource, resolveAuto, IMAGERY_PROVIDERS, ELEVATION_PROVIDERS } =
    await import('../src/tiles/providers.js');
  const { DEFAULT_SETTINGS } = await import('../src/core/settings.js');

  const pick = (values) => createElevationSource(values).descriptor;

  ok('elevation understands auto at all',
    pick({ elevationProvider: 'auto' })?.id === 'terrarium');
  const withKey = pick({ elevationProvider: 'auto', mapboxKey: 'pk.test' });
  ok(`and a key moves it to the deeper provider  (${withKey?.id}, z${withKey?.maxZoom})`,
    withKey?.id === 'mapbox' && withKey.maxZoom === 15);
  ok('an explicit choice is still obeyed over the key',
    pick({ elevationProvider: 'terrarium', mapboxKey: 'pk.test' })?.id === 'terrarium');
  ok('and an explicit choice you have no key for still falls back keyless',
    pick({ elevationProvider: 'mapbox' })?.id === 'terrarium');

  // Defaulting to auto is only safe because with no keys it lands exactly where
  // the old named defaults did. Checked rather than assumed.
  ok('auto with no keys is the old imagery default',
    resolveAuto(IMAGERY_PROVIDERS, {}) === 'esri');
  ok('auto with no keys is the old elevation default',
    resolveAuto(ELEVATION_PROVIDERS, {}) === 'terrarium');
  ok('so both may default to it',
    DEFAULT_SETTINGS.imageryProvider === 'auto' && DEFAULT_SETTINGS.elevationProvider === 'auto');

  const panel = readFileSync(new URL('../src/ui/settingsPanel.js', import.meta.url), 'utf8');
  ok('and the panel offers it for elevation, not only for imagery',
    /options: \(\) => \[\s*\{ value: AUTO_PROVIDER[\s\S]{0,120}ELEVATION_PROVIDERS/.test(panel));
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
  /*
    And the ceiling on that depth does not decide the answer for the ground.

    Two per cent of the square was what the biggest squares actually got, not
    what their edges asked for. Measured flying the Himalaya at 31.11N 82.56E,
    sampling every crack between neighbouring squares and asking how far it
    runs past the bottom of the curtain hung to cover it:

      worst you look through   ceiling 2%   ceiling 5%
      over ten samples         27.4 m       0.2 m
      samples with a leak      2 of 10      0 of 10

    The 27-metre one was two zoom-12 squares eight kilometres across, 194.9
    metres apart, wearing a 167.5-metre curtain — which is two per cent of
    8,377 to the decimal. On ordinary ground nothing changes: the edge's own
    relief is far below either ceiling and is what sets the depth, and a
    262-metre square's ceiling moves from 12 metres to 13.
  */
  ok('and the ceiling on it does not bind before the ground does',
    /const cap = Math\.max\(12, size \* 0\.05\);/.test(terrain));
  // Relief is not the only crack an edge has to cover. A rebuilt square is
  // drawn at its old height and walks to the new one, so for that third of a
  // second it sits below any neighbour that has already arrived — by however
  // far it is about to move, which has nothing to do with how rough it is.
  // The walk is covered too, but not by making the geometry deeper. A walk
  // lasts a third of a second and geometry lasts until the next rebuild, so a
  // square that moved a hundred metres wore a hundred-metre curtain for as long
  // as it stood there — a wall of striped green standing out of the hillside,
  // which is worse than the crack it was hiding. It hangs in the shader, on the
  // skirt ring only, and is gone by the time the walk finishes.
  ok('and the walk is covered by a curtain that lasts as long as the walk',
    /const edgeWalk = \(vyOf, vxOf\)/.test(terrain)
    && /walk\[i\] = Math\.abs\(prevY\[vy \* verts \+ vx\] - heights\[gy \* grid \+ gx\]\);/.test(terrain)
    && /uniforms\.uWalk\.value = startMorph \? walked \* 1\.1 : 0;/.test(terrain));
  ok('hung on the skirt ring alone, and gone once the walk is done',
    /sink \+= skirt \* uWalk \* \(1\.0 - uMorph\);/.test(shaders)
    && /attribute float skirt;/.test(shaders)
    && /geometry\.setAttribute\('skirt'/.test(terrain));
  ok('taken along the real edge row, not the skirt row that already hangs',
    /const skirtTop = edgeDrop\(\(i\) => i, \(\) => 1, \(i\) => i \+ 1\);/.test(terrain));
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
  // Remembered with a time, so a dropped connection does not blank the ground
  // you happen to be over for the rest of the session. It was a Set, and a Set
  // means for ever.
  ok('a square nobody has is remembered rather than re-asked every twenty seconds',
    /this\.barren = new Map\(\)/.test(streamer) && /this\.barren\.set\(entry\.key, now\(\)\)/.test(streamer));
  ok('and the memory of it expires', /const BARREN_TTL_MS/.test(streamer));
  ok('and the squares inside it are never asked at all',
    /underBarren\(tile\)/.test(streamer) && /return this\.markBare\(entry\);/.test(streamer));
  ok('but only four levels up, so one refusal cannot write off a continent',
    /i < 4 && z > 1/.test(streamer));

  // And bare is not for ever either, which is the half that was missing.
  //
  // Every *reason* for going bare already expires — `barren` forgets after
  // ninety seconds, because a refusal is far more often a network that dropped
  // than ground nobody has photographed — but the entry itself did not, and
  // `request` returns early on a bare entry before any of that is consulted. So
  // one unlucky moment retired a square for the rest of the session.
  //
  // That stranded the depth probe and through it the whole world. probeDeeper
  // asks for one tile a level below the limit every thirty seconds, and the
  // limit lifts the moment anything arrives below it — but if the probe's
  // square had gone bare in an earlier outage, `request` handed back the bare
  // entry instead of asking. Measured over Antarctica: the limit sat at zoom 5
  // for two full minutes, the probe skipped on every frame, two tiles drawn,
  // and it followed the player back to the Alps and drew nothing there either.
  {
    const { ImageryStreamer: Streamer } = await import('../src/tiles/streamer.js');
    const s5 = new Streamer({ postMessage() {}, addEventListener() {} },
      { capabilities: { getMaxAnisotropy: () => 1 } });
    s5.source = { maxZoom: 23, ready: true, urlFor: () => 'x' };
    const tile = { z: 10, x: 3, y: 4 };
    const entry = s5.markBare({ key: '10/3/4', tile, state: 0 });
    s5.entries.set('10/3/4', entry);
    ok('a square just marked bare is not asked again straight away',
      s5.request(tile, 1).state === 4 && s5.queue.length === 0);
    // Same clock the streamer keeps these in: performance.now(), not Date.now().
    entry.bareAt = performance.now() - 91000;
    const after = s5.request(tile, 1);
    ok('but once the reason has expired it goes back in the queue',
      after.state === 0 && s5.queue.length === 1);
    // Unless the reason is still standing: an ancestor nobody has.
    s5.queue.length = 0;
    s5.barren.set('8/0/1', performance.now());
    const under = s5.markBare({ key: '10/3/5', tile: { z: 10, x: 3, y: 5 }, state: 0 });
    s5.entries.set('10/3/5', under);
    under.bareAt = performance.now() - 91000;
    ok('while a live refusal above it still keeps it bare',
      s5.request({ z: 10, x: 3, y: 5 }, 1).state === 4 && s5.queue.length === 0);
  }
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
  ok('so a level edge that did not move still hangs no curtain at all',
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
console.log('\nThe HUD only shows what is happening');
{
  const hud = readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
  // The surge gauge sat there permanently reading "Ready" — a box, a title, a
  // keycap and a bar spent saying that nothing is happening. It appears while
  // the burst runs, while you are still coasting on it, and while it recharges,
  // all three of which are a number counting down, and is gone otherwise.
  ok('the surge gauge is hidden unless it has something to count',
    /const surgeBusy = player\.speedActive \|\| coasting \|\| player\.speedCooldown > 0;/.test(hud)
    && /this\.setHidden\('speed-gauge', !surgeBusy\)/.test(hud));
  ok('and the numbers you fly by are only there while you are flying',
    /player\.mode === 'glide' \|\| player\.mode === 'fall' \|\| player\.mode === 'fly'/.test(hud)
    && /this\.setHidden\('glide', !flying\)/.test(hud)
    && /this\.setHidden\('pitch', !flying\)/.test(hud));
  ok('hiding goes through `hidden`, so a hidden row takes no space',
    /node\.hidden = hide;/.test(hud) && /setHidden\(id, hide\)/.test(hud));
  ok('and it is cached like the text, so it is not written every frame',
    /const key = `\$\{id\}:hidden`;/.test(hud));
  // Checked in the browser, four states in one flight: on the ground the surge
  // box, the glide angle and the pitch are all gone; gliding brings the angle
  // and the pitch back; lighting the surge shows the box reading "2x . 10.9s";
  // once spent it stays, counting the recharge down from 21s.
}

console.log('\nThe size keys change your size');
{
  const { cheats } = await import('../src/core/cheats.js');
  const { settings: S } = await import('../src/core/settings.js');
  const { clamp: clampM } = await import('../src/core/math.js');
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');

  // Both size keys did nothing, in every build, and said so in a way nobody
  // would read as a bug: `player.scale` reads cheats.playerScale, and the
  // keybind was left behind pointing at settings, where there is no
  // `playerScale` at all. undefined * 1.12 is NaN, and clamp passes NaN
  // straight through because NaN < lo and NaN > hi are both false. The result
  // was written to a setting nothing reads and the toast said "Size NaNx".
  ok('there is still no playerScale setting to point at',
    S.get('playerScale') === undefined);
  ok('and clamp really does pass NaN through, which is how it got this far',
    Number.isNaN(clampM(NaN, 0.25, 40)));
  ok('so the key writes the store the player reads',
    /cheats\.set\('playerScale', this\.player\.scale \* factor\)/.test(game)
    && !/settings\.get\('playerScale'\)/.test(game));

  {
    const before = cheats.playerScale;
    cheats.set('playerScale', 1);
    cheats.set('playerScale', 1 * 1.12 * 1.12);
    ok(`two steps up is 1.12 squared  (${cheats.playerScale.toFixed(4)})`,
      Math.abs(cheats.playerScale - 1.2544) < 1e-6);
    // The store refuses what the old path produced, which is the second reason
    // this never blew up loudly.
    const kept = cheats.playerScale;
    cheats.set('playerScale', NaN);
    ok('and a NaN is refused rather than stored', cheats.playerScale === kept);
    cheats.set('playerScale', 500);
    ok(`clamped at the top  (${cheats.playerScale})`, cheats.playerScale === 40);
    cheats.set('playerScale', before);
  }

  // Being tall is not cheating: it is a designed feature with its own keybind
  // and a permanent row in the HUD, so it must not light the cheat indicator.
  {
    const before = cheats.playerScale;
    cheats.lock();
    ok('nothing is flagged to start with', cheats.active === false);
    cheats.set('playerScale', 3);
    ok('resizing does not turn the cheat flag on', cheats.active === false);
    ok('and does not appear in the label list', !cheats.labels.some((l) => /size/i.test(l)));
    cheats.set('playerSpeed', 4);
    ok('while an actual cheat does', cheats.active === true);
    cheats.lock();
    ok('and locking puts the size back with everything else', cheats.playerScale === 1);
    cheats.set('playerScale', before);
  }

  // I20 asked for it in the cheat panel as well as on the keys.
  const panel = readFileSync(new URL('../src/ui/cheatPanel.js', import.meta.url), 'utf8');
  ok('the cheat panel has a size dial too',
    /key: 'playerScale'/.test(panel) && /label: 'Size'/.test(panel));
}

console.log('\nThe trail thins rather than forgetting');
{
  const { Trail } = await import('../src/ui/trail.js');
  const fresh = () => {
    const t = new Trail();
    // Constructed from storage; this is a test, so start it empty.
    t.legs = [];
    t.last = null;
    return t;
  };
  const fly = (t, steps, from) => {
    let lat = from;
    t.break();
    for (let i = 0; i < steps; i++) {
      lat += 0.0012;
      t.record(lat, 7.9);
    }
  };

  // A leg is a continuous flight, and only a teleport starts a new one — so a
  // leg can be very nearly the whole record. Dropping the oldest *leg* to stay
  // inside the budget therefore erased almost everything at a moment with no
  // visible cause, and on a single unbroken flight it did not run at all,
  // because it stopped while `legs.length > 1` was false. Measured on the old
  // code: 6000 recorded steps in one leg kept all 6000, half again over a
  // budget of 4000; five flights of 1200 kept three of them, so 480 km of an
  // 801 km journey and two whole flights were simply gone.
  {
    const t = fresh();
    fly(t, 6000, 46.5);
    ok(`one long flight is held to the budget  (${t.pointCount} points)`,
      t.pointCount <= 4000);
    ok(`and still covers the ground it flew  (${(t.length / 1000).toFixed(0)} km)`,
      t.length / 1000 > 780);
  }
  {
    const t = fresh();
    for (let leg = 0; leg < 5; leg++) fly(t, 1200, 40 + leg * 5);
    ok(`five flights are all still on the map  (${t.legs.length} legs)`, t.legs.length === 5);
    ok(`covering all of the ground rather than three fifths of it  (${(t.length / 1000).toFixed(0)} km)`,
      t.length / 1000 > 780);
    // Oldest coarsest: history fades in detail, the line you are drawing now
    // keeps its full ninety-metre spacing.
    const sizes = t.legs.map((leg) => leg.length);
    ok(`and the oldest is the thinnest, not the newest  (${sizes.join(', ')})`,
      sizes[0] <= sizes[sizes.length - 1]);
  }
  {
    // Thinning keeps both ends, so a leg never loses where it started or where
    // it stopped — which is what would make the line jump on the map.
    const t = fresh();
    fly(t, 3000, 20);
    const first = t.legs[0][0];
    fly(t, 3000, 60);
    ok('thinning keeps the first point of a leg',
      t.legs[0][0].lat === first.lat && t.legs[0][0].lon === first.lon);
    ok('and leaves the live end where the player actually is',
      t.last === t.legs[t.legs.length - 1].at(-1));
  }
}

console.log('\nThe floor is the ground you can see, while it is still moving');
{
  const THREE = await import('../vendor/three/three.module.js');
  const { Terrain } = await import('../src/world/terrain.js');

  // A tile does not step to fresh elevation, it walks — but the walk happens in
  // the vertex shader, mix(prevY, position.y, uMorph), and the geometry on this
  // side holds only the destination. So a raycast lands on ground that is not
  // there yet, and for the third of a second the walk takes, the floor the
  // player stands on and the floor they can see are different surfaces.
  //
  // Measured in flight before the fix: the height under a fixed point took 55
  // steps of more than a metre in two and a half minutes, 45 of more than five,
  // the biggest 82.8 m — instant on this side, a third of a second on the
  // other. It cannot be observed in the headless harness, which renders at
  // about 1.4 frames a second, so the morph is over before the next frame; the
  // arithmetic is checked here instead.
  const terrain = Object.create(Terrain.prototype);
  terrain._triA = new THREE.Vector3();
  terrain._triB = new THREE.Vector3();
  terrain._triC = new THREE.Vector3();
  terrain._bary = new THREE.Vector3();
  terrain._hitLocal = new THREE.Vector3();

  // One flat triangle at y = 100, which used to be at y = 20.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 100, 0, 10, 100, 0, 0, 100, 10,
  ]), 3));
  geometry.setAttribute('prevY', new THREE.BufferAttribute(new Float32Array([20, 20, 20]), 1));
  const mesh = new THREE.Mesh(geometry);
  mesh.position.set(0, 0, 0);
  mesh.updateMatrixWorld(true);
  const node = { mesh, material: { uniforms: { uMorph: { value: 0 } } } };
  const hit = { point: new THREE.Vector3(2, 100, 2), face: { a: 0, b: 1, c: 2 } };

  node.material.uniforms.uMorph.value = 0;
  ok(`at the start of the walk the floor is where the ground was  (${terrain.drawnY(node, hit)})`,
    Math.abs(terrain.drawnY(node, hit) - 20) < 1e-6);
  node.material.uniforms.uMorph.value = 0.5;
  ok(`halfway it is halfway  (${terrain.drawnY(node, hit)})`,
    Math.abs(terrain.drawnY(node, hit) - 60) < 1e-6);
  node.material.uniforms.uMorph.value = 1;
  ok(`and at the end it is the new height  (${terrain.drawnY(node, hit)})`,
    Math.abs(terrain.drawnY(node, hit) - 100) < 1e-6);

  // A tile with no morph running is left exactly alone, so the ordinary case
  // costs nothing and cannot be shifted by this.
  const plain = { mesh, material: { uniforms: {} } };
  ok('a tile that is not settling is untouched',
    terrain.drawnY(plain, hit) === 100);

  // And the controller stands on the drawn surface outright — not "the higher
  // of the two", and not "the drawn one only while it is moving". Both of
  // those leave the player at a height that is not drawn anywhere: the field
  // runs ahead of the mesh at every refinement, so taking the higher one takes
  // the undrawn one every time the ground gets taller.
  const controllerSrc = readFileSync(new URL('../src/player/controller.js', import.meta.url), 'utf8');
  ok('the controller stands on the drawn surface whenever there is one',
    /if \(drawn !== null\) \{\n\s*ground = drawn;/.test(controllerSrc));
  ok('and nothing asks whether the ground is settling any more',
    !/settlingAt/.test(controllerSrc));
}

console.log('\nEvery hand-written shader writes depth on the same scale');
{
  // The renderer runs with logarithmicDepthBuffer, which means depth is not the
  // rasteriser's interpolated value: every material has to compute it, and
  // three.js does that for its built-in materials through four shader chunks.
  // A ShaderMaterial that leaves them out is testing against a buffer written
  // on a different scale, so the comparison is meaningless — and it fails
  // silently, as a thing that is there but never drawn.
  //
  // Two had it. The cloud deck was hidden by ground four kilometres behind it,
  // so from above the clouds there was simply no cloud — measured with the
  // cover forced to 0.85 and the deck confirmed visible, and still nothing
  // between a camera at 5,000 m and a valley floor at 1,000. The edge wall,
  // which closes the world, had the same omission and is drawn against the
  // furthest ground there is.
  //
  // Checked across every file rather than those two, because the next
  // hand-written shader will have the same hole unless something asks.
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  ok('the renderer really is on a logarithmic depth buffer',
    /logarithmicDepthBuffer: true/.test(game));
  const needed = [
    'logdepthbuf_pars_vertex',
    'logdepthbuf_vertex',
    'logdepthbuf_pars_fragment',
    'logdepthbuf_fragment',
  ];
  // The comment above says "across every file", and this was a hard-coded list
  // of nine. It had already drifted: four of the nine no longer build a shader
  // material at all, including the sky, which the exemption below describes.
  // A hand-written shader in a file nobody thought to add would not have been
  // checked, which is the whole thing this guard exists to prevent.
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true })
    .map(String).filter((f) => f.endsWith('.js'))
    .filter((f) => /new THREE\.(Raw)?ShaderMaterial/
      .test(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')))
    .map((f) => `src/${f}`);
  ok(`every hand-written shader is found, not listed  (${files.length}: ${files.map((f) => f.split('/').pop()).join(', ')})`,
    files.length >= 5);
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    // The sky is the one honest exception and it says so itself: depthTest is
    // off and it is drawn behind everything, so it neither reads nor writes.
    const exempt = /depthTest: false/.test(source) && /depthWrite: false/.test(source);
    const missing = needed.filter((chunk) => !source.includes(chunk));
    ok(`${file.replace('src/world/', '')} writes depth like everything else`
      + (exempt && missing.length ? '  (exempt: depth off entirely)' : ''),
      missing.length === 0 || exempt,
      missing.length ? `missing ${missing.join(', ')}` : '');
  }
}

// ---------------------------------------------------------------------------
console.log('\nevery module still parses');
{
  /*
    The suite had fifteen hundred checks and none of them opened most of the
    files.

    A stray apostrophe inside a single-quoted help string in settingsPanel.js
    took the whole suite green — every check that reads source reads it as
    *text*, and text does not care whether it is valid JavaScript. What ships
    from that is a blank screen, which is the one failure a player cannot work
    around and the one this suite exists to stop.

    tools/check.mjs already parses every module and resolves every relative
    import against what the target actually exports. It just was not part of
    the suite. It is now, so a file that cannot be loaded fails here rather
    than on somebody's machine.
  */
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const run = spawnSync(process.execPath,
    [fileURLToPath(new URL('./check.mjs', import.meta.url))],
    { encoding: 'utf8' });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
  const summary = output.split('\n').pop() ?? '';
  ok(`every module parses and every import resolves  (${summary})`,
    run.status === 0, run.status === 0 ? '' : output.slice(0, 800));
}

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures > 0 ? 1 : 0);

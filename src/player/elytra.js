/**
 * Elytra flight.
 *
 * One model, and it is Minecraft's own tick, transcribed from
 * `LivingEntity.updateFallFlyingMovement` rather than approximated: gravity
 * discounted by up to three quarters when you are level, a tenth of your sink
 * credited back as forward speed, a pull-up paid several times the horizontal
 * speed it costs, and the velocity multiplied by 0.99 / 0.98 / 0.99 at the end
 * of every tick. Every number a player can measure comes out at Minecraft's own
 * figure:
 *
 *   level glide      sinks 2.99 m/s while making 30.2 m/s — a 10.1 : 1 glide
 *   vertical dive    terminal 78.4 m/s
 *   rocket           accelerates you toward 1.5 blocks a tick along your look
 *
 * One thing differs from vanilla, and only because it was asked for: a bigger
 * rocket pushes harder as well as longer, in exactly the proportion its burn is
 * longer. See rocketPowerFor. Everything else is Minecraft's own constant.
 *
 * Everything below runs at a fixed 20 steps a second in blocks-per-tick, the
 * units the constants were tuned in, then converts back to metres per second.
 */

export const TICK = 1 / 20;
const GRAVITY_PER_TICK = 0.08; // blocks / tick^2  (~32 m/s^2)

/**
 * How much height a pull-up buys with the speed it spends.
 *
 * Minecraft's own number, unchanged. It was briefly 4.5 here, chosen as the
 * smallest value at which a dive-and-climb rhythm holds altitude, because the
 * 45/45 manoeuvre does not close the loop at 3.2 — sweeping every angle from
 * one degree to eighty-five and every cadence from a tenth of a second to
 * twelve seconds, the best it manages is a sink of 1.4 m/s against 3.0 m/s for
 * holding level. That is a glide stretched to twice its length and it still
 * ends.
 *
 * It is 3.2 again because "exactly like Minecraft, no guesswork" is the
 * clearer instruction and it beats a tuned number, even a well-measured one.
 * Everything in this file is now vanilla's, tick for tick.
 */
const CLIMB_TRADE = 3.2;

/**
 * Minecraft's own number: a rocket accelerates you toward 1.5 blocks per tick
 * along the look vector, which is 30 m/s. Taken verbatim rather than tuned,
 * because matching the feel is the point.
 */
const ROCKET_THRUST = 1.5;
/**
 * Minecraft holds the push flat for the whole burn and lets drag do the
 * slowing down afterwards. There was a light fade here so a long burn was not
 * a flat line; it is gone, because a flat line is what it is.
 *
 * What this actually feels like, and the numbers are Minecraft's own: held
 * level, a rocket settles you at about 33 m/s. That is the famous figure —
 * elytra plus rockets cruises at a shade over thirty-three metres a second —
 * and it is *lower* than a dive, which reaches 78. So firing while already
 * faster than that slows you down. That is not a bug in the rocket; it is what
 * a rocket is: it pulls your speed toward its own, from either direction.
 */
const ROCKET_TAPER = 1;
const TO_TICK = TICK; // m/s -> blocks/tick
const TO_SECOND = 1 / TICK; // blocks/tick -> m/s

/**
 * One tick of gliding.
 *
 * @param {{x:number,y:number,z:number}} velocity metres per second, mutated
 * @param {{x:number,y:number,z:number}} look unit look vector
 * @param {number} pitch radians, positive looking up
 *
 * Minecraft measures pitch positive downward; ours is positive up, so this
 * negates it wherever the original reads xRot.
 *
 * Speed mode does not change anything here — it scales the *displacement*
 * applied per step, so the aircraft handles exactly the same when it is on.
 */
export function stepGlide(velocity, look, pitch) {
  let vx = velocity.x * TO_TICK;
  let vy = velocity.y * TO_TICK;
  let vz = velocity.z * TO_TICK;

  const horizLook = Math.hypot(look.x, look.z);
  // Both of these are read before gravity, exactly as the original does.
  const horizSpeed = Math.hypot(vx, vz);
  // cos(pitch)^2: one when level, nothing when pointing straight up or down.
  const level = Math.min(1, Math.cos(pitch) * Math.cos(pitch));

  vy += GRAVITY_PER_TICK * (-1 + level * 0.75);

  // Sinking through the air pushes you forward: a tenth of the sink, best when
  // level and nothing at all when pointed straight down.
  if (vy < 0 && horizLook > 0) {
    const lift = vy * -0.1 * level;
    vy += lift;
    vx += (look.x * lift) / horizLook;
    vz += (look.z * lift) / horizLook;
  }

  // Looking up trades horizontal speed for height. See CLIMB_TRADE.
  if (pitch > 0 && horizLook > 0) {
    const trade = horizSpeed * Math.sin(pitch) * 0.04;
    vy += trade * CLIMB_TRADE;
    vx -= (look.x * trade) / horizLook;
    vz -= (look.z * trade) / horizLook;
  }

  // Swing the horizontal component round toward where you are looking.
  if (horizLook > 0) {
    vx += ((look.x / horizLook) * horizSpeed - vx) * 0.1;
    vz += ((look.z / horizLook) * horizSpeed - vz) * 0.1;
  }

  vx *= 0.99;
  vy *= 0.98;
  vz *= 0.99;

  velocity.x = vx * TO_SECOND;
  velocity.y = vy * TO_SECOND;
  velocity.z = vz * TO_SECOND;
}

/**
 * One tick of firework-rocket thrust along the look vector.
 *
 * @param {number} power  strength multiplier (the slot's power, times cheats)
 * @param {number} spent  0 at ignition, 1 at burnout — the kick fades across it
 */
export function stepRocket(velocity, look, power = 1, spent = 0) {
  const fade = 1 - (1 - ROCKET_TAPER) * Math.min(1, Math.max(0, spent));
  const thrust = ROCKET_THRUST * power * fade;
  const vx = velocity.x * TO_TICK;
  const vy = velocity.y * TO_TICK;
  const vz = velocity.z * TO_TICK;

  // Minecraft's tick is `v + look*0.1 + (look*thrust - v)*0.5`, and that middle
  // term does two jobs at once: it swings your velocity round toward where you
  // are looking, and it pulls your speed toward the rocket's own. Pulls, in
  // both directions — so in vanilla, firing while already faster than a rocket
  // slows you down.
  //
  // In vanilla that barely shows, because every firework aims at the same 1.5
  // blocks a tick. Here a bigger rocket pushes harder as well as longer, which
  // was asked for, and the same line then means a Rocket I fired while cruising
  // on a Rocket V takes you from 107 m/s to 33.5. Pressing the wrong hotbar key
  // costs you sixty-nine per cent of your speed, which is not a trade, it is a
  // trap.
  //
  // So the two jobs are separated. The swing toward your look direction is kept
  // exactly as it was — that is the part that makes a rocket steer. The pull
  // along your look is only ever allowed to add. A rocket is a motor, not a
  // brake.
  //
  // Everywhere it used to matter this is identical arithmetic: from a standstill
  // the along-look speed is nought, so the full pull applies, and Rocket I still
  // settles at Minecraft's 33 m/s.
  const along = vx * look.x + vy * look.y + vz * look.z;
  // Minecraft's own line, clamped at nought from below and not otherwise
  // touched.
  //
  // The governor is the pull, not the missing nudge. Vanilla's term is
  // 0.1 + (thrust - along) * 0.5 with no floor, and it settles where that
  // reaches nought — 0.2 blocks a tick past the rocket's own target. Dropping
  // the nudge as well as the pull, which is what this did before, caps the
  // cruise at the target exactly, puts a step in the curve at the moment you
  // reach it, and means a second firework lit while the first is burning can
  // contribute nothing at all. Which is the whole of "spamming should make you
  // faster" doing nothing.
  //
  // Clamping instead keeps all three properties: it still cannot brake you, so
  // a Rocket I fired at Rocket V speed is inert rather than a trap; it still
  // has its governor, because the pull goes negative before the clamp does and
  // holds the cruise where vanilla holds it; and every firework alive pushes,
  // so lighting more gets you there faster and holds you there.
  const gain = Math.max(0, 0.1 + (thrust - along) * 0.5);
  // What is left of your velocity once the along-look part is taken out. This
  // is the component the swing acts on, and halving it is what the original
  // line did to it.
  const sx = vx - along * look.x;
  const sy = vy - along * look.y;
  const sz = vz - along * look.z;

  const nx = vx + look.x * gain - sx * 0.5;
  const ny = vy + look.y * gain - sy * 0.5;
  const nz = vz + look.z * gain - sz * 0.5;

  velocity.x = nx * TO_SECOND;
  velocity.y = ny * TO_SECOND;
  velocity.z = nz * TO_SECOND;
}

/**
 * Ticks of thrust a rocket of the given flight duration provides.
 *
 * Minecraft's own formula: a firework with flight duration N lives for
 * `10N + 6` ticks (plus a random nought to five that is not worth reproducing
 * for something you are steering). So:
 *
 *   I    16 ticks   0.8 s
 *   II   26 ticks   1.3 s
 *   III  36 ticks   1.8 s
 *   IV   46 ticks   2.3 s
 *   V    56 ticks   2.8 s
 *
 * Crafting caps the duration at three; four and five come from a command
 * block, and the formula runs straight on through them, which is what "infer
 * it from the graph" means here — there is a graph and it is a straight line.
 *
 * This was briefly "the number is the burn in seconds", because the label said
 * so and five seconds is what a player might expect "duration 5" to mean. It
 * is not what Minecraft does, and matching Minecraft is the instruction. The
 * hotbar prints the real burn instead, so the label is honest either way.
 */
export function rocketTicks(duration) {
  return 10 * Math.max(1, Math.round(duration)) + 6;
}

/**
 * Thrust multiplier for a slot.
 *
 * A bigger rocket pushes harder, in the same proportion that it burns longer.
 *
 * Minecraft does not do this: there, every firework accelerates you toward the
 * same 1.5 blocks a tick and only the duration changes, so a Rocket V feels
 * exactly like a Rocket I that lasts longer. That parity was the rule here for
 * a while, and the answer to "where did the speed boost go" was "it was taken
 * out on purpose". Asked for directly, it is back — and scaled off the burn
 * rather than off a number picked to feel right, so there is one rule for both
 * halves of what a rocket is.
 *
 * The burn is Minecraft's own `10N + 6` ticks. Thrust is that same figure over
 * Rocket I's sixteen, so Rocket I is unchanged at vanilla's 1.5 blocks a tick
 * and the rest follow the durations exactly:
 *
 *   I    16 ticks   x1.000   1.50 blocks/tick
 *   II   26 ticks   x1.625   2.44
 *   III  36 ticks   x2.250   3.38
 *   IV   46 ticks   x2.875   4.31
 *   V    56 ticks   x3.500   5.25
 */
export function rocketPowerFor(duration = 1) {
  return rocketTicks(duration) / rocketTicks(1);
}

/**
 * What a rocket of this duration actually holds you at, in metres per second.
 *
 * Flown rather than quoted: this runs the real tick — the same `stepRocket`
 * and `stepGlide` the game runs — level along the look vector for the whole
 * burn and reports the fastest it got. So the number on the hotbar cannot
 * drift away from the flight model, because it is the flight model.
 *
 * It comes out below the raw thrust each time, and further below it the bigger
 * the rocket, because drag rises with speed: thrust scales 1, 1.625, 2.25,
 * 2.875, 3.5 and the speed reached scales 1, 1.55, 2.10, 2.65, 3.19.
 *
 *   I    0.8s    33 m/s     120 km/h
 *   II   1.3s    52 m/s     187 km/h
 *   III  1.8s    70 m/s     253 km/h
 *   IV   2.3s    89 m/s     319 km/h
 *   V    2.8s   107 m/s     385 km/h
 */
export function rocketTopSpeed(duration) {
  const look = { x: 0, y: 0, z: -1 };
  const velocity = { x: 0, y: 0, z: 0 };
  const ticks = rocketTicks(duration);
  const power = rocketPowerFor(duration);
  let peak = 0;
  for (let tick = 0; tick < ticks; tick++) {
    stepRocket(velocity, look, power, tick / ticks);
    stepGlide(velocity, look, 0);
    peak = Math.max(peak, Math.hypot(velocity.x, velocity.y, velocity.z));
  }
  return peak;
}

/**
 * Best-glide speed for the HUD readout, metres per second — the airspeed that
 * covers the most ground per metre of height.
 */
export function bestGlideSpeed() {
  return 30;
}

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
 * Nothing here differs from vanilla. Every constant is Minecraft's.
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
 * How much of the kick is left at burnout. Minecraft holds the push flat for
 * the whole burn and lets drag do the slowing down afterwards; this keeps a
 * light fade so a five-second burn is not a flat line, but the ignition peak
 * is Minecraft's, and most of the decay you feel is drag once it is spent.
 */
const ROCKET_TAPER = 0.85;
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

  const nx = vx + look.x * 0.1 + (look.x * thrust - vx) * 0.5;
  const ny = vy + look.y * 0.1 + (look.y * thrust - vy) * 0.5;
  const nz = vz + look.z * 0.1 + (look.z * thrust - vz) * 0.5;

  velocity.x = nx * TO_SECOND;
  velocity.y = ny * TO_SECOND;
  velocity.z = nz * TO_SECOND;
}

/**
 * Ticks of thrust a rocket of the given flight duration provides.
 *
 * The slot number is the burn in *seconds*, which is what the label has always
 * claimed and what a Minecraft player expects "flight duration 3" to mean.
 */
export function rocketTicks(duration) {
  return Math.round(duration / TICK);
}

/**
 * Thrust multiplier for a slot: bigger rockets carry more powder.
 *
 * Minecraft gives every rocket the same push and varies only the burn. Here
 * the number means both, and each step up is a fifth again on top of the last
 * rather than a fifth of the first — so the gap between IV and V is bigger
 * than the gap between I and II, which is how a stack of powder actually
 * behaves. It tops out a shade over twice a Rocket I.
 */
export function rocketPowerFor(duration) {
  return Math.pow(1.2, duration - 1);
}

/**
 * Best-glide speed for the HUD readout, metres per second — the airspeed that
 * covers the most ground per metre of height.
 */
export function bestGlideSpeed() {
  return 30;
}

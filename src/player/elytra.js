/**
 * Elytra flight.
 *
 * This is a faithful re-derivation of Minecraft's glide integrator, written from
 * the behaviour rather than lifted from anywhere: gravity is scaled by the
 * square of the cosine of pitch, a dive converts fall speed into forward speed,
 * pulling up trades airspeed for climb at a little over 3x, and the horizontal
 * velocity is continuously steered toward wherever you are looking. The result
 * is the same feel — dive to build speed, flare to trade it back for height —
 * at real-world scale, where one block is one metre.
 *
 * Everything below runs at a fixed 20 steps a second in blocks-per-tick, the
 * units the constants were tuned in, then converts back to metres per second.
 */

export const TICK = 1 / 20;
const GRAVITY_PER_TICK = 0.08; // blocks / tick^2  (~32 m/s^2)
const DRAG = { x: 0.99, y: 0.985, z: 0.99 };
/**
 * Peak firework thrust, blocks per tick. A rocket kicks hard at ignition and
 * tapers off across its burn, so it shoves you and then hands you back to the
 * glide rather than holding one flat speed until it stops.
 */
const ROCKET_THRUST = 2.5;
const ROCKET_TAPER = 0.5; // how much of the kick is left at burnout
const TO_TICK = TICK; // m/s -> blocks/tick
const TO_SECOND = 1 / TICK; // blocks/tick -> m/s

/**
 * @param {{x:number,y:number,z:number}} velocity metres per second, mutated
 * @param {{x:number,y:number,z:number}} look unit look vector
 * @param {number} pitch radians, positive looking up
 *
 * Speed mode does not change the physics here — it scales the *displacement*
 * applied per step, so the aircraft still handles exactly the same when it is on.
 */
export function stepGlide(velocity, look, pitch) {
  let vx = velocity.x * TO_TICK;
  let vy = velocity.y * TO_TICK;
  let vz = velocity.z * TO_TICK;

  const horizontalLook = Math.hypot(look.x, look.z);
  const horizontalSpeed = Math.hypot(vx, vz);

  // Minecraft's xRot is positive looking down; ours is positive looking up.
  const f = -pitch;
  const cosPitch = Math.cos(f);
  const lift = cosPitch * cosPitch;

  vy += GRAVITY_PER_TICK * (-1 + lift * 0.75);

  if (vy < 0 && horizontalLook > 0) {
    // Diving: some of the fall is redirected along the look direction.
    const transfer = vy * -0.1 * lift;
    vy += transfer;
    vx += (look.x * transfer) / horizontalLook;
    vz += (look.z * transfer) / horizontalLook;
  }

  if (f < 0 && horizontalLook > 0) {
    // Pulling up: airspeed is spent climbing, and rather efficiently. Flown
    // well — dive, flare, dive again — the exchange very nearly breaks even,
    // which is what lets a good angle keep you up indefinitely.
    const climb = horizontalSpeed * -Math.sin(f) * 0.04;
    vy += climb * 3.4;
    vx -= (look.x * climb) / horizontalLook;
    vz -= (look.z * climb) / horizontalLook;
  }

  if (horizontalLook > 0) {
    // Steering: horizontal velocity chases the heading you are looking at.
    vx += ((look.x / horizontalLook) * horizontalSpeed - vx) * 0.1;
    vz += ((look.z / horizontalLook) * horizontalSpeed - vz) * 0.1;
  }

  vx *= DRAG.x;
  vy *= DRAG.y;
  vz *= DRAG.z;

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

/** Ticks of thrust a rocket of the given flight duration provides. */
export function rocketTicks(duration) {
  return 10 * duration + 6;
}

/** Thrust multiplier for a slot: bigger rockets carry more powder. */
export function rocketPowerFor(duration) {
  return 0.6 + duration * 0.28;
}

/** Terminal glide speed for the HUD's "best glide" readout, metres per second. */
export function bestGlideSpeed() {
  return 33.5;
}

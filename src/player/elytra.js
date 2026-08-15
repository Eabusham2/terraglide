/**
 * Elytra flight.
 *
 * Same feel as the game this borrows from — dive to build speed, flare to trade
 * it back for height — but built so that it cannot cheat. Minecraft discounts
 * gravity by three quarters whenever you are level and credits a pull-up with
 * several times the speed it costs; both are free energy, and together they let
 * a patient player porpoise upward forever on nothing at all.
 *
 * Here there are exactly three forces:
 *
 *   gravity   full strength, every tick, no discount for anything
 *   the wing  turns the velocity vector toward where you are looking, scaled by
 *             airspeed. A turn is a rotation, and a rotation cannot create
 *             energy — so the wing can only ever spend what gravity gave you
 *   drag      a constant bleed plus a term that grows with speed, which is what
 *             sets terminal velocity
 *
 * The consequence is the one that matters: **no sequence of inputs can end
 * higher and faster than it started.** Look level and you sink at about 3 m/s.
 * Dive and you build to around 85 m/s. Flare out of that and you buy back
 * something like 60 metres — a lot, but always less than the dive cost you.
 * Flown well the ratio is roughly eight metres forward per metre down, which is
 * a long way, and still a slope.
 *
 * Everything below runs at a fixed 20 steps a second in blocks-per-tick, the
 * units the constants were tuned in, then converts back to metres per second.
 */

export const TICK = 1 / 20;
const GRAVITY_PER_TICK = 0.08; // blocks / tick^2  (~32 m/s^2)
/** Constant drag per tick, plus a term that grows with speed. */
const DRAG_BASE = 0.004;
const DRAG_SPEED = 0.0022;
/**
 * Peak firework thrust, blocks per tick. A rocket kicks hard at ignition and
 * tapers off across its burn, so it shoves you and then hands you back to the
 * glide rather than holding one flat speed until it stops.
 */
const ROCKET_THRUST = 2.5;
const ROCKET_TAPER = 0.5; // how much of the kick is left at burnout
/** Airspeed at which the wings give their full support, blocks per tick. */
const STALL_SPEED = 1.55;
/** How much of the velocity the wing turns toward your look each tick. */
const TURN_RATE = 0.4;
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

  // Gravity, in full, every tick. Nothing here discounts it.
  vy -= GRAVITY_PER_TICK;

  const speed = Math.hypot(vx, vy, vz);
  const lookLength = Math.hypot(look.x, look.y, look.z);

  if (speed > 1e-6 && lookLength > 1e-6) {
    // The wing turns the airflow toward wherever you are pointing it. Rotating
    // the velocity vector is all a wing really does, and rotation cannot
    // create energy — so a dive buys speed, a flare spends that speed on
    // height, and neither can ever hand back more than gravity gave you.
    //
    // How hard it bites scales with airspeed: fast, it rotates decisively;
    // slow, it barely responds, which is what stalling feels like.
    const bite = TURN_RATE * Math.min(1, speed / STALL_SPEED);
    const nx = look.x / lookLength;
    const ny = look.y / lookLength;
    const nz = look.z / lookLength;

    vx += (nx * speed - vx) * bite;
    vy += (ny * speed - vy) * bite;
    vz += (nz * speed - vz) * bite;

    // Renormalise so the turn is exactly that — a turn, not a push.
    const after = Math.hypot(vx, vy, vz);
    if (after > 1e-6) {
      const scale = speed / after;
      vx *= scale;
      vy *= scale;
      vz *= scale;
    }
  }

  // Drag: the only other way to lose energy, and what sets terminal speed.
  const drag = 1 - DRAG_BASE - DRAG_SPEED * Math.hypot(vx, vy, vz);
  vx *= drag;
  vy *= drag;
  vz *= drag;

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

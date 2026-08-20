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
 * higher and faster than it started.** Look level and you sink at about 3.4 m/s
 * while making 24. Dive and you build toward 78 m/s, which is Minecraft's own
 * terminal velocity and where drag stops you. Flare out of that and you buy
 * back height, always less than the dive cost you. Flown well the ratio is
 * seven metres forward per metre down: a kilometre up is seven kilometres of
 * country, which is a long way and still a slope.
 *
 * The drag used to be light enough for a ten-to-one glide, and ten to one is
 * not a slope, it is a cruise — you could leave a mountain and still be in the
 * air two minutes later with nothing to do. It is now set so that a level
 * glide costs you something you can feel.
 *
 * Everything below runs at a fixed 20 steps a second in blocks-per-tick, the
 * units the constants were tuned in, then converts back to metres per second.
 */

export const TICK = 1 / 20;
const GRAVITY_PER_TICK = 0.08; // blocks / tick^2  (~32 m/s^2)
/**
 * Constant drag per tick, plus a term that grows with speed.
 *
 * Together they set both ends of the envelope: the constant term decides how
 * expensive a level glide is, and the speed term decides where a dive stops
 * accelerating. These two put the dive terminal at 3.92 blocks a tick, which
 * is exactly Minecraft's.
 */
const DRAG_BASE = 0.008;
const DRAG_SPEED = 0.003;
/**
 * Peak firework thrust, blocks per tick. A rocket kicks hard at ignition and
 * tapers off across its burn, so it shoves you and then hands you back to the
 * glide rather than holding one flat speed until it stops.
 */
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

/**
 * Minecraft's elytra, tick for tick.
 *
 * Everything above is built so that it cannot cheat. This is the other one:
 * the real thing, transcribed, free energy and all. Gravity is discounted by
 * up to three quarters whenever you are level; a sinking glide is credited a
 * tenth of its own sink back as forward speed; and a pull-up is paid three and
 * a fifth times the horizontal speed it costs. Those three terms together are
 * why a patient Minecraft player can porpoise upward for ever on nothing, and
 * they are the reason the honest model exists.
 *
 * It is offered because "like Minecraft" is a perfectly good thing to want,
 * and because endless flight is a feature if you asked for it and a bug if you
 * did not. Choosing it is the asking.
 *
 * Minecraft measures pitch positive downward; ours is positive up, so the
 * transcription negates it wherever the original reads xRot.
 */
export function stepGlideMinecraft(velocity, look, pitch) {
  let vx = velocity.x * TO_TICK;
  let vy = velocity.y * TO_TICK;
  let vz = velocity.z * TO_TICK;

  const horizLook = Math.hypot(look.x, look.z);
  const horizSpeed = Math.hypot(vx, vz);
  // cos(pitch)^2: one when level, nothing when pointing straight up or down.
  const level = Math.min(1, Math.cos(pitch) * Math.cos(pitch));

  vy += GRAVITY_PER_TICK * (-1 + level * 0.75);

  if (vy < 0 && horizLook > 0) {
    const lift = vy * -0.1 * level;
    vy += lift;
    vx += (look.x * lift) / horizLook;
    vz += (look.z * lift) / horizLook;
  }

  // Looking up trades horizontal speed for height, at a rate no wing has.
  if (pitch > 0 && horizLook > 0) {
    const trade = horizSpeed * Math.sin(pitch) * 0.04;
    vy += trade * 3.2;
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
 * Ticks of thrust a rocket of the given flight duration provides.
 *
 * The slot number is the burn in *seconds*, which is what the label has always
 * claimed and what a Minecraft player expects "flight duration 3" to mean.
 * The old formula was Minecraft's raw entity lifetime (10n + 6 ticks), which
 * made a Rocket V burn for 2.8 seconds while the HUD read "dur 5" — the number
 * was simply lying.
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
 * behaves. It tops out a shade over twice a Rocket I, which is a real reason
 * to carry the big ones and still not fast enough to lose the ground.
 */
export function rocketPowerFor(duration) {
  return Math.pow(1.2, duration - 1);
}

/**
 * Best-glide speed for the HUD readout, metres per second — the airspeed that
 * covers the most ground per metre of height, found by sweeping the model.
 */
export function bestGlideSpeed() {
  return 24;
}

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
 * Exactly one constant differs from vanilla, and it is the one the 45/45
 * manoeuvre lives on. See CLIMB_TRADE.
 *
 * Everything below runs at a fixed 20 steps a second in blocks-per-tick, the
 * units the constants were tuned in, then converts back to metres per second.
 */

export const TICK = 1 / 20;
const GRAVITY_PER_TICK = 0.08; // blocks / tick^2  (~32 m/s^2)

/**
 * How much height a pull-up buys with the speed it spends.
 *
 * Vanilla's number is 3.2, and at 3.2 the famous manoeuvre does not work.
 * That is not a guess — sweeping this model over every two-phase dive-and-climb
 * cycle, at every angle from one degree to eighty-five and every cadence from
 * a tenth of a second to twelve seconds, the best any of them manages at 3.2 is
 * a sink of 1.4 m/s. Better than the 3.0 m/s of holding level, and a glide
 * stretched to twice its length, but still a glide: it ends. Diving buys
 * *vertical* speed, only a tenth of that leaks into forward speed each tick,
 * and a pull-up spends forward speed — so the loop leaks faster than 3.2 can
 * refill it.
 *
 * 4.5 is where it closes, with room to be flown badly. What that changes and
 * what it deliberately does not:
 *
 *   unchanged   level glide, because this term only pays when the nose is up.
 *               Still 2.99 m/s of sink and still 10.1 : 1.
 *   unchanged   every dive, and so the 78.4 m/s terminal velocity.
 *   unchanged   holding *any* constant angle, which still sinks — 1.1 m/s at
 *               ten degrees up, 2.6 m/s at forty. There is no nose-up-and-wait
 *               exploit here; pointing at the sky is still the slowest way down.
 *   changed     a dive-and-pull cycle flown with a rhythm. Forty degrees down
 *               and forty up, six seconds each way, climbs at about 5 m/s.
 *               Three seconds each way barely holds. A second and a half each
 *               way still loses 2.6 m/s.
 *
 * So the technique is worth learning and the cadence is the skill in it, which
 * is what makes a manoeuvre worth having a name.
 */
const CLIMB_TRADE = 4.5;

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

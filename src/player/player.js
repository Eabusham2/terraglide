import * as THREE from '../../vendor/three/three.module.js';
import { cheats } from '../core/cheats.js';
import { Emitter } from '../core/events.js';
import { clamp, damp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { rocketPowerFor, rocketTicks, rocketTopSpeed } from './elytra.js';

/**
 * Player state: where you are, how fast, how big, what is in the hotbar.
 *
 * Position is authoritative in world space; latitude/longitude are derived from
 * it every frame, which keeps physics in plain metres and means a re-anchor of
 * the local frame is just a coordinate swap.
 */

/**
 * The hotbar is five rockets and nothing else, and they are Minecraft's five.
 *
 * The Roman numeral is the *flight duration* tag, exactly as it is in the
 * game: Minecraft's own `10N + 6` ticks decides how long the push lasts, and
 * here it decides how hard it pushes as well, in the same proportion. Crafting
 * caps the tag at three; four and five are command-block rockets, and the
 * formula runs straight on through them.
 *
 * The label prints both, because both are now real: the burn in seconds and
 * the speed it will hold you at. Rocket I is vanilla's — a shade over thirty
 * metres a second — and Rocket V is three and a half times its push.
 */
/**
 * One colour per strength, cool to hot, so a glance tells you what you are
 * holding. The same five are used by the rocket in your hand, the hotbar icon
 * and the icon's glow, which is the point: the thing in the world and the
 * thing in the HUD have to be recognisably the same object.
 */
/** How many fireworks may burn at once. See fireRocket. */
const MAX_LIT = 12;

export const ROCKET_COLOURS = ['#8fb8d8', '#74c47a', '#e8c54a', '#e08a35', '#d23f2f'];

export const HOTBAR = [1, 2, 3, 4, 5].map((duration) => ({
  duration,
  power: rocketPowerFor(duration),
  colour: ROCKET_COLOURS[duration - 1],
  label: `Rocket ${'I II III IV V'.split(' ')[duration - 1]}`,
  // Both halves of what this rocket is: how long it burns and how fast it
  // holds you. Measured from the flight model rather than quoted, so the label
  // cannot drift away from the physics — see rocketTopSpeed. The HUD does the
  // formatting, because whether that speed reads in km/h or mph is the
  // player's setting and this list is built once at load.
  burnSeconds: rocketTicks(duration) / 20,
  topSpeed: rocketTopSpeed(duration),
}));

/**
 * How long speed mode runs, and how long it takes to recharge.
 *
 * Constants rather than sliders. They were both in Settings, which meant the
 * game shipped with "make the boost last a minute and recharge in five
 * seconds" sitting next to the choice of units — a cheat wearing a preference's
 * clothes. The cheat panel can still turn the cost off entirely.
 */
/**
 * Seconds of breath underwater, and how long you last after it runs out.
 *
 * Minecraft's own numbers: fifteen seconds of air, then damage every second.
 * Ten hearts at one heart a second is ten more seconds, which is what the
 * second constant stands in for — there is no health bar here, so running out
 * ends with a teleport somewhere you can breathe rather than a death screen.
 */
export const AIR_SECONDS = 15;
export const DROWNING_SECONDS = 10;

/**
 * Surge: what it is worth, how long it runs, and how long it takes back.
 *
 * It was called "speed mode", which is a label for a checkbox rather than a
 * name for a thing you spend. Surge is what it does — you get it, it runs out,
 * you wait.
 *
 * All three numbers moved together, because they only make sense together: a
 * fifth again on the boost and a fifth again on the burn, and a third off the
 * wait so it is something you use rather than something you hoard.
 *
 *   worth      2.0x  ->  2.4x
 *   runs for   10 s  ->  12 s
 *   recharges  45 s  ->  30 s
 */
export const SURGE_FACTOR = 2.4;
export const SPEED_MODE_SECONDS = 12;
export const SPEED_MODE_COOLDOWN_S = 30;

export class Player extends Emitter {
  constructor(frame) {
    super();
    this.frame = frame;
    this.position = new THREE.Vector3();
    /**
     * Where to *draw* you.
     *
     * Physics run at a fixed 20 Hz and the screen does not, so on anything
     * faster than 20 fps the position only changes on one frame in three or
     * six or seven and holds still in between. That is the jitter you see when
     * flying fast on a good monitor: not a physics problem, a sampling one.
     * The controller keeps this interpolated between the last two ticks, and
     * the camera and the avatar read it instead of the real one.
     */
    this.renderPosition = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    /**
     * How far the wings are banked over, radians, right wing down positive.
     *
     * Owned by the camera rig, which is where the input for it lives, and
     * copied here each frame so the flight model can read it. A banked wing
     * turns you — see tickGlide.
     */
    this.roll = 0;

    this.mode = 'walk'; // walk | glide | fall
    this.onGround = false;
    this.groundHeight = 0;
    /**
     * How steeply the ground rises ahead of you, in radians, positive uphill.
     * Zero in the air. The avatar leans on it so walking a hillside reads as a
     * hillside rather than as level ground that happens to be moving.
     */
    this.groundSlope = 0;
    /** The grade across you, positive when the ground rises to your right. */
    this.groundBank = 0;
    this.lat = 0;
    this.lon = 0;

    this.elytraDeployed = false;
    this.swimming = false;
    /**
     * Air left, in seconds. Minecraft gives you fifteen seconds of held
     * breath and then hurts you twice a second; this holds the fifteen and
     * spends the drowning on getting you out of the water rather than on a
     * health bar the game does not otherwise have.
     */
    this.airSeconds = AIR_SECONDS;
    this.drowned = false;

    /**
     * Every firework still burning, not just the last one lit.
     *
     * A firework in Minecraft is an entity, and every one of them applies its
     * own push on every tick it is alive for. Light a second while the first is
     * still going and both push — which is why spamming them makes you faster
     * there and did nothing here, where lighting one simply restarted a single
     * timer. Each entry keeps the power it was lit with, too, so a rocket in
     * flight is the rocket you lit rather than whichever slot you have since
     * scrolled to.
     */
    this.rockets = [];
    this.rocketDuration = 0;
    this.rocketsFired = 0;

    this.speedActive = false;
    this.speedRemaining = 0;
    this.speedCooldown = 0;
    /**
     * What speed mode is actually worth right now, eased rather than switched.
     * See tickTimers.
     */
    this.speedBlend = 1;

    this.selectedSlot = 0;
    this.distanceTravelled = 0;
    this.airborneSeconds = 0;
  }

  get scale() {
    // A cheat now rather than a setting — see CHEAT_DEFAULTS.
    return clamp(cheats.playerScale, 0.25, 60);
  }

  /** Standing height in metres (6 ft at scale 1). */
  get height() {
    return settings.get('playerHeightM') * this.scale;
  }

  get eyeHeight() {
    return this.height * 0.94;
  }

  get radius() {
    // A person, not a barrel. 0.21 of standing height is an 0.83 m wide capsule
    // on a six-foot-six frame — you could not walk between two bollards, and
    // pressed against a wall your shoulder was half a metre inside it. Real
    // shoulder breadth is about 0.23 of height, so half of that is the honest
    // radius. That is "the player width does not feel real", and it is the same
    // complaint as feeling too big.
    return Math.max(0.2, this.height * 0.12);
  }

  /**
   * How fast you are actually travelling, metres a second.
   *
   * The velocity times the speed multiplier, because that is what the
   * controller moves you by: `position += velocity * step * multiplier`. This
   * returned the bare velocity, so with speed mode running — the whole point
   * of which is to cover twice the ground — the readout showed half of what
   * you were doing, and `distanceTravelled` a few lines away in the controller
   * already used the multiplied figure. Two answers to one question, in one
   * file.
   */
  get speed() {
    return this.velocity.length() * this.speedMultiplier;
  }

  /** The same, flattened. */
  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z) * this.speedMultiplier;
  }

  /** Velocity as the flight model sees it, before speed mode stretches it. */
  get modelSpeed() {
    return this.velocity.length();
  }

  get altitudeAboveGround() {
    return this.position.y - this.groundHeight;
  }

  get selectedItem() {
    return HOTBAR[this.selectedSlot];
  }

  /**
   * How far a second of movement carries you. Speed mode, then any cheat.
   *
   * This is the *only* place speed mode multiplies anything. It used to also
   * double the firework's thrust, and since thrust feeds velocity and velocity
   * feeds this, the two compounded: a rocket lit in speed mode went four times
   * as fast as one lit without it, over four times the ground, which is where
   * the stutter came from — the terrain was being asked to stream in at four
   * times the rate the budget was written for. Two is two.
   */
  get speedMultiplier() {
    return this.speedBlend * cheats.playerSpeed;
  }

  /**
   * Firework thrust: the slot's powder, speed mode, and any cheat on top.
   *
   * Speed mode doubles the rocket as well as the running, which is the whole
   * reason to save one for it — light a Rocket V inside the burst and you get
   * the two multiplied rather than the better of the two. It reads the same
   * blend the movement does, not a hard two, so a rocket lit while the boost
   * is bleeding away gets whatever is left of it. That is also what lets a
   * firework hold the boost up past the end of the burst: the burn slows the
   * bleed, and the bleed is what the rocket is multiplied by.
   */
  get rocketPower() {
    const slot = this.selectedItem;
    return (slot ? slot.power : 1) * this.speedBlend * cheats.rocketPower;
  }

  /**
   * How long the longest burn still running has left, in ticks.
   *
   * Kept as a plain reading because that is all anyone outside wanted of it —
   * the HUD asks whether a rocket is lit, the autopilot asks whether it may
   * light another. Neither wants to know there are three.
   */
  get rocketTicksLeft() {
    let most = 0;
    for (const rocket of this.rockets) most = Math.max(most, rocket.left);
    return most;
  }

  /** Put every burning firework out. */
  stopRockets() {
    this.rockets.length = 0;
  }

  /**
   * Advance every burning firework by a tick, pushing once for each.
   *
   * @param {(power:number, spent:number) => void} push
   */
  burnRockets(push) {
    if (this.rockets.length === 0) return;
    const bleed = this.speedBlend * cheats.rocketPower;
    for (const rocket of this.rockets) {
      push(rocket.power * bleed, 1 - rocket.left / rocket.total);
      rocket.left -= 1;
    }
    this.rockets = this.rockets.filter((rocket) => rocket.left > 0);
  }

  /** Unit vector the player is looking along. */
  lookVector(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(cp * Math.sin(this.yaw), Math.sin(this.pitch), -cp * Math.cos(this.yaw));
  }

  selectSlot(index) {
    const next = clamp(index, 0, HOTBAR.length - 1);
    if (next === this.selectedSlot) return;
    this.selectedSlot = next;
    this.emit('hotbar', next);
  }

  cycleSlot(delta) {
    const count = HOTBAR.length;
    this.selectSlot((((this.selectedSlot + delta) % count) + count) % count);
  }

  /** Move the player to a geodetic position, snapping to the given ground height. */
  teleport(lat, lon, groundHeight, clearance = 2) {
    this.frame.setAnchor(lat, lon);
    this.position.set(0, groundHeight + clearance, 0);
    this.snapRender();
    this.velocity.set(0, 0, 0);
    this.lat = lat;
    this.lon = lon;
    this.groundHeight = groundHeight;
    this.elytraDeployed = false;
    this.stopRockets();
    this.onGround = true;
    this.emit('teleport', { lat, lon });
  }

  /** Draw where you actually are — after a teleport, a rebase, or a hold. */
  snapRender() {
    this.renderPosition.copy(this.position);
  }

  /**
   * Where you are, in degrees — from where you are *drawn*, not from where the
   * physics has got to.
   *
   * They are not the same place. Physics runs on a fixed twentieth of a second
   * and the world is drawn somewhere between the last two ticks, so the drawn
   * position trails the physics one by up to a whole tick. Reading the physics
   * position and handing it to the minimap put the marker ahead of the ground
   * under it by exactly that much: nothing at walking pace, but 5.35 m on a
   * Rocket V, which at the minimap's own scale is six or seven pixels of the
   * map sliding out from under you the faster you go.
   *
   * renderPosition is set before this is called, and a teleport snaps them
   * together, so this is the drawn answer at every moment there is one.
   */
  syncGeo() {
    const geo = this.frame.toGeo(this.renderPosition.x, this.renderPosition.z);
    this.lat = geo.lat;
    this.lon = geo.lon;
    return geo;
  }

  /** Deploy or stow the wings. Returns the resulting state. */
  toggleElytra(force) {
    const next = force !== undefined ? force : !this.elytraDeployed;
    this.elytraDeployed = next;
    this.emit('elytra', next);
    return next;
  }

  /**
   * Fire the selected rocket. No cooldown and no timer: like the real thing,
   * you can light another one whenever you want, and lighting one mid-burn
   * simply restarts the burn.
   */
  fireRocket() {
    const item = this.selectedItem;
    const duration = item ? item.duration : 2;
    if (!this.elytraDeployed) return false;
    const total = rocketTicks(duration);
    // Its own power, taken now: a firework in flight is the one you lit, not
    // whichever slot you have scrolled to since.
    this.rockets.push({ left: total, total, power: item ? item.power : 1 });
    // Enough that no human can reach it and small enough to bound the work.
    // Minecraft has no limit because a player cannot light them fast enough to
    // need one; a held key and a cheat can.
    if (this.rockets.length > MAX_LIT) this.rockets.shift();
    this.rocketDuration = duration;
    this.rocketsFired++;
    this.emit('rocket', duration);
    return true;
  }

  /** Start the 2x burst, if it is off cooldown. */
  startSpeedMode() {
    if (this.speedActive) return false;
    if (this.speedCooldown > 0 && !cheats.speedFree) return false;
    this.speedActive = true;
    this.speedRemaining = SPEED_MODE_SECONDS;
    this.emit('speed', true);
    return true;
  }

  /** End the burst early. Only reachable with unlimited speed mode on. */
  stopSpeedMode() {
    if (!this.speedActive) return false;
    this.speedActive = false;
    this.speedRemaining = 0;
    if (!cheats.speedFree) this.speedCooldown = SPEED_MODE_COOLDOWN_S;
    this.emit('speed', false);
    return true;
  }

  tickTimers(dt) {
    // Speed mode comes on like a switch and goes off like momentum. Dropping
    // it used to halve your ground speed between one frame and the next, which
    // is not what running out of anything feels like; now it bleeds away over
    // a few seconds, and a firework still burning holds it up while it does —
    // so a well-timed rocket carries some of the boost past the end of it.
    const target = this.speedActive ? SURGE_FACTOR : 1;
    const rate = target > this.speedBlend ? 8 : this.rocketTicksLeft > 0 ? 0.25 : 0.8;
    this.speedBlend = damp(this.speedBlend, target, rate, dt);
    // An exponential never quite arrives; a per cent is under the noise floor.
    if (Math.abs(this.speedBlend - target) < 0.01) this.speedBlend = target;

    if (this.speedActive && cheats.speedFree) {
      // Unlimited: hold the gauge full rather than counting down.
      this.speedRemaining = SPEED_MODE_SECONDS;
    } else if (this.speedActive) {
      this.speedRemaining -= dt;
      if (this.speedRemaining <= 0) {
        this.speedActive = false;
        this.speedRemaining = 0;
        this.speedCooldown = SPEED_MODE_COOLDOWN_S;
        this.emit('speed', false);
      }
    } else if (this.speedCooldown > 0) {
      this.speedCooldown = Math.max(0, this.speedCooldown - dt);
    }

    this.tickBreath(dt);
  }

  /**
   * Air, while your head is under.
   *
   * Fifteen seconds of it, Minecraft's number, and then you are in trouble.
   * Speed mode spends it four times as fast — you are covering four times the
   * water in the same lungful, so the same lungful has to be worth a quarter
   * of the distance or the boost would make diving *easier*.
   */
  tickBreath(dt) {
    const under = this.submerged;
    if (!under) {
      // Out of the water: a full breath back in a couple of seconds.
      this.airSeconds = Math.min(AIR_SECONDS, this.airSeconds + dt * (AIR_SECONDS / 2));
      this.drowned = false;
      return;
    }
    const burn = this.speedActive ? 4 : 1;
    this.airSeconds -= dt * burn;
    if (this.airSeconds > -DROWNING_SECONDS) return;
    // Out of air and out of time. There is no health bar here, so this ends
    // with getting you somewhere you can breathe rather than a death screen.
    this.airSeconds = AIR_SECONDS;
    if (!this.drowned) {
      this.drowned = true;
      this.emit('drowned', {});
    }
  }

  /** Is your head under the water, rather than merely your feet? */
  get submerged() {
    return this.swimming && this.position.y + this.eyeHeight < 0;
  }
}

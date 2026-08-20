import * as THREE from '../../vendor/three/three.module.js';
import { cheats } from '../core/cheats.js';
import { Emitter } from '../core/events.js';
import { clamp, damp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { rocketPowerFor, rocketTicks } from './elytra.js';

/**
 * Player state: where you are, how fast, how big, what is in the hotbar.
 *
 * Position is authoritative in world space; latitude/longitude are derived from
 * it every frame, which keeps physics in plain metres and means a re-anchor of
 * the local frame is just a coordinate swap.
 */

/**
 * The hotbar is five rockets and nothing else. The number is the burn in
 * seconds — a Rocket V pushes for five of them — and it is the powder behind
 * it too, though that ramp is deliberately gentle so the seconds stay the main
 * thing you are choosing between.
 */
/**
 * One colour per strength, cool to hot, so a glance tells you what you are
 * holding. The same five are used by the rocket in your hand, the hotbar icon
 * and the icon's glow, which is the point: the thing in the world and the
 * thing in the HUD have to be recognisably the same object.
 */
export const ROCKET_COLOURS = ['#8fb8d8', '#74c47a', '#e8c54a', '#e08a35', '#d23f2f'];

export const HOTBAR = [1, 2, 3, 4, 5].map((duration) => ({
  duration,
  power: rocketPowerFor(duration),
  colour: ROCKET_COLOURS[duration - 1],
  label: `Rocket ${'I II III IV V'.split(' ')[duration - 1]}`,
  // Seconds of burn and the thrust multiplier, both true. This used to read
  // "dur 5 · pwr 5", which was two errors in nine characters: the burn was not
  // five of anything, and the power was never the slot number. Kept short
  // enough that the slot does not ellipsise it away.
  hint: `${duration}s · ×${rocketPowerFor(duration).toFixed(2)}`,
}));

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

    this.mode = 'walk'; // walk | glide | fall
    this.onGround = false;
    this.groundHeight = 0;
    this.inBuilding = false;
    this.lat = 0;
    this.lon = 0;

    this.elytraDeployed = false;
    this.swimming = false;

    this.rocketTicksLeft = 0;
    this.rocketTotalTicks = 0;
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
    return clamp(settings.get('playerScale'), 0.25, 60);
  }

  /** Standing height in metres (6 ft 6 in at scale 1). */
  get height() {
    return settings.get('playerHeightM') * this.scale;
  }

  get eyeHeight() {
    return this.height * 0.94;
  }

  get radius() {
    return Math.max(0.3, this.height * 0.21);
  }

  get speed() {
    return this.velocity.length();
  }

  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
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

  /** Firework thrust: the slot's powder and any cheat on top. */
  get rocketPower() {
    const slot = this.selectedItem;
    return (slot ? slot.power : 1) * cheats.rocketPower;
  }

  /** How far through the current burn we are, 0 at ignition and 1 at burnout. */
  get rocketSpent() {
    if (this.rocketTicksLeft <= 0 || this.rocketTotalTicks <= 0) return 1;
    return 1 - this.rocketTicksLeft / this.rocketTotalTicks;
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
    this.rocketTicksLeft = 0;
    this.onGround = true;
    this.emit('teleport', { lat, lon });
  }

  /** Draw where you actually are — after a teleport, a rebase, or a hold. */
  snapRender() {
    this.renderPosition.copy(this.position);
  }

  syncGeo() {
    const geo = this.frame.toGeo(this.position.x, this.position.z);
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
    this.rocketTicksLeft = rocketTicks(duration);
    this.rocketTotalTicks = this.rocketTicksLeft;
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
    this.speedRemaining = settings.get('speedModeDurationS');
    this.emit('speed', true);
    return true;
  }

  /** End the burst early. Only reachable with unlimited speed mode on. */
  stopSpeedMode() {
    if (!this.speedActive) return false;
    this.speedActive = false;
    this.speedRemaining = 0;
    if (!cheats.speedFree) this.speedCooldown = settings.get('speedModeCooldownS');
    this.emit('speed', false);
    return true;
  }

  tickTimers(dt) {
    // Speed mode comes on like a switch and goes off like momentum. Dropping
    // it used to halve your ground speed between one frame and the next, which
    // is not what running out of anything feels like; now it bleeds away over
    // a few seconds, and a firework still burning holds it up while it does —
    // so a well-timed rocket carries some of the boost past the end of it.
    const target = this.speedActive ? 2 : 1;
    const rate = target > this.speedBlend ? 8 : this.rocketTicksLeft > 0 ? 0.25 : 0.8;
    this.speedBlend = damp(this.speedBlend, target, rate, dt);
    // An exponential never quite arrives; a per cent is under the noise floor.
    if (Math.abs(this.speedBlend - target) < 0.01) this.speedBlend = target;

    if (this.speedActive && cheats.speedFree) {
      // Unlimited: hold the gauge full rather than counting down.
      this.speedRemaining = settings.get('speedModeDurationS');
    } else if (this.speedActive) {
      this.speedRemaining -= dt;
      if (this.speedRemaining <= 0) {
        this.speedActive = false;
        this.speedRemaining = 0;
        this.speedCooldown = settings.get('speedModeCooldownS');
        this.emit('speed', false);
      }
    } else if (this.speedCooldown > 0) {
      this.speedCooldown = Math.max(0, this.speedCooldown - dt);
    }
  }

}

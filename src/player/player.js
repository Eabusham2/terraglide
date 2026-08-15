import * as THREE from '../../vendor/three/three.module.js';
import { Emitter } from '../core/events.js';
import { clamp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { rocketTicks } from './elytra.js';

/**
 * Player state: where you are, how fast, how big, what is in the hotbar.
 *
 * Position is authoritative in world space; latitude/longitude are derived from
 * it every frame, which keeps physics in plain metres and means a re-anchor of
 * the local frame is just a coordinate swap.
 */

/** The hotbar is five rockets, flight duration 1 to 5. Nothing else. */
export const HOTBAR = [
  { duration: 1, label: 'Rocket I', hint: 'short hop' },
  { duration: 2, label: 'Rocket II', hint: 'standard' },
  { duration: 3, label: 'Rocket III', hint: 'long' },
  { duration: 4, label: 'Rocket IV', hint: 'climb' },
  { duration: 5, label: 'Rocket V', hint: 'full burn' },
];

export class Player extends Emitter {
  constructor(frame) {
    super();
    this.frame = frame;
    this.position = new THREE.Vector3();
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
    this.rocketDuration = 0;
    this.rocketCooldown = 0;
    this.rocketsFired = 0;

    this.speedActive = false;
    this.speedRemaining = 0;
    this.speedCooldown = 0;

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

  get speedMultiplier() {
    return this.speedActive ? 2 : 1;
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
    this.velocity.set(0, 0, 0);
    this.lat = lat;
    this.lon = lon;
    this.groundHeight = groundHeight;
    this.elytraDeployed = false;
    this.rocketTicksLeft = 0;
    this.onGround = true;
    this.emit('teleport', { lat, lon });
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

  /** Fire the selected rocket, if the hotbar has one and the cooldown allows. */
  fireRocket() {
    const item = this.selectedItem;
    const duration = item ? item.duration : 2;
    if (this.rocketCooldown > 0) return false;
    if (!this.elytraDeployed) return false;
    this.rocketTicksLeft = rocketTicks(duration);
    this.rocketDuration = duration;
    this.rocketCooldown = 0.28 + duration * 0.12;
    this.rocketsFired++;
    this.emit('rocket', duration);
    return true;
  }

  /** Start the 2x burst, if it is off cooldown. */
  startSpeedMode() {
    if (this.speedActive || this.speedCooldown > 0) return false;
    this.speedActive = true;
    this.speedRemaining = settings.get('speedModeDurationS');
    this.emit('speed', true);
    return true;
  }

  tickTimers(dt) {
    if (this.rocketCooldown > 0) this.rocketCooldown = Math.max(0, this.rocketCooldown - dt);
    if (this.speedActive) {
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

import { cheats } from '../core/cheats.js';
import { settings } from '../core/settings.js';
import { formatDistance } from '../core/units.js';
import { clamp } from '../core/math.js';
import { bearing, haversine } from '../geo/mercator.js';

/**
 * Auto-travel — the "baritone" cheat.
 *
 * Give it a point on the map and it flies you there: it turns onto the great
 * circle, takes off if you are standing still, holds a cruise height above
 * whatever ground is coming up, spends rockets when it is low or slow, and puts
 * you down at the far end. It drives the same yaw, pitch and rocket the player
 * does — there is no teleporting and no cheating the flight model, so the trip
 * fills in the map exactly as flying it by hand would.
 *
 * Any movement key cancels it, which is the behaviour you want the first time it
 * points at a mountain.
 */

/** Close enough to start the descent, in metres. */
const ARRIVE_M = 140;
/** Height above the ground ahead to aim for while cruising. */
const CRUISE_AGL = 340;
const MIN_CRUISE_AGL = 90;
/** How fast the autopilot is allowed to turn the head, radians per second. */
const YAW_RATE = 1.8;
const PITCH_RATE = 1.6;
/** Give up if the distance has not improved in this long. */
const STALL_S = 25;

export class Autopilot {
  constructor({ player, terrain, fireRocket, onNotice } = {}) {
    this.player = player;
    this.terrain = terrain;
    this.fireRocket = fireRocket ?? (() => {});
    this.onNotice = onNotice ?? (() => {});
    this.target = null;
    this.label = '';
    this.distance = 0;
    this.phase = 'idle';
    this.elapsed = 0;
    this.best = Infinity;
    this.sinceProgress = 0;
  }

  get active() {
    return this.target !== null;
  }

  engage(lat, lon, label = '') {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    this.target = { lat, lon };
    this.label = label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    this.phase = 'turning';
    this.elapsed = 0;
    this.best = Infinity;
    this.sinceProgress = 0;
    this.distance = haversine({ lat: this.player.lat, lon: this.player.lon }, this.target);
    this.onNotice(`Auto-travel engaged — ${this.label}`);
    return true;
  }

  disengage(reason = '') {
    if (!this.target) return;
    this.target = null;
    this.phase = 'idle';
    if (reason) this.onNotice(reason);
  }

  /** One frame of steering. Returns the movement the controller should use. */
  step(dt, movement) {
    if (!this.active) return movement;
    if (!cheats.unlocked) {
      this.disengage('Auto-travel off');
      return movement;
    }
    // Touching the controls takes it back off the autopilot.
    if (movement.forward || movement.back || movement.left || movement.right) {
      this.disengage('Auto-travel cancelled');
      return movement;
    }

    const player = this.player;
    const here = { lat: player.lat, lon: player.lon };
    this.distance = haversine(here, this.target);
    this.elapsed += dt;

    if (this.distance < this.best - 5) {
      this.best = this.distance;
      this.sinceProgress = 0;
    } else {
      this.sinceProgress += dt;
      if (this.sinceProgress > STALL_S) {
        this.disengage('Auto-travel gave up — no progress');
        return movement;
      }
    }

    this.turnToward(bearing(here, this.target), dt);

    if (this.distance < ARRIVE_M) return this.arrive(dt, movement);
    if (cheats.fly) return this.flyLeg(dt, movement);
    return this.glideLeg(dt, movement);
  }

  /* ------------------------------------------------------------- steering */

  turnToward(target, dt) {
    const player = this.player;
    let delta = target - player.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    player.yaw += clamp(delta, -YAW_RATE * dt, YAW_RATE * dt);
  }

  pitchToward(target, dt) {
    const player = this.player;
    const delta = clamp(target - player.pitch, -PITCH_RATE * dt, PITCH_RATE * dt);
    player.pitch = clamp(player.pitch + delta, -1.4, 1.4);
  }

  /** Highest ground on the next couple of kilometres of track. */
  groundAhead() {
    const player = this.player;
    if (!this.terrain) return player.groundHeight;
    const p = player.position;
    const dx = Math.sin(player.yaw);
    const dz = -Math.cos(player.yaw);
    let highest = this.terrain.heightAt(p.x, p.z);
    for (const reach of [300, 900, 1800]) {
      const h = this.terrain.heightAt(p.x + dx * reach, p.z + dz * reach);
      if (h > highest) highest = h;
    }
    return highest;
  }

  /** Height we want to be at, easing down as the destination approaches. */
  cruiseTarget() {
    const approach = clamp(this.distance * 0.2, MIN_CRUISE_AGL, CRUISE_AGL);
    return this.groundAhead() + approach;
  }

  /* ---------------------------------------------------------------- phases */

  /** Creative flight: point the nose at the right height and hold forward. */
  flyLeg(dt, movement) {
    this.phase = 'cruise';
    const player = this.player;
    const error = this.cruiseTarget() - player.position.y;
    this.pitchToward(clamp(error / 240, -0.7, 0.7), dt);
    return { ...movement, forward: true, sprint: this.distance > 600 };
  }

  /** Wings: take off if needed, then hold a cruise height on rockets and dives. */
  glideLeg(dt, movement) {
    const player = this.player;

    if (player.onGround) {
      this.phase = 'takeoff';
      if (!player.elytraDeployed) player.toggleElytra(true);
      this.pitchToward(0.35, dt);
      return { ...movement, jump: true };
    }

    if (!player.elytraDeployed) player.toggleElytra(true);

    const error = this.cruiseTarget() - player.position.y;
    const speed = player.horizontalSpeed;

    if (error > 30) {
      // Below the line: flare and spend a rocket to climb back onto it.
      this.phase = 'climb';
      this.pitchToward(0.42, dt);
      if (player.rocketTicksLeft <= 0 && player.velocity.y < 6) this.fireRocket();
    } else if (error < -30) {
      this.phase = 'descend';
      this.pitchToward(-0.3, dt);
    } else {
      this.phase = 'cruise';
      // Level flight bleeds speed, so trade a little height back for it.
      this.pitchToward(speed < 24 ? -0.24 : -0.05, dt);
      if (speed < 15 && player.rocketTicksLeft <= 0) this.fireRocket();
    }

    return movement;
  }

  /** Last hundred metres: get down, stow the wings, hand the controls back. */
  arrive(dt, movement) {
    const player = this.player;
    this.phase = 'arriving';

    if (cheats.fly) {
      this.disengage(`Arrived — ${this.label}`);
      return movement;
    }

    // Down is down: standing on it, or floating on it.
    if (player.onGround || player.swimming) {
      this.disengage(`Arrived — ${this.label}`);
      return movement;
    }

    if (player.altitudeAboveGround < 14 && player.elytraDeployed) {
      player.toggleElytra(false);
    }
    this.pitchToward(-0.5, dt);
    return movement;
  }

  /** One-line readout for the cheat panel. */
  status() {
    if (!this.active) return '';
    // Through the formatter, like every other distance. This printed
    // kilometres and metres whatever the units setting said — one of the
    // places "both systems everywhere, not only in some places" was pointing
    // at, and it sat in the cheat panel next to readouts that did honour it.
    const away = formatDistance(this.distance, settings.get('units'), 1);
    return `${this.phase} · ${away} to ${this.label}`;
  }
}

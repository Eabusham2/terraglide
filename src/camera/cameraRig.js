import * as THREE from '../../vendor/three/three.module.js';
import { clamp, damp } from '../core/math.js';
import { settings } from '../core/settings.js';

/**
 * Camera rig: first person, third person, and the freecam.
 *
 * Yaw is a compass bearing — 0 is north, and it grows clockwise, the same
 * number the HUD, the minimap and the autopilot all use. Forward is therefore
 * (sin yaw, 0, −cos yaw), and the camera's own Y rotation has to be the
 * *negative* of it, because three.js measures its Euler the other way round.
 * Getting that backwards is what used to send you off at an angle to wherever
 * you were looking.
 *
 * The view does not roll. Turning hard in a glide used to bank the horizon,
 * which reads as the world tilting rather than you turning; it is now flat like
 * Minecraft's, and the only thing that rolls the camera is a barrel roll you
 * asked for.
 */

const PITCH_LIMIT = Math.PI / 2 - 0.02;
/** One barrel roll, in seconds. */
const ROLL_TIME = 0.8;
/** Frequency of the rocket shove, in hertz. Low enough to read as a push. */
const SHAKE_HZ = 7;

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.fov = settings.get('fov');
    this.roll = 0;
    this.thirdPersonDistance = 1;
    this.shake = 0;
    this.shakeTime = 0;
    /** Damped ground clamp for the chase camera. */
    this._floor = NaN;
    this.freecam = {
      active: false,
      position: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      speed: 40,
      velocity: new THREE.Vector3(),
    };
    this._offset = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  get isFreecam() {
    return this.freecam.active;
  }

  toggleFreecam(player) {
    const cam = this.freecam;
    cam.active = !cam.active;
    if (cam.active) {
      cam.position.copy(this.camera.position);
      cam.yaw = player.yaw;
      cam.pitch = player.pitch;
      cam.velocity.set(0, 0, 0);
    }
    return cam.active;
  }

  applyLook(player, dx, dy) {
    // Mouse right turns you clockwise, which *increases* a compass bearing.
    if (this.freecam.active) {
      this.freecam.yaw += dx;
      this.freecam.pitch = clamp(this.freecam.pitch - dy, -PITCH_LIMIT, PITCH_LIMIT);
      return;
    }
    player.yaw += dx;
    player.pitch = clamp(player.pitch - dy, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** Start a barrel roll, if the option is on and one is not already running. */
  startBarrelRoll() {
    if (!settings.get('barrelRoll') || this.rolling) return false;
    this.rolling = 0.0001;
    return true;
  }

  adjustFreecamSpeed(delta) {
    this.freecam.speed = clamp(this.freecam.speed * (delta > 0 ? 0.8 : 1.25), 1, 20000);
    return this.freecam.speed;
  }

  updateFreecam(dt, input, groundHeight) {
    const cam = this.freecam;
    const forward = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const lift = (input.jump ? 1 : 0) - (input.crouch ? 1 : 0);
    const boost = input.sprint ? 4 : 1;

    const sin = Math.sin(cam.yaw);
    const cos = Math.cos(cam.yaw);
    const cosPitch = Math.cos(cam.pitch);
    const target = new THREE.Vector3(
      (sin * cosPitch * forward + cos * strafe) * cam.speed * boost,
      (Math.sin(cam.pitch) * forward + lift) * cam.speed * boost,
      (-cos * cosPitch * forward + sin * strafe) * cam.speed * boost,
    );

    cam.velocity.x = damp(cam.velocity.x, target.x, 9, dt);
    cam.velocity.y = damp(cam.velocity.y, target.y, 9, dt);
    cam.velocity.z = damp(cam.velocity.z, target.z, 9, dt);
    cam.position.addScaledVector(cam.velocity, dt);
    // Do not let the freecam bury itself in the ground.
    cam.position.y = Math.max(cam.position.y, groundHeight + 0.5);
  }

  update(player, dt, terrain) {
    const camera = this.camera;
    const speedKick = settings.get('speedFovKick')
      ? clamp(player.horizontalSpeed / 90, 0, 1) * 16 + (player.speedActive ? 6 : 0)
      : 0;
    const targetFov = (this.freecam.active ? settings.get('freecamFov') : settings.get('fov')) + speedKick;
    this.fov = damp(this.fov, targetFov, 5, dt);
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }

    if (this.freecam.active) {
      camera.position.copy(this.freecam.position);
      this._euler.set(this.freecam.pitch, -this.freecam.yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(this._euler);
      return;
    }

    // The only roll is a barrel roll, and only if you asked for one.
    if (this.rolling) {
      this.rolling += dt / ROLL_TIME;
      if (this.rolling >= 1) this.rolling = 0;
    }
    this.roll = this.rolling ? this.rolling * Math.PI * 2 : 0;

    const eye = player.eyeHeight;
    this._target.set(player.position.x, player.position.y + eye, player.position.z);

    const perspective = settings.get('perspective');
    if (perspective === 'third' || perspective === 'second') {
      // Second person is the same rig turned around: the camera sits in front
      // of you looking back, so you fly toward it and can see your own face.
      const behind = perspective === 'third' ? 1 : -1;
      const distance = 3.4 * player.height;
      const cosPitch = Math.cos(player.pitch);
      this._offset.set(
        -Math.sin(player.yaw) * cosPitch * behind,
        (-Math.sin(player.pitch) + 0.28) * behind,
        Math.cos(player.yaw) * cosPitch * behind,
      );
      this._offset.normalize().multiplyScalar(distance);
      const desired = this._target.clone().add(this._offset);
      // Damp the ground clamp rather than applying it raw: heightAt steps as
      // terrain LOD swaps under the camera, and a raw clamp turns every one of
      // those steps into a visible jolt.
      const floor = terrain ? terrain.heightAt(desired.x, desired.z) + player.height * 0.35 : -Infinity;
      this._floor = Number.isFinite(this._floor) ? damp(this._floor, floor, 6, dt) : floor;
      desired.y = Math.max(desired.y, this._floor);
      // Tight enough that the view is where you pointed it, not trailing it.
      camera.position.lerpVectors(camera.position, desired, 1 - Math.exp(-24 * dt));
      camera.lookAt(this._target);
      if (this.roll) camera.rotateZ(this.roll);
    } else {
      camera.position.copy(this._target);
      this._euler.set(player.pitch, -player.yaw, this.roll, 'YXZ');
      camera.quaternion.setFromEuler(this._euler);
    }

    // The rocket kick used to be a fresh random offset every frame, which is
    // the definition of jitter — and third person compounded it, because the
    // camera is also chasing a lerp target that the shake keeps moving. It is
    // now a smooth decaying oscillation: continuous frame to frame, so it
    // reads as a shove rather than a glitch.
    if (this.shake > 0.001) {
      this.shakeTime += dt;
      const amount = this.shake;
      const t = this.shakeTime * SHAKE_HZ * Math.PI * 2;
      camera.position.x += Math.sin(t * 1.0) * amount * 0.5;
      camera.position.y += Math.sin(t * 1.7 + 1.1) * amount * 0.5;
      camera.position.z += Math.sin(t * 1.3 + 2.3) * amount * 0.5;
      this.shake = damp(this.shake, 0, 6, dt);
    }
  }

  kick(amount) {
    this.shake = Math.min(0.6, this.shake + amount);
  }
}

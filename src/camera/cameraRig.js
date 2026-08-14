import * as THREE from '../../vendor/three/three.module.js';
import { clamp, damp } from '../core/math.js';
import { settings } from '../core/settings.js';

/**
 * Camera rig: first person, third person, and the freecam.
 *
 * Field of view widens with speed (subtly, and only if you leave the toggle on),
 * the horizon rolls a little when you bank in a glide, and the third-person
 * camera refuses to sink into the ground or into a building floor.
 */

const PITCH_LIMIT = Math.PI / 2 - 0.02;

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.fov = settings.get('fov');
    this.roll = 0;
    this.thirdPersonDistance = 1;
    this.shake = 0;
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
    if (this.freecam.active) {
      this.freecam.yaw -= dx;
      this.freecam.pitch = clamp(this.freecam.pitch - dy, -PITCH_LIMIT, PITCH_LIMIT);
      return;
    }
    player.yaw -= dx;
    player.pitch = clamp(player.pitch - dy, -PITCH_LIMIT, PITCH_LIMIT);
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
      this._euler.set(this.freecam.pitch, this.freecam.yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(this._euler);
      return;
    }

    // Bank the horizon slightly when turning in a glide.
    const turning = player.mode === 'glide' ? clamp(-this.yawRate * 2.2, -0.5, 0.5) : 0;
    this.roll = damp(this.roll, turning, 4, dt);

    const eye = player.eyeHeight;
    this._target.set(player.position.x, player.position.y + eye, player.position.z);

    if (settings.get('thirdPerson')) {
      const distance = 3.4 * player.height;
      const cosPitch = Math.cos(player.pitch);
      this._offset.set(
        -Math.sin(player.yaw) * cosPitch,
        -Math.sin(player.pitch) + 0.28,
        Math.cos(player.yaw) * cosPitch,
      );
      this._offset.normalize().multiplyScalar(distance);
      const desired = this._target.clone().add(this._offset);
      const floor = terrain ? terrain.heightAt(desired.x, desired.z) + player.height * 0.35 : -Infinity;
      desired.y = Math.max(desired.y, floor);
      camera.position.lerpVectors(camera.position, desired, 1 - Math.exp(-14 * dt));
      camera.lookAt(this._target);
      camera.rotateZ(this.roll);
    } else {
      camera.position.copy(this._target);
      this._euler.set(player.pitch, player.yaw, this.roll, 'YXZ');
      camera.quaternion.setFromEuler(this._euler);
    }

    if (this.shake > 0.001) {
      const amount = this.shake;
      camera.position.x += (Math.random() - 0.5) * amount;
      camera.position.y += (Math.random() - 0.5) * amount;
      camera.position.z += (Math.random() - 0.5) * amount;
      this.shake = damp(this.shake, 0, 5, dt);
    }
  }

  /** Called by the game each frame so banking knows how fast you are turning. */
  setYawRate(rate) {
    this.yawRate = rate;
  }

  kick(amount) {
    this.shake = Math.min(0.6, this.shake + amount);
  }
}

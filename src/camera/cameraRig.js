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
/**
 * How far in front of the body's axis the eyes sit, as a fraction of height.
 *
 * The chest is a box fifteen hundredths of a height deep, so its front face is
 * seven and a half hundredths forward of the spine. A sixth of a height put
 * the camera a further eight hundredths in front of *that* — outside your own
 * jacket — and the result was that looking down showed you nothing at all
 * until you were pointing almost straight at your boots, and then showed you
 * the tops of your shoulders from above. Ten hundredths is twenty centimetres
 * on a grown adult: just clear of the chest, so glancing down finds your
 * chest, then your legs, then your feet, the way it does in the mod this is
 * meant to look like.
 */
const EYE_FORWARD = 0.1;
/**
 * How fast a held roll turns you, in radians a second.
 *
 * A shade over one full revolution every two seconds at full deflection, which
 * is quick enough to feel like an aircraft and slow enough to stop halfway and
 * hold a bank.
 */
/**
 * How many points along the way out to check for ground, and how far in the
 * camera may be pulled.
 *
 * Six is enough to catch a hillside without costing anything — heightAt is a
 * lookup into a field that is already in memory. A third of the way out is
 * close, but closer than that and you are inside your own shoulders, which is
 * worse than a grazing view of a hill.
 */
const CHASE_PROBES = 6;
const CHASE_MIN_REACH = 0.34;

const ROLL_RATE = 3.4;
/**
 * How fast the wings come back level when you stop asking.
 *
 * Slow, so a deliberate bank stays where you put it for a second or two and you
 * are not fighting the controls to hold a turn; fast enough that letting go
 * always ends level rather than leaving you inverted.
 */
const ROLL_RECOVER = 1.6;
/** Frequency of the rocket shove, in hertz. Low enough to read as a push. */
const SHAKE_HZ = 7;

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.fov = settings.get('fov');
    this.roll = 0;
    this.thirdPersonDistance = 1;
    /** How far into a prone glide you are, for the eye lean. */
    this.prone = 0;
    /** How far out the chase camera is allowed this frame, 0 to 1. */
    this._reach = NaN;
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

  /**
   * Roll, the way the mod does it.
   *
   * This was a key: press X and a canned three-hundred-and-sixty went round
   * over eight tenths of a second whatever you were doing, then stopped. That
   * is a stunt button, not a control surface, and "implement it like the mod,
   * not as a keybind" is exactly the difference.
   *
   * So it is the strafe keys, held, while you are gliding — the only time an
   * aircraft has anything to roll about, and the only time those keys were not
   * already doing something. Hold one and you keep rolling, all the way over
   * and round again if you want; let go and the wings come back level. A full
   * barrel roll is still there, but you fly it rather than trigger it.
   *
   * @param {number} dt
   * @param {number} input  -1 to 1, left to right
   * @param {boolean} flying  gliding or in creative flight
   */
  updateRoll(dt, input, flying) {
    if (!flying) {
      // On your feet the horizon is the horizon.
      this.roll = damp(this.roll, 0, ROLL_RECOVER * 2, dt);
      if (Math.abs(this.roll) < 0.002) this.roll = 0;
      return;
    }
    if (input !== 0) {
      this.roll += input * ROLL_RATE * dt;
      // Keep it in one turn either way so the number stays readable and the
      // recovery below always takes the short way round.
      const turn = Math.PI * 2;
      if (this.roll > Math.PI) this.roll -= turn;
      else if (this.roll < -Math.PI) this.roll += turn;
      return;
    }
    this.roll = damp(this.roll, 0, ROLL_RECOVER, dt);
    if (Math.abs(this.roll) < 0.002) this.roll = 0;
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

  update(player, dt, terrain, input) {
    const camera = this.camera;
    // Roll comes from the strafe keys while you are flying. See updateRoll.
    const lateral = input ? (input.right ? 1 : 0) - (input.left ? 1 : 0) : 0;
    this.updateRoll(dt, lateral, player.mode === 'glide' || player.mode === 'fly');
    // How fast you are actually going, and nothing else.
    //
    // There used to be a flat six degrees on top while speed mode was running,
    // because `horizontalSpeed` was the bare velocity and did not know about
    // it. It does now — it is the speed you travel at, multiplier included — so
    // the bonus counted the same boost twice and the view lurched wider than
    // the speed justified.
    const speedKick = settings.get('speedFovKick')
      ? clamp(player.horizontalSpeed / 90, 0, 1) * 16
      : 0;
    const targetFov = (this.freecam.active ? settings.get('freecamFov') : settings.get('fov')) + speedKick;
    // Opens quickly and closes slowly.
    //
    // One rate for both meant the view took about six tenths of a second to
    // widen — and a rocket has already done most of its work by then: lit from
    // 8 m/s, a Rocket I puts you at 20.8 by the first tick and 30.4 by the
    // third. The acceleration was over before the camera acknowledged it, which
    // is why it read as no kick at all rather than as a fast one.
    //
    // Asymmetric is also just how it should feel: speed arriving is a shove,
    // and speed bleeding away is a drift.
    const opening = targetFov > this.fov;
    this.fov = damp(this.fov, targetFov, opening ? 14 : 4, dt);
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

    const eye = player.eyeHeight;
    // The drawn position, not the physics one — see Player.renderPosition.
    const at = player.renderPosition;
    this._target.set(at.x, at.y + eye, at.z);

    // Your eyes are in your face, not on your spine.
    //
    // Sitting the first-person camera on the body's own axis puts the chest
    // directly beneath it, so looking down is a wall of jacket rather than a
    // view of yourself — which is why the body used to be cut in half to get
    // out of the way. Moving the camera forward to where a face is instead
    // keeps the whole body and still leaves the chest a comfortable distance
    // below and behind. Horizontal only, and along the compass heading rather
    // than the look vector, so pitching down does not walk the camera through
    // your own ribs.
    //
    // And only while you are standing in it. The lean exists because your
    // chest sits directly under your eye when you are upright; face down in a
    // glide your chest is behind you instead, so it buys nothing there — and
    // it costs eighteen centimetres of the thirty-six an arm can reach in
    // front of the camera at all, which is what left a first-person glide with
    // no hands, no arms and no firework anywhere on the screen. Damped rather
    // than switched, so opening the wings does not jog the view.
    this.prone = damp(this.prone, player.elytraDeployed && !player.onGround ? 1 : 0, 6, dt);
    if (settings.get('perspective') === 'first') {
      const lean = player.height * EYE_FORWARD * (1 - this.prone);
      this._target.x += Math.sin(player.yaw) * lean;
      this._target.z += -Math.cos(player.yaw) * lean;
    }

    const perspective = settings.get('perspective');
    if (perspective === 'third' || perspective === 'second') {
      // Second person is the same rig turned around: the camera sits in front
      // of you looking back, so you fly toward it and can see your own face.
      const behind = perspective === 'third' ? 1 : -1;
      // Minecraft's chase camera sits four blocks off a 1.8 m player, which
      // puts the figure at roughly a third of the frame height. Ours was at
      // 3.4 heights and put it at a sixth — far enough that you were watching
      // a distant doll rather than steering yourself.
      const distance = 2.6 * player.height;
      const cosPitch = Math.cos(player.pitch);
      this._offset.set(
        -Math.sin(player.yaw) * cosPitch * behind,
        (-Math.sin(player.pitch) + 0.28) * behind,
        Math.cos(player.yaw) * cosPitch * behind,
      );
      this._offset.normalize().multiplyScalar(distance);

      // Come in closer when the hill is in the way, rather than climbing it.
      //
      // The camera used to be pushed straight up out of any ground it landed
      // in. On flat country that is right and invisible. On a slope it is
      // neither: standing on a hillside puts the camera a couple of metres
      // back and, once raised, about sixty centimetres above the slope looking
      // straight along it — and a photograph seen at a grazing angle is
      // stretched to hundreds of texels a pixel. That is the smeared dark band
      // across half the frame whenever you stand on anything steep, and no
      // amount of filtering fixes it because the geometry is what is wrong.
      //
      // So the line from you to where the camera wants to be is walked, and it
      // stops short of whatever gets in the way. Which is what a chase camera
      // in anything else does: it comes closer, it does not climb the scenery.
      let reach = 1;
      if (terrain) {
        const clearance = player.height * 0.35;
        for (let step = 1; step <= CHASE_PROBES; step += 1) {
          const t = step / CHASE_PROBES;
          const ground = terrain.heightAt(
            this._target.x + this._offset.x * t,
            this._target.z + this._offset.z * t,
          );
          if (this._target.y + this._offset.y * t < ground + clearance) {
            reach = (step - 1) / CHASE_PROBES;
            break;
          }
        }
      }
      // Never all the way in: inside your own head is worse than a grazing
      // hillside. Damped for the same reason the floor was — heightAt steps as
      // the terrain LOD swaps under it, and a raw value turns every step into
      // a jolt.
      reach = Math.max(CHASE_MIN_REACH, reach);
      this._reach = Number.isFinite(this._reach) ? damp(this._reach, reach, 8, dt) : reach;
      const desired = this._target.clone().addScaledVector(this._offset, this._reach);
      // And a floor underneath all of it, for the case the probe cannot see:
      // ground that rose after the camera was already there.
      const floor = terrain ? terrain.heightAt(desired.x, desired.z) + player.height * 0.35 : -Infinity;
      this._floor = Number.isFinite(this._floor) ? damp(this._floor, floor, 6, dt) : floor;
      desired.y = Math.max(desired.y, this._floor);
      // Tight enough that the view is where you pointed it, not trailing it —
      // and tighter the faster you go. A fixed rate lags a fast-moving target
      // and then catches up, and lag-then-catch-up at eighty metres a second
      // is exactly the third-person jitter: the figure swims about in the
      // frame instead of sitting in it. At speed the camera is rigid.
      const chase = 24 + clamp(player.horizontalSpeed, 0, 90) * 0.9;
      camera.position.lerpVectors(camera.position, desired, 1 - Math.exp(-chase * dt));
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
      // The chase camera is already easing toward a moving target, so a shove
      // applied on top of that reads as twice the disturbance it does from
      // inside your own head. Third and second person get a third of it.
      const amount = this.shake * (perspective === 'first' ? 1 : 0.34);
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

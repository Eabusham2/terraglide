import * as THREE from '../../vendor/three/three.module.js';
import { Emitter } from '../core/events.js';
import { clamp } from '../core/math.js';
import { DEADZONE } from './gamepad.js';

/**
 * Virtual reality, through WebXR: a headset's own browser (Quest, Pico, Vision
 * Pro), or a desktop browser with a PC headset plugged in.
 *
 * You are where the game's camera would be in first person, and you look with
 * your head: where you look is where the wings take you, as the mouse is on a
 * screen. The left stick walks and banks, the right one turns you a step at a
 * time (smooth turning in a headset makes people ill), and the buttons are a
 * controller's (camera/gamepad.js, readXRSources).
 *
 * The game keeps its world as it is and moves the headset's reference space
 * to the player instead: each frame the space's origin is put at your eye,
 * turned to face the way you are flying. three.js then writes the headset's
 * pose onto the game's own camera (WebXRManager.updateUserCamera), so every
 * part of the game that asks where the camera is gets the true answer. A bank
 * that turns the glider turns that space with it, so the world comes round as
 * it would.
 *
 * The page's own HUD is HTML and a headset does not show it, so a small panel
 * of the numbers that matter hangs below the view: speed, height, hearts, the
 * rocket in hand, and the last thing the game said.
 */

/** The HUD's heart, nine by eight. */
const HEART = typeof Path2D === 'function'
  ? new Path2D('M1 0h2v1h1v1h1V1h1V0h2v1h1v3H8v1H7v1H6v1H5v1H4V7H3V6H2V5H1V4H0V1h1z')
  : null;

/** A stick pushed this far turns you; back under the dead zone, it may turn you again. */
const SNAP_AT = 0.65;
/** Degrees a snap turn turns. */
export const SNAP_DEG = 30;
/** How often the panel's numbers are drawn again, seconds. */
const HUD_EVERY_S = 0.25;

/**
 * The reference-space offset that puts a headset's origin at `eye`, turned
 * `yaw` (the game's convention: a compass bearing in radians, clockwise from
 * north). The space's origin is to be where the rig is, so the offset is the
 * rig's transform inverted: rotation by -angle, then the eye carried round
 * with it. three.js turns the scene about Y by -yaw for a bearing of yaw.
 */
export function rigOffset(eye, yaw) {
  const angle = -yaw;
  // The inverse of T(eye)·R(angle) is R(-angle)·T(-eye).
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  const x = -eye.x;
  const z = -eye.z;
  return {
    position: { x: c * x + s * z, y: -eye.y, z: -s * x + c * z },
    orientation: { x: 0, y: Math.sin(-angle / 2), z: 0, w: Math.cos(-angle / 2) },
  };
}

/** Scratch for beforeRender. */
const CORRECTION = new THREE.Matrix4();
const FROM = new THREE.Matrix4();

/** A placement of the headset's space ({origin, yaw}) as the matrix that takes its coordinates to the world's. */
export function rigMatrix(placement, out = new THREE.Matrix4()) {
  out.makeRotationY(-placement.yaw);
  out.setPosition(placement.origin.x, placement.origin.y, placement.origin.z);
  return out;
}

/** Where the head is looking, as the game keeps it: bearing and pitch from a world quaternion. */
const headEuler = new THREE.Euler();
export function headLook(quaternion) {
  headEuler.setFromQuaternion(quaternion, 'YXZ');
  return { yaw: -headEuler.y, pitch: headEuler.x };
}

export class VRMode extends Emitter {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.PerspectiveCamera} camera
   */
  constructor(renderer, camera) {
    super();
    this.renderer = renderer;
    this.camera = camera;
    this.supported = false;
    this.session = null;
    this.baseSpace = null;
    /** Which way the headset's forward points in the world, as a bearing. Turns, banks and arrivals move it. */
    this.yawOffset = 0;
    /** The bearing the head gave the player this frame, so whatever turns them after it can be carried. See afterUpdate. */
    this.headYaw = null;
    /**
     * Where the head was in the headset's own space when the session began.
     * A 'local' space is meant to start at the head, and on some headsets
     * starts at the floor instead, a metre and a half below it; either way
     * that first head is put at the player's eye. See place.
     */
    this.headStart = null;
    this.snapArmed = true;
    this.hud = null;
    this.hudTimer = 0;
    this.lastLine = '';
    /**
     * Where the headset's space is put, as {origin, yaw}: `spaceSet` the last
     * one handed to three.js, `poseFrom` the one this frame's head pose was
     * read in, and `target` where the eye is now. See place and beforeRender.
     */
    this.spaceSet = null;
    this.poseFrom = null;
    this.target = null;
    renderer.xr.enabled = true;
    // Seated: the origin is where your head is when it starts, which is the
    // player's eye. A floor would put a seated player's eyes at their knees.
    renderer.xr.setReferenceSpaceType('local');
    // Out of the headset when three.js has finished with it - presenting no
    // more and its own sizes put back - so a resize then is not refused.
    renderer.xr.addEventListener?.('sessionend', () => {
      if (this.session) this.ended();
    });
    this.checkSupport();
    globalThis.navigator?.xr?.addEventListener?.('devicechange', () => this.checkSupport());
  }

  async checkSupport() {
    let ok = false;
    try {
      ok = !!(await globalThis.navigator?.xr?.isSessionSupported?.('immersive-vr'));
    } catch {
      ok = false;
    }
    if (ok !== this.supported) {
      this.supported = ok;
      this.emit('support', ok);
    }
    return ok;
  }

  get presenting() {
    return !!this.session && this.renderer.xr.isPresenting;
  }

  /** The headset's hand controllers, for camera/gamepad.js. */
  inputSources() {
    return this.session ? [...this.session.inputSources] : null;
  }

  /**
   * Into the headset. Must come from a click or a button press: browsers
   * only open a session for one.
   *
   * @param {number} yaw the bearing to face, the player's own
   */
  async enter(yaw = 0) {
    if (this.session) return true;
    const xr = globalThis.navigator?.xr;
    if (!xr) throw new Error('This browser has no WebXR');
    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    this.session = session;
    this.yawOffset = yaw;
    this.headYaw = null;
    this.headStart = null;
    this.spaceSet = null;
    this.poseFrom = null;
    this.target = null;
    try {
      await this.renderer.xr.setSession(session);
    } catch (error) {
      this.session = null;
      session.end().catch(() => {});
      throw error;
    }
    this.baseSpace = this.renderer.xr.getReferenceSpace();
    // The cameras are brought up to date by beforeRender, not by three.js on
    // its own: see there.
    this.renderer.xr.cameraAutoUpdate = false;
    this.buildHud();
    this.emit('start');
    return true;
  }

  exit() {
    this.session?.end().catch(() => {});
  }

  ended() {
    this.session = null;
    this.baseSpace = null;
    this.spaceSet = null;
    this.poseFrom = null;
    this.target = null;
    this.renderer.xr.cameraAutoUpdate = true;
    if (this.hud) this.hud.mesh.visible = false;
    this.emit('end');
  }

  /**
   * The top of a frame: the head pose three.js has just read for it was read
   * in the space set last frame.
   */
  frameStart() {
    if (this.presenting) this.poseFrom = this.spaceSet;
  }

  /**
   * Start of a frame: the head says where the player looks. The bearing the
   * headset reports is the world one, so it is the player's; the pitch too.
   */
  readHead(player, freecam = null) {
    if (!this.presenting) return;
    const look = headLook(this.camera.quaternion);
    const target = freecam?.active ? freecam : player;
    target.yaw = look.yaw;
    target.pitch = clamp(look.pitch, -1.55, 1.55);
    this.headYaw = look.yaw;
  }

  /**
   * After the game has moved the player: a banked turn, an arrival facing
   * somewhere, a mouse - anything that changed the bearing since the head set
   * it turns the headset's world with it, or the head would put it back.
   * Then the right stick, a step at a time.
   */
  afterUpdate(player, pad, freecam = null) {
    if (!this.presenting) return;
    const target = freecam?.active ? freecam : player;
    if (this.headYaw !== null) this.yawOffset += target.yaw - this.headYaw;
    this.headYaw = null;
    // A hand controller's right stick, or an ordinary controller's: in a
    // headset either one turns, since the head is what looks.
    const x = pad?.state ? pad.state.rx : 0;
    if (Math.abs(x) < DEADZONE) this.snapArmed = true;
    else if (this.snapArmed && Math.abs(x) > SNAP_AT) {
      this.snapArmed = false;
      const turn = Math.sign(x) * (SNAP_DEG * Math.PI) / 180;
      this.yawOffset += turn;
      target.yaw += turn;
    }
  }

  /**
   * The headset's origin to the eye, facing the way the player was facing
   * before they turned their head (`yawOffset`, the bearing of the headset's
   * forward in the world): for this frame through beforeRender, and handed to
   * three.js for the next.
   */
  place(eye) {
    if (!this.presenting || !this.baseSpace || typeof XRRigidTransform !== 'function') return;
    // Where the head started, in the headset's own space, from the frame
    // itself. See headStart.
    if (!this.headStart) {
      try {
        const pose = this.renderer.xr.getFrame?.()?.getViewerPose?.(this.baseSpace);
        const p = pose?.transform?.position;
        if (p) this.headStart = { x: p.x, y: p.y, z: p.z };
      } catch {
        /* no frame yet: the next one */
      }
    }
    const start = this.headStart ?? { x: 0, y: 0, z: 0 };
    const c = Math.cos(this.yawOffset);
    const s = Math.sin(this.yawOffset);
    const origin = {
      x: eye.x - (c * start.x - s * start.z),
      y: eye.y - start.y,
      z: eye.z - (s * start.x + c * start.z),
    };
    this.target = { origin, yaw: this.yawOffset };
    const offset = rigOffset(origin, this.yawOffset);
    const transform = new XRRigidTransform(
      { ...offset.position, w: 1 },
      offset.orientation,
    );
    this.renderer.xr.setReferenceSpace(this.baseSpace.getOffsetReferenceSpace(transform));
    this.spaceSet = this.target;
  }

  /**
   * Just before drawing: the cameras three.js draws the eyes with, from the
   * head pose, then moved from where that pose was read to where the eye is.
   *
   * three.js reads the head pose before the game's frame runs, in the space
   * set the frame before, so on its own every frame was drawn from where the
   * eye was a frame ago: a metre behind your own body at flying speed, and on
   * the frame the world re-centres - every forty kilometres - or you are
   * teleported, from forty kilometres away, a flash of empty sky. Moved by
   * the difference between the two placements, the head is where it is now.
   */
  beforeRender(camera) {
    if (!this.presenting) return;
    const xr = this.renderer.xr;
    xr.updateCamera(camera);
    if (!this.target) return;
    rigMatrix(this.target, CORRECTION);
    if (this.poseFrom) CORRECTION.multiply(rigMatrix(this.poseFrom, FROM).invert());
    const cameraXR = xr.getCamera();
    for (const eye of [cameraXR, ...cameraXR.cameras]) {
      eye.matrixWorld.premultiply(CORRECTION);
      eye.matrixWorldInverse.copy(eye.matrixWorld).invert();
    }
    // And the game's own camera, as three.js would have left it: the panel
    // and the arms ride it, and the next frame reads the head off it.
    if (camera.parent) camera.matrix.copy(camera.parent.matrixWorld).invert().multiply(cameraXR.matrixWorld);
    else camera.matrix.copy(cameraXR.matrixWorld);
    camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
    camera.updateMatrixWorld(true);
  }

  /* --------------------------------------------------------------- the panel */

  buildHud() {
    if (this.hud) {
      this.hud.mesh.visible = true;
      return;
    }
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    // Half a metre wide, a metre and a bit ahead and well below the eye line:
    // there when you glance down, out of the way when you do not.
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.156), material);
    mesh.position.set(0, -0.42, -1.1);
    mesh.rotation.x = -0.35;
    mesh.renderOrder = 10000;
    mesh.frustumCulled = false;
    // The game's camera carries the headset's pose (see the top of this
    // file), so a child of it goes where the head goes.
    this.camera.add(mesh);
    this.hud = { canvas, context: canvas.getContext('2d'), texture, mesh };
  }

  /** A line the game said - a toast - for the panel. */
  say(text) {
    this.lastLine = String(text ?? '').slice(0, 64);
    this.lastLineAt = performance.now();
    this.hudTimer = HUD_EVERY_S;
  }

  /**
   * The panel's numbers, a few times a second.
   *
   * @param {number} dt
   * @param {{speed: string, height: string, hearts: number, maxHearts: number, item: string}} info
   */
  updateHud(dt, info) {
    const hud = this.hud;
    if (!hud || !this.presenting) return;
    this.hudTimer += dt;
    if (this.hudTimer < HUD_EVERY_S) return;
    this.hudTimer = 0;
    const g = hud.context;
    const w = hud.canvas.width;
    const h = hud.canvas.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(20, 20, 16, 0.72)';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d8c48a';
    g.fillRect(0, 0, 4, h);
    g.font = '600 34px system-ui, sans-serif';
    g.fillStyle = '#f0ece2';
    g.textBaseline = 'top';
    g.fillText(info.speed, 18, 14);
    g.textAlign = 'right';
    g.fillText(info.height, w - 16, 14);
    g.textAlign = 'left';
    g.font = '24px system-ui, sans-serif';
    // The HUD's own pixel heart (styles/main.css, .heart-icon), one per two
    // points: a drawn shape, not a glyph a headset's font may not have.
    g.fillStyle = '#c8302b';
    const hearts = Math.ceil(Math.max(0, Math.round(info.hearts)) / 2);
    for (let i = 0; i < hearts && HEART; i++) {
      g.save();
      g.translate(18 + i * 24, 66);
      g.scale(2.2, 2.2);
      g.fill(HEART);
      g.restore();
    }
    g.fillStyle = '#b8b2a4';
    g.textAlign = 'right';
    g.fillText(info.item, w - 16, 62);
    g.textAlign = 'left';
    const fresh = this.lastLine && performance.now() - (this.lastLineAt ?? 0) < 6000;
    g.fillStyle = '#d8c48a';
    g.fillText(fresh ? this.lastLine : '', 18, 112);
    hud.texture.needsUpdate = true;
  }
}

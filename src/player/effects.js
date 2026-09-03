import * as THREE from '../../vendor/three/three.module.js';
import { ROCKET_COLOURS } from './player.js';

/**
 * The two things a flying figure was missing: a shadow to stand on and a
 * trail behind the fireworks.
 *
 * Both are drawn rather than simulated, and deliberately so. Real shadow
 * mapping is not available here: the terrain, the edge wall, the sea floor and
 * the weather are all hand-written ShaderMaterials, and a depth-mapped shadow
 * needs every receiver to sample the map — which would mean rewriting five
 * shaders to buy one soft edge, on machines that are already dropping tiers to
 * hold their frame rate. A contact shadow does the job a shadow actually does,
 * which is to say where you are: without one a figure over ground reads as
 * pasted onto it, and height is unguessable.
 */

/** How far up before the shadow has faded out entirely. */
const SHADOW_FADE_M = 60;
/** Radius on the ground when standing, in metres, before scale. */
const SHADOW_RADIUS_M = 0.55;
/** How much wider it spreads at the top of the fade. */
const SHADOW_SPREAD = 4;

/**
 * A soft dark ellipse on the ground under the player.
 *
 * Laid on the surface the player is actually standing on rather than on the
 * height field, so it sits on a photogrammetric street as readily as on the
 * relief — the same answer the controller uses for the floor. It widens and
 * fades with height, which is what a real penumbra does and what makes it
 * readable as altitude rather than as a decal.
 */
export class ContactShadow {
  constructor(scene) {
    // A radial gradient baked once. Cheaper than a shader and it cannot be
    // dropped by a graphics tier, because it is one transparent quad.
    const size = 128;
    const canvas = typeof document !== 'undefined'
      ? Object.assign(document.createElement('canvas'), { width: size, height: size })
      : null;
    let texture = null;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
      gradient.addColorStop(0.55, 'rgba(0,0,0,0.28)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
    }
    this.material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      // Drawn under everything else that is transparent, and never lit: a
      // shadow that catches the sun is not a shadow.
      fog: false,
      opacity: 0,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /**
   * @param {object} player
   * @param {number} ground  the surface under the player — the drawn one
   * @param {THREE.Vector3} [sun] unit vector towards the sun
   * @param {boolean} [show]
   */
  update(player, ground, sun, show = true) {
    if (!Number.isFinite(ground) || !show) {
      this.mesh.visible = false;
      return;
    }
    const height = Math.max(0, player.position.y - ground);
    const fade = 1 - Math.min(1, height / SHADOW_FADE_M);
    if (fade <= 0.01) {
      this.mesh.visible = false;
      return;
    }
    const scale = player.scale ?? 1;
    // Wider and fainter with height, the way a penumbra opens with distance.
    const spread = 1 + (1 - fade) * SHADOW_SPREAD;
    const radius = SHADOW_RADIUS_M * scale * spread;
    this.mesh.scale.set(radius * 2, radius * 2, 1);
    // Offset away from the sun, so the shadow lies where the light says it
    // should rather than always directly underfoot. Clamped: a low sun would
    // otherwise throw it to the horizon, and the point of a contact shadow is
    // that it stays in contact.
    let offsetX = 0;
    let offsetZ = 0;
    if (sun && sun.y > 0.05) {
      const reach = Math.min(height / sun.y, SHADOW_FADE_M * 0.5);
      offsetX = -sun.x * reach;
      offsetZ = -sun.z * reach;
    }
    this.mesh.position.set(
      player.position.x + offsetX,
      // A hand's width proud of the surface, or it fights the ground for depth.
      ground + 0.05,
      player.position.z + offsetZ,
    );
    this.material.opacity = 0.85 * fade * fade;
    this.mesh.visible = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

/** How many points the trail remembers. At 20 ticks a second, a few seconds. */
const TRAIL_POINTS = 90;
/** Metres between recorded points; closer than this and it is the same point. */
const TRAIL_STEP_M = 0.6;
/** Seconds a point survives after the rocket that made it burns out. */
const TRAIL_LIFE_S = 1.4;

/**
 * The spark trail a firework leaves behind you.
 *
 * One draw call: a fixed-length point cloud written in place, with per-point
 * colour and alpha, so it costs the same whether it is full or empty and
 * cannot be the thing that drops a frame. The colour is the rocket's own —
 * the same five the hotbar and the firework in your hand use — so a glance at
 * the trail says which one you lit.
 */
export class RocketTrail {
  constructor(scene) {
    this.positions = new Float32Array(TRAIL_POINTS * 3);
    this.colours = new Float32Array(TRAIL_POINTS * 3);
    this.ages = new Float32Array(TRAIL_POINTS);
    this.alive = new Uint8Array(TRAIL_POINTS);
    this.next = 0;
    this.last = new THREE.Vector3(NaN, NaN, NaN);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colours, 3));
    geometry.setDrawRange(0, TRAIL_POINTS);
    this.geometry = geometry;
    this.material = new THREE.PointsMaterial({
      size: 0.5,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.95,
      fog: false,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
    this._colour = new THREE.Color();
    scene.add(this.points);
  }

  /** Throw the trail away — a teleport makes the old one somebody else's sky. */
  clear() {
    this.alive.fill(0);
    this.ages.fill(0);
    this.colours.fill(0);
    this.positions.fill(0);
    // The cursor too, or the next trail starts wherever the last one stopped
    // and the buffer keeps stale coordinates in the slots before it.
    this.next = 0;
    this.last.set(NaN, NaN, NaN);
    this.points.visible = false;
    this.geometry.getAttribute('color').needsUpdate = true;
    this.geometry.getAttribute('position').needsUpdate = true;
  }

  /**
   * @param {object} player
   * @param {number} dt
   * @param {number} rebaseX how far the world origin moved this frame
   * @param {number} rebaseZ
   */
  update(player, dt, rebaseX = 0, rebaseZ = 0) {
    const position = this.geometry.getAttribute('position');
    const colour = this.geometry.getAttribute('color');

    // The origin moves under the world every so often, and a trail written in
    // world space would be left behind by it in a visible streak.
    if (rebaseX || rebaseZ) {
      for (let i = 0; i < TRAIL_POINTS; i++) {
        if (!this.alive[i]) continue;
        this.positions[i * 3] += rebaseX;
        this.positions[i * 3 + 2] += rebaseZ;
      }
      if (Number.isFinite(this.last.x)) {
        this.last.x += rebaseX;
        this.last.z += rebaseZ;
      }
      position.needsUpdate = true;
    }

    const burning = (player.rocketTicksLeft ?? 0) > 0;
    if (burning) {
      const p = player.position;
      const moved = Number.isFinite(this.last.x)
        ? Math.hypot(p.x - this.last.x, p.y - this.last.y, p.z - this.last.z)
        : Infinity;
      if (moved >= TRAIL_STEP_M) {
        const i = this.next;
        this.next = (this.next + 1) % TRAIL_POINTS;
        // Behind you rather than inside you: a spark at the camera is a flash.
        this.positions[i * 3] = p.x;
        this.positions[i * 3 + 1] = p.y;
        this.positions[i * 3 + 2] = p.z;
        const slot = Math.min(ROCKET_COLOURS.length - 1, Math.max(0, (player.rocketDuration ?? 1) - 1));
        this._colour.set(ROCKET_COLOURS[slot]);
        this.colours[i * 3] = this._colour.r;
        this.colours[i * 3 + 1] = this._colour.g;
        this.colours[i * 3 + 2] = this._colour.b;
        this.ages[i] = 0;
        this.alive[i] = 1;
        this.last.set(p.x, p.y, p.z);
        position.needsUpdate = true;
      }
    } else {
      this.last.set(NaN, NaN, NaN);
    }

    // Fade every live point, and park the dead ones out of sight rather than
    // resizing the buffer.
    let any = false;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      if (!this.alive[i]) continue;
      this.ages[i] += dt;
      const left = 1 - this.ages[i] / TRAIL_LIFE_S;
      if (left <= 0) {
        this.alive[i] = 0;
        this.colours[i * 3] = 0;
        this.colours[i * 3 + 1] = 0;
        this.colours[i * 3 + 2] = 0;
        continue;
      }
      any = true;
      // Additive blending means dimming the colour is the whole of fading out.
      const k = left * left;
      const slot = i * 3;
      const r = this.colours[slot];
      const g = this.colours[slot + 1];
      const b = this.colours[slot + 2];
      const norm = Math.max(r, g, b) || 1;
      this.colours[slot] = (r / norm) * k;
      this.colours[slot + 1] = (g / norm) * k;
      this.colours[slot + 2] = (b / norm) * k;
    }
    colour.needsUpdate = true;
    this.points.visible = any;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.points.parent?.remove(this.points);
  }
}

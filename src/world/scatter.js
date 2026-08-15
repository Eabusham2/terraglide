import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { snowLineM } from '../geo/climate.js';

/**
 * Scenery: the things standing on the ground.
 *
 * Satellite imagery draped over elevation is flat — a forest is a green smear
 * and a boulder field is a grey one. This puts real geometry back on top of it:
 * conifers, broadleaf trees, bushes and rocks, instanced by the thousand around
 * wherever you are, so ground you fly over has height and shadow to it and the
 * ground you walk through has things to walk between.
 *
 * Placement is deterministic — a hash of the cell coordinates decides whether
 * something stands there, what kind it is and how big — so the same hillside is
 * always the same hillside, nothing pops as you turn around, and none of it has
 * to be stored or downloaded. What grows where comes from the world itself:
 * nothing below the waterline, nothing on cliffs, conifers taking over from
 * broadleaf with altitude, everything thinning out toward the snow line and in
 * the deserts, and bare rock above it.
 */

/** Metres between candidate positions. One thing per cell at most. */
const CELL_M = 14;
/** How many instances each kind may draw at once. */
const KIND_LIMITS = { conifer: 2600, broadleaf: 2600, bush: 2200, rock: 1400 };

const KINDS = ['conifer', 'broadleaf', 'bush', 'rock'];

/** Deterministic 0..1 from a pair of integers and a salt. */
function hash2(x, y, salt) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 0..1 field for "how wooded is this region", from the same hash. */
function woodedness(x, y) {
  const s = 1 / 900; // metres per noise cell — patches a kilometre or so across
  const fx = x * s;
  const fy = y * s;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, 7);
  const b = hash2(x0 + 1, y0, 7);
  const c = hash2(x0, y0 + 1, 7);
  const d = hash2(x0 + 1, y0 + 1, 7);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

export class Scatter {
  constructor({ scene, terrain }) {
    this.scene = scene;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'scenery';
    scene.add(this.group);

    this.meshes = {};
    this.textures = {};
    this.lastCentre = null;
    this.climate = null;
    this.stats = { placed: 0 };

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._colour = new THREE.Color();

    for (const kind of KINDS) this.meshes[kind] = this.makeMesh(kind);
  }

  /**
   * Optional generated textures. They live in `assets/` and are only used by
   * the served copy — the single-file build has no folder to load them from and
   * falls back to flat colour, which is why nothing here depends on them.
   */
  async loadTextures(base = './assets/') {
    if (typeof document === 'undefined' || typeof fetch !== 'function') return;
    // Ask the manifest first: the single-file build has no assets folder, and
    // one quiet 404 is better than one per texture.
    let manifest;
    try {
      const response = await fetch(`${base}manifest.json`, { cache: 'force-cache' });
      if (!response.ok) return;
      manifest = await response.json();
    } catch {
      return;
    }
    if (!manifest || !manifest.textures) return;

    const loader = new THREE.TextureLoader();
    const apply = (file, kinds) => {
      if (!file) return;
      loader.load(
        `${base}${file}`,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          for (const kind of kinds) {
            const mesh = this.meshes[kind];
            if (!mesh) continue;
            mesh.material.map = texture;
            mesh.material.needsUpdate = true;
          }
        },
        undefined,
        () => {},
      );
    };
    apply(manifest.textures.foliage, ['conifer', 'broadleaf', 'bush']);
    apply(manifest.textures.rock, ['rock']);
  }

  makeMesh(kind) {
    let geometry;
    let colour;
    if (kind === 'conifer') {
      // Two stacked cones on a trunk: cheap, and unmistakably a fir at distance.
      const trunk = new THREE.CylinderGeometry(0.16, 0.24, 2.2, 5, 1, true);
      trunk.translate(0, 1.1, 0);
      const lower = new THREE.ConeGeometry(2.1, 5.2, 7);
      lower.translate(0, 4.2, 0);
      const upper = new THREE.ConeGeometry(1.3, 3.6, 7);
      upper.translate(0, 7.4, 0);
      geometry = mergeGeometries([trunk, lower, upper]);
      colour = 0x3f5a3a;
    } else if (kind === 'broadleaf') {
      const trunk = new THREE.CylinderGeometry(0.2, 0.3, 3.2, 6, 1, true);
      trunk.translate(0, 1.6, 0);
      const crown = new THREE.IcosahedronGeometry(2.9, 0);
      crown.scale(1, 0.85, 1);
      crown.translate(0, 5.4, 0);
      geometry = mergeGeometries([trunk, crown]);
      colour = 0x4d6b3c;
    } else if (kind === 'bush') {
      geometry = new THREE.IcosahedronGeometry(1.05, 0);
      geometry.scale(1.2, 0.8, 1.2);
      geometry.translate(0, 0.7, 0);
      colour = 0x55603a;
    } else {
      geometry = new THREE.DodecahedronGeometry(1.1, 0);
      geometry.scale(1.3, 0.8, 1.1);
      geometry.translate(0, 0.5, 0);
      colour = 0x6f6a63;
    }

    const material = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: false });
    const mesh = new THREE.InstancedMesh(geometry, material, KIND_LIMITS[kind]);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.name = `scenery-${kind}`;
    mesh.userData.baseColour = new THREE.Color(colour);
    this.group.add(mesh);
    return mesh;
  }

  setClimate(climate) {
    this.climate = climate;
  }

  /** Radius to fill, in metres — the graphics preset decides how generous. */
  get radius() {
    const preset = settings.preset();
    return clamp(preset.sceneryRadiusM ?? 500, 120, 2400);
  }

  update(camera, player) {
    const on = settings.get('scenery');
    this.group.visible = on;
    if (!on) return;

    // Nothing to place while you are miles up; it would never be visible and
    // the tiles under you are more use.
    const altitude = player ? player.altitudeAboveGround : 0;
    if (altitude > this.radius * 3) {
      if (this.stats.placed !== 0) this.clear();
      return;
    }

    const x = camera.position.x;
    const z = camera.position.z;
    const step = CELL_M * 4;
    if (
      this.lastCentre &&
      Math.abs(this.lastCentre.x - x) < step &&
      Math.abs(this.lastCentre.z - z) < step &&
      this.lastCentre.radius === this.radius
    ) {
      return;
    }
    this.lastCentre = { x, z, radius: this.radius };
    this.rebuild(x, z);
  }

  clear() {
    for (const kind of KINDS) this.meshes[kind].count = 0;
    this.stats.placed = 0;
    // Forget where we filled from, or coming back down to the same spot would
    // find nothing to do and leave the ground bare.
    this.lastCentre = null;
  }

  rebuild(centreX, centreZ) {
    const radius = this.radius;
    const cells = Math.ceil(radius / CELL_M);
    const baseX = Math.round(centreX / CELL_M);
    const baseZ = Math.round(centreZ / CELL_M);
    const counts = { conifer: 0, broadleaf: 0, bush: 0, rock: 0 };

    // Temperature decides the tree line and whether anything grows at all.
    const avgC = this.climate ? this.climate.avgC : 12;
    const snowLine = snowLineM(avgC);
    const cold = avgC < -4;

    for (let cz = -cells; cz <= cells; cz++) {
      for (let cx = -cells; cx <= cells; cx++) {
        if (Math.hypot(cx, cz) > cells) continue;
        const gx = baseX + cx;
        const gz = baseZ + cz;

        const roll = hash2(gx, gz, 1);
        // Jitter inside the cell so nothing lands on a grid.
        const px = (gx + hash2(gx, gz, 2) - 0.5) * CELL_M;
        const pz = (gz + hash2(gx, gz, 3) - 0.5) * CELL_M;

        const ground = this.terrain.heightAt(px, pz);
        if (ground <= 0.4) continue; // sea, and beaches stay bare

        // Steep ground gets rocks, not woodland.
        const slope = this.slopeAt(px, pz);
        const alpine = clamp((ground - (snowLine - 450)) / 500, 0, 1);
        const wooded = woodedness(px, pz);

        let density = wooded * 0.85 * (1 - alpine);
        if (cold) density *= 0.35;
        if (slope > 0.55) density *= 0.15;
        if (density < 0.03) density = 0.03; // never completely empty

        if (roll > density) {
          // Nothing growing here — but bare ground still has stones on it.
          if (hash2(gx, gz, 9) < 0.05 + alpine * 0.22 + slope * 0.2) {
            this.place('rock', counts, px, pz, ground, gx, gz);
          }
          continue;
        }

        const pick = hash2(gx, gz, 4);
        // Conifers take over as you climb; bushes fill in between.
        const coniferShare = clamp(0.25 + alpine * 0.6 + (cold ? 0.3 : 0), 0, 0.9);
        const kind = pick < coniferShare ? 'conifer' : pick < 0.86 ? 'broadleaf' : 'bush';
        this.place(kind, counts, px, pz, ground, gx, gz);
      }
    }

    let placed = 0;
    for (const kind of KINDS) {
      const mesh = this.meshes[kind];
      mesh.count = counts[kind];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      placed += counts[kind];
    }
    this.stats.placed = placed;
  }

  place(kind, counts, x, z, ground, gx, gz) {
    const mesh = this.meshes[kind];
    const index = counts[kind];
    if (index >= KIND_LIMITS[kind]) return;

    const sizeRoll = hash2(gx, gz, 5);
    const scale =
      kind === 'rock' ? 0.5 + sizeRoll * 1.8 : kind === 'bush' ? 0.6 + sizeRoll * 0.9 : 0.7 + sizeRoll * 0.8;
    const spin = hash2(gx, gz, 6) * Math.PI * 2;
    // A little lean, so a hillside of firs is not a hillside of identical firs.
    const lean = (hash2(gx, gz, 8) - 0.5) * 0.12;

    this._position.set(x, ground - 0.2 * scale, z);
    this._quaternion.setFromEuler(new THREE.Euler(lean, spin, lean * 0.6, 'YXZ'));
    this._scale.set(scale, scale * (0.85 + hash2(gx, gz, 10) * 0.4), scale);
    this._matrix.compose(this._position, this._quaternion, this._scale);
    mesh.setMatrixAt(index, this._matrix);

    // Vary the colour a shade per instance so a wood is not one flat green.
    const tint = 0.82 + hash2(gx, gz, 11) * 0.36;
    this._colour.copy(mesh.userData.baseColour).multiplyScalar(tint);
    mesh.setColorAt(index, this._colour);

    counts[kind] = index + 1;
  }

  /** Rough slope, 0 flat to 1 vertical-ish, from the elevation field. */
  slopeAt(x, z) {
    const d = 12;
    const h = this.terrain.heightAt(x, z);
    const dx = Math.abs(this.terrain.heightAt(x + d, z) - h);
    const dz = Math.abs(this.terrain.heightAt(x, z + d) - h);
    return clamp(Math.hypot(dx, dz) / d, 0, 1);
  }

  /** Everything moved: the local frame re-anchored or you teleported. */
  rebase() {
    this.lastCentre = null;
    this.clear();
  }
}

/** Minimal geometry merge — enough for the handful of parts each object has. */
function mergeGeometries(list) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const geometry of list) {
    vertexCount += geometry.attributes.position.count;
    indexCount += geometry.index ? geometry.index.count : geometry.attributes.position.count;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint16Array(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const geometry of list) {
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    positions.set(position.array, vertexOffset * 3);
    if (normal) normals.set(normal.array, vertexOffset * 3);
    if (uv) uvs.set(uv.array, vertexOffset * 2);

    if (geometry.index) {
      const source = geometry.index.array;
      for (let i = 0; i < source.length; i++) indices[indexOffset + i] = source[i] + vertexOffset;
      indexOffset += source.length;
    } else {
      for (let i = 0; i < position.count; i++) indices[indexOffset + i] = i + vertexOffset;
      indexOffset += position.count;
    }
    vertexOffset += position.count;
    geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  return merged;
}

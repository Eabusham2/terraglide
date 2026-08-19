import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { latToNormY, lonToNormX, normXToLon, normYToLat, tileKey } from '../geo/mercator.js';
import { mapTiles } from '../ui/mapTiles.js';
import { classify, parseFeatures, pointInRing } from './landcover.js';
import { overpass } from './overpass.js';

/**
 * Scenery: trees, scrub and rock, in the places they actually are.
 *
 * Every position here traces back to OpenStreetMap. Woods, scrub, heath, bare
 * rock and scree are mapped as areas, individual notable trees are mapped as
 * points, and OSM even records whether a wood is needleleaved or broadleaved —
 * so a fir is a fir because the data says so, not because a noise function felt
 * like it. Where OSM has nothing, this draws nothing. No invented forests.
 *
 * OSM does not record every trunk inside a wood, and no public dataset does, so
 * the *filling in* of a mapped wood is generated: positions are hashed from the
 * ground coordinate, deterministic and stable, spaced by species. That is the
 * same division of labour a flight simulator uses outside its photogrammetry
 * cities — the land class is surveyed data, the individual trunks are autogen.
 * The boundary of the honesty is: the outline of the wood is real, the specific
 * tree you are standing next to is not.
 *
 * Terrain height under each object comes from the elevation data the ground mesh
 * is built from, so nothing floats and nothing sinks.
 *
 * Colour comes from the aerial photograph of that exact spot rather than from a
 * palette: the imagery already knows that a Norwegian spruce plantation and a
 * Californian hillside are not the same green. The generated texture is only
 * grain on top of it, so it reads as bark and canopy without deciding the hue.
 */

/** Imagery zoom to sample colour from — close enough to be the right field. */
const COLOUR_ZOOM = 16;

/**
 * Tiles of OSM land cover, at this zoom. ~4.9 km across at the equator.
 *
 * This was z14 (~2.4 km), which meant the nine tiles around you covered barely
 * seven kilometres of ground — and Overpass is a donated service queried one
 * request at a time with a gap between them, so filling even that took most of
 * half a minute after a teleport. Dropping one zoom level quadruples the
 * ground each request buys, which is the cheapest possible fix: same number of
 * requests, four times the world with trees on it.
 */
const DATA_ZOOM = 13;
/** Metres between generated trunks inside a mapped area, by kind. */
const SPACING = { conifer: 13, broadleaf: 15, bush: 9, rock: 17 };
/** Ceiling per kind, so a city-sized forest cannot melt the frame. */
const KIND_LIMITS = { conifer: 6000, broadleaf: 6000, bush: 3600, rock: 2600 };

/**
 * Spacing grows with distance, so the near field stays dense while the far
 * field costs a fraction of the instances. Beyond this the spacing has
 * doubled, which is a quarter of the trees per hectare.
 */
const THIN_FROM_M = 420;

const KINDS = ['conifer', 'broadleaf', 'bush', 'rock'];

/** What fraction of the trunks to keep at this distance from the camera. */
function densityAt(distance) {
  if (distance <= THIN_FROM_M) return 1;
  return clamp(Math.pow(THIN_FROM_M / distance, 1.6), 0.18, 1);
}

/** Deterministic 0..1 from a pair of integers and a salt. */
function hash2(x, y, salt) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Scatter {
  constructor({ scene, terrain, frame }) {
    this.scene = scene;
    this.terrain = terrain;
    this.frame = frame;
    this.group = new THREE.Group();
    this.group.name = 'scenery';
    scene.add(this.group);

    this.meshes = {};
    /** Generated textures, held whether or not they are currently applied. */
    this.textures = {};
    this.tiles = new Map();
    this.lastBuildAt = null;
    this.dirty = false;
    this.stats = { placed: 0, areas: 0, points: 0, tiles: 0, failed: 0 };

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._scale = new THREE.Vector3();
    this._colour = new THREE.Color();
    this._world = { x: 0, y: 0, z: 0 };
    this._geo = { lat: 0, lon: 0 };

    for (const kind of KINDS) this.meshes[kind] = this.makeMesh(kind);
  }

  /**
   * Optional generated textures, listed in `assets/manifest.json`. The
   * single-file build has no assets folder and falls back to flat colour, which
   * is why nothing here depends on them.
   */
  /**
   * The generated textures are for the *generated* world only.
   *
   * Over real imagery the colour already comes from the aerial photograph, and
   * a made-up canopy texture on top of real data is exactly the kind of
   * invented dressing this project keeps out. On the offline world there is no
   * photograph to take it from, so they earn their place there.
   */
  applyTextureMode() {
    const generated = settings.get('imageryProvider') === 'offline';
    for (const kind of KINDS) {
      const mesh = this.meshes[kind];
      const wanted = generated ? this.textures[kind] ?? null : null;
      if (mesh.material.map === wanted) continue;
      mesh.material.map = wanted;
      mesh.material.needsUpdate = true;
    }
  }

  async loadTextures(base = './assets/') {
    if (typeof document === 'undefined' || typeof fetch !== 'function') return;
    // No assets folder in the single-file build, and over file:// the ask is a
    // CORS error rather than a quiet 404. Skip it and keep the flat colours.
    if (globalThis.__TERRAGLIDE_INLINE_WORKER__) return;
    let manifest;
    try {
      const response = await fetch(`${base}manifest.json`, { cache: 'force-cache' });
      if (!response.ok) return;
      manifest = await response.json();
    } catch {
      return;
    }
    if (!manifest?.textures) return;

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
            if (!this.meshes[kind]) continue;
            this.textures[kind] = texture;
          }
          this.applyTextureMode();
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

    const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mesh = new THREE.InstancedMesh(geometry, material, KIND_LIMITS[kind]);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = `scenery-${kind}`;
    mesh.userData.baseColour = new THREE.Color(colour);
    this.group.add(mesh);
    return mesh;
  }

  /** How far out mapped areas are filled in, in metres. */
  get radius() {
    return clamp(settings.preset().sceneryRadiusM ?? 500, 120, 2400);
  }

  /* --------------------------------------------------------------- data */

  update(camera, player) {
    const on = settings.get('scenery');
    this.group.visible = on;
    if (!on) return;

    const altitude = player ? player.altitudeAboveGround : 0;
    // Same rule as buildings: nothing is filled in while you cruise far above
    // it. The *data* stays — polygons are a few kilobytes and re-fetching them
    // means another wait on a rate-limited donated service every time you come
    // back down. Only the instances go.
    if (altitude > 2200) {
      if (this.stats.placed > 0) this.clearInstances();
      return;
    }

    this.applyTextureMode();
    if (player) this.requestAround(player.lat, player.lon);

    const x = camera.position.x;
    const z = camera.position.z;
    // Rebuilding walks every mapped polygon in range, so the trigger distance
    // scales with the radius rather than being a flat 220 m. At a 1.9 km
    // radius that was a full rebuild every couple of seconds at glide speed,
    // which is a hitch you can feel; a quarter of the radius keeps the same
    // visual continuity for a fraction of the work.
    const step = Math.max(180, this.radius * 0.25);
    const moved =
      !this.lastBuildAt ||
      Math.hypot(this.lastBuildAt.x - x, this.lastBuildAt.z - z) > step ||
      this.lastBuildAt.radius !== this.radius;
    if (!moved && !this.dirty) return;

    this.lastBuildAt = { x, z, radius: this.radius };
    this.dirty = false;
    this.rebuild(x, z);
  }

  /** Keep the OSM land-cover tiles around the player loaded. */
  requestAround(lat, lon) {
    const n = Math.pow(2, DATA_ZOOM);
    const cx = Math.floor(lonToNormX(lon) * n);
    const cy = Math.floor(latToNormY(lat) * n);

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = (((cx + dx) % n) + n) % n;
        const y = cy + dy;
        if (y < 0 || y >= n) continue;
        const key = tileKey(DATA_ZOOM, x, y);
        if (this.tiles.has(key)) continue;
        // The tile you are standing in first; neighbours wait their turn.
        if ((dx !== 0 || dy !== 0) && overpass.inflight) continue;
        this.fetchTile(key, { z: DATA_ZOOM, x, y });
      }
    }

    // Hold on to everything still within reach. Tiles are cheap to keep and
    // expensive to re-request, so nothing in range is ever thrown away —
    // fly out and back and the wood is still there, immediately.
    if (this.tiles.size > 30) {
      for (const [key, record] of this.tiles) {
        if (Math.abs(record.tile.x - cx) > 3 || Math.abs(record.tile.y - cy) > 3) {
          this.tiles.delete(key);
          this.dirty = true;
        }
      }
    }
    this.stats.tiles = this.tiles.size;
  }

  async fetchTile(key, tile) {
    const record = { tile, state: 'loading', areas: [], points: [] };
    this.tiles.set(key, record);

    const n = Math.pow(2, DATA_ZOOM);
    const west = normXToLon(tile.x / n);
    const east = normXToLon((tile.x + 1) / n);
    const north = normYToLat(tile.y / n);
    const south = normYToLat((tile.y + 1) / n);
    const bbox = `${south},${west},${north},${east}`;
    // `out geom` returns each way's coordinates inline, which is a fraction of
    // the traffic of pulling every node separately.
    const query =
      `[out:json][timeout:30];(` +
      `way["natural"~"^(wood|scrub|heath|bare_rock|scree|shingle)$"](${bbox});` +
      `way["landuse"~"^(forest|orchard|vineyard|meadow)$"](${bbox});` +
      `node["natural"="tree"](${bbox});` +
      `);out geom;`;

    try {
      const data = await overpass.query(query);
      const parsed = parseFeatures(data);
      record.areas = parsed.areas;
      record.points = parsed.points;
      record.state = 'ready';
      this.dirty = true;
      this.stats.areas = [...this.tiles.values()].reduce((n2, r) => n2 + r.areas.length, 0);
      this.stats.points = [...this.tiles.values()].reduce((n2, r) => n2 + r.points.length, 0);
    } catch {
      record.state = 'failed';
      this.stats.failed++;
      // Forget it so it can be asked for again later, rather than caching a
      // hole in the world forever.
      setTimeout(() => {
        if (this.tiles.get(key) === record) this.tiles.delete(key);
      }, 60000);
    }
  }

  /**
   * One line for the status readout, and only when it is worth saying.
   *
   * Scenery going missing used to be silent: no trees looked identical whether
   * the land really is bare, the data had not arrived, or Overpass had refused
   * us. Those want different reactions from the player, so they get different
   * words.
   */
  status() {
    if (!settings.get('scenery')) return '';
    const loading = [...this.tiles.values()].some((r) => r.state === 'loading');
    if (this.stats.placed > 0) return '';
    if (loading) return 'scenery: loading land cover';
    const ready = [...this.tiles.values()].filter((r) => r.state === 'ready');
    if (ready.length > 0 && !this.hasData) return 'scenery: nothing mapped here';
    if (this.stats.failed > 0 && ready.length === 0) return 'scenery: land cover unavailable';
    return '';
  }

  /** Is there any real land-cover data to draw right now? */
  get hasData() {
    for (const record of this.tiles.values()) {
      if (record.state === 'ready' && (record.areas.length > 0 || record.points.length > 0)) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------ placing */

  clearInstances() {
    for (const kind of KINDS) this.meshes[kind].count = 0;
    this.stats.placed = 0;
    this.lastBuildAt = null;
  }

  rebuild(centreX, centreZ) {
    const counts = { conifer: 0, broadleaf: 0, bush: 0, rock: 0 };
    const radius = this.radius;

    for (const record of this.tiles.values()) {
      if (record.state !== 'ready') continue;

      for (const area of record.areas) {
        this.fillArea(area, counts, centreX, centreZ, radius);
      }

      // Individually mapped trees stand exactly where the survey put them.
      for (const point of record.points) {
        this.frame.toWorld(point.lat, point.lon, this._world);
        const dx = this._world.x - centreX;
        const dz = this._world.z - centreZ;
        if (Math.hypot(dx, dz) > radius) continue;
        const kind = point.tags?.leaf_type === 'needleleaved' ? 'conifer' : 'broadleaf';
        this.place(kind, counts, this._world.x, this._world.z, 1.15);
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

  /**
   * Fill one mapped area with the species it is mapped as. The outline is the
   * survey's; the spacing inside it is ours.
   */
  fillArea(area, counts, centreX, centreZ, radius) {
    const ring = this.ringToWorld(area);
    if (!ring) return;

    // Skip anything wholly outside the fill radius before doing real work.
    const { minX, maxX, minZ, maxZ } = ring.bounds;
    const nearestX = clamp(centreX, minX, maxX);
    const nearestZ = clamp(centreZ, minZ, maxZ);
    if (Math.hypot(nearestX - centreX, nearestZ - centreZ) > radius) return;

    const mixed = area.kind === 'mixed';
    const baseKind = mixed ? 'conifer' : area.kind;
    const spacing = area.spacing ?? SPACING[baseKind] ?? 14;

    const x0 = Math.max(minX, centreX - radius);
    const x1 = Math.min(maxX, centreX + radius);
    const z0 = Math.max(minZ, centreZ - radius);
    const z1 = Math.min(maxZ, centreZ + radius);

    for (let gz = Math.floor(z0 / spacing); gz <= Math.ceil(z1 / spacing); gz++) {
      for (let gx = Math.floor(x0 / spacing); gx <= Math.ceil(x1 / spacing); gx++) {
        // Jitter off the grid, deterministically, so a wood is not an orchard.
        const x = (gx + hash2(gx, gz, 1) - 0.5) * spacing;
        const z = (gz + hash2(gx, gz, 2) - 0.5) * spacing;
        const distance = Math.hypot(x - centreX, z - centreZ);
        if (distance > radius) continue;
        if (!pointInRing(ring.points, x, z)) continue;
        // A few gaps: clearings, tracks, and the edge of a wood being ragged.
        if (hash2(gx, gz, 3) > 0.86) continue;
        // Thin with distance so the radius can be wide without the instance
        // count following it. The draw is hashed from the grid cell, so a tree
        // that survives the thinning is the *same* tree every frame — it fades
        // in once as you approach and then stays put, rather than flickering.
        if (distance > THIN_FROM_M && hash2(gx, gz, 6) > densityAt(distance)) continue;

        const kind = mixed ? (hash2(gx, gz, 4) < 0.5 ? 'conifer' : 'broadleaf') : baseKind;
        this.place(kind, counts, x, z, 0.7 + hash2(gx, gz, 5) * 0.8);
      }
    }
  }

  /** OSM lat/lon ring to local world XZ, with bounds, cached per rebase. */
  ringToWorld(area) {
    if (area._ring && area._anchor === this.frame.anchorSerial) return area._ring;

    const points = new Float64Array(area.geometry.length * 2);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < area.geometry.length; i++) {
      const node = area.geometry[i];
      this.frame.toWorld(node.lat, node.lon, this._world);
      points[i * 2] = this._world.x;
      points[i * 2 + 1] = this._world.z;
      if (this._world.x < minX) minX = this._world.x;
      if (this._world.x > maxX) maxX = this._world.x;
      if (this._world.z < minZ) minZ = this._world.z;
      if (this._world.z > maxZ) maxZ = this._world.z;
    }
    area._ring = { points, bounds: { minX, maxX, minZ, maxZ } };
    area._anchor = this.frame.anchorSerial;
    return area._ring;
  }

  place(kind, counts, x, z, scale) {
    const mesh = this.meshes[kind];
    const index = counts[kind];
    if (index >= KIND_LIMITS[kind]) return;

    // Nothing grows in the sea, whatever the map says about the shoreline —
    // but "no elevation data yet" also reads back as exactly sea level, and
    // treating that as sea meant no trees at all until the DEM arrived, and
    // none ever over genuinely low-lying ground like the Netherlands. Ask
    // whether the data is actually there before believing the zero.
    if (!this.terrain.hasElevationAt(x, z)) return;
    const ground = this.terrain.heightAt(x, z);
    if (this.terrain.isWaterAt(x, z)) return;

    const key = Math.round(x * 7) ^ Math.round(z * 13);
    const spin = hash2(key, index, 6) * Math.PI * 2;
    const lean = (hash2(key, index, 7) - 0.5) * 0.12;

    this._position.set(x, ground - 0.2 * scale, z);
    this._euler.set(lean, spin, lean * 0.6, 'YXZ');
    this._quaternion.setFromEuler(this._euler);
    this._scale.set(scale, scale * (0.85 + hash2(key, index, 8) * 0.4), scale);
    this._matrix.compose(this._position, this._quaternion, this._scale);
    mesh.setMatrixAt(index, this._matrix);

    // Take the colour off the aerial photograph of this spot; fall back to the
    // species tone only until that tile has arrived.
    const sampled = this.sampleImagery(x, z);
    const tint = 0.86 + hash2(key, index, 9) * 0.28;
    if (sampled) {
      // Lift it a little — a canopy lit from above is brighter than the
      // top-down average — and pull it a third of the way toward the species
      // tone so a wood still reads as a wood in flat grey winter imagery.
      this._colour
        .setRGB(sampled.r, sampled.g, sampled.b)
        .multiplyScalar(1.25)
        .lerp(mesh.userData.baseColour, 0.32)
        .multiplyScalar(tint);
    } else {
      this._colour.copy(mesh.userData.baseColour).multiplyScalar(tint);
    }
    mesh.setColorAt(index, this._colour);

    counts[kind] = index + 1;
  }

  /** Colour of the imagery under a world position, or null if not loaded yet. */
  sampleImagery(x, z) {
    if (!this.frame) return null;
    const geo = this.frame.toGeo(x, z, this._geo);
    const n = Math.pow(2, COLOUR_ZOOM);
    const fx = lonToNormX(geo.lon) * n;
    const fy = latToNormY(geo.lat) * n;
    const tx = Math.floor(fx);
    const ty = Math.floor(fy);
    if (ty < 0 || ty >= n) return null;
    try {
      return mapTiles.sampleColour(COLOUR_ZOOM, tx, ty, fx - tx, fy - ty);
    } catch {
      return null;
    }
  }

  /** The local frame re-anchored, or you teleported: drop everything placed. */
  rebase() {
    this.clearInstances();
    this.dirty = true;
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

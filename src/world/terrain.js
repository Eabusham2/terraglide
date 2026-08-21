import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { tileKey, wrapTileX } from '../geo/mercator.js';
import { createTerrainMaterial } from './shaders.js';

/**
 * Terrain: a mercator quadtree streamed around the camera.
 *
 * Each frame we walk down from a handful of coarse root tiles, subdividing while
 * a tile is closer than `lodFactor` times its own width, and draw the leaves.
 * Leaves carry a grid mesh with a dropped skirt around the edge, which hides the
 * one-pixel cracks where two different LODs meet without needing stitched index
 * buffers.
 *
 * Everything that could stutter is budgeted: mesh building has a millisecond
 * allowance per frame, texture loads are prioritised by distance and cancelled
 * when they stop being wanted, and a tile with no texture yet borrows its
 * parent's rather than popping in as a hole.
 */

/**
 * Ceiling on how many tiles one frame may draw, per graphics preset.
 *
 * It is a safety rail rather than a budget: the walk is ordered by distance, so
 * hitting it drops the farthest ground, and dropping ground leaves a hole. The
 * numbers are high enough that a normal view never reaches them and low enough
 * that a pathological one cannot lock the machine up.
 */
const MAX_DRAWN_TILES = { low: 520, medium: 760, high: 1100, ultra: 1500 };
const SEA_LEVEL = 0;
/**
 * How much further than the render distance a built tile is kept before it may
 * be thrown away. Turning round used to mean rebuilding everything behind you
 * from nothing; a half again of margin means the ground you just flew over is
 * still there when you come back to it.
 */
const KEEP_FACTOR = 1.5;
/** How much further distant mode reaches than the render distance proper. */
const DISTANT_FACTOR = 2;

export class Terrain {
  constructor({ scene, frame, streamer, elevation, shared }) {
    this.scene = scene;
    this.frame = frame;
    this.streamer = streamer;
    this.elevation = elevation;
    this.shared = shared;

    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);

    this.nodes = new Map();
    this.drawn = [];
    this.frustum = new THREE.Frustum();
    this.projScreenMatrix = new THREE.Matrix4();
    this.stats = { drawn: 0, built: 0, nodes: 0, baseZoom: 0, maxZoom: 0 };

    this._box = new THREE.Box3();
    this._ray = new THREE.Raycaster();
    this._rayOrigin = new THREE.Vector3();
    this._rayDown = new THREE.Vector3(0, -1, 0);
    this._vecA = new THREE.Vector3();
    this._norm = { nx: 0, ny: 0 };
    this._world = { x: 0, z: 0 };
    this._geo = { lat: 0, lon: 0 };
    /**
     * Optional test for "have I been here before", used by distant mode. Set by
     * the game; left null the quadtree simply stops at the render distance.
     */
    this.explored = null;
  }

  get gridSize() {
    const preset = settings.preset();
    return clamp(Math.round(preset.tileGridSize * settings.get('meshDetail')), 5, 65);
  }

  /** How aggressively tiles subdivide; derived from the graphics preset. */
  get lodFactor() {
    return 4.6 / settings.preset().sseThreshold;
  }

  /** Ground height (metres, sea clamped) at a normalised mercator point. */
  heightAtNorm(nx, ny) {
    return Math.max(SEA_LEVEL, this.elevation.sampleNorm(nx, ny));
  }

  /** Ground height at a world-space XZ position. */
  heightAt(x, z) {
    this.frame.worldToNorm(x, z, this._norm);
    return this.heightAtNorm(this._norm.nx, this._norm.ny);
  }

  /** Raw ground height including bathymetry, so water depth can be measured. */
  bedAt(x, z) {
    this.frame.worldToNorm(x, z, this._norm);
    return this.elevation.sampleNorm(this._norm.nx, this._norm.ny);
  }

  /** True when real elevation has arrived for this spot. */
  /**
   * Bumped every time a new elevation tile lands.
   *
   * Anything that stands things *on* the ground watches this. Before the relief
   * for a square has arrived, every height there reads back as exactly sea
   * level and `hasElevationAt` is false — so a wood that OpenStreetMap has
   * mapped is dropped rather than planted, and a building is founded at zero.
   * Neither is retried on its own, because nothing about the wood or the
   * building changed; what changed was the ground under them.
   */
  get elevationVersion() {
    return this.elevation?.version ?? 0;
  }

  hasElevationAt(x, z) {
    this.frame.worldToNorm(x, z, this._norm);
    return this.elevation.hasDataAt(this._norm.nx, this._norm.ny);
  }

  /** True when this spot is open water (DEM at or below sea level). */
  isWaterAt(x, z) {
    this.frame.worldToNorm(x, z, this._norm);
    return this.elevation.sampleNorm(this._norm.nx, this._norm.ny) <= SEA_LEVEL;
  }

  /** Surface normal at a world position, from finite differences. */
  normalAt(x, z, out = new THREE.Vector3()) {
    const d = 2;
    const hl = this.heightAt(x - d, z);
    const hr = this.heightAt(x + d, z);
    const hu = this.heightAt(x, z - d);
    const hd = this.heightAt(x, z + d);
    return out.set(hl - hr, 2 * d, hu - hd).normalize();
  }

  /** Throw everything away — used when the local frame re-anchors. */
  rebase() {
    for (const node of this.nodes.values()) this.disposeNode(node);
    this.nodes.clear();
    this.drawn.length = 0;
  }

  update(camera, budgetMs) {
    const preset = settings.preset();
    // Never ask deeper than the provider is actually serving. The setting is
    // what you want; `maxUsefulZoom` is what you can have, and it comes down
    // on its own when a level starts refusing every tile while the one above
    // it keeps answering. On auto there is no ceiling of your own at all, so
    // what you get is exactly as sharp as the provider is willing to go.
    const wanted = settings.get('maxTileZoomAuto') ? Infinity : settings.get('maxTileZoom');
    const maxZoom = Math.min(wanted, this.streamer.maxUsefulZoom);
    const renderDistance = this.renderDistance;
    // Distant mode: keep drawing past the render distance, but only over
    // country you have already flown across. Ground you have never seen stops
    // at the edge as it always did, so the setting cannot quietly double what
    // an unexplored world costs to stream.
    this.farDistance =
      this.explored && settings.get('distantMode') ? renderDistance * DISTANT_FACTOR : renderDistance;
    this.keepDistance = this.farDistance * KEEP_FACTOR;
    this.maxDrawn = MAX_DRAWN_TILES[settings.get('graphics')] ?? MAX_DRAWN_TILES.high;
    // Which way you are facing, flattened. Ground in front of you is what you
    // are about to look at, so it is what gets built first.
    camera.getWorldDirection(this._vecA);
    this._viewX = this._vecA.x;
    this._viewZ = this._vecA.z;
    const flatLen = Math.hypot(this._viewX, this._viewZ) || 1;
    this._viewX /= flatLen;
    this._viewZ /= flatLen;

    this.streamer.beginFrame();
    this.elevation.beginFrame();

    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    const camX = camera.position.x;
    const camZ = camera.position.z;

    // Root zoom: the coarsest level whose tiles still comfortably cover the
    // view distance, so the recursion starts with only a few tiles.
    const worldSpan = 2 * Math.PI * this.frame.scale;
    let baseZoom = Math.floor(Math.log2(worldSpan / Math.max(this.farDistance * 2, 1000)));
    baseZoom = clamp(baseZoom, 1, Math.max(1, maxZoom - 1));

    for (const node of this.drawn) node.mesh.visible = false;
    this.drawn.length = 0;

    this.budget = { ms: budgetMs, start: performance.now(), built: 0 };

    const n = Math.pow(2, baseZoom);
    this.frame.worldToNorm(camX, camZ, this._norm);
    const rootX = Math.floor(this._norm.nx * n);
    const rootY = Math.floor(clamp(this._norm.ny, 0, 0.999999) * n);
    // Enough root tiles to cover the view circle, however big the distance is.
    const rootSize = this.frame.worldTileSize(baseZoom);
    const span = clamp(Math.ceil(this.farDistance / rootSize) + 1, 1, 6);

    // Visit nearest first so the closest ground always gets the frame's build
    // budget. Doing it in fixed quadrant order let distant tiles eat the budget,
    // which is why the ground under your feet could stay coarse while the
    // horizon looked fine.
    const roots = [];
    for (let dy = -span; dy <= span; dy++) {
      const ty = rootY + dy;
      if (ty < 0 || ty >= n) continue;
      for (let dx = -span; dx <= span; dx++) {
        const cx = camX + (dx + 0.5) * rootSize;
        const cz = camZ + (dy + 0.5) * rootSize;
        roots.push({
          z: baseZoom,
          x: wrapTileX(rootX + dx, baseZoom),
          y: ty,
          d: this.viewDistance(cx, cz, camX, camZ, Math.hypot(dx, dy) * rootSize),
        });
      }
    }
    roots.sort((a, b) => a.d - b.d);
    for (const root of roots) {
      this.visit(root, camera, camX, camZ, renderDistance, maxZoom);
    }

    // Elevation follows the camera: coarse when high up, sharpest on foot.
    const altitude = Math.max(1, camera.position.y - this.heightAt(camX, camZ));
    const elevZoom = clamp(Math.round(19 - Math.log2(altitude + 1) * 1.35), 6, this.elevation.maxZoom);
    this.elevation.ensureAround(this._norm.nx, this._norm.ny, elevZoom, 1);

    this.streamer.pump();
    this.streamer.evict();
    this.evict(preset.textureCacheSize, camX, camZ);

    this.stats.drawn = this.drawn.length;
    this.stats.nodes = this.nodes.size;
    this.stats.baseZoom = baseZoom;
    this.stats.maxZoom = maxZoom;
  }

  /** Metres of ground drawn around the camera, and how far to keep it after. */
  get renderDistance() {
    return settings.get('renderDistanceKm') * 1000;
  }

  /**
   * How far away a tile *effectively* is for ordering purposes.
   *
   * Straight-line distance alone builds the ground behind you at the same
   * priority as the ground you are looking at, and on a frame where the budget
   * runs out the difference is a hole in the view rather than a hole behind
   * your head. Ground within the view cone keeps its real distance; ground
   * behind you is treated as further off than it is.
   */
  viewDistance(cx, cz, camX, camZ, flat) {
    const dx = cx - camX;
    const dz = cz - camZ;
    const len = Math.hypot(dx, dz);
    if (len < 1) return flat;
    const facing = (dx * this._viewX + dz * this._viewZ) / len;
    // +1 dead ahead, -1 directly behind: a tile behind you sorts as up to
    // three times its distance, which puts it after everything in front.
    return flat * (1.6 - facing * 0.6);
  }

  visit(tile, camera, camX, camZ, renderDistance, maxZoom) {
    if (this.drawn.length >= this.maxDrawn) return;

    const size = this.frame.worldTileSize(tile.z);
    const n = Math.pow(2, tile.z);
    this.frame.normToWorld(tile.x / n, tile.y / n, this._world);
    const x0 = this._world.x;
    const z0 = this._world.z;
    const x1 = x0 + size;
    const z1 = z0 + size;

    const dx = Math.max(x0 - camX, 0, camX - x1);
    const dz = Math.max(z0 - camZ, 0, camZ - z1);
    // Distance to the nearest point of the tile, so the view ends on a circle
    // rather than a square with corners poking out.
    const flatDist = Math.hypot(dx, dz);
    if (flatDist > renderDistance) {
      if (flatDist > this.farDistance) return;
      if (!this.explored || !this.explored(tile)) return;
    }

    // Cheap vertical bounds for culling; refined once the tile is built.
    const cached = this.nodes.get(tileKey(tile.z, tile.x, tile.y));
    const minY = cached ? cached.minY : -200;
    const maxY = cached ? cached.maxY : 6000;

    this._box.min.set(Math.min(x0, x1), minY, Math.min(z0, z1));
    this._box.max.set(Math.max(x0, x1), maxY, Math.max(z0, z1));
    if (!this.frustum.intersectsBox(this._box)) return;

    const shouldSplit = tile.z < maxZoom && flatDist < size * this.lodFactor;
    if (shouldSplit) {
      const cz = tile.z + 1;
      const half = size / 2;
      const children = [
        { z: cz, x: tile.x * 2, y: tile.y * 2, cx: x0 + half * 0.5, cz2: z0 + half * 0.5 },
        { z: cz, x: tile.x * 2 + 1, y: tile.y * 2, cx: x0 + half * 1.5, cz2: z0 + half * 0.5 },
        { z: cz, x: tile.x * 2, y: tile.y * 2 + 1, cx: x0 + half * 0.5, cz2: z0 + half * 1.5 },
        { z: cz, x: tile.x * 2 + 1, y: tile.y * 2 + 1, cx: x0 + half * 1.5, cz2: z0 + half * 1.5 },
      ];
      for (const child of children) {
        child.order = this.viewDistance(
          child.cx, child.cz2, camX, camZ,
          Math.hypot(child.cx - camX, child.cz2 - camZ),
        );
      }
      children.sort((a, b) => a.order - b.order);
      for (const child of children) {
        this.visit(child, camera, camX, camZ, renderDistance, maxZoom);
      }
      return;
    }

    // Pass the view-weighted distance, not the flat one: it decides both which
    // tiles get the frame's build budget and which textures are asked for
    // first, and both should favour the ground you are looking at.
    this.draw(tile, x0, z0, size, this.viewDistance(
      (x0 + x1) / 2, (z0 + z1) / 2, camX, camZ, flatDist,
    ));
  }

  draw(tile, x0, z0, size, distance) {
    // `distance` here is the view-weighted one from visit(): how far away the
    // tile is *for the purpose of caring about it*, not how far away it is.
    const key = tileKey(tile.z, tile.x, tile.y);
    let node = this.nodes.get(key);

    if (!node || node.dirty) {
      const spent = performance.now() - this.budget.start;
      // Always afford the first few tiles of a frame: those are the nearest
      // ones now that the walk is ordered by distance.
      const affordable = spent < this.budget.ms || this.budget.built < 3;
      if (!affordable) {
        // Out of build time this frame: show the nearest built ancestor so the
        // ground stays continuous, and try again next frame.
        const ancestor = this.findBuiltAncestor(tile);
        if (ancestor) {
          this.show(ancestor, tile, distance);
          return;
        }
        // Nothing built above it either, so the choice is between going over
        // budget and leaving a gap. A gap in the ground is a window straight
        // through the planet — that is where the random holes came from — and
        // one frame that runs long is cheaper than that.
      }
      node = this.build(tile, x0, z0, size, node);
      this.budget.built++;
      this.stats.built++;
    }

    this.show(node, tile, distance);
  }

  findBuiltAncestor(tile) {
    let z = tile.z - 1;
    let x = tile.x >> 1;
    let y = tile.y >> 1;
    while (z >= 0) {
      const node = this.nodes.get(tileKey(z, x, y));
      if (node && node.mesh) return node;
      z--;
      x >>= 1;
      y >>= 1;
    }
    return null;
  }

  show(node, requestedTile, distance) {
    node.used = this.streamer.frame;
    // Stamp rather than reading mesh.visible: a mesh is born visible, and
    // relying on that flag meant a freshly built tile never entered the drawn
    // list and so could never be hidden again.
    if (node.shownFrame !== this.streamer.frame) {
      node.shownFrame = this.streamer.frame;
      node.mesh.visible = true;
      // Draw the ground under your feet before the ground on the horizon: the
      // near tiles fill the depth buffer first and everything behind them is
      // rejected cheaply, and a stutter shows up as a far tile arriving late
      // rather than the one you are standing on.
      node.mesh.renderOrder = Math.round(distance * 0.01);
      this.drawn.push(node);
    }

    // Texture: exact tile if we have it, otherwise the closest ancestor.
    const priority = distance / Math.pow(2, 20 - requestedTile.z);
    this.streamer.request(requestedTile, priority);
    const resolved = this.streamer.resolve(node.tile);
    const uniforms = node.material.uniforms;
    if (resolved) {
      uniforms.uMap.value = resolved.texture;
      uniforms.uUvOffset.value.set(resolved.offsetX, resolved.offsetY);
      uniforms.uUvScale.value = resolved.scale;
      uniforms.uHasTexture.value = 1;
    } else {
      uniforms.uHasTexture.value = 0;
      this.streamer.request(node.tile, priority);
    }

    // Keep a matching elevation tile alive for this area.
    const elevZ = Math.min(node.tile.z, this.elevation.maxZoom);
    const shift = node.tile.z - elevZ;
    this.elevation.request(
      { z: elevZ, x: node.tile.x >> shift, y: node.tile.y >> shift },
      distance,
    );
  }

  build(tile, x0, z0, size, existing) {
    const key = tileKey(tile.z, tile.x, tile.y);
    const grid = this.gridSize;
    const n = Math.pow(2, tile.z);
    const nx0 = tile.x / n;
    const ny0 = tile.y / n;
    const step = 1 / n / (grid - 1);

    const node = existing ?? {
      key,
      tile,
      mesh: null,
      geometry: null,
      material: null,
      minY: 0,
      maxY: 0,
      used: 0,
      grid: 0,
      shownFrame: -1,
    };

    const verts = grid + 2; // one skirt ring on each side
    const count = verts * verts;
    let positions = node.geometry && node.grid === grid ? node.geometry.attributes.position.array : null;
    let normals = positions ? node.geometry.attributes.normal.array : null;
    let uvs = positions ? node.geometry.attributes.uv.array : null;
    let beds = positions ? node.geometry.attributes.bed.array : null;
    const fresh = !positions;
    if (fresh) {
      positions = new Float32Array(count * 3);
      normals = new Float32Array(count * 3);
      uvs = new Float32Array(count * 2);
      beds = new Float32Array(count);
    }

    const heights = new Float32Array(grid * grid);
    // The same points unclamped, sea floor and all. The surface is clamped to
    // sea level so the ocean is flat; the shader needs the real depth beneath
    // it to tell a bay from a beach when there is no photograph to go on.
    const bedHeights = new Float32Array(grid * grid);
    let minY = Infinity;
    let maxY = -Infinity;

    for (let gy = 0; gy < grid; gy++) {
      const ny = ny0 + gy * step;
      for (let gx = 0; gx < grid; gx++) {
        const raw = this.elevation.sampleNorm(nx0 + gx * step, ny);
        const h = Math.max(SEA_LEVEL, raw);
        heights[gy * grid + gx] = h;
        bedHeights[gy * grid + gx] = raw;
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    }

    const cell = size / (grid - 1);
    const skirt = Math.max(12, size * 0.02);

    for (let vy = 0; vy < verts; vy++) {
      const gy = clamp(vy - 1, 0, grid - 1);
      const edgeY = vy === 0 || vy === verts - 1;
      for (let vx = 0; vx < verts; vx++) {
        const gx = clamp(vx - 1, 0, grid - 1);
        const edgeX = vx === 0 || vx === verts - 1;
        const i = (vy * verts + vx) * 3;
        const h = heights[gy * grid + gx];

        positions[i] = gx * cell;
        positions[i + 1] = edgeX || edgeY ? h - skirt : h;
        positions[i + 2] = gy * cell;
        beds[vy * verts + vx] = bedHeights[gy * grid + gx];

        const hl = heights[gy * grid + Math.max(0, gx - 1)];
        const hr = heights[gy * grid + Math.min(grid - 1, gx + 1)];
        const hu = heights[Math.max(0, gy - 1) * grid + gx];
        const hd = heights[Math.min(grid - 1, gy + 1) * grid + gx];
        const nxv = hl - hr;
        const nzv = hu - hd;
        const inv = 1 / Math.hypot(nxv, 2 * cell, nzv);
        normals[i] = nxv * inv;
        normals[i + 1] = 2 * cell * inv;
        normals[i + 2] = nzv * inv;

        const u = (vy * verts + vx) * 2;
        uvs[u] = gx / (grid - 1);
        uvs[u + 1] = gy / (grid - 1);
      }
    }

    let geometry = node.geometry;
    if (fresh || node.grid !== grid) {
      if (geometry) geometry.dispose();
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setAttribute('bed', new THREE.BufferAttribute(beds, 1));
      geometry.setIndex(buildIndices(verts));
    } else {
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.normal.needsUpdate = true;
      geometry.attributes.bed.needsUpdate = true;
    }
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(size / 2, (minY + maxY) / 2, size / 2),
      Math.hypot(size, maxY - minY) * 0.75,
    );

    if (!node.material) node.material = createTerrainMaterial(this.shared);
    if (!node.mesh) {
      node.mesh = new THREE.Mesh(geometry, node.material);
      node.mesh.frustumCulled = false;
      node.mesh.matrixAutoUpdate = false;
      node.mesh.visible = false;
      this.group.add(node.mesh);
    } else {
      node.mesh.geometry = geometry;
    }

    node.mesh.position.set(x0, 0, z0);
    node.mesh.updateMatrix();
    node.mesh.updateMatrixWorld(true);
    node.size = size;
    node.geometry = geometry;
    node.grid = grid;
    node.tile = tile;
    node.minY = minY - 5;
    node.maxY = maxY + 5;
    node.dirty = false;
    node.builtVersion = this.elevation.version ?? 0;
    node.used = this.streamer.frame;

    this.nodes.set(key, node);
    return node;
  }

  /**
   * Height of the *drawn* surface under a point, or null if nothing is drawn
   * there yet.
   *
   * `heightAt` samples the elevation field, but a tile's mesh only carries a
   * grid of those samples and interpolates between them — so on broken ground
   * the surface you can see sits a little above the field, and standing at the
   * field's height leaves you shin-deep in it. Asking the mesh directly is what
   * keeps your feet on the ground you are actually looking at.
   */
  meshHeightAt(x, z) {
    let best = null;
    let bestSize = Infinity;
    for (const node of this.drawn) {
      // A tile's mesh sits with its corner at the origin, spanning `size`.
      const dx = x - node.mesh.position.x;
      const dz = z - node.mesh.position.z;
      if (dx < 0 || dz < 0 || dx > node.size || dz > node.size) continue;
      // The smallest tile covering the point is the most detailed one.
      if (node.size < bestSize) {
        bestSize = node.size;
        best = node;
      }
    }
    if (!best) return null;

    this._ray.set(this._rayOrigin.set(x, 60000, z), this._rayDown);
    const hit = this._ray.intersectObject(best.mesh, false);
    return hit.length > 0 ? hit[0].point.y : null;
  }

  /** Mark nearby tiles for a rebuild when fresh elevation data lands. */
  invalidateStale(camX, camZ, maxPerFrame = 3) {
    const version = this.elevation.version ?? 0;
    let marked = 0;
    for (const node of this.drawn) {
      if (marked >= maxPerFrame) break;
      if (node.builtVersion === version) continue;
      const dx = node.mesh.position.x - camX;
      const dz = node.mesh.position.z - camZ;
      if (Math.hypot(dx, dz) > 6000) {
        node.builtVersion = version; // too far away to be worth a rebuild
        continue;
      }
      node.dirty = true;
      marked++;
    }
  }

  /**
   * Throw away the least recently used tiles, but never one that is still
   * within reach.
   *
   * Ground you flew over thirty seconds ago used to be evicted the moment the
   * cache filled, so turning round rebuilt it from nothing — a wall of empty
   * ground where you had just been. Anything inside the keep radius survives
   * the cull; only when *that* alone overflows does distance decide.
   */
  evict(limit, camX = 0, camZ = 0) {
    if (this.nodes.size <= limit) return;
    const keep = (this.keepDistance ?? Infinity) ** 2;
    const near = [];
    const far = [];
    for (const node of this.nodes.values()) {
      if (!node.mesh) continue;
      const dx = node.mesh.position.x + (node.size ?? 0) / 2 - camX;
      const dz = node.mesh.position.z + (node.size ?? 0) / 2 - camZ;
      (dx * dx + dz * dz <= keep ? near : far).push(node);
    }
    far.sort((a, b) => a.used - b.used);
    near.sort((a, b) => a.used - b.used);

    let excess = this.nodes.size - limit;
    for (const node of [...far, ...near]) {
      if (excess <= 0) break;
      if (node.mesh && node.mesh.visible) continue;
      this.disposeNode(node);
      this.nodes.delete(node.key);
      excess--;
    }
  }

  disposeNode(node) {
    if (node.mesh) {
      this.group.remove(node.mesh);
      node.mesh.visible = false;
    }
    if (node.geometry) node.geometry.dispose();
    if (node.material) node.material.dispose();
    node.mesh = null;
    node.geometry = null;
    node.material = null;
  }
}

const indexCache = new Map();

function buildIndices(verts) {
  const cached = indexCache.get(verts);
  if (cached) return cached;
  const quads = (verts - 1) * (verts - 1);
  const array = quads * 6 > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  let o = 0;
  for (let y = 0; y < verts - 1; y++) {
    for (let x = 0; x < verts - 1; x++) {
      const a = y * verts + x;
      const b = a + 1;
      const c = a + verts;
      const d = c + 1;
      array[o++] = a;
      array[o++] = c;
      array[o++] = b;
      array[o++] = b;
      array[o++] = c;
      array[o++] = d;
    }
  }
  const attribute = new THREE.BufferAttribute(array, 1);
  indexCache.set(verts, attribute);
  return attribute;
}

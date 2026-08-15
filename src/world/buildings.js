import * as THREE from '../../vendor/three/three.module.js';
import { clamp, rand3 } from '../core/math.js';
import { settings } from '../core/settings.js';
import { latToNormY, lonToNormX, normXToLon, normYToLat, tileKey } from '../geo/mercator.js';
import { overpass } from './overpass.js';

/**
 * Buildings.
 *
 * Footprints come from OpenStreetMap via Overpass and are extruded into walls,
 * a roof and a floor slab per storey. They are hollow and have a door gap cut
 * into one wall, so you can walk inside, stand on the ground floor and climb the
 * stair shaft in the corner.
 *
 * To be straight about it: nobody publishes real interior geometry for the whole
 * planet, so the *outside* of a building here is real data and the *inside* is
 * generated to match the footprint. The alternative was a sealed box you bounce
 * off, which felt worse.
 */

const DATA_ZOOM = 15;
const STOREY_M = 3.2;
const DOOR_WIDTH = 1.4;
const DOOR_HEIGHT = 2.3;
const WALL_COLOUR = new THREE.Color(0.72, 0.70, 0.67);
const ROOF_COLOUR = new THREE.Color(0.42, 0.42, 0.44);

export class Buildings {
  constructor({ scene, frame, terrain }) {
    this.frame = frame;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'buildings';
    scene.add(this.group);

    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });

    this.tiles = new Map();
    this.stats = { tiles: 0, buildings: 0, failed: 0 };
    this.enabled = true;
  }

  rebase() {
    for (const tile of this.tiles.values()) this.disposeTile(tile);
    this.tiles.clear();
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  /**
   * Keep the data tiles around the player loaded. Buildings only matter near
   * the ground, so nothing is fetched while cruising at altitude.
   */
  update(lat, lon, altitudeAboveGround) {
    const wanted = settings.get('buildings');
    this.group.visible = wanted;
    if (!wanted) return;
    // High enough to keep the skyline honest on approach, low enough that a
    // cruise at altitude never touches the network.
    if (altitudeAboveGround > 2200) return;

    const n = Math.pow(2, DATA_ZOOM);
    const cx = Math.floor(lonToNormX(lon) * n);
    const cy = Math.floor(latToNormY(lat) * n);

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = ((cx + dx) % n + n) % n;
        const y = cy + dy;
        if (y < 0 || y >= n) continue;
        const key = tileKey(DATA_ZOOM, x, y);
        if (this.tiles.has(key)) continue;
        // Only the tile you are standing in loads immediately; neighbours wait
        // until it is done so a walk never fires a burst of Overpass queries.
        if ((dx !== 0 || dy !== 0) && overpass.inflight) continue;
        this.fetchTile(key, { z: DATA_ZOOM, x, y });
      }
    }

    this.pruneFar(cx, cy);
  }

  pruneFar(cx, cy) {
    if (this.tiles.size <= 12) return;
    for (const [key, tile] of this.tiles) {
      if (!tile.tile) continue;
      if (Math.abs(tile.tile.x - cx) > 2 || Math.abs(tile.tile.y - cy) > 2) {
        this.disposeTile(tile);
        this.tiles.delete(key);
      }
    }
  }

  async fetchTile(key, tile) {
    const record = { tile, state: 'loading', mesh: null, colliders: [] };
    this.tiles.set(key, record);

    const n = Math.pow(2, DATA_ZOOM);
    const west = normXToLon(tile.x / n);
    const east = normXToLon((tile.x + 1) / n);
    const north = normYToLat(tile.y / n);
    const south = normYToLat((tile.y + 1) / n);
    const query =
      `[out:json][timeout:25];` +
      `way["building"](${south},${west},${north},${east});` +
      `(._;>;);out body;`;

    try {
      const data = await overpass.query(query);
      this.buildTile(record, data);
      record.state = 'ready';
    } catch {
      record.state = 'failed';
      this.stats.failed++;
      // Let it retry later rather than caching a hole forever.
      setTimeout(() => {
        if (this.tiles.get(key) === record && record.state === 'failed') this.tiles.delete(key);
      }, 60000);
    } finally {
      this.stats.tiles = this.tiles.size;
    }
  }

  buildTile(record, data) {
    const nodes = new Map();
    const ways = [];
    for (const element of data.elements ?? []) {
      if (element.type === 'node') nodes.set(element.id, element);
      else if (element.type === 'way' && element.tags && element.tags.building) ways.push(element);
    }
    if (ways.length === 0) return;

    const positions = [];
    const normals = [];
    const colors = [];
    const colliders = [];
    const world = { x: 0, y: 0, z: 0 };

    for (const way of ways.slice(0, 900)) {
      const ring = [];
      for (const id of way.nodes ?? []) {
        const node = nodes.get(id);
        if (!node) continue;
        this.frame.toWorld(node.lat, node.lon, world);
        ring.push(new THREE.Vector2(world.x, world.z));
      }
      if (ring.length >= 3) {
        // Overpass repeats the first node to close the ring.
        if (ring[0].distanceTo(ring[ring.length - 1]) < 0.01) ring.pop();
      }
      if (ring.length < 3) continue;
      if (signedArea(ring) < 0) ring.reverse();

      const collider = this.emitBuilding(way, ring, positions, normals, colors);
      if (collider) colliders.push(collider);
    }

    if (positions.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);

    record.mesh = mesh;
    record.colliders = colliders;
    this.stats.buildings += colliders.length;
  }

  emitBuilding(way, ring, positions, normals, colors) {
    const tags = way.tags ?? {};
    const levels = clamp(
      Number(tags['building:levels']) || Math.round((Number(tags.height) || 0) / STOREY_M) || 3,
      1,
      120,
    );
    const height = clamp(Number(tags.height) || levels * STOREY_M, 2.5, 460);

    // Sit the building on the lowest ground under its footprint so it does not
    // float on a slope.
    let base = Infinity;
    for (const p of ring) base = Math.min(base, this.terrain.heightAt(p.x, p.y));
    if (!Number.isFinite(base)) return null;

    const seed = Math.abs(way.id | 0);
    const tint = 0.86 + rand3(seed, 7, 3) * 0.26;
    const wall = WALL_COLOUR.clone().multiplyScalar(tint);
    const roof = ROOF_COLOUR.clone().multiplyScalar(0.9 + rand3(seed, 11, 5) * 0.3);

    // Door goes in the longest wall, which is nearly always the street side.
    let doorIndex = 0;
    let longest = -1;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const len = a.distanceTo(b);
      if (len > longest) {
        longest = len;
        doorIndex = i;
      }
    }
    const enterable = longest > DOOR_WIDTH * 2.2 && height > 3;

    const segments = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (enterable && i === doorIndex) {
        const dir = new THREE.Vector2().subVectors(b, a);
        const len = dir.length();
        dir.divideScalar(len);
        const midStart = (len - DOOR_WIDTH) / 2;
        const p1 = new THREE.Vector2().copy(a).addScaledVector(dir, midStart);
        const p2 = new THREE.Vector2().copy(a).addScaledVector(dir, midStart + DOOR_WIDTH);
        pushWall(positions, normals, colors, a, p1, base, base + height, wall);
        pushWall(positions, normals, colors, p2, b, base, base + height, wall);
        // Lintel above the doorway.
        pushWall(positions, normals, colors, p1, p2, base + DOOR_HEIGHT, base + height, wall);
        segments.push([a.x, a.y, p1.x, p1.y], [p2.x, p2.y, b.x, b.y]);
        continue;
      }
      pushWall(positions, normals, colors, a, b, base, base + height, wall);
      segments.push([a.x, a.y, b.x, b.y]);
    }

    const triangles = triangulate(ring);
    pushCap(positions, normals, colors, ring, triangles, base + height, roof, true);

    const floors = [base];
    if (enterable) {
      const floorColour = wall.clone().multiplyScalar(0.82);
      for (let level = 1; level < Math.min(levels, 40); level++) {
        const y = base + level * (height / levels);
        if (y > base + height - 1.6) break;
        pushCap(positions, normals, colors, ring, triangles, y, floorColour, true);
        floors.push(y);
      }
    }

    const bounds = ringBounds(ring);
    return {
      polygon: ring.map((p) => [p.x, p.y]),
      segments,
      floors,
      base,
      top: base + height,
      enterable,
      minX: bounds.minX,
      maxX: bounds.maxX,
      minZ: bounds.minZ,
      maxZ: bounds.maxZ,
      // Stair shaft: a climbable column just inside the door.
      stair: enterable ? stairPoint(ring, doorIndex) : null,
      name: tags.name ?? '',
      levels,
    };
  }

  /** Every collider whose footprint contains or touches a world XZ point. */
  collidersNear(x, z, radius) {
    const out = [];
    for (const tile of this.tiles.values()) {
      if (!tile.colliders) continue;
      for (const c of tile.colliders) {
        if (x < c.minX - radius || x > c.maxX + radius) continue;
        if (z < c.minZ - radius || z > c.maxZ + radius) continue;
        out.push(c);
      }
    }
    return out;
  }

  disposeTile(tile) {
    if (tile.mesh) {
      this.group.remove(tile.mesh);
      tile.mesh.geometry.dispose();
    }
    tile.mesh = null;
    tile.colliders = [];
  }
}

function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function ringBounds(ring) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of ring) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.y);
    maxZ = Math.max(maxZ, p.y);
  }
  return { minX, maxX, minZ, maxZ };
}

function triangulate(ring) {
  try {
    return THREE.ShapeUtils.triangulateShape(ring, []);
  } catch {
    return [];
  }
}

function pushWall(positions, normals, colors, a, b, bottom, top, colour) {
  const dx = b.x - a.x;
  const dz = b.y - a.y;
  const len = Math.hypot(dx, dz) || 1;
  const nx = dz / len;
  const nz = -dx / len;

  const quad = [
    [a.x, bottom, a.y],
    [b.x, bottom, b.y],
    [b.x, top, b.y],
    [a.x, bottom, a.y],
    [b.x, top, b.y],
    [a.x, top, a.y],
  ];
  for (const v of quad) {
    positions.push(v[0], v[1], v[2]);
    normals.push(nx, 0, nz);
    colors.push(colour.r, colour.g, colour.b);
  }
}

function pushCap(positions, normals, colors, ring, triangles, y, colour, up) {
  for (const tri of triangles) {
    for (let k = 0; k < 3; k++) {
      const idx = tri[up ? k : 2 - k];
      const p = ring[idx];
      if (!p) continue;
      positions.push(p.x, y, p.y);
      normals.push(0, 1, 0);
      colors.push(colour.r, colour.g, colour.b);
    }
  }
}

/** A point a couple of metres inside the wall next to the door. */
function stairPoint(ring, doorIndex) {
  const a = ring[doorIndex];
  const b = ring[(doorIndex + 1) % ring.length];
  const mx = (a.x + b.x) / 2;
  const mz = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dz = b.y - a.y;
  const len = Math.hypot(dx, dz) || 1;
  // Inward normal (ring is wound counter-clockwise after the fix-up above).
  return { x: mx - (dz / len) * 2.2, z: mz + (dx / len) * 2.2 };
}

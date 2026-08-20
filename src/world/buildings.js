import * as THREE from '../../vendor/three/three.module.js';
import { clamp, rand3 } from '../core/math.js';
import { sampleImageryAt } from './imagerySample.js';
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
/**
 * Only used when the aerial photograph of a roof has not arrived yet.
 *
 * The roof colour is read from the imagery of that exact building — it is
 * right there in the picture, and inventing a grey for it when the real one is
 * already downloaded is exactly the kind of made-up dressing this project
 * keeps out. These are the placeholder until the tile lands.
 */
const WALL_COLOUR = new THREE.Color(0.72, 0.70, 0.67);
const ROOF_COLOUR = new THREE.Color(0.42, 0.42, 0.44);
/** Galvanised steel, near enough, for masts and pylons. */
const MAST_COLOUR = new THREE.Color(0.55, 0.57, 0.60);

/**
 * Carriageway width in metres by OSM highway class.
 *
 * OSM records `width` and `lanes` on a minority of ways; where it does, that
 * wins. These are the fallbacks, and they are ordinary real-world widths for
 * each class rather than anything invented for effect.
 */
const ROAD_WIDTH_M = {
  motorway: 14, trunk: 12, primary: 10, secondary: 8.5, tertiary: 7,
  unclassified: 5.5, residential: 5.5, living_street: 5, service: 4,
  track: 3, pedestrian: 4, footway: 1.6, path: 1.2, cycleway: 2,
};
/** Unsurfaced classes, so a farm track is not drawn as fresh tarmac. */
const UNPAVED = new Set(['track', 'path']);
/** Tarmac, and the pale gravel of an unsurfaced track. */
const ROAD_COLOUR = new THREE.Color(0.24, 0.24, 0.25);
const TRACK_COLOUR = new THREE.Color(0.46, 0.42, 0.36);
/** Lift the ribbon this far off the ground so it does not fight the terrain. */
const ROAD_LIFT_M = 0.12;

/**
 * Default heights for point-mapped structures, metres, where OSM does not
 * record one. Rough but not invented: these are typical builds for each kind.
 */
const MAST_HEIGHT_M = {
  tower: 40,
  communications_tower: 90,
  mast: 60,
  chimney: 70,
  water_tower: 32,
  storage_tank: 14,
  silo: 22,
  power_tower: 32,
  wind_turbine: 105,
};

/** Which of those, if any, a node is. */
function mastKind(tags = {}) {
  if (tags.power === 'tower') return 'power_tower';
  if (tags.power === 'generator') {
    return tags['generator:source'] === 'wind' ? 'wind_turbine' : '';
  }
  return tags.man_made ?? '';
}

/** Does this way describe something worth standing up in the world? */
function isStructure(tags = {}) {
  if (tags.building || tags['building:part']) return true;
  if (tags.bridge === 'yes') return true;
  return /^(bridge|tower|chimney|storage_tank|silo|gasometer|water_tower|cooling_tower|pier)$/.test(
    tags.man_made ?? '',
  );
}

/** Four corners to two triangles, flat-shaded. */
function pushQuad(positions, normals, colors, a, b, c, d, colour) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = d.x - a.x;
  const vy = d.y - a.y;
  const vz = d.z - a.z;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  for (const v of [a, b, c, a, c, d]) {
    positions.push(v.x, v.y, v.z);
    normals.push(nx, ny, nz);
    colors.push(colour.r, colour.g, colour.b);
  }
}

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
    // Buildings, plus the infrastructure that makes a place look like a place
    // from the air. This is the layer Google Earth is really showing you when
    // its 3D looks convincing — bridges, masts, towers, chimneys, turbines,
    // gasometers — and OpenStreetMap has all of it, keyless, with heights.
    const bbox = `${south},${west},${north},${east}`;
    const query =
      `[out:json][timeout:25];(` +
      `way["building"](${bbox});` +
      `way["building:part"](${bbox});` +
      `way["man_made"~"^(bridge|tower|chimney|storage_tank|silo|gasometer|water_tower|cooling_tower|pier)$"](${bbox});` +
      `way["bridge"="yes"]["layer"](${bbox});` +
      `node["man_made"~"^(tower|mast|chimney|water_tower|communications_tower|storage_tank|silo)$"](${bbox});` +
      `node["power"~"^(tower|generator)$"](${bbox});` +
      `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|track|pedestrian|footway|path|cycleway)$"](${bbox});` +
      `);(._;>;);out body;`;

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
    const roads = [];
    const masts = [];
    for (const element of data.elements ?? []) {
      if (element.type === 'node') {
        nodes.set(element.id, element);
        // A node is both a vertex of some way *and* possibly a structure in
        // its own right, so this is not an else — every way needs its
        // coordinates regardless of what the node itself is tagged as.
        if (element.tags && MAST_HEIGHT_M[mastKind(element.tags)]) masts.push(element);
      } else if (element.type === 'way' && element.tags) {
        if (isStructure(element.tags)) ways.push(element);
        else if (element.tags.highway) roads.push(element);
      }
    }
    if (ways.length === 0 && masts.length === 0 && roads.length === 0) return;

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

    // Roads, drawn as ribbons following the ground. Real geometry from the
    // survey: OSM knows where every carriageway runs and, often, how wide.
    for (const way of roads.slice(0, 700)) {
      const line = [];
      for (const id of way.nodes ?? []) {
        const node = nodes.get(id);
        if (!node) continue;
        this.frame.toWorld(node.lat, node.lon, world);
        line.push({ x: world.x, z: world.z });
      }
      if (line.length >= 2) this.emitRoad(way, line, positions, normals, colors);
    }

    // Vertical structures mapped as single points — masts, pylons, chimneys,
    // turbines. A footprint cannot describe these, but their *height* is the
    // whole point of them, so they are raised parametrically from the tag.
    for (const node of masts.slice(0, 240)) {
      this.frame.toWorld(node.lat, node.lon, world);
      this.emitMast(node, world.x, world.z, positions, normals, colors);
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

  /**
   * A road, as a ribbon of quads following the carriageway and draped over the
   * ground.
   *
   * Every vertex of the centreline is surveyed — OSM knows where the road
   * runs. The width comes from the data too where it is tagged, and from the
   * ordinary width of that road class where it is not. The surface colour is
   * sampled from the aerial photograph, which sees roads better than it sees
   * anything else, so a red-sand track in Australia is not grey tarmac.
   */
  emitRoad(way, line, positions, normals, colors) {
    const tags = way.tags ?? {};
    const kind = tags.highway;
    const lanes = Number(tags.lanes);
    const width = clamp(
      Number(tags.width) || (lanes > 0 ? lanes * 3.1 : 0) || ROAD_WIDTH_M[kind] || 5,
      1,
      40,
    );
    const half = width / 2;

    const sampled = sampleImageryAt(this.frame, line[0].x, line[0].z);
    const base = UNPAVED.has(kind) ? TRACK_COLOUR : ROAD_COLOUR;
    // Lean on the photograph, but keep some of the surface tone: a road under
    // tree shadow should still read as a road.
    const colour = sampled
      ? new THREE.Color(sampled.r, sampled.g, sampled.b).lerp(base, 0.55)
      : base.clone();

    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      // Skip degenerate segments, and anything absurdly long, which means the
      // way crossed the tile and its far node was never fetched.
      if (length < 0.5 || length > 4000) continue;
      const nx = (-dz / length) * half;
      const nz = (dx / length) * half;

      const ay = this.terrain.heightAt(a.x, a.z);
      const by = this.terrain.heightAt(b.x, b.z);
      if (!Number.isFinite(ay) || !Number.isFinite(by)) continue;

      pushQuad(
        positions, normals, colors,
        { x: a.x - nx, y: ay + ROAD_LIFT_M, z: a.z - nz },
        { x: a.x + nx, y: ay + ROAD_LIFT_M, z: a.z + nz },
        { x: b.x + nx, y: by + ROAD_LIFT_M, z: b.z + nz },
        { x: b.x - nx, y: by + ROAD_LIFT_M, z: b.z - nz },
        colour,
      );
      this.stats.roadSegments = (this.stats.roadSegments ?? 0) + 1;
    }
  }

  /**
   * A slender vertical structure from a single OSM node: a lattice pylon, a
   * radio mast, a chimney, a wind turbine. Drawn as a tapered column, which at
   * any distance you would actually see one from is the honest amount of
   * detail — the height and the position are the real data, and those are what
   * make a skyline read correctly.
   */
  emitMast(node, x, z, positions, normals, colors) {
    const tags = node.tags ?? {};
    const kind = mastKind(tags);
    const height = clamp(
      Number(tags.height) || Number(tags['tower:height']) || MAST_HEIGHT_M[kind] || 30,
      4,
      640,
    );
    const base = this.terrain.heightAt(x, z);
    if (!Number.isFinite(base)) return;

    const seed = Math.abs(node.id | 0);
    const width = clamp(height * 0.055, 0.7, 9);
    const sampled = sampleImageryAt(this.frame, x, z);
    const colour = sampled
      ? new THREE.Color(sampled.r, sampled.g, sampled.b).lerp(MAST_COLOUR, 0.45)
      : MAST_COLOUR.clone().multiplyScalar(0.88 + rand3(seed, 3, 9) * 0.24);
    // A square tapered shaft: four walls, narrower at the top.
    const half = width / 2;
    const tip = half * 0.35;
    const corners = [
      [-half, -half, -tip, -tip], [half, -half, tip, -tip],
      [half, half, tip, tip], [-half, half, -tip, tip],
    ];
    for (let i = 0; i < 4; i++) {
      const [ax, az, atx, atz] = corners[i];
      const [bx, bz, btx, btz] = corners[(i + 1) % 4];
      pushQuad(
        positions, normals, colors,
        { x: x + ax, y: base, z: z + az }, { x: x + bx, y: base, z: z + bz },
        { x: x + btx, y: base + height, z: z + btz },
        { x: x + atx, y: base + height, z: z + atz },
        colour,
      );
    }
    this.stats.masts = (this.stats.masts ?? 0) + 1;
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

    // The roof is in the photograph. Take it from there: a terracotta roof in
    // Tuscany and a grey slate one in Yorkshire are not the same colour, and
    // the imagery already knows which is which.
    let centreX = 0;
    let centreZ = 0;
    for (const p of ring) {
      centreX += p.x;
      centreZ += p.y;
    }
    centreX /= ring.length;
    centreZ /= ring.length;
    const sampled = sampleImageryAt(this.frame, centreX, centreZ);

    let wall;
    let roof;
    if (sampled) {
      roof = new THREE.Color(sampled.r, sampled.g, sampled.b);
      // Walls are not visible from above, so there is nothing to sample them
      // from. Derive them from the roof instead — same building, same era,
      // usually lighter and less saturated than what is on top of it.
      const hsl = { h: 0, s: 0, l: 0 };
      roof.getHSL(hsl);
      wall = new THREE.Color().setHSL(
        hsl.h,
        hsl.s * 0.45,
        clamp(hsl.l * 0.6 + 0.34, 0.22, 0.86) * tint,
      );
    } else {
      wall = WALL_COLOUR.clone().multiplyScalar(tint);
      roof = ROOF_COLOUR.clone().multiplyScalar(0.9 + rand3(seed, 11, 5) * 0.3);
    }

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

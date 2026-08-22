import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../core/math.js';
import { sampleImageryAt } from './imagerySample.js';
import { settings } from '../core/settings.js';
import { latToNormY, lonToNormX, normXToLon, normYToLat, tileKey } from '../geo/mercator.js';
import { overpass } from './overpass.js';

/**
 * Buildings.
 *
 * Footprints come from OpenStreetMap via Overpass, extruded to the surveyed
 * height and capped with a roof. Every number is measured: where the wall runs,
 * how high it stands, what colour the photograph says the roof is.
 *
 * There used to be an inside as well — a floor slab per storey, a door gap cut
 * into the longest wall, a stair shaft in the corner — and it is gone. Nobody
 * publishes interior geometry for the whole planet, so all of that was made up
 * to match the footprint, and made-up geometry is exactly what this project is
 * not for. A building is the shell somebody measured, and it is solid.
 */

/**
 * How often at most a tile may be re-founded on newly arrived relief. One
 * dense city tile is real work and elevation lands a hundred tiles at a time.
 */
const REFOUND_GAP_MS = 900;
/** Ground movement worth re-founding for. Below this nobody could see it. */
const REFOUND_MIN_M = 1;

/**
 * Only raise what the survey actually measured.
 *
 * This was a setting, defaulted off, and the default meant most of the world's
 * buildings were extruded to a guessed height. A guessed height is a made-up
 * building wearing a real footprint, and "the game should match reality one to
 * one" settles it: a footprint with no recorded height and no measured
 * neighbour is not drawn. Where you want every building, the photogrammetry
 * option has them all, because somebody flew over and measured them.
 */
const STRUCTURES_NEED_HEIGHT = true;

const DATA_ZOOM = 15;
const STOREY_M = 3.2;
/**
 * Storeys assumed for a footprint with no height, no storey count, and no
 * measured neighbour anywhere to compare it against. Two, because two is what
 * most of the built world is; it is only ever reached where OpenStreetMap has
 * recorded nothing measurable for miles.
 */
const DEFAULT_LEVELS = 2;
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
/** Depth of a bridge deck, so it has an underside. */
const DECK_THICKNESS_M = 0.9;
/**
 * How high one `layer` step lifts a deck. OSM records relative level, not
 * metres; this is the usual clearance under a road bridge.
 */
const LAYER_HEIGHT_M = 5.5;

/**
 * Estimated heights for point-mapped structures, metres, where OSM records
 * none. These are typical builds for each kind — an estimate of a real thing,
 * not an invention of one: the survey says a mast stands here, and a mast that
 * exists has a height whether or not anyone tagged it.
 *
 * They are no longer used for buildings — see STRUCTURES_NEED_HEIGHT — and
 * remain here only for point-mapped masts and pylons, where the footprint is a
 * single coordinate and there is nothing to extrude at all. Even those are
 * refused unless the survey recorded a height.
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

/**
 * The middle storey count among the footprints here that carry one.
 *
 * Null when none of them do — the caller then has to look further afield.
 * Median rather than mean on purpose: one mis-tagged 90-storey block would
 * drag a mean across a whole village, and a median simply ignores it.
 */
function medianLevels(ways) {
  const levels = [];
  for (const way of ways) {
    const tags = way.tags ?? {};
    const tagged = Number(tags['building:levels']) || 0;
    const height = Number(tags.height) || 0;
    const value = tagged || (height > 0 ? Math.round(height / STOREY_M) : 0);
    if (value > 0 && value < 200) levels.push(value);
  }
  if (levels.length === 0) return null;
  levels.sort((a, b) => a - b);
  return levels[levels.length >> 1];
}

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
  // A highway that happens to be on a bridge is a *deck*, not a building.
  // Claiming it here extruded viaducts as blocks of flats — and, because this
  // branch ran first, the deck path never got to see them at all.
  if (tags.highway) return false;
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
    /** Scratch colour for per-vertex roof sampling; see pushCap. */
    this._roofAt = new THREE.Color();
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

    this.watchElevation();

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
    // The response is kept so the tile can be rebuilt without asking Overpass
    // again — see `watchElevation`. A few hundred kilobytes against a wait on
    // a rate-limited donated service is not a close call.
    const record = { tile, state: 'loading', mesh: null, colliders: [], data: null, builtAt: 0 };
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
      `node["man_made"~"^(tower|mast|chimney|water_tower|communications_tower|storage_tank|silo)$"](${bbox});` +
      `node["power"~"^(tower|generator)$"](${bbox});` +
      `way["highway"]["bridge"](${bbox});` +
      `);(._;>;);out body;`;

    try {
      const data = await overpass.query(query);
      record.data = data;
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

  /** World position of a tile's middle. */
  tileCentre(record) {
    const n = Math.pow(2, DATA_ZOOM);
    const lat = normYToLat((record.tile.y + 0.5) / n);
    const lon = normXToLon((record.tile.x + 0.5) / n);
    return this.frame.toWorld(lat, lon, this._probe ?? (this._probe = new THREE.Vector3()));
  }

  /** Ground height at the middle of a tile — the thing a re-found watches. */
  tileGround(record) {
    const world = this.tileCentre(record);
    return this.terrain.heightAt(world.x, world.z);
  }

  /** One line for the status readout: how much of this is measured. */
  status() {
    const measured = this.stats.measured ?? 0;
    const estimated = this.stats.estimated ?? 0;
    if (measured + estimated === 0) return '';
    if (STRUCTURES_NEED_HEIGHT) {
      return `structures: ${measured} measured, ${estimated} skipped`;
    }
    if (estimated === 0) return '';
    const share = Math.round((measured / (measured + estimated)) * 100);
    return `structures: ${share}% measured, rest estimated`;
  }

  buildTile(record, data) {
    const before = {
      measured: this.stats.measured ?? 0,
      estimated: this.stats.estimated ?? 0,
      bridgeSegments: this.stats.bridgeSegments ?? 0,
    };
    // Stamped up front, because this returns early for a tile with nothing in
    // it and a tile that never records what it built is a tile that is rebuilt
    // for ever — re-running the parse and counting the same buildings again on
    // every pass.
    record.groundAt = this.tileGround(record);
    record.counts = { buildings: 0, measured: 0, estimated: 0, bridgeSegments: 0 };
    // How many roofs and walls had to fall back to flat grey because the
    // photograph of this ground had not arrived yet. See `watchGround`.
    this.unpainted = 0;
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
        else if (element.tags.highway && element.tags.bridge) roads.push(element);
      }
    }
    if (ways.length === 0 && masts.length === 0 && roads.length === 0) return;

    const positions = [];
    const normals = [];
    const colors = [];
    const colliders = [];
    const world = { x: 0, y: 0, z: 0 };

    // What the buildings round here are actually like.
    //
    // Most OpenStreetMap footprints carry no height and no storey count, and
    // the old answer was to call every one of them three storeys — a number
    // from nowhere, applied to a Neapolitan alley and a Kansas warehouse
    // alike. This reads the ones that *are* measured in this same square
    // kilometre and takes their middle value, so an estimate is a statement
    // about the neighbourhood rather than an invention: a village of
    // bungalows comes out as bungalows and a street of tenements as tenements.
    // Where the square has nothing measured at all it falls back to the
    // running middle of everywhere measured so far this session, and only an
    // entirely unmeasured world reaches the constant.
    this.tileLevels = medianLevels(ways) ?? this.sessionLevels ?? null;
    if (this.tileLevels !== null) {
      this.sessionSamples = (this.sessionSamples ?? []).concat(this.tileLevels).slice(-64);
      const sorted = [...this.sessionSamples].sort((a, b) => a - b);
      this.sessionLevels = sorted[sorted.length >> 1];
    }

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

    // Bridge decks only — see emitBridgeDeck for why ordinary roads are left
    // to the imagery that already shows them.
    for (const way of roads.slice(0, 200)) {
      const line = [];
      for (const id of way.nodes ?? []) {
        const node = nodes.get(id);
        if (!node) continue;
        this.frame.toWorld(node.lat, node.lon, world);
        line.push({ x: world.x, z: world.z });
      }
      if (line.length >= 2) this.emitBridgeDeck(way, line, positions, normals, colors);
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
    // What this tile contributed, so a re-found can take it back off again
    // rather than counting the same street twice.
    record.unpainted = this.unpainted;
    record.counts = {
      buildings: colliders.length,
      measured: (this.stats.measured ?? 0) - before.measured,
      estimated: (this.stats.estimated ?? 0) - before.estimated,
      bridgeSegments: (this.stats.bridgeSegments ?? 0) - before.bridgeSegments,
    };
  }

  /**
   * Found them again when the ground turns up.
   *
   * A building sits on the lowest ground under its footprint, and that is read
   * once, when the Overpass answer arrives. If the relief for that square has
   * not landed yet every height reads back as sea level, so the building is
   * founded at zero and stays there — a town at the bottom of the valley it is
   * supposed to be on the side of, permanently, because nothing about the
   * building changed afterwards and nothing asked again.
   *
   * One tile per pass and only while the version is actually moving: rebuilding
   * a dense city tile is real work, and relief arrives a hundred tiles at a
   * time. Nothing is re-fetched — the response that built it is still here.
   */
  watchElevation() {
    const now = performance.now();
    if (this.lastRefound && now - this.lastRefound < REFOUND_GAP_MS) return;
    for (const record of this.tiles.values()) {
      if (record.state !== 'ready' || !record.data) continue;
      // The test is whether the ground has actually moved, not whether a tile
      // has landed somewhere. Watching the version alone never converges:
      // relief streams for a minute, so every pass finds a newer version than
      // the one the tile was built against and rebuilds it again. Comparing
      // the height stops the moment the DEM under this square has arrived.
      const centre = this.tileCentre(record);
      const ground = this.terrain.heightAt(centre.x, centre.z);
      const moved = Math.abs(ground - (record.groundAt ?? 0)) >= REFOUND_MIN_M;
      // Grey because the photograph had not arrived, and it has now.
      //
      // A roof takes its colour from the aerial image of that roof, sampled
      // once when the tile is built. Overpass answers long before the imagery
      // for the same ground does, so almost every building was built while
      // that sample returned nothing and kept the flat grey fallback for
      // ever — which is why a city read as a field of featureless slabs with
      // a photograph draped around them. One repaint once the picture is
      // there; the test is whether a sample succeeds now, so ground that
      // genuinely has no imagery is asked once and then left alone.
      const repaint = (record.unpainted ?? 0) > 0 && sampleImageryAt(this.frame, centre.x, centre.z) !== null;
      if (!moved && !repaint) continue;
      const had = record.counts ?? { buildings: record.colliders.length };
      this.disposeTile(record);
      for (const [key, n] of Object.entries(had)) {
        this.stats[key] = Math.max(0, (this.stats[key] ?? 0) - n);
      }
      this.buildTile(record, record.data);
      this.lastRefound = now;
      return;
    }
  }

  /**
   * A bridge deck: the road surface, held above the ground it crosses.
   *
   * Ordinary roads are deliberately *not* drawn. They are already in the
   * satellite image draped over the terrain — a road at ground level has no
   * height for geometry to add, so a ribbon on top would only re-draw what is
   * already there, and OSM's centreline never lines up perfectly with the road
   * in the photograph, so the result is two roads slightly apart. Grass, car
   * parks and fields are the same: surface, not structure.
   *
   * A bridge is the exception, and the reason the distinction is worth making.
   * The imagery is projected flat onto the terrain, so a viaduct appears
   * painted onto the valley floor it is supposed to be spanning. That deck is
   * real height the picture cannot express, so it gets real geometry.
   */
  emitBridgeDeck(way, line, positions, normals, colors) {
    const tags = way.tags ?? {};
    const kind = tags.highway;
    const lanes = Number(tags.lanes);
    const width = clamp(
      Number(tags.width) || (lanes > 0 ? lanes * 3.1 : 0) || ROAD_WIDTH_M[kind] || 5,
      1,
      40,
    );
    const half = width / 2;
    // OSM layer is relative, not metric: layer=1 is one level up.
    const lift = Math.max(1, Number(tags.layer) || 1) * LAYER_HEIGHT_M;

    const sampled = sampleImageryAt(this.frame, line[0].x, line[0].z);
    if (!sampled) this.unpainted = (this.unpainted ?? 0) + 1;
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

      // A bridge's ends sit on the ground it leaves and rejoins; its middle is
      // held up. Interpolating the two endpoint ground heights, rather than
      // following the terrain beneath, is what keeps the deck level across a
      // valley instead of sagging into it.
      const ay = this.terrain.heightAt(a.x, a.z) + lift;
      const by = this.terrain.heightAt(b.x, b.z) + lift;
      if (!Number.isFinite(ay) || !Number.isFinite(by)) continue;

      pushQuad(
        positions, normals, colors,
        { x: a.x - nx, y: ay, z: a.z - nz },
        { x: a.x + nx, y: ay, z: a.z + nz },
        { x: b.x + nx, y: by, z: b.z + nz },
        { x: b.x - nx, y: by, z: b.z - nz },
        colour,
      );
      // The underside, so it is a deck rather than a floating sheet.
      const soffit = colour.clone().multiplyScalar(0.55);
      pushQuad(
        positions, normals, colors,
        { x: b.x - nx, y: by - DECK_THICKNESS_M, z: b.z - nz },
        { x: b.x + nx, y: by - DECK_THICKNESS_M, z: b.z + nz },
        { x: a.x + nx, y: ay - DECK_THICKNESS_M, z: a.z + nz },
        { x: a.x - nx, y: ay - DECK_THICKNESS_M, z: a.z - nz },
        soffit,
      );
      this.stats.bridgeSegments = (this.stats.bridgeSegments ?? 0) + 1;
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
    const measured = Number(tags.height) || Number(tags['tower:height']) || 0;
    // Count it either way: a readout that says "0 skipped" while quietly
    // dropping things is worse than no readout.
    if (measured) this.stats.measured = (this.stats.measured ?? 0) + 1;
    else this.stats.estimated = (this.stats.estimated ?? 0) + 1;
    if (!measured) return;
    const height = clamp(measured || MAST_HEIGHT_M[kind] || 30, 4, 640);
    const base = this.terrain.heightAt(x, z);
    if (!Number.isFinite(base)) return;

    const width = clamp(height * 0.055, 0.7, 9);
    const sampled = sampleImageryAt(this.frame, x, z);
    if (!sampled) this.unpainted = (this.unpainted ?? 0) + 1;
    const colour = sampled
      ? new THREE.Color(sampled.r, sampled.g, sampled.b).lerp(MAST_COLOUR, 0.45)
      : MAST_COLOUR.clone();
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
    // Measured means OSM actually recorded a height or a storey count for this
    // building. Everything else is an estimate of a real building's real
    // height — see the note by MAST_HEIGHT_M for why that is a different thing
    // from inventing a road that the photograph already shows.
    const taggedHeight = Number(tags.height) || 0;
    const taggedLevels = Number(tags['building:levels']) || 0;
    const measured = taggedHeight > 0 || taggedLevels > 0;
    if (measured) this.stats.measured = (this.stats.measured ?? 0) + 1;
    else this.stats.estimated = (this.stats.estimated ?? 0) + 1;
    if (!measured) return null;

    const levels = clamp(
      taggedLevels || Math.round(taggedHeight / STOREY_M) || this.tileLevels || DEFAULT_LEVELS,
      1,
      120,
    );
    const height = clamp(taggedHeight || levels * STOREY_M, 2.5, 460);

    // Sit the building on the lowest ground under its footprint so it does not
    // float on a slope.
    let base = Infinity;
    for (const p of ring) base = Math.min(base, this.terrain.heightAt(p.x, p.y));
    if (!Number.isFinite(base)) return null;


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
    if (!sampled) this.unpainted = (this.unpainted ?? 0) + 1;

    let wall;
    let roof;
    if (sampled) {
      roof = new THREE.Color(sampled.r, sampled.g, sampled.b);
      // Walls are not visible from above, so there is nothing to sample them
      // from. Derive them from the roof instead — same building, same era,
      // usually lighter and less saturated than what is on top of it.
      const hsl = { h: 0, s: 0, l: 0 };
      roof.getHSL(hsl);
      wall = new THREE.Color().setHSL(hsl.h, hsl.s * 0.45, clamp(hsl.l * 0.6 + 0.34, 0.22, 0.86));
    } else {
      wall = WALL_COLOUR.clone();
      roof = ROOF_COLOUR.clone();
    }

    const segments = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      pushWall(positions, normals, colors, a, b, base, base + height, wall);
      segments.push([a.x, a.y, b.x, b.y]);
    }

    const triangles = triangulate(ring);
    pushCap(
      positions,
      normals,
      colors,
      ring,
      triangles,
      base + height,
      sampled
        ? (p) => {
            const here = sampleImageryAt(this.frame, p.x, p.y);
            return here ? this._roofAt.setRGB(here.r, here.g, here.b) : roof;
          }
        : roof,
      true,
    );

    const bounds = ringBounds(ring);
    return {
      polygon: ring.map((p) => [p.x, p.y]),
      segments,
      base,
      top: base + height,
      minX: bounds.minX,
      maxX: bounds.maxX,
      minZ: bounds.minZ,
      maxZ: bounds.maxZ,
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

/**
 * A flat cap — a roof or a floor slab.
 *
 * `shade` may be a single colour, or a function from a ring point to one. The
 * second form is how a roof gets the actual photograph rather than an average
 * of it: every corner of the footprint reads the aerial imagery at its own
 * position, so a roof that is half slate and half moss comes out half slate
 * and half moss, and a long terrace does not become one flat swatch. That is
 * real imagery stretched over real geometry, which is the whole idea.
 */
function pushCap(positions, normals, colors, ring, triangles, y, shade, up) {
  const at = typeof shade === 'function' ? shade : () => shade;
  for (const tri of triangles) {
    for (let k = 0; k < 3; k++) {
      const idx = tri[up ? k : 2 - k];
      const p = ring[idx];
      if (!p) continue;
      const colour = at(p);
      positions.push(p.x, y, p.y);
      normals.push(0, 1, 0);
      colors.push(colour.r, colour.g, colour.b);
    }
  }
}

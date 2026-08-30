import * as THREE from '../../vendor/three/three.module.js';
import { normXToLon, normYToLat, tileKey } from '../geo/mercator.js';
import { overpass } from './overpass.js';

/**
 * Where the woods are, as a mask the ground shader can read.
 *
 * Satellite photography draped over elevation is flat, and a forest suffers
 * worst from it: several hundred trees become one green wash with no sense that
 * anything is standing up. What was wanted is slight relief over woodland, so
 * a wood reads as a canopy rather than as paint.
 *
 * Two attempts failed before this one and both are worth keeping in mind.
 *
 * The first keyed off the photograph itself — how green and how rough a patch
 * is at crown scale. Measured over six Esri tiles at zoom 16:
 *
 *   Black Forest    green 0.85   roughness 0.63
 *   Amazon          green 0.40   roughness 0.42
 *   Cambridgeshire  green 0.67   roughness 0.82
 *   Hyde Park       green 0.57   roughness 0.75
 *   central Paris   green 0.09   roughness 2.57
 *   Sahara          green 0.01   roughness 0.48
 *
 * Neither number separates a forest from a field of wheat — farmland scores
 * higher on both than the Amazon does — so anything driven by them would have
 * lit tramlines in Cambridgeshire as though they were spruce.
 *
 * The second laid a sheet of geometry over each surveyed polygon, following the
 * terrain, with the vertex normals tilted. That sheet has to be painted to be
 * drawn, and its colour comes from a vertex every fourteen metres while the
 * ground under it wears a photograph with a texel every half metre. Covering
 * sharp imagery with a coarse Gouraud sheet loses more than tilted normals add:
 * over the Black Forest, in the densest canopy on screen, local relief went
 * from 16.42 without the sheet to 15.60 with it. The wrong way.
 *
 * So: the survey rasterised into a mask, and no geometry at all. OpenStreetMap
 * knows where woodland is — `natural=wood` and `landuse=forest` are among its
 * best-surveyed areas — and that mask says only *where*. The shading is done by
 * the ground shader at the photograph's own resolution, so nothing coarse is
 * ever laid over anything sharp, and the ground you walk on does not move.
 *
 * Nothing here invents a wood. Where OpenStreetMap has nothing mapped the mask
 * is zero and the ground is exactly what it was.
 */

/** Overpass tiles to ask on, matching the buildings so the two share a queue. */
const DATA_ZOOM = 14;

/**
 * The mask: how many texels, and how much ground they cover.
 *
 * 2048 texels over twelve kilometres is about six metres a texel, which is
 * roughly one crown. Finer would be pretending the survey is more precise than
 * it is — a wood's edge in OSM is drawn by hand off aerial imagery and is good
 * to a few metres, not to one.
 */
const MASK = 2048;
const SPAN_M = 12000;

/**
 * How much canopy each kind of wood gets, as a multiplier on the shader's own
 * bump. Conifers are narrow and regular; broadleaves are wide and lumpy, and
 * read as coarser relief from the air.
 */
const LEAF_WEIGHT = { needleleaved: 0.82, broadleaved: 1, mixed: 0.92 };

export class Woodland {
  /**
   * @param {{ frame: any }} deps
   */
  constructor({ frame }) {
    this.frame = frame;
    this.tiles = new Map();
    this.stats = { tiles: 0, polygons: 0, failed: 0 };

    this.canvas = document.createElement('canvas');
    this.canvas.width = MASK;
    this.canvas.height = MASK;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;

    /** World x,z of the mask's corner, and how many metres it spans. */
    this.origin = new THREE.Vector2();
    this.span = SPAN_M;
    this.painted = false;
    this.dirty = true;
    this.paintedAt = new THREE.Vector2(Infinity, Infinity);
    this.enabled = true;
    this._point = { x: 0, z: 0 };
  }

  /** @param {THREE.Camera} camera */
  update(camera) {
    if (!this.enabled) return;
    this.requestAround(camera);
    // Repaint when the camera has left the middle third of the mask, or when
    // new polygons have landed. Repainting is one canvas pass and one upload.
    const moved = Math.hypot(
      camera.position.x - this.paintedAt.x,
      camera.position.z - this.paintedAt.y,
    );
    if (this.dirty || moved > SPAN_M / 6) this.paint(camera);
  }

  requestAround(camera) {
    const geo = this.frame.toGeo(camera.position.x, camera.position.z);
    const n = Math.pow(2, DATA_ZOOM);
    const nx = ((geo.lon + 180) / 360) * n;
    const lat = (geo.lat * Math.PI) / 180;
    const ny = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n;
    const cx = Math.floor(nx);
    const cy = Math.floor(ny);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = ((cx + dx) % n + n) % n;
        const y = cy + dy;
        if (y < 0 || y >= n) continue;
        const key = tileKey(DATA_ZOOM, x, y);
        const held = this.tiles.get(key);
        // An empty square is kept — most ground has no wood on it. It is only
        // asked again once the mirror that said so has been abandoned, and not
        // while the client is resting; see the same test in buildings.update.
        if (held && (overpass.resting || !overpass.emptyIsStale(held))) continue;
        if (held) this.tiles.delete(key);
        // The tile you are in goes first; the ring waits, so walking about
        // never fires a burst of queries at a donated service.
        if ((dx !== 0 || dy !== 0) && overpass.inflight) continue;
        this.fetchTile(key, { z: DATA_ZOOM, x, y });
      }
    }
    this.prune(cx, cy);
  }

  prune(cx, cy) {
    if (this.tiles.size <= 12) return;
    for (const [key, tile] of this.tiles) {
      if (Math.abs(tile.tile.x - cx) > 2 || Math.abs(tile.tile.y - cy) > 2) {
        this.tiles.delete(key);
      }
    }
  }

  async fetchTile(key, tile) {
    const record = { tile, state: 'loading', rings: [] };
    this.tiles.set(key, record);
    const n = Math.pow(2, DATA_ZOOM);
    const west = normXToLon(tile.x / n);
    const east = normXToLon((tile.x + 1) / n);
    const north = normYToLat(tile.y / n);
    const south = normYToLat((tile.y + 1) / n);
    const bbox = `${south},${west},${north},${east}`;
    // Woodland only. Scrub, heath and orchard are different shapes of thing and
    // would want their own relief; a wood is the one that reads wrong as paint.
    const query =
      '[out:json][timeout:25];('
      + `way["natural"="wood"](${bbox});`
      + `way["landuse"="forest"](${bbox});`
      + `relation["natural"="wood"](${bbox});`
      + `relation["landuse"="forest"](${bbox});`
      + ');out geom;';
    try {
      const data = await overpass.query(query);
      record.rings = ringsFrom(data);
      // Which mirror said there was no wood here — see overpass.emptyIsStale.
      if (!(data?.elements?.length > 0)) record.emptyFrom = overpass.mirror;
      record.state = 'ready';
      this.stats.polygons += record.rings.length;
      this.dirty = true;
    } catch {
      record.state = 'failed';
      this.stats.failed++;
      // Let it be asked again later rather than caching a hole for ever.
      setTimeout(() => {
        if (this.tiles.get(key) === record && record.state === 'failed') this.tiles.delete(key);
      }, 60000);
    } finally {
      this.stats.tiles = this.tiles.size;
    }
  }

  /** Draw every ring we hold into the mask, in world space around the camera. */
  paint(camera) {
    const ctx = this.ctx;
    this.origin.set(camera.position.x - SPAN_M / 2, camera.position.z - SPAN_M / 2);
    this.paintedAt.set(camera.position.x, camera.position.z);
    this.dirty = false;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, MASK, MASK);
    const perMetre = MASK / SPAN_M;
    let drawn = 0;
    for (const record of this.tiles.values()) {
      if (record.state !== 'ready') continue;
      for (const ring of record.rings) {
        // The leaf type rides in the mask's own value, so one texture carries
        // both "is this wood" and "what kind", and the shader reads one sample.
        const weight = LEAF_WEIGHT[ring.leaf] ?? LEAF_WEIGHT.mixed;
        ctx.fillStyle = `rgb(${Math.round(255 * weight)},0,0)`;
        ctx.beginPath();
        let started = false;
        let inside = false;
        for (const point of ring.points) {
          this.frame.toWorld(point.lat, point.lon, this._point);
          const px = (this._point.x - this.origin.x) * perMetre;
          const py = (this._point.z - this.origin.y) * perMetre;
          if (px > -64 && px < MASK + 64 && py > -64 && py < MASK + 64) inside = true;
          if (started) ctx.lineTo(px, py);
          else { ctx.moveTo(px, py); started = true; }
        }
        ctx.closePath();
        if (inside) { ctx.fill(); drawn++; }
      }
    }
    this.painted = drawn > 0;
    this.texture.needsUpdate = true;
    this.stats.polygons = drawn;
  }

  dispose() {
    this.texture.dispose();
    this.tiles.clear();
  }
}

/**
 * Closed outlines from an Overpass `out geom` reply.
 *
 * Ways carry their own geometry; relations carry it per member, and only the
 * outer members bound the wood — an inner member is a clearing, and painting it
 * would put canopy on a lake. Clearings are dropped rather than cut out: the
 * mask is a where, not a survey, and a shader that reads it does not need holes
 * in it to be a few metres right.
 */
export function ringsFrom(data) {
  const rings = [];
  for (const el of data?.elements ?? []) {
    const leaf = el.tags?.leaf_type;
    if (el.type === 'way' && el.geometry?.length > 2) {
      rings.push({ leaf, points: el.geometry });
    } else if (el.type === 'relation') {
      for (const member of el.members ?? []) {
        if (member.role !== 'outer' || !(member.geometry?.length > 2)) continue;
        rings.push({ leaf, points: member.geometry });
      }
    }
  }
  return rings;
}

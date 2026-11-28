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

/**
 * How far to smear the sheet, in texels of it.
 *
 * The sheet is 2048 texels over twelve kilometres, so one texel is 5.9 m and
 * this is about three hundred and fifty metres of ramp. That is far wider than
 * a square edge needs, and the width is the whole point: the ground lifts off
 * this sheet in the vertex shader, and a square a kilometre and a half across
 * has vertices fifty metres apart while its neighbour four levels finer has
 * them one metre apart. Both read the same sheet, but the coarse one joins its
 * samples with straight lines — so anything the sheet does between them is
 * lost, and the two surfaces part company along the edge they share.
 *
 * Measured by eye first and then by arithmetic: at a hundred metres of ramp the
 * lift's slope is a tenth, so fifty metres of vertex spacing can hide five
 * metres of it — half the lift, as tile-shaped panels standing at angles to
 * each other, which is exactly what the first attempt drew. At three hundred
 * and fifty the slope is under a thirtieth and the worst a coarse square can
 * miss is a metre and a half, which the skirt already covers with its twelve
 * metre floor.
 *
 * The cost is that a wood narrower than a couple of hundred metres barely rises
 * at all. That is the right half to lose: the *shading* is per pixel and keeps
 * its full strength on a copse, so a small wood still reads as a canopy — it
 * just does not also stand up.
 */
const CANOPY_BLUR_PX = 60;

/** How often the sheet may be redrawn for a change in the photograph's scores. */
const CANOPY_REPAINT_MS = 1500;

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
    /**
     * Where the photograph itself says there is canopy, for the ground nobody
     * has surveyed a wood in — which is most of it.
     *
     * Set by Game to a function returning `{ x, z, size, score }` for the
     * squares on screen, from the streamer's own per-tile canopy measurement.
     * It goes into the green channel of the same sheet as the survey, so the
     * shader still reads one texture and the vertex lift still reads one number
     * in world coordinates, which is the whole reason the sheet exists.
     */
    this.canopyRects = null;
    this.lastScored = -1;
    this.lastScoredAt = 0;
    this.scratch = document.createElement('canvas');
    this.scratch.width = MASK;
    this.scratch.height = MASK;
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
    /*
      And repaint when the photograph's answer has changed.

      The sheet used to be repainted only when new survey polygons landed or
      the camera crossed two kilometres. Where OpenStreetMap has no wood — most
      of the world — no polygon ever lands, so the first paint happened before
      any square had been scored, found nothing, and the sheet stayed empty for
      as long as you stood there. The lift reads that sheet, so there was no
      lift at all in exactly the places the photograph was supposed to cover.

      Rate-limited rather than every frame: it is a canvas pass, a blur and a
      texture upload, and the scores it draws move at the speed squares stream
      in rather than at the speed of the display.
    */
    const now = Date.now();
    const scored = this.canopyRects ? this.canopyRects().length : 0;
    const scoresMoved = scored !== this.lastScored
      && now - (this.lastScoredAt ?? 0) > CANOPY_REPAINT_MS;
    if (scoresMoved) { this.lastScored = scored; this.lastScoredAt = now; }
    if (this.dirty || scoresMoved || moved > SPAN_M / 6) this.paint(camera);
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
    /*
      And the photograph's answer, into the green channel of the same sheet.

      A square's canopy score is one number for the whole square, so painting
      it raw would print the tile grid into the ground as steps — the exact
      shape of fault this is meant to remove. It is drawn to a scratch canvas
      and blurred on the way across, which turns a square edge into a ramp
      about a hundred metres wide: shorter than the smallest wood worth
      lifting and far longer than the step. Where blur is not available the
      sheet is still correct, only steppier, so it is used if it works and
      skipped if it does not rather than gated on a browser check.

      `lighter` adds, and the two channels are separate, so a surveyed wood
      keeps its exact red and picks up whatever green the photograph agrees on
      without either being able to drown the other.
    */
    let scored = 0;
    const rects = this.canopyRects ? this.canopyRects(this.origin, SPAN_M) : null;
    if (rects && rects.length) {
      const sctx = this.scratch.getContext('2d');
      if (sctx) {
        sctx.clearRect(0, 0, MASK, MASK);
        for (const rect of rects) {
          if (!(rect.score > 0.01)) continue;
          const px = (rect.x - this.origin.x) * perMetre;
          const py = (rect.z - this.origin.y) * perMetre;
          const side = rect.size * perMetre;
          if (px + side < 0 || py + side < 0 || px > MASK || py > MASK) continue;
          sctx.fillStyle = `rgb(0,${Math.round(255 * Math.min(1, rect.score))},0)`;
          sctx.fillRect(px, py, side, side);
          scored++;
        }
        if (scored > 0) {
          const before = ctx.globalCompositeOperation;
          ctx.globalCompositeOperation = 'lighter';
          try { ctx.filter = `blur(${CANOPY_BLUR_PX}px)`; } catch { /* steppier, still right */ }
          ctx.drawImage(this.scratch, 0, 0);
          ctx.filter = 'none';
          ctx.globalCompositeOperation = before;
        }
      }
    }

    this.painted = drawn > 0 || scored > 0;
    this.texture.needsUpdate = true;
    this.stats.polygons = drawn;
    this.stats.scoredSquares = scored;
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

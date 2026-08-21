import { cheats } from '../core/cheats.js';
import { Emitter } from '../core/events.js';
import { readJSON, writeJSON } from '../core/storage.js';
import { settings } from '../core/settings.js';
import { EARTH_CIRCUMFERENCE, latToNormY, lonToNormX, tileKey } from '../geo/mercator.js';

/**
 * Which parts of the world you have actually been to.
 *
 * Visited ground is recorded as tile keys at several zooms at once, so the
 * minimap and the world map can both ask "is this square explored?" at whatever
 * scale they happen to be drawing, without walking a tree. Flying high reveals
 * a wider circle than walking, which is what makes an exploration flight feel
 * different from a stroll.
 */

/**
 * The zooms visited ground is recorded at.
 *
 * Sixteen is here so the edge of the fog is the shape you actually flew rather
 * than a staircase of two-kilometre squares. It cannot record a wide circle —
 * `reach` is capped at four tiles either way, which at level 16 is about two
 * and a half kilometres — and that cap is the point rather than a limitation:
 * you only ever saw the ground in that much detail when you were near it. High
 * over a coastline you uncover a broad, coarse circle; walking a valley you
 * uncover a narrow, sharp one, and the map shows the difference.
 */
const LEVELS = [8, 10, 12, 14, 16];
const DETAIL_LEVEL = 14;
const STORAGE_KEY = 'explored';
const MAX_ENTRIES = 160000;

export class Exploration extends Emitter {
  constructor() {
    super();
    this.cells = new Set(readJSON(STORAGE_KEY, []));
    this.dirty = false;
    this.saveTimer = 0;
    this.lastVisit = null;
    this.detailCount = this.countAt(DETAIL_LEVEL);
  }

  get count() {
    return this.detailCount;
  }

  /** Approximate ground area explored, in square kilometres. */
  areaKm2(lat = 0) {
    const tileMetres = (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, DETAIL_LEVEL);
    return (this.detailCount * tileMetres * tileMetres) / 1e6;
  }

  countAt(level) {
    let n = 0;
    const prefix = `${level}/`;
    for (const key of this.cells) if (key.startsWith(prefix)) n++;
    return n;
  }

  /**
   * Record a visit.
   *
   * The caller says how far you can actually see — the geometric horizon at
   * your height, capped by how far the terrain is being drawn — because that
   * is the honest answer to "have I seen this". Guessing from altitude alone
   * either revealed ground that was never on screen or hid ground that filled
   * it. Without one, altitude is the fallback it always was.
   */
  visit(lat, lon, altitudeAboveGround, seenRadius) {
    const radius = Number.isFinite(seenRadius) && seenRadius > 0
      ? Math.min(60000, Math.max(220, seenRadius))
      : Math.min(6000, Math.max(220, altitudeAboveGround * 0.45 + 220));
    const nx = lonToNormX(lon);
    const ny = latToNormY(lat);
    // Tile space is mercator, which stretches away from the equator, so the
    // ground radius has to be stretched the same way before it is compared.
    const stretch = 1 / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    const mercatorRadius = radius * stretch;

    // Only re-run the flood when we have actually moved somewhere new.
    if (this.lastVisit) {
      const dx = (nx - this.lastVisit.nx) * EARTH_CIRCUMFERENCE;
      const dy = (ny - this.lastVisit.ny) * EARTH_CIRCUMFERENCE;
      if (Math.hypot(dx, dy) < radius * 0.35 && Math.abs(radius - this.lastVisit.radius) < radius * 0.4) {
        return;
      }
    }
    this.lastVisit = { nx, ny, radius };

    let added = 0;
    for (const level of LEVELS) {
      const n = Math.pow(2, level);
      const tileMetres = EARTH_CIRCUMFERENCE / n;
      const reach = Math.min(4, Math.ceil(mercatorRadius / tileMetres));
      // Exact tile position, not the rounded one: the circle is measured from
      // where you actually are to the middle of each tile, in metres. Comparing
      // whole tile counts is what used to uncover a plus-shape.
      const px = nx * n;
      const py = ny * n;
      const cx = Math.floor(px);
      const cy = Math.floor(py);
      for (let dy = -reach; dy <= reach; dy++) {
        const ty = cy + dy;
        if (ty < 0 || ty >= n) continue;
        for (let dx = -reach; dx <= reach; dx++) {
          const distance = Math.hypot(cx + dx + 0.5 - px, ty + 0.5 - py) * tileMetres;
          if (distance > Math.max(mercatorRadius, tileMetres * 0.5)) continue;
          const key = tileKey(level, ((cx + dx) % n + n) % n, ty);
          if (this.cells.has(key)) continue;
          this.cells.add(key);
          added++;
          if (level === DETAIL_LEVEL) this.detailCount++;
        }
      }
    }

    if (added > 0) {
      this.dirty = true;
      this.emit('change', this.detailCount);
    }
  }

  /** Is this tile explored? Falls back to the nearest recorded level. */
  isExplored(z, x, y) {
    // The unlock-map cheat only lifts the fog for as long as it is on: the real
    // record underneath is never written to, so a reload puts it back.
    if (cheats.mapUnlocked) return true;
    let level = LEVELS[0];
    for (const candidate of LEVELS) {
      if (candidate <= z) level = candidate;
    }
    const shift = z - level;
    if (shift < 0) {
      // Asking coarser than we record: treat a tile as explored if its centre
      // cell is.
      const grow = level - z;
      return this.cells.has(tileKey(level, x << grow, y << grow));
    }
    return this.cells.has(tileKey(level, x >> shift, y >> shift));
  }

  tick(dt) {
    if (!this.dirty) return;
    this.saveTimer += dt;
    if (this.saveTimer < 4) return;
    this.saveTimer = 0;
    this.save();
  }

  save() {
    if (!this.dirty) return;
    let list = [...this.cells];
    if (list.length > MAX_ENTRIES) {
      // Thin the finest level first. Sixteen is the sharpest edge and also by
      // far the most cells; the coarse levels are what keep a continent's worth
      // of flying on the map at all, and they are cheap.
      list = list.filter((key) => !key.startsWith('16/') || Math.random() < 0.55);
    }
    writeJSON(STORAGE_KEY, list);
    this.dirty = false;
  }

  clear() {
    this.cells.clear();
    this.detailCount = 0;
    this.lastVisit = null;
    this.dirty = true;
    this.save();
    this.emit('change', 0);
  }
}

export const exploration = new Exploration();
export { DETAIL_LEVEL, LEVELS };

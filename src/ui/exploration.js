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

const LEVELS = [8, 10, 12, 14];
const DETAIL_LEVEL = 14;
const STORAGE_KEY = 'explored';
const MAX_ENTRIES = 60000;

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

  /** Record a visit. Reveal radius grows with altitude. */
  visit(lat, lon, altitudeAboveGround) {
    const scale = settings.get('fogRevealScale');
    // Deliberately short: altitude widens what you uncover, but only up to a
    // few kilometres. A single high pass used to reveal half a country, which
    // made the explored map meaningless.
    const radius = Math.min(6000, Math.max(220, altitudeAboveGround * 0.45 + 220)) * scale;
    const nx = lonToNormX(lon);
    const ny = latToNormY(lat);

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
      const reach = Math.min(4, Math.ceil(radius / tileMetres));
      const cx = Math.floor(nx * n);
      const cy = Math.floor(ny * n);
      for (let dy = -reach; dy <= reach; dy++) {
        const ty = cy + dy;
        if (ty < 0 || ty >= n) continue;
        for (let dx = -reach; dx <= reach; dx++) {
          if (Math.hypot(dx, dy) > reach + 0.35) continue;
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
      // Keep the finest detail closest to the cap; coarse levels are cheap.
      list = list.filter((key) => !key.startsWith(`${DETAIL_LEVEL}/`) || Math.random() < 0.7);
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

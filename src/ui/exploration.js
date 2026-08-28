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
/**
 * How many squares the record holds before the oldest fine detail is let go.
 *
 * It was 160,000, and over that the save threw away forty-five per cent of the
 * level-sixteen squares *at random* — permanently, since what it wrote is what
 * came back. Every reload thinned the survivors again, so the loss compounded:
 * 55%, then 30%, then 17%. Scattered random holes through ground you had
 * actually flown, changing every time. That is "the explored area is nowhere
 * near what I explored" and "it must show exactly where I explored".
 *
 * The cap was real — as `"16/34567/22345"` strings a full record is about
 * three megabytes, which is most of what a browser will store. But explored
 * ground is discs along a flight path, so the squares come in long unbroken
 * rows, and writing rows instead of squares is 14x smaller on a realistic
 * flight. So the ceiling moves rather than the record being damaged to fit
 * under it.
 */
const MAX_ENTRIES = 2000000;

export class Exploration extends Emitter {
  constructor() {
    super();
    this.cells = new Set(decodeCells(readJSON(STORAGE_KEY, [])));
    this.dirty = false;
    this.saveTimer = 0;
    this.lastVisit = null;
    this.detailCount = this.countAt(DETAIL_LEVEL);
    /** Coverage folded up to zooms coarser than we record. See `coarse()`. */
    this.coarseCache = new Map();
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
      // What you uncover is a circle, and it has to stay one when the reach cap
      // bites.
      //
      // The cap is deliberate — fine detail only near you — but the circle test
      // below was measured against the full seen radius, and once that radius
      // is bigger than four tiles every cell in the nine-by-nine block passes
      // it. The test stopped doing anything and what got recorded was a square.
      // At level 16 that is any time you can see more than about two and a half
      // kilometres, which is any time you are off the ground: the patch on the
      // map was a square with soft corners, from a horizon that is a circle.
      //
      // So the radius is capped to what the reach can actually cover, and the
      // test is made against that. Each level records a disc; the coarse levels
      // record bigger ones, and their union is the stepped circle you flew.
      const levelRadius = Math.min(mercatorRadius, reach * tileMetres);
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
          // The tile you are standing in always counts, whatever the radius.
          // Measuring to its centre meant that at level 8 — tiles a hundred
          // and fifty kilometres across — standing anywhere but the middle
          // recorded nothing at all at that level. Roughly a fifth of the
          // planet could be flown over without the coarse record noticing,
          // which is holes in the zoomed-out map for ground you crossed.
          const here = dx === 0 && dy === 0;
          const distance = Math.hypot(cx + dx + 0.5 - px, ty + 0.5 - py) * tileMetres;
          if (!here && distance > Math.max(levelRadius, tileMetres * 0.5)) continue;
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
      this.coarseCache.clear();
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
    if (shift < 0) return this.coarse(z).has(tileKey(z, x, y));
    return this.cells.has(tileKey(level, x >> shift, y >> shift));
  }

  /**
   * Coverage at a zoom coarser than anything we record.
   *
   * Folds every level-8 cell up to `z`, cached until the record changes.
   * The folding is the whole point. The old answer asked whether one
   * particular child — the north-west corner — happened to be recorded, and at
   * zoom 4 that is one square out of four thousand, so it was essentially
   * always no. Zoomed out, then, the map decided you had never been anywhere:
   * the whole planet drew as unvisited street map, with the pale wash laid
   * over your own trail. Continents you had crossed looked exactly like
   * continents you had not.
   *
   * A coarse tile counts as explored if *any* cell inside it is, which is the
   * honest reading of "have I been in this square" when the square is a
   * country.
   */
  coarse(z) {
    let set = this.coarseCache.get(z);
    if (set) return set;
    set = new Set();
    const base = LEVELS[0];
    const shift = base - z;
    const prefix = `${base}/`;
    for (const key of this.cells) {
      if (!key.startsWith(prefix)) continue;
      const parts = key.split('/');
      set.add(tileKey(z, Number(parts[1]) >> shift, Number(parts[2]) >> shift));
    }
    this.coarseCache.set(z, set);
    return set;
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
      // Over the ceiling, the oldest fine detail is let go — deterministically,
      // and in the order it was recorded, because a Set keeps that order. It
      // used to be a coin flip per square, which sprayed holes through country
      // you had flown and did it differently every time. Losing the first
      // flight of a very long session is a fact you can predict; losing a
      // random half of everywhere is not.
      const excess = list.length - MAX_ENTRIES;
      const drop = new Set();
      for (const key of list) {
        if (drop.size >= excess) break;
        if (key.startsWith(`${LEVELS[LEVELS.length - 1]}/`)) drop.add(key);
      }
      list = list.filter((key) => !drop.has(key));
    }
    writeJSON(STORAGE_KEY, encodeCells(list));
    this.dirty = false;
  }

  clear() {
    this.cells.clear();
    this.coarseCache.clear();
    this.detailCount = 0;
    this.lastVisit = null;
    this.dirty = true;
    this.save();
    this.emit('change', 0);
  }
}

/**
 * Pack tile keys into rows.
 *
 * Explored ground is a chain of discs along wherever you flew, so at every
 * level the squares come in long unbroken runs across each row. Writing
 * `[y, xStart, length]` per run instead of one `"16/34567/22345"` string per
 * square is about fourteen times smaller on a realistic flight — which is what
 * lets the record keep everything you actually explored instead of being cut
 * down to fit.
 */
export function encodeCells(keys) {
  const byLevel = new Map();
  for (const key of keys) {
    const parts = key.split('/');
    const z = Number(parts[0]);
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!byLevel.has(z)) byLevel.set(z, []);
    byLevel.get(z).push([x, y]);
  }
  const runs = {};
  for (const [z, list] of byLevel) {
    list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const out = [];
    let row = null;
    let start = 0;
    let length = 0;
    for (const [x, y] of list) {
      if (y === row && x === start + length) {
        length++;
        continue;
      }
      if (row !== null) out.push(row, start, length);
      row = y;
      start = x;
      length = 1;
    }
    if (row !== null) out.push(row, start, length);
    runs[z] = out;
  }
  return { v: 2, runs };
}

/**
 * Unpack them again, and read the old format too.
 *
 * A save written before this is a plain array of keys, and there is no reason
 * anyone should lose the ground they walked because the file got smaller.
 */
export function decodeCells(raw) {
  if (Array.isArray(raw)) return raw.filter((key) => typeof key === 'string');
  if (!raw || raw.v !== 2 || !raw.runs) return [];
  const keys = [];
  for (const [level, out] of Object.entries(raw.runs)) {
    const z = Number(level);
    if (!Number.isFinite(z) || !Array.isArray(out)) continue;
    for (let i = 0; i + 2 < out.length; i += 3) {
      const y = out[i];
      const start = out[i + 1];
      const length = out[i + 2];
      if (!Number.isFinite(y) || !Number.isFinite(start) || !(length > 0)) continue;
      for (let x = start; x < start + length; x++) keys.push(tileKey(z, x, y));
    }
  }
  return keys;
}

export const exploration = new Exploration();
export { DETAIL_LEVEL, LEVELS };

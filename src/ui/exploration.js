import { cheats } from '../core/cheats.js';
import { Emitter } from '../core/events.js';
import { readJSON, writeJSON } from '../core/storage.js';
import { isLandTile, landShareOfPlanet } from '../geo/land.js';
import { settings } from '../core/settings.js';
import { WORLD_CIRCUMFERENCE, latToNormY, lonToNormX, tileKey } from '../geo/mercator.js';

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
 * than a staircase of two-kilometre squares. Every level records the same
 * disc — what you saw, never more than MAX_REVEAL_M — so the patch is the same
 * size whichever zoom the map is at. High over a coastline you uncover a broad
 * circle; walking a valley you uncover a narrow one, and the map shows the
 * difference.
 */
const LEVELS = [8, 10, 12, 14, 16];
const DETAIL_LEVEL = 14;
/** What a visit that uncovered nothing reports. Shared, so it is never mutated. */
const NONE = Object.freeze([]);
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

/**
 * The widest circle one visit can uncover, in metres: two kilometres.
 *
 * It was the horizon itself, up to sixty kilometres, which is honest about
 * what you can see from a cloud base and makes the map a poor record of where
 * you have *been*. From two thousand metres up the whole of a county is
 * "explored" by one pass, and on a server, where the map shows everybody's
 * discoveries side by side, one high flight painted a region nobody had set
 * foot in. Two kilometres either side of your track is still a broad swath
 * from the air — wider than the minimap at its default zoom — and it means a
 * place on the map was somewhere you were actually near.
 */
export const MAX_REVEAL_M = 2000;

/**
 * The level coverage is measured at: the finest one recorded, so the figure is
 * the ground actually uncovered and not the coarse squares around it (the
 * square you stand in always counts, so the coarse levels claim more).
 */
const COVERAGE_LEVEL = LEVELS[LEVELS.length - 1];
/** What one square of each row at COVERAGE_LEVEL is of the whole planet. See rowShare. */
let rowShares = null;

/**
 * How much of the planet one square in row `y` covers, as a fraction of the
 * whole surface.
 *
 * Squares are all one size on a mercator map and nothing like one size on the
 * ground: one on the equator covers about forty times the ground of one at 81
 * degrees north, so counting squares would make a flight over Svalbard worth a
 * flight over the Congo forty times over. Each square counts for its ground on
 * the sphere instead. A band from latitude a down to b, 1/n of the way round, is
 * (sin a - sin b) / 2n of the surface, and on a mercator map the sine of a row's
 * latitude is tanh(pi (1 - 2y/n)). The shares are of the whole planet, poles and
 * all: the map stops at 85.05 degrees either way, so everything on it is 99.63%
 * and the caps past it are the rest, which nobody can reach.
 */
function rowShare(y) {
  if (!rowShares) {
    const n = 2 ** COVERAGE_LEVEL;
    const whole = 2 * n;
    rowShares = new Float64Array(n);
    for (let row = 0; row < n; row++) {
      rowShares[row] = (Math.tanh(Math.PI * (1 - (2 * row) / n)) - Math.tanh(Math.PI * (1 - (2 * (row + 1)) / n))) / whole;
    }
  }
  return rowShares[y] ?? 0;
}

/** The column and row of a "level/x/y" key. */
function cellOf(key) {
  const second = key.lastIndexOf('/');
  return [Number(key.slice(key.indexOf('/') + 1, second)), Number(key.slice(second + 1))];
}

export class Exploration extends Emitter {
  /**
   * @param {object} [options]
   * @param {number} [options.circumference] the world's, in metres. The server
   *   keeps one of these for every player on every world, so it cannot read
   *   the page's own world the way the game does.
   * @param {boolean} [options.stored] read and write the browser save. Off for
   *   the server, and for records made in tests.
   */
  constructor({ circumference = WORLD_CIRCUMFERENCE, stored = true } = {}) {
    super();
    this.circumference = circumference;
    this.stored = stored;
    this.cells = new Set(stored ? decodeCells(readJSON(STORAGE_KEY, [])) : []);
    this.dirty = false;
    this.saveTimer = 0;
    this.lastVisit = null;
    this.detailCount = this.countAt(DETAIL_LEVEL);
    /** Coverage folded up to zooms coarser than we record. See `coarse()`. */
    this.coarseCache = new Map();
    /** What coverage() and landCoverage() add up, once each has been asked; null until then. */
    this.covered = null;
    this.landCovered = null;
  }

  get count() {
    return this.detailCount;
  }

  /**
   * How much of this world's map is explored, from 0 to 1, by the ground the
   * squares cover (see rowShare). Added up in full the first time it is asked
   * and kept up to date square by square after that, so the world map can show
   * it changing as you fly. The server keeps a record for every player and
   * never asks, so it never pays for it.
   */
  coverage() {
    if (this.covered === null) {
      let sum = 0;
      const prefix = `${COVERAGE_LEVEL}/`;
      for (const key of this.cells) if (key.startsWith(prefix)) sum += rowShare(cellOf(key)[1]);
      this.covered = sum;
    }
    return Math.min(1, this.covered);
  }

  /**
   * How much of Earth's land is explored, from 0 to 1: the squares whose
   * middle is on land (geo/land.js), by their ground, out of all the land
   * there is. Earth's only; on another world it means nothing, and nothing
   * asks. Kept up the same way as coverage().
   */
  landCoverage() {
    if (this.landCovered === null) {
      let sum = 0;
      const prefix = `${COVERAGE_LEVEL}/`;
      for (const key of this.cells) {
        if (!key.startsWith(prefix)) continue;
        const [x, y] = cellOf(key);
        if (isLandTile(COVERAGE_LEVEL, x, y)) sum += rowShare(y);
      }
      this.landCovered = sum;
    }
    const land = landShareOfPlanet();
    return land > 0 ? Math.min(1, this.landCovered / land) : 0;
  }

  /** A square of COVERAGE_LEVEL newly recorded, onto whichever sums are being kept. */
  countSquare(x, y) {
    if (this.covered !== null) this.covered += rowShare(y);
    if (this.landCovered !== null && isLandTile(COVERAGE_LEVEL, x, y)) this.landCovered += rowShare(y);
  }

  /** After `cells` was changed directly, rather than through visit or merge. */
  recount() {
    this.detailCount = this.countAt(DETAIL_LEVEL);
    this.coarseCache.clear();
    this.covered = null;
    this.landCovered = null;
  }

  /** Approximate ground area explored, in square kilometres. */
  areaKm2(lat = 0) {
    const tileMetres = (this.circumference * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, DETAIL_LEVEL);
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
      ? Math.min(MAX_REVEAL_M, Math.max(220, seenRadius))
      : Math.min(MAX_REVEAL_M, Math.max(220, altitudeAboveGround * 0.45 + 220));
    const nx = lonToNormX(lon);
    const ny = latToNormY(lat);
    // Tile space is mercator, which stretches away from the equator, so the
    // ground radius has to be stretched the same way before it is compared.
    const stretch = 1 / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    const mercatorRadius = radius * stretch;

    // Only re-run the flood when we have actually moved somewhere new.
    if (this.lastVisit) {
      const dx = (nx - this.lastVisit.nx) * this.circumference;
      const dy = (ny - this.lastVisit.ny) * this.circumference;
      if (Math.hypot(dx, dy) < radius * 0.35 && Math.abs(radius - this.lastVisit.radius) < radius * 0.4) {
        return NONE;
      }
    }
    this.lastVisit = { nx, ny, radius };

    let added = 0;
    // What this visit newly uncovered, for anyone keeping a copy of the record
    // elsewhere — the server sends exactly these to the people watching you.
    const fresh = [];
    for (const level of LEVELS) {
      const n = Math.pow(2, level);
      const tileMetres = this.circumference / n;
      // As many tiles as the disc needs. It was four at most, which at level
      // sixteen is two and a half kilometres of mercator — 1.7 km of ground at
      // the Alps, 0.8 km at 70 degrees north, and on the Moon, whose tiles are
      // smaller, 670 m. So the patch on the map shrank as you zoomed in to it,
      // and was nowhere near the two kilometres it was meant to be.
      const reach = Math.ceil(mercatorRadius / tileMetres);
      // What you uncover is a circle: every cell in the block is tested
      // against the radius, so the record is a disc at each level, not the
      // square block around you. Their union is the stepped circle you flew.
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
          const tx = ((cx + dx) % n + n) % n;
          const key = tileKey(level, tx, ty);
          if (this.cells.has(key)) continue;
          this.cells.add(key);
          fresh.push(key);
          added++;
          if (level === DETAIL_LEVEL) this.detailCount++;
          if (level === COVERAGE_LEVEL) this.countSquare(tx, ty);
        }
      }
    }

    if (added > 0) {
      this.dirty = true;
      this.coarseCache.clear();
      this.emit('change', this.detailCount);
    }
    return fresh;
  }

  /**
   * Take in squares somebody else recorded — the server's copy of your own
   * record when you sign in, or the squares it reports as you fly.
   */
  merge(keys) {
    let added = 0;
    for (const key of keys) {
      if (typeof key !== 'string' || this.cells.has(key)) continue;
      this.cells.add(key);
      added++;
      if (key.startsWith(`${DETAIL_LEVEL}/`)) this.detailCount++;
      if ((this.covered !== null || this.landCovered !== null) && key.startsWith(`${COVERAGE_LEVEL}/`)) {
        const [x, y] = cellOf(key);
        this.countSquare(x, y);
      }
    }
    if (added > 0) {
      this.dirty = true;
      this.coarseCache.clear();
      this.emit('change', this.detailCount);
    }
    return added;
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
    if (shift === 0) return this.cells.has(tileKey(z, x, y));
    /*
      Answer from something at least as fine as the square being asked about.

      Levels are recorded at 8, 10, 12, 14 and 16, so half the zooms fall
      between two of them, and this used to answer those from the coarser one:
      at zoom 9 from level 8, at zoom 11 from level 10. One recorded cell then
      answered for four squares of the zoom actually being drawn, and it
      answered yes for all four — so standing in one spot lit up four times the
      ground you had seen, at exactly the zooms you look at when you zoom out.

      A square is explored if anything recorded *inside* it is, which is the
      same rule `coarse` already used going up, applied at every zoom rather
      than only below the coarsest level. Falling back to the coarser cell is
      kept for zooms finer than anything recorded — past 16 there is nothing
      better to say — but that is the one case where it is the best answer
      available rather than the laziest.
    */
    const folded = this.folded(z);
    if (folded) return folded.has(tileKey(z, x, y));
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
    return this.folded(z) ?? new Set();
  }

  /**
   * Every recorded cell at least as fine as `z`, folded up to `z`.
   *
   * Null when nothing recorded is that fine, which is the only case where the
   * caller should fall back to a coarser cell. Cached until the record changes,
   * because the map asks this for every square it draws.
   */
  folded(z) {
    if (this.coarseCache.has(z)) return this.coarseCache.get(z);
    const levels = LEVELS.filter((level) => level >= z);
    if (levels.length === 0) {
      this.coarseCache.set(z, null);
      return null;
    }
    const set = new Set();
    for (const level of levels) {
      const shift = level - z;
      const prefix = `${level}/`;
      for (const key of this.cells) {
        if (!key.startsWith(prefix)) continue;
        const parts = key.split('/');
        set.add(tileKey(z, Number(parts[1]) >> shift, Number(parts[2]) >> shift));
      }
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
    if (!this.dirty || !this.stored) return;
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
    this.covered = 0;
    this.landCovered = 0;
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
export { COVERAGE_LEVEL, DETAIL_LEVEL, LEVELS };

/**
 * A coverage fraction as the world map shows it: a percentage to seven
 * decimal places, the last of which is about one square of COVERAGE_LEVEL on
 * the equator - so it moves while you fly rather than sitting on 0.00% for the
 * first thousand hours.
 */
export function formatCoverage(fraction) {
  const percent = Math.max(0, Math.min(100, (Number(fraction) || 0) * 100));
  return `${percent.toFixed(7)}%`;
}

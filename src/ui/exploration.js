import { cheats } from '../core/cheats.js';
import { Emitter } from '../core/events.js';
import { readJSON, writeJSON } from '../core/storage.js';
import { isLandTile, landShareOfPlanet } from '../geo/land.js';
import { settings } from '../core/settings.js';
import { EARTH_CIRCUMFERENCE, WORLD_CIRCUMFERENCE, latToNormY, lonToNormX, tileKey } from '../geo/mercator.js';
import { CellRuns } from './cellRuns.js';

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
 * The zooms visited ground is recorded at, on Earth.
 *
 * Sixteen is here so the edge of the fog is the shape you actually flew rather
 * than a staircase of two-kilometre squares. Every level records the same
 * disc — what you saw, never more than MAX_REVEAL_M — so the patch is the same
 * size whichever zoom the map is at. High over a coastline you uncover a broad
 * circle; walking a valley you uncover a narrow one, and the map shows the
 * difference.
 *
 * Elsewhere, and towards the poles, the zooms move so that a square is about
 * the size it is here: see explorationScheme.
 */
const EARTH_LEVELS = [8, 10, 12, 14, 16];
/** The zooms every record kept before the squares were sized to the world, on every world. See carry. */
const EARTH_LEVEL_SET = new Set(EARTH_LEVELS);
const EARTH_DETAIL_LEVEL = 14;
/** Times the finest square is made coarser on the way to each pole: at 60, 75.5 and 82.8 degrees. */
const POLAR_STEPS = 3;
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
 * The squares explored ground is kept in on one world: which zooms, where.
 *
 * They were Earth's zooms on every world — 8 to 16 — and a mercator square is
 * the world's circumference over two to the zoom, times the cosine of the
 * latitude. So the finest one was 611 m at Earth's equator but 24 m on
 * Enceladus and Vesta, 167 m on the Moon, and 53 m at 85 degrees north: the
 * same two-kilometre disc of ground was 34 squares on the equator and 6,000
 * on Enceladus. Measured with the game's own flight model against the server,
 * flying flat out (rockets every second, a surge whenever it is ready): the
 * same 3,600 to 5,800 km2 an hour on every world, but 11,000 squares an hour
 * at Earth's equator, 106,000 at 70 degrees north, 1.57 million at 85, 218,000
 * on the Moon and 10.3 million on Enceladus. The server holds each player's
 * squares, so half an hour on Enceladus was 5.2 million of them, 333 MB of
 * heap after collection and 830 MB of process — past the 256 MB machine
 * HOSTING suggests in about a quarter of an hour, and the page held the same.
 *
 * Now a square is about the size it is on Earth's equator wherever you are:
 *
 * - Each world records its zooms moved down by however many halvings of
 *   its circumference make Earth's (`shift`, the nearest whole number of
 *   them): Mars, Mercury, Ganymede, Callisto and Titan one, the Moon, Io,
 *   Europa and Pluto two, Charon three, Ceres four, Vesta and Enceladus five.
 *   Their finest square on the equator is then 456 to 806 m — Earth's is 611.
 *
 * - Towards the poles the finest zoom drops by one each time the squares have
 *   halved again: at 60 degrees, 75.5 and 82.8, where the cosine is a half, a
 *   quarter and an eighth. Coarser zooms than that are kept as they are, so
 *   the map zoomed out is unchanged. The bands' edges are whole rows of the
 *   coarsest of those zooms (`align`), so a square is always wholly inside one
 *   band, and below 60 degrees nothing changes — Earth's figures there are the
 *   squares they always were.
 *
 * So the finest square is between half and the whole of the world's
 * equatorial one wherever you are, and the same flights measure 11,000 to
 * 57,000 squares an hour anywhere on Earth and at most 135,000 on any world
 * (Pluto at 75 degrees, whose squares are the smallest; see server/game.mjs,
 * SHARED_PER_DAY): half an hour on Enceladus is 6,000 of them. The two
 * kilometres you uncover are the same two kilometres.
 *
 * Page and server both work out the squares with this, from the world's
 * radius, so they agree; a record from before is carried over (see carry)
 * with nothing in it lost.
 */
export class ExplorationScheme {
  constructor(shift) {
    this.shift = shift;
    /** The zooms kept on most of the world, coarsest first. */
    this.levels = EARTH_LEVELS.map((level) => level - shift);
    this.finest = this.levels[this.levels.length - 1];
    this.detail = EARTH_DETAIL_LEVEL - shift;
    /** Band edges are rows of this zoom; coarser zooms are kept everywhere alike. */
    this.align = this.finest - POLAR_STEPS;
    this.rows = 2 ** this.align;
    // The row holding each edge's latitude, counted from the north: it and
    // everything south of it stays in the band nearer the equator.
    const edges = [];
    for (let step = 1; step <= POLAR_STEPS; step++) {
      edges.push(Math.floor(latToNormY((Math.acos(2 ** -step) * 180) / Math.PI) * this.rows));
    }
    this.bandOfRow = new Uint8Array(this.rows);
    for (let row = 0; row < this.rows; row++) {
      // The south mirrors the north.
      const fromPole = Math.min(row, this.rows - 1 - row);
      let band = 0;
      for (let step = 0; step < POLAR_STEPS; step++) if (fromPole < edges[step]) band = step + 1;
      this.bandOfRow[row] = band;
    }
    /** Per band, the zooms kept there, as bits; the finest is `finest - band`. */
    this.masks = [];
    for (let band = 0; band <= POLAR_STEPS; band++) {
      this.masks.push(this.levels.reduce((mask, level) => mask | (1 << Math.min(level, this.finest - band)), 0));
    }
    this.coarseMask = this.levels.filter((level) => level < this.align).reduce((mask, level) => mask | (1 << level), 0);
    /** Every zoom kept somewhere on the world. A record holding another was written before (see carry). */
    this.anyMask = this.masks.reduce((mask, band) => mask | band, 0);
    this.zoomLists = new Map();
  }

  /** Which band row `y` of zoom `z` is in: 0 to about 60 degrees, then 1, 2 and 3. For z at or finer than `align`. */
  bandAt(z, y) {
    const row = y >> (z - this.align);
    return row >= 0 && row < this.rows ? this.bandOfRow[row] : 0;
  }

  bandAtLat(lat) {
    return this.bandOfRow[Math.min(this.rows - 1, Math.max(0, Math.floor(latToNormY(lat) * this.rows)))];
  }

  /** The finest zoom kept in row `y` of zoom `z` (z at or finer than `align`). */
  finestAt(z, y) {
    return this.finest - this.bandAt(z, y);
  }

  /** The finest zoom kept at a latitude. */
  finestAtLat(lat) {
    return this.finest - this.bandAtLat(lat);
  }

  /** Does the record keep squares of zoom `z` in its row `y`? */
  keeps(z, y) {
    if (!(z >= 0 && z <= 30)) return false;
    if (z < this.align) return ((this.coarseMask >> z) & 1) === 1;
    return ((this.masks[this.bandAt(z, y)] >> z) & 1) === 1;
  }

  /** Is zoom `z` one this world keeps nowhere - so a record holding it was written before the squares were sized to the world? */
  isOld(z) {
    return !(z >= 0 && z <= 30 && ((this.anyMask >> z) & 1) === 1);
  }

  /** Is this one of the squares coverage counts: the finest kept where it is? */
  isFinest(z, y) {
    return z >= this.align && z === this.finest - this.bandAt(z, y);
  }

  /** The zooms to record for a disc whose rows run from `ny0` to `ny1` (mercator, 0 to 1), finest last. */
  zoomsFor(ny0, ny1) {
    const first = Math.max(0, Math.min(this.rows - 1, Math.floor(ny0 * this.rows)));
    const last = Math.max(0, Math.min(this.rows - 1, Math.floor(ny1 * this.rows)));
    let mask = 0;
    for (let row = first; row <= last; row++) mask |= this.masks[this.bandOfRow[row]];
    let list = this.zoomLists.get(mask);
    if (!list) {
      list = [];
      for (let z = 0; z <= 30; z++) if ((mask >> z) & 1) list.push(z);
      this.zoomLists.set(mask, list);
    }
    return list;
  }

  /**
   * A run of squares from any record — this one's, or one kept before the
   * squares were sized to the world — as the squares this one keeps, given
   * to `add(z, x, y, length)` a run at a time.
   *
   * A square kept here is itself. One finer than is kept here — a level-16
   * square on Enceladus, or at 70 degrees north — becomes the square it is
   * part of at the finest zoom kept there, and at every coarser zoom kept
   * there that the old record did not keep itself: coarser, so it covers
   * everything the old one did and nothing explored is lost. One at a zoom
   * not kept but no finer than the finest (an old level-10 square where the
   * zooms are now odd) stays as it is, so the map at its own zoom still
   * shows it, and is added to those coarser zooms too. A record written this
   * way comes back unchanged, so carrying one twice is the same as carrying
   * it once.
   *
   * Not to a zoom the old record kept as well (Earth's, EARTH_LEVELS, on
   * every world): 8 to 14 at 70 degrees north, 8 to 12 on the Moon. The old
   * record has its own squares there, from the same discs, and they are kept
   * as they are; the squares a finer one is part of would add every square
   * the disc's edge touched, and old ground drew up to three times as wide
   * there as it did before, and as ground flown since does.
   *
   * Returns how many squares were replaced by coarser ones: none for a
   * record written this way, so nothing is saved again for being read.
   */
  carry(z, y, start, length, add, old = false) {
    if (this.keeps(z, y)) {
      add(z, start, y, length);
      // In a record from before (`old`: see isOld), one of the old zooms that
      // is kept here too - the Moon's 8 to 14 - still stands for the coarser
      // zooms kept here that the old record did not keep - the Moon's 6.
      // Usually a finer square does that as well, but an old page let its
      // oldest finest squares go to stay under MAX_ENTRIES, and where it did,
      // nothing else would. A record written this way is left as it is.
      if (old && EARTH_LEVEL_SET.has(z)) this.ancestors(z, y, start, length, add, z - 1, -1);
      return 0;
    }
    const finest = z >= this.align ? this.finestAt(z, y) : this.finest;
    if (z <= finest) add(z, start, y, length);
    this.ancestors(z, y, start, length, add, Math.min(z - 1, finest), finest);
    return z <= finest ? 0 : length;
  }

  /**
   * The squares a run of zoom `z` is part of at the zooms kept in its row,
   * from `from` down: the finest, and those the old record did not keep
   * itself (see carry).
   */
  ancestors(z, y, start, length, add, from, finest) {
    for (let level = from; level >= 0; level--) {
      const shift = z - level;
      const row = y >> shift;
      if (!this.keeps(level, row)) continue;
      if (level !== finest && EARTH_LEVEL_SET.has(level)) continue;
      const first = start >> shift;
      add(level, first, row, ((start + length - 1) >> shift) - first + 1);
    }
  }
}

const schemes = new Map();

/** The squares explored ground is kept in on a world of this circumference. See ExplorationScheme. */
export function explorationScheme(circumference = WORLD_CIRCUMFERENCE) {
  const shift = Math.round(Math.log2(EARTH_CIRCUMFERENCE / circumference));
  let scheme = schemes.get(shift);
  if (!scheme) schemes.set(shift, (scheme = new ExplorationScheme(shift)));
  return scheme;
}

/** This page's world's. */
const PAGE_SCHEME = explorationScheme(WORLD_CIRCUMFERENCE);
const LEVELS = PAGE_SCHEME.levels;
const DETAIL_LEVEL = PAGE_SCHEME.detail;
/**
 * The level coverage is measured at: the finest one recorded, so the figure is
 * the ground actually uncovered and not the coarse squares around it (the
 * square you stand in always counts, so the coarse levels claim more). Towards
 * the poles that is a coarser one (see ExplorationScheme.isFinest).
 */
const COVERAGE_LEVEL = PAGE_SCHEME.finest;
/** Per zoom, what one square of each of its rows is of the whole planet. See rowShare. */
const rowShares = new Map();

/**
 * How much of the planet one square in row `y` of zoom `z` covers, as a
 * fraction of the whole surface.
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
function rowShare(z, y) {
  let shares = rowShares.get(z);
  if (!shares) {
    const n = 2 ** z;
    const whole = 2 * n;
    shares = new Float64Array(n);
    for (let row = 0; row < n; row++) {
      shares[row] = (Math.tanh(Math.PI * (1 - (2 * row) / n)) - Math.tanh(Math.PI * (1 - (2 * (row + 1)) / n))) / whole;
    }
    rowShares.set(z, shares);
  }
  return shares[y] ?? 0;
}

/** A "level/x/y" key into `cell`, if it is one: whole numbers, inside its zoom. */
const cell = { z: 0, x: 0, y: 0 };
function readKey(key) {
  if (typeof key !== 'string') return false;
  const first = key.indexOf('/');
  const second = key.indexOf('/', first + 1);
  if (first < 0 || second < 0) return false;
  const z = Number(key.slice(0, first));
  const x = Number(key.slice(first + 1, second));
  const y = Number(key.slice(second + 1));
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || z > 24) return false;
  const n = 2 ** z;
  if (x < 0 || y < 0 || x >= n || y >= n) return false;
  cell.z = z;
  cell.x = x;
  cell.y = y;
  return true;
}

export class Exploration extends Emitter {
  /**
   * @param {object} [options]
   * @param {number} [options.circumference] the world's, in metres. The server
   *   keeps one of these for every player on every world, so it cannot read
   *   the page's own world the way the game does.
   * @param {boolean} [options.stored] read and write the browser save. Off for
   *   the server, and for records made in tests.
   * @param {boolean} [options.compact] keep the squares as runs (CellRuns) —
   *   a few bytes a square against fifty to a hundred for a Set of their
   *   names. The server's records and the page's copies of other people's
   *   are; your own on the page stays a Set, whose order its save relies on.
   */
  constructor({ circumference = WORLD_CIRCUMFERENCE, stored = true, compact = false } = {}) {
    super();
    this.circumference = circumference;
    this.scheme = explorationScheme(circumference);
    this.stored = stored;
    this.compact = compact;
    this.cells = compact ? new CellRuns() : new Set();
    this.dirty = false;
    this.saveTimer = 0;
    this.lastVisit = null;
    /** Coverage folded up to zooms coarser than we record. See `coarse()`. */
    this.coarseCache = new Map();
    /** What coverage() and landCoverage() add up, once each has been asked; null until then. */
    this.covered = null;
    this.landCovered = null;
    // A save from before the squares were sized to the world is carried over,
    // and written back the new way at the next save.
    if (stored && this.load(readJSON(STORAGE_KEY, [])) > 0) this.dirty = true;
    this.detailCount = this.countAt(this.scheme.detail);
  }

  get count() {
    return this.detailCount;
  }

  /**
   * Replace the record with a saved or sent one (encodeCells' runs, or the
   * older list of keys), carried onto this world's squares. Returns how many
   * squares were made coarser: none for a record written by this version.
   */
  load(raw) {
    this.cells = this.compact ? new CellRuns() : new Set();
    const carried = readCells(raw, this.scheme, (z, x, y, length) => {
      if (this.compact) this.cells.addRun(z, y, x, length);
      else for (let i = 0; i < length; i++) this.cells.add(tileKey(z, x + i, y));
    });
    this.recount();
    return carried;
  }

  /** The record as it is saved and sent: encodeCells' runs. */
  encode() {
    return this.compact ? this.cells.encode() : encodeCells(this.cells);
  }

  /** Every recorded square, as runs of one row: fn(z, y, x, length). */
  eachRun(fn) {
    if (this.compact) {
      this.cells.forEachRun(fn);
      return;
    }
    for (const key of this.cells) if (readKey(key)) fn(cell.z, cell.y, cell.x, 1);
  }

  hasSquare(z, x, y) {
    return this.compact ? this.cells.hasCell(z, x, y) : this.cells.has(tileKey(z, x, y));
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
      this.eachRun((z, y, x, length) => {
        if (this.scheme.isFinest(z, y)) sum += rowShare(z, y) * length;
      });
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
      this.eachRun((z, y, x0, length) => {
        if (!this.scheme.isFinest(z, y)) return;
        for (let x = x0; x < x0 + length; x++) if (isLandTile(z, x, y)) sum += rowShare(z, y);
      });
      this.landCovered = sum;
    }
    const land = landShareOfPlanet();
    return land > 0 ? Math.min(1, this.landCovered / land) : 0;
  }

  /** A newly recorded square that coverage counts, onto whichever sums are being kept. */
  countSquare(z, x, y) {
    if (this.covered !== null) this.covered += rowShare(z, y);
    if (this.landCovered !== null && isLandTile(z, x, y)) this.landCovered += rowShare(z, y);
  }

  /** After `cells` was changed directly, rather than through visit or merge. */
  recount() {
    this.detailCount = this.countAt(this.scheme.detail);
    this.coarseCache.clear();
    this.covered = null;
    this.landCovered = null;
  }

  /**
   * Ground explored, in square kilometres: the squares coverage counts, by
   * their ground on the sphere. It was the level-14 squares times the size of
   * one where you happen to be, which is a different answer at every latitude
   * and none at all where the record keeps no level 14.
   */
  areaKm2() {
    return (this.coverage() * this.circumference * this.circumference) / Math.PI / 1e6;
  }

  countAt(level) {
    if (this.compact) return this.cells.countAt(level);
    let n = 0;
    const prefix = `${level}/`;
    for (const key of this.cells) if (key.startsWith(prefix)) n++;
    return n;
  }

  /** Put a run of squares of one row into the record, counted. How many were new. */
  addSquares(z, x0, y, length) {
    const counting = (this.covered !== null || this.landCovered !== null) && this.scheme.isFinest(z, y);
    let added = 0;
    if (this.compact) {
      added = this.cells.addRun(z, y, x0, length, counting ? (start, n) => {
        for (let x = start; x < start + n; x++) this.countSquare(z, x, y);
      } : null);
    } else {
      for (let x = x0; x < x0 + length; x++) {
        const key = tileKey(z, x, y);
        if (this.cells.has(key)) continue;
        this.cells.add(key);
        added++;
        if (counting) this.countSquare(z, x, y);
      }
    }
    if (z === this.scheme.detail) this.detailCount += added;
    return added;
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
    const scheme = this.scheme;
    // The zooms kept in every band the disc reaches: one band, unless it
    // straddles an edge.
    const span = mercatorRadius / this.circumference;
    for (const level of scheme.zoomsFor(ny - span, ny + span)) {
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
        // A row in a band that keeps a coarser square here is left to it.
        if (!scheme.keeps(level, ty)) continue;
        const finest = scheme.isFinest(level, ty);
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
          let key;
          if (this.compact) {
            if (!this.cells.addCell(level, tx, ty)) continue;
            key = tileKey(level, tx, ty);
          } else {
            key = tileKey(level, tx, ty);
            if (this.cells.has(key)) continue;
            this.cells.add(key);
          }
          fresh.push(key);
          added++;
          if (level === scheme.detail) this.detailCount++;
          if (finest) this.countSquare(level, tx, ty);
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
   * record when you sign in, or the squares it reports as you fly. Keys from
   * a page or a server older than the world's squares are carried onto them
   * (ExplorationScheme.carry).
   */
  merge(keys) {
    let added = 0;
    const take = (z, x, y, length) => {
      added += this.addSquares(z, x, y, length);
    };
    const list = Array.isArray(keys) ? keys : [...keys];
    const old = list.some((key) => readKey(key) && this.scheme.isOld(cell.z));
    for (const key of list) {
      if (readKey(key)) this.scheme.carry(cell.z, cell.y, cell.x, 1, take, old);
    }
    return this.merged(added);
  }

  /** The same for a whole record as it is saved and sent (encodeCells), or the older list of keys. */
  mergeCells(raw) {
    let added = 0;
    readCells(raw, this.scheme, (z, x, y, length) => {
      added += this.addSquares(z, x, y, length);
    });
    return this.merged(added);
  }

  merged(added) {
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
    const scheme = this.scheme;
    if (z >= scheme.align) {
      // Finer than anything kept here: the square it is part of. Past the
      // finest level there is nothing better to say — and near the poles the
      // finest is coarser, so the same is true sooner there.
      const finest = scheme.finestAt(z, y);
      if (z > finest) {
        const shift = z - finest;
        return this.hasSquare(finest, x >> shift, y >> shift);
      }
      if (scheme.keeps(z, y)) return this.hasSquare(z, x, y);
    } else if (scheme.keeps(z, y)) {
      return this.hasSquare(z, x, y);
    }
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
      kept for zooms finer than anything recorded — past the finest there is
      nothing better to say — but that is the one case where it is the best
      answer available rather than the laziest.
    */
    const folded = this.folded(z);
    if (!folded) return false;
    return this.compact ? folded.hasCell(z, x, y) : folded.has(tileKey(z, x, y));
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
    return this.folded(z) ?? (this.compact ? new CellRuns() : new Set());
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
    if (z > this.scheme.finest) {
      this.coarseCache.set(z, null);
      return null;
    }
    // Runs fold to runs, so a big compact record folds without a name per square.
    const set = this.compact ? new CellRuns() : new Set();
    this.eachRun((level, y, x0, length) => {
      if (level < z) return;
      const shift = level - z;
      const row = y >> shift;
      const first = x0 >> shift;
      const last = (x0 + length - 1) >> shift;
      if (this.compact) set.addRun(z, row, first, last - first + 1);
      else for (let x = first; x <= last; x++) set.add(tileKey(z, x, row));
    });
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
    if (this.compact) {
      writeJSON(STORAGE_KEY, this.encode());
      this.dirty = false;
      return;
    }
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
        if (readKey(key) && this.scheme.isFinest(cell.z, cell.y)) drop.add(key);
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

/**
 * Every square of a saved or sent record — runs, or the older list of keys —
 * carried onto the squares `scheme` keeps (ExplorationScheme.carry) and given
 * to `add(z, x, y, length)` a run at a time, without unpacking the whole
 * record first: an old record from a small world can be millions of squares
 * that become a few thousand. Returns how many squares were made coarser;
 * none for a record written this way.
 */
export function readCells(raw, scheme, add) {
  let carried = 0;
  if (Array.isArray(raw)) {
    const old = raw.some((key) => readKey(key) && scheme.isOld(cell.z));
    for (const key of raw) {
      if (readKey(key)) carried += scheme.carry(cell.z, cell.y, cell.x, 1, add, old);
    }
    return carried;
  }
  if (!raw || raw.v !== 2 || !raw.runs || typeof raw.runs !== 'object') return 0;
  const old = Object.keys(raw.runs).some((level) => scheme.isOld(Number(level)));
  for (const [level, out] of Object.entries(raw.runs)) {
    const z = Number(level);
    if (!Number.isInteger(z) || z < 0 || z > 24 || !Array.isArray(out)) continue;
    const n = 2 ** z;
    for (let i = 0; i + 2 < out.length; i += 3) {
      const y = out[i];
      const start = out[i + 1];
      const length = out[i + 2];
      if (!Number.isInteger(y) || !Number.isInteger(start) || !Number.isInteger(length)) continue;
      if (length <= 0 || y < 0 || y >= n || start < 0 || start + length > n) continue;
      carried += scheme.carry(z, y, start, length, add, old);
    }
  }
  return carried;
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

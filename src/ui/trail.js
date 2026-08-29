import { haversine } from '../geo/mercator.js';
import { readJSON, writeJSON } from '../core/storage.js';

/**
 * Your trail: a thin line of where you have actually travelled, drawn on both
 * maps.
 *
 * There is no tool and nothing to click. Points are dropped as you move, and a
 * teleport starts a new leg rather than drawing a straight line across an ocean
 * you never crossed.
 */

const STORAGE_KEY = 'trail';
const MAX_POINTS = 4000;
const MIN_STEP_M = 90;
/** A jump bigger than this is a teleport, not a journey. */
const BREAK_M = 20000;

export class Trail {
  constructor() {
    this.legs = readJSON(STORAGE_KEY, []);
    if (!Array.isArray(this.legs)) this.legs = [];
    this.dirty = false;
    this.saveTimer = 0;
    this.last = null;
  }

  get pointCount() {
    return this.legs.reduce((total, leg) => total + leg.length, 0);
  }

  /** Total distance the trail covers, in metres. */
  get length() {
    let total = 0;
    for (const leg of this.legs) {
      for (let i = 1; i < leg.length; i++) total += haversine(leg[i - 1], leg[i]);
    }
    return total;
  }

  record(lat, lon) {
    const point = { lat: +lat.toFixed(5), lon: +lon.toFixed(5) };
    if (this.last) {
      const moved = haversine(this.last, point);
      if (moved < MIN_STEP_M) return;
      if (moved > BREAK_M) {
        this.startLeg(point);
        return;
      }
    } else {
      this.startLeg(point);
      return;
    }

    const leg = this.legs[this.legs.length - 1];
    leg.push(point);
    this.last = point;
    this.dirty = true;
    this.trim();
  }

  /** Begin a new leg — used on teleport so legs are not joined by a fake line. */
  startLeg(point) {
    this.legs.push([point]);
    this.last = point;
    this.dirty = true;
    this.trim();
  }

  break() {
    this.last = null;
  }

  /**
   * Keep the trail inside its budget by thinning history, not deleting it.
   *
   * It used to drop the oldest whole leg, and a leg can be very nearly the
   * entire record — one continuous flight is one leg, and only a teleport
   * starts a new one. So going a single point over budget could erase almost
   * everything you had, all at once, at a moment with no visible cause. That is
   * the trail forgetting, and it is the same mistake the exploration record
   * used to make: losing a lot at unpredictable moments instead of a little,
   * predictably.
   *
   * The oldest leg is halved instead — every other point goes, both ends stay —
   * so the line keeps its shape and covers the same ground with half as many
   * points. Each halving doubles the distance the budget buys, so an old flight
   * gets coarser over hours rather than vanishing, and the leg you are drawing
   * now keeps its full ninety-metre spacing until everything older has been
   * thinned to its ends. Only then, and only if it is still short, is a leg
   * dropped.
   */
  trim() {
    let total = this.pointCount;
    let index = 0;
    while (total > MAX_POINTS && index < this.legs.length) {
      const leg = this.legs[index];
      if (leg.length <= 2) {
        index++;
        continue;
      }
      const kept = [];
      for (let i = 0; i < leg.length; i++) {
        if (i % 2 === 0 || i === leg.length - 1) kept.push(leg[i]);
      }
      total -= leg.length - kept.length;
      this.legs[index] = kept;
      // Back to the oldest, so the oldest is always the coarsest.
      index = 0;
    }
    while (total > MAX_POINTS && this.legs.length > 1) {
      total -= this.legs[0].length;
      this.legs.shift();
    }
    this.last = this.legs.length ? this.legs[this.legs.length - 1].at(-1) : null;
  }

  tick(dt) {
    if (!this.dirty) return;
    this.saveTimer += dt;
    if (this.saveTimer < 6) return;
    this.saveTimer = 0;
    this.save();
  }

  save() {
    if (!this.dirty) return;
    writeJSON(STORAGE_KEY, this.legs);
    this.dirty = false;
  }

  clear() {
    this.legs = [];
    this.last = null;
    this.dirty = true;
    this.save();
  }
}

export const trail = new Trail();

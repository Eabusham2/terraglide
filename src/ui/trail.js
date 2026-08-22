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

  trim() {
    let total = this.pointCount;
    while (total > MAX_POINTS && this.legs.length > 1) {
      total -= this.legs[0].length;
      this.legs.shift();
    }
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

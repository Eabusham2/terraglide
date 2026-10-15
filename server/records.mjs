/**
 * One player's lasting record: where they are on each world, what they have
 * explored there, the line they have flown, their waypoints and lander, and a
 * few counts. Saved as players/<name>.json.
 *
 * Everything in here is the server's own account of events — exploration and
 * trails are worked out from the moves the server accepted, not taken from the
 * page — so a modified client cannot paint the map with places it never went.
 */

import { BODIES } from '../src/geo/bodies.js';
import { Exploration, decodeCells, encodeCells } from '../src/ui/exploration.js';
import { separation } from '../src/net/protocol.js';

/** Trails: one point per this many metres, and a teleport starts a new leg. */
const TRAIL_STEP_M = 90;
const TRAIL_BREAK_M = 20000;
const TRAIL_MAX_POINTS = 4000;
/** Waypoints a player may keep per world. */
export const MAX_WAYPOINTS = 200;

export function circumferenceOf(world) {
  return 2 * Math.PI * (BODIES[world] ?? BODIES.earth).radius;
}

export function radiusOf(world) {
  return (BODIES[world] ?? BODIES.earth).radius;
}

/**
 * A trail on one world: legs of [lat, lon] points, thinned rather than cut
 * when it grows past its budget — the same rule the game's own trail keeps.
 */
export class TrailRecord {
  constructor(world, legs = []) {
    this.radius = radiusOf(world);
    this.legs = Array.isArray(legs) ? legs.filter(Array.isArray) : [];
    this.last = null;
  }


  /** Returns the point recorded, with whether it starts a leg, or null. */
  record(lat, lon) {
    const point = [round5(lat), round5(lon)];
    if (this.last) {
      const moved = separation({ lat: this.last[0], lon: this.last[1] }, { lat: point[0], lon: point[1] }, this.radius);
      if (moved < TRAIL_STEP_M) return null;
      if (moved > TRAIL_BREAK_M) return this.startLeg(point);
      this.legs[this.legs.length - 1].push(point);
      this.last = point;
      this.trim();
      return { point, leg: false };
    }
    return this.startLeg(point);
  }

  startLeg(point) {
    this.legs.push([point]);
    this.last = point;
    this.trim();
    return { point, leg: true };
  }

  /** The next point starts a new leg. Called on every teleport. */
  break() {
    this.last = null;
  }

  trim() {
    let total = this.legs.reduce((n, leg) => n + leg.length, 0);
    let index = 0;
    while (total > TRAIL_MAX_POINTS && index < this.legs.length) {
      const leg = this.legs[index];
      if (leg.length <= 2) {
        index++;
        continue;
      }
      const kept = leg.filter((_, i) => i % 2 === 0 || i === leg.length - 1);
      total -= leg.length - kept.length;
      this.legs[index] = kept;
      index = 0;
    }
    while (total > TRAIL_MAX_POINTS && this.legs.length > 1) total -= this.legs.shift().length;
    if (this.last) this.last = this.legs.at(-1)?.at(-1) ?? null;
  }
}

function round5(v) {
  return Math.round(v * 1e5) / 1e5;
}

/**
 * What the server keeps for one account, loaded on demand and cached.
 */
export class PlayerRecord {
  constructor(key, saved = {}) {
    this.key = key;
    this.world = BODIES[saved.world] ? saved.world : 'earth';
    this.health = Number.isFinite(saved.health) ? saved.health : null;
    this.stats = { kills: 0, deaths: 0, playSeconds: 0, ...(saved.stats ?? {}) };
    /** Per world: { pos, explored (encoded), trail, waypoints, lander } as saved. */
    this.saved = saved.worlds && typeof saved.worlds === 'object' ? saved.worlds : {};
    /** Live per-world records, built on first use. */
    this.live = new Map();
  }

  /** Everything about one world, decoded and ready to update. */
  on(world) {
    let live = this.live.get(world);
    if (live) return live;
    const saved = this.saved[world] ?? {};
    const explored = new Exploration({ circumference: circumferenceOf(world), stored: false });
    explored.cells = new Set(decodeCells(saved.explored ?? []));
    explored.detailCount = explored.countAt(14);
    live = {
      pos: saved.pos ?? null,
      explored,
      trail: new TrailRecord(world, saved.trail),
      waypoints: Array.isArray(saved.waypoints) ? saved.waypoints.slice(0, MAX_WAYPOINTS) : [],
      lander: saved.lander ?? null,
    };
    this.live.set(world, live);
    return live;
  }


  /** Worlds this player has a record on. */
  worlds() {
    return [...new Set([...Object.keys(this.saved), ...this.live.keys()])];
  }

  toJSON() {
    const worlds = { ...this.saved };
    for (const [world, live] of this.live) {
      worlds[world] = {
        pos: live.pos,
        explored: encodeCells([...live.explored.cells]),
        trail: live.trail.legs,
        waypoints: live.waypoints,
        lander: live.lander,
      };
    }
    return { version: 1, world: this.world, health: this.health, stats: this.stats, worlds };
  }
}
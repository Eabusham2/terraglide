import { Emitter } from '../core/events.js';
import { readJSON, writeJSON } from '../core/storage.js';
import { haversine } from '../geo/mercator.js';

/**
 * Waypoints and drawn paths.
 *
 * A path is a thin polyline you lay down as you travel: tap the path key to drop
 * a point, tap it twice quickly to finish the line. Both show on the minimap and
 * the world map, and both survive a reload.
 */

const WAYPOINT_KEY = 'waypoints';
const PATH_KEY = 'paths';
const DOUBLE_TAP_MS = 450;

const PALETTE = ['#c8b98f', '#8fb3c8', '#a9c88f', '#c88f9b', '#b39bc8', '#c8a98f'];

export class WaypointStore extends Emitter {
  constructor() {
    super();
    this.waypoints = readJSON(WAYPOINT_KEY, []);
    this.paths = readJSON(PATH_KEY, []);
    this.activePath = null;
    this.lastPathTap = 0;
    this.nextId = 1 + Math.max(
      0,
      ...this.waypoints.map((w) => w.id ?? 0),
      ...this.paths.map((p) => p.id ?? 0),
    );
  }

  add(lat, lon, name, altitude = 0) {
    const waypoint = {
      id: this.nextId++,
      name: name || `Waypoint ${this.waypoints.length + 1}`,
      lat,
      lon,
      altitude,
      colour: PALETTE[this.waypoints.length % PALETTE.length],
      createdAt: Date.now(),
    };
    this.waypoints.push(waypoint);
    this.persist();
    this.emit('change', this);
    return waypoint;
  }

  rename(id, name) {
    const waypoint = this.waypoints.find((w) => w.id === id);
    if (!waypoint) return;
    waypoint.name = name;
    this.persist();
    this.emit('change', this);
  }

  remove(id) {
    this.waypoints = this.waypoints.filter((w) => w.id !== id);
    this.persist();
    this.emit('change', this);
  }

  nearest(lat, lon) {
    let best = null;
    let bestDistance = Infinity;
    for (const waypoint of this.waypoints) {
      const d = haversine({ lat, lon }, waypoint);
      if (d < bestDistance) {
        bestDistance = d;
        best = waypoint;
      }
    }
    return best ? { waypoint: best, distance: bestDistance } : null;
  }

  /**
   * Path key press. Returns what happened so the HUD can say something useful.
   * @returns {'started'|'point'|'finished'|'discarded'}
   */
  tapPath(lat, lon) {
    const now = performance.now();
    const doubleTap = now - this.lastPathTap < DOUBLE_TAP_MS;
    this.lastPathTap = now;

    if (this.activePath && doubleTap) {
      return this.finishPath();
    }
    if (!this.activePath) {
      this.activePath = {
        id: this.nextId++,
        name: `Path ${this.paths.length + 1}`,
        colour: PALETTE[(this.paths.length + 2) % PALETTE.length],
        points: [{ lat, lon }],
        createdAt: Date.now(),
      };
      this.emit('change', this);
      return 'started';
    }
    this.activePath.points.push({ lat, lon });
    this.emit('change', this);
    return 'point';
  }

  finishPath() {
    if (!this.activePath) return 'discarded';
    if (this.activePath.points.length < 2) {
      this.activePath = null;
      this.emit('change', this);
      return 'discarded';
    }
    this.paths.push(this.activePath);
    this.activePath = null;
    this.persist();
    this.emit('change', this);
    return 'finished';
  }

  removePath(id) {
    this.paths = this.paths.filter((p) => p.id !== id);
    this.persist();
    this.emit('change', this);
  }

  pathLength(path) {
    let total = 0;
    for (let i = 1; i < path.points.length; i++) {
      total += haversine(path.points[i - 1], path.points[i]);
    }
    return total;
  }

  clearAll() {
    this.waypoints = [];
    this.paths = [];
    this.activePath = null;
    this.persist();
    this.emit('change', this);
  }

  persist() {
    writeJSON(WAYPOINT_KEY, this.waypoints);
    writeJSON(PATH_KEY, this.paths);
  }

  export() {
    return { waypoints: this.waypoints, paths: this.paths };
  }

  import(data) {
    if (Array.isArray(data.waypoints)) this.waypoints = data.waypoints;
    if (Array.isArray(data.paths)) this.paths = data.paths;
    this.persist();
    this.emit('change', this);
  }
}

export const waypoints = new WaypointStore();

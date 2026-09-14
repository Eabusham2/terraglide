import { Emitter } from '../core/events.js';
import { readJSON, writeJSON } from '../core/storage.js';
import { haversine } from '../geo/mercator.js';

/** Saved places. Drop one where you are standing; it shows on both maps. */

const WAYPOINT_KEY = 'waypoints';

const PALETTE = ['#c8b98f', '#8fb3c8', '#a9c88f', '#c88f9b', '#b39bc8', '#c8a98f'];

export class WaypointStore extends Emitter {
  constructor() {
    super();
    this.waypoints = readJSON(WAYPOINT_KEY, []);
    this.nextId = 1 + Math.max(0, ...this.waypoints.map((w) => w.id ?? 0));
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

  /**
   * Put a waypoint somewhere else. Dropping one and deleting the old one would
   * renumber it and give it a new colour, so a drag on the map would look like
   * a different waypoint arriving.
   */
  move(id, lat, lon) {
    const waypoint = this.waypoints.find((w) => w.id === id);
    if (!waypoint) return null;
    waypoint.lat = lat;
    waypoint.lon = lon;
    this.persist();
    this.emit('change', this);
    return waypoint;
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

  clearAll() {
    this.waypoints = [];
    this.persist();
    this.emit('change', this);
  }

  persist() {
    writeJSON(WAYPOINT_KEY, this.waypoints);
  }

  export() {
    return { waypoints: this.waypoints };
  }

  import(data) {
    if (Array.isArray(data.waypoints)) this.waypoints = data.waypoints;
    this.persist();
    this.emit('change', this);
  }
}

export const waypoints = new WaypointStore();

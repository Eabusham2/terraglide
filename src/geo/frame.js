import { DEG, RAD } from '../core/math.js';
import {
  EARTH_RADIUS,
  MAX_LATITUDE,
  inverseMercatorPhi,
  mercatorPhi,
  wrapLon,
} from './mercator.js';

/**
 * The scene is drawn in a *local mercator metre* frame:
 *
 *   +X east, +Y up, -Z north, one unit = one metre at the anchor latitude.
 *
 * Using mercator (rather than a true tangent plane) means a map tile is an
 * exact square in world space, which keeps the terrain quadtree trivial and
 * crack-free. The price is a scale error of cos(anchorLat)/cos(lat), which is
 * well under a percent across a normal view and is re-zeroed every time the
 * anchor moves, so it never accumulates.
 *
 * Coordinates far from the anchor also lose float precision, so the frame
 * re-anchors on teleport and whenever the player drifts past `rebaseDistance`.
 */
export class LocalFrame {
  constructor(lat = 0, lon = 0) {
    this.rebaseDistance = 40000; // metres
    this.setAnchor(lat, lon);
  }

  setAnchor(lat, lon) {
    this.anchorLat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
    this.anchorLon = wrapLon(lon);
    this.cosAnchor = Math.cos(this.anchorLat * DEG);
    /** Metres per radian of mercator at the anchor. */
    this.scale = EARTH_RADIUS * this.cosAnchor;
    this.mercX0 = this.anchorLon * DEG;
    this.mercY0 = mercatorPhi(this.anchorLat);
  }

  /** True when the point is far enough out that we should re-anchor. */
  needsRebase(x, z) {
    return Math.hypot(x, z) > this.rebaseDistance;
  }

  /** Geodetic -> world. Returns a plain object; callers copy into vectors. */
  toWorld(lat, lon, out = { x: 0, y: 0, z: 0 }) {
    let dLon = (wrapLon(lon) - this.anchorLon) * DEG;
    if (dLon > Math.PI) dLon -= 2 * Math.PI;
    else if (dLon < -Math.PI) dLon += 2 * Math.PI;
    out.x = dLon * this.scale;
    out.y = 0;
    out.z = -(mercatorPhi(lat) - this.mercY0) * this.scale;
    return out;
  }

  /** World -> geodetic. */
  toGeo(x, z, out = { lat: 0, lon: 0 }) {
    out.lon = wrapLon(this.anchorLon + (x / this.scale) * RAD);
    out.lat = inverseMercatorPhi(this.mercY0 - z / this.scale);
    return out;
  }

  /** Normalised mercator [0,1] coordinates -> world. */
  normToWorld(nx, ny, out = { x: 0, z: 0 }) {
    const mercX = (nx * 2 - 1) * Math.PI;
    const mercY = (1 - 2 * ny) * Math.PI;
    let dx = mercX - this.mercX0;
    if (dx > Math.PI) dx -= 2 * Math.PI;
    else if (dx < -Math.PI) dx += 2 * Math.PI;
    out.x = dx * this.scale;
    out.z = -(mercY - this.mercY0) * this.scale;
    return out;
  }

  /** World -> normalised mercator [0,1] (x may fall outside and needs wrapping). */
  worldToNorm(x, z, out = { nx: 0, ny: 0 }) {
    const mercX = this.mercX0 + x / this.scale;
    const mercY = this.mercY0 - z / this.scale;
    out.nx = mercX / (2 * Math.PI) + 0.5;
    out.ny = 0.5 - mercY / (2 * Math.PI);
    return out;
  }

  /** Edge length in world units of a tile at zoom `z`. */
  worldTileSize(z) {
    return (2 * Math.PI * this.scale) / Math.pow(2, z);
  }

  /**
   * Mercator stretches distances by 1/cos(lat). Multiply a world-space length by
   * this to get real ground metres at that latitude.
   */
  groundScaleAt(lat) {
    return Math.cos(lat * DEG) / this.cosAnchor;
  }

  /** How far the ground falls away from the tangent plane at `distance` metres. */
  static curvatureDrop(distance) {
    return (distance * distance) / (2 * EARTH_RADIUS);
  }
}

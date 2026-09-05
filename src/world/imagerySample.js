/**
 * Read the aerial photograph at a point on the ground.
 *
 * Shared by the scenery and the buildings, because both want the same thing:
 * the actual colour of that exact patch of earth, rather than a palette
 * somebody chose. The imagery is already downloaded and already decoded for the
 * map, so this costs a lookup.
 */

import { latToNormY, lonToNormX } from '../geo/mercator.js';
import { mapTiles } from '../ui/mapTiles.js';

/** Imagery zoom to sample from — close enough to resolve a roof. */
export const SAMPLE_ZOOM = 16;

const geo = { lat: 0, lon: 0 };

/**
 * @returns {{r:number,g:number,b:number}|null} 0-1 channels, or null when that
 * tile has not arrived yet — callers must have something to fall back on.
 */
export function sampleImageryAt(frame, x, z, zoom = SAMPLE_ZOOM) {
  if (!frame) return null;
  const point = frame.toGeo(x, z, geo);
  const n = Math.pow(2, zoom);
  const fx = lonToNormX(point.lon) * n;
  const fy = latToNormY(point.lat) * n;
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  if (ty < 0 || ty >= n) return null;
  try {
    return mapTiles.sampleColour(zoom, tx, ty, fx - tx, fy - ty);
  } catch {
    return null;
  }
}

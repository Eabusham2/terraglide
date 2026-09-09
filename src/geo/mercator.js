import { DEG, RAD, clamp } from '../core/math.js';

/** Spherical earth / Web Mercator constants. */
export const EARTH_RADIUS = 6378137;
export const EARTH_CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS;
/** Latitude where the Web Mercator square closes. */
export const MAX_LATITUDE = 85.05112878;

/** Longitude (deg) to normalised mercator X in [0,1]. */
export function lonToNormX(lon) {
  return (wrapLon(lon) + 180) / 360;
}

/** Latitude (deg) to normalised mercator Y in [0,1] (0 = north pole side). */
export function latToNormY(lat) {
  const phi = clamp(lat, -MAX_LATITUDE, MAX_LATITUDE) * DEG;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI);
}

export function normXToLon(x) {
  return x * 360 - 180;
}

export function normYToLat(y) {
  return (2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) * RAD;
}

export function wrapLon(lon) {
  let x = (lon + 180) % 360;
  if (x < 0) x += 360;
  return x - 180;
}

/** Mercator ordinate in radians: ln(tan(pi/4 + phi/2)). Used by the local frame. */
export function mercatorPhi(lat) {
  const phi = clamp(lat, -MAX_LATITUDE, MAX_LATITUDE) * DEG;
  return Math.log(Math.tan(Math.PI / 4 + phi / 2));
}

export function inverseMercatorPhi(y) {
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * RAD;
}

export function tileCount(z) {
  return Math.pow(2, z);
}

export function wrapTileX(x, z) {
  const n = tileCount(z);
  return ((x % n) + n) % n;
}

export function lonLatToTile(lat, lon, z) {
  const n = tileCount(z);
  const x = Math.floor(lonToNormX(lon) * n);
  const y = Math.floor(latToNormY(lat) * n);
  return { z, x: wrapTileX(x, z), y: clamp(y, 0, n - 1) };
}

/** North-west corner of a tile. */
export function tileNorthWest(tile) {
  const n = tileCount(tile.z);
  return { lat: normYToLat(tile.y / n), lon: normXToLon(tile.x / n) };
}

export function tileCenter(tile) {
  const n = tileCount(tile.z);
  return { lat: normYToLat((tile.y + 0.5) / n), lon: normXToLon((tile.x + 0.5) / n) };
}

/** Ground resolution (metres per pixel) for a 256 px tile at a latitude. */
export function metresPerPixel(lat, z) {
  return (EARTH_CIRCUMFERENCE * Math.cos(lat * DEG)) / (256 * tileCount(z));
}

/** Bing Maps quadkey for a tile. */
export function quadKey(tile) {
  let key = '';
  for (let i = tile.z; i > 0; i--) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if ((tile.x & mask) !== 0) digit += 1;
    if ((tile.y & mask) !== 0) digit += 2;
    key += digit;
  }
  return key;
}

/** Great-circle distance in metres. */
export function haversine(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in radians, clockwise from north. */
export function bearing(a, b) {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return Math.atan2(y, x);
}

/** Travel `distance` metres from `origin` along `bearingRad`. */
export function destination(origin, bearingRad, distance) {
  const d = distance / EARTH_RADIUS;
  const lat1 = origin.lat * DEG;
  const lon1 = origin.lon * DEG;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearingRad),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: lat2 * RAD, lon: wrapLon(lon2 * RAD) };
}

/**
 * Uniformly distributed point on the sphere, clipped to the mercator band so it
 * is always somewhere the tile pyramid can actually show.
 */
export function randomLatLon(rng = Math.random) {
  const lat = clamp(Math.asin(rng() * 2 - 1) * RAD, -MAX_LATITUDE, MAX_LATITUDE);
  return { lat, lon: rng() * 360 - 180 };
}

/** Uniform random point inside a radius (metres) of an origin. */
export function randomNear(origin, radiusM, rng = Math.random) {
  return destination(origin, rng() * Math.PI * 2, radiusM * Math.sqrt(rng()));
}

export function tileKey(z, x, y) {
  return `${z}/${x}/${y}`;
}

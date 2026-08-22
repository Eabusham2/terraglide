/**
 * Earth-centred coordinates.
 *
 * Real 3D map data — Google's photorealistic tiles, and anything else that
 * speaks OGC 3D Tiles — is published in ECEF: a right-handed frame with its
 * origin at the centre of the Earth, X through the Greenwich meridian at the
 * equator, Z through the north pole. The game runs in a small local frame with
 * +X east, +Y up and −Z north, so every tile has to be moved from one to the
 * other. That is all this file does, and it is kept free of three.js so the
 * maths can be checked without a browser.
 *
 * WGS84 ellipsoid, because that is what the data is surveyed on.
 */

const A = 6378137.0; // semi-major axis, metres
const F = 1 / 298.257223563; // flattening
const E2 = F * (2 - F); // first eccentricity squared
const DEG = Math.PI / 180;

/** Geodetic latitude/longitude/height to ECEF metres. */
export function geodeticToEcef(lat, lon, height = 0, out = { x: 0, y: 0, z: 0 }) {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const n = A / Math.sqrt(1 - E2 * sinPhi * sinPhi);

  out.x = (n + height) * cosPhi * Math.cos(lambda);
  out.y = (n + height) * cosPhi * Math.sin(lambda);
  out.z = (n * (1 - E2) + height) * sinPhi;
  return out;
}

/** ECEF metres back to geodetic. Iterative, converges in a handful of passes. */
export function ecefToGeodetic(x, y, z, out = { lat: 0, lon: 0, height: 0 }) {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - E2));
  let height = 0;

  for (let i = 0; i < 6; i++) {
    const sinLat = Math.sin(lat);
    const n = A / Math.sqrt(1 - E2 * sinLat * sinLat);
    height = p / Math.cos(lat) - n;
    lat = Math.atan2(z, p * (1 - (E2 * n) / (n + height)));
  }

  out.lat = lat / DEG;
  out.lon = lon / DEG;
  out.height = height;
  return out;
}

/**
 * The east/north/up basis at a point on the ellipsoid, as ECEF unit vectors.
 * These are the three columns that turn a local offset into an ECEF one.
 */
export function enuBasis(lat, lon) {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLambda = Math.sin(lambda);
  const cosLambda = Math.cos(lambda);

  return {
    east: { x: -sinLambda, y: cosLambda, z: 0 },
    north: { x: -sinPhi * cosLambda, y: -sinPhi * sinLambda, z: cosPhi },
    up: { x: cosPhi * cosLambda, y: cosPhi * sinLambda, z: sinPhi },
  };
}

/**
 * A 4x4 column-major matrix taking ECEF metres into the game's local frame
 * anchored at (lat, lon): +X east, +Y up, −Z north, origin at ground level
 * under the anchor.
 *
 * Column-major so it can be handed straight to a three.js Matrix4.
 */
export function ecefToLocalMatrix(lat, lon, anchorHeight = 0) {
  const origin = geodeticToEcef(lat, lon, anchorHeight);
  const { east, north, up } = enuBasis(lat, lon);

  // Rows of the rotation are the local axes expressed in ECEF; the game's
  // third axis is *south*, hence the negated north.
  const r = [
    [east.x, east.y, east.z],
    [up.x, up.y, up.z],
    [-north.x, -north.y, -north.z],
  ];

  const t = [
    -(r[0][0] * origin.x + r[0][1] * origin.y + r[0][2] * origin.z),
    -(r[1][0] * origin.x + r[1][1] * origin.y + r[1][2] * origin.z),
    -(r[2][0] * origin.x + r[2][1] * origin.y + r[2][2] * origin.z),
  ];

  // prettier-ignore
  return [
    r[0][0], r[1][0], r[2][0], 0,
    r[0][1], r[1][1], r[2][1], 0,
    r[0][2], r[1][2], r[2][2], 0,
    t[0],    t[1],    t[2],    1,
  ];
}

/** Apply a column-major 4x4 to a point. */
export function applyMatrix(m, x, y, z, out = { x: 0, y: 0, z: 0 }) {
  out.x = m[0] * x + m[4] * y + m[8] * z + m[12];
  out.y = m[1] * x + m[5] * y + m[9] * z + m[13];
  out.z = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}

/**
 * Centre and radius of a 3D Tiles bounding volume, in ECEF.
 * Handles the three shapes the spec allows; returns null for anything else.
 */
export function boundingSphereOf(volume) {
  if (!volume) return null;

  if (Array.isArray(volume.sphere) && volume.sphere.length >= 4) {
    const [x, y, z, radius] = volume.sphere;
    return { x, y, z, radius };
  }

  if (Array.isArray(volume.box) && volume.box.length >= 12) {
    const [x, y, z, ax, ay, az, bx, by, bz, cx, cy, cz] = volume.box;
    // Half-diagonal of the oriented box is a safe enclosing radius.
    const radius = Math.hypot(ax + bx + cx, ay + by + cy, az + bz + cz);
    return { x, y, z, radius };
  }

  if (Array.isArray(volume.region) && volume.region.length >= 6) {
    const [west, south, east, north, minHeight, maxHeight] = volume.region;
    const lat = (((south + north) / 2) * 180) / Math.PI;
    const lon = (((west + east) / 2) * 180) / Math.PI;
    const height = (minHeight + maxHeight) / 2;
    const centre = geodeticToEcef(lat, lon, height);
    const corner = geodeticToEcef((north * 180) / Math.PI, (east * 180) / Math.PI, maxHeight);
    return {
      x: centre.x,
      y: centre.y,
      z: centre.z,
      radius: Math.hypot(corner.x - centre.x, corner.y - centre.y, corner.z - centre.z),
    };
  }

  return null;
}

/**
 * Screen-space error for a tile: how many pixels of error you would see if it
 * were drawn at this distance. The number every 3D Tiles renderer refines on.
 */
export function screenSpaceError(geometricError, distance, screenHeight, fovRadians) {
  if (geometricError <= 0) return 0;
  const near = Math.max(distance, 1);
  return (geometricError * screenHeight) / (near * 2 * Math.tan(fovRadians / 2));
}

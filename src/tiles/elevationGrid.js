import { normXToLon, normYToLat } from '../geo/mercator.js';

/**
 * Elevation from services that answer with a grid of numbers rather than a
 * picture.
 *
 * Mapbox and Terrarium pack height into the channels of a PNG, so a tile is
 * one image request and decoding it is arithmetic on pixels. Bing and Google
 * publish elevation as JSON instead: you hand them a rectangle (or a list of
 * points) and they hand back a list of metres. That is a different shape of
 * answer, and this is where the two are made to look the same to everything
 * downstream.
 *
 * Both are coarser than the raster sources and both cost a request per tile
 * against your own account, which is why their descriptors cap the zoom low:
 * a shallow tile covers a lot of ground for one call. Where you have the
 * choice, Terrarium is finer and free — these exist because a Bing or Google
 * key is a thing people have, and having one should be enough.
 */

/** Bing's cap: rows * cols may not exceed 1024. */
export const BING_SIDE = 32;
/** Google's cap is 512 locations a request; 22 x 22 leaves a little room. */
export const GOOGLE_SIDE = 22;

/** Geographic edges of a slippy tile, in degrees. */
export function tileBounds(tile) {
  const n = Math.pow(2, tile.z);
  return {
    west: normXToLon(tile.x / n),
    east: normXToLon((tile.x + 1) / n),
    north: normYToLat(tile.y / n),
    south: normYToLat((tile.y + 1) / n),
  };
}

/**
 * Google's encoded polyline, which is how a few hundred coordinates fit in a
 * URL. Each value is offset from the last, shifted left one bit with the sign
 * folded into bit 0, then emitted five bits at a time with a continuation flag
 * and an ASCII offset of 63. Straight from the published algorithm.
 */
export function encodePolyline(points) {
  let out = '';
  let lastLat = 0;
  let lastLon = 0;
  const chunk = (value) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lat, lon] of points) {
    const y = Math.round(lat * 1e5);
    const x = Math.round(lon * 1e5);
    chunk(y - lastLat);
    chunk(x - lastLon);
    lastLat = y;
    lastLon = x;
  }
  return out;
}

/**
 * The sample points Google is asked for, north row first — the same order the
 * raster decoders produce, so nothing downstream has to know the difference.
 */
export function googleSamplePoints(tile, side = GOOGLE_SIDE) {
  const { west, east, north, south } = tileBounds(tile);
  const points = [];
  for (let row = 0; row < side; row++) {
    const lat = north + ((south - north) * row) / (side - 1);
    for (let col = 0; col < side; col++) {
      points.push([lat, west + ((east - west) * col) / (side - 1)]);
    }
  }
  return points;
}

function bilinear(values, side, fx, fy) {
  const x0 = Math.max(0, Math.min(side - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(side - 1, Math.floor(fy)));
  const x1 = Math.min(side - 1, x0 + 1);
  const y1 = Math.min(side - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const top = values[y0 * side + x0] * (1 - tx) + values[y0 * side + x1] * tx;
  const bottom = values[y1 * side + x0] * (1 - tx) + values[y1 * side + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Stretch a small square grid up to the size the terrain mesh wants. */
export function resampleGrid(values, side, size) {
  const out = new Float32Array(size * size);
  const scale = (side - 1) / (size - 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) out[y * size + x] = bilinear(values, side, x * scale, y * scale);
  }
  return out;
}

/**
 * Bing's Elevation/Bounds answer.
 *
 * The documented order is "starting with the southwest corner, and then
 * proceed west to east and south to north" — so the first row is the *bottom*
 * of the tile and every raster decoder in this project starts at the top. The
 * rows are flipped here rather than anywhere further downstream, where the
 * mistake would show up as terrain mirrored about its own middle.
 */
export function decodeBingElevation(json, size, side = BING_SIDE) {
  const values = json?.resourceSets?.[0]?.resources?.[0]?.elevations;
  if (!Array.isArray(values) || values.length < side * side) {
    throw new Error('Bing elevation returned no grid');
  }
  const north = new Float32Array(side * side);
  for (let row = 0; row < side; row++) {
    const from = (side - 1 - row) * side;
    for (let col = 0; col < side; col++) north[row * side + col] = values[from + col];
  }
  return resampleGrid(north, side, size);
}

/** Google's Elevation answer: results in the order the points were sent. */
export function decodeGoogleElevation(json, size, side = GOOGLE_SIDE) {
  if (json?.status && json.status !== 'OK') {
    throw new Error(`Google elevation: ${json.error_message ?? json.status}`);
  }
  const results = json?.results;
  if (!Array.isArray(results) || results.length < side * side) {
    throw new Error('Google elevation returned no grid');
  }
  const values = new Float32Array(side * side);
  for (let i = 0; i < side * side; i++) values[i] = Number(results[i].elevation) || 0;
  return resampleGrid(values, side, size);
}

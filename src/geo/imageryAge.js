/**
 * When the photograph under you was taken, and by what.
 *
 * "Show the imagery year" is a fair thing to ask of a game made of real
 * photographs: the ground you are flying over is a particular day, and which
 * day it was changes what you are looking at. A 2011 image of a city is a
 * different city.
 *
 * Esri publish it. The World Imagery service carries its own metadata as layer
 * zero, and a point query against it comes back with the capture date, the
 * ground resolution, the satellite or aircraft that took it, the vendor, and —
 * usefully — the deepest zoom that square is actually served at:
 *
 *   SRC_DATE   20180909        9 September 2018
 *   SRC_RES    0.5             half a metre a pixel
 *   SRC_DESC   WV02            WorldView-2
 *   NICE_DESC  Vantor          who supplied it
 *   MaxMapLevel 19             how deep it goes here
 *
 * One request per coarse square, cached, and never on the critical path: if it
 * does not answer, the line simply does not gain a date. Nothing waits for it.
 */

import { lonToNormX, latToNormY } from './mercator.js';

const ENDPOINT =
  'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/0/query';

/**
 * How coarsely to cache the answer.
 *
 * Zoom 9 is about eighty kilometres a square at the equator. Imagery blocks are
 * far larger than a tile and far smaller than a country, and one question per
 * eighty kilometres is a question every few minutes of flying rather than one
 * per tile.
 */
const CACHE_ZOOM = 9;

/** Don't hold a query open for ever; the answer is a nicety. */
const TIMEOUT_MS = 6000;
/**
 * How long a square that could not be asked is left before asking again.
 *
 * A square with no metadata record — ocean, the poles — is a real answer and is
 * cached for good. A request that failed is not an answer, and it used to be
 * cached exactly as though it were: one timeout while flying over Kansas and
 * the attribution line never carried a date for eighty kilometres of it again,
 * however long the session ran. Two minutes is far longer than the hiccup and
 * far shorter than a flight.
 */
const RETRY_MS = 120000;

const cache = new Map();
const inFlight = new Set();
/** Squares that could not be asked, and when it is worth asking again. */
const retryAt = new Map();

/** `20180909` -> a Date, or null. */
function parseStamp(value) {
  const digits = String(value ?? '');
  if (!/^\d{8}$/.test(digits)) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A short line a person can read: "Sep 2018 · 0.5 m · WorldView-2".
 *
 * Only the parts that came back. A record with a date and nothing else says
 * the date, rather than saying the date followed by two empty separators.
 */
export function describeImagery(info) {
  if (!info) return '';
  const parts = [];
  if (info.date) parts.push(`${MONTHS[info.date.getUTCMonth()]} ${info.date.getUTCFullYear()}`);
  if (Number.isFinite(info.resolutionM) && info.resolutionM > 0) {
    parts.push(info.resolutionM < 1 ? `${info.resolutionM} m` : `${Math.round(info.resolutionM)} m`);
  }
  if (info.sensor) parts.push(info.sensor);
  return parts.join(' · ');
}

function keyFor(lat, lon) {
  const n = 2 ** CACHE_ZOOM;
  const x = Math.floor(lonToNormX(lon) * n);
  const y = Math.floor(latToNormY(lat) * n);
  return `${x}/${y}`;
}

/**
 * What is already known about the photograph here, and ask if nothing is.
 *
 * Returns synchronously — the cached answer or null — and starts one request in
 * the background when it has nothing. The caller draws whatever it gets and
 * gains the date a moment later without having waited for it.
 *
 * @returns {null | {date: Date|null, resolutionM: number, sensor: string,
 *   vendor: string, maxZoom: number}}
 */
export function imageryAt(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const key = keyFor(lat, lon);
  if (cache.has(key)) return cache.get(key);
  if (inFlight.has(key)) return null;
  // Asked, and it did not answer. Not the same thing as "there is no record
  // here" — see RETRY_MS — so it waits rather than being written off.
  const failed = retryAt.get(key);
  if (failed !== undefined) {
    if (performance.now() < failed) return null;
    retryAt.delete(key);
  }
  inFlight.add(key);
  ask(lat, lon)
    .then((info) => {
      // A miss is cached too. Ocean and the poles have no metadata record, and
      // asking again every frame for country that will never have one is how a
      // nicety turns into a request storm. `ask` throws rather than returning
      // null when it could not ask at all, so only a genuine "nothing here"
      // reaches this line.
      cache.set(key, info);
    })
    .catch(() => retryAt.set(key, performance.now() + RETRY_MS))
    .finally(() => inFlight.delete(key));
  return null;
}

async function ask(lat, lon) {
  const geometry = encodeURIComponent(
    JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
  );
  const url =
    `${ENDPOINT}?f=json&returnGeometry=false&inSR=4326&spatialRel=esriSpatialRelIntersects`
    + '&geometryType=esriGeometryPoint&outFields=SRC_DATE,SRC_RES,SRC_DESC,NICE_DESC,MaxMapLevel'
    + `&geometry=${geometry}`;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    // Throwing, not returning null. The caller keeps a null for ever, because
    // "this square has no metadata record" is a true and permanent fact about
    // ocean and the poles — and a refusal or a timeout is neither true nor
    // permanent, so it must not arrive here looking the same.
    const response = await fetch(url, { signal: controller?.signal });
    if (!response.ok) throw new Error(`imagery metadata ${response.status}`);
    const body = await response.json();
    const attributes = body?.features?.[0]?.attributes;
    if (!attributes) return null;
    return {
      date: parseStamp(attributes.SRC_DATE),
      resolutionM: Number(attributes.SRC_RES),
      sensor: String(attributes.SRC_DESC ?? '').trim(),
      vendor: String(attributes.NICE_DESC ?? '').trim(),
      maxZoom: Number(attributes.MaxMapLevel) || 0,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Forget everything — used when the imagery provider changes under us. */
export function clearImageryAges() {
  cache.clear();
  inFlight.clear();
  retryAt.clear();
}

import { clamp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { MAX_LATITUDE, destination, randomLatLon } from '../geo/mercator.js';
import { randomPopulatedPlace } from './places.js';

/**
 * Random teleport.
 *
 * Points are drawn uniformly over the sphere (by area, not by latitude — a naive
 * uniform latitude draw crowds you into the poles) and filtered against the
 * *explore seas* setting. Anywhere on Earth, every time. Water rejection reads one low-zoom imagery tile per
 * region and caches it, so a few dozen attempts cost at most a handful of small
 * requests and usually none at all.
 *
 * With sea drops allowed, the *stay within of land* slider caps how far out you
 * may be put: a candidate over water is nudged back toward the nearest land it
 * can find within that distance, and at the top of the slider it is not capped
 * at all and the open ocean is fair game.
 *
 * The whole thing is capped in both attempts and time. If the water test cannot
 * answer — no network, no provider, a blocked request — the last candidate is
 * used rather than leaving you standing still: getting dropped somewhere odd is
 * a better failure than not being dropped at all.
 */

const MAX_ATTEMPTS = 26;
const TIME_BUDGET_MS = 2600;
/**
 * How far to walk outward looking for a coast when the random draw keeps
 * coming up wet. Seven-tenths of the planet is water, so a run of misses is
 * ordinary rather than exceptional, and the time budget usually cuts the draw
 * short long before the attempt count does — which is how a request for dry
 * land ended in the middle of the Pacific.
 */
const RESCUE_RADIUS_M = 400000;

export async function pickRandomDestination({ waterMap, onProgress }) {
  const populated = settings.get('rtpTarget') === 'populated';
  // A populated drop is already on land by construction, so the water test —
  // and its network round trips — is skipped entirely.
  const wantsLand = !populated && !settings.get('exploreSeas');
  const started = performance.now();

  if (populated) {
    const place = randomPopulatedPlace();
    return {
      lat: clamp(place.lat, -MAX_LATITUDE, MAX_LATITUDE),
      lon: place.lon,
      attempts: 0,
      onLand: true,
      place: place.name,
      elapsedMs: performance.now() - started,
    };
  }

  let candidate = randomLatLon();
  let attempts = 0;
  let landed = !wantsLand;

  // Sea drops allowed, but only within reach of land unless the slider is at
  // its top, which means anywhere.
  const limitKm = settings.get('seaDistanceKm');
  const limited = !wantsLand && limitKm <= 500;
  if (limited) {
    const found = await nearLand(candidate, limitKm * 1000, waterMap, started);
    if (found) candidate = found;
  }

  while (wantsLand && attempts < MAX_ATTEMPTS) {
    attempts++;
    if (onProgress && attempts % 4 === 0) onProgress(attempts);
    let water = false;
    try {
      water = await waterMap.isWater(candidate.lat, candidate.lon);
    } catch {
      break; // cannot tell; take what we have
    }
    if (!water) {
      landed = true;
      break;
    }
    if (performance.now() - started > TIME_BUDGET_MS) break;
    candidate = randomLatLon();
  }

  // Out of draws and still wet: rather than dropping you where the last coin
  // toss happened to land, walk outward from it until a coast turns up. Six
  // rings of twelve bearings reach four hundred kilometres in every direction,
  // which finds a shore from all but the deepest few points in the Pacific,
  // and it costs a handful of cached tile reads instead of another two dozen
  // draws that are each as likely to be wet as the last.
  if (wantsLand && !landed) {
    const rescue = await nearLand(candidate, RESCUE_RADIUS_M, waterMap, started, true);
    if (rescue) {
      candidate = rescue;
      landed = true;
    }
  }

  return {
    lat: clamp(candidate.lat, -MAX_LATITUDE, MAX_LATITUDE),
    lon: candidate.lon,
    attempts,
    onLand: landed,
    elapsedMs: performance.now() - started,
  };
}

/**
 * A point within `radius` of land, starting from `origin`. Walks outward in
 * rings and returns the first spot whose neighbourhood has any land in it, or
 * null if the whole area is open ocean (or the test cannot answer).
 */
async function nearLand(origin, radius, waterMap, started, onLand = false) {
  // The rescue walk is the last thing standing between "somewhere on land" and
  // the open Pacific, so it gets its own clock rather than inheriting the
  // draw's, which by now is spent.
  const deadline = onLand ? performance.now() + TIME_BUDGET_MS : started + TIME_BUDGET_MS;
  try {
    if (!(await waterMap.isWater(origin.lat, origin.lon))) return origin;
    for (let ring = 1; ring <= 6; ring++) {
      const distance = (radius * ring) / 6;
      for (let i = 0; i < 12; i++) {
        if (performance.now() > deadline) return null;
        const point = destination(origin, (i / 12) * Math.PI * 2, distance);
        if (!(await waterMap.isWater(point.lat, point.lon))) {
          // Standing on the coast, or just off it — whichever was asked for.
          if (onLand) return point;
          return destination(point, Math.random() * Math.PI * 2, Math.min(radius, 1500));
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

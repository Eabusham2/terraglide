import { clamp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { MAX_LATITUDE, randomLatLon, randomNear } from '../geo/mercator.js';

/**
 * Random teleport.
 *
 * Points are drawn uniformly over the sphere (by area, not by latitude — a naive
 * uniform latitude draw crowds you into the poles), then filtered against the
 * *explore seas* setting. Water rejection reads one low-zoom imagery tile per
 * region and caches it, so a few dozen attempts cost at most a handful of small
 * requests and usually none at all.
 *
 * The whole thing is capped in both attempts and time. If the water test cannot
 * answer — no network, no provider, a blocked request — the last candidate is
 * used rather than leaving you standing still: getting dropped somewhere odd is
 * a better failure than not being dropped at all.
 */

const MAX_ATTEMPTS = 26;
const TIME_BUDGET_MS = 2600;

export async function pickRandomDestination({ waterMap, origin, onProgress }) {
  const wantsLand = !settings.get('exploreSeas');
  const limited = settings.get('rtpRange') === 'radius';
  const radiusM = clamp(settings.get('rtpRadiusKm'), 1, 20000) * 1000;
  const started = performance.now();

  let candidate = draw(limited, origin, radiusM);
  let attempts = 0;
  let landed = !wantsLand;

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
    candidate = draw(limited, origin, radiusM);
  }

  return {
    lat: clamp(candidate.lat, -MAX_LATITUDE, MAX_LATITUDE),
    lon: candidate.lon,
    attempts,
    onLand: landed,
    limited,
    radiusM,
    elapsedMs: performance.now() - started,
  };
}

function draw(limited, origin, radiusM) {
  return limited && origin ? randomNear(origin, radiusM) : randomLatLon();
}

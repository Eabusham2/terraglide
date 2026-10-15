import { BODIES } from './bodies.js';
import { FEATURES, FEATURE_KINDS } from './gazetteerData.js';

/**
 * Names for places that are not on Earth.
 *
 * Earth has street addresses and a geocoder to ask for them. Everywhere else
 * has the International Astronomical Union, which names every crater, mountain,
 * valley and plain anyone has cause to talk about, and the USGS keeps the list
 * with each feature's centre and size. That list — every adopted name on every
 * world the game reaches, eight thousand of them — is what this reads: so the
 * corner of the screen says "Mare Tranquillitatis" rather than a pair of
 * numbers, and the map's search box finds "Olympus Mons" on Mars and "Tycho"
 * on the Moon. See tools/gazetteer.py for where it comes from.
 */

const cache = new Map();
const DEG = Math.PI / 180;

/** Feature types whose names do not already say what they are. */
const SAY_KIND = new Set(['AA']);

/**
 * Every named feature on a body, largest first.
 * @returns {{name:string, lat:number, lon:number, diameterKm:number, kind:string, code:string}[]}
 */
export function featuresOn(bodyId) {
  if (cache.has(bodyId)) return cache.get(bodyId);
  const table = FEATURES[bodyId];
  const list = table
    ? table.split('|').map((row) => {
        const [name, lat, lon, diameter, code] = row.split(';');
        return {
          name,
          lat: Number(lat),
          lon: Number(lon),
          diameterKm: Number(diameter),
          kind: FEATURE_KINDS[code] ?? '',
          code,
        };
      })
    : [];
  cache.set(bodyId, list);
  return list;
}

/** "Copernicus crater", "Olympus Mons", "Snowman". */
export function featureLabel(feature) {
  return SAY_KIND.has(feature.code) ? `${feature.name} ${feature.kind}` : feature.name;
}

function distanceKm(radiusM, lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return (2 * radiusM * Math.asin(Math.min(1, Math.sqrt(a)))) / 1000;
}

/** Lower case with the accents off, so "sav" finds Sāvitrī and "neper" finds Néper. */
function fold(text) {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Which named place you are in, or failing that, nearest to.
 *
 * Inside means within the feature's own radius, and when you are inside
 * several — a crater on a mare inside a basin — the smallest wins, because it
 * is the most particular thing that is true. Outside all of them, the one
 * whose edge is nearest.
 *
 * @returns {{feature:object, label:string, inside:boolean, distanceKm:number}|null}
 */
export function describePlace(bodyId, lat, lon) {
  const radius = BODIES[bodyId]?.radius;
  const list = featuresOn(bodyId);
  if (!radius || !list.length) return null;
  let inside = null;
  let nearest = null;
  let nearestGap = Infinity;
  for (const feature of list) {
    const d = distanceKm(radius, lat, lon, feature.lat, feature.lon);
    const r = Math.max(0.05, feature.diameterKm / 2);
    if (d <= r) {
      if (!inside || feature.diameterKm < inside.feature.diameterKm) inside = { feature, d };
    } else if (d - r < nearestGap) {
      nearestGap = d - r;
      nearest = { feature, d };
    }
  }
  if (inside) {
    return { feature: inside.feature, label: featureLabel(inside.feature), inside: true, distanceKm: inside.d };
  }
  if (!nearest) return null;
  return { feature: nearest.feature, label: featureLabel(nearest.feature), inside: false, distanceKm: nearestGap };
}

/**
 * Named features matching what was typed: names that start with it first,
 * then names that contain it, the bigger feature first within each.
 */
export function searchFeatures(bodyId, query, limit = 6) {
  const q = fold(String(query ?? '').trim());
  if (!q) return [];
  const scored = [];
  for (const feature of featuresOn(bodyId)) {
    const name = fold(feature.name);
    const label = fold(featureLabel(feature));
    let score;
    if (name === q || label === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q) || label.includes(q)) score = 2;
    else continue;
    scored.push({ feature, score });
  }
  scored.sort((a, b) => a.score - b.score || b.feature.diameterKm - a.feature.diameterKm);
  return scored.slice(0, limit).map(({ feature }) => ({
    label: featureLabel(feature),
    lat: feature.lat,
    lon: feature.lon,
    diameterKm: feature.diameterKm,
  }));
}
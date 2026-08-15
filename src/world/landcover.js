/**
 * Reading OpenStreetMap land cover.
 *
 * Kept free of three.js and of the DOM so the rules about what counts as a wood
 * — and the point-in-polygon test that decides whether a spot is inside one —
 * can be checked headlessly, which is the only part of the scenery pipeline
 * that can be checked without a network.
 */

/** Ray-casting point-in-polygon. `ring` is a flat [x, z, x, z, …] array. */
export function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i];
    const zi = ring[i + 1];
    const xj = ring[j];
    const zj = ring[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Which of our objects an OSM area is made of, or null if we do not represent
 * it. Kept as a pure function so it can be checked without a browser.
 */
export function classify(tags = {}) {
  const natural = tags.natural;
  const landuse = tags.landuse;

  if (natural === 'wood' || landuse === 'forest') {
    const leaf = tags.leaf_type;
    // OSM records the leaf type of most managed woodland. Where it does not,
    // treat it as mixed and let the hash decide tree by tree.
    return { kind: leaf === 'needleleaved' ? 'conifer' : leaf === 'broadleaved' ? 'broadleaf' : 'mixed' };
  }
  if (natural === 'scrub' || natural === 'heath' || landuse === 'meadow') return { kind: 'bush' };
  if (landuse === 'orchard' || landuse === 'vineyard') return { kind: 'broadleaf', spacing: 10 };
  if (natural === 'bare_rock' || natural === 'scree' || natural === 'shingle') return { kind: 'rock' };
  return null;
}

/** Parse an Overpass response into areas and points, in lat/lon. */
export function parseFeatures(data) {
  const areas = [];
  const points = [];
  for (const element of data?.elements ?? []) {
    if (element.type === 'node' && element.tags?.natural === 'tree') {
      points.push({ lat: element.lat, lon: element.lon, tags: element.tags });
      continue;
    }
    if (element.type !== 'way' || !Array.isArray(element.geometry)) continue;
    const classified = classify(element.tags);
    if (!classified) continue;
    if (element.geometry.length < 4) continue;
    areas.push({ ...classified, id: element.id, geometry: element.geometry });
  }
  return { areas, points };
}


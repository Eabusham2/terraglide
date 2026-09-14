import { POINT, POLYGON, decodeVectorTile } from '../tiles/vectorTile.js';

/**
 * Drawing a vector tile as a street map.
 *
 * The palette is deliberately close to the standard OpenStreetMap one, because
 * this stands in for those tiles: the maps dim whatever they get for ground you
 * have not visited, and a map that arrives in a different key would announce
 * itself every time the two were next to each other.
 *
 * What is *not* here is as deliberate. No label halos placed by collision
 * detection, no road names running along their roads, no shields: those want a
 * text engine, and this is a background layer for a flight map, not a
 * cartography product. Place names are drawn, because a map with no names on it
 * is a diagram, and the canvas can already draw text.
 */

const WATER = '#a5c8e8';
const PAPER = '#f2efe9';

/**
 * The only layers worth decoding. A city tile is most of a megabyte and nine
 * tenths of that is points of interest — every bench and postbox — which a
 * background map has no business drawing.
 */
const DRAWN_LAYERS = new Set([
  'landcover',
  'landuse',
  'park',
  'water',
  'waterway',
  'building',
  'transportation',
  'boundary',
  'place',
]);

/** Fills, in the order they are painted. Later layers cover earlier ones. */
const AREAS = [
  { layer: 'landcover', match: { class: ['wood', 'forest'] }, fill: '#c6dfb8' },
  { layer: 'landcover', match: { class: ['grass', 'meadow', 'farmland'] }, fill: '#ddedcd' },
  { layer: 'landcover', match: { class: ['sand', 'desert'] }, fill: '#f2e5c4' },
  { layer: 'landcover', match: { class: ['ice', 'glacier'] }, fill: '#e8f4f8' },
  { layer: 'landuse', match: { class: ['residential', 'suburb', 'neighbourhood'] }, fill: '#e6e1d8' },
  { layer: 'landuse', match: { class: ['industrial', 'commercial'] }, fill: '#e8dfe0' },
  { layer: 'park', match: null, fill: '#d5e8ca' },
  { layer: 'water', match: null, fill: WATER },
  { layer: 'building', match: null, fill: '#d6cec5', minZoom: 13 },
];

/**
 * Roads, widest class first so narrow ones draw on top of the wide ones they
 * join. `casing` is the darker outline underneath; `width` is in screen pixels
 * at the tile's own zoom.
 */
const ROADS = [
  { classes: ['motorway'], width: 3.4, fill: '#e9a17c', casing: '#c4855f' },
  { classes: ['trunk', 'primary'], width: 2.8, fill: '#f5d38a', casing: '#c9a86a' },
  { classes: ['secondary', 'tertiary'], width: 2.2, fill: '#f7f4c8', casing: '#c7c39f' },
  { classes: ['minor', 'service', 'street'], width: 1.4, fill: '#ffffff', casing: '#c9c3ba', minZoom: 13 },
  { classes: ['path', 'track'], width: 0.9, fill: '#c0a68a', casing: null, minZoom: 14 },
  { classes: ['rail', 'transit'], width: 0.7, fill: '#a8a8a8', casing: null, minZoom: 11 },
];

const PLACE_SIZE = {
  city: 13,
  town: 11,
  village: 9.5,
  suburb: 9.5,
  hamlet: 8.5,
};

function matches(properties, match) {
  if (!match) return true;
  for (const [key, allowed] of Object.entries(match)) {
    if (!allowed.includes(properties[key])) return false;
  }
  return true;
}

function tracePath(ctx, feature, scale) {
  ctx.beginPath();
  for (const ring of feature.rings) {
    if (ring.length < 4) continue;
    ctx.moveTo(ring[0] * scale, ring[1] * scale);
    for (let i = 2; i + 1 < ring.length; i += 2) ctx.lineTo(ring[i] * scale, ring[i + 1] * scale);
  }
}

function drawAreas(ctx, layers, scale, zoom) {
  for (const spec of AREAS) {
    if (spec.minZoom && zoom < spec.minZoom) continue;
    const layer = layers.get(spec.layer);
    if (!layer) continue;
    ctx.fillStyle = spec.fill;
    for (const feature of layer.features) {
      if (feature.type !== POLYGON) continue;
      if (!matches(feature.properties, spec.match)) continue;
      tracePath(ctx, feature, scale);
      ctx.fill('evenodd');
    }
  }
}

function drawRoads(ctx, layers, scale, zoom) {
  const layer = layers.get('transportation');
  if (!layer) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Casings first, all of them, then the fills — otherwise every junction has
  // a dark line drawn across it by the next road's casing.
  for (const pass of ['casing', 'fill']) {
    for (const spec of ROADS) {
      if (spec.minZoom && zoom < spec.minZoom) continue;
      const colour = pass === 'casing' ? spec.casing : spec.fill;
      if (!colour) continue;
      ctx.strokeStyle = colour;
      ctx.lineWidth = pass === 'casing' ? spec.width + 1.2 : spec.width;
      for (const feature of layer.features) {
        if (feature.type === POINT) continue;
        if (!spec.classes.includes(feature.properties.class)) continue;
        tracePath(ctx, feature, scale);
        ctx.stroke();
      }
    }
  }
}

function drawBoundaries(ctx, layers, scale) {
  const layer = layers.get('boundary');
  if (!layer) return;
  ctx.save();
  ctx.strokeStyle = '#9a7fa0';
  ctx.setLineDash([5, 3]);
  for (const feature of layer.features) {
    const level = Number(feature.properties.admin_level ?? 10);
    if (level > 4) continue;
    ctx.lineWidth = level <= 2 ? 1.6 : 1;
    tracePath(ctx, feature, scale);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlaces(ctx, layers, scale, size) {
  const layer = layers.get('place');
  if (!layer) return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const drawn = [];
  for (const feature of layer.features) {
    if (feature.type !== POINT) continue;
    const name = feature.properties['name:en'] ?? feature.properties.name;
    const fontSize = PLACE_SIZE[feature.properties.class];
    if (!name || !fontSize) continue;
    const ring = feature.rings[0];
    if (!ring) continue;
    const x = ring[0] * scale;
    const y = ring[1] * scale;
    if (x < 0 || y < 0 || x > size || y > size) continue;
    // Cheap collision: keep names off each other without a real label engine.
    if (drawn.some((p) => Math.abs(p.x - x) < 46 && Math.abs(p.y - y) < fontSize + 5)) continue;
    drawn.push({ x, y });
    ctx.font = `${fontSize}px system-ui, sans-serif`;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    ctx.strokeText(name, x, y);
    ctx.fillStyle = '#3a3a38';
    ctx.fillText(name, x, y);
  }
}

/**
 * Draw one decoded vector tile into a bitmap.
 *
 * @param {ArrayBuffer|Uint8Array} data raw .pbf bytes
 * @param {number} zoom the tile's own zoom, which decides what is worth drawing
 * @param {number} size output pixels a side
 */
export async function renderVectorTile(data, zoom, size = 256) {
  const layers = decodeVectorTile(data, DRAWN_LAYERS);
  const extent = layers.values().next().value?.extent ?? 4096;
  const scale = size / extent;

  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size, size);

  drawAreas(ctx, layers, scale, zoom);
  drawRoads(ctx, layers, scale, zoom);
  drawBoundaries(ctx, layers, scale);
  drawPlaces(ctx, layers, scale, size);

  return canvas.transferToImageBitmap
    ? canvas.transferToImageBitmap()
    : createImageBitmap(canvas);
}

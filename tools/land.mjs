#!/usr/bin/env node
/**
 * Builds src/geo/landData.js: where Earth's land is, as a grid, for the world
 * map's "land explored" figure.
 *
 * The game has no coastline of its own - WaterMap reads one off imagery, a
 * region at a time, over the network - and a share of the world's land needs
 * the whole world's at once, offline, on every page and on the server alike.
 * So this rasterises Natural Earth's land polygons, less its lakes (public
 * domain, naturalearthdata.com), onto a latitude-longitude grid and writes it
 * as runs: per row, from 180 degrees west, water, land, water, land... as
 * varints, base64. A cell is land when its centre is.
 *
 *   base=https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson
 *   curl -LO $base/ne_10m_land.geojson -LO $base/ne_10m_lakes.geojson
 *   node tools/land.mjs ne_10m_land.geojson --minus ne_10m_lakes.geojson --per-degree 16
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const source = args.find((a) => !a.startsWith('--'));
if (!source) {
  console.error('usage: node tools/land.mjs ne_10m_land.geojson [--minus ne_10m_lakes.geojson] [--per-degree 16] [--out path]');
  process.exit(1);
}
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PER_DEGREE = Number(flag('per-degree', 16));
const OUT = resolve(flag('out', join(ROOT, 'src/geo/landData.js')));
const WIDTH = 360 * PER_DEGREE;
const HEIGHT = 180 * PER_DEGREE;

/**
 * A GeoJSON file's polygons, filled: one byte a cell, 1 inside.
 *
 * Every polygon edge is cut by the latitude of each row's centre it spans, and
 * a row is inside between alternate cuts - even and odd, so an island in a
 * lake in a continent comes out right without knowing which ring is which.
 */
function rasterise(file) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const cuts = Array.from({ length: HEIGHT }, () => []);
  let rings = 0;
  let edges = 0;
  const addRing = (ring) => {
    rings++;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      if (y1 === y2) continue;
      edges++;
      const top = Math.max(y1, y2);
      const bottom = Math.min(y1, y2);
      // Rows whose centre latitude lies in [bottom, top): half-open, so a
      // vertex exactly on a row's centre is counted by one of its two edges.
      const first = Math.max(0, Math.ceil((90 - top) * PER_DEGREE - 0.5));
      const last = Math.min(HEIGHT - 1, Math.floor((90 - bottom) * PER_DEGREE - 0.5));
      for (let row = first; row <= last; row++) {
        const lat = 90 - (row + 0.5) / PER_DEGREE;
        if (lat < bottom || lat >= top) continue;
        cuts[row].push(x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
  };
  for (const feature of data.features ?? []) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
    for (const polygon of polygons) for (const ring of polygon) addRing(ring);
  }
  const inside = new Uint8Array(WIDTH * HEIGHT);
  for (let row = 0; row < HEIGHT; row++) {
    const list = cuts[row].sort((a, b) => a - b);
    for (let i = 0; i + 1 < list.length; i += 2) {
      // Cells whose centre longitude is in [list[i], list[i + 1]).
      const from = Math.max(0, Math.ceil((list[i] + 180) * PER_DEGREE - 0.5));
      const to = Math.min(WIDTH - 1, Math.ceil((list[i + 1] + 180) * PER_DEGREE - 0.5) - 1);
      if (to >= from) inside.fill(1, row * WIDTH + from, row * WIDTH + to + 1);
    }
  }
  console.log(`${file}: ${rings} rings, ${edges} edges`);
  return inside;
}

const land = rasterise(source);
// Lakes are water, though Natural Earth draws its land round them: the land
// polygons fill Superior and Victoria, and leave only the Caspian out.
const minus = flag('minus', null);
if (minus) {
  const water = rasterise(minus);
  for (let i = 0; i < land.length; i++) if (water[i]) land[i] = 0;
}

const bytes = [];
function varint(n) {
  while (n >= 0x80) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
}

const R = 6371.0088;
let landKm2 = 0;
let landCells = 0;
for (let row = 0; row < HEIGHT; row++) {
  const north = (90 - row / PER_DEGREE) * Math.PI / 180;
  const south = (90 - (row + 1) / PER_DEGREE) * Math.PI / 180;
  const cellKm2 = (R * R * (Math.sin(north) - Math.sin(south)) * 2 * Math.PI) / WIDTH;
  // Runs, sea first: a row that starts on land starts with a sea run of 0.
  let value = 0;
  let run = 0;
  for (let c = 0; c < WIDTH; c++) {
    const here = land[row * WIDTH + c];
    if (here) {
      landCells++;
      landKm2 += cellKm2;
    }
    if (here === value) run++;
    else {
      varint(run);
      value = here;
      run = 1;
    }
  }
  varint(run);
}

const base64 = Buffer.from(bytes).toString('base64');
// The self test refuses anything in src/ shaped like a key or a token, and a
// long enough run of base64 can be one by chance ("eyJ" and twenty letters
// reads as a JWT). Better to say so here than to commit it and fail there.
const TOKEN_SHAPED = /eyJ[A-Za-z0-9_-]{20,}|pk\.[A-Za-z0-9_-]{30,}|AIza[A-Za-z0-9_-]{30,}|sk-[A-Za-z0-9]{20,}/;
if (TOKEN_SHAPED.test(base64)) {
  console.error(`the encoded grid contains a token-shaped run (${TOKEN_SHAPED.exec(base64)[0].slice(0, 12)}...); try another --per-degree`);
  process.exit(1);
}
const sphereKm2 = 4 * Math.PI * R * R;
writeFileSync(OUT, `/**
 * Where Earth's land is, by latitude and longitude: generated by
 * tools/land.mjs from Natural Earth's 1:10m land polygons less its 1:10m
 * lakes (public domain, naturalearthdata.com). Do not edit by hand; see
 * src/geo/land.js.
 *
 * ${WIDTH} by ${HEIGHT} cells, ${PER_DEGREE} to the degree, rows from the north, each
 * row from 180 degrees west as runs (water, land, water...) in base64 varints.
 * ${landCells} land cells, ${Math.round(landKm2).toLocaleString('en-GB')} km2: ${(landKm2 / sphereKm2 * 100).toFixed(2)}% of the planet.
 */
export const LAND_GRID = {
  perDegree: ${PER_DEGREE},
  width: ${WIDTH},
  height: ${HEIGHT},
  runs: '${base64}',
};
`);
console.log(`${WIDTH}x${HEIGHT}; land ${Math.round(landKm2).toLocaleString('en-GB')} km2 (${(landKm2 / sphereKm2 * 100).toFixed(2)}%); ${bytes.length} bytes, ${base64.length} base64 -> ${OUT}`);

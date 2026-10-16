import { LAND_GRID } from './landData.js';

/**
 * Is it land? Earth's, from a grid of the whole planet built from Natural
 * Earth's land polygons (see tools/land.mjs): a cell sixteen to the degree,
 * about seven kilometres on the equator, is land when its centre is. Coarse
 * along a coast and blind to an islet, and fine for what it is for: the world
 * map's share of the land you have explored, which is the whole planet's land
 * at once, offline, where reading coastlines off imagery a region at a time
 * (geo/water.js) cannot help.
 *
 * Decoded on first use - two megabytes of bits - so a page that never asks,
 * and the server, which never does, pays nothing for it.
 */

let bits = null;
/** Each mercator row and column at TILE_LEVEL, as a grid row and column. See isLandTile. */
let gridRowOf = null;
let gridColumnOf = null;
let tileLevel = -1;

/** How much of the planet the grid calls land, from 0 to 1; added up as it is decoded. */
let landShare = 0;

function grid() {
  if (bits) return bits;
  const { width, height, perDegree, runs } = LAND_GRID;
  const bytes = decodeBase64(runs);
  bits = new Uint8Array(Math.ceil((width * height) / 8));
  landShare = 0;
  let at = 0;
  for (let row = 0; row < height; row++) {
    // One cell's share of a sphere: its band of latitude, 1/width of the way round.
    const north = ((90 - row / perDegree) * Math.PI) / 180;
    const south = ((90 - (row + 1) / perDegree) * Math.PI) / 180;
    const cellShare = (Math.sin(north) - Math.sin(south)) / (2 * width);
    let column = 0;
    let land = false;
    while (column < width && at < bytes.length) {
      let run = 0;
      let shift = 0;
      let byte;
      do {
        byte = bytes[at++];
        run |= (byte & 0x7f) << shift;
        shift += 7;
      } while (byte & 0x80);
      if (land) {
        const end = Math.min(width, column + run);
        for (let c = column; c < end; c++) setBit(row * width + c);
        landShare += (end - column) * cellShare;
      }
      column += run;
      land = !land;
    }
  }
  return bits;
}

function setBit(index) {
  bits[index >> 3] |= 1 << (index & 7);
}

function decodeBase64(text) {
  if (typeof globalThis.atob === 'function') {
    const raw = globalThis.atob(text);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  return new Uint8Array(globalThis.Buffer.from(text, 'base64'));
}

function landAtCell(row, column) {
  const { width, height } = LAND_GRID;
  if (row < 0 || row >= height) return false;
  const c = ((column % width) + width) % width;
  const index = row * width + c;
  return (grid()[index >> 3] & (1 << (index & 7))) !== 0;
}

/** Is there land at this latitude and longitude, on Earth? */
export function isLandAt(lat, lon) {
  const { perDegree } = LAND_GRID;
  return landAtCell(Math.floor((90 - lat) * perDegree), Math.floor((lon + 180) * perDegree));
}

/**
 * Is the centre of this mercator square land? The squares of one level are
 * looked up again and again as a map fills in, so each row and column is
 * turned into the grid's once, for the level asked about.
 */
export function isLandTile(z, x, y) {
  const n = 2 ** z;
  if (z !== tileLevel) {
    const { perDegree } = LAND_GRID;
    gridRowOf = new Int32Array(n);
    gridColumnOf = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (i + 0.5)) / n))) * 180) / Math.PI;
      gridRowOf[i] = Math.floor((90 - lat) * perDegree);
      gridColumnOf[i] = Math.floor((((i + 0.5) / n) * 360) * perDegree);
    }
    tileLevel = z;
  }
  if (!(x >= 0 && x < n && y >= 0 && y < n)) return false;
  return landAtCell(gridRowOf[y], gridColumnOf[x]);
}

/** How much of the planet's surface the grid calls land, as a fraction of the whole. */
export function landShareOfPlanet() {
  grid();
  return landShare;
}

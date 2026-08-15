/**
 * Offline world generator.
 *
 * With no provider key and no network TerraGlide still has to be a place you
 * can fly around, so imagery and elevation both fall back to this: a seamless
 * fractal over the mercator square, shaded like a satellite photo. It is
 * invented terrain — it is never presented as a real location.
 */

const SEA_LEVEL = 0.505;
const MAX_ELEVATION = 7200;
const OCEAN_DEPTH = 5200;

function hash2(xi, yi) {
  let h = Math.imul(xi | 0, 374761393) ^ Math.imul(yi | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Value noise on a lattice that wraps every `period` cells in x. */
function vnoise(x, y, period) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const x0 = ((xi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const a = hash2(x0, yi);
  const b = hash2(x1, yi);
  const c = hash2(x0, yi + 1);
  const d = hash2(x1, yi + 1);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

const BASE_CELLS = 10;

function fbm(nx, ny, octaves, startFreq = 1, gain = 0.55) {
  let sum = 0;
  let amp = 1;
  let total = 0;
  let freq = startFreq;
  for (let o = 0; o < octaves; o++) {
    const cells = BASE_CELLS * freq;
    sum += vnoise(nx * cells, ny * cells, cells) * amp;
    total += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / total;
}

/**
 * Continent/ocean mask in [0,1].
 *
 * Plain fractal noise gives blobby islands that read as noise rather than as
 * geography, so the sample point is warped by a second, coarser noise field
 * first. That one trick is what bends coastlines into peninsulas and bays
 * instead of circles.
 */
function continentField(nx, ny) {
  const warpX = (fbm(nx + 0.37, ny + 0.11, 3) - 0.5) * 0.22;
  const warpY = (fbm(nx + 0.71, ny + 0.53, 3) - 0.5) * 0.22;
  return fbm(nx + warpX, ny + warpY, 5);
}

/**
 * Ridged fractal used for mountain chains. Warped as well, so ranges run in
 * long arcs the way real orogenic belts do rather than scattering as lumps.
 */
function ridgeField(nx, ny, octaves) {
  const warpX = (fbm(nx + 5.1, ny + 2.3, 2, 2) - 0.5) * 0.06;
  const warpY = (fbm(nx + 1.7, ny + 8.9, 2, 2) - 0.5) * 0.06;
  let sum = 0;
  let amp = 1;
  let total = 0;
  let freq = 4;
  for (let o = 0; o < octaves; o++) {
    const cells = BASE_CELLS * freq;
    const n = vnoise((nx + warpX) * cells, (ny + warpY) * cells, cells);
    const ridge = 1 - Math.abs(n * 2 - 1);
    sum += ridge * ridge * amp;
    total += amp;
    amp *= 0.52;
    freq *= 2;
  }
  return sum / total;
}

/** Fine detail added at close range so the ground is not glassy. */
function detailField(nx, ny, startOctave, octaves) {
  let sum = 0;
  let amp = 1;
  let total = 0;
  let freq = Math.pow(2, startOctave);
  for (let o = 0; o < octaves; o++) {
    const cells = BASE_CELLS * freq;
    sum += (vnoise(nx * cells, ny * cells, cells) - 0.5) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total > 0 ? sum / total : 0;
}

/**
 * Elevation in metres for a point in normalised mercator space.
 * `detail` (0-10) controls how many octaves of fine relief are added.
 */
export function proceduralElevation(nx, ny, detail = 6) {
  const wrappedX = nx - Math.floor(nx);
  const clampedY = Math.min(0.9999, Math.max(0.0001, ny));

  const continent = continentField(wrappedX, clampedY);
  const land = continent - SEA_LEVEL;

  if (land <= 0) {
    // Ocean floor: a shallow shelf near the coast, then a drop to the abyss.
    const depth = Math.min(1, -land / 0.35);
    const shelf = Math.pow(depth, 1.6);
    const relief = detailField(wrappedX, clampedY, 3, 3) * 220;
    return -shelf * OCEAN_DEPTH + relief * depth;
  }

  // A wide, gently rising coastal plain instead of a wall at the waterline.
  const shore = Math.pow(Math.min(1, land / 0.05), 1.4);
  const mountains = ridgeField(wrappedX, clampedY, Math.min(7, 3 + detail));
  const uplift = Math.pow(Math.min(1, land / 0.26), 1.5);
  const base = land * 700;
  const peaks = Math.pow(mountains, 2.4) * MAX_ELEVATION * uplift;

  // Valleys: subtract a smooth channel field so ranges are cut by drainage
  // rather than being solid domes.
  const valley = Math.abs(fbm(wrappedX, clampedY, 3, 6) - 0.5) * 2;
  const carve = (1 - Math.pow(valley, 0.6)) * 320 * uplift;

  const fine = detailField(wrappedX, clampedY, 6, Math.max(0, detail)) * (45 + 260 * uplift);

  return Math.max(0.5, (base + peaks - carve + fine) * shore);
}

/** Latitude (deg) from a normalised mercator y, for climate-driven colouring. */
function latFromNormY(ny) {
  return (2 * Math.atan(Math.exp((0.5 - ny) * 2 * Math.PI)) - Math.PI / 2) * (180 / Math.PI);
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const DEEP = [16, 38, 66];
const SHALLOW = [38, 86, 118];
const SAND = [178, 166, 132];
const GRASS = [86, 106, 66];
const FOREST = [56, 76, 52];
const ARID = [148, 124, 88];
const ROCK = [104, 100, 94];
const SNOW = [226, 228, 232];

/**
 * Paint one procedural imagery tile.
 * @returns {ImageData-like} {data: Uint8ClampedArray, width, height}
 */
export function proceduralImagery(tile, size = 128) {
  const n = Math.pow(2, tile.z);
  const data = new Uint8ClampedArray(size * size * 4);
  const detail = Math.max(0, Math.min(8, tile.z - 6));
  const step = 1 / (n * size);

  for (let py = 0; py < size; py++) {
    const ny = (tile.y + (py + 0.5) / size) / n;
    const lat = latFromNormY(ny);
    const warmth = Math.max(0, 1 - Math.abs(lat) / 62);
    const dryness = Math.max(0, 1 - Math.abs(Math.abs(lat) - 25) / 22);
    for (let px = 0; px < size; px++) {
      const nx = (tile.x + (px + 0.5) / size) / n;
      const h = proceduralElevation(nx, ny, detail);
      const hx = proceduralElevation(nx + step, ny, detail);
      const hy = proceduralElevation(nx, ny + step, detail);
      const metresPerStep = Math.max(1, 40075017 / (n * size));
      const slope = Math.min(1, Math.hypot(h - hx, h - hy) / metresPerStep);

      let colour;
      if (h < -140) colour = mix(DEEP, SHALLOW, Math.min(1, (h + 3200) / 3060));
      else if (h < 0) colour = mix(SHALLOW, SAND, Math.min(1, (h + 140) / 140));
      else if (h < 24) colour = mix(SAND, GRASS, h / 24);
      else {
        const green = mix(GRASS, FOREST, Math.min(1, warmth * 1.15));
        const vegetation = mix(green, ARID, dryness * 0.75);
        const treeLine = 1500 + 1900 * warmth;
        const snowLine = 2600 + 2400 * warmth;
        if (h < treeLine) colour = mix(vegetation, ROCK, Math.min(1, (h / treeLine) * 0.75 + slope * 0.5));
        else if (h < snowLine) colour = mix(ROCK, SNOW, (h - treeLine) / Math.max(1, snowLine - treeLine));
        else colour = mix(SNOW, ROCK, Math.min(0.55, slope));
      }

      // Break up the flat fill so the ground reads as photography, not paint.
      const grain = (hash2(tile.x * size + px, tile.y * size + py) - 0.5) * 18;
      const shade = 1 - slope * 0.35;
      const i = (py * size + px) * 4;
      data[i] = colour[0] * shade + grain;
      data[i + 1] = colour[1] * shade + grain;
      data[i + 2] = colour[2] * shade + grain;
      data[i + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

/** Elevation grid for a tile, used when no elevation provider is configured. */
export function proceduralHeights(tile, size = 65) {
  const n = Math.pow(2, tile.z);
  const out = new Float32Array(size * size);
  const detail = Math.max(0, Math.min(8, tile.z - 5));
  for (let py = 0; py < size; py++) {
    const ny = (tile.y + py / (size - 1)) / n;
    for (let px = 0; px < size; px++) {
      const nx = (tile.x + px / (size - 1)) / n;
      out[py * size + px] = proceduralElevation(nx, ny, detail);
    }
  }
  return out;
}

export const PROCEDURAL_SEA_LEVEL = 0;

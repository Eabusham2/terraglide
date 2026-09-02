import { isNoDataCard, makeCanvas } from './noData.js';
import { measureCanopy } from './canopy.js';
import { measureSharpness } from './sharpness.js';
import { decodeBingElevation, decodeGoogleElevation } from './elevationGrid.js';

/**
 * The actual tile work: fetching, decoding, unpacking elevation and stitching
 * panoramas.
 *
 * This lives apart from the worker wrapper because it has to run in two places.
 * Normally it runs inside a Web Worker. But a page opened straight from the file
 * system cannot start a worker at all, and some locked-down browsers refuse too,
 * so the same functions are driven on the main thread instead. Keeping the jobs
 * in one place means the two paths can never drift apart.
 */

const inflight = new Map();

export function cancelJob(jobKey) {
  const controller = inflight.get(jobKey);
  if (controller) {
    controller.abort();
    inflight.delete(jobKey);
  }
}

/**
 * Run one job.
 * @param {object} msg the request
 * @param {(response: object, transfer?: Transferable[]) => void} post reply channel
 */
export async function runJob(msg, post) {
  const channel = msg.channel;
  const jobKey = `${channel}:${msg.id}`;
  try {
    if (msg.kind === 'imagery') await handleImagery(msg, jobKey, post);
    else if (msg.kind === 'elevation') await handleElevation(msg, jobKey, post);
    else if (msg.kind === 'panoStitch') await handlePanoStitch(msg, jobKey, post);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      post({ ok: false, channel, id: msg.id, aborted: true, error: 'aborted' });
    } else {
      post({
        ok: false,
        channel,
        id: msg.id,
        // "This square has no picture" travels separately from "the request
        // failed", because only the second is evidence about how deep the
        // provider goes. See reviewDepth.
        noImageryHere: err?.noImageryHere === true,
        error: String(err && err.message ? err.message : err),
      });
    }
  } finally {
    inflight.delete(jobKey);
  }
}

async function fetchBitmap(jobKey, url) {
  const controller = new AbortController();
  inflight.set(jobKey, controller);
  const res = await fetch(url, { signal: controller.signal, mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // The bytes themselves come back, not just their count: a provider's
  // "nothing here" card is now identified by its content rather than guessed at
  // from how bland the picture looks. See isNoDataCard.
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const bitmap = await createImageBitmap(new Blob([bytes]));
  return { bitmap, bytes };
}

/** Same cancellation handling as fetchBitmap, for the JSON elevation services. */
async function fetchJson(jobKey, url) {
  const controller = new AbortController();
  inflight.set(jobKey, controller);
  const res = await fetch(url, { signal: controller.signal, mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function handleImagery(msg, jobKey, post) {
  // No URL used to mean "make one up". Nothing here makes anything up any
  // more, so a job without a URL is a caller bug and is reported as one.
  if (!msg.url) throw new Error('no imagery URL for this tile');
  const { bitmap, bytes } = await fetchBitmap(jobKey, msg.url);
  if (msg.checkBlank !== false && isNoDataCard(bytes)) {
    bitmap.close();
    // Reported as a failure so the streamer moves down its standby list. A
    // provider saying "not available" is exactly what standbys are for, and
    // Sentinel-2 behind it has cover everywhere.
    //
    // Tagged, because the two kinds of failure mean different things and were
    // being treated alike. A refused *connection* is evidence about the
    // provider; a card is evidence about this one square. See NO_IMAGERY_HERE
    // and reviewDepth.
    const err = new Error('provider has no imagery here');
    err.noImageryHere = true;
    throw err;
  }
  // How much detail this one actually carries, so the streamer can tell a real
  // level of resolution from the level above it resampled bigger — and stop
  // asking for levels that are only the latter. See sharpness.js.
  const sharpness = measureSharpness(bitmap, makeCanvas);
  // Whether the green in it is a canopy or a field, so woodland relief works
  // where nobody has drawn a wood. See canopy.js.
  const canopy = measureCanopy(bitmap, makeCanvas, msg.tile?.z ?? msg.z ?? 0);
  post({ ok: true, channel: msg.channel, id: msg.id, bitmap, sharpness, canopy }, [bitmap]);
}

async function handleElevation(msg, jobKey, post) {
  const size = msg.size || 65;
  let heights;

  if (!msg.url) {
    throw new Error('no elevation URL for this tile');
  } else if (msg.decode === 'bing-elevation') {
    heights = decodeBingElevation(await fetchJson(jobKey, msg.url), size);
  } else if (msg.decode === 'google-elevation') {
    heights = decodeGoogleElevation(await fetchJson(jobKey, msg.url), size);
  } else {
    const { bitmap } = await fetchBitmap(jobKey, msg.url);
    heights = decodeHeights(bitmap, msg.decode, size);
    bitmap.close();
  }

  post({ ok: true, channel: msg.channel, id: msg.id, heights, size }, [heights.buffer]);
}

/**
 * Street View hands out flat (rectilinear) photos, not spheres. Four 90-degree
 * faces at headings 0/90/180/270 tile the horizon exactly, so we re-project them
 * into one equirectangular strip that the panorama dome can sample directly.
 * Pixels outside the faces' vertical reach stay transparent and the dome fades
 * them into the real sky.
 */
async function handlePanoStitch(msg, jobKey, post) {
  const width = msg.width || 2048;
  const height = msg.height || 1024;
  const faces = [];
  for (const url of msg.urls) {
    const { bitmap } = await fetchBitmap(jobKey, url);
    const canvas = makeCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    faces.push({
      data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data,
      w: bitmap.width,
      h: bitmap.height,
    });
    bitmap.close();
  }

  const out = new Uint8ClampedArray(width * height * 4);
  const halfFov = Math.tan((((msg.fovDeg || 90) / 2) * Math.PI) / 180);
  const quarter = Math.PI / 2;

  for (let j = 0; j < height; j++) {
    const elevation = Math.PI / 2 - ((j + 0.5) / height) * Math.PI;
    const tanE = Math.tan(elevation);
    if (Math.abs(elevation) > 1.15) continue; // beyond the faces' reach
    for (let i = 0; i < width; i++) {
      const azimuth = ((i + 0.5) / width) * Math.PI * 2;
      const faceIndex = Math.floor(((azimuth + Math.PI / 4) % (Math.PI * 2)) / quarter) % 4;
      const face = faces[faceIndex];
      if (!face) continue;
      let da = azimuth - faceIndex * quarter;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;

      const u = Math.tan(da) / halfFov;
      const v = tanE / (Math.cos(da) * halfFov);
      if (u < -1 || u > 1 || v < -1 || v > 1) continue;

      const fx = (u * 0.5 + 0.5) * (face.w - 1);
      const fy = (0.5 - v * 0.5) * (face.h - 1);
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(face.w - 1, x0 + 1);
      const y1 = Math.min(face.h - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      const o = (j * width + i) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const a = face.data[(y0 * face.w + x0) * 4 + ch];
        const b = face.data[(y0 * face.w + x1) * 4 + ch];
        const c = face.data[(y1 * face.w + x0) * 4 + ch];
        const d = face.data[(y1 * face.w + x1) * 4 + ch];
        out[o + ch] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
      }
      out[o + 3] = 255;
    }
  }

  const bitmap = await createImageBitmap(new ImageData(out, width, height));
  post({ ok: true, channel: msg.channel, id: msg.id, bitmap }, [bitmap]);
}

/**
 * The largest step a single cell of real ground makes away from its
 * neighbours, in metres, before it is not ground.
 *
 * This number is measured, not chosen. Flying Ultra over Reykjavik the city
 * erupts in black needles hundreds of metres tall standing over a correct
 * photograph, and the cause is not ours: the provider's own tiles read -2 m at
 * zoom 10 and 913 m at zoom 11 in the same place, where Copernicus says 0. The
 * pipeline is faithful; what it is faithful to is wrong.
 *
 * A filter that edits real measurements would be worse than the fault, so the
 * bar was set by asking the steepest places on Earth how far a genuine cell
 * ever sits from the median of its four neighbours. Twenty-two locations, at
 * zoom 13 and 14 — worst deviation in metres:
 *
 *   Nanga Parbat Rupal face   24     Half Dome              79
 *   Mount Thor (1,250 m drop)  3     Cliffs of Moher        68
 *   Denali                     5     El Capitan            116
 *   Trollveggen               2      Everest, Khumbu       162
 *   Preikestolen              9      K2, Baltoro           199   <- the worst
 *   Zermatt, Lauterbrunnen   13      Grand Canyon           33
 *   Torres del Paine         38      Verdon Gorge           11
 *   Drakensberg              13      Angel Falls            57
 *
 * Not one cell of real terrain anywhere in that set exceeds 200 m. The broken
 * ones are nowhere near it: Reykjavik reaches 899 m with 310 cells past 200,
 * and two tiles — Colca and the Yarlung Tsangpo at zoom 14 — carry exactly 254
 * bad cells each, which is one whole row of a 256-wide tile.
 *
 * Two tests are needed, because the corruption comes in two shapes and each
 * test is blind to one of them.
 *
 * An absolute limit catches the huge ones. Measured on the eight-neighbour
 * deviation the filter actually uses, across those locations at zooms 12, 13
 * and 14, the worst genuine cell on Earth is K2 on the Baltoro at 331 m, and
 * nothing anywhere reaches 400. Broken tiles are far past it: Reykjavik 899,
 * Colca 7,092, the Yarlung Tsangpo 8,556. 500 m leaves half again the worst
 * real reading.
 *
 * A ratio catches the small ones an absolute limit has to let through. K2 is
 * allowed its 331 m because the ground around it is rugged — its neighbours
 * span hundreds of metres between themselves. Reykjavik's neighbours span
 * thirteen metres and one cell stands 140 m out of them, which is not a
 * hillside. Worst ratio in real terrain: 2.7, at the Cliffs of Moher. Reykjavik
 * reaches 10.5. Five sits between them with room on both sides.
 *
 * Neither test alone is enough, and it is worth writing down why, because the
 * ratio looked like the whole answer for a while: where corruption is
 * contiguous — Reykjavik's clusters at zoom 14, and the single bad row in the
 * Colca and Yarlung tiles — a spike's neighbours are spikes too, the spread
 * goes up with the deviation, and the ratio collapses to about 1. That is
 * exactly where the absolute limit does the work.
 *
 * What replaces a rejected cell is the median of its own real neighbours. That
 * is not inventing terrain — it is declining to believe one sample and using
 * the surveyed ground around it, which is what despiking a DEM has always
 * meant.
 */
const SPIKE_LIMIT_M = 500;
/** How far out of its neighbours' own spread a cell may stand. Real worst: 2.7. */
const SPIKE_RATIO = 5;
/** Below this, a disagreement is terrain, not a fault, and is left alone. */
const SPIKE_FLOOR_M = 60;

/**
 * Throw away cells no landscape could produce, in place.
 *
 * The ring is all eight neighbours, not the four orthogonal ones, and that is
 * not fussiness. Two of the three corruptions here are contiguous — Reykjavik's
 * needles come in clusters, and the Colca and Yarlung Tsangpo tiles each carry
 * one whole bad row — so with only four neighbours a bad cell is judged partly
 * by other bad cells and the median lands halfway between right and wrong.
 * Measured with four: Colca's worst went 3,583 -> 1,792 and Reykjavik's
 * 899 -> 444, each almost exactly halved rather than fixed. Eight neighbours
 * cannot be outvoted by a one-cell line: three above and three below are good.
 *
 * Passes repeat only while the last one found something, so genuine ground
 * costs exactly one pass that rejects nothing. The cap is there because a
 * filter that will not stop is a worse failure than the spikes.
 *
 * Only the interior: an edge cell has no ring to judge it by, and guessing at
 * one would be the invention this is trying to avoid.
 */
function despike(grid, w, h, limit = SPIKE_LIMIT_M) {
  let rejected = 0;
  const ring = new Float64Array(8);
  for (let pass = 0; pass < 4; pass++) {
    let thisPass = 0;
    // Read from a copy, so a rejected cell cannot become the evidence that
    // convicts its neighbour.
    const src = grid.slice();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        ring[0] = src[i - w - 1]; ring[1] = src[i - w]; ring[2] = src[i - w + 1];
        ring[3] = src[i - 1];                           ring[4] = src[i + 1];
        ring[5] = src[i + w - 1]; ring[6] = src[i + w]; ring[7] = src[i + w + 1];
        // Most of the world is gentle at fourteen metres a cell, and sorting
        // eight numbers to discover that is the bulk of the cost. If the whole
        // ring spans less than the floor and the cell sits inside that span,
        // the median is in there too, so the deviation cannot reach the floor
        // and nothing below can fire. Skipping is exact, not approximate.
        let lo = ring[0];
        let hi = ring[0];
        for (let a = 1; a < 8; a++) {
          const r = ring[a];
          if (r < lo) lo = r; else if (r > hi) hi = r;
        }
        const here = src[i];
        if (hi - lo <= SPIKE_FLOOR_M && here >= lo && here <= hi) continue;
        // Insertion sort: eight items, no allocation, faster here than sort().
        for (let a = 1; a < 8; a++) {
          const v = ring[a];
          let b = a - 1;
          while (b >= 0 && ring[b] > v) { ring[b + 1] = ring[b]; b--; }
          ring[b + 1] = v;
        }
        const median = (ring[3] + ring[4]) * 0.5;
        const deviation = Math.abs(here - median);
        if (deviation <= SPIKE_FLOOR_M) continue;
        // The ring's own spread, ignoring its extremes, which is how rugged the
        // ground here is allowed to be.
        const spread = ring[6] - ring[1];
        if (deviation > limit || deviation > SPIKE_RATIO * Math.max(spread, 1)) {
          grid[i] = median;
          thisPass++;
        }
      }
    }
    rejected += thisPass;
    if (thisPass === 0) break;
  }
  return rejected;
}

/** Unpack a terrain-RGB or Terrarium PNG into a square grid of metres. */
function decodeHeights(bitmap, decode, size) {
  const canvas = makeCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const src = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const w = bitmap.width;
  const h = bitmap.height;

  // At full resolution, because that is where the bar above was measured. The
  // grid handed back is a 65-square subsample, so neighbours in it are four
  // source cells apart and a limit calibrated on adjacent cells would mean
  // something different there.
  const full = new Float32Array(w * h);
  for (let i = 0, k = 0; i < full.length; i++, k += 4) {
    const r = src[k];
    const g = src[k + 1];
    const b = src[k + 2];
    full[i] = decode === 'terrarium'
      ? r * 256 + g + b / 256 - 32768
      : -10000 + (r * 65536 + g * 256 + b) * 0.1;
  }
  despike(full, w, h);

  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(h - 1, Math.round((y / (size - 1)) * (h - 1)));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(w - 1, Math.round((x / (size - 1)) * (w - 1)));
      out[y * size + x] = full[sy * w + sx];
    }
  }
  return out;
}

export { despike, SPIKE_LIMIT_M, SPIKE_RATIO, SPIKE_FLOOR_M };

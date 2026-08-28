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
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  // The byte count comes back too: it is the cheapest half of telling a
  // photograph from a provider's "nothing here" card. See looksLikeNoDataCard.
  return { bitmap, bytes: blob.size };
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
  if (msg.checkBlank !== false && isNoDataCard(bitmap, bytes)) {
    bitmap.close();
    // Reported as a failure so the streamer moves down its standby list. A
    // provider saying "not available" is exactly what standbys are for, and
    // Sentinel-2 behind it has cover everywhere.
    throw new Error('provider has no imagery here');
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

/** Unpack a terrain-RGB or Terrarium PNG into a square grid of metres. */
function decodeHeights(bitmap, decode, size) {
  const canvas = makeCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const src = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const w = bitmap.width;
  const h = bitmap.height;

  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(h - 1, Math.round((y / (size - 1)) * (h - 1)));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(w - 1, Math.round((x / (size - 1)) * (w - 1)));
      const i = (sy * w + sx) * 4;
      const r = src[i];
      const g = src[i + 1];
      const b = src[i + 2];
      out[y * size + x] =
        decode === 'terrarium'
          ? r * 256 + g + b / 256 - 32768
          : -10000 + (r * 65536 + g * 256 + b) * 0.1;
    }
  }
  return out;
}

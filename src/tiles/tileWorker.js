/**
 * Tile worker: every network fetch, image decode and elevation unpack happens
 * off the main thread, so streaming never stalls a frame.
 *
 * Every message carries a `channel` ('imagery' | 'elevation' | 'pano') which is
 * echoed back, because three different systems share this one worker and each
 * has to ignore the others' replies.
 *
 * Messages in:  {kind:'imagery'|'elevation'|'panoStitch', channel, id, ...}
 *               {kind:'cancel', channel, id}
 * Messages out: {ok, channel, id, bitmap|heights|error}
 */

import { proceduralHeights, proceduralImagery } from './procedural.js';

const inflight = new Map();

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg) return;

  const channel = msg.channel;

  const jobKey = `${channel}:${msg.id}`;

  if (msg.kind === 'cancel') {
    const controller = inflight.get(jobKey);
    if (controller) {
      controller.abort();
      inflight.delete(jobKey);
    }
    return;
  }

  try {
    if (msg.kind === 'imagery') await handleImagery(msg, jobKey);
    else if (msg.kind === 'elevation') await handleElevation(msg, jobKey);
    else if (msg.kind === 'panoStitch') await handlePanoStitch(msg, jobKey);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      self.postMessage({ ok: false, channel, id: msg.id, aborted: true, error: 'aborted' });
    } else {
      self.postMessage({
        ok: false,
        channel,
        id: msg.id,
        error: String(err && err.message ? err.message : err),
      });
    }
  } finally {
    inflight.delete(jobKey);
  }
};

async function fetchBitmap(jobKey, url) {
  const controller = new AbortController();
  inflight.set(jobKey, controller);
  const res = await fetch(url, { signal: controller.signal, mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

async function handleImagery(msg, jobKey) {
  let bitmap;
  if (!msg.url) {
    const image = proceduralImagery(msg.tile, msg.size || 128);
    bitmap = await createImageBitmap(new ImageData(image.data, image.width, image.height));
  } else {
    bitmap = await fetchBitmap(jobKey, msg.url);
  }
  self.postMessage({ ok: true, channel: msg.channel, id: msg.id, bitmap }, [bitmap]);
}

async function handleElevation(msg, jobKey) {
  const size = msg.size || 65;
  let heights;

  if (!msg.url) {
    heights = proceduralHeights(msg.tile, size);
  } else {
    const bitmap = await fetchBitmap(jobKey, msg.url);
    heights = decodeHeights(bitmap, msg.decode, size);
    bitmap.close();
  }

  self.postMessage({ ok: true, channel: msg.channel, id: msg.id, heights, size }, [heights.buffer]);
}

/**
 * Street View hands out flat (rectilinear) photos, not spheres. Four 90-degree
 * faces at headings 0/90/180/270 tile the horizon exactly, so we re-project them
 * into one equirectangular strip that the panorama dome can sample directly.
 * Pixels outside the faces' vertical reach stay transparent and the dome fades
 * them into the real sky.
 */
async function handlePanoStitch(msg, jobKey) {
  const width = msg.width || 2048;
  const height = msg.height || 1024;
  const faces = [];
  for (const url of msg.urls) {
    const bitmap = await fetchBitmap(jobKey, url);
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bitmap, 0, 0);
    faces.push({
      data: cx.getImageData(0, 0, bitmap.width, bitmap.height).data,
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
        const c2 = face.data[(y1 * face.w + x0) * 4 + ch];
        const d = face.data[(y1 * face.w + x1) * 4 + ch];
        out[o + ch] = (a + (b - a) * tx) * (1 - ty) + (c2 + (d - c2) * tx) * ty;
      }
      out[o + 3] = 255;
    }
  }

  const bitmap = await createImageBitmap(new ImageData(out, width, height));
  self.postMessage({ ok: true, channel: msg.channel, id: msg.id, bitmap }, [bitmap]);
}

/** Unpack a terrain-RGB or Terrarium PNG into a square grid of metres. */
function decodeHeights(bitmap, decode, size) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
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

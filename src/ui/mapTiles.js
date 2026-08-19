import { tileKey, wrapTileX } from '../geo/mercator.js';
import { proceduralImagery } from '../tiles/procedural.js';

/**
 * A small ImageBitmap cache for the 2D maps (minimap and world map).
 *
 * Deliberately separate from the 3D streamer: the maps want whole tiles at a
 * fixed zoom, the terrain wants a quadtree, and mixing the two made both worse.
 * Requests are capped and least-recently-used tiles are dropped so panning the
 * world map cannot run away with memory.
 */

const LIMIT = 260;
const MAX_ACTIVE = 6;

export class MapTileCache {
  constructor() {
    this.source = null;
    this.tiles = new Map();
    /** Decoded pixels, for colour sampling. */
    this.pixels = new Map();
    this.active = 0;
    this.queue = [];
    this.listeners = new Set();
    this.generation = 0;
    /** Mirrors the 3D streamer: draw generated tiles when a provider is down. */
    this.degraded = false;
  }

  /** Called whenever a tile finishes loading. Returns an unsubscribe function. */
  onTileLoaded(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) fn();
  }

  setDegraded(degraded) {
    if (this.degraded === degraded) return;
    this.degraded = degraded;
    for (const entry of this.tiles.values()) {
      if (entry.bitmap) entry.bitmap.close();
    }
    this.tiles.clear();
    this.pixels.clear();
    this.queue.length = 0;
    this.generation++;
  }

  setSource(source) {
    this.source = source;
    for (const entry of this.tiles.values()) {
      if (entry.bitmap) entry.bitmap.close();
    }
    this.tiles.clear();
    this.pixels.clear();
    this.queue.length = 0;
    this.generation++;
  }

  /** Bitmap for a tile, or null while it loads. */
  get(z, x, y) {
    const n = Math.pow(2, z);
    if (y < 0 || y >= n) return null;
    const wrapped = wrapTileX(x, z);
    const key = tileKey(z, wrapped, y);
    const entry = this.tiles.get(key);
    if (entry) {
      entry.used = performance.now();
      return entry.bitmap;
    }
    this.tiles.set(key, { key, bitmap: null, used: performance.now(), state: 'queued' });
    this.queue.push({ key, tile: { z, x: wrapped, y } });
    this.pump();
    return null;
  }

  /** Best available bitmap for a tile: itself or an ancestor, with a UV window. */
  resolve(z, x, y, maxSteps = 5) {
    let tz = z;
    let tx = wrapTileX(x, z);
    let ty = y;
    let scale = 1;
    let ox = 0;
    let oy = 0;
    for (let step = 0; step <= maxSteps && tz >= 0; step++) {
      const bitmap = step === 0 ? this.get(tz, tx, ty) : this.peek(tz, tx, ty);
      if (bitmap) return { bitmap, scale, ox, oy };
      ox = (ox + (tx & 1)) * 0.5;
      oy = (oy + (ty & 1)) * 0.5;
      scale *= 0.5;
      tx >>= 1;
      ty >>= 1;
      tz -= 1;
    }
    return null;
  }

  /**
   * Average colour of the imagery at a point, or null if that tile has not
   * arrived. Used to take scenery colour from the actual aerial photograph
   * rather than from a palette someone invented: a fir in a Norwegian spruce
   * plantation and one in a Californian chaparral are not the same green, and
   * the imagery already knows which is which.
   *
   * One tile is decoded to pixels at most once and kept, so this costs a canvas
   * draw per tile and an array read per lookup.
   */
  sampleColour(z, x, y, u, v) {
    const key = tileKey(z, wrapTileX(x, z), y);
    let pixels = this.pixels.get(key);
    if (pixels === undefined) {
      const bitmap = this.peek(z, wrapTileX(x, z), y);
      if (!bitmap) {
        // Ask for it; the caller can use a fallback until it lands.
        this.get(z, x, y);
        return null;
      }
      const size = 64; // plenty: this is a colour, not a texture
      const canvas =
        typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(size, size)
          : Object.assign(document.createElement('canvas'), { width: size, height: size });
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, size, size);
      pixels = { data: ctx.getImageData(0, 0, size, size).data, size };
      this.pixels.set(key, pixels);
      if (this.pixels.size > 220) {
        const oldest = this.pixels.keys().next().value;
        this.pixels.delete(oldest);
      }
    }

    const size = pixels.size;
    const px = Math.min(size - 1, Math.max(0, Math.floor(u * size)));
    const py = Math.min(size - 1, Math.max(0, Math.floor(v * size)));
    const index = (py * size + px) * 4;
    return {
      r: pixels.data[index] / 255,
      g: pixels.data[index + 1] / 255,
      b: pixels.data[index + 2] / 255,
    };
  }

  peek(z, x, y) {
    const entry = this.tiles.get(tileKey(z, wrapTileX(x, z), y));
    return entry ? entry.bitmap : null;
  }

  pump() {
    while (this.active < MAX_ACTIVE && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;
      this.load(job);
    }
    this.evict();
  }

  async load(job) {
    const entry = this.tiles.get(job.key);
    if (!entry) return;
    const generation = this.generation;
    this.active++;
    entry.state = 'loading';
    try {
      const url = this.source && !this.degraded ? this.source.urlFor(job.tile) : null;
      let bitmap;
      if (!url) {
        const image = proceduralImagery(job.tile, 128);
        bitmap = await createImageBitmap(new ImageData(image.data, image.width, image.height));
      } else {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(String(res.status));
        bitmap = await createImageBitmap(await res.blob());
      }
      if (generation !== this.generation) {
        bitmap.close();
        return;
      }
      entry.bitmap = bitmap;
      entry.state = 'ready';
      this.notify();
    } catch {
      entry.state = 'failed';
    } finally {
      this.active--;
      if (this.queue.length > 0) this.pump();
    }
  }

  evict() {
    if (this.tiles.size <= LIMIT) return;
    const sorted = [...this.tiles.values()].sort((a, b) => a.used - b.used);
    let excess = this.tiles.size - LIMIT;
    for (const entry of sorted) {
      if (excess <= 0) break;
      if (entry.state === 'loading') continue;
      if (entry.bitmap) entry.bitmap.close();
      this.tiles.delete(entry.key);
      this.pixels.delete(entry.key);
      excess--;
    }
  }
}

export const mapTiles = new MapTileCache();

/**
 * A second cache, holding the drawn street map.
 *
 * Ground you have not visited is shown as a *map* rather than a photograph,
 * and it used to get there by running the satellite tile through a greyscale
 * filter — which produced a washed-out photo, not a map. Roads, coastlines and
 * place names were exactly as unreadable as before, only paler.
 *
 * This fetches the real OpenStreetMap raster instead, so unexplored ground
 * reads the way a map is supposed to: named roads, rivers, borders. Keyless,
 * and only requested for tiles actually on screen and actually unexplored.
 */
export const streetTiles = new MapTileCache();

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
    this.queue.length = 0;
    this.generation++;
  }

  setSource(source) {
    this.source = source;
    for (const entry of this.tiles.values()) {
      if (entry.bitmap) entry.bitmap.close();
    }
    this.tiles.clear();
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
      excess--;
    }
  }
}

export const mapTiles = new MapTileCache();

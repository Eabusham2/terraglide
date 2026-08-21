import { tileKey, wrapTileX } from '../geo/mercator.js';
import { proceduralImagery } from '../tiles/procedural.js';
import { renderVectorTile } from './vectorMap.js';

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
/**
 * How long the queue may get before unurgent work stops being accepted.
 * Colour sampling asks once per building, so over a city it will ask for
 * thousands; none of them is worth remembering for the minute it would take
 * to reach them.
 */
const BACKLOG_LIMIT = 96;

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
    /**
     * Providers to try when the one before refuses.
     *
     * The keyless sources here are community and public endpoints with fair-use
     * policies, which means "busy" is a normal answer rather than a fault. A
     * map that goes blank because one server is having a moment is a map with
     * no fallback, and everything else in this project has one.
     */
    this.fallbacks = [];
    this.fallbackRescues = 0;
    this.usingFallback = false;
    /** Deepest zoom the current provider serves; see `resolve`. */
    this.maxZoom = Infinity;
  }

  /**
   * Providers to fall back to, tile by tile, in order of preference.
   * Takes one or a list.
   */
  setFallback(sources) {
    this.fallbacks = (Array.isArray(sources) ? sources : [sources]).filter(Boolean);
    this.fallbackRescues = 0;
    this.usingFallback = false;
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
    // Deeper than the provider serves is a 404, and a 404 here is a hole in
    // the map rather than a softer picture. `resolve` stops at this and
    // stretches the last real tile instead, which is what every map does when
    // you zoom past its data.
    this.maxZoom = source?.descriptor?.maxZoom ?? Infinity;
    this.fallbackRescues = 0;
    this.usingFallback = false;
    for (const entry of this.tiles.values()) {
      if (entry.bitmap) entry.bitmap.close();
    }
    this.tiles.clear();
    this.pixels.clear();
    this.queue.length = 0;
    this.generation++;
  }

  /**
   * Bitmap for a tile, or null while it loads.
   *
   * `urgent` is what the maps ask with and colour sampling does not, and the
   * difference matters more than it sounds. Both go through this one cache,
   * but a map wants eight tiles that a person is looking at, while sampling
   * the colour of a city's roofs wants one lookup per building and will
   * happily ask for thousands. First-come-first-served meant the minimap's
   * eight sat behind all of them and never arrived: over Manhattan it was
   * simply black, with nothing failing and the cache full of tiles nobody was
   * looking at. Urgent work goes first, and unurgent work is dropped rather
   * than queued once the backlog is silly — its callers all have something to
   * draw in the meantime and all ask again.
   */
  get(z, x, y, urgent = false) {
    const n = Math.pow(2, z);
    if (y < 0 || y >= n) return null;
    const wrapped = wrapTileX(x, z);
    const key = tileKey(z, wrapped, y);
    const entry = this.tiles.get(key);
    if (entry) {
      entry.used = performance.now();
      return entry.bitmap;
    }
    if (!urgent && this.queue.length >= BACKLOG_LIMIT) return null;
    this.tiles.set(key, { key, bitmap: null, used: performance.now(), state: 'queued' });
    this.queue.push({ key, tile: { z, x: wrapped, y }, urgent });
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
    // Walk up to the deepest level this provider actually has before asking
    // for anything, so an over-zoomed map stretches its last real tile rather
    // than requesting one that cannot exist. Costs nothing when it fits.
    const limit = this.maxZoom ?? Infinity;
    while (tz > limit) {
      ox = (ox + (tx & 1)) * 0.5;
      oy = (oy + (ty & 1)) * 0.5;
      scale *= 0.5;
      tx >>= 1;
      ty >>= 1;
      tz -= 1;
    }
    for (let step = 0; step <= maxSteps && tz >= 0; step++) {
      const bitmap = step === 0 ? this.get(tz, tx, ty, true) : this.peek(tz, tx, ty);
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
        // Ask for it, behind anything anyone is looking at; the caller has a
        // fallback tone to use until it lands, and asks again next time.
        this.get(z, x, y, false);
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
      // Whatever a person is actually looking at, before anything else.
      let index = this.queue.findIndex((job) => job.urgent);
      if (index < 0) index = 0;
      const job = this.queue.splice(index, 1)[0];
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
      // First choice, then the standbys, then invented ground. Once a standby
      // has rescued enough tiles, stop asking the first one at all: a server
      // that is refusing is not helped by being asked for every tile on screen.
      const chain =
        this.usingFallback && this.fallbacks.length > 0
          ? this.fallbacks
          : [this.source, ...this.fallbacks];
      const bitmap = await this.fetchTile(job.tile, chain);
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

  /**
   * One tile, from the first source that will give us one. Generated ground is
   * the last answer rather than an error, because a hole in the map is worse
   * than an approximation clearly labelled as one.
   */
  async fetchTile(tile, chain) {
    const invent = async () => {
      const image = proceduralImagery(tile, 128);
      return createImageBitmap(new ImageData(image.data, image.width, image.height));
    };
    if (this.degraded) return invent();

    let error = null;
    for (let i = 0; i < chain.length; i++) {
      const source = chain[i];
      if (!source) continue;
      if (source.prepare && !source.ready) await source.prepare();
      if (tile.z > (source.descriptor?.maxZoom ?? Infinity)) continue;
      const url = source.urlFor(tile);
      if (!url) {
        // No URL means one of two very different things. The generated world
        // has none by design and invented ground is the whole point of it. A
        // real provider with none has failed its handshake — no key, or a
        // metadata call that did not answer — and painting procedural noise
        // where a street map belongs is not a fallback, it is a lie with a
        // texture on it. Fall through to the next provider instead.
        if (source.descriptor?.kind === 'synthetic') return invent();
        error = error ?? new Error(`${source.descriptor?.id ?? 'provider'} not ready`);
        continue;
      }
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(String(res.status));
        // Vector tiles arrive as geometry rather than as a picture, so the
        // drawing happens here instead of at the far end of a wire.
        const bitmap =
          source.decode === 'vector'
            ? await renderVectorTile(await res.arrayBuffer(), tile.z)
            : await createImageBitmap(await res.blob());
        if (i > 0 && ++this.fallbackRescues >= 4) this.usingFallback = true;
        return bitmap;
      } catch (err) {
        error = err;
      }
    }
    if (error) throw error;
    return invent();
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

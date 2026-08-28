import { tileKey, wrapTileX } from '../geo/mercator.js';
import { isNoDataCard } from '../tiles/noData.js';
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
/**
 * Tile fetches in flight per cache.
 *
 * Six was the old browser limit on connections to one host, and it has not
 * applied since HTTP/2: the maps fetch over a multiplexed connection where the
 * browser decides the real concurrency. Watching the world map fill at zoom 12
 * over Vienna, this sat pinned at six the whole time while fifty-seven squares
 * queued behind it. There are two of these caches — the photograph and the
 * drawn map — so this is per layer.
 */
const MAX_ACTIVE = 14;
/**
 * How long the queue may get before unurgent work stops being accepted.
 * Colour sampling asks once per building, so over a city it will ask for
 * thousands; none of them is worth remembering for the minute it would take
 * to reach them.
 */
const BACKLOG_LIMIT = 96;

/**
 * How long a run of refusals has to happen in to count as a run.
 *
 * The old rule counted them for ever, so four spread across an hour of flying
 * read the same as four in a second. Ten seconds is short enough that only a
 * server actually falling over fills it.
 */
const REFUSAL_WINDOW_MS = 10000;
/** Refusals inside that window before the first choice is rested. */
const REFUSAL_TRIP = 6;
/** How long it is rested for before being tried again. */
const REFUSAL_REST_MS = 30000;

/**
 * An error meaning "this provider has nothing here", as opposed to "this
 * provider would not answer". Only the second is evidence about the server.
 */
function noCoverage(message) {
  const err = new Error(message);
  err.noCoverage = true;
  return err;
}

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
    /**
     * Mirrors the 3D streamer's own flag: the provider has been given up on.
     * Nothing is drawn in its place — the cached tiles are thrown away so the
     * map stops showing a world it can no longer refresh.
     */
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
    /**
     * When the first-choice provider last refused, newest last.
     *
     * Timestamps rather than a tally. It was a tally — four rescues by a
     * standby, ever, latched the map onto the standby for the rest of the
     * session with no way back. Four is nothing across an hour of flying, and
     * two of the ways to earn one are not the server's fault at all, so the
     * minimap reliably ended up on the drawn street map and stayed there. That
     * is "the minimap stops being satellite when I fly fast", and "it often
     * does not load satellite when I am high up": high up asks for coarse
     * squares, coarse squares reach the coast, and the coast is where Esri
     * answers with its "map data not yet available" card.
     */
    this.refusals = [];
    /** Wall clock until which the first choice is rested. See noteRefusal. */
    this.restingUntil = 0;
    /** Deepest zoom the current provider serves; see `resolve`. */
    this.maxZoom = Infinity;
    /**
     * How many levels a tile may be stretched up from before it is better to
     * draw nothing.
     *
     * Wide for photographs, because a stretched photograph is just a soft
     * photograph and always beats a hole. Narrow for a drawn street map,
     * because a drawn map is not scale-free: its labels and road casings are
     * drawn at the size they should be *at that zoom*, so stretching one four
     * levels writes the city's name across the whole city and turns residential
     * streets into motorways. Sitting next to a sharp tile it does not read as
     * "still loading", it reads as broken.
     */
    this.maxStretch = 24;
  }

  /**
   * Providers to fall back to, tile by tile, in order of preference.
   * Takes one or a list.
   */
  setFallback(sources) {
    this.fallbacks = (Array.isArray(sources) ? sources : [sources]).filter(Boolean);
    this.rest(0);
  }

  /** Called whenever a tile finishes loading. Returns an unsubscribe function. */
  onTileLoaded(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) fn();
  }

  /** True while the first choice is being rested and the standbys serve. */
  get resting() {
    return Date.now() < this.restingUntil;
  }

  /** Rest the first choice for this many milliseconds, and forget the past. */
  rest(ms) {
    this.restingUntil = ms > 0 ? Date.now() + ms : 0;
    this.refusals.length = 0;
  }

  /**
   * The first-choice provider refused a tile.
   *
   * Enough refusals close together and it is rested, because a server that is
   * refusing is not helped by being asked for every tile on screen. Then it is
   * tried again, because servers come back and the old rule had no way back:
   * once tripped it stayed tripped until the provider was changed by hand.
   *
   * A refusal is a transport failure — a timeout, a 429, a 500. It is not a
   * square the provider has never imaged, and it is not a zoom deeper than it
   * serves; those say nothing about whether the server is well, and counting
   * them meant flying over any coastline disqualified the imagery everywhere.
   */
  noteRefusal() {
    const now = Date.now();
    this.refusals.push(now);
    while (this.refusals.length > 0 && now - this.refusals[0] > REFUSAL_WINDOW_MS) {
      this.refusals.shift();
    }
    if (this.refusals.length >= REFUSAL_TRIP) this.rest(REFUSAL_REST_MS);
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
    this.rest(0);
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

  /**
   * Best available bitmap for a tile: itself or an ancestor, with a UV window.
   *
   * The walk goes all the way to the top. It used to stop after five steps,
   * which sounds generous and is not: the maps keep a whole-world overview
   * around zoom 6, and from zoom 12 — a city — that is six steps up. So the
   * one tile set guaranteed to be in the cache was exactly one level out of
   * reach, and a map opened over a city drew nothing at all until its own
   * tiles arrived: an empty grid with a compass on it. Stretching a coarse
   * tile is what every slippy map does while the sharp ones load, and it is
   * always better than a hole.
   */
  resolve(z, x, y, maxSteps = 24) {
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
    const steps = Math.min(maxSteps, this.maxStretch);
    for (let step = 0; step <= steps && tz >= 0; step++) {
      const bitmap = step === 0 ? this.get(tz, tx, ty, true) : this.peek(tz, tx, ty);
      if (bitmap) return { bitmap, scale, ox, oy };
      ox = (ox + (tx & 1)) * 0.5;
      oy = (oy + (ty & 1)) * 0.5;
      scale *= 0.5;
      tx >>= 1;
      ty >>= 1;
      tz -= 1;
    }
    // Nothing at any level. Ask for something coarse and wide as well as the
    // sharp tile: one tile four levels up covers this one and two hundred and
    // fifty-five of its neighbours, so it turns the whole view from a hole
    // into a soft picture in a single round trip.
    if (z > 4) this.get(z - 4, x >> 4, y >> 4, false);
    return null;
  }

  /**
   * The cached squares *inside* a tile, when the tile itself is missing.
   *
   * `resolve` only ever walks up, which is the right move when you zoom in:
   * the coarser square is in the cache and stretching it is what every slippy
   * map does. Zooming out is the mirror image and had no answer at all — the
   * coarse square has not been fetched yet and the finer ones you were just
   * looking at are sitting in the cache, unusable, because nothing looked
   * down. So the map painted blank paper over everything, and blank paper for
   * the street layer is near-white. That is "the map is white when I zoom" and
   * "the map is white, especially when going up" — going up zooms the minimap
   * out.
   *
   * Returns whatever it finds as unit-square placements, so a partly-covered
   * tile draws the parts it has instead of nothing.
   *
   * @returns {Array<{bitmap: ImageBitmap, x: number, y: number, size: number}>}
   */
  descend(z, x, y, depth = 2, out = []) {
    if (depth <= 0) return out;
    const span = 1 / 2 ** depth;
    const steps = 2 ** depth;
    const bx = x * steps;
    const by = y * steps;
    for (let j = 0; j < steps; j++) {
      for (let i = 0; i < steps; i++) {
        const bitmap = this.peek(z + depth, wrapTileX(bx + i, z + depth), by + j);
        if (bitmap) out.push({ bitmap, x: i * span, y: j * span, size: span });
      }
    }
    // Nothing at this depth: the squares may be coarser than that but still
    // finer than the one being asked for.
    if (out.length === 0 && depth > 1) return this.descend(z, x, y, depth - 1, out);
    return out;
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
      // First choice, then the standbys. Once a standby has rescued enough
      // tiles, stop asking the first one at all: a server that is refusing is
      // not helped by being asked for every tile on screen.
      const chain =
        this.resting && this.fallbacks.length > 0
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
   * One tile, from the first source that will give us one.
   *
   * If none of them will, the tile stays empty. That is the whole policy now:
   * there is no generator behind this to paint noise where a street map
   * belongs, so a square nobody has mapped is drawn as a square nobody has
   * mapped rather than as somewhere that does not exist.
   */
  async fetchTile(tile, chain) {
    let error = null;
    for (let i = 0; i < chain.length; i++) {
      const source = chain[i];
      if (!source) continue;
      if (source.prepare && !source.ready) await source.prepare();
      if (tile.z > (source.descriptor?.maxZoom ?? Infinity)) continue;
      const url = source.urlFor(tile);
      if (!url) {
        // A provider with no URL has failed its handshake — no key, or a
        // metadata call that did not answer. Fall through to the next one.
        error = error ?? noCoverage(`${source.descriptor?.id ?? 'provider'} not ready`);
        continue;
      }
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(String(res.status));
        // Vector tiles arrive as geometry rather than as a picture, so the
        // drawing happens here instead of at the far end of a wire.
        let bitmap;
        if (source.decode === 'vector') {
          bitmap = await renderVectorTile(await res.arrayBuffer(), tile.z);
        } else {
          const blob = await res.blob();
          bitmap = await createImageBitmap(blob);
          // Esri answers ground it has never imaged with a picture of the
          // words "Map data not yet available" and an HTTP 200. That is the
          // grey lettered rectangle across the map, and it is why the next
          // provider was never asked: as far as everything else was concerned
          // the tile arrived perfectly.
          if (isNoDataCard(bitmap, blob.size)) {
            bitmap.close();
            throw noCoverage('no imagery here');
          }
        }
        if (i === 0) this.rest(0);
        return bitmap;
      } catch (err) {
        // Only the first choice is on trial, and only for refusing. A square
        // it has never imaged is not a server having a moment.
        if (i === 0 && !err?.noCoverage) this.noteRefusal();
        error = err;
      }
    }
    throw error ?? new Error('no provider could serve this tile');
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
 * The drawn street map the maps show for ground you have not seen.
 *
 * A second cache rather than a second mode on the first: the two layers are
 * different providers at different depths, both are wanted on screen at once,
 * and sharing one cache would have each layer evicting the other's tiles every
 * time the map moved.
 */
export const streetTiles = new MapTileCache();

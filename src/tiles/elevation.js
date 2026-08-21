import { bilinear, clamp } from '../core/math.js';
import { latToNormY, lonToNormX, tileKey, wrapTileX } from '../geo/mercator.js';

/**
 * Elevation field.
 *
 * Height tiles are a separate, much shallower pyramid than imagery (real DEM
 * tiles stop around zoom 14-15), so the terrain mesh never asks for "the height
 * tile matching this imagery tile" — it just samples this field at a point and
 * gets the best data currently in memory, falling back through parents to
 * generated relief. That keeps ground collision and mesh building identical and
 * stops the player sinking into a tile that has not landed yet.
 */

const GRID = 65;
const STATE_PENDING = 1;
const STATE_READY = 2;
const STATE_FAILED = 3;

export class ElevationField {
  constructor(worker) {
    this.worker = worker;
    this.source = null;
    this.tiles = new Map();
    this.jobs = new Map();
    this.nextId = 1;
    this.active = 0;
    this.maxActive = 4;
    this.queue = [];
    this.cacheLimit = 320;
    this.frame = 0;
    this.ready = false;
    this.loaded = 0;
    this.failed = 0;

    this.worker.addEventListener('message', (event) => this.onMessage(event.data));
  }

  setSource(source) {
    this.source = source;
    this.tiles.clear();
    this.queue.length = 0;
  }

  get maxZoom() {
    return this.source ? Math.min(this.source.maxZoom, 15) : 12;
  }

  /**
   * Is there real elevation data here yet?
   *
   * Worth being able to ask, because "no data" reads back as exactly sea level
   * — and anything that treats sea level as *sea* will then quietly refuse to
   * do its job over ground that simply has not streamed in yet.
   */
  hasDataAt(nx, ny) {
    if (this.source && this.source.synthetic) return true;
    const x = nx - Math.floor(nx);
    const y = clamp(ny, 0, 0.999999);
    for (let z = this.maxZoom; z >= 3; z--) {
      const n = Math.pow(2, z);
      const entry = this.tiles.get(tileKey(z, Math.floor(x * n), Math.floor(y * n)));
      if (entry && entry.state === STATE_READY) return true;
    }
    return false;
  }

  /**
   * The finest zoom with real data at this point, or -1 for none.
   *
   * What it is for: a terrain mesh built from a zoom-6 elevation tile is a
   * plateau — one height across a whole square kilometre — and when the zoom-14
   * tile for the same ground arrives the mesh is simply wrong, not merely
   * coarse. Comparing the zoom a mesh was built from against the zoom available
   * now says exactly when it is worth rebuilding, without rebuilding everything
   * every time any tile anywhere lands.
   */
  zoomAt(nx, ny) {
    const x = nx - Math.floor(nx);
    const y = clamp(ny, 0, 0.999999);
    for (let z = this.maxZoom; z >= 3; z--) {
      const n = Math.pow(2, z);
      const entry = this.tiles.get(tileKey(z, Math.floor(x * n), Math.floor(y * n)));
      if (entry && entry.state === STATE_READY) return z;
    }
    return -1;
  }

  /** Height in metres at a normalised mercator point. */
  sampleNorm(nx, ny) {
    const x = nx - Math.floor(nx);
    const y = clamp(ny, 0, 0.999999);

    for (let z = this.maxZoom; z >= 3; z--) {
      const n = Math.pow(2, z);
      const tx = Math.floor(x * n);
      const ty = Math.floor(y * n);
      const entry = this.tiles.get(tileKey(z, tx, ty));
      if (entry && entry.state === STATE_READY) {
        entry.used = this.frame;
        const fx = (x * n - tx) * (GRID - 1);
        const fy = (y * n - ty) * (GRID - 1);
        return bilinear(entry.heights, GRID, GRID, fx, fy);
      }
    }
    // Nothing loaded here yet, and nothing to be done about it. There is no
    // generator behind this any more: an unmeasured square reads as sea level
    // and `hasDataAt` says so, and the things that stand on the ground wait
    // for the real relief rather than being founded on an invention.
    return 0;
  }

  sampleLatLon(lat, lon) {
    return this.sampleNorm(lonToNormX(lon), latToNormY(lat));
  }

  /** True when a real (non-generated) sample exists for this point. */
  hasData(nx, ny) {
    const x = nx - Math.floor(nx);
    const y = clamp(ny, 0, 0.999999);
    for (let z = this.maxZoom; z >= 3; z--) {
      const n = Math.pow(2, z);
      const entry = this.tiles.get(tileKey(z, Math.floor(x * n), Math.floor(y * n)));
      if (entry && entry.state === STATE_READY) return true;
    }
    return false;
  }

  beginFrame() {
    this.frame++;
  }

  /**
   * Make sure the height tiles around a point are loading. `zoom` follows the
   * camera: high in the air a coarse tile is plenty, on foot we want the
   * sharpest DEM available.
   */
  ensureAround(nx, ny, zoom, radius = 1) {
    const z = clamp(Math.round(zoom), 3, this.maxZoom);
    const n = Math.pow(2, z);
    const cx = Math.floor((nx - Math.floor(nx)) * n);
    const cy = Math.floor(clamp(ny, 0, 0.999999) * n);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const ty = cy + dy;
        if (ty < 0 || ty >= n) continue;
        this.request({ z, x: wrapTileX(cx + dx, z), y: ty }, Math.abs(dx) + Math.abs(dy));
      }
    }
    this.pump();
  }

  request(tile, priority) {
    const key = tileKey(tile.z, tile.x, tile.y);
    let entry = this.tiles.get(key);
    if (!entry) {
      entry = { key, tile, state: 0, heights: null, used: this.frame, priority };
      this.tiles.set(key, entry);
    }
    entry.used = this.frame;
    if (entry.state === 0 || (entry.state === STATE_FAILED && entry.retryAt < performance.now())) {
      entry.priority = priority;
      if (!this.queue.includes(entry)) this.queue.push(entry);
    }
  }

  pump() {
    if (!this.source) return;
    if (!this.source.ready && !this.source.synthetic) {
      this.source.prepare();
      return;
    }
    this.queue.sort((a, b) => a.priority - b.priority);
    while (this.active < this.maxActive && this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry || entry.state === STATE_PENDING || entry.state === STATE_READY) continue;
      const url = this.source.urlFor(entry.tile);
      if (url === null && !this.source.synthetic) continue;
      const id = this.nextId++;
      entry.state = STATE_PENDING;
      this.jobs.set(id, entry);
      this.active++;
      this.worker.postMessage({
        kind: 'elevation',
        channel: 'elevation',
        id,
        tile: entry.tile,
        url,
        decode: this.source.decode,
        size: GRID,
      });
    }
    this.evict();
  }

  onMessage(msg) {
    if (!msg || msg.channel !== 'elevation' || msg.id === undefined) return;
    const entry = this.jobs.get(msg.id);
    if (!entry) return;
    this.jobs.delete(msg.id);
    this.active = Math.max(0, this.active - 1);

    if (!msg.ok || !msg.heights) {
      entry.state = STATE_FAILED;
      entry.retryAt = performance.now() + 20000;
      const wasInvented = this.invented;
      this.failed++;
      // Crossing into "given up" changes what every sample returns, so the
      // terrain has to be told its meshes are stale.
      if (!wasInvented && this.invented) this.version = (this.version ?? 0) + 1;
      return;
    }
    entry.heights = msg.heights;
    entry.state = STATE_READY;
    this.loaded++;
    this.ready = true;
    this.version = (this.version ?? 0) + 1;
  }

  /** True when a real provider is selected but nothing has ever arrived. */
  get unreachable() {
    return Boolean(this.source && !this.source.synthetic && this.loaded === 0 && this.failed >= 6);
  }

  /**
   * Is the relief being made up rather than measured?
   *
   * True for the generated world, and true once a real provider has been given
   * up on. The imagery streamer reads this to decide whether it may invent
   * tiles: invented ground may wear invented paint, measured ground may not.
   */
  get invented() {
    return !this.source || this.unreachable;
  }

  /**
   * Is there relief to read at all — measured or invented?
   *
   * False only in the gap where a real provider has been asked and has not yet
   * answered or failed enough times to be given up on. In that gap every
   * sample is exactly sea level, and anything that reasons about height or
   * slope is reasoning about a flat plate.
   */
  get hasRelief() {
    return this.invented || this.loaded > 0;
  }

  evict() {
    if (this.tiles.size <= this.cacheLimit) return;
    const sorted = [...this.tiles.values()].sort((a, b) => a.used - b.used);
    let excess = this.tiles.size - this.cacheLimit;
    for (const entry of sorted) {
      if (excess <= 0) break;
      if (entry.state === STATE_PENDING || entry.used >= this.frame - 2) continue;
      this.tiles.delete(entry.key);
      excess--;
    }
  }
}

import { bilinear, clamp } from '../core/math.js';
import { latToNormY, lonToNormX, tileKey, wrapTileX } from '../geo/mercator.js';

/**
 * Elevation field.
 *
 * Height tiles are a separate, much shallower pyramid than imagery (real DEM
 * tiles stop around zoom 14-15), so the terrain mesh never asks for "the height
 * tile matching this imagery tile" — it just samples this field at a point and
 * gets the best data currently in memory, falling back through parents and, in
 * the end, to sea level. That keeps ground collision and mesh building identical
 * and stops the player sinking into a tile that has not landed yet.
 */

const GRID = 65;
/**
 * How much of an elevation tile's width the fade into coarser data occupies,
 * on a side with no finer neighbour. At zoom 15 a tile is a bit over a
 * kilometre, so this is a ramp of a couple of hundred metres — long enough
 * that it reads as ground rather than as a ridge.
 */
const EDGE_BAND = 0.15;

/**
 * The coarsest level the blanket reaches down to. One zoom-6 tile is six
 * hundred kilometres across — far wider than anything ever drawn — so it is
 * the cheapest possible guarantee that no square of ground reads as sea level
 * merely because its own DEM tile has not arrived.
 */
const BLANKET_FLOOR = 6;
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
    /** Set when something is queued, so pump only re-sorts when it must. */
    this.queueDirty = false;
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
  hasDataAt(nx, ny, topZoom = this.maxZoom) {
    const x = nx - Math.floor(nx);
    const y = clamp(ny, 0, 0.999999);
    for (let z = Math.min(topZoom, this.maxZoom); z >= 3; z--) {
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
    return this.sampleFrom(this.maxZoom, nx - Math.floor(nx), clamp(ny, 0, 0.999999));
  }

  /**
   * The same height, but from data no finer than `topZoom`.
   *
   * For questions where a kilometre either way does not matter — "is this the
   * sea?" over a hundred-kilometre disc, tens of thousands of times — and the
   * walk down from zoom fifteen would be most of the cost.
   */
  sampleCoarse(nx, ny, topZoom) {
    return this.sampleFrom(
      Math.min(topZoom, this.maxZoom),
      nx - Math.floor(nx),
      clamp(ny, 0, 0.999999),
    );
  }

  /**
   * Height from the finest data at or below `topZoom`, faded into the coarser
   * data along any edge where the finer tile has no neighbour.
   *
   * Taking the finest available tile and stopping there makes the height field
   * *discontinuous*. Ground covered by a zoom-15 tile reads one height; the
   * ground the far side of that tile's border, where only zoom-12 has landed,
   * reads another — and the two can differ by tens of metres. The result is
   * exactly what it sounds like: axis-aligned rectangular slabs standing
   * proud of the land around them, with vertical faces, in the shape of the
   * elevation tile grid. Flat country makes them obvious; hills hide them
   * until you look along a ridge and see it cut into steps.
   *
   * Nothing was wrong with the data. What was wrong was reading two different
   * resolutions of it either side of a line and pretending the answer was
   * continuous. So the fine value is now faded back into the coarse one across
   * the outer strip of the tile, but only on sides that actually have no finer
   * neighbour — everywhere else the full detail stands. At the border itself
   * the weight is zero, which is the coarse value, which is exactly what the
   * ground on the other side reads. The seam closes.
   */
  sampleFrom(topZoom, x, y) {
    for (let z = topZoom; z >= 3; z--) {
      const n = Math.pow(2, z);
      const tx = Math.floor(x * n);
      const ty = Math.floor(y * n);
      const entry = this.tiles.get(tileKey(z, tx, ty));
      if (!entry || entry.state !== STATE_READY) continue;
      entry.used = this.frame;
      const u = x * n - tx;
      const v = y * n - ty;
      const height = bilinear(entry.heights, GRID, GRID, u * (GRID - 1), v * (GRID - 1));
      if (z === 3) return height;
      const weight = this.edgeWeight(z, tx, ty, u, v);
      if (weight >= 1) return height;
      const coarse = this.sampleFrom(z - 1, x, y);
      return coarse + (height - coarse) * weight;
    }
    // Nothing loaded here yet, and nothing to be done about it. There is no
    // generator behind this any more: an unmeasured square reads as sea level
    // and `hasDataAt` says so, and the things that stand on the ground wait
    // for the real relief rather than being founded on an invention.
    return 0;
  }

  /**
   * How much of this tile's own detail to trust at a point inside it: 1 in the
   * middle and anywhere with a neighbour, easing to 0 at a border with none.
   */
  edgeWeight(z, tx, ty, u, v) {
    let w = 1;
    if (u < EDGE_BAND) {
      if (!this.readyAt(z, tx - 1, ty)) w = Math.min(w, u / EDGE_BAND);
    } else if (u > 1 - EDGE_BAND) {
      if (!this.readyAt(z, tx + 1, ty)) w = Math.min(w, (1 - u) / EDGE_BAND);
    }
    if (v < EDGE_BAND) {
      if (!this.readyAt(z, tx, ty - 1)) w = Math.min(w, v / EDGE_BAND);
    } else if (v > 1 - EDGE_BAND) {
      if (!this.readyAt(z, tx, ty + 1)) w = Math.min(w, (1 - v) / EDGE_BAND);
    }
    if (w >= 1) return 1;
    if (w <= 0) return 0;
    // Smoothstep, so the join has no crease in it either.
    return w * w * (3 - 2 * w);
  }

  readyAt(z, tx, ty) {
    const n = Math.pow(2, z);
    if (ty < 0 || ty >= n) return false;
    const entry = this.tiles.get(tileKey(z, ((tx % n) + n) % n, ty));
    return Boolean(entry && entry.state === STATE_READY);
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
    // Housekeeping, once a frame.
    //
    // This used to live at the end of `pump`, which was fine while pump only
    // ran once a frame. It does not any more — a completing request pumps too,
    // so eviction would have run several times a frame, each time copying the
    // whole tile map into an array and sorting it. Per frame is what it always
    // meant; the call has just moved to somewhere that says so.
    this.evict();
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
    this.ensureBlanket(nx, ny, z);
    this.pump();
  }

  /**
   * A coarse blanket under the sharp tiles.
   *
   * Every drawn square asked for the DEM tile that matched its own zoom and
   * nothing else, so until that particular tile arrived the ground there read
   * as exactly sea level — and sea level next to real relief is a flat plate
   * with a cliff around it. Over a city a quarter of the drawn tiles could be
   * plates at once, which is the terracing: rectangles at the wrong height,
   * in the shape of the tile grid, appearing and disappearing as the sharp
   * tiles landed one at a time.
   *
   * A handful of coarse tiles fixes it outright. Nine at zoom 12 already cover
   * further than the ground is ever drawn, and they are the same size on the
   * wire as any other tile. They are asked for at a better priority than any
   * leaf, because one of them stops a whole region being wrong while a leaf
   * only sharpens a field that is already about right.
   */
  ensureBlanket(nx, ny, zoom) {
    for (let z = Math.min(zoom, this.maxZoom) - 2; z >= BLANKET_FLOOR; z -= 2) {
      const n = Math.pow(2, z);
      const cx = Math.floor((nx - Math.floor(nx)) * n);
      const cy = Math.floor(clamp(ny, 0, 0.999999) * n);
      for (let dy = -1; dy <= 1; dy++) {
        const ty = cy + dy;
        if (ty < 0 || ty >= n) continue;
        for (let dx = -1; dx <= 1; dx++) {
          this.request({ z, x: wrapTileX(cx + dx, z), y: ty }, z - this.maxZoom - 1);
        }
      }
    }
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
      if (!this.queue.includes(entry)) {
        this.queue.push(entry);
        this.queueDirty = true;
      }
    }
  }

  pump() {
    if (!this.source) return;
    if (!this.source.ready) {
      this.source.prepare();
      return;
    }
    // Only when something has been added since the last pump — a completion
    // pumps too now, and re-sorting a seventy-deep queue on every one of them
    // would be work for nothing.
    if (this.queueDirty) {
      this.queue.sort((a, b) => a.priority - b.priority);
      this.queueDirty = false;
    }
    while (this.active < this.maxActive && this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry || entry.state === STATE_PENDING || entry.state === STATE_READY) continue;
      const url = this.source.urlFor(entry.tile);
      if (url === null) continue;
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
  }

  /**
   * A tile finished, so deal with it and then fill the slot it freed.
   *
   * The same starvation the imagery queue had, in the same shape: `pump` ran
   * from one place — `ensureAround`, off the terrain's walk, once a frame —
   * and a completing request freed its slot without refilling it. Measured in
   * flight: a mean of 0.25 requests in the air against a cap of four, six per
   * cent of its own allowance, while the queue averaged ten tiles and peaked
   * at seventy-four.
   *
   * It matters more here than for imagery. Until a square's DEM tile arrives
   * the ground under it reads as sea level, and when it lands the surface walks
   * to its real height over a third of a second — which is what B1, B2 and B4
   * are all about. Slower elevation is not a blurrier picture, it is longer
   * spent standing on ground that is not there yet.
   */
  onMessage(msg) {
    this.receive(msg);
    this.pump();
  }

  receive(msg) {
    if (!msg || msg.channel !== 'elevation' || msg.id === undefined) return;
    const entry = this.jobs.get(msg.id);
    if (!entry) return;
    this.jobs.delete(msg.id);
    this.active = Math.max(0, this.active - 1);

    if (!msg.ok || !msg.heights) {
      entry.state = STATE_FAILED;
      entry.retryAt = performance.now() + 20000;
      const hadHope = !this.givenUp;
      this.failed++;
      // Crossing into "given up" changes what every sample returns, so the
      // terrain has to be told its meshes are stale.
      if (hadHope && this.givenUp) this.version = (this.version ?? 0) + 1;
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
    return Boolean(this.source && this.loaded === 0 && this.failed >= 6);
  }

  /**
   * Have we stopped expecting elevation to arrive?
   *
   * True with no provider at all, and true once the chosen one has failed
   * enough times to be given up on. Either way every sample from here on is
   * exactly sea level: there is no invented relief to fall back to any more,
   * and a flat plate is the honest answer to "how high is the ground" when
   * nobody has measured it for us.
   */
  get givenUp() {
    return !this.source || this.unreachable;
  }

  /**
   * Is the height field settled — either data has arrived, or we have stopped
   * waiting for it?
   *
   * False only in the gap where a real provider has been asked and has not yet
   * answered or failed enough times to be given up on. Worth telling apart
   * from the flat plate that follows, because in the gap the flatness is
   * temporary and anything that reasons about slope should hold off.
   */
  get hasRelief() {
    return this.givenUp || this.loaded > 0;
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

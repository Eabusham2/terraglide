import * as THREE from '../../vendor/three/three.module.js';
import { Emitter } from '../core/events.js';
import { settings } from '../core/settings.js';
import { tileKey, wrapTileX } from '../geo/mercator.js';
import { SHARPNESS_FLOOR, SHARPNESS_FROM_ZOOM, SHARPNESS_RATIO } from './sharpness.js';

/**
 * How many frames a tile stays safe from eviction after it was last drawn.
 * About four seconds at 60 fps — long enough to cover turning round.
 */
/**
 * At and below this zoom a tile is cover rather than detail: it is what
 * everything beneath it stretches when its own photograph has not arrived.
 */
const COVER_ZOOM = 9;
/** How many cover tiles to keep. One at zoom nine is about 100 km across. */
const COVER_BUDGET = 160;

const KEEP_FRAMES = 240;

/**
 * Imagery streamer: a priority queue in front of the tile worker, plus an LRU
 * of GPU textures.
 *
 * Two things keep this smooth. Requests are re-prioritised every frame from
 * whatever the terrain actually wants *now* (so a fast flight cancels the tiles
 * it flew past instead of queueing behind them), and a tile that has not
 * arrived yet borrows its parent's texture with a UV window, so there is never
 * a blank hole in the ground.
 */

const STATE_PENDING = 1;
const STATE_READY = 2;
const STATE_FAILED = 3;
/**
 * Nothing to fetch here. The tile stays bare and the terrain shader colours it
 * from the elevation it is standing on, which is a statement about relief
 * rather than a picture of somewhere that does not exist.
 */
const STATE_BARE = 4;

export class ImageryStreamer extends Emitter {
  constructor(worker, renderer) {
    super();
    this.worker = worker;
    this.renderer = renderer;
    this.source = null;
    this.entries = new Map();
    this.queue = [];
    this.active = 0;
    this.nextId = 1;
    this.jobs = new Map();
    this.frame = 0;
    this.stats = { loaded: 0, pending: 0, failed: 0, bytes: 0 };
    this.tileSizeHint = 256;
    this.consecutiveFailures = 0;
    /** Set when a provider is unreachable. */
    this.degraded = false;
    /**
     * What each zoom level has actually done for us: how many tiles arrived,
     * and how many were refused. A provider's published maximum zoom is a
     * promise about the deepest tile that *can* exist, not about the ground
     * you happen to be over, and asking past what it will serve turns into a
     * stream of 404s — which is how the minimap ended up showing imagery for
     * ground the world said it had none for. See `reviewDepth`.
     */
    this.byZoom = new Map();
    this.depthLimit = Infinity;
    /**
     * Squares every provider has said it has no photograph of.
     *
     * Coverage is not a single depth. Esri serves zoom 19 over a town and stops
     * at 17 over a glacier a valley away, so writing off a whole zoom level is
     * wrong — but writing off *this square* is not, and neither is writing off
     * everything inside it. Measured over the Bernese Alps, a third of the
     * zoom-18 and two thirds of the zoom-19 requests come back "no imagery
     * here" or 404, and every one of them is retried every twenty seconds
     * forever. Remembering the answer turns that into asking once.
     */
    this.barren = new Set();
    /**
     * Per-tile detail, and the squares where descending stops buying any.
     *
     * One published maximum zoom per provider cannot be right — Esri guarantee
     * nineteen everywhere, serve twenty-one over Vienna and have not flown
     * twenty over the Jungfrau — so the depth is measured instead of declared.
     * See sharpness.js for the numbers behind it.
     */
    this.sharpness = new Map();
    this.finest = new Set();
    this.worker.addEventListener('message', (event) => this.onWorkerMessage(event.data));
  }

  setSource(source) {
    this.source = source;
    this.standbys = [];
    this.clear();
  }

  /**
   * Providers to fall through to when the chosen one will not answer.
   *
   * The ground used to have exactly one source and no plan B: a provider that
   * refused left the world bare, and before that it left the world invented.
   * Now a tile that fails moves down the list — keyed providers first, then
   * free ones — and only a tile that every one of them refuses stays bare.
   */
  setStandbys(sources) {
    this.standbys = (Array.isArray(sources) ? sources : [sources]).filter(Boolean);
  }

  /** The provider a given attempt should use. */
  sourceFor(attempt) {
    if (attempt <= 0) return this.source;
    return this.standbys[attempt - 1] ?? null;
  }

  /**
   * Could this provider have a photograph at this zoom at all?
   *
   * The standby list is ordered by preference, not by depth, and the free ones
   * behind Esri are much coarser: Sentinel-2 stops around zoom 14, GIBS is a
   * quarter-kilometre a pixel. When Esri refuses a zoom-19 square over a
   * glacier, asking those three in turn is three round trips that cannot
   * succeed — and measured over the Bernese Alps that is where three quarters
   * of all imagery failures came from: 157 refusals covering 39 squares.
   * Skipping the ones that do not go that deep leaves the budget to tiles that
   * exist.
   */
  canServe(source, z) {
    if (!source) return false;
    return (source.descriptor?.maxZoom ?? 19) >= z;
  }

  /**
   * File a tile's detail, and work out whether its parent was the end of it.
   *
   * A genuine new level of resolution keeps most of its parent's per-pixel
   * contrast; the parent resampled bigger keeps half or less. Either way the
   * answer is about *this square*, not about the zoom level — coverage is
   * patchy, and a level that is real over a city is a resample a valley away.
   */
  noteSharpness(tile, value) {
    const key = tileKey(tile.z, tile.x, tile.y);
    this.sharpness.set(key, value);
    // Only where the question means anything. A verdict on a tile covering a
    // thousand kilometres would stop the quadtree subdividing inside all of it.
    if (tile.z <= SHARPNESS_FROM_ZOOM) return;
    const parentKey = tileKey(tile.z - 1, tile.x >> 1, tile.y >> 1);
    const parent = this.sharpness.get(parentKey);
    if (parent === undefined) return;
    // Nothing left to resolve down there: open ocean, a snowfield, a card.
    // Stopping is safe in both directions — a featureless square looks the
    // same however finely it is fetched, and the requests are not spent.
    if (parent < SHARPNESS_FLOOR) {
      this.finest.add(parentKey);
      return;
    }
    if (value < parent * SHARPNESS_RATIO) this.finest.add(parentKey);
  }

  /**
   * True when no finer photograph than this tile exists for this square, so
   * the quadtree should stop here rather than fetch the same pixels again.
   *
   * Checked up the ancestry, because the answer is inherited: if zoom 20 over
   * this valley was a resample of 19, so is everything under it.
   */
  atFinest(tile) {
    if (!this.finest.size || tile.z < SHARPNESS_FROM_ZOOM) return false;
    let { z, x, y } = tile;
    while (z >= SHARPNESS_FROM_ZOOM) {
      if (this.finest.has(tileKey(z, x, y))) return true;
      z--; x >>= 1; y >>= 1;
    }
    return false;
  }

  /** The next attempt number worth making after this one, or null. */
  nextAttempt(entry) {
    let attempt = (entry.attempt ?? 0) + 1;
    while (attempt <= this.standbys.length && !this.canServe(this.standbys[attempt - 1], entry.tile.z)) {
      attempt++;
    }
    return attempt <= this.standbys.length ? attempt : null;
  }

  clear() {
    this.barren.clear();
    this.sharpness.clear();
    this.finest.clear();
    for (const entry of this.entries.values()) {
      if (entry.texture) entry.texture.dispose();
    }
    this.entries.clear();
    for (const id of this.jobs.keys()) {
      this.worker.postMessage({ kind: 'cancel', channel: 'imagery', id });
    }
    this.jobs.clear();
    this.queue.length = 0;
    this.active = 0;
    this.stats.loaded = 0;
    this.stats.failed = 0;
    this.consecutiveFailures = 0;
    this.degraded = false;
    this.byZoom.clear();
    this.depthLimit = Infinity;
  }

  /** The tally for one zoom level, created on demand. */
  zoomRecord(z) {
    let record = this.byZoom.get(z);
    if (!record) {
      record = { loaded: 0, failed: 0 };
      this.byZoom.set(z, record);
    }
    return record;
  }

  /**
   * Work out how deep this provider is really willing to go.
   *
   * The test is deliberately narrow: a level counts as too deep only when it
   * has refused a good number of tiles, has never once succeeded, and the
   * level *above* it is succeeding. That last clause is what separates "this
   * provider stops at zoom 17" from "this provider has no coverage here at
   * all" — a regional source like the USGS one refuses every level over
   * Europe, and lowering the zoom would not help with that. One tile arriving
   * at a written-off level puts it back.
   */
  reviewDepth(z) {
    const here = this.zoomRecord(z);
    if (here.loaded > 0) {
      if (this.depthLimit < z) this.depthLimit = Infinity;
      return;
    }
    if (here.failed < 6) return;
    const above = this.byZoom.get(z - 1);
    if (!above || above.loaded === 0) return;
    if (z - 1 < this.depthLimit) {
      this.depthLimit = z - 1;
      this.emit('depth', { zoom: this.depthLimit });
    }
  }

  /** The deepest zoom worth asking this provider for, right now. */
  get maxUsefulZoom() {
    const published = this.source ? this.source.maxZoom : 19;
    return Math.min(published, this.depthLimit);
  }

  beginFrame() {
    this.frame++;
    // Requests are collected fresh each frame; stale ones simply never re-queue.
    this.queue.length = 0;
  }

  /**
   * Ask for a tile. Returns the entry (possibly pending). `priority` is a
   * screen-space cost — smaller loads first.
   */
  request(tile, priority) {
    const key = tileKey(tile.z, tile.x, tile.y);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, tile, state: 0, texture: null, used: this.frame, priority };
      this.entries.set(key, entry);
    }
    entry.used = this.frame;
    entry.priority = priority;
    if (entry.state === STATE_BARE) return entry;
    if (entry.state !== STATE_READY && this.underBarren(tile)) {
      entry.state = STATE_BARE;
      return entry;
    }
    if (entry.state === 0 || (entry.state === STATE_FAILED && entry.retryAt < performance.now())) {
      this.queue.push(entry);
    }
    return entry;
  }

  /**
   * Is this square inside one nobody has a photograph of?
   *
   * Only the levels immediately above are consulted. A provider that refuses a
   * square refuses the quarter of it below, and the quarter of that; going all
   * the way to the root would let one refusal at zoom 3 write off a continent
   * on the strength of one answer.
   */
  underBarren(tile) {
    if (this.barren.size === 0) return false;
    let { z, x, y } = tile;
    for (let i = 0; i < 4 && z > 1; i++) {
      z -= 1;
      x >>= 1;
      y >>= 1;
      if (this.barren.has(tileKey(z, x, y))) return true;
    }
    return false;
  }

  /**
   * Ask for the coarse tiles above this one as well.
   *
   * Called when a tile has nothing to draw and no loaded ancestor to stretch
   * either — which is what happens the moment you arrive somewhere new, because
   * the quadtree only ever asks for the leaves it is drawing and the levels
   * above them were never anybody's leaf. One coarse tile covers thousands of
   * fine ones, so a handful of these turns a blank hillside into a soft one
   * within a single round trip, and the sharp tiles replace it as they land.
   */
  requestAncestors(tile, priority, steps = 8) {
    let z = tile.z;
    let x = tile.x;
    let y = tile.y;
    for (let i = 0; i < steps && z > 1; i++) {
      z -= 1;
      x >>= 1;
      y >>= 1;
      // Ahead of the leaf that asked for them, and the coarser the further
      // ahead. That looks backwards and is not: this is only called when there
      // is nothing to draw at all, and one tile eight levels up covers this
      // leaf and four thousand of its neighbours. Leaving them behind the
      // leaves in the queue meant they were never dispatched — the queue is
      // rebuilt every frame and the sharp tiles refill it from the front — so
      // whole hillsides stayed blank while single sharp tiles trickled in.
      this.request({ z, x, y }, priority * Math.pow(0.5, i + 1));
    }
  }

  /** Mark a tile as still in use without requesting a load. */
  touch(tile) {
    const entry = this.entries.get(tileKey(tile.z, tile.x, tile.y));
    if (entry) entry.used = this.frame;
    return entry;
  }

  /**
   * Best available texture for a tile: itself, or the nearest loaded ancestor
   * with the UV window that shows the right quarter/sixteenth of it.
   *
   * It walks all the way to the root. Stopping six levels short sounds
   * reasonable and is not: the quadtree draws leaves nineteen levels down and
   * its roots sit around eight, so the one texture that *was* loaded — the
   * coarse one covering the whole view — was eleven steps away and never
   * found. The loop is twenty-odd map lookups; the alternative was blank
   * ground.
   */
  resolve(tile, maxSteps = 24) {
    let z = tile.z;
    let x = tile.x;
    let y = tile.y;
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;

    for (let step = 0; step <= maxSteps && z >= 0; step++) {
      const entry = this.entries.get(tileKey(z, x, y));
      if (entry && entry.state === STATE_READY && entry.texture) {
        entry.used = this.frame;
        return { texture: entry.texture, scale, offsetX, offsetY, exact: step === 0 };
      }
      // Walk to the parent; track which quadrant we came from.
      const childX = x & 1;
      const childY = y & 1;
      offsetX = (offsetX + childX) * 0.5;
      offsetY = (offsetY + childY) * 0.5;
      scale *= 0.5;
      x >>= 1;
      y >>= 1;
      z -= 1;
    }
    return null;
  }

  pump() {
    if (!this.source) return;
    const limit = settings.preset().maxConcurrentRequests;
    if (this.active >= limit || this.queue.length === 0) return;

    this.queue.sort((a, b) => a.priority - b.priority);
    while (this.active < limit && this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry || entry.state === STATE_PENDING || entry.state === STATE_READY) continue;
      this.dispatch(entry);
    }
  }

  dispatch(entry) {
    const attempt = entry.attempt ?? 0;
    const source = this.sourceFor(attempt);
    if (!source) {
      // Every provider has been asked and none of them has this square. Bare
      // is the honest answer; the shader colours it from the relief.
      entry.state = STATE_BARE;
      return;
    }
    if (!source.ready) {
      source.prepare();
      return;
    }
    const tile = { z: entry.tile.z, x: wrapTileX(entry.tile.x, entry.tile.z), y: entry.tile.y };
    const url = this.degraded ? null : source.urlFor(tile);
    // No URL means the provider has not handshaken (no key, metadata call
    // unanswered) or does not serve this tile. Either way there is nothing to
    // draw and nothing to invent: the tile stays bare and the ground under it
    // is whatever the relief says, which is honest about not knowing.
    if (url === null) {
      entry.state = STATE_BARE;
      return;
    }

    const id = this.nextId++;
    entry.state = STATE_PENDING;
    entry.jobId = id;
    this.jobs.set(id, entry);
    this.active++;
    this.stats.pending = this.active;
    this.worker.postMessage({ kind: 'imagery', channel: 'imagery', id, tile, url, size: 128 });
  }

  onWorkerMessage(msg) {
    if (!msg || msg.channel !== 'imagery' || msg.id === undefined) return;
    const entry = this.jobs.get(msg.id);
    if (!entry) {
      if (msg.bitmap) msg.bitmap.close();
      return;
    }
    this.jobs.delete(msg.id);
    this.active = Math.max(0, this.active - 1);
    this.stats.pending = this.active;

    if (!msg.ok) {
      // Try the next provider before giving up on this square. A refusal is
      // about one server, not about whether the ground exists, and the whole
      // point of the standby list is that somebody else has a photograph of
      // the same place.
      const attempt = msg.aborted ? null : this.nextAttempt(entry);
      if (attempt !== null) {
        entry.attempt = attempt;
        entry.state = 0;
        entry.retryAt = 0;
        this.queue.push(entry);
      } else if (msg.aborted) {
        entry.state = STATE_FAILED;
        entry.retryAt = 0;
      } else {
        entry.state = STATE_FAILED;
        entry.retryAt = performance.now() + 20000;
        // Nobody has this square. Say so once, so the four below it and the
        // sixteen below those are never asked at all.
        this.barren.add(entry.key);
      }
      this.stats.failed++;
      if (!msg.aborted) {
        this.zoomRecord(entry.tile.z).failed++;
        this.reviewDepth(entry.tile.z);
        this.consecutiveFailures++;
        // Every provider refusing is worth saying out loud. There is nothing
        // to fall back to any more — no generator — so the ground is coloured
        // from the relief and the status line explains why.
        if (!this.degraded && this.consecutiveFailures >= 10 && this.stats.loaded === 0) {
          this.degraded = true;
          this.emit('degraded', { error: msg.error });
        }
      }
      this.emit('error', { key: entry.key, error: msg.error });
      return;
    }
    this.consecutiveFailures = 0;
    if (!msg.bitmap) return;

    const texture = new THREE.Texture(msg.bitmap);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.min(
      settings.preset().anisotropy,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    texture.needsUpdate = true;

    entry.texture = texture;
    entry.state = STATE_READY;
    if (Number.isFinite(msg.sharpness)) this.noteSharpness(entry.tile, msg.sharpness);
    this.tileSizeHint = msg.bitmap.width || this.tileSizeHint;
    this.stats.loaded++;
    this.zoomRecord(entry.tile.z).loaded++;
    // One tile arriving at a level that had been written off puts it back.
    if (entry.tile.z > this.depthLimit) this.depthLimit = Infinity;
    this.emit('tile', entry);
  }

  /**
   * Drop textures that have not been asked for in a while.
   *
   * "A while" used to mean one frame: anything not drawn *this* frame was fair
   * game. Turn around, or let a ridge occlude a valley for a moment, and the
   * tiles behind you were gone and had to come down the wire again. Holding
   * them for a few seconds costs nothing but the cache slot and means staying
   * within range of somewhere keeps it loaded, which is the point.
   */
  evict() {
    const limit = settings.preset().textureCacheSize;
    // Coarse tiles are cover for everything under them, and they were being
    // thrown away like any other.
    //
    // `resolve` stamps the one entry it hands back. A tile drawing its own
    // sharp photograph therefore never touches the coarse tiles above it, so
    // while you are looking at good ground the whole safety net goes unused
    // and becomes the least-recently-used thing in the cache. Turn quickly and
    // the tiles coming into view have no photograph of their own, walk up
    // looking for one to stretch, and find it was evicted. Nothing to stretch
    // means `uHasTexture` is zero, which is drawn as flat grey.
    const cover = [];
    const rest = [];
    for (const entry of this.entries.values()) {
      (entry.tile.z <= COVER_ZOOM ? cover : rest).push(entry);
    }
    const drop = (entry) => {
      if (entry.texture) entry.texture.dispose();
      this.entries.delete(entry.key);
    };

    let excess = rest.length - limit;
    if (excess > 0) {
      rest.sort((a, b) => a.used - b.used);
      for (const entry of rest) {
        if (excess <= 0) break;
        if (entry.used >= this.frame - KEEP_FRAMES || entry.state === STATE_PENDING) continue;
        drop(entry);
        excess--;
      }
    }

    // Bounded, so an hour of flying cannot fill memory with cover for places
    // you will never see again. Only the oldest, and only over the cap.
    let spare = cover.length - COVER_BUDGET;
    if (spare > 0) {
      cover.sort((a, b) => a.used - b.used);
      for (const entry of cover) {
        if (spare <= 0) break;
        if (entry.state === STATE_PENDING) continue;
        drop(entry);
        spare--;
      }
    }
  }
}

export { STATE_PENDING, STATE_READY, STATE_FAILED };

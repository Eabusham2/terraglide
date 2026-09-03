import * as THREE from '../../vendor/three/three.module.js';
import { Emitter } from '../core/events.js';
import { settings } from '../core/settings.js';
import { tileKey, wrapTileX } from '../geo/mercator.js';
import { SHARPNESS_FLOOR, SHARPNESS_FROM_ZOOM, SHARPNESS_RATIO } from './sharpness.js';

/**
 * At and below this zoom a tile is cover rather than detail: it is what
 * everything beneath it stretches when its own photograph has not arrived.
 */
const COVER_ZOOM = 9;
/** How many cover tiles to keep. One at zoom nine is about 100 km across. */
const COVER_BUDGET = 160;

/**
 * How long a tile stays safe from eviction after it was last drawn.
 *
 * Seconds, because it used to be *frames* — 240 of them, commented as "about
 * four seconds at 60 fps", which is only true on a machine running at exactly
 * sixty:
 *
 *   144 fps   1.7 s        30 fps    8 s
 *    60 fps   4.0 s        10 fps   24 s
 *
 * So the better the machine, the sooner the ground behind you was thrown away
 * — 1.7 seconds on a fast one. Turn round after glancing at something and the
 * imagery you were just looking at has to come down the wire again. That is
 * "high res unloads from behind me" and "unloading while the player is still
 * inside the render distance".
 *
 * Twenty seconds, and the same twenty everywhere. Long enough to fly out and
 * come back, which is what the old comment was reaching for and what four
 * seconds was never going to cover.
 */
const KEEP_SECONDS = 20;
/**
 * How often to ask whether a provider's written-off depth is still written off.
 *
 * Half a minute: often enough that flying from a valley to a city sharpens
 * within a few seconds of arriving, rare enough that it is one request in
 * thousands.
 */
/**
 * The shallowest zoom at which "nobody has this square" is allowed to stop the
 * quadtree. Six is about a thousand kilometres across: below that a refusal is
 * far more likely to be an outage than an absence.
 */
const NO_DEEPER_FROM_ZOOM = 6;
const DEPTH_PROBE_MS = 30000;

/**
 * How long "nobody has a photograph of this" is believed for.
 *
 * Ninety seconds. Ground nobody has imaged stays unimaged, so re-asking costs
 * one request every minute and a half for a square that will refuse again —
 * nothing. A network that dropped, a server having a moment, a token that has
 * just been pasted: all of those recover, and before this none of them ever got
 * a second chance, because a refusal was remembered for the whole session and
 * took the sixteen squares beneath it with it.
 */
const BARREN_TTL_MS = 90000;

/** Milliseconds, monotonic where the browser offers one. */
const now = () =>
  (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

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
    /** Set when something is queued, so pump only re-sorts when it must. */
    this.queueDirty = false;
    this.active = 0;
    this.nextId = 1;
    this.jobs = new Map();
    this.frame = 0;
    this.stats = {
      loaded: 0, pending: 0, failed: 0, bytes: 0,
      // What the ground you are looking at is actually drawn from: its own
      // photograph, a coarser one stretched over it, or nothing at all. The
      // last is "everything becomes a solid colour" — no texture means the
      // shader has only the relief to colour by, which is flat grey.
      exact: 0, stretched: 0, steps: 0, bare: 0,
    };
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
    /**
     * Squares every provider refused, and when.
     *
     * A Set once, which meant for ever: one refusal and that square — and the
     * four below it, and the sixteen below those — were never asked again for
     * the rest of the session. That is right for ground nobody has
     * photographed and wrong for the far commoner cause, which is a network
     * that dropped for five seconds. A wifi hiccup permanently blanked
     * whatever you happened to be flying over. See BARREN_TTL_MS.
     */
    this.barren = new Map();
    /**
     * Per-tile detail, and the squares where descending stops buying any.
     *
     * One published maximum zoom per provider cannot be right — Esri guarantee
     * nineteen everywhere, serve twenty-one over Vienna and have not flown
     * twenty over the Jungfrau — so the depth is measured instead of declared.
     * See sharpness.js for the numbers behind it.
     */
    this.sharpness = new Map();
    /** Per-tile canopy score from the photograph itself. See canopy.js. */
    this.canopy = new Map();
    this.finest = new Set();
    this.worker.addEventListener('message', (event) => this.onWorkerMessage(event.data));
  }

  /**
   * Fly over somebody else's photographs from now on.
   *
   * Note what this does *not* do: throw away the pictures already on screen. It
   * used to call clear(), which disposes every texture at once — so the instant
   * you picked a different provider the whole world went to flat grey and then
   * came back a tile at a time as the new ones landed. Hundreds of squares
   * blinking out and back in over several seconds is the flashing, and the
   * several seconds of a blank world while it happened is the hang.
   *
   * The old picture of a place is a perfectly good picture of that place until
   * the new one arrives. So everything already loaded stays up and is replaced
   * as its replacement lands, one square at a time, with no moment where there
   * is nothing.
   *
   * What does have to go is everything *derived* from the old provider, because
   * it is about to be wrong: which squares it refused, how sharp its pictures
   * were, and how deep it was worth descending. Those are opinions about a
   * provider, not pictures of the world.
   */
  setSource(source) {
    const changed = this.source?.descriptor?.id !== source?.descriptor?.id;
    this.source = source;
    this.standbys = [];
    if (!changed) return;
    this.barren.clear();
    this.sharpness.clear();
    this.finest.clear();
    this.canopy.clear();
    // Anything already in flight was asked of the provider you just left.
    for (const id of this.jobs.keys()) {
      this.worker.postMessage({ kind: 'cancel', channel: 'imagery', id });
    }
    this.jobs.clear();
    this.queue.length = 0;
    // Mark what is on screen as belonging to the old provider, so the terrain
    // asks for each square again and the new picture replaces the old one as it
    // arrives rather than all at once.
    for (const entry of this.entries.values()) {
      if (entry.state === STATE_READY) entry.stale = true;
    }
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
  /**
   * The measured canopy score for a square, or for the nearest ancestor that
   * has one. Zero means "no opinion", not "no trees".
   */
  canopyAt(tile) {
    for (let z = tile.z, x = tile.x, y = tile.y; z >= 0; z--, x >>= 1, y >>= 1) {
      const score = this.canopy.get(tileKey(z, x, y));
      if (score !== undefined) return score;
    }
    return 0;
  }

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
    // Nobody has a picture of the ground under this square, so descending into
    // it cannot find one — and that is the same question `finest` answers, from
    // different evidence.
    //
    // `finest` was fed only by tiles that *loaded*, from their measured
    // sharpness, so ground where the imagery simply stops had no brake at all:
    // the tree carried on splitting into squares nobody has photographed and
    // drew every leaf bare. Measured over the East Antarctic plateau, where
    // Esri's imagery ends at zoom 13 and zoom 14 is their "map data not yet
    // available" card: 372 drawn tiles across zooms 12 to 19, not one
    // photograph among them, with the real zoom-13 picture never asked for.
    //
    // Read off `barren` rather than kept in a set of its own, which is what
    // this was first written as and was wrong: a set has no expiry, so one
    // transient refusal capped the depth over a whole region for the rest of
    // the session — measured, it stopped Antarctica at zoom 5. `barren`
    // already forgets after ninety seconds, for exactly that reason.
    if (this.childrenBarren(tile)) return true;
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

  /**
   * Ask, occasionally, whether the depth limit is still true.
   *
   * `reviewDepth` writes a provider off at a level when it has refused enough
   * tiles there, and says of itself that "one tile arriving at a written-off
   * level puts it back" — which is true, and could never happen. The limit
   * caps how deep the quadtree splits, so nothing is ever asked for above it,
   * so no tile can arrive to lift it. A one-way latch.
   *
   * It matters because the limit is one number for the whole provider, not one
   * per place. Esri stops at zoom 21 over an alpine valley and serves 23 over a
   * city; fly the valley first and the city is capped at 21 for the rest of the
   * session, with nothing able to discover otherwise.
   *
   * So one tile, every half minute, one level above the limit, over the ground
   * being looked at. If it lands, `finish` lifts the limit; if it does not, the
   * failure count grows and nothing changes. That is a request every two
   * thousand frames against a cap that would otherwise last for ever.
   */
  probeDeeper() {
    if (!Number.isFinite(this.depthLimit)) return;
    const deepest = this._deepestAsked;
    if (!deepest || deepest.z !== this.depthLimit) return;
    const moment = now();
    if (moment - (this._probedAt ?? -Infinity) < DEPTH_PROBE_MS) return;
    this._probedAt = moment;
    // Last in the queue: this is curiosity, and everything on screen comes
    // first.
    this.request({ z: deepest.z + 1, x: deepest.x * 2, y: deepest.y * 2 }, Number.MAX_SAFE_INTEGER);
  }

  beginFrame() {
    this.frame++;
    // Per frame, because the question is "how much of what I am looking at
    // right now is stretched", not "how much has ever been".
    this.stats.exact = 0;
    this.stats.stretched = 0;
    this.stats.steps = 0;
    this.stats.bare = 0;
    // Requests are collected fresh each frame; stale ones simply never re-queue.
    this.queue.length = 0;
    this._deepest = 0;
    this.probeDeeper();
  }

  /**
   * Ask for a tile. Returns the entry (possibly pending). `priority` is a
   * screen-space cost — smaller loads first.
   */
  /**
   * Mark a square as having nothing to draw, and remember when.
   *
   * The time is the whole point. Every *reason* for going bare is already kept
   * with an expiry — `barren` forgets after ninety seconds, because a refusal is
   * far more often a network that dropped than ground nobody has photographed —
   * but the entry itself had none, and `request` returns early on a bare entry
   * before any of that is consulted. So one unlucky moment retired a square for
   * the rest of the session.
   */
  markBare(entry) {
    entry.state = STATE_BARE;
    entry.bareAt = now();
    return entry;
  }

  request(tile, priority) {
    const key = tileKey(tile.z, tile.x, tile.y);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, tile, state: 0, texture: null, used: this.frame, seen: now(), priority };
      this.entries.set(key, entry);
    }
    entry.used = this.frame;
    entry.seen = now();
    entry.priority = priority;
    // The deepest square anyone wanted this frame, so the depth probe knows
    // where to look. See probeDeeper.
    if (tile.z > (this._deepest ?? 0)) {
      this._deepest = tile.z;
      this._deepestAsked = tile;
    }
    if (entry.state === STATE_BARE) {
      // Bare is not for ever. Ask again once the reason has had time to expire,
      // on the same ninety-second clock the barren record keeps.
      //
      // This is what stranded the depth probe, and through it the whole world.
      // probeDeeper asks for one tile a level below the limit every thirty
      // seconds, and the limit lifts the moment any tile arrives below it — but
      // if the probe's square had been marked bare during an earlier outage,
      // `request` returned that bare entry instead of asking, every time.
      // Measured over Antarctica: the limit sat at zoom 5 for two full minutes
      // with the probe skipped on every frame, two tiles drawn — and it
      // followed the player back to the Alps and drew nothing there either.
      if (now() - (entry.bareAt ?? 0) < BARREN_TTL_MS) return entry;
      entry.state = 0;
    }
    if (entry.state !== STATE_READY && this.underBarren(tile)) {
      return this.markBare(entry);
    }
    // A square carrying the previous provider's picture asks again, once, and
    // keeps showing what it has until the answer arrives. See setSource.
    if (entry.stale) {
      entry.stale = false;
      entry.refreshing = true;
      this.queue.push(entry);
      this.queueDirty = true;
    } else if (
      entry.state === 0
      || (entry.state === STATE_FAILED && entry.retryAt < performance.now())
    ) {
      this.queue.push(entry);
      this.queueDirty = true;
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
    const moment = now();
    let { z, x, y } = tile;
    for (let i = 0; i < 4 && z > 1; i++) {
      z -= 1;
      x >>= 1;
      y >>= 1;
      const at = this.barren.get(tileKey(z, x, y));
      if (at !== undefined) {
        if (moment - at < BARREN_TTL_MS) return true;
        // Long enough ago that it is worth asking again: the world does not
        // change, but networks and servers do.
        this.barren.delete(tileKey(z, x, y));
      }
    }
    return false;
  }

  /**
   * True when the squares immediately below this one are known to have no
   * photograph, so splitting would draw four blank children instead of this
   * one's own picture stretched.
   *
   * Floored well above zero: a refusal for a square the size of a continent is
   * far more likely to be an outage than an absence, and acting on it would
   * stop the world subdividing across an ocean.
   */
  childrenBarren(tile) {
    if (this.barren.size === 0 || tile.z < NO_DEEPER_FROM_ZOOM) return false;
    const moment = now();
    const z = tile.z + 1;
    let found = false;
    for (let i = 0; i < 4; i++) {
      const key = tileKey(z, tile.x * 2 + (i & 1), tile.y * 2 + (i >> 1));
      const at = this.barren.get(key);
      if (at === undefined) continue;
      if (moment - at < BARREN_TTL_MS) found = true;
      else this.barren.delete(key);
    }
    return found;
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
    if (entry) {
      entry.used = this.frame;
      entry.seen = now();
    }
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
        entry.seen = now();
        // Counted, because "everything goes blurry for a second" is this and
        // nothing else: a tile with no photograph of its own is drawn from a
        // coarser one stretched over it, and each step up halves the detail.
        // A number for it is the difference between guessing at the cause and
        // knowing how often it happens and how far it goes.
        if (step === 0) this.stats.exact++;
        else { this.stats.stretched++; this.stats.steps += step; }
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
    this.stats.bare++;
    return null;
  }

  pump() {
    if (!this.source) return;
    const limit = settings.preset().maxConcurrentRequests;
    if (this.active >= limit || this.queue.length === 0) return;

    // Only re-sort when something has been added since the last pump. Now
    // that a completion pumps as well as a frame does, sorting unconditionally
    // would re-sort a queue five hundred deep a dozen times a frame for
    // nothing.
    if (this.queueDirty) {
      this.queue.sort((a, b) => a.priority - b.priority);
      this.queueDirty = false;
    }
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
      this.markBare(entry);
      return;
    }
    if (!source.ready) {
      source.prepare();
      return;
    }
    const tile = { z: entry.tile.z, x: wrapTileX(entry.tile.x, entry.tile.z), y: entry.tile.y };
    // While degraded, one request at a time rather than none at all.
    //
    // This used to be `this.degraded ? null : urlFor(...)`, which is a latch
    // with no key: degraded means "nothing is reaching any provider", it is set
    // after ten consecutive failures, and from that moment urlFor was never
    // called again — so nothing could succeed, so nothing could clear it. A tab
    // that booted while the network was down, or whose graphics context was
    // lost and restored (which resets the counters, so the latch re-arms), drew
    // grey for the rest of the session and only a change of provider brought it
    // back.
    //
    // Throttled, not refused. The first version of this returned null here and
    // fell into the branch below, which marks the square BARE — and bare is
    // terminal, so the first pump after the latch wrote off the entire view
    // permanently and only a trickle of newly-created tiles ever got a probe.
    // Measured: 477 squares bare, still bare forty-five seconds later, no
    // recovery. Leaving the entry untouched puts it back in the queue on the
    // next frame, because the terrain asks again for everything it draws.
    if (this.degraded && this.active > 0) return;
    const url = source.urlFor(tile);
    // No URL means the provider has not handshaken (no key, metadata call
    // unanswered) or does not serve this tile. Either way there is nothing to
    // draw and nothing to invent: the tile stays bare and the ground under it
    // is whatever the relief says, which is honest about not knowing.
    if (url === null) {
      this.markBare(entry);
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

  /**
   * A request finished, so deal with it and then fill the slot it just freed.
   *
   * `pump` was called from exactly one place — the terrain's walk, once a
   * frame — and nothing refilled a slot when the request holding it completed.
   * A slot freed just after a frame therefore stayed empty until the next one.
   *
   * At sixty frames a second that is a sixteen-millisecond gap and invisible.
   * On the machines this is actually about, it is not. Measured in flight:
   * a mean of 1.34 requests in flight against a cap of twelve, while the queue
   * averaged sixty-six squares deep and peaked at five hundred and ten. The
   * pipeline was running at eleven per cent of its own allowance with plenty
   * of work waiting, and the gap widens as the frame rate falls — so the
   * ground arrives slowest exactly where the frame rate is already low, which
   * is the machine the complaint always comes from.
   *
   * This is the real answer to "throughput is the constraint", which several
   * backlog entries concluded and none of them measured. The wire was never
   * the limit; the refill cadence was. Every other queue here already pumps on
   * completion — the map's tiles, Overpass, geocoding — and this one did not.
   */
  onWorkerMessage(msg) {
    this.receive(msg);
    this.pump();
  }

  receive(msg) {
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
        this.queueDirty = true;
      } else if (msg.aborted) {
        entry.state = STATE_FAILED;
        entry.retryAt = 0;
      } else {
        entry.state = STATE_FAILED;
        entry.retryAt = performance.now() + 20000;
        // Nobody has this square. Say so once, so the four below it and the
        // sixteen below those are never asked at all.
        this.barren.set(entry.key, now());
      }
      this.stats.failed++;
      if (!msg.aborted) {
        this.zoomRecord(entry.tile.z).failed++;
        // A square with no picture in it is not evidence about how deep this
        // provider goes, and counting it as such is how a continent ended up
        // drawn at zoom 5.
        //
        // reviewDepth's own comment says coverage is not a single depth —
        // Esri serves 19 over a town and stops at 17 over a glacier a valley
        // away — and `barren` is the per-square answer built for exactly that.
        // But every refusal, including "here is my not-available card", was
        // also being fed to the global depth limit. Over the East Antarctic
        // plateau, where the imagery genuinely ends at zoom 13, a handful of
        // those pulled the limit down to 5 and the latch then stopped anything
        // deeper being asked, so nothing could arrive to lift it again.
        //
        // Transport failures still count: a run of 404s with the level above
        // succeeding really is a provider saying how deep it goes.
        if (!msg.noImageryHere) this.reviewDepth(entry.tile.z);
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
    // Something arrived, so "nothing is reaching any provider" is no longer
    // true. Said here rather than anywhere cleverer because that is exactly
    // what the flag claims and exactly what has just been disproved.
    if (this.degraded) {
      this.degraded = false;
      this.emit('recovered', {});
    }
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

    // Swapping a picture for a picture: the old one is disposed here, one
    // square at a time as its replacement lands, rather than all of them the
    // moment you chose a different provider.
    if (entry.texture) entry.texture.dispose();
    entry.texture = texture;
    entry.state = STATE_READY;
    entry.refreshing = false;
    if (Number.isFinite(msg.sharpness)) this.noteSharpness(entry.tile, msg.sharpness);
    if (Number.isFinite(msg.canopy)) {
      this.canopy.set(tileKey(entry.tile.z, entry.tile.x, entry.tile.y), msg.canopy);
    }
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
  /**
   * How many tiles the cache may hold, given how big this provider's are.
   *
   * The preset's number is a count, and a count is a proxy for memory that is
   * wrong by four whenever a provider serves 512-pixel tiles instead of 256 —
   * which several do. At 512, "high" is 900 tiles of about 1.2 GB of texture,
   * on top of the terrain meshes, and a Chromebook answers that by killing the
   * tab. Which is what "it randomly refreshes" looks like from the inside.
   *
   * So the preset's figure is read as what it always meant — that many
   * *256-pixel* tiles — and converted to a count for whatever size is actually
   * arriving. The budget in bytes is then the same whoever you fly over.
   *
   * And halved again on a machine that says it has little memory. `deviceMemory`
   * is capped at 8 by the specification and missing on Safari, so a browser that
   * does not answer is given the benefit of the doubt rather than the floor.
   */
  textureLimit() {
    const preset = settings.preset();
    const size = this.tileSizeHint || 256;
    // A 512-pixel tile costs four times the memory of a 256-pixel one, so the
    // preset's figure — which is a count of 256-pixel tiles — is divided by
    // that. Any floor added below has to be scaled the same way or it
    // quadruples the budget on a provider that serves 512s; that is the
    // mistake recorded under B7.
    const perTile = (256 / size) ** 2;
    const memoryGB = Number(globalThis.navigator?.deviceMemory ?? 0);
    const share = memoryGB > 0 && memoryGB <= 4 ? 0.5 : 1;
    const budget = preset.textureCacheSize * perTile * share;

    /**
     * Never smaller than the view.
     *
     * A cache that cannot hold what is on screen is not a smaller cache, it is
     * an incoherent one: it has to either evict tiles that are still being
     * drawn — which fetches them straight back, and is the thrash the
     * twenty-second hold exists to prevent — or ignore its own budget. It was
     * silently doing the second. Measured on a machine throttled to a sixth
     * speed reporting two gigabytes: 1,731 textures held against a budget of
     * 160, while the same tier draws up to 520 squares.
     *
     * Removing the hold instead was tried and was much worse: the cache came
     * back inside 160, and the share of ground drawn at its own resolution
     * fell from 71% to 15% while the queue went from 104 deep to 1,165. That
     * is the thrash, exactly as B7 predicted it.
     *
     * So the budget is floored at what the tier actually draws. On Low with
     * two gigabytes that is 520 tiles rather than 160 — about 133 MB of
     * texture instead of an unbounded 440 — and the hold can then yield above
     * it without ever evicting anything still on screen.
     */
    const view = preset.maxDrawnTiles * perTile;
    return Math.max(64, Math.round(Math.max(budget, view)));
  }

  evict() {
    const limit = this.textureLimit();
    const moment = now();
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
    /**
     * Never take a photograph out from under the frame that is drawing it.
     *
     * `resolve` stamps `used` with the current frame on the one entry it hands
     * back, so an entry stamped with *this* frame is on screen right now —
     * either as a tile's own photograph or as the coarse one being stretched
     * over it. Both passes below could drop those: the second skips only
     * pending tiles and says of itself that the protection is a preference
     * rather than a promise, and the cover pass has no protection at all.
     *
     * Dropping one is exactly the flicker to a flat plain colour. The comment
     * above this function already describes the mechanism — "nothing to stretch
     * means uHasTexture is zero, which is drawn as flat grey" — and then the
     * eviction underneath it goes ahead and creates it.
     *
     * It cannot deadlock the budget: at most one entry per drawn tile carries
     * the current frame, and the limit is floored at what the tier draws, by
     * the reasoning in textureLimit. If a frame ever did protect everything,
     * one frame over budget is worth incomparably more than a white flash, and
     * the next eviction catches up as tiles leave the view.
     */
    const onScreen = (entry) => entry.used === this.frame;
    const drop = (entry) => {
      if (onScreen(entry)) return false;
      if (entry.texture) entry.texture.dispose();
      this.entries.delete(entry.key);
      return true;
    };

    let excess = rest.length - limit;
    if (excess > 0) {
      rest.sort((a, b) => a.used - b.used);
      // First pass: the ones nothing is protecting, oldest first.
      for (const entry of rest) {
        if (excess <= 0) break;
        if (moment - (entry.seen ?? 0) < KEEP_SECONDS * 1000 || entry.state === STATE_PENDING) continue;
        if (drop(entry)) excess--;
      }
      // Second pass: the protection is a preference, not a promise.
      //
      // Holding a tile for twenty seconds after it was last drawn exists to
      // stop it being thrown away and immediately fetched again — see B8/B9.
      // But nothing bounded how *many* tiles that could protect, and on a slow
      // machine covering ground quickly the set of "seen in the last twenty
      // seconds" is enormous, so the first pass could find nothing droppable
      // at all and the cache simply grew.
      //
      // Measured on a machine throttled to a sixth of this one's speed,
      // reporting two gigabytes: 1,731 textures held against a budget of 160.
      // Ten times over, which at a quarter-megabyte a tile is about 440 MB of
      // texture where the budget says 40 — and a tab dying of memory is
      // exactly what "it randomly refreshes" looks like from the inside (A7).
      //
      // So when the first pass cannot get back under, the protection yields,
      // oldest-seen first. A re-fetch is cheaper than the tab being killed,
      // and the cover pool immediately below has always been bounded this way
      // and says so.
      if (excess > 0) {
        for (const entry of rest) {
          if (excess <= 0) break;
          if (entry.state === STATE_PENDING) continue;
          if (!this.entries.has(entry.key)) continue; // already dropped above
          if (drop(entry)) excess--;
        }
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
        if (drop(entry)) spare--;
      }
    }
  }
}

export { STATE_PENDING, STATE_READY, STATE_FAILED };

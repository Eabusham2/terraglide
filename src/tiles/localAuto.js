import { latToNormY, lonToNormX } from '../geo/mercator.js';
import {
  AUTO_PROVIDER,
  ELEVATION_PROVIDERS,
  IMAGERY_PROVIDERS,
  bestProviderFor,
  resolveAuto,
} from './providers.js';

/**
 * "Auto" that means *here*, not *in general*.
 *
 * The setting used to rank the whole list once — keys first, then published
 * maximum zoom — and hand the same answer back over Kansas and over Kent. That
 * ranking is a statement about what providers *claim*, and what a provider
 * claims is not what it serves: USGS publishes zoom 16 and has nothing at all
 * outside the United States, Esri publishes 23 and stops at 17 over much of
 * the world, GIBS has every square metre of the planet at zoom 9 and is the
 * only thing that answers over parts of the Southern Ocean. The best provider
 * genuinely changes as you fly, and a global ranking cannot say so.
 *
 * So this asks the providers, where you are, and remembers the answer.
 *
 * ## What "here" means
 *
 * Not per tile. A probe costs about a dozen requests, and a tile is fifty
 * metres across at the depth you walk around at — asking per tile would be
 * thousands of requests to cross a city, which is not a thing to do to
 * somebody's free tile server. Coverage does not change at that scale either:
 * the boundaries that matter are national and continental.
 *
 * So the unit is a zoom-8 square, about 150 km across at the equator and 100
 * across northern Europe. Crossing into one nobody has asked about costs one
 * probe; coming back to one that has been asked about is free, because the
 * answer is kept. A flight across a continent asks perhaps a dozen times.
 *
 * ## What it will not do
 *
 * It will not swap on a tie — whoever is drawing the ground keeps it unless
 * somebody else is properly deeper, so a border between two equally good
 * providers cannot start a swap every time you cross it. It will not override
 * a choice: this only ever runs for a setting left on Auto. And it will not
 * ask twice about the same square, including squares where the answer was
 * "nothing here", which is what stops it probing the middle of the Pacific
 * every six seconds.
 */

/** The square one decision covers. Zoom 8: ~150 km at the equator. */
export const AUTO_CELL_ZOOM = 8;

/** One probe in flight at a time, and no more often than this. */
export const PROBE_GAP_MS = 6000;

/** How many squares' answers to keep. A long flight, remembered. */
const MEMORY = 400;

/** Which zoom-8 square a coordinate is in. */
export function autoCell(lat, lon, zoom = AUTO_CELL_ZOOM) {
  const n = Math.pow(2, zoom);
  const x = Math.floor(lonToNormX(lon) * n);
  const y = Math.floor(Math.min(0.999999, Math.max(0, latToNormY(lat))) * n);
  return `${x}/${y}`;
}

/**
 * Which keyed providers are usable right now.
 *
 * Part of the cache key, because adding a token changes the right answer
 * everywhere and an answer worked out before you had it is stale. Only the
 * keyed ones are listed: the keyless set never changes.
 */
export function keyFingerprint(list, values) {
  return list
    .filter((p) => p.needsKey && values?.[p.needsKey])
    .map((p) => p.id)
    .join(',');
}

const LISTS = {
  imagery: IMAGERY_PROVIDERS,
  elevation: ELEVATION_PROVIDERS,
};

export class LocalAuto {
  /**
   * @param {object} [options]
   * @param {(kind:string, decision:object)=>void} [options.onDecided] called
   *   when a probe settles on something other than what is already drawing.
   * @param {(text:string|null)=>void} [options.onProgress]
   * @param {typeof bestProviderFor} [options.probe] for tests.
   * @param {()=>number} [options.now] for tests.
   */
  constructor({ onDecided, onProgress, probe = bestProviderFor, now } = {}) {
    this.onDecided = onDecided;
    this.onProgress = onProgress;
    this.probe = probe;
    this.now = now
      ?? (() => (typeof performance === 'undefined' ? Date.now() : performance.now()));
    /** cache key -> { id, label, zoom } | null, null meaning "asked, nobody". */
    this.answers = new Map();
    this.busy = false;
    this.lastProbeAt = -Infinity;
    /** What a probe in flight is doing, for the status line. */
    this.status = '';
  }

  key(kind, values, lat, lon) {
    return `${kind}|${keyFingerprint(LISTS[kind], values)}|${autoCell(lat, lon)}`;
  }

  /**
   * The decision for where you are, or null if nobody has asked yet.
   *
   * Deliberately does not start a probe: it is called from the render path,
   * where the answer has to be immediate. `tick` is what asks.
   */
  decided(kind, values, lat, lon) {
    return this.answers.get(this.key(kind, values, lat, lon)) ?? null;
  }

  /**
   * The provider id to actually use for a setting.
   *
   * A concrete choice comes back untouched — auto is a thing you opt into. On
   * auto: the local answer if there is one, and the published ranking until
   * there is, so there is never a frame with no provider while a probe runs.
   */
  resolve(kind, chosenId, values, lat, lon) {
    if (chosenId !== AUTO_PROVIDER) return chosenId;
    return this.decided(kind, values, lat, lon)?.id ?? resolveAuto(LISTS[kind], values);
  }

  /** Throw away every answer, for when the world changed under them. */
  forget() {
    this.answers.clear();
  }

  /**
   * Called every frame. Probes when you have moved into a square nobody has
   * asked about, and does nothing at all the rest of the time.
   *
   * @param {{lat:number, lon:number}} at
   * @param {object} values the settings store's values
   * @param {{imagery?:string, elevation?:string}} chosen the raw settings, so
   *   a kind that is not on Auto is never probed for
   * @param {{imagery?:string, elevation?:string}} [applied] what is drawing
   *   now, which is what wins a tie
   */
  tick(at, values, chosen, applied = {}) {
    if (this.busy) return;
    const now = this.now();
    if (now - this.lastProbeAt < PROBE_GAP_MS) return;
    for (const kind of ['imagery', 'elevation']) {
      if (chosen[kind] !== AUTO_PROVIDER) continue;
      const key = this.key(kind, values, at.lat, at.lon);
      if (this.answers.has(key)) continue;
      this.run(kind, key, { lat: at.lat, lon: at.lon }, values, applied[kind]);
      return;
    }
  }

  /**
   * Ask about this square again, now, whatever the throttle says.
   *
   * What the settings panel's button runs. Same probe, same memory, same
   * callback — the button is a way of hurrying the answer along, not a
   * separate mechanism that leaves the automatic one holding a stale one.
   */
  probeNow(kind, at, values, prefer, onProgress) {
    const key = this.key(kind, values, at.lat, at.lon);
    this.answers.delete(key);
    return this.run(kind, key, { lat: at.lat, lon: at.lon }, values, prefer, onProgress);
  }

  async run(kind, key, at, values, prefer, onProgress) {
    this.busy = true;
    this.lastProbeAt = this.now();
    try {
      const found = await this.probe(LISTS[kind], values, at, (text) => {
        this.status = text ?? '';
        this.onProgress?.(text);
        onProgress?.(text);
      }, { prefer });
      this.remember(key, found ?? null);
      if (found && found.id !== prefer) this.onDecided?.(kind, found);
      return found ?? null;
    } catch {
      // Offline, or the page is going away. Nothing is remembered, so the
      // square gets asked about again — which is the right answer for a
      // failure that is about the network rather than about the ground.
      return null;
    } finally {
      this.busy = false;
      this.status = '';
    }
  }

  remember(key, value) {
    this.answers.set(key, value);
    while (this.answers.size > MEMORY) {
      this.answers.delete(this.answers.keys().next().value);
    }
  }
}

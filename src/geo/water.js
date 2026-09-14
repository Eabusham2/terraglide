import { clamp } from '../core/math.js';
import { isNoDataCard } from '../tiles/noData.js';
import { destination, latToNormY, lonToNormX, tileKey, wrapTileX } from './mercator.js';

/**
 * "Is this spot ocean?" — used by random teleport (the *explore seas* toggle)
 * and by the climate model (how continental a place feels).
 *
 * There is no offline coastline dataset in this project, so instead of shipping
 * one we read the answer off a single low-zoom imagery tile per region and
 * cache a 32x32 water mask from it. One small tile covers a whole continent's
 * worth of teleport attempts. With no imagery there is nothing to read and no
 * invented coastline to fall back on, so the answer is "land" — see isWater.
 */

const PROBE_ZOOM = 6;
const MASK = 32;
/**
 * How long a probe that came back with nothing is left alone before it is
 * worth asking again.
 *
 * It used to be for ever. One hiccup fetching one zoom-6 tile — a reset, a
 * provider between deployments, a no-data card from every source at once — and
 * a square the size of a continent read "cannot tell" for the rest of the
 * session. "Cannot tell" reads as land, so a random teleport looking for
 * somewhere dry would happily drop you into the middle of an ocean it could
 * not see, and the climate model would call that ocean continental. It is the
 * same mistake as the Overpass mirror that answered success with nothing: a
 * failure kept as though it were an answer. A minute is long enough that a
 * teleport's seventy-odd probes cost one request rather than seventy, and
 * short enough that the next one recovers.
 */
const PROBE_RETRY_MS = 60000;

export class WaterMap {
  constructor() {
    this.source = null;
    this.masks = new Map();
    this.pending = new Map();
    /** When each square last failed to answer — see PROBE_RETRY_MS. */
    this.failedAt = new Map();
  }

  setSource(source, standbys = []) {
    this.source = source;
    this.standbys = standbys.filter(Boolean);
    this.masks.clear();
    this.pending.clear();
    this.failedAt.clear();
  }

  /** @returns {Promise<boolean>} */
  async isWater(lat, lon) {
    const mask = await this.maskFor(lat, lon);
    // No imagery to read — offline, blocked, or no CORS. There used to be a
    // generated coastline to fall back on; there is not one now, and inventing
    // a sea is exactly the kind of thing that put you in open water on dry
    // land. Unknown reads as land, which is the answer that does no harm.
    if (!mask) return false;
    const n = Math.pow(2, PROBE_ZOOM);
    const nx = lonToNormX(lon) * n;
    const ny = latToNormY(lat) * n;
    const px = clamp(Math.floor((nx - Math.floor(nx)) * MASK), 0, MASK - 1);
    const py = clamp(Math.floor((ny - Math.floor(ny)) * MASK), 0, MASK - 1);
    return mask[py * MASK + px] === 1;
  }

  /**
   * Fraction of land in a ring around a point (0 = open ocean, 1 = interior).
   * Feeds the seasonal temperature swing.
   */
  async landFraction(lat, lon, radiusKm = 320) {
    const samples = 8;
    let land = 0;
    let counted = 0;
    for (let i = 0; i < samples; i++) {
      const p = destination({ lat, lon }, (i / samples) * Math.PI * 2, radiusKm * 1000);
      try {
        const water = await this.isWater(p.lat, p.lon);
        counted++;
        if (!water) land++;
      } catch {
        /* ignore this sample */
      }
    }
    return counted ? land / counted : 0.6;
  }

  async maskFor(lat, lon) {
    const n = Math.pow(2, PROBE_ZOOM);
    const tile = {
      z: PROBE_ZOOM,
      x: wrapTileX(Math.floor(lonToNormX(lon) * n), PROBE_ZOOM),
      y: clamp(Math.floor(latToNormY(lat) * n), 0, n - 1),
    };
    const key = tileKey(tile.z, tile.x, tile.y);
    const cached = this.masks.get(key);
    if (cached !== undefined) return cached;
    const failed = this.failedAt.get(key);
    if (failed !== undefined) {
      if (performance.now() - failed < PROBE_RETRY_MS) return null;
      this.failedAt.delete(key);
    }
    const inflight = this.pending.get(key);
    if (inflight) return inflight;

    const job = this.buildMask(tile)
      .then((mask) => {
        // Nothing came back is a failure, not an answer. buildMask returns
        // null when every provider refused or served a no-data card, and that
        // is precisely the case that is worth asking about again later.
        if (mask) this.masks.set(key, mask);
        else this.failedAt.set(key, performance.now());
        return mask;
      })
      .catch(() => {
        this.failedAt.set(key, performance.now());
        return null;
      })
      .finally(() => this.pending.delete(key));

    this.pending.set(key, job);
    return job;
  }

  async buildMask(tile) {
    // Every provider in turn, because the answer to "is this the sea" must not
    // depend on whether one company has flown over it. Esri answers ground it
    // has never imaged with a grey card reading "Map data not yet available",
    // and a grey card is not blue — so the whole Southern Ocean read as dry
    // land, and a random teleport happily dropped you into it.
    const chain = [this.source, ...(this.standbys ?? [])].filter(Boolean);
    let bitmap = null;
    for (const source of chain) {
      if (!source.ready) await source.prepare();
      const url = source.urlFor(tile);
      if (!url) continue;
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(`probe ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const candidate = await createImageBitmap(new Blob([bytes]));
        if (isNoDataCard(bytes)) {
          candidate.close();
          continue;
        }
        bitmap = candidate;
        break;
      } catch {
        /* next provider */
      }
    }
    if (!bitmap) return null;

    const canvas = document.createElement('canvas');
    canvas.width = MASK;
    canvas.height = MASK;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0, MASK, MASK);
    bitmap.close();

    const pixels = ctx.getImageData(0, 0, MASK, MASK).data;
    const mask = new Uint8Array(MASK * MASK);
    for (let i = 0; i < MASK * MASK; i++) {
      mask[i] = isWaterPixel(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]) ? 1 : 0;
    }
    return mask;
  }
}

/**
 * Works for both photography (deep navy / teal) and drawn map tiles (pale
 * blue), while rejecting the two things that fool a naive blue test: snow and
 * cloud, which are bright and near-neutral.
 */
export function isWaterPixel(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const brightness = (r + g + b) / 3;
  if (brightness > 210 && max - min < 26) return false; // snow / cloud
  if (b <= r + 8) return false; // land is never notably blue-dominant
  if (g > b + 6) return false; // vegetation
  return true;
}

export const waterMap = new WaterMap();

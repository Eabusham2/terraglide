import { clamp } from '../core/math.js';
import { proceduralElevation } from '../tiles/procedural.js';
import { destination, latToNormY, lonToNormX, tileKey, wrapTileX } from './mercator.js';

/**
 * "Is this spot ocean?" — used by random teleport (the *explore seas* toggle)
 * and by the climate model (how continental a place feels).
 *
 * There is no offline coastline dataset in this project, so instead of shipping
 * one we read the answer off a single low-zoom imagery tile per region and
 * cache a 32x32 water mask from it. One small tile covers a whole continent's
 * worth of teleport attempts. With no imagery provider the generated terrain's
 * own sea level is used instead.
 */

const PROBE_ZOOM = 6;
const MASK = 32;

export class WaterMap {
  constructor() {
    this.source = null;
    this.masks = new Map();
    this.pending = new Map();
  }

  setSource(source) {
    this.source = source;
    this.masks.clear();
    this.pending.clear();
  }

  /** @returns {Promise<boolean>} */
  async isWater(lat, lon) {
    if (!this.source || this.source.synthetic) {
      return proceduralElevation(lonToNormX(lon), latToNormY(lat), 4) <= 0;
    }
    const mask = await this.maskFor(lat, lon);
    if (!mask) {
      // The imagery could not be read (offline, blocked, no CORS). Fall back to
      // the generated world's own sea level rather than guessing.
      return proceduralElevation(lonToNormX(lon), latToNormY(lat), 4) <= 0;
    }
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
    const inflight = this.pending.get(key);
    if (inflight) return inflight;

    const job = this.buildMask(tile)
      .then((mask) => {
        this.masks.set(key, mask);
        return mask;
      })
      .catch(() => {
        this.masks.set(key, null);
        return null;
      })
      .finally(() => this.pending.delete(key));

    this.pending.set(key, job);
    return job;
  }

  async buildMask(tile) {
    if (!this.source) return null;
    if (!this.source.ready) await this.source.prepare();
    const url = this.source.urlFor(tile);
    if (!url) return null;

    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error(`probe ${res.status}`);
    const bitmap = await createImageBitmap(await res.blob());

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

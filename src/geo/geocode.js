import { Emitter } from '../core/events.js';
import { settings } from '../core/settings.js';
import { appleMaps } from './appleMaps.js';

/**
 * Reverse geocoding for the address readout, plus forward search for the world
 * map. Two backends: Google (if a key is present) and Nominatim (keyless).
 *
 * Nominatim's usage policy caps this at roughly one request a second from a
 * single user, so lookups are grid-quantised, cached, coalesced and throttled.
 * Nothing here bulk-downloads anything.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const CACHE_LIMIT = 400;

/** ~110 m grid: fine enough for a street name, coarse enough to cache well. */
function gridKey(lat, lon) {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

export class Geocoder extends Emitter {
  constructor() {
    super();
    this.cache = new Map();
    this.pending = null;
    this.queued = null;
    this.lastRequestAt = 0;
    this.backoffUntil = 0;
    this.lastResult = null;
  }

  get minIntervalMs() {
    return settings.get('googleKey') ? 250 : 1300;
  }

  /** Cached address for a point, or null. Schedules a lookup when missing. */
  lookup(lat, lon) {
    if (!settings.get('addressLookup')) return null;
    const key = gridKey(lat, lon);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    this.queued = { lat, lon, key };
    this.pump();
    return null;
  }

  pump() {
    if (this.pending || !this.queued) return;
    const now = performance.now();
    if (now < this.backoffUntil) return;
    if (now - this.lastRequestAt < this.minIntervalMs) {
      setTimeout(() => this.pump(), this.minIntervalMs - (now - this.lastRequestAt) + 20);
      return;
    }
    const job = this.queued;
    this.queued = null;
    this.lastRequestAt = now;
    this.pending = this.reverse(job.lat, job.lon)
      .then((place) => {
        this.remember(job.key, place);
        this.lastResult = place;
        this.emit('address', place);
      })
      .catch(() => {
        // Back off on network trouble instead of hammering a public endpoint.
        this.backoffUntil = performance.now() + 30000;
        // And say so. Leaving the last word as "Locating…" means the HUD goes
        // on promising an answer that is half a minute away at best and never
        // coming at worst; the coordinates beneath it are the real reading and
        // they were right all along.
        this.emit('address', { label: 'Address unavailable', detail: '', source: 'none' });
      })
      .finally(() => {
        this.pending = null;
        this.pump();
      });
  }

  remember(key, value) {
    if (this.cache.size >= CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, value);
  }

  async reverse(lat, lon) {
    // Apple first where a Maps token is pasted: its addresses are the ones you
    // would read in Apple Maps, and the Server API answers a browser directly.
    if (appleMaps.available) {
      const place = await appleMaps.reverse(lat, lon);
      if (place) return place;
      // Apple knows the world but has nothing addressable here. That is an
      // answer, not a failure, and it is the same answer Nominatim gives.
      return { label: 'Unmapped location', detail: 'Nothing addressable here', source: 'apple' };
    }
    const key = settings.get('googleKey');
    if (key) {
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}` +
        `&result_type=street_address|route|locality|administrative_area_level_1|country&key=${encodeURIComponent(key)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`geocode ${res.status}`);
      const data = await res.json();
      const first = data.results && data.results[0];
      if (!first) return { label: 'Unmapped location', detail: '', source: 'google' };
      return {
        label: shorten(first.formatted_address),
        detail: first.formatted_address,
        source: 'google',
      };
    }

    const url =
      `${NOMINATIM}/reverse?format=jsonv2&zoom=16&addressdetails=1` +
      `&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const data = await res.json();
    if (!data || data.error || !data.address) {
      // No addressable feature is not the same as water. Nominatim has
      // nothing to say about the middle of the Simpson Desert either, and
      // announcing "Open water" over a sand dune is a claim about the world
      // rather than a report of what the lookup returned.
      return { label: 'Unmapped location', detail: 'Nothing addressable here', source: 'nominatim' };
    }
    return {
      label: composeAddress(data.address),
      detail: data.display_name ?? '',
      source: 'nominatim',
    };
  }

  /** Forward search for the world map's "go to" box. */
  async search(query, limit = 6) {
    const trimmed = query.trim();
    if (!trimmed) return [];
    if (appleMaps.available) return appleMaps.search(trimmed, limit);
    const key = settings.get('googleKey');
    if (key) {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(trimmed)}&key=${encodeURIComponent(key)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`geocode ${res.status}`);
      const data = await res.json();
      return (data.results ?? []).slice(0, limit).map((r) => ({
        label: r.formatted_address,
        lat: r.geometry.location.lat,
        lon: r.geometry.location.lng,
      }));
    }
    const url = `${NOMINATIM}/search?format=jsonv2&limit=${limit}&q=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const data = await res.json();
    return (data ?? []).map((r) => ({
      label: r.display_name,
      lat: Number(r.lat),
      lon: Number(r.lon),
    }));
  }
}

function composeAddress(a) {
  const near =
    a.road ??
    a.pedestrian ??
    a.footway ??
    a.neighbourhood ??
    a.hamlet ??
    a.suburb ??
    a.natural ??
    a.water ??
    '';
  const place = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? '';
  const region = a.state ?? a.province ?? a.region ?? '';
  const country = a.country ?? '';
  const parts = [near, place, region, country].filter(Boolean);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  return unique.slice(0, 3).join(', ') || country || 'Unmapped location';
}

function shorten(formatted) {
  const parts = String(formatted).split(',').map((s) => s.trim());
  return parts.slice(0, 3).join(', ');
}

export const geocoder = new Geocoder();

import { settings } from '../core/settings.js';

/**
 * Apple Maps, through the Maps Server API.
 *
 * What Apple actually publishes for the web, and what it does not, decided the
 * shape of this file. MapKit JS will draw you Apple's satellite imagery, its
 * Look Around street photography and its place cards — but only *inside
 * Apple's own map view*. There is no tile endpoint behind any of it, so none
 * of it can be a texture on a terrain mesh; and there is no elevation service
 * and no 3D at all on the web. Flyover is native-only. Maps Web Snapshots
 * returns raster images, but every URL has to be signed with your private key,
 * which cannot leave a server, and it is a static-embed service rather than a
 * tile source.
 *
 * What is left is real and genuinely useful: geocoding and place search, over
 * plain HTTPS, with `access-control-allow-origin: *` and `Authorization` in
 * the allowed headers — so a browser can call it directly, which is unusual
 * enough among mapping APIs to be worth saying out loud.
 *
 * The token you paste is the same Maps token MapKit JS uses: a JWT you sign
 * with the private key from your Apple Developer account. It is exchanged here
 * for a short-lived access token, which is what the endpoints actually want,
 * and re-exchanged a minute before it lapses.
 */

const BASE = 'https://maps-api.apple.com/v1';

class AppleMaps {
  constructor() {
    this.access = '';
    this.expires = 0;
    this.pending = null;
    /** The token the current access token was minted from. */
    this.mintedFrom = '';
  }

  get token() {
    return settings.get('appleMapsToken').trim();
  }

  get available() {
    return this.token.length > 0;
  }

  /**
   * A current access token, exchanging the Maps token for one if need be.
   *
   * One exchange in flight at a time: an arrival fires a reverse lookup and
   * the map fires a search, and both would otherwise mint their own.
   */
  async accessToken() {
    const jwt = this.token;
    if (!jwt) throw new Error('no Apple Maps token');
    if (this.access && this.mintedFrom === jwt && performance.now() < this.expires) return this.access;
    if (this.pending) return this.pending;
    this.pending = fetch(`${BASE}/token`, { headers: { Authorization: `Bearer ${jwt}` } })
      .then(async (res) => {
        if (res.status === 401) throw new Error('Apple rejected the token (401)');
        if (!res.ok) throw new Error(`Apple token ${res.status}`);
        const data = await res.json();
        if (!data.accessToken) throw new Error('Apple returned no access token');
        this.access = data.accessToken;
        this.mintedFrom = jwt;
        // A minute of margin, so a request never sets off with one about to lapse.
        this.expires = performance.now() + Math.max(60, (data.expiresInSeconds ?? 1800) - 60) * 1000;
        return this.access;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  async call(path) {
    const access = await this.accessToken();
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${access}` } });
    if (res.status === 401) {
      // The access token lapsed early, or the Maps token was replaced. One retry.
      this.access = '';
      this.expires = 0;
      const fresh = await this.accessToken();
      const again = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${fresh}` } });
      if (!again.ok) throw new Error(`Apple Maps ${again.status}`);
      return again.json();
    }
    if (!res.ok) throw new Error(`Apple Maps ${res.status}`);
    return res.json();
  }

  /** Nearest address to a point, or null when Apple has nothing there. */
  async reverse(lat, lon) {
    const data = await this.call(`/reverseGeocode?loc=${lat.toFixed(6)}%2C${lon.toFixed(6)}`);
    const first = data.results && data.results[0];
    if (!first) return null;
    const lines = first.formattedAddressLines ?? [];
    return {
      label: lines.slice(0, 2).join(', ') || first.name || first.country || 'Unmapped location',
      detail: lines.join(', '),
      source: 'apple',
    };
  }

  /** Places matching a query, for the world map's search box. */
  async search(query, limit = 6) {
    const data = await this.call(`/search?q=${encodeURIComponent(query)}&limitToCountries=`);
    return (data.results ?? []).slice(0, limit).map((r) => ({
      label: r.name ?? (r.formattedAddressLines ?? []).join(', '),
      lat: r.coordinate.latitude,
      lon: r.coordinate.longitude,
    }));
  }
}

export const appleMaps = new AppleMaps();

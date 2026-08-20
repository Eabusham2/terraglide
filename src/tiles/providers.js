import { quadKey } from '../geo/mercator.js';

/**
 * Provider registry. TerraGlide ships with every key slot empty; a provider is
 * only contacted once you pick it in Settings. Each descriptor knows how to
 * turn a tile id into a URL, how deep it can be zoomed, and what attribution
 * has to stay on screen.
 */

export const IMAGERY_PROVIDERS = [
  {
    id: 'offline',
    label: 'Offline (generated terrain)',
    kind: 'synthetic',
    needsKey: null,
    maxZoom: 20,
    attribution: 'Locally generated terrain — no map data',
    note: 'Works with no account and no network. Terrain is invented, not real.',
  },
  {
    id: 'esri',
    label: 'Esri World Imagery',
    kind: 'xyz',
    needsKey: null,
    maxZoom: 19,
    template: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    note: 'Keyless. Fair use only — do not bulk download.',
  },
  {
    id: 'google',
    label: 'Google Maps (satellite)',
    kind: 'google',
    needsKey: 'googleKey',
    maxZoom: 21,
    attribution: 'Imagery © Google',
    note: 'Needs a Map Tiles API key. A session token is created on first use.',
  },
  {
    id: 'bing',
    label: 'Bing Maps (aerial)',
    kind: 'bing',
    needsKey: 'bingKey',
    maxZoom: 20,
    attribution: 'Imagery © Microsoft, Maxar',
    note:
      'Bing still has coverage and zoom levels Azure has not inherited, so it is '
      + 'worth keeping alongside. Tile URLs come from the imagery metadata service. '
      + 'Microsoft is retiring it, so treat it as the older of the two.',
  },
  {
    id: 'azure',
    label: 'Azure Maps (satellite)',
    kind: 'xyz',
    needsKey: 'azureKey',
    maxZoom: 19,
    template:
      'https://atlas.microsoft.com/map/tile?api-version=2024-04-01' +
      '&tilesetId=microsoft.imagery&zoom={z}&x={x}&y={y}&subscription-key={key}',
    attribution: 'Imagery © Microsoft, Airbus DS, Maxar',
    note:
      'Microsoft\u2019s current satellite imagery, on an Azure Maps subscription key. ' +
      'This is where Bing Maps is being retired to. Imagery only \u2014 Azure serves no ' +
      'photogrammetry, so it cannot drive the 3D option.',
  },
  {
    id: 'mapbox',
    label: 'Mapbox Satellite',
    kind: 'xyz',
    needsKey: 'mapboxKey',
    maxZoom: 22,
    template: 'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token={key}',
    attribution: '© Mapbox © Maxar',
  },
  {
    id: 'osm',
    label: 'OpenStreetMap (map, not satellite)',
    kind: 'xyz',
    needsKey: null,
    maxZoom: 19,
    template: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    // Not offered as flight imagery: a drawn map draped over terrain looks
    // like a mistake. It is still used, though — it is the layer the maps
    // draw unexplored ground with, which is what a street map is good for.
    hidden: true,
    note: 'Drawn map rather than photography. Used for unexplored ground on the maps.',
  },
];

export const ELEVATION_PROVIDERS = [
  {
    id: 'procedural',
    label: 'Generated relief',
    kind: 'synthetic',
    needsKey: null,
    maxZoom: 14,
    attribution: '',
    note: 'Plausible invented relief. No network, no key, never wrong-looking flat.',
  },
  {
    id: 'mapbox',
    label: 'Mapbox Terrain-RGB',
    kind: 'terrain-rgb',
    needsKey: 'mapboxKey',
    maxZoom: 15,
    template: 'https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.pngraw?access_token={key}',
    attribution: '© Mapbox',
  },
  {
    id: 'terrarium',
    label: 'AWS Terrain Tiles (Terrarium)',
    kind: 'terrarium',
    needsKey: null,
    maxZoom: 14,
    template: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    attribution: 'Elevation: AWS Terrain Tiles, SRTM/GMTED',
    note: 'Public dataset; availability is not guaranteed.',
  },
];

export const PANORAMA_PROVIDERS = [
  { id: 'none', label: 'Off', needsKey: null, attribution: '' },
  {
    id: 'google',
    label: 'Google Street View',
    needsKey: 'googleKey',
    attribution: 'Street-level imagery © Google',
    note: 'Uses the Street View Static API; six faces are stitched into a cube.',
  },
  {
    id: 'mapillary',
    label: 'Mapillary',
    needsKey: 'mapillaryToken',
    attribution: 'Street-level imagery © Mapillary contributors',
    note: 'Community 360 photos. Coverage is patchy but the licence is friendly.',
  },
];

export function findProvider(list, id) {
  return list.find((p) => p.id === id) ?? list[0];
}

function fillTemplate(template, tile, key) {
  return template
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y))
    .replace('{key}', encodeURIComponent(key ?? ''));
}

/**
 * Resolves a provider descriptor plus the current keys into something that can
 * hand out tile URLs. Providers needing a handshake (Google sessions, Bing
 * metadata) do it once, lazily, and cache the result.
 */
export class TileSource {
  constructor(descriptor, keys) {
    this.descriptor = descriptor;
    this.keys = keys;
    this.bingTemplate = null;
    this.state = 'idle'; // idle | preparing | ready | needs-key | error
    this.error = '';
    this.googleSession = null;
    this.preparing = null;
  }

  get id() {
    return this.descriptor.id;
  }

  get maxZoom() {
    return this.descriptor.maxZoom;
  }

  get attribution() {
    return this.descriptor.attribution;
  }

  get synthetic() {
    return this.descriptor.kind === 'synthetic';
  }

  get key() {
    const slot = this.descriptor.needsKey;
    return slot ? (this.keys[slot] ?? '') : '';
  }

  /** True when tiles can be requested right now. */
  get ready() {
    return this.synthetic || this.state === 'ready';
  }

  async prepare() {
    if (this.synthetic) {
      this.state = 'ready';
      return;
    }
    if (this.state === 'ready') return;
    if (this.preparing) return this.preparing;

    if (this.descriptor.needsKey && !this.key) {
      this.state = 'needs-key';
      this.error = 'No API key set for this provider.';
      return;
    }

    this.state = 'preparing';
    this.preparing = (async () => {
      try {
        if (this.descriptor.kind === 'bing') await this.prepareBing();
        else if (this.descriptor.kind === 'google') await this.prepareGoogle();
        this.state = 'ready';
        this.error = '';
      } catch (err) {
        this.state = 'error';
        this.error = err instanceof Error ? err.message : String(err);
      } finally {
        this.preparing = null;
      }
    })();
    return this.preparing;
  }


  async prepareBing() {
    const url =
      'https://dev.virtualearth.net/REST/v1/Imagery/Metadata/Aerial' +
      `?output=json&include=ImageryProviders&uriScheme=https&key=${encodeURIComponent(this.key)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Bing metadata failed (${res.status})`);
    const data = await res.json();
    const resource = data?.resourceSets?.[0]?.resources?.[0];
    if (!resource?.imageUrl) throw new Error('Bing metadata had no imageUrl');
    this.bingTemplate = resource.imageUrl;
    this.bingSubdomains = resource.imageUrlSubdomains ?? [''];
  }

  async prepareGoogle() {
    const res = await fetch(
      `https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(this.key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapType: 'satellite', language: 'en-US', region: 'US' }),
      },
    );
    if (!res.ok) throw new Error(`Google session failed (${res.status})`);
    const data = await res.json();
    if (!data.session) throw new Error('Google session token missing');
    this.googleSession = data.session;
  }

  /** URL for a tile, or null when the source generates tiles locally. */
  urlFor(tile) {
    const d = this.descriptor;
    if (d.kind === 'synthetic') return null;
    if (d.kind === 'bing') {
      if (!this.bingTemplate) return null;
      const subs = this.bingSubdomains ?? [''];
      const sub = subs[(tile.x + tile.y) % subs.length];
      return this.bingTemplate
        .replace('{subdomain}', sub)
        .replace('{quadkey}', quadKey(tile))
        .replace('{culture}', 'en-US');
    }
    if (d.kind === 'google') {
      if (!this.googleSession) return null;
      return `https://tile.googleapis.com/v1/2dtiles/${tile.z}/${tile.x}/${tile.y}?session=${encodeURIComponent(this.googleSession)}&key=${encodeURIComponent(this.key)}`;
    }
    if (!d.template) return null;
    return fillTemplate(d.template, tile, this.key);
  }

  /** 'imagery' | 'terrain-rgb' | 'terrarium' — tells the worker how to decode. */
  get decode() {
    const kind = this.descriptor.kind;
    if (kind === 'terrain-rgb' || kind === 'terrarium') return kind;
    return 'imagery';
  }
}

export function createImagerySource(settingsValues) {
  const descriptor = findProvider(IMAGERY_PROVIDERS, settingsValues.imageryProvider);
  return new TileSource(descriptor, settingsValues);
}

export function createElevationSource(settingsValues) {
  const descriptor = findProvider(ELEVATION_PROVIDERS, settingsValues.elevationProvider);
  return new TileSource(descriptor, settingsValues);
}

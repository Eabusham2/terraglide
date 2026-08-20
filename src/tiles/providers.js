import { quadKey } from '../geo/mercator.js';
import { BING_SIDE, GOOGLE_SIDE, encodePolyline, googleSamplePoints, tileBounds } from './elevationGrid.js';

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
    recommended: true,
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
    id: 'maxar',
    label: 'Maxar SecureWatch',
    kind: 'xyz',
    needsKey: 'maxarConnectId',
    maxZoom: 20,
    template:
      'https://securewatch.digitalglobe.com/earthservice/wmtsaccess?connectid={key}' +
      '&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=DigitalGlobe:ImageryTileService' +
      '&FORMAT=image/jpeg&TileMatrixSet=EPSG:3857&TileMatrix=EPSG:3857:{z}&TileRow={y}&TileCol={x}',
    attribution: 'Imagery © Maxar Technologies',
    note:
      'Maxar\u2019s own service, on a SecureWatch connect ID. That is an enterprise '
      + 'credential rather than something you sign up for in an afternoon \u2014 and if '
      + 'you have not got one you are not missing the imagery, only the direct '
      + 'route to it: Esri, Bing and Google all serve Maxar scenes and all three '
      + 'credit them.',
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
    id: 'bing-elevation',
    label: 'Bing Maps elevation',
    kind: 'bing-elevation',
    needsKey: 'bingKey',
    // Deliberately shallow. Every tile is one call against your own Bing
    // account, so a tile has to be worth making a call for: at zoom 12 one
    // covers about ten kilometres, and 32 by 32 samples across it is roughly
    // three hundred metre spacing — coarser than Terrarium, and enough to
    // shape a landscape.
    maxZoom: 12,
    attribution: 'Elevation © Microsoft',
    note:
      'Bing\u2019s Elevation service, on a Bing Maps key. It answers with a grid of '
      + 'heights rather than a picture, one request per tile against your own quota, '
      + 'and it is coarser than the raster sources \u2014 pick it because you have the '
      + 'key, not because it is sharper.',
  },
  {
    id: 'google-elevation',
    label: 'Google Maps elevation',
    kind: 'google-elevation',
    needsKey: 'googleKey',
    maxZoom: 12,
    attribution: 'Elevation © Google',
    note:
      'The Google Elevation API, on a Maps Platform key. It takes a list of points '
      + 'rather than an area, so a tile is sent as an encoded polyline of 22 by 22 '
      + 'samples \u2014 coarse, and billed per request on your own account. Google\u2019s '
      + 'real terrain detail is in the photorealistic 3D tiles, not here.',
  },
  {
    id: 'terrarium',
    label: 'AWS Terrain Tiles (Terrarium)',
    kind: 'terrarium',
    needsKey: null,
    recommended: true,
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
    recommended: true,
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

/**
 * The one to pick if you have not got a key for anything.
 *
 * Marked on the descriptor rather than worked out here, so the answer lives
 * next to the reasons for it. Esri and Terrarium are the picks: both are open,
 * both cover the whole planet, and neither asks you for an account before you
 * can fly anywhere.
 */
export function recommendedProvider(list) {
  return list.find((p) => p.recommended && !p.needsKey) ?? null;
}

/**
 * Label for a provider in a menu, with the recommendation on the end.
 */
export function providerLabel(descriptor) {
  return descriptor.recommended ? `${descriptor.label} (recommended)` : descriptor.label;
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
    /** Set when this provider is standing in for one that had no key. */
    this.substitutedFor = null;
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
    if (d.kind === 'bing-elevation') {
      const b = tileBounds(tile);
      // Bounds are south, west, north, east — Bing's order, not ours.
      return (
        'https://dev.virtualearth.net/REST/v1/Elevation/Bounds?bounds=' +
        `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}` +
        `&rows=${BING_SIDE}&cols=${BING_SIDE}&heights=ellipsoid&key=${encodeURIComponent(this.key)}`
      );
    }
    if (d.kind === 'google-elevation') {
      const encoded = encodePolyline(googleSamplePoints(tile, GOOGLE_SIDE));
      return (
        'https://maps.googleapis.com/maps/api/elevation/json?locations=enc:' +
        `${encodeURIComponent(encoded)}&key=${encodeURIComponent(this.key)}`
      );
    }
    if (!d.template) return null;
    return fillTemplate(d.template, tile, this.key);
  }

  /** How the worker should read the answer: a picture, or a grid of numbers. */
  get decode() {
    const kind = this.descriptor.kind;
    if (
      kind === 'terrain-rgb' ||
      kind === 'terrarium' ||
      kind === 'bing-elevation' ||
      kind === 'google-elevation'
    ) {
      return kind;
    }
    return 'imagery';
  }
}

/**
 * Resolve a chosen provider to one that can actually serve tiles.
 *
 * Picking a provider and leaving its key blank used to mean no map at all: the
 * source sat in `needs-key` and the world fell back to generated terrain, even
 * though there is a perfectly good keyless provider sitting in the same list.
 * It substitutes now, and says so — the status line names both, so nobody is
 * left thinking they are looking at Google's imagery when they are not.
 */
function withKeylessFallback(list, descriptor, values) {
  if (!descriptor.needsKey || values[descriptor.needsKey]) return new TileSource(descriptor, values);
  const fallback = recommendedProvider(list);
  if (!fallback || fallback.id === descriptor.id) return new TileSource(descriptor, values);
  const source = new TileSource(fallback, values);
  source.substitutedFor = descriptor;
  return source;
}

export function createImagerySource(settingsValues) {
  const descriptor = findProvider(IMAGERY_PROVIDERS, settingsValues.imageryProvider);
  return withKeylessFallback(IMAGERY_PROVIDERS, descriptor, settingsValues);
}

export function createElevationSource(settingsValues) {
  const descriptor = findProvider(ELEVATION_PROVIDERS, settingsValues.elevationProvider);
  return withKeylessFallback(ELEVATION_PROVIDERS, descriptor, settingsValues);
}

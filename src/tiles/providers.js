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
    id: 'sentinel2',
    label: 'Sentinel-2 cloudless',
    kind: 'xyz',
    needsKey: null,
    maxZoom: 16,
    template: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
    attribution: 'Sentinel-2 cloudless by EOX IT Services, from modified Copernicus Sentinel data',
    note:
      'Keyless, whole planet, ten metres a pixel, and \u2014 the point of it \u2014 a '
      + 'cloudless mosaic, so there is never a white smear where the weather was '
      + 'on the day the satellite went over. Softer than Esri close up; better than '
      + 'Esri anywhere Esri has only old low-resolution cover.',
  },
  {
    id: 'usgs',
    label: 'USGS imagery (United States)',
    kind: 'xyz',
    needsKey: null,
    maxZoom: 16,
    template:
      'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery courtesy of the U.S. Geological Survey, The National Map',
    note:
      'Keyless and very good, over the United States and nowhere else. Outside it '
      + 'every tile is a 404 and you get generated ground, so this is one to pick '
      + 'when you know where you are going.',
  },
  {
    id: 'gibs',
    label: 'NASA GIBS (this week\u2019s Earth)',
    kind: 'xyz',
    needsKey: null,
    maxZoom: 9,
    template:
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor' +
      '/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg',
    attribution: 'Imagery courtesy of NASA EOSDIS GIBS / VIIRS',
    note:
      'What the planet looked like a few days ago, cloud and snow and all, from '
      + 'the VIIRS instrument. Keyless and global, but only nine zoom levels deep '
      + '\u2014 about six hundred metres a pixel \u2014 so it is a view from orbit '
      + 'rather than something to fly a valley in.',
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
    id: 'cesium-ion',
    label: 'Cesium ion imagery',
    kind: 'ion',
    needsKey: 'cesiumToken',
    maxZoom: 19,
    attribution: 'Imagery served by Cesium ion',
    note:
      'Anything raster in your Cesium ion account, on the same token the '
      + 'photorealistic 3D option uses \u2014 Bing Aerial is asset 2 and is what '
      + 'this asks for unless you change it in Settings. ion meters it per '
      + 'account, which is why it needs the token: there is no keyless door to '
      + 'it, and the API says so itself if you knock without one.',
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
  {
    id: 'esri-street',
    label: 'Esri World Street Map',
    kind: 'xyz',
    needsKey: null,
    maxZoom: 19,
    template:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Map \u00a9 Esri',
    // Same job as the OpenStreetMap layer above and offered for the same
    // reason everything else here has a second option: OSM's raster server is
    // one community machine with a fair-use policy, and when it says no the
    // maps should still have a street map to draw.
    hidden: true,
    note: 'Drawn map. The standby for unexplored ground when the OSM tile server is busy.',
  },
  {
    id: 'openfreemap',
    label: 'OpenFreeMap (vector street map)',
    kind: 'openmaptiles',
    needsKey: null,
    // The vectors stop at 14 and are drawn at any zoom above it: one tile of
    // geometry covers every level below itself, which is the whole point of
    // serving geometry instead of pictures.
    maxZoom: 14,
    attribution:
      '\u00a9 OpenFreeMap \u00a9 OpenMapTiles, map data \u00a9 OpenStreetMap contributors',
    hidden: true,
    note:
      'The roads and coastlines themselves rather than a picture of them, drawn '
      + 'here. Keyless and explicitly unmetered, which the community raster '
      + 'servers are not \u2014 so it is the one to lean on when a map is being '
      + 'panned around rather than looked at once.',
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
 * Label for a provider in a menu.
 *
 * Two things are worth knowing before you pick one and both belong on the line
 * rather than three clicks away: whether it is the one to take if you have no
 * opinion, and whether choosing it means going and getting a key. "Keyless" is
 * the more useful of the two most of the time — this whole project is built so
 * that you never have to sign up for anything, and a menu that does not say
 * which entries honour that makes you find out the hard way.
 */
export function providerLabel(descriptor) {
  const notes = [];
  if (descriptor.recommended) notes.push('recommended');
  if (descriptor.kind !== 'synthetic') notes.push(descriptor.needsKey ? 'needs a key' : 'keyless');
  return notes.length ? `${descriptor.label} (${notes.join(', ')})` : descriptor.label;
}

/**
 * How far back to ask NASA for "today".
 *
 * The near-real-time products are published a few hours behind the pass, but
 * not uniformly, and a date that has not finished processing answers with a
 * transparent tile rather than an error — which looks exactly like a hole in
 * the world. Three days back is always there.
 */
const GIBS_LAG_DAYS = 3;

export function gibsDate(now = Date.now()) {
  return new Date(now - GIBS_LAG_DAYS * 86400000).toISOString().slice(0, 10);
}

function fillTemplate(template, tile, key) {
  return template
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y))
    .replace('{date}', gibsDate())
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
    this.vectorTemplate = null;
    this.ionTemplate = null;
    /** Whatever ion says has to be shown for this asset. */
    this.ionAttribution = '';
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
        else if (this.descriptor.kind === 'openmaptiles') await this.prepareOpenMapTiles();
        else if (this.descriptor.kind === 'ion') await this.prepareIon();
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

  /**
   * OpenFreeMap republishes the planet every few weeks and puts the build date
   * in the tile path, so there is no stable URL to hard-code — the TileJSON is
   * the stable thing and it names the current one. Fetched once.
   */
  async prepareOpenMapTiles() {
    const res = await fetch('https://tiles.openfreemap.org/planet');
    if (!res.ok) throw new Error(`OpenFreeMap TileJSON failed (${res.status})`);
    const data = await res.json();
    const template = data?.tiles?.[0];
    if (!template) throw new Error('OpenFreeMap TileJSON had no tile template');
    this.vectorTemplate = template;
  }

  /**
   * Cesium ion, for imagery rather than for the photogrammetry.
   *
   * Same door as the 3D route already knocks on: a token is exchanged for a
   * short-lived one plus wherever the tiles actually live. ion serves two
   * shapes through it and which you get depends on the asset — its own rasters
   * come back as a template to fill in, and the ones it resells from Bing come
   * back as Bing's own quadkey URL with a key attached. Both are handled;
   * anything else is reported rather than guessed at.
   */
  async prepareIon() {
    const asset = this.keys.cesiumImageryAsset || 2;
    const res = await fetch(
      `https://api.cesium.com/v1/assets/${encodeURIComponent(asset)}/endpoint` +
        `?access_token=${encodeURIComponent(this.key)}`,
    );
    if (!res.ok) throw new Error(`Cesium ion asset ${asset} refused the token (${res.status})`);
    const data = await res.json();

    if (data.externalType === 'BING' || data.options?.mapStyle) {
      const base = (data.options?.url ?? 'https://dev.virtualearth.net').replace(/\/$/, '');
      const key = data.options?.key ?? '';
      const meta = await fetch(
        `${base}/REST/v1/Imagery/Metadata/Aerial?output=json&include=ImageryProviders` +
          `&uriScheme=https&key=${encodeURIComponent(key)}`,
      );
      if (!meta.ok) throw new Error(`Bing metadata via ion failed (${meta.status})`);
      const resource = (await meta.json())?.resourceSets?.[0]?.resources?.[0];
      if (!resource?.imageUrl) throw new Error('Bing metadata via ion had no imageUrl');
      this.bingTemplate = resource.imageUrl;
      this.bingSubdomains = resource.imageUrlSubdomains ?? [''];
      this.ionTemplate = null;
    } else if (data.url) {
      // An ion-hosted raster: a tile scheme under a base URL, with the
      // short-lived token on every request.
      const token = data.accessToken ? `?access_token=${encodeURIComponent(data.accessToken)}` : '';
      this.ionTemplate = `${data.url.replace(/\/$/, '')}/{z}/{x}/{y}.png${token}`;
    } else {
      throw new Error(`Cesium ion asset ${asset} is not raster imagery`);
    }
    if (Array.isArray(data.attributions) && data.attributions.length > 0) {
      this.ionAttribution = data.attributions
        .map((a) => String(a.html ?? a.text ?? '').replace(/<[^>]*>/g, '').trim())
        .filter(Boolean)
        .join(' · ');
    }
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
    if (d.kind === 'ion') {
      // Bing-backed assets come out as Bing tiles; ion's own as a template.
      if (this.bingTemplate) {
        const subs = this.bingSubdomains ?? [''];
        return this.bingTemplate
          .replace('{subdomain}', subs[(tile.x + tile.y) % subs.length])
          .replace('{quadkey}', quadKey(tile))
          .replace('{culture}', 'en-US');
      }
      if (!this.ionTemplate) return null;
      return fillTemplate(this.ionTemplate, tile, this.key);
    }
    if (d.kind === 'openmaptiles') {
      if (!this.vectorTemplate) return null;
      return fillTemplate(this.vectorTemplate, tile, this.key);
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
    // Geometry rather than a picture: the caller draws it. Only the flat maps
    // know how, so this provider is not offered as flight imagery.
    if (kind === 'openmaptiles') return 'vector';
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

/**
 * Actually knock on every provider's door and report what answers.
 *
 * There is a real gap between "this provider is in the list" and "this
 * provider is serving you tiles right now", and nothing in the interface used
 * to close it: pick Google without a key and the ground simply stays as it
 * was, which reads as the option being broken rather than as an account being
 * required. So this fetches one real tile from each, at a place you choose,
 * and says what came back — the status code, the size, how long it took.
 *
 * Keys are used exactly as the game uses them and never leave the browser.
 * One tile each is a rounding error against anybody's quota.
 *
 * @param {Array} list  IMAGERY_PROVIDERS or ELEVATION_PROVIDERS
 * @param {object} values the settings store's values, for the keys
 * @param {{z:number,x:number,y:number}} tile where to ask about
 * @param {(result:object)=>void} [onResult] called as each one finishes
 */
export async function testProviders(list, values, tile, onResult) {
  const results = [];
  for (const descriptor of list) {
    const result = { id: descriptor.id, label: descriptor.label, state: 'checking', detail: '' };
    results.push(result);
    if (descriptor.kind === 'synthetic') {
      result.state = 'ok';
      result.detail = 'generated in the browser — no network involved';
      onResult?.(result);
      continue;
    }
    if (descriptor.needsKey && !values[descriptor.needsKey]) {
      result.state = 'no-key';
      const name = KEY_LABELS[descriptor.needsKey] ?? descriptor.needsKey;
      result.detail = `needs ${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}, and none is saved`;
      onResult?.(result);
      continue;
    }
    const started = performance.now();
    // Ask each one at a zoom it actually publishes. NASA's global product
    // stops at nine and answers a request for fourteen with a bad-request
    // error, which is a true fact about the request and a lie about the
    // provider — it would have marked GIBS broken every single time.
    const depth = Math.min(tile.z, descriptor.maxZoom ?? tile.z);
    const shift = tile.z - depth;
    const asked = { z: depth, x: tile.x >> shift, y: tile.y >> shift };
    try {
      const source = new TileSource(descriptor, values);
      await source.prepare();
      if (source.state === 'error') throw new Error(source.error);
      const url = source.urlFor(asked);
      if (url === null) throw new Error('no URL for this tile');
      const response = await fetch(url, { cache: 'no-store' });
      const bytes = (await response.arrayBuffer()).byteLength;
      const ms = Math.round(performance.now() - started);
      const where = depth === tile.z ? '' : `, at z${depth} which is its deepest`;
      if (response.status === 404) {
        // Not a fault. Several of these cover one country, and a miss outside
        // it is the honest answer rather than a broken server.
        result.state = 'no-cover';
        result.detail = 'nothing here \u2014 this one does not cover where you are standing';
      } else if (!response.ok) {
        result.state = 'error';
        result.detail = `HTTP ${response.status} in ${ms} ms`;
      } else if (bytes < 100) {
        // A 200 that is forty bytes long is a refusal wearing a success code.
        result.state = 'error';
        result.detail = `answered ${bytes} bytes \u2014 too small to be a tile`;
      } else {
        result.state = 'ok';
        result.detail = `${(bytes / 1024).toFixed(0)} kB in ${ms} ms${where}`;
      }
    } catch (err) {
      result.state = 'error';
      result.detail = err instanceof Error ? err.message : String(err);
    }
    onResult?.(result);
  }
  return results;
}

/** Human names for the key slots, so an error can say what to go and get. */
const KEY_LABELS = {
  googleKey: 'Google Maps Platform key',
  bingKey: 'Bing Maps key',
  azureKey: 'Azure Maps subscription key',
  mapboxKey: 'Mapbox access token',
  cesiumToken: 'Cesium ion token',
  mapillaryToken: 'Mapillary token',
  maxarConnectId: 'Maxar SecureWatch connect ID',
};

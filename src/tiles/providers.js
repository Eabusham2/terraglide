import { latToNormY, lonToNormX, quadKey } from '../geo/mercator.js';
import { localeRegion } from '../core/units.js';
import { isNoDataCard } from './noData.js';
import { BING_SIDE, GOOGLE_SIDE, encodePolyline, googleSamplePoints, tileBounds } from './elevationGrid.js';

/**
 * Provider registry. TerraGlide ships with every key slot empty; a provider is
 * only contacted once you pick it in Settings. Each descriptor knows how to
 * turn a tile id into a URL, how deep it can be zoomed, and what attribution
 * has to stay on screen.
 */

export const IMAGERY_PROVIDERS = [
  {
    id: 'esri',
    label: 'Esri World Imagery',
    kind: 'xyz',
    needsKey: null,
    recommended: true,
    /**
     * Not a coverage number any more: a hard stop, with the real depth
     * measured per square.
     *
     * Nineteen is what Esri guarantee everywhere, and taking it as the ceiling
     * threw away real detail over every city they have flown better than that
     * — twelve metres over Singerstraße the ground was a smear because the
     * best tile the game would ask for was a zoom-19 one magnified ten times.
     * Twenty fixed that and was still a guess: measured per-pixel contrast down
     * each level, where a genuine new level of resolution keeps most of its
     * contrast and a resample halves it,
     *
     *   Vienna centre     z19 6.96   z20 4.89 (x0.70)   z21 3.65 (x0.75)
     *   Jungfrau massif   z19 9.74   z20 5.77 (x0.59)   z21 1.84 (x0.32)
     *   Meseta farmland   z19 4.84   z20 2.65 (x0.55)   z21 0.56 (x0.21)
     *
     * — twenty-one is real over the city and a resample on the mountain. One
     * number could not be right for both, and the same is true of whatever
     * they fly next: pick the city's number and every valley pays sixteen
     * requests a square for a blur; pick the valley's and the city stays a
     * smear.
     *
     * So the number here stops being the answer. Every tile that lands is
     * measured, and a square whose finer tile brings back less than half of
     * what the one above it had is marked as the finest there is — the
     * quadtree stops descending there and nothing below it is ever requested.
     * See sharpness.js and `Streamer.atFinest`. This is the ceiling on that
     * search, not a claim about coverage.
     *
     * And it is a generous one. Esri document level 23 in select areas; asked
     * for it directly, three cities that have some of their best imagery all
     * hand back the "no data" card instead:
     *
     *                   z20    z21           z22           z23
     *   Vienna          4.89   3.65 (x0.75)  1.67 (x0.46)  card
     *   Westminster     card   card          card          card
     *   Times Square    4.22   card          card          card
     *
     * So twenty-two is the deepest real level found anywhere so far, in one
     * city, and it sits at 0.46 against a threshold of 0.45 — near enough to
     * the line that its verdict could go either way, which is worth knowing
     * before trusting it. The lid is set here rather than lower so that if a
     * provider does start serving deeper the game can follow without a code
     * change; the measurement and the card stop it long before, everywhere
     * tested.
     */
    maxZoom: 23,
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
      + 'every tile is a 404 and the ground goes bare, so this is one to pick when '
      + 'you know where you are going.',
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
    note: 'The same tiles their own website draws, at the same 512-pixel size.'
      + ' It looks sharper there because a flat map puts about one texel on one'
      + ' screen pixel, while here the photograph is draped over terrain and'
      + ' usually seen at an angle — the same picture over fewer pixels. Fly'
      + ' straight down at it and the two match.',
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
    // The drawn map the flat maps show for ground you have not seen. It used
    // to sit behind OpenStreetMap's own raster server, and that entry is gone:
    // tile.openstreetmap.org is one community machine with a fair-use policy
    // that this is not covered by, and asked from a browser on a third-party
    // site it answers HTTP 200 with a picture that says "Access blocked"
    // — which the game would have drawn as if it were a map.
    hidden: true,
    note: 'Drawn map rather than photography. What the flat maps show for ground you have not seen.',
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

/**
 * The deepest zoom any imagery provider here says it will serve.
 *
 * Derived, not written down. The ceiling in Settings and the presets' own
 * default both read this, so a provider that starts serving a level deeper
 * raises the lid by itself. Written down, it goes stale the moment one of the
 * entries above changes — the slider was capped at 22 with a help line saying
 * "twenty-two is the deepest any provider here publishes" for a while after
 * Esri's entry had already been raised past it, so the game could not have
 * reached the deeper level even where it existed.
 *
 * It is a lid, not a promise. What is actually fetched is decided per square
 * by measuring the photographs — see sharpness.js — and by whether the
 * provider answers with a picture or with its "no data" card.
 */
export const DEEPEST_IMAGERY_ZOOM = IMAGERY_PROVIDERS.reduce(
  (deepest, provider) => Math.max(deepest, provider.maxZoom ?? 0),
  1,
);

/**
 * The end of the slider: as deep as it goes, with no number at all.
 *
 * Every ceiling in this file has been wrong in the same way. Nineteen was
 * wrong, then twenty, then the derived maximum — each one a guess about what
 * providers will serve, made once and then outlived. So the slider runs to
 * twenty-five and then to no ceiling: past the last notch there is nothing
 * stopping the quadtree except the two things that can actually answer, which
 * are the provider refusing and the photographs themselves stopping getting
 * sharper. Neither of those needs updating when somebody flies a city better.
 */
export const ZOOM_SLIDER_MAX = 25;
/**
 * The stored value that means "no ceiling". One past the last notch.
 *
 * A number rather than Infinity because it is written to storage and to a
 * range input, and neither survives Infinity. `zoomCeiling` turns it back into
 * one at the point of use.
 */
export const NO_ZOOM_CEILING = ZOOM_SLIDER_MAX + 1;

/** The setting as the quadtree should read it: a depth, or no limit at all. */
export function zoomCeiling(setting) {
  return setting >= NO_ZOOM_CEILING ? Infinity : setting;
}


export const ELEVATION_PROVIDERS = [
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
  notes.push(descriptor.needsKey ? 'needs a key' : 'keyless');
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

/**
 * The human-readable half of a Google API refusal.
 *
 * Their errors are JSON with a `error.message` that names the actual problem —
 * "Requests to this API tile.googleapis.com method … are blocked", "API key
 * not valid", "Referer restrictions" — and it is far more use than the status
 * code on its own.
 */
/**
 * Fetch, and say something useful when the request never arrives at all.
 *
 * A refusal is easy to report: there is a status and usually a body saying why.
 * A *transport* failure is the one that reads as the game being broken, because
 * all the browser hands over is "Failed to fetch" — no status, no body, no
 * origin — and it is thrown for three quite different things:
 *
 *   nothing is reaching the network at all;
 *   the service would not answer this page's origin, and a page opened from a
 *     file:// URL sends `Origin: null`, which several metered APIs refuse
 *     before the request is ever made;
 *   an extension or a corporate proxy blocked it.
 *
 * "Photorealistic 3D failed to fetch" was that message arriving with none of
 * this attached. Naming the three turns a dead end into somewhere to look.
 */
async function reach(url, options, what) {
  try {
    return await fetch(url, options);
  } catch (err) {
    const detail = String(err?.message ?? err);
    throw new Error(
      `${what} could not be reached (${detail}). That is the request never arriving `
      + 'rather than being refused, so the token is not what is wrong: check the network, '
      + 'whether an extension is blocking it, and whether this page is running from a '
      + 'file:// URL \u2014 that sends no origin, and some metered services will not answer it. '
      + 'The online single file and the hosted page both have a real origin.',
    );
  }
}

async function googleReason(res) {
  try {
    const body = await res.json();
    const message = body?.error?.message ?? body?.error_message;
    if (message) return String(message);
  } catch {
    /* not JSON; fall through */
  }
  if (res.status === 403) {
    return 'check that the Map Tiles API is enabled on the project and that the key\u2019s '
      + 'referrer restrictions allow this page';
  }
  return 'no explanation given';
}

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
    this.googleSessionExpiry = 0;
    /** Google's own attribution line for wherever you are, once asked for. */
    this.googleCopyright = '';
    this.googleMaxZoomRects = null;
    this.preparing = null;
  }

  get id() {
    return this.descriptor.id;
  }

  get maxZoom() {
    return this.descriptor.maxZoom;
  }

  get attribution() {
    // Google's policy is that their own returned string is the attribution, so
    // when it has arrived it replaces the descriptor's placeholder rather than
    // sitting beside it.
    if (this.googleCopyright) return this.googleCopyright;
    return this.descriptor.attribution;
  }

  get key() {
    const slot = this.descriptor.needsKey;
    return slot ? (this.keys[slot] ?? '') : '';
  }

  /** True when tiles can be requested right now. */
  get ready() {
    return this.state === 'ready';
  }

  async prepare() {
    if (this.state === 'ready') return;
    if (this.preparing) return this.preparing;
    // A handshake that failed is not retried until its backoff is up.
    //
    // The streamer calls this from `dispatch` for every queued tile whose
    // source is not ready, which is every tile on screen, every frame. So a
    // Google key that fails `createSession` — wrong key, API not enabled,
    // quota gone — used to re-run the handshake continuously for as long as the
    // game was open, against an endpoint that is metered and rate-limited. The
    // wait doubles from two seconds to a minute and resets the moment one
    // succeeds, so a network that comes back is picked up quickly and a key
    // that is simply wrong is asked about once a minute instead of sixty times
    // a second.
    if (this.state === 'error' && Date.now() < (this.retryAt ?? 0)) return;

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
        this.handshakeFailures = 0;
      } catch (err) {
        this.state = 'error';
        this.error = err instanceof Error ? err.message : String(err);
        this.handshakeFailures = (this.handshakeFailures ?? 0) + 1;
        this.retryAt = Date.now()
          + Math.min(60000, 2000 * Math.pow(2, this.handshakeFailures - 1));
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
    const res = await reach(
      `https://api.cesium.com/v1/assets/${encodeURIComponent(asset)}/endpoint` +
        `?access_token=${encodeURIComponent(this.key)}`,
      undefined,
      `Cesium ion asset ${asset}`,
    );
    if (!res.ok) throw new Error(`Cesium ion asset ${asset} refused the token (${res.status})`);
    const data = await res.json();

    if (data.externalType === 'BING' || data.options?.mapStyle) {
      const base = (data.options?.url ?? 'https://dev.virtualearth.net').replace(/\/$/, '');
      const key = data.options?.key ?? '';
      const meta = await reach(
        `${base}/REST/v1/Imagery/Metadata/Aerial?output=json&include=ImageryProviders` +
          `&uriScheme=https&key=${encodeURIComponent(key)}`,
        undefined,
        'Bing imagery metadata, via ion',
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
    // `region` is a required field, and this used to leave it out on the
    // reasoning that a region identifier is a statement about whose borders and
    // labels you want, and a satellite session draws neither. That reasoning is
    // about what the field *does*; the API asks for it regardless, and a
    // createSession call without it is a session you never get — which is what
    // "Google Maps not working" was.
    //
    // The browser's own region is the answer, rather than pinning everyone to
    // the United States. Where it cannot say, 'US' is the fallback Google's own
    // examples use; with no roadmap layer requested there is nothing on the
    // imagery for it to change.
    const region = localeRegion() ?? 'US';
    const language =
      (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    const res = await reach(
      `https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(this.key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapType: 'satellite', language, region }),
      },
      'Google Map Tiles',
    );
    if (!res.ok) {
      // Google says exactly what is wrong in the body and this used to throw
      // it away, leaving "Google session failed (403)" — which reads as the
      // option being broken when it is nearly always one of three specific
      // and fixable things: the Map Tiles API is not enabled on the project,
      // the key has an HTTP-referrer restriction that does not list this
      // page's origin, or the key is restricted to other APIs. Passing their
      // message through turns a dead end into an instruction.
      throw new Error(`Google session failed (${res.status}) \u2014 ${await googleReason(res)}`);
    }
    const data = await res.json();
    if (!data.session) throw new Error('Google session token missing');
    this.googleSession = data.session;
    this.googleSessionExpiry = Number(data.expiry) * 1000 || 0;
  }

  /**
   * The attribution string Google requires for the ground you are looking at.
   *
   * Not optional and not a constant: their policy is that "data returned from
   * the Map Tiles API requires the display of attribution and copyright
   * information from the appropriate metadata or viewport information
   * requests", and the string genuinely differs from place to place because the
   * imagery under it comes from different people. A fixed "Imagery © Google"
   * in the corner is not what they asked for and is not true either — over most
   * of the world their satellite line names Airbus, Maxar or a national mapping
   * agency alongside them.
   *
   * The same call returns `maxZoomRects`: how far in the imagery actually goes
   * for each patch of the viewport. That is the difference between stopping at
   * the last real zoom and asking for tiles that were never flown.
   *
   * @param {{ north: number, south: number, east: number, west: number }} view
   * @param {number} zoom
   */
  async googleViewport(view, zoom) {
    if (!this.googleSession) return null;
    const q = new URLSearchParams({
      session: this.googleSession,
      key: this.key,
      zoom: String(Math.round(zoom)),
      north: view.north.toFixed(6),
      south: view.south.toFixed(6),
      east: view.east.toFixed(6),
      west: view.west.toFixed(6),
    });
    const res = await fetch(`https://tile.googleapis.com/tile/v1/viewport?${q}`);
    if (!res.ok) throw new Error(`Google viewport failed (${res.status})`);
    const data = await res.json();
    if (data.copyright) this.googleCopyright = String(data.copyright);
    this.googleMaxZoomRects = Array.isArray(data.maxZoomRects) ? data.maxZoomRects : [];
    return data;
  }

  /**
   * The finest zoom Google flew over a point, from the last viewport reply.
   *
   * Null when nothing has been asked yet, or when the point is outside every
   * rectangle that reply covered — both of which mean "no opinion", not "no
   * imagery", so the caller carries on as before.
   */
  googleMaxZoomAt(lat, lon) {
    const rects = this.googleMaxZoomRects;
    if (!rects?.length) return null;
    let best = null;
    for (const r of rects) {
      if (lat > r.north || lat < r.south) continue;
      // East of west and west of east, the long way round included.
      const inside = r.west <= r.east
        ? lon >= r.west && lon <= r.east
        : lon >= r.west || lon <= r.east;
      if (!inside) continue;
      if (best === null || r.maxZoom > best) best = r.maxZoom;
    }
    return best;
  }

  /** URL for a tile, or null when this source cannot serve that tile. */
  urlFor(tile) {
    const d = this.descriptor;
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
 * The order to try providers in, best first.
 *
 * Two rules, and the first one is the one that was asked for: **a provider you
 * hold a key for goes before a free one.** You paid for it (or signed up for
 * it), it is usually sharper, and it is metered against your own account
 * rather than against somebody's community server. Free ones follow, deepest
 * first, because a provider that publishes zoom 19 is more use than one that
 * stops at 9 when you are stood in a field.
 *
 * The chosen provider is always first whatever else is true — picking one is a
 * statement — and everything else is a standby for when it will not answer.
 */
/**
 * The provider setting's "let the game decide" value.
 *
 * Not a member of the provider list: it is a *choice about* providers, and
 * putting it in the list would have it turning up in fallback chains, in the
 * standby order and in the "which square does this one serve" logic, none of
 * which mean anything for a thing that is not a map server.
 */
export const AUTO_PROVIDER = 'auto';

/**
 * What "auto" means right now: the best provider you can actually use.
 *
 * The same order the standby chain is built in — anything you hold a key for
 * first, then the free ones deepest first — which makes auto exactly "the top
 * of the list I would fall back through anyway". Adding a key changes the
 * answer on the next frame without anybody having to reopen the dropdown, and
 * removing one falls back rather than leaving a blank world.
 */
export function resolveAuto(list, values) {
  // Ranked here rather than through providerChain: that function takes a
  // *chosen* provider and orders the rest behind it, and a null choice resolves
  // to the head of the list rather than to no preference — so asking it for the
  // best always came back with whatever happened to be written first.
  const usable = list.filter((p) => !p.hidden && (!p.needsKey || values?.[p.needsKey]));
  usable.sort((a, b) => {
    const keyed = (p) => (p.needsKey ? 0 : 1);
    if (keyed(a) !== keyed(b)) return keyed(a) - keyed(b);
    return (b.maxZoom ?? 0) - (a.maxZoom ?? 0);
  });
  return usable[0]?.id ?? list[0]?.id;
}

/** The chosen provider's id, with "auto" resolved to a real one. */
export function effectiveProvider(list, chosenId, values) {
  return chosenId === AUTO_PROVIDER ? resolveAuto(list, values) : chosenId;
}

export function providerChain(list, chosenId, values) {
  const chosen = findProvider(list, chosenId);
  const rest = list.filter((p) => p.id !== chosen?.id && !p.hidden);
  const usable = rest.filter((p) => !p.needsKey || values[p.needsKey]);
  usable.sort((a, b) => {
    const keyed = (p) => (p.needsKey ? 0 : 1);
    if (keyed(a) !== keyed(b)) return keyed(a) - keyed(b);
    return (b.maxZoom ?? 0) - (a.maxZoom ?? 0);
  });
  return [chosen, ...usable].filter(Boolean);
}

/**
 * Resolve a chosen provider to one that can actually serve tiles.
 *
 * Picking a provider and leaving its key blank used to mean no map at all: the
 * source sat in `needs-key` and the world fell back to generated terrain. There
 * is no generated terrain any more, so it substitutes for real — the best of
 * what is left, by the order above — and says so, because nobody should be
 * left thinking they are looking at Google's imagery when they are not.
 */
function withKeylessFallback(list, descriptor, values) {
  if (!descriptor) return null;
  if (!descriptor.needsKey || values[descriptor.needsKey]) return new TileSource(descriptor, values);
  const chain = providerChain(list, descriptor.id, values);
  const fallback = chain.find((p) => p.id !== descriptor.id);
  if (!fallback) return new TileSource(descriptor, values);
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
 * Which provider actually serves the sharpest ground *here*.
 *
 * Coverage is not uniform and no list ordering can capture that. USGS is
 * superb over Kansas and a 404 over Kent. Esri is excellent nearly everywhere
 * and hands you a "Map data not yet available" card over the Southern Ocean.
 * Sentinel-2 is everywhere and stops at ten metres a pixel.
 *
 * So this asks. For each candidate it walks down from the deepest zoom it
 * publishes until one answers with a real tile — not a 404, not a no-data card
 * — and remembers how deep that was. The winner is whoever got deepest, ties
 * broken by preferring one you hold a key for. Roughly a dozen requests, once,
 * when you press the button.
 *
 * @param {Array} list  IMAGERY_PROVIDERS
 * @param {object} values the settings store's values, for the keys
 * @param {{lat:number,lon:number}} at where you are standing
 * @param {(text:string)=>void} [onProgress]
 */
export async function bestProviderFor(list, values, at, onProgress) {
  const candidates = list.filter(
    (p) => !p.hidden && (!p.needsKey || values[p.needsKey]),
  );
  let best = null;
  for (const descriptor of candidates) {
    onProgress?.(`Trying ${descriptor.label}\u2026`);
    const source = new TileSource(descriptor, values);
    try {
      await source.prepare();
      if (source.state === 'error') continue;
    } catch {
      continue;
    }
    // Down from the deepest it claims, until something real comes back. Six
    // levels covers everything from "shallower than it says" to "only has the
    // continental view of this place", which over an ocean is the true answer
    // rather than a failure.
    const top = descriptor.maxZoom ?? 16;
    for (let z = top; z >= Math.max(3, top - 6); z--) {
      const n = Math.pow(2, z);
      const tile = {
        z,
        x: Math.floor(lonToNormX(at.lon) * n),
        y: Math.floor(clampUnit(latToNormY(at.lat)) * n),
      };
      const url = source.urlFor(tile);
      if (!url) continue;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (blob.size < 100) continue;
        const bitmap = await createImageBitmap(blob);
        const blank = isNoDataCard(bitmap, blob.size);
        bitmap.close();
        if (blank) continue;
        const keyed = descriptor.needsKey ? 1 : 0;
        if (!best || z > best.zoom || (z === best.zoom && keyed > best.keyed)) {
          best = { id: descriptor.id, label: descriptor.label, zoom: z, keyed };
        }
        break;
      } catch {
        /* next zoom */
      }
    }
  }
  onProgress?.(null);
  return best;
}

function clampUnit(value) {
  return Math.min(0.999999, Math.max(0, value));
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

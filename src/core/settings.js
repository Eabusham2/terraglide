import { Emitter } from './events.js';
import { NO_ZOOM_CEILING } from '../tiles/providers.js';
import { defaultUnits } from './units.js';
import { readJSON, removeKey, writeJSON } from './storage.js';

/**
 * Every persisted option in the game. Defaults are chosen so a fresh browser
 * with no API keys and no network still boots into something playable.
 *
 * imageryProvider:   'esri' | 'sentinel2' | 'usgs' | 'gibs' | 'google' | 'bing'
 *                    | 'azure' | 'maxar' | 'cesium-ion' | 'mapbox'
 * elevationProvider: 'terrarium' | 'mapbox' | 'bing-elevation'
 * panoramaProvider:  'none' | 'google' | 'mapillary'
 * graphics:          'low' | 'medium' | 'high' | 'ultra'
 * mouseMode:         'locked' | 'pan'
 * units:             'metric' | 'imperial'
 * world3d:           'off' | 'google' | 'cesium'
 * world3dDetail:     'low' | 'medium' | 'high' | 'ultra' — triangle budget
 * perspective:       'first' | 'third' | 'second'
 * rtpTarget:         'anywhere' | 'populated'
 * timeMode:          'day' | 'live' | 'golden' | 'night' | 'custom'
 */
export const DEFAULT_SETTINGS = {
  /* providers */
  imageryProvider: 'esri',
  elevationProvider: 'terrarium',
  panoramaProvider: 'none',
  /**
   * 'off'    — real imagery, real elevation, real OSM footprints and land cover,
   *            none of which need an account. What you get with no key.
   * 'google' — Google Photorealistic 3D Tiles: the actual scanned world,
   *            buildings and trees included, from oblique aerial photogrammetry.
   *            Needs a Google Maps Platform key.
   * 'cesium' — the same dataset through Cesium ion, on an ion token instead.
   */
  world3d: 'off',
  /**
   * Which Cesium ion dataset the ion route asks for.
   *
   * 'photoreal' is Google's aerial photogrammetry — the buildings and trees
   * are the mesh somebody flew over and measured. 'osm-buildings' is every
   * OpenStreetMap building on Earth extruded from its recorded height: not
   * photographed, so grey rather than textured, but a real survey and it
   * covers ground the photogrammetry has never been flown over.
   */
  world3dAsset: 'photoreal',
  world3dDetail: 'high',
  cesiumToken: '',
  bingKey: '',
  azureKey: '',
  googleKey: '',
  mapboxKey: '',
  appleMapsToken: '',
  mapillaryToken: '',
  maxarConnectId: '',
  addressLookup: true,
  buildings: true,
  /**
   * Slight relief over woodland the survey knows about, so a forest reads as a
   * canopy rather than as green paint. Shading only — nothing is built and the
   * ground you walk on does not move — and off wherever OpenStreetMap has no
   * wood mapped, because there is no wood there to shade.
   */
  woodlandRelief: true,
  streetLevel: true,

  /* graphics */
  graphics: 'high',
  renderDistanceKm: 24,
  /**
   * How far to keep drawing ground you have already flown over, in km.
   *
   * Two different numbers on purpose. The first is how far the world is drawn
   * in full anywhere, and it stops at 64 km because that is a real horizon and
   * everything past it costs streaming for country you may never look at. This
   * one only applies where the explored map says you have been, so the tiles
   * are already cached and the cost is drawing rather than fetching — which is
   * why it can run all the way to 1024.
   */
  distantDistanceKm: 256,
  distantMode: true,
  fov: 78,
  freecamFov: 85,
  speedFovKick: true,
  resolutionScale: 1,
  adaptiveResolution: false,
  fpsTarget: 60,
  fog: true,
  weather: true,
  maxTileZoom: NO_ZOOM_CEILING,
  /**
   * Detail ceiling, as a percentage of the preset's own budgets.
   *
   * One dial that scales tile detail, mesh detail and how deep the ground
   * zooms, all together — so there is a single thing to pull when the frame
   * rate is short rather than five. A hundred is the preset as designed.
   */
  detailLimit: 100,
  /**
   * Which Cesium ion asset the ion imagery provider asks for. 2 is Bing
   * Aerial, which is what most accounts have; any raster asset you own works.
   */
  cesiumImageryAsset: 2,
  meshDetail: 1.2,
  showFps: false,

  /* controls */
  mouseMode: 'locked',
  swapMouseButtons: false,
  sensitivity: 1,
  invertY: false,
  /** 'first' | 'third' — F5 cycles it, the same key Minecraft uses. */
  perspective: 'first',
  showBody: true,
  detailedPlayerModel: false,

  /* player */
  playerHeightM: 1.98, // 6 ft 6 in

  /* world / exploration */
  units: defaultUnits(),
  /**
   * Draw the flat maps as a street map only, with no photography anywhere.
   *
   * Off by default, because the photograph is the point of flying. On, the
   * world map is the drawn map at every zoom — roads, coastlines and names —
   * which is what you want when you are reading it rather than looking at it.
   */
  mapDrawnOnly: false,
  exploreSeas: false,
  /** How far out to sea a random teleport may drop you, in km. Default: no limit. */
  seaDistanceKm: 501,
  /** Random teleport arrives high with the wings out. */
  rtpSkySpawn: true,

  /** 'anywhere' | 'populated' — where random teleport is allowed to drop you. */
  rtpTarget: 'anywhere',
  timeMode: 'day',
  customHour: 12,

  /* minimap */
  minimapVisible: true,
  minimapCorner: 'top-right',
  minimapSize: 220,
  minimapZoom: 14,
  minimapRotates: false,
  showTrail: true,
  minimapShowWaypoints: true,
  minimapFog: true,

  /* hud */
  hudVisible: true,
  showTemperature: true,
  showCompass: true,
  showCrosshair: true,
};

/**
 * Per-quality tuning.
 *
 * A preset buys frame rate by drawing *less of the world*, not by drawing it
 * badly. Those are not the same thing, and mixing them up is how "Low" came to
 * mean a twelve-by-twelve mesh per tile, ground texture capped two zooms above
 * what the provider serves, and a third of the pixels a phone screen actually
 * has. That is not a cheaper picture of the Alps, it is a picture of something
 * else — smooth blobs under a soft wash.
 *
 * What genuinely costs, in order:
 *  - pixels shaded, which goes with the square of the pixel ratio;
 *  - tiles drawn, which is render distance and how eagerly the quadtree splits.
 *
 * What costs almost nothing on any GPU made this century: vertices per tile,
 * anisotropic filtering, and how deep the texture zoom goes — a tile drawn
 * from a zoom-20 photograph costs exactly what one drawn from zoom 18 costs.
 * So those stay near maximum everywhere, and the two knobs above do the work.
 *
 * `maxConcurrentRequests` was the quiet one, and it was set far too low. Tiles
 * are fetched from a worker over HTTP/2, where the browser multiplexes and the
 * old six-connections-per-host rule does not apply, so a low number here is not
 * politeness — it is the ground staying blurred while the queue drains. Flying
 * the Strait of Gibraltar and counting how much of the drawn ground wears its
 * own photograph rather than a stretched ancestor:
 *
 *              at 4 s   at 12 s   at 24 s
 *   14 wide     41%       42%       49%
 *   32 wide     70%       83%       88%
 *
 * That is the "blurry for a while" — half the world drawn from a coarse tile
 * for the first half minute. These are roughly doubled, which is still well
 * inside what one page is allowed to have in flight.
 */
export const GRAPHICS_PRESETS = {
  low: {
    sseThreshold: 2.1,
    tileGridSize: 25,
    maxConcurrentRequests: 12,
    textureCacheSize: 320,
    anisotropy: 8,
    buildingRadiusM: 420,
    // Never below one and a half. A phone reports three device pixels per CSS
    // pixel, so a cap of one renders the world at a third of the screen's
    // resolution and lets the browser stretch it back — which is most of what
    // "why is it so blurry" was.
    pixelRatioCap: 1.5,
    // What picking this preset also sets. A preset that only moved three
    // hidden numbers was not a preset, it was a hint — you could sit on "Low"
    // with a 64 km horizon and wonder why it was slow.
    applies: {
      renderDistanceKm: 8,
      distantMode: false,
      distantDistanceKm: 64,
      meshDetail: 1,
      maxTileZoom: NO_ZOOM_CEILING,
      fog: true,
      weather: false,
      buildings: false,
      streetLevel: false,
      world3dDetail: 'low',
    },
  },
  medium: {
    sseThreshold: 1.55,
    tileGridSize: 29,
    maxConcurrentRequests: 18,
    textureCacheSize: 560,
    anisotropy: 16,
    buildingRadiusM: 750,
    pixelRatioCap: 2,
    applies: {
      renderDistanceKm: 16,
      distantMode: false,
      distantDistanceKm: 128,
      meshDetail: 1.2,
      maxTileZoom: NO_ZOOM_CEILING,
      fog: true,
      weather: true,
      buildings: true,
      streetLevel: true,
      world3dDetail: 'medium',
    },
  },
  high: {
    sseThreshold: 1.25,
    tileGridSize: 33,
    maxConcurrentRequests: 26,
    textureCacheSize: 900,
    anisotropy: 16,
    buildingRadiusM: 1200,
    applies: {
      renderDistanceKm: 24,
      distantMode: true,
      distantDistanceKm: 256,
      meshDetail: 1.4,
      maxTileZoom: NO_ZOOM_CEILING,
      fog: true,
      weather: true,
      buildings: true,
      streetLevel: true,
      world3dDetail: 'high',
    },
    // Draw at the screen's own resolution. Capping this below the display's
    // device pixel ratio renders the world smaller than the screen and lets
    // the browser stretch it back up, which is exactly the soft, stepped
    // picture a sharp display makes so obvious.
    pixelRatioCap: 2,
  },
  ultra: {
    sseThreshold: 0.85,
    tileGridSize: 41,
    maxConcurrentRequests: 34,
    textureCacheSize: 1400,
    anisotropy: 16,
    buildingRadiusM: 1800,
    pixelRatioCap: 3,
    applies: {
      renderDistanceKm: 64,
      distantMode: true,
      distantDistanceKm: 1024,
      meshDetail: 1.6,
      maxTileZoom: NO_ZOOM_CEILING,
      fog: true,
      weather: true,
      buildings: true,
      streetLevel: true,
      world3dDetail: 'ultra',
    },
  },
};

const STORAGE_KEY = 'settings';

class SettingsStore extends Emitter {
  constructor() {
    super();
    const saved = readJSON(STORAGE_KEY, {});
    this.values = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const v = saved[key];
      if (v !== undefined && typeof v === typeof DEFAULT_SETTINGS[key]) this.values[key] = v;
    }
    /** Which keys came from storage rather than from the defaults above. */
    this.stored = new Set(Object.keys(saved ?? {}));
  }

  /** Has this key ever been chosen — by the player, or by anything else? */
  wasChosen(key) {
    return this.stored.has(key);
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    this.stored.add(key);
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.persist();
    this.emit('change', { key, value });
    // Choosing a preset chooses everything the preset covers. Otherwise "Low"
    // is a label on three hidden numbers and you can sit on it with a 64 km
    // horizon wondering why the machine is on its knees. Applied after the
    // change is announced so listeners see the preset first and the details
    // after, in the order they happened.
    if (key === 'graphics') this.applyPreset(value);
  }

  /**
   * Push a preset's own settings into the store.
   *
   * Only the ones a preset is entitled to: how far you can see, how fine the
   * mesh is, how deep the ground zooms, and which of the heavy extras are on.
   * Never keys, never controls, never units — those are yours, and a preset
   * that reset them would be a preset nobody dared touch.
   */
  applyPreset(name) {
    const preset = GRAPHICS_PRESETS[name];
    if (!preset || !preset.applies) return;
    for (const [key, value] of Object.entries(preset.applies)) {
      if (!(key in DEFAULT_SETTINGS) || this.values[key] === value) continue;
      this.values[key] = value;
      this.emit('change', { key, value });
    }
    this.persist();
  }

  patch(partial) {
    let changed = false;
    for (const key of Object.keys(partial)) {
      const value = partial[key];
      if (value === undefined || this.values[key] === value) continue;
      this.values[key] = value;
      changed = true;
      this.emit('change', { key, value });
    }
    if (changed) {
      this.persist();
      this.emit('bulk', this.values);
    }
  }

  reset() {
    Object.assign(this.values, DEFAULT_SETTINGS);
    removeKey(STORAGE_KEY);
    this.emit('bulk', this.values);
  }

  /** Tuning block for the current graphics level. */
  preset() {
    return GRAPHICS_PRESETS[this.values.graphics] ?? GRAPHICS_PRESETS.high;
  }

  persist() {
    writeJSON(STORAGE_KEY, this.values);
  }
}

export const settings = new SettingsStore();

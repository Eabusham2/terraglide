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
 * speedPer:          'hour' | 'minute' | 'second'
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
  /**
   * 'auto' means "you decide, and keep deciding" — see AutoQuality. It is the
   * default because a fixed tier is a guess that has to be right first time,
   * and for every machine that is not a desktop it was not.
   */
  graphics: 'auto',
  /** The tier auto sits on. Seeded from the device, then measured. */
  autoTier: 'high',
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
  /**
   * Standing height, metres. Six feet exactly.
   *
   * It was 1.98 — six foot six — which is a tall man, and everything scaled off
   * it inherited the extra: stride, eye height, reach, the collision capsule.
   * Part of "why do I feel so big".
   */
  playerHeightM: 1.8288, // 6 ft 0 in

  /* world / exploration */
  units: defaultUnits(),
  /**
   * Which unit of time speed is read in.
   *
   * Per hour is the car speedometer everybody knows and stays the default, but
   * it is a poor unit for flying: a glide is felt per second, and "how far did
   * that dive take me" is a question per minute answers.
   */
  speedPer: 'hour',
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
  /**
   * 'rounded' | 'circle' | 'square' | 'squircle' — the shape of the minimap.
   *
   * Rounded is what it always was. A circle is what a compass rose wants and
   * what most games use; a square wastes no pixels and lines up with the rest
   * of the interface; a squircle is the shape between them.
   */
  minimapShape: 'rounded',
  minimapSize: 220,
  minimapZoom: 14,
  /**
   * What zoom the world map opens at, remembered between openings.
   *
   * It opened at six every time, which is most of a continent — you could see
   * which country you were in and nothing else, and the first thing anybody did
   * was zoom in. Eleven shows a city and the country around it, which is the
   * scale the map is actually useful at, and after that it opens wherever you
   * left it.
   */
  worldMapZoom: 11,
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
 * `maxConcurrentRequests` was the quiet one, and it was set far too low. A low
 * number here is not politeness — it is the ground staying blurred while the
 * queue drains. Flying
 * the Strait of Gibraltar and counting how much of the drawn ground wears its
 * own photograph rather than a stretched ancestor:
 *
 *              at 4 s   at 12 s   at 24 s
 *   14 wide     41%       42%       49%
 *   32 wide     70%       83%       88%
 *
 * That is the "blurry for a while" — half the world drawn from a coarse tile
 * for the first half minute. These are roughly doubled.
 *
 * The reason once given for that being safe was wrong, and worth writing down
 * so nobody reasons from it again: it said tiles come "over HTTP/2, where the
 * browser multiplexes and the old six-connections-per-host rule does not
 * apply". Measured, server.arcgisonline.com and s3.amazonaws.com — the default
 * imagery and the default elevation — both negotiate HTTP/1.1. The rule
 * applies, and every harness run had hidden it, because a relayed response
 * never touches the browser's connection pool.
 *
 * So the numbers were re-measured with a six-per-origin gate in front of the
 * relay, which is what a browser actually enforces. Arriving cold over
 * Gibraltar, share of drawn ground wearing its own photograph:
 *
 *                            at 4 s   at 12 s   peak connections
 *   no gate, limit 34         45.4%     94.1%         43
 *   gate of six, limit 34     45.5%     94.1%          6
 *   gate of six, limit 6      37.3%     94.6%          6
 *
 * The gate costs nothing measurable, and lowering the limit to match it is
 * worse — 178 tiles deep in the queue instead of 11, and a slower fill. Over-
 * asking is not wasted: the browser holds the surplus and spends it the moment
 * a connection frees, while the streamer keeps a short queue it can still
 * re-order. So the numbers stand; only the reason for them was false.
 */
export const GRAPHICS_PRESETS = {
  low: {
    sseThreshold: 2.1,
    tileGridSize: 25,
    /**
     * How many squares of ground may be drawn in one frame.
     *
     * It lives here, with the rest of the tier, because it used to live in a
     * table of its own in terrain.js keyed on settings.get('graphics') — and
     * that setting reads 'auto' for everybody who has not picked a tier by
     * hand, which is everybody by default. 'auto' was not a key in the table,
     * so the lookup missed and fell through to the high figure: a Chromebook
     * on Low drew up to 1100 squares instead of 520, and a machine on Ultra
     * drew 1100 instead of 1500. Two tables, two ways of resolving the tier,
     * and they could not agree. There is one now, and it resolves like
     * everything else here.
     *
     * When the walk runs out of this, what goes undrawn is whatever the walk
     * had not reached yet — which is the far half of the view, not the near
     * one. So this being too high on a slow machine does not merely cost frame
     * rate; it is ground disappearing.
     */
    maxDrawnTiles: 520,
    maxConcurrentRequests: 12,
    textureCacheSize: 320,
    anisotropy: 8,
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
    maxDrawnTiles: 760,
    maxConcurrentRequests: 18,
    textureCacheSize: 560,
    anisotropy: 16,
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
    maxDrawnTiles: 1100,
    maxConcurrentRequests: 26,
    textureCacheSize: 900,
    anisotropy: 16,
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
    maxDrawnTiles: 1500,
    maxConcurrentRequests: 34,
    textureCacheSize: 1400,
    anisotropy: 16,
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

/**
 * The store itself, exported so a reload can be exercised: constructing a
 * second one reads the same storage back, which is the only way to check that
 * a pasted key actually survives closing the tab.
 */
export class SettingsStore extends Emitter {
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
    // Choosing 'auto' hands the choice over rather than naming a tier, so the
    // preset to apply is whichever one auto is currently sitting on.
    if (key === 'graphics') this.applyPreset(this.tier);
    else if (key === 'autoTier' && this.values.graphics === 'auto') this.applyPreset(value);
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
  /** The tier in force: your choice, or the one auto has settled on. */
  get tier() {
    return this.values.graphics === 'auto' ? this.values.autoTier : this.values.graphics;
  }

  preset() {
    return GRAPHICS_PRESETS[this.tier] ?? GRAPHICS_PRESETS.high;
  }

  persist() {
    writeJSON(STORAGE_KEY, this.values);
  }
}

export const settings = new SettingsStore();

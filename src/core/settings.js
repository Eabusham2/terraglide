import { Emitter } from './events.js';
import { readJSON, removeKey, writeJSON } from './storage.js';

/**
 * Every persisted option in the game. Defaults are chosen so a fresh browser
 * with no API keys and no network still boots into something playable.
 *
 * imageryProvider:   'offline' | 'esri' | 'google' | 'azure' | 'mapbox'
 * elevationProvider: 'procedural' | 'mapbox' | 'terrarium'
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
  world3dDetail: 'high',
  cesiumToken: '',
  azureKey: '',
  googleKey: '',
  mapboxKey: '',
  mapillaryToken: '',
  addressLookup: true,
  buildings: true,
  streetLevel: true,

  /* graphics */
  graphics: 'high',
  renderDistanceKm: 16,
  fov: 78,
  freecamFov: 85,
  speedFovKick: true,
  resolutionScale: 1,
  adaptiveResolution: true,
  fpsTarget: 60,
  fog: true,
  weather: true,
  scenery: true,
  sceneryFromImagery: true,
  maxTileZoom: 20,
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
  barrelRoll: false,

  /* player */
  playerHeightM: 1.98, // 6 ft 6 in
  playerScale: 1,
  speedModeDurationS: 10,
  speedModeCooldownS: 45,

  /* world / exploration */
  units: 'metric',
  exploreSeas: false,
  /** How far out to sea a random teleport may drop you, in km. Default: no limit. */
  seaDistanceKm: 501,
  /** Random teleport arrives high with the wings out. */
  rtpSkySpawn: true,
  /** Prefer arriving where there is street-level imagery, and inside a building. */
  spawnStreetLevel: true,
  spawnInBuilding: true,
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
 * Per-quality tuning. `sseThreshold` is the screen-space error the terrain
 * quadtree tolerates before it subdivides — the single biggest cost knob.
 */
export const GRAPHICS_PRESETS = {
  low: {
    sseThreshold: 2.4,
    tileGridSize: 17,
    maxConcurrentRequests: 6,
    textureCacheSize: 320,
    anisotropy: 1,
    buildingRadiusM: 420,
    sceneryRadiusM: 420,
    pixelRatioCap: 1,
  },
  medium: {
    sseThreshold: 1.7,
    tileGridSize: 25,
    maxConcurrentRequests: 10,
    textureCacheSize: 560,
    anisotropy: 4,
    buildingRadiusM: 750,
    sceneryRadiusM: 700,
    pixelRatioCap: 1.25,
  },
  high: {
    sseThreshold: 1.25,
    tileGridSize: 33,
    maxConcurrentRequests: 14,
    textureCacheSize: 900,
    anisotropy: 8,
    buildingRadiusM: 1200,
    sceneryRadiusM: 1200,
    pixelRatioCap: 1.5,
  },
  ultra: {
    sseThreshold: 0.85,
    tileGridSize: 41,
    maxConcurrentRequests: 18,
    textureCacheSize: 1400,
    anisotropy: 16,
    buildingRadiusM: 1800,
    sceneryRadiusM: 1900,
    pixelRatioCap: 2,
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
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.persist();
    this.emit('change', { key, value });
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

import { Emitter } from './events.js';
import { readJSON, removeKey, writeJSON } from './storage.js';

/**
 * Every persisted option in the game. Defaults are chosen so a fresh browser
 * with no API keys and no network still boots into something playable.
 *
 * imageryProvider:   'offline' | 'esri' | 'google' | 'bing' | 'mapbox' | 'osm'
 * elevationProvider: 'procedural' | 'mapbox' | 'terrarium'
 * panoramaProvider:  'none' | 'google' | 'mapillary'
 * graphics:          'low' | 'medium' | 'high' | 'ultra'
 * mouseMode:         'locked' | 'pan'
 * units:             'metric' | 'imperial'
 * timeMode:          'day' | 'live' | 'golden' | 'night' | 'custom'
 */
export const DEFAULT_SETTINGS = {
  /* providers */
  imageryProvider: 'esri',
  elevationProvider: 'terrarium',
  panoramaProvider: 'none',
  googleKey: '',
  bingKey: '',
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
  maxTileZoom: 18,
  meshDetail: 1,
  showFps: false,

  /* controls */
  mouseMode: 'locked',
  swapMouseButtons: false,
  sensitivity: 1,
  invertY: false,
  thirdPerson: false,

  /* player */
  playerHeightM: 1.98, // 6 ft 6 in
  playerScale: 1,
  speedModeDurationS: 10,
  speedModeCooldownS: 45,

  /* world / exploration */
  units: 'metric',
  exploreSeas: false,
  timeMode: 'day',
  customHour: 12,
  fogRevealScale: 1,

  /* minimap */
  minimapVisible: true,
  minimapCorner: 'top-right',
  minimapSize: 220,
  minimapZoom: 14,
  minimapRotates: false,
  minimapShowTrail: true,
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
    sseThreshold: 2.9,
    tileGridSize: 13,
    maxConcurrentRequests: 6,
    textureCacheSize: 320,
    anisotropy: 1,
    buildingRadiusM: 220,
    pixelRatioCap: 1,
  },
  medium: {
    sseThreshold: 2.1,
    tileGridSize: 21,
    maxConcurrentRequests: 10,
    textureCacheSize: 560,
    anisotropy: 4,
    buildingRadiusM: 380,
    pixelRatioCap: 1.25,
  },
  high: {
    sseThreshold: 1.6,
    tileGridSize: 27,
    maxConcurrentRequests: 14,
    textureCacheSize: 900,
    anisotropy: 8,
    buildingRadiusM: 550,
    pixelRatioCap: 1.5,
  },
  ultra: {
    sseThreshold: 1.15,
    tileGridSize: 33,
    maxConcurrentRequests: 18,
    textureCacheSize: 1400,
    anisotropy: 16,
    buildingRadiusM: 800,
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

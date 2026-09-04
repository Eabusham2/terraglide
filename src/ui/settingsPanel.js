import { ACTIONS, keyLabel, keybinds } from '../core/keybinds.js';
import { settings } from '../core/settings.js';
import { formatDistance, formatHeight } from '../core/units.js';
import {
  NO_ZOOM_CEILING,
  ZOOM_SLIDER_MAX,
  ELEVATION_PROVIDERS,
  IMAGERY_PROVIDERS,
  PANORAMA_PROVIDERS,
  AUTO_PROVIDER,
  findProvider,
  providerLabel,
  resolveAuto,
  testProviders,
} from '../tiles/providers.js';
import { escapeHtml } from './worldmap.js';

/**
 * Settings.
 *
 * Everything the game can be told to do lives here, grouped the way you would
 * go looking for it, and every control writes straight through to the persisted
 * store — no apply button, no restart.
 */

/**
 * The running per-location Auto, so the help text can say what it decided
 * *here* rather than describing a rule.
 *
 * A module-level handle because the help text is built by plain functions in
 * SECTIONS, and the alternative — threading the panel instance through every
 * one of them — would be a lot of plumbing to tell one sentence where it is.
 * Set once, by the game, next to the player-position hook.
 */
let liveAuto = null;
let liveAt = null;

export function watchLocalAuto(instance, at) {
  liveAuto = instance;
  liveAt = at;
}

/**
 * What Auto has settled on for the square you are standing in.
 *
 * Two sentences and both of them are load-bearing: which provider is drawing,
 * and *why that one* — because it was asked and got deepest, not because it is
 * first in a list. Before the first probe answers it says so plainly rather
 * than implying a measurement that has not happened.
 */
function autoHelp(kind, list) {
  const ranked = providerLabel(findProvider(list, resolveAuto(list, settings.values)));
  const at = liveAt?.();
  const local = at && liveAuto
    ? liveAuto.decided(kind, settings.values, at.lat, at.lon)
    : null;
  if (local) {
    const sharp = local.pixels ? `, ${local.pixels} px a tile` : '';
    const when = local.year ? `, ${local.year} imagery` : '';
    return `Asked, not guessed: every provider you can use was asked how deep it`
      + ` really goes over the square you are in, and ${local.label} got furthest`
      + ` — zoom ${local.zoom}${sharp}${when}. Ties go to the sharper tile, then`
      + ` to the more recent photograph. Fly about 150 km and it asks again;`
      + ` come back and it remembers. By published depth alone it would be`
      + ` ${ranked}.`;
  }
  return `Whichever provider actually serves the sharpest ground where you are.`
    + ` Each one is asked, over the square you are in, how deep it will really go;`
    + ` the deepest wins, and at the same depth the one with the bigger tile,`
    + ` and at the same size the more recent photograph. Coverage is patchy and`
    + ` different for every one of them, so the answer changes as you fly.`
    + ` Nothing has been asked about this square yet, so ${ranked} is drawing,`
    + ` on published depth, until it has.`;
}

const SECTIONS = [
  {
    id: 'providers',
    label: 'Providers',
    intro:
      'TerraGlide ships with no map data and no keys. Pick a provider and, where one is needed, paste your own key — the requests go straight from your browser to them, on your quota and under their terms.',
    fields: [
      {
        key: 'imageryProvider',
        label: 'Imagery',
        type: 'select',
        options: () => [
          { value: AUTO_PROVIDER, label: 'Auto — the best one you can use' },
          ...IMAGERY_PROVIDERS.filter((p) => !p.hidden)
            .map((p) => ({ value: p.id, label: providerLabel(p) })),
        ],
        help: (value) => (value === AUTO_PROVIDER
          ? autoHelp('imagery', IMAGERY_PROVIDERS)
          : providerNote(IMAGERY_PROVIDERS, value)),
        test: 'imagery',
      },
      {
        key: 'elevationProvider',
        label: 'Elevation',
        type: 'select',
        options: () => [
          { value: AUTO_PROVIDER, label: 'Auto — the best one you can use' },
          ...ELEVATION_PROVIDERS.map((p) => ({ value: p.id, label: providerLabel(p) })),
        ],
        help: (value) => (value === AUTO_PROVIDER
          ? `${autoHelp('elevation', ELEVATION_PROVIDERS)} It matters more here than`
            + ` it does for the picture — the finest elevation anyone serves is a`
            + ` sample every few metres, and the ground close to you is as flat as`
            + ` its spacing.`
          : providerNote(ELEVATION_PROVIDERS, value)),
        test: 'elevation',
      },
      {
        key: 'panoramaProvider',
        label: 'Street-level imagery',
        type: 'select',
        options: () => PANORAMA_PROVIDERS.map((p) => ({ value: p.id, label: providerLabel(p) })),
        help: (value) => providerNote(PANORAMA_PROVIDERS, value),
      },
      {
        key: 'world3d',
        label: 'Photorealistic 3D',
        type: 'select',
        options: () => [
          { value: 'off', label: 'Off \u2014 imagery, elevation and OpenStreetMap (recommended, keyless)' },
          { value: 'google', label: 'Google Photorealistic 3D Tiles (needs a key)' },
          { value: 'cesium', label: 'The same, via Cesium ion (needs a key)' },
        ],
        help: (value) =>
          value === 'off'
            ? 'Real satellite imagery, real elevation and real OpenStreetMap buildings and woodland \u2014 all of it keyless, and what nearly everyone should be flying. With no network the ground stays bare; nothing here is made up to fill it.'
            : value === 'cesium'
              ? 'The same scanned world as the Google option, served through Cesium ion on an ion access token \u2014 a different account and a different quota. Terrain steps aside where it loads. Test providers will tell you whether the token is working.'
              : 'Not a stylised world and nothing drawn from a description: aeroplanes flew over with cameras, and the buildings, trees and bridges you see are the mesh they measured, wearing the photographs they took. It is the most real thing here, and it is the one thing that cannot be keyless \u2014 Google meters it. Needs a Google Maps Platform key with the Map Tiles API enabled, and it is not cheap to run. Terrain steps aside where it loads.',
      },
      {
        key: 'world3dAsset',
        label: '3D dataset',
        type: 'select',
        showWhen: () => settings.get('world3d') === 'cesium',
        options: () => [
          { value: 'photoreal', label: 'Google photogrammetry \u2014 the scanned world' },
          { value: 'osm-buildings', label: 'OpenStreetMap buildings \u2014 every building, untextured' },
        ],
        help: (value) =>
          value === 'osm-buildings'
            ? 'Every building OpenStreetMap has, on Earth, extruded from its recorded height and served as real 3D tiles. Grey rather than photographed, because nobody flew over it \u2014 but it covers the enormous amount of the planet the photogrammetry never has.'
            : 'Aerial photogrammetry: the buildings, the trees and the bridges are the mesh, wearing the photographs taken of them. The most real thing here, and the heaviest.',
      },
      {
        key: 'world3dDetail',
        label: '3D detail',
        type: 'select',
        options: () => [
          { value: 'low', label: 'Low — fewest triangles' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High (default)' },
          { value: 'ultra', label: 'Ultra — everything the tiles have' },
        ],
        help: 'How deep to walk the tile tree, and so how many triangles arrive. Photogrammetry is far heavier than the ordinary world, so drop this before turning 3D off entirely.',
      },
      { key: 'googleKey', label: 'Google Maps key', type: 'secret', help: 'Map Tiles, Photorealistic 3D Tiles, Street View Static and Geocoding APIs \u2014 each has to be enabled on the project separately, and a key restricted to some of them refuses the rest with a 403. If the key has HTTP-referrer restrictions, list this page\'s address in them; a page opened from a file:// URL sends no referrer at all and a restricted key can never work there.' },
      { key: 'bingKey', label: 'Bing Maps key', type: 'secret', help: 'Bing aerial imagery. Microsoft is retiring this into Azure Maps, but the coverage is not identical yet.' },
      { key: 'azureKey', label: 'Azure Maps key', type: 'secret', help: 'Azure Maps subscription key, for Microsoft satellite imagery. Azure serves no 3D data.' },
      { key: 'mapboxKey', label: 'Mapbox token', type: 'secret', help: 'Used for satellite imagery and Terrain-RGB elevation. If the token has URL restrictions, add this page\'s address; a file:// page sends no referrer and will be refused.' },
      { key: 'appleMapsToken', label: 'Apple Maps token', type: 'secret', help: 'A MapKit JS token from your Apple Developer account. Used for addresses and place search.' },
      { key: 'cesiumToken', label: 'Cesium ion access token', type: 'secret', help: 'One token, two uses: the Cesium route into photorealistic 3D, and ion imagery below. It needs the assets:read scope and the asset itself has to be in your account \u2014 the sample ones are not, until you add them. "Could not be reached" rather than a refusal means the request never arrived, which is the network or the page\'s origin rather than the token.' },
      { key: 'cesiumImageryAsset', label: 'Cesium ion imagery asset', type: 'range', min: 1, max: 10000, step: 1, showWhen: () => settings.get('imageryProvider') === 'cesium-ion', help: 'The number ion gives a raster layer in your account — open My Assets on'
        + ' the ion dashboard and it is the ID column, also the last part of the asset\'s own URL.'
        + ' It must be an *imagery* asset: terrain and 3D Tiles have IDs too and will simply'
        + ' refuse every tile, which looks like a broken key rather than the wrong number.'
        + ' 2 is Bing Aerial and is on almost every account, which is why it is the default.'
        + ' Get it wrong and nothing is invented — the ground falls back through the other'
        + ' providers and says so.' },
      { key: 'mapillaryToken', label: 'Mapillary token', type: 'secret' },
      { key: 'maxarConnectId', label: 'Maxar SecureWatch connect ID', type: 'secret', help: 'Maxar\'s own imagery service. An enterprise credential \u2014 Esri, Bing and Google all serve Maxar scenes without one.' },
      { key: 'addressLookup', label: 'Look up addresses', type: 'toggle', help: 'Reverse geocodes your position for the readout. Rate limited.' },
      { key: 'buildings', label: 'OpenStreetMap buildings', type: 'toggle', help: 'Extrudes real footprints near the ground to their surveyed height. Solid \u2014 there is no invented inside.' },
      { key: 'seasonalSnow', label: 'Seasonal snow', type: 'toggle', help: 'Tints ground above the seasonal snow line white, up to 45%, fading in over a kilometre of height and shedding off any real slope. Satellite mosaics are stitched from cloud-free days, which are usually summer, so a January alp photographs green - this is the one seasonal thing the picture cannot say for itself. Turn it off and the ground is the photograph and the daylight, nothing else.' },
      { key: 'woodlandRelief', label: 'Woodland canopy relief', type: 'toggle', help: 'Stands the crowns of a wood up out of the photograph, so a forest reads as a canopy instead of green paint. The crowns are read off the imagery itself — nothing is invented, and nothing changes where the photograph has no wood in it. Shading only: the ground you walk on does not move.' },
      { key: 'streetLevel', label: 'Blend street-level photos', type: 'toggle', help: 'Fades ground photography in when you stand still. Needs a key.' },
    ],
  },
  {
    id: 'graphics',
    label: 'Graphics',
    fields: [
      {
        key: 'graphics',
        label: 'Graphics level',
        type: 'select',
        options: () => [
          { value: 'auto', label: 'Auto \u2014 match this machine' },
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
          { value: 'ultra', label: 'Ultra' },
        ],
        help: (value) => (value === 'auto'
          ? `Watches the frame clock and keeps the preset at the heaviest tier this machine actually holds, one step at a time. Currently on ${settings.tier}.`
          : 'Sets terrain detail, texture cache and how many tiles load at once. Auto will not touch it while a tier is chosen here.'),
      },

      { key: 'renderDistanceKm', label: 'Render distance', type: 'range', min: 4, max: 64, step: 1, unit: ' km', help: 'How far the ground is drawn when you are near it. Far tiles stay coarse, so the cost grows more slowly than the number does \u2014 but every kilometre of it is country that has to be fetched. Climbing extends it: from four hundred metres up the real horizon is seventy kilometres, and stopping the world at your setting anyway puts a flat band of haze across the view where the mountains should be. It reaches as far as the horizon does, up to six times this, and no further.' },
      { key: 'distantMode', label: 'Keep drawing past the horizon where you have been', type: 'toggle', help: 'Ground you have already flown over carries on past the render distance instead of stopping at it. Its tiles are already cached, so this costs drawing rather than fetching, and somewhere new still stops at the edge exactly as before.' },
      { key: 'distantDistanceKm', label: 'How far, over ground you have seen', type: 'range', min: 64, max: 1024, step: 8, unit: ' km', showWhen: () => settings.get('distantMode'), help: 'The reach of the setting above. It only applies where the explored map says you have been.' },
      { key: 'maxTileZoom', label: 'Maximum imagery zoom', type: 'range', min: 1, max: NO_ZOOM_CEILING, step: 1, format: (v) => (v >= NO_ZOOM_CEILING ? 'No limit' : String(v)), help: `Past the last notch there is no ceiling at all, which is where it sits by default. A ceiling, not a target. The ground always sharpens as far as the provider will actually serve here \u2014 every tile is measured as it arrives, and a level that only hands back the one above it resampled bigger is not asked for again \u2014 and this only stops it going deeper than you want. Nothing stops it but the provider refusing and the photographs themselves stopping getting sharper \u2014 both measured, neither a number anyone has to keep up to date.` },
      { key: 'meshDetail', label: 'Terrain mesh detail', type: 'range', min: 0.5, max: 1.6, step: 0.1, format: (v) => `${v.toFixed(1)}x` },
      { key: 'fov', label: 'Field of view', type: 'range', min: 55, max: 118, step: 1, unit: '°' },
      { key: 'freecamFov', label: 'Freecam field of view', type: 'range', min: 55, max: 118, step: 1, unit: '°' },
      { key: 'speedFovKick', label: 'Widen view with speed', type: 'toggle' },
      { key: 'fog', label: 'Distance haze', type: 'toggle',
        help: 'Air, drawn properly: it thins with height, so a peak twenty kilometres off stands clear above the valley that is lost in it. It is also what hides the edge of the drawn world — so with it off the render distance stops being capped at six times your setting and reaches the real horizon instead, because there is nothing left to hide the line where the ground ends.' },
      { key: 'weather', label: 'Clouds and rain', type: 'toggle', help: 'Cloud cover and precipitation for where and when you are, from the same climate model as the temperature.' },
      { key: 'resolutionScale', label: 'Render scale', type: 'range', min: 0.5, max: 2, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, help: 'How many pixels the world is drawn with, against your screen\'s own. A hundred per cent is native \u2014 every pixel your display has. Above that is supersampling: sharper still, and expensive.' },
      { key: 'detailLimit', label: 'Detail limit', type: 'range', min: 25, max: 100, step: 5, format: (v) => `${v}%`, help: 'Scales tile detail, mesh detail and how deep the ground zooms, all together. One dial to pull when the frame rate is short instead of five. A hundred per cent is the preset as designed.' },
      { key: 'fpsTarget', label: 'Frame rate target', type: 'range', min: 30, max: 144, step: 5, unit: ' fps' },
      { key: 'showFps', label: 'Show performance readout', type: 'toggle' },
    ],
  },
  {
    id: 'controls',
    label: 'Controls',
    fields: [
      {
        key: 'mouseMode',
        label: 'Mouse mode',
        type: 'select',
        options: () => [
          { value: 'locked', label: 'Locked pointer (either button boosts)' },
          { value: 'pan', label: 'Click and pan (drag to look)' },
        ],
        help: 'Locked captures the cursor for flying. Pan keeps it free for the map.',
      },
      { key: 'swapMouseButtons', label: 'Swap mouse buttons in pan mode', type: 'toggle', help: 'Normally: drag with left to look, right click to boost, click to land.' },
      { key: 'sensitivity', label: 'Look sensitivity', type: 'range', min: 0.2, max: 3, step: 0.05, format: (v) => `${v.toFixed(2)}x` },
      { key: 'invertY', label: 'Invert vertical look', type: 'toggle' },
    ],
    keybinds: true,
  },
  {
    id: 'player',
    label: 'Player',
    fields: [
      {
        key: 'perspective',
        label: 'Perspective',
        type: 'select',
        options: () => [
          { value: 'first', label: 'First person' },
          { value: 'third', label: 'Third person — behind you' },
          { value: 'second', label: 'Second person — in front, looking back' },
        ],
        help: 'Cycles with the perspective key, listed under Controls.',
      },
      {
        key: 'detailedPlayerModel',
        label: 'Detailed player model (does not animate)',
        type: 'toggle',
        help: 'A generated character mesh instead of the built one. More detail standing still, but it is a single fused mesh with no skeleton: it will not walk, will not open its wings, and is not used in first person. A real trade, not an upgrade. Not in the single-file build.',
      },
      { key: 'showBody', label: 'Show your body in first person', type: 'toggle', help: 'Your legs and boots below you when you look down. Your arms and the rocket in your hand are drawn either way.' },
      {
        key: 'playerHeightM',
        label: 'Standing height',
        type: 'range',
        min: 1.2,
        max: 2.4,
        step: 0.01,
        format: (v) => `${formatHeight(v, settings.get('units'))}`,
        help: 'Default is 6 ft.',
      },

    ],
  },
  {
    id: 'world',
    label: 'World',
    fields: [
      {
        key: 'units',
        label: 'Units',
        type: 'select',
        options: () => [
          { value: 'metric', label: 'Metric (m, km, °C)' },
          { value: 'imperial', label: 'Imperial (ft, mi, °F)' },
        ],
      },
      {
        key: 'speedPer',
        label: 'Speed read as',
        type: 'select',
        options: () => [
          { value: 'hour', label: 'Per hour (km/h, mph)' },
          { value: 'minute', label: 'Per minute (km/min, mi/min)' },
          { value: 'second', label: 'Per second (m/s, ft/s)' },
        ],
        help: (value) =>
          value === 'second'
            ? 'What a glide actually feels like.'
            : value === 'minute'
              ? 'Good for reading how far a dive took you.'
              : 'The car speedometer everybody knows.',
      },
      {
        key: 'rtpTarget',
        label: 'Random teleport lands',
        type: 'select',
        options: () => [
          { value: 'anywhere', label: 'Anywhere on Earth' },
          { value: 'populated', label: 'Somewhere with people' },
        ],
        help: (value) =>
          value === 'populated'
            ? 'Drops you on a city or town, a few kilometres off centre so it is a different spot each time. Works offline.'
            : 'Uniform over the whole planet, so mostly wilderness — which is rather the point.',
      },
      { key: 'exploreSeas', label: 'Anywhere-mode may land at sea', type: 'toggle', help: 'Off keeps you on land. On lets you drop anywhere, oceans included.' },
      {
        key: 'seaDistanceKm',
        // Meaningless unless sea landings are on, so it stays out of the way.
        showWhen: () => settings.get('exploreSeas'),
        label: 'Furthest out to sea a drop may be',
        type: 'range',
        min: 1,
        max: 501,
        step: 10,
        format: (v) => (v > 500 ? 'unlimited' : formatDistance(v * 1000, settings.get('units'), 0)),
        help: 'Unlimited by default, so mid-ocean is fair game; wind it down to stay within reach of a coast.',
      },
      { key: 'rocketSupply', label: 'Fireworks', type: 'select',
        options: () => [
          { value: 'limited', label: 'A stack of 64 each, refilling' },
          { value: 'unlimited', label: 'Endless' },
        ],
        help: 'Minecraft gives you a stack and each launch spends one. So does this: 64 per hotbar slot, one per launch, and a slot earns one back every four seconds — per slot, so emptying the big one does not cost you the small one. There is nothing to craft them from in a world made of photographs, which is why they refill rather than run out for good.' },
      { key: 'rtpSkySpawn', label: 'Teleport keeps you doing what you were doing', type: 'toggle', help: 'On: teleport while flying and you arrive high with the wings out; teleport from the ground and you arrive on your feet. Off: you always arrive standing.' },

      {
        key: 'timeMode',
        label: 'Time of day',
        type: 'select',
        options: () => [
          { value: 'day', label: 'Daylight' },
          { value: 'golden', label: 'Golden hour' },
          { value: 'night', label: 'Night' },
          { value: 'live', label: 'Live (real time where you are)' },
          { value: 'custom', label: 'Custom hour' },
        ],
      },
      { key: 'customHour', label: 'Custom hour', type: 'range', min: 0, max: 23.5, step: 0.5, format: (v) => `${String(Math.floor(v)).padStart(2, '0')}:${v % 1 ? '30' : '00'}` },
      { key: 'showTemperature', label: 'Show seasonal temperature', type: 'toggle' },
    ],
  },
  {
    id: 'minimap',
    label: 'Minimap & HUD',
    fields: [
      { key: 'minimapVisible', label: 'Show minimap', type: 'toggle' },
      {
        key: 'minimapShape',
        label: 'Shape',
        type: 'select',
        options: () => [
          { value: 'rounded', label: 'Rounded corners' },
          { value: 'circle', label: 'Circle' },
          { value: 'squircle', label: 'Squircle' },
          { value: 'square', label: 'Square' },
        ],
      },
      {
        key: 'minimapCorner',
        label: 'Corner',
        type: 'select',
        options: () => [
          { value: 'top-right', label: 'Top right' },
          { value: 'top-left', label: 'Top left' },
          { value: 'bottom-right', label: 'Bottom right' },
          { value: 'bottom-left', label: 'Bottom left' },
        ],
      },
      { key: 'minimapSize', label: 'Size', type: 'range', min: 140, max: 420, step: 10, unit: ' px' },
      { key: 'minimapZoom', label: 'Zoom', type: 'range', min: 3, max: 19, step: 1, format: (v) => `z${v}` },
      { key: 'minimapRotates', label: 'Rotate with heading', type: 'toggle' },
      { key: 'minimapFog', label: 'Hide ground you have not explored', type: 'toggle', help: 'The map fills in as you travel. Turn off to see the whole world at once.' },
      { key: 'showTrail', label: 'Show your trail', type: 'toggle' },
      { key: 'minimapShowWaypoints', label: 'Show waypoints', type: 'toggle' },
      { key: 'hudVisible', label: 'Show HUD', type: 'toggle' },
      { key: 'showCompass', label: 'Show compass', type: 'toggle' },
      { key: 'showCrosshair', label: 'Show crosshair', type: 'toggle' },
    ],
  },
];

function providerNote(list, value) {
  const provider = list.find((p) => p.id === value);
  if (!provider) return '';
  const bits = [];
  if (provider.needsKey) bits.push('Needs a key.');
  if (provider.attribution) bits.push(provider.attribution);
  if (provider.note) bits.push(provider.note);
  return bits.join(' ');
}

export class SettingsPanel {
  constructor(root) {
    this.open = false;
    this.activeSection = 'providers';
    this.capturing = null;
    this.onChange = null;
    this.onReset = null;

    this.element = document.createElement('div');
    this.element.className = 'panel settings';
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="panel-head">
        <h2>Settings</h2>
        <button type="button" class="panel-close" data-close>Close</button>
      </div>
      <div class="settings-body">
        <nav class="settings-nav">
          ${SECTIONS.map(
            (section) =>
              `<button type="button" data-section="${section.id}">${escapeHtml(section.label)}</button>`,
          ).join('')}
          <button type="button" data-section="data">Data</button>
        </nav>
        <div class="settings-content"></div>
      </div>
    `;
    root.appendChild(this.element);
    this.content = this.element.querySelector('.settings-content');

    this.element.addEventListener('click', (event) => {
      const close = event.target.closest('[data-close]');
      if (close) {
        this.close();
        return;
      }
      const nav = event.target.closest('[data-section]');
      if (nav) {
        this.activeSection = nav.dataset.section;
        this.render();
      }
    });

    window.addEventListener('keydown', (event) => this.onKeyDown(event), true);
    settings.on('bulk', () => {
      if (this.open) this.render();
    });
  }

  onKeyDown(event) {
    if (!this.capturing) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.code === 'Escape') {
      this.capturing = null;
      this.render();
      return;
    }
    this.bindRefused = !keybinds.rebind(this.capturing, event.code);
    this.capturing = null;
    this.render();
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    this.open = true;
    this.element.hidden = false;
    this.render();
  }

  close() {
    this.open = false;
    this.capturing = null;
    this.element.hidden = true;
  }

  render() {
    this.element.querySelectorAll('[data-section]').forEach((button) => {
      button.classList.toggle('active', button.dataset.section === this.activeSection);
    });

    if (this.activeSection === 'data') {
      this.content.innerHTML = this.renderData();
      this.bindData();
      return;
    }

    const section = SECTIONS.find((s) => s.id === this.activeSection) ?? SECTIONS[0];
    const parts = [];
    if (section.intro) parts.push(`<p class="settings-intro">${escapeHtml(section.intro)}</p>`);
    // A field may declare showWhen(); a control that cannot do anything yet is
    // clutter, so it simply is not drawn until its precondition is met.
    for (const field of section.fields) {
      if (field.showWhen && !field.showWhen()) continue;
      parts.push(this.renderField(field));
    }
    if (section.id === 'providers') {
      parts.push(this.renderAutoProvider());
      parts.push(this.renderProviderTest());
    }
    if (section.id === 'graphics') parts.push(this.renderBenchmark());
    if (section.keybinds) parts.push(this.renderKeybinds());
    this.content.innerHTML = parts.join('');
    this.bindFields(section);
    if (section.id === 'providers') {
      this.bindProviderTest();
      this.bindOneTest();
      this.bindAutoProvider();
    }
    if (section.id === 'graphics') this.bindBenchmark();
  }

  renderField(field) {
    const value = settings.get(field.key);
    const id = `set-${field.key}`;
    let control = '';

    if (field.type === 'toggle') {
      control = `<input type="checkbox" id="${id}" data-key="${field.key}" ${value ? 'checked' : ''} />`;
    } else if (field.type === 'select') {
      const options = field.options();
      control = `<select id="${id}" data-key="${field.key}">${options
        .map(
          (o) =>
            `<option value="${escapeHtml(o.value)}" ${o.value === value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`,
        )
        .join('')}</select>`;
    } else if (field.type === 'range') {
      const display = field.format
        ? field.format(Number(value))
        : `${value}${field.unit ?? ''}`;
      control = `
        <span class="range">
          <input type="range" id="${id}" data-key="${field.key}" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}" />
          <output data-out="${field.key}">${escapeHtml(display)}</output>
        </span>`;
    } else if (field.type === 'secret') {
      control = `<input type="password" id="${id}" data-key="${field.key}" value="${escapeHtml(String(value))}" placeholder="not set" autocomplete="off" spellcheck="false" />`;
    } else {
      control = `<input type="text" id="${id}" data-key="${field.key}" value="${escapeHtml(String(value))}" />`;
    }

    const help = typeof field.help === 'function' ? field.help(value) : field.help;
    // A field may carry its own test button — "does the thing I just picked
    // actually answer me?" is a different question from "do any of them", and
    // it is the one you want after pasting a key.
    const one = field.test
      ? `<button type="button" class="field-test" data-test-one="${escapeHtml(field.test)}">Test this one</button>`
      : '';
    const result = field.test && this.oneResult?.[field.test]
      ? `<small class="provider-${escapeHtml(this.oneResult[field.test].state)}">${escapeHtml(this.oneResult[field.test].detail)}</small>`
      : '';
    return `
      <div class="field field-${field.type}">
        <label for="${id}">${escapeHtml(field.label)}</label>
        ${control}${one}
        ${help ? `<small>${escapeHtml(help)}</small>` : ''}
        ${result}
      </div>`;
  }

  bindFields(section) {
    this.content.querySelectorAll('[data-key]').forEach((input) => {
      const key = input.dataset.key;
      const field = section.fields.find((f) => f.key === key);
      if (!field) return;

      const handler = () => {
        let value;
        if (field.type === 'toggle') value = input.checked;
        else if (field.type === 'range') value = Number(input.value);
        else value = input.value;
        settings.set(key, value);

        const output = this.content.querySelector(`[data-out="${key}"]`);
        if (output) {
          output.textContent = field.format
            ? field.format(Number(value))
            : `${value}${field.unit ?? ''}`;
        }
        const help = input.parentElement?.querySelector('small') ?? input.closest('.field')?.querySelector('small');
        if (help && typeof field.help === 'function') help.textContent = field.help(value);
        if (this.onChange) this.onChange(key, value);
      };

      input.addEventListener(field.type === 'range' ? 'input' : 'change', handler);
      if (field.type === 'secret' || field.type === 'text') input.addEventListener('blur', handler);
    });

    this.content.querySelectorAll('[data-rebind]').forEach((button) => {
      button.addEventListener('click', () => {
        this.capturing = button.dataset.rebind;
        this.render();
      });
    });
    this.content.querySelectorAll('[data-clearbind]').forEach((button) => {
      button.addEventListener('click', () => {
        keybinds.clear(button.dataset.clearbind);
        this.render();
      });
    });
    const resetBinds = this.content.querySelector('[data-reset-binds]');
    if (resetBinds) {
      resetBinds.addEventListener('click', () => {
        keybinds.reset();
        this.render();
      });
    }
  }

  renderKeybinds() {
    const groups = new Map();
    for (const action of ACTIONS) {
      if (!groups.has(action.group)) groups.set(action.group, []);
      groups.get(action.group).push(action);
    }

    const blocks = [...groups.entries()].map(
      ([group, actions]) => `
        <h4>${escapeHtml(group)}</h4>
        <div class="binds">
          ${actions
            .map((action) => {
              const capturing = this.capturing === action.id;
              const label = capturing ? 'press a key…' : keyLabel(keybinds.codeFor(action.id));
              return `
                <div class="bind">
                  <span>${escapeHtml(action.label)}</span>
                  <button type="button" class="bind-key${capturing ? ' capturing' : ''}" data-rebind="${action.id}">${escapeHtml(label)}</button>
                  ${action.required ? '' : `<button type="button" class="mini" data-clearbind="${action.id}">clear</button>`}
                </div>`;
            })
            .join('')}
        </div>`,
    );

    return `
      <h3>Key bindings</h3>
      <p class="settings-intro">Click a key, then press the one you want. Escape cancels. Taking a
      key off another action hands it whichever key this one was using.${
        this.bindRefused
          ? ' <strong>That key belongs to something that has to have one, and this action had none to trade.</strong>'
          : ''
      }</p>
      ${blocks.join('')}
      <div class="settings-actions"><button type="button" data-reset-binds>Reset key bindings</button></div>`;
  }

  /**
   * The provider test.
   *
   * Reading a list of providers tells you nothing about whether any of them is
   * answering you today, and the difference matters most for exactly the ones
   * that look broken when they are merely unauthorised. This asks all of them,
   * for real, and shows what came back.
   */
  renderProviderTest() {
    const rows = this.providerTest ?? [];
    const body = rows.length
      ? `<ul class="provider-test">${rows
          .map(
            (r) =>
              `<li class="provider-${escapeHtml(r.state)}"><b>${escapeHtml(r.label)}</b>` +
              `<span>${escapeHtml(r.state === 'checking' ? 'asking…' : r.detail)}</span></li>`,
          )
          .join('')}</ul>`
      : '';
    return `
      <div class="field field-action">
        <label>Check every provider</label>
        <button type="button" data-test-providers ${this.testing ? 'disabled' : ''}>
          ${this.testing ? 'Testing…' : 'Test providers'}
        </button>
        <small>Fetches one real tile from each, here, using whatever keys you have saved. One tile is nothing against anybody's quota, and nothing is sent anywhere but to the provider itself.</small>
        ${body}
      </div>`;
  }

  /**
   * "Ask again about this place".
   *
   * On Auto this happens by itself when you fly into a square nobody has asked
   * about, so the button is not how you get a local answer — it is how you get
   * one *now*, and how you get a fresh one for a square that was already
   * answered, which is what you want after pasting a key.
   *
   * It used to be the only way, and it worked by writing the winner into the
   * setting — which quietly took you *off* Auto, so the next place you flew to
   * kept a provider chosen for the place you left.
   */
  renderAutoProvider() {
    return `
      <div class="field field-action">
        <label>Ask about this place again</label>
        <button type="button" data-auto-provider ${this.findingProvider ? 'disabled' : ''}>
          ${escapeHtml(this.autoProviderStatus ?? (this.findingProvider ? 'Looking\u2026' : 'Ask now'))}
        </button>
        <small>Asks every provider you can use how deep it will actually go where you are standing, and hands the answer to Auto. On Auto this already happens by itself each time you fly into a new region; press it to ask again straight away, or after adding a key.</small>
      </div>`;
  }

  bindAutoProvider() {
    const button = this.content.querySelector('[data-auto-provider]');
    if (!button || !this.playerAt) return;
    button.addEventListener('click', async () => {
      if (this.findingProvider) return;
      if (!liveAuto) return;
      this.findingProvider = true;
      this.autoProviderStatus = null;
      this.render();
      const at = this.playerAt();
      const said = [];
      try {
        for (const [kind, list, key] of [
          ['imagery', IMAGERY_PROVIDERS, 'imageryProvider'],
          ['elevation', ELEVATION_PROVIDERS, 'elevationProvider'],
        ]) {
          // Only for a setting left on Auto: pressing this must not override a
          // provider somebody deliberately chose.
          if (settings.get(key) !== AUTO_PROVIDER) continue;
          const found = await liveAuto.probeNow(
            kind, at, settings.values, settings.get(key),
            (text) => {
              if (!text) return;
              this.autoProviderStatus = text;
              this.render();
            },
          );
          said.push(found ? `${found.label} z${found.zoom}` : `no ${kind} here`);
          this.render();
        }
        this.autoProviderStatus = said.length ? said.join(' · ') : 'Both are set by hand';
      } finally {
        this.findingProvider = false;
        this.render();
      }
    });
  }

  bindOneTest() {
    this.content.querySelectorAll('[data-test-one]').forEach((button) => {
      button.addEventListener('click', async () => {
        const which = button.dataset.testOne;
        const list = which === 'elevation' ? ELEVATION_PROVIDERS : IMAGERY_PROVIDERS;
        const id = settings.get(which === 'elevation' ? 'elevationProvider' : 'imageryProvider');
        const descriptor = list.find((p) => p.id === id);
        if (!descriptor) return;
        this.oneResult = { ...(this.oneResult ?? {}), [which]: { state: 'checking', detail: 'asking\u2026' } };
        this.render();
        const tile = this.testTile ? this.testTile() : { z: 12, x: 2138, y: 1420 };
        const [result] = await testProviders([descriptor], settings.values, tile);
        this.oneResult = { ...(this.oneResult ?? {}), [which]: result };
        this.render();
      });
    });
  }

  bindProviderTest() {
    const button = this.content.querySelector('[data-test-providers]');
    if (!button) return;
    button.addEventListener('click', async () => {
      if (this.testing) return;
      this.testing = true;
      this.providerTest = [];
      this.render();
      const tile = this.testTile ? this.testTile() : { z: 12, x: 2138, y: 1420 };
      const values = settings.values;
      const push = (result) => {
        const existing = this.providerTest.find((r) => r.id === result.id);
        if (existing) Object.assign(existing, result);
        else this.providerTest.push({ ...result });
        this.render();
      };
      try {
        await testProviders(IMAGERY_PROVIDERS.filter((p) => !p.hidden), values, tile, push);
        await testProviders(ELEVATION_PROVIDERS, values, tile, push);
      } finally {
        this.testing = false;
        this.render();
      }
    });
  }

  /**
   * The benchmark button.
   *
   * Replaces two governors that moved things underneath you while you flew.
   * This measures each preset in the real game, in the real place you are
   * standing, and stops at the heaviest one that holds your target — once,
   * when you ask it to, and then leaves everything alone.
   */
  renderBenchmark() {
    const rows = this.benchResults ?? [];
    const body = rows.length
      ? `<ul class="provider-test">${rows
          .map(
            (r) =>
              `<li class="provider-${r.fps >= settings.get('fpsTarget') * 0.92 ? 'ok' : 'no-cover'}">` +
              `<b>${escapeHtml(r.tier)}</b><span>${r.fps.toFixed(0)} fps, worst frame ${r.worstMs.toFixed(0)} ms</span></li>`,
          )
          .join('')}</ul>`
      : '';
    return `
      <div class="field field-action">
        <label>Test this machine</label>
        <button type="button" data-benchmark ${this.benchmarking ? 'disabled' : ''}>
          ${escapeHtml(this.benchStatus ?? (this.benchmarking ? 'Testing\u2026' : 'Test my system and pick'))}
        </button>
        <small>Runs each preset here for a couple of seconds, measures the frames that actually arrive, and settles on the heaviest one that holds your target. Nothing changes unless you press this.</small>
        ${body}
      </div>`;
  }

  bindBenchmark() {
    const button = this.content.querySelector('[data-benchmark]');
    if (!button || !this.onBenchmark) return;
    button.addEventListener('click', async () => {
      if (this.benchmarking) return;
      this.benchmarking = true;
      this.benchResults = [];
      this.render();
      try {
        const result = await this.onBenchmark((status, results) => {
          this.benchStatus = status;
          this.benchResults = results ? [...results] : [];
          this.render();
        });
        if (result) this.benchStatus = `Settled on ${result.pick}`;
      } finally {
        this.benchmarking = false;
        this.render();
      }
    });
  }

  renderData() {
    return `
      <p class="settings-intro">Everything is stored in this browser only — settings, key bindings, explored ground, waypoints and paths. Nothing is uploaded anywhere.</p>
      <div class="settings-actions">
        <button type="button" data-export>Export save file</button>
        <label class="file-button">Import save file<input type="file" accept="application/json" hidden data-import /></label>
        <button type="button" data-reset-settings>Reset all settings</button>
        <button type="button" data-clear-explored class="danger">Clear explored areas</button>
        <button type="button" data-clear-marks class="danger">Delete waypoints and paths</button>
      </div>
      <h3>About</h3>
      <p class="settings-intro">
        TerraGlide renders third-party map data live; it never bulk downloads or re-publishes it.
        Attribution for whatever provider you have selected stays in the corner of the screen.
        See LICENSE and THIRD-PARTY.md in the repository for the terms.
      </p>`;
  }

  bindData() {
    const call = (name, payload) => {
      if (this.onDataAction) this.onDataAction(name, payload);
    };
    this.content.querySelector('[data-export]')?.addEventListener('click', () => call('export'));
    this.content.querySelector('[data-import]')?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) call('import', file);
    });
    this.content.querySelector('[data-reset-settings]')?.addEventListener('click', () => {
      settings.reset();
      this.render();
      call('reset-settings');
    });
    this.content.querySelector('[data-clear-explored]')?.addEventListener('click', () => call('clear-explored'));
    this.content.querySelector('[data-clear-marks]')?.addEventListener('click', () => call('clear-marks'));
  }
}

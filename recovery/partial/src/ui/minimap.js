import { WheelSteps } from './wheel.js';
import { keybinds } from '../core/keybinds.js';
import { clamp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { formatDistance } from '../core/units.js';
import { drawMap, metresPerPixel } from './mapRenderer.js';

/**
 * Minimap.
 *
 * Shows satellite imagery for ground you have explored and a flat map view of
 * everything you have not, so the world is always legible and the photography
 * fills in behind you as you travel. Zoom with the hotkeys or the wheel, click
 * it to open the big map — the key for which is printed underneath.
 * Redraws at 20 Hz rather than every frame — it is a map, not a viewport.
 */

const REDRAW_INTERVAL = 1 / 20;

export class Minimap {
  constructor(root, { tiles, street, exploration, waypointStore, trail, others = null }) {
  constructor(root, { tiles, street, exploration, waypointStore, trail, others = null }) {
    this.others = others;
@@MISSING 24@@
@@MISSING 25@@
@@MISSING 26@@
@@MISSING 27@@
    this.timer = 0;
@@MISSING 29@@
@@MISSING 30@@
@@MISSING 31@@
@@MISSING 32@@
@@MISSING 33@@
@@MISSING 34@@
@@MISSING 35@@
@@MISSING 36@@
@@MISSING 37@@
@@MISSING 38@@
@@MISSING 39@@
@@MISSING 40@@
@@MISSING 41@@
@@MISSING 42@@
@@MISSING 43@@
@@MISSING 44@@
@@MISSING 45@@
@@MISSING 46@@
@@MISSING 47@@
@@MISSING 48@@
@@MISSING 49@@
@@MISSING 50@@
@@MISSING 51@@
@@MISSING 52@@
@@MISSING 53@@
@@MISSING 54@@
@@MISSING 55@@
@@MISSING 56@@
@@MISSING 57@@
@@MISSING 58@@
@@MISSING 59@@
@@MISSING 60@@
@@MISSING 61@@
@@MISSING 62@@
@@MISSING 63@@
@@MISSING 64@@
@@MISSING 65@@
@@MISSING 66@@
@@MISSING 67@@
@@MISSING 68@@
@@MISSING 69@@
@@MISSING 70@@
@@MISSING 71@@
@@MISSING 72@@
@@MISSING 73@@
@@MISSING 74@@
@@MISSING 75@@
@@MISSING 76@@
@@MISSING 77@@
@@MISSING 78@@
@@MISSING 79@@
        event.stopPropagation();
        const steps = this.wheel.read(event);
        if (steps) this.zoomBy(steps);
      },
      { passive: false },
    );

    // A street tile arriving changes unexplored ground, so redraw for it too.
    this.tiles.onTileLoaded(() => {
      this.timer = REDRAW_INTERVAL;
    });

    settings.on('change', ({ key }) => {
      if (key.startsWith('minimap')) this.applySettings();
    });
    this.applySettings();
  }

  applySettings() {
    // Never more than a third of the window across. The setting is a size in
    // pixels, and a 240 px minimap on a 320 px phone is most of the screen
    // with the toolbar underneath it — so the window gets the last word.
    const room = Math.max(100, Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.34));
    const size = Math.min(clamp(settings.get('minimapSize'), 140, 460), room);
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    this.element.style.width = `${size}px`;
    this.element.style.height = `${size}px`;
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.dpr = dpr;
    this.size = size;
    this.element.dataset.corner = settings.get('minimapCorner');
    this.element.dataset.shape = settings.get('minimapShape');
    this.element.style.display = settings.get('minimapVisible') ? '' : 'none';
    this.timer = REDRAW_INTERVAL;
  }

  /** Re-fit when the window changes shape; the cap above depends on it. */
  onResize() {
    this.applySettings();
  }

  zoomBy(delta) {
    const next = clamp(Math.round(settings.get('minimapZoom') + delta), 3, 19);
    settings.set('minimapZoom', next);
    this.timer = REDRAW_INTERVAL;
  }

  toggle() {
    settings.set('minimapVisible', !settings.get('minimapVisible'));
  }

  update(player, dt) {
    if (!settings.get('minimapVisible')) return;
    this.timer += dt;
    if (this.timer < REDRAW_INTERVAL) return;
    this.timer = 0;

    const zoom = settings.get('minimapZoom');
    const rotate = settings.get('minimapRotates');
    const rotation = rotate ? -player.heading : 0;

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawMap(
      ctx,
      {
        centerLat: player.lat,
        centerLon: player.lon,
        zoom,
        width: this.size,
        height: this.size,
        rotation,
      },
      {
        tiles: this.tiles,
        street: this.street,
        exploration: this.exploration,
        waypointStore: this.waypointStore,
        trail: this.trail,
        others: this.others,
        player: { lat: player.lat, lon: player.lon, heading: player.heading },
        options: {
          fog: settings.get('minimapFog'),
          trail: settings.get('showTrail'),
        others: this.others,
          labels: this.size >= 200,
          playerSize: 7,
          pathWidth: 1.3,
          compass: true,
          // Eight per cent of a 240 px minimap is a nineteen-pixel letter, which
          // is bigger than the place names underneath it and reads as a label
          // for the map rather than a mark on it. Five and a half, floored at
          // ten so it stays legible on a phone.
@@MISSING 176@@
@@MISSING 177@@
@@MISSING 178@@
@@MISSING 179@@
@@MISSING 180@@
@@MISSING 181@@
@@MISSING 182@@
@@MISSING 183@@
@@MISSING 184@@
@@MISSING 185@@
@@MISSING 186@@
@@MISSING 187@@
@@MISSING 188@@
@@MISSING 189@@
@@MISSING 190@@
@@MISSING 191@@
@@MISSING 192@@
@@MISSING 193@@
@@MISSING 194@@
@@MISSING 195@@
@@MISSING 196@@
@@MISSING 197@@
@@MISSING 198@@

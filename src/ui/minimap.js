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
  constructor(root, { tiles, street, exploration, waypointStore, trail }) {
    this.tiles = tiles;
    this.street = street;
    this.exploration = exploration;
    this.waypointStore = waypointStore;
    this.trail = trail;
    this.timer = 0;
    this.onOpenMap = null;

    this.element = document.createElement('div');
    this.element.className = 'minimap';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.element.appendChild(this.canvas);

    this.overlay = document.createElement('div');
    this.overlay.className = 'minimap-overlay';
    this.overlay.innerHTML = `
      <div class="minimap-scale"><i></i><span>—</span></div>
      <div class="minimap-zoom">
        <button type="button" data-zoom="1" title="Zoom in">+</button>
        <button type="button" data-zoom="-1" title="Zoom out">−</button>
      </div>
      <div class="minimap-readout"><span class="minimap-z">z14</span></div>
      <div class="minimap-hint"><kbd data-key="worldMap"></kbd>map</div>
    `;
    this.element.appendChild(this.overlay);
    root.appendChild(this.element);

    this.scaleLabel = this.overlay.querySelector('.minimap-scale span');
    this.scaleBar = this.overlay.querySelector('.minimap-scale i');
    this.zoomLabel = this.overlay.querySelector('.minimap-z');
    this.hintKey = this.overlay.querySelector('.minimap-hint kbd');
    const refreshHint = () => {
      this.hintKey.textContent = keybinds.labelFor('worldMap');
    };
    refreshHint();
    keybinds.on('change', refreshHint);

    this.overlay.querySelectorAll('[data-zoom]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.zoomBy(Number(button.dataset.zoom));
      });
    });

    this.canvas.addEventListener('click', () => {
      if (this.onOpenMap) this.onOpenMap();
    });
    // Whole levels here, one per two notches: the minimap has nine of them to
    // cover and a trackpad flick used to run through the lot.
    this.wheel = new WheelSteps(2);
    this.element.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
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
        player: { lat: player.lat, lon: player.lon, heading: player.heading },
        options: {
          fog: settings.get('minimapFog'),
          trail: settings.get('showTrail'),
          waypoints: settings.get('minimapShowWaypoints'),
          labels: this.size >= 200,
          playerSize: 7,
          pathWidth: 1.3,
          compass: true,
          // Eight per cent of a 240 px minimap is a nineteen-pixel letter, which
          // is bigger than the place names underneath it and reads as a label
          // for the map rather than a mark on it. Five and a half, floored at
          // ten so it stays legible on a phone.
          compassSize: Math.max(10, Math.round(this.size * 0.055)),
        },
      },
    );

    const mpp = metresPerPixel(player.lat, zoom);
    const barPx = 56;
    this.scaleBar.style.width = `${barPx}px`;
    this.scaleLabel.textContent = formatDistance(mpp * barPx, settings.get('units'), 0);
    this.zoomLabel.textContent = `z${zoom}`;
    // One north marker, not two. There used to be an HTML "N" pinned over the
    // corner as well as the compass the canvas draws, so a rotated minimap had
    // two of them disagreeing about which way north was — the HTML one turned
    // with the map, the drawn one stayed with the compass.
  }
}

import { WheelSteps } from './wheel.js';
import { cheats } from '../core/cheats.js';
import { clamp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { formatArea, formatDistance, formatLatLon } from '../core/units.js';
import { geocoder } from '../geo/geocode.js';
import { haversine } from '../geo/mercator.js';
import { drawMap, metresPerPixel, project, unproject, worldPixelSize } from './mapRenderer.js';

/**
 * How close a press has to be to a waypoint to pick it up, in pixels.
 *
 * The marker is drawn as a seven-pixel square, so half of it is 3.5 — too small
 * to hit reliably with a touchpad, and much too small for a finger. Nine is
 * about a fingertip's worth of slack without swallowing presses meant for the
 * map underneath.
 */
const WAYPOINT_GRAB_PX = 9;

/**
 * The full-screen map: everything the minimap shows, at any zoom, plus the
 * places you have saved and the routes you have drawn. Drag to pan, wheel to
 * zoom, double-click to travel there.
 */

export class WorldMap {
  constructor(root, { tiles, street, exploration, waypointStore, trail }) {
    this.tiles = tiles;
    this.street = street;
    this.exploration = exploration;
    this.waypointStore = waypointStore;
    this.trail = trail;
    this.open = false;
    this.zoom = 6;
    this.centre = { lat: 0, lon: 0 };
    this.player = { lat: 0, lon: 0, heading: 0 };
    this.dragging = false;
    this.draggingWaypoint = null;
    this.dirty = true;
    this.onTeleport = null;
    this.onRandomTeleport = null;
    this.onNotice = null;

    this.element = document.createElement('div');
    this.element.className = 'panel worldmap';
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="panel-head">
        <h2>World map</h2>
        <div class="worldmap-search">
          <input type="search" placeholder="Search a place" aria-label="Search a place" />
          <button type="button" data-action="search">Go</button>
        </div>
        <button type="button" class="panel-close" data-action="close" title="Close">Close</button>
      </div>
      <div class="worldmap-body">
        <div class="worldmap-canvas-wrap">
          <canvas></canvas>
          <div class="worldmap-hud">
            <span class="worldmap-centre">—</span>
            <span class="worldmap-scale"><i></i><em>—</em></span>
          </div>
          <div class="worldmap-zoom map-zoom-glyph">
            <button type="button" data-zoom="1" title="Zoom in" aria-label="Zoom in"></button>
            <button type="button" data-zoom="-1" title="Zoom out" aria-label="Zoom out"></button>
          </div>
          <ul class="worldmap-results" hidden></ul>
        </div>
        <aside class="worldmap-side">
          <div class="worldmap-actions">
            <button type="button" data-action="rtp">Random teleport</button>
            <button type="button" data-action="waypoint">Waypoint at centre</button>
            <button type="button" data-action="copy">Copy centre</button>
            <button type="button" data-action="teleport" data-directed hidden>Travel to centre</button>
          </div>
          <label class="worldmap-tick"><input type="checkbox" data-trail /> Show my trail</label>
          <label class="worldmap-tick"><input type="checkbox" data-drawn /> Drawn map only — no satellite</label>
          <div class="worldmap-stats"></div>
          <h3>Waypoints</h3>
          <ul class="worldmap-list" data-list="waypoints"></ul>
          <div class="worldmap-danger">
            <button type="button" data-action="clear-explored">Clear explored areas</button>
          </div>
        </aside>
      </div>
    `;
    root.appendChild(this.element);

    this.canvas = this.element.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.centreLabel = this.element.querySelector('.worldmap-centre');
    this.scaleLabel = this.element.querySelector('.worldmap-scale em');
    this.scaleBar = this.element.querySelector('.worldmap-scale i');
    this.statsBox = this.element.querySelector('.worldmap-stats');
    this.searchInput = this.element.querySelector('.worldmap-search input');
    this.resultList = this.element.querySelector('.worldmap-results');

    this.bindEvents();
    this.waypointStore.on('change', () => {
      this.renderLists();
      this.dirty = true;
    });
    // This map repaints only when something marks it dirty, so everything that
    // can change what it shows has to say so. The satellite cache already did.
    // The street cache did not — and with the fog on, the street map is what
    // fills every part of the view you have not been to, which on a map opened
    // somewhere new is all of it. So it painted once, at the moment it opened,
    // with nothing loaded, and then sat there: an empty grid with a compass on
    // it and no map at all, until you happened to drag it.
    this.tiles.onTileLoaded(() => {
      this.dirty = true;
    });
    this.street?.onTileLoaded?.(() => {
      this.dirty = true;
    });
    this.exploration.on('change', () => {
      this.dirty = true;
    });
  }

  bindEvents() {
    this.element.addEventListener('click', (event) => {
      const target = event.target.closest('[data-action], [data-zoom], [data-id]');
      if (!target) return;
      if (target.dataset.zoom) {
        this.setZoom(this.zoom + Number(target.dataset.zoom) * 0.5);
        return;
      }
      if (target.dataset.action) this.handleAction(target.dataset.action, target);
    });

    this.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.search();
      event.stopPropagation();
    });

    const canvas = this.canvas;
    canvas.addEventListener('mousedown', (event) => {
      // A press on a waypoint picks the waypoint up; anywhere else pans the map.
      const hit = this.waypointAt(event);
      if (hit) {
        this.draggingWaypoint = hit.id;
        canvas.classList.add('dragging-waypoint');
        return;
      }
      this.dragging = true;
      this.dragStart = { x: event.clientX, y: event.clientY, centre: { ...this.centre } };
      canvas.classList.add('dragging');
    });
    window.addEventListener('mousemove', (event) => {
      if (!this.open) return;
      if (this.draggingWaypoint !== null && this.draggingWaypoint !== undefined) {
        const where = this.pointToLatLon(event);
        if (where) {
          this.waypointStore.move(this.draggingWaypoint, where.lat, where.lon);
          this.dirty = true;
        }
        return;
      }
      if (!this.dragging) return;
      const size = worldPixelSize(this.zoom);
      const origin = project(this.dragStart.centre.lat, this.dragStart.centre.lon, this.zoom);
      const moved = unproject(
        origin.x - (event.clientX - this.dragStart.x),
        clamp(origin.y - (event.clientY - this.dragStart.y), 0, size),
        this.zoom,
      );
      this.centre = moved;
      this.dirty = true;
    });
    window.addEventListener('mouseup', () => {
      this.dragging = false;
      this.draggingWaypoint = null;
      canvas.classList.remove('dragging');
      canvas.classList.remove('dragging-waypoint');
    });
    // Which one the pointer is over, so the cursor says it can be picked up
    // before you try.
    canvas.addEventListener('mousemove', (event) => {
      if (this.dragging || this.draggingWaypoint) return;
      canvas.classList.toggle('over-waypoint', !!this.waypointAt(event));
    });
    // Two notches of wheel per half level. The step used to be a quarter of a
    // level while setZoom rounded to halves, so zooming *out* from any settled
    // value rounded straight back to where it started and did nothing at all —
    // which is why the map zoomed about half the time, and moved twice as far
    // as intended when it did.
    this.wheel = new WheelSteps(2);
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const steps = this.wheel.read(event);
        if (!steps) return;
        // Zoom about the pointer, the way every map does. Zooming about the
        // centre instead means the thing you are pointing at slides away from
        // you as you go in, and the further off-centre it is the further it
        // slides — which is the map "zooming out too much to the left".
        const anchor = this.pointAt(event);
        this.setZoom(this.zoom + steps * 0.5, anchor);
      },
      { passive: false },
    );
    canvas.addEventListener('dblclick', (event) => {
      if (!cheats.unlocked) return;
      const point = this.pointAt(event);
      if (point && this.onTeleport) this.onTeleport(point.lat, point.lon);
    });

    const trailTick = this.element.querySelector('[data-trail]');
    trailTick.addEventListener('change', () => settings.set('showTrail', trailTick.checked));

    const drawnTick = this.element.querySelector('[data-drawn]');
    drawnTick.addEventListener('change', () => settings.set('mapDrawnOnly', drawnTick.checked));

    cheats.on('unlock', () => this.applyPermissions());
  }

  pointAt(event) {
    const rect = this.canvas.getBoundingClientRect();
    const origin = project(this.centre.lat, this.centre.lon, this.zoom);
    const px = origin.x + (event.clientX - rect.left - rect.width / 2);
    const py = origin.y + (event.clientY - rect.top - rect.height / 2);
    return unproject(px, py, this.zoom);
  }

  handleAction(action, target) {
    switch (action) {
      case 'close':
        this.close();
        break;
      case 'search':
        this.search();
        break;
      case 'teleport':
        if (this.onTeleport) this.onTeleport(this.centre.lat, this.centre.lon);
        break;
      case 'rtp':
        if (this.onRandomTeleport) this.onRandomTeleport();
        break;
      case 'waypoint': {
        const waypoint = this.waypointStore.add(this.centre.lat, this.centre.lon, '');
        this.notify(`Waypoint "${waypoint.name}" saved`);
        break;
      }
      case 'copy':
        this.copy(formatLatLon(this.centre.lat, this.centre.lon, 6));
        break;
      case 'clear-explored':
        this.exploration.clear();
        this.dirty = true;
        this.notify('Explored areas cleared');
        break;
      case 'goto': {
        this.centre = { lat: Number(target.dataset.lat), lon: Number(target.dataset.lon) };
        this.dirty = true;
        break;
      }
      case 'travel':
        if (this.onTeleport) {
          this.onTeleport(Number(target.dataset.lat), Number(target.dataset.lon));
        }
        break;
      case 'delete-waypoint':
        this.waypointStore.remove(Number(target.dataset.id));
        break;
      default:
        break;
    }
  }

  async copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.notify(`Copied ${text}`);
    } catch {
      this.notify('Clipboard blocked by the browser');
    }
  }

  notify(message) {
    if (this.onNotice) this.onNotice(message);
  }

  async search() {
    const query = this.searchInput.value.trim();
    if (!query) return;
    this.resultList.hidden = false;
    this.resultList.innerHTML = '<li class="muted">Searching…</li>';
    try {
      const results = await geocoder.search(query);
      if (results.length === 0) {
        this.resultList.innerHTML = '<li class="muted">Nothing found</li>';
        return;
      }
      this.resultList.innerHTML = results
        .map(
          (r) =>
            `<li><button type="button" data-action="goto" data-lat="${r.lat}" data-lon="${r.lon}">${escapeHtml(r.label)}</button></li>`,
        )
        .join('');
    } catch (err) {
      this.resultList.innerHTML = `<li class="muted">Search unavailable (${escapeHtml(String(err.message ?? err))})</li>`;
    }
  }

  /**
   * @param {number} zoom
   * @param {{lat:number,lon:number}} [anchor] a point to keep under the pointer
   */
  setZoom(zoom, anchor = null) {
    // Quantised to the same half level the wheel steps in, so a step always
    // lands somewhere new. Rounding finer than the step is what stalled it.
    const next = clamp(Math.round(zoom * 2) / 2, 2, 19);
    if (next === this.zoom) return;
    if (anchor && Number.isFinite(anchor.lat)) {
      // Keep the anchor where it is on screen: move the centre by the part of
      // the offset the zoom change would otherwise magnify.
      //
      // In projected pixels, not in degrees. Mercator stretches latitude, so
      // splitting the difference in degrees holds the anchor still only near
      // the equator; over Britain it slides several tiles a step, and over
      // Greenland it bolts. Pixels are what is actually on the screen, so the
      // arithmetic is exact wherever you are.
      const span = worldPixelSize(0);
      const a = project(anchor.lat, anchor.lon, 0);
      const c = project(this.centre.lat, this.centre.lon, 0);
      let dx = c.x - a.x;
      // Whichever way round the world is nearer.
      if (dx > span / 2) dx -= span;
      if (dx < -span / 2) dx += span;
      const factor = Math.pow(2, next - this.zoom);
      this.centre = unproject(
        a.x + dx / factor,
        clamp(a.y + (c.y - a.y) / factor, 0, span),
        0,
      );
    }
    this.zoom = next;
    // Remembered, so the map opens where you were reading it rather than
    // starting again from a whole continent every time.
    settings.set('worldMapZoom', next);
    this.dirty = true;
  }

  /** Directed teleports are not part of the game; they only exist with cheats. */
  applyPermissions() {
    this.element.querySelectorAll('[data-directed]').forEach((node) => {
      node.hidden = !cheats.unlocked;
    });
    this.element.querySelectorAll('[data-action="travel"]').forEach((node) => {
      node.hidden = !cheats.unlocked;
    });
  }

  /**
   * Watch the canvas's own box, rather than guessing from the window.
   *
   * The map is a canvas inside a flex panel, so its box changes for reasons the
   * window knows nothing about: the sidebar rewrapping on a narrow screen, the
   * waypoint list growing, a phone's toolbar sliding away. The only checks were
   * a window resize listener and, inside update, `clientWidth !== this.width` —
   * a two-dimensional size tested in one dimension. Get taller without getting
   * wider and the backing store kept its old height while the CSS stretched it
   * to the new one, which is a stretched map.
   *
   * A ResizeObserver is told about the box itself, whatever moved it. The width
   * and height check stays underneath as the fallback for anything without one,
   * and it asks about both now.
   */
  watchSize() {
    if (this.sizeWatch || typeof ResizeObserver === 'undefined') return;
    this.sizeWatch = new ResizeObserver(() => {
      if (this.open) this.resize();
    });
    this.sizeWatch.observe(this.canvas.parentElement);
  }

  show(player) {
    this.open = true;
    this.element.hidden = false;
    this.watchSize();
    // Where you left it. It opened at six every time — most of a continent —
    // so the first thing anybody did on opening the map was zoom in.
    this.zoom = clamp(Math.round(settings.get('worldMapZoom')), 2, 19);
    this.centre = { lat: player.lat, lon: player.lon };
    this.player = player;
    this.dirty = true;
    this.resize();
    this.renderLists();
    this.element.querySelector('[data-trail]').checked = settings.get('showTrail');
    this.element.querySelector('[data-drawn]').checked = settings.get('mapDrawnOnly');
    this.applyPermissions();
  }

  close() {
    this.open = false;
    this.element.hidden = true;
    this.resultList.hidden = true;
  }

  toggle(player) {
    if (this.open) this.close();
    else this.show(player);
  }

  /**
   * Where on the world a pointer is, from a mouse event over the canvas.
   *
   * The renderer draws everything relative to the canvas centre — it translates
   * there and then works in offsets — so this is that same transform read
   * backwards: pixels from the middle of the canvas, added to the centre's own
   * projected position, unprojected.
   */
  pointToLatLon(event) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    const origin = project(this.centre.lat, this.centre.lon, this.zoom);
    const size = worldPixelSize(this.zoom);
    return unproject(origin.x + dx, clamp(origin.y + dy, 0, size), this.zoom);
  }

  /**
   * The waypoint under the pointer, if any.
   *
   * Tested in pixels rather than in metres, because that is what a hand is
   * aiming with: the marker is a seven-pixel square, and the grab area is a
   * little wider than it is drawn so it can be picked up on a touchpad. The
   * nearest is taken when two overlap, or the one drawn underneath would be
   * unreachable wherever they sit on top of each other.
   */
  waypointAt(event) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const px = event.clientX - rect.left - rect.width / 2;
    const py = event.clientY - rect.top - rect.height / 2;
    const origin = project(this.centre.lat, this.centre.lon, this.zoom);
    const size = worldPixelSize(this.zoom);
    let best = null;
    let bestDistance = WAYPOINT_GRAB_PX;
    for (const waypoint of this.waypointStore.waypoints) {
      const p = project(waypoint.lat, waypoint.lon, this.zoom);
      let ox = p.x - origin.x;
      // The short way round the antimeridian, exactly as the renderer takes it.
      if (ox > size / 2) ox -= size;
      if (ox < -size / 2) ox += size;
      const d = Math.hypot(ox - px, p.y - origin.y - py);
      if (d < bestDistance) {
        bestDistance = d;
        best = waypoint;
      }
    }
    return best;
  }

  resize() {
    const wrap = this.canvas.parentElement;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.dpr = dpr;
    this.width = width;
    this.height = height;
    this.dirty = true;
  }

  update(player) {
    if (!this.open) return;
    this.player = player;
    const wrap = this.canvas.parentElement;
    if (wrap.clientWidth !== this.width || wrap.clientHeight !== this.height) this.resize();
    if (!this.dirty) return;
    this.dirty = false;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawMap(
      this.ctx,
      {
        centerLat: this.centre.lat,
        centerLon: this.centre.lon,
        zoom: this.zoom,
        width: this.width,
        height: this.height,
        rotation: 0,
      },
      {
        tiles: this.tiles,
        street: this.street,
        exploration: this.exploration,
        waypointStore: this.waypointStore,
        trail: this.trail,
        player,
        options: {
          fog: settings.get('minimapFog'),
          drawnOnly: settings.get('mapDrawnOnly'),
          trail: settings.get('showTrail'),
          waypoints: true,
          labels: true,
          playerSize: 9,
          pathWidth: 1.6,
          compass: true,
          compassSize: 30,
        },
      },
    );

    const units = settings.get('units');
    const mpp = metresPerPixel(this.centre.lat, this.zoom);
    this.scaleBar.style.width = '90px';
    this.scaleLabel.textContent = formatDistance(mpp * 90, units, 0);
    const distance = haversine(this.centre, { lat: player.lat, lon: player.lon });
    this.centreLabel.textContent = `${formatLatLon(this.centre.lat, this.centre.lon, 5)} · z${this.zoom} · ${formatDistance(distance, units)} from you`;

    const area = this.exploration.areaKm2(player.lat);
    this.statsBox.innerHTML = `
      <div><span>Explored</span><strong>${formatArea(area, units)}</strong></div>
      <div><span>Waypoints</span><strong>${this.waypointStore.waypoints.length}</strong></div>
      <div><span>Trail</span><strong>${formatDistance(this.trail.length, units)}</strong></div>
    `;
  }

  renderLists() {
    const units = settings.get('units');
    const waypointList = this.element.querySelector('[data-list="waypoints"]');
    waypointList.innerHTML =
      this.waypointStore.waypoints
        .map(
          (w) => `
        <li>
          <button type="button" class="link" data-action="goto" data-lat="${w.lat}" data-lon="${w.lon}">
            <i style="background:${w.colour}"></i>${escapeHtml(w.name)}
          </button>
          <span class="muted">${formatLatLon(w.lat, w.lon, 3)}</span>
          <button type="button" class="mini" data-action="travel" data-lat="${w.lat}" data-lon="${w.lon}">Go</button>
          <button type="button" class="mini" data-action="delete-waypoint" data-id="${w.id}">×</button>
        </li>`,
        )
        .join('') || '<li class="muted">None yet — press the waypoint key to drop one.</li>';
    this.applyPermissions();
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

export { escapeHtml };

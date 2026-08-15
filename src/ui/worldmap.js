import { clamp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { formatDistance, formatLatLon } from '../core/units.js';
import { geocoder } from '../geo/geocode.js';
import { haversine } from '../geo/mercator.js';
import { drawMap, metresPerPixel, project, unproject, worldPixelSize } from './mapRenderer.js';

/**
 * The full-screen map: everything the minimap shows, at any zoom, plus the
 * places you have saved and the routes you have drawn. Drag to pan, wheel to
 * zoom, double-click to travel there.
 */

export class WorldMap {
  constructor(root, { tiles, exploration, waypointStore, trail }) {
    this.tiles = tiles;
    this.exploration = exploration;
    this.waypointStore = waypointStore;
    this.trail = trail;
    this.open = false;
    this.zoom = 6;
    this.centre = { lat: 0, lon: 0 };
    this.player = { lat: 0, lon: 0, heading: 0 };
    this.dragging = false;
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
          <div class="worldmap-zoom">
            <button type="button" data-zoom="1">+</button>
            <button type="button" data-zoom="-1">−</button>
          </div>
          <ul class="worldmap-results" hidden></ul>
        </div>
        <aside class="worldmap-side">
          <div class="worldmap-actions">
            <button type="button" data-action="teleport">Travel to centre</button>
            <button type="button" data-action="rtp">Random teleport</button>
            <button type="button" data-action="waypoint">Waypoint at centre</button>
            <button type="button" data-action="copy">Copy centre</button>
          </div>
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
    this.tiles.onTileLoaded(() => {
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
      this.dragging = true;
      this.dragStart = { x: event.clientX, y: event.clientY, centre: { ...this.centre } };
      canvas.classList.add('dragging');
    });
    window.addEventListener('mousemove', (event) => {
      if (!this.dragging || !this.open) return;
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
      canvas.classList.remove('dragging');
    });
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        // Half a level per notch: a full level per notch flew past the scale
        // you were looking for.
        this.setZoom(this.zoom + (event.deltaY > 0 ? -0.5 : 0.5));
      },
      { passive: false },
    );
    canvas.addEventListener('dblclick', (event) => {
      const point = this.pointAt(event);
      if (point && this.onTeleport) this.onTeleport(point.lat, point.lon);
    });
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

  setZoom(zoom) {
    this.zoom = clamp(Math.round(zoom * 2) / 2, 2, 19);
    this.dirty = true;
  }

  show(player) {
    this.open = true;
    this.element.hidden = false;
    this.centre = { lat: player.lat, lon: player.lon };
    this.player = player;
    this.dirty = true;
    this.resize();
    this.renderLists();
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
    if (this.canvas.parentElement.clientWidth !== this.width) this.resize();
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
        exploration: this.exploration,
        waypointStore: this.waypointStore,
        trail: this.trail,
        player,
        options: {
          fog: settings.get('minimapFog'),
          trail: true,
          waypoints: true,
          labels: true,
          grid: this.zoom >= 12,
          playerSize: 9,
          pathWidth: 1.6,
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
      <div><span>Explored</span><strong>${area < 10 ? area.toFixed(1) : Math.round(area).toLocaleString()} km²</strong></div>
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

  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

export { escapeHtml };

import { WheelSteps } from './wheel.js';
import { cheats } from '../core/cheats.js';
import { clamp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { formatArea, formatDistance, formatLatLon } from '../core/units.js';
import { geocoder } from '../geo/geocode.js';
import { BODY, ON_EARTH } from '../geo/bodies.js';
import { ONLINE } from '../core/boot.js';
import { searchFeatures } from '../geo/gazetteer.js';
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
  constructor(root, { tiles, street, exploration, waypointStore, trail, others = null }) {
    this.others = others;
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
            ${ONLINE ? '<button type="button" data-action="party-waypoint" title="A waypoint everyone in your party sees">Party waypoint at centre</button>' : ''}
            <button type="button" data-action="copy">Copy centre</button>
            <button type="button" data-action="teleport" data-directed hidden>Travel to centre</button>
          </div>
          <label class="worldmap-tick"><input type="checkbox" data-trail /> Show my trail</label>
          <label class="worldmap-tick"><input type="checkbox" data-drawn /> Drawn map only — no satellite</label>
          <div class="worldmap-stats"></div>
          <h3>Waypoints</h3>
          <ul class="worldmap-list" data-list="waypoints"></ul>
          ${ONLINE ? '' : `<div class="worldmap-danger">
            <button type="button" data-action="clear-explored">Clear explored areas</button>
          </div>`}
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
@@MISSING 154@@
@@MISSING 155@@
@@MISSING 156@@
@@MISSING 157@@
@@MISSING 158@@
@@MISSING 159@@
          this.dirty = true;
          this.dirty = true;
@@MISSING 162@@
@@MISSING 163@@
@@MISSING 164@@
@@MISSING 165@@
@@MISSING 166@@
@@MISSING 167@@
@@MISSING 168@@
@@MISSING 169@@
@@MISSING 170@@
@@MISSING 171@@
@@MISSING 172@@
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
      case 'party-waypoint':
        this.onPartyMark?.(this.centre.lat, this.centre.lon);
        break;
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
@@MISSING 281@@
@@MISSING 282@@
@@MISSING 283@@
@@MISSING 284@@
@@MISSING 285@@
@@MISSING 286@@
@@MISSING 287@@
@@MISSING 288@@
@@MISSING 289@@
@@MISSING 290@@
@@MISSING 291@@
@@MISSING 292@@
@@MISSING 293@@
@@MISSING 294@@
@@MISSING 295@@
@@MISSING 296@@
@@MISSING 297@@
@@MISSING 298@@
@@MISSING 299@@
@@MISSING 300@@
@@MISSING 301@@
@@MISSING 302@@
@@MISSING 303@@
@@MISSING 304@@
@@MISSING 305@@
@@MISSING 306@@
@@MISSING 307@@
@@MISSING 308@@
@@MISSING 309@@
@@MISSING 310@@
@@MISSING 311@@
@@MISSING 312@@
@@MISSING 313@@
@@MISSING 314@@
@@MISSING 315@@
@@MISSING 316@@
@@MISSING 317@@
@@MISSING 318@@
@@MISSING 319@@
@@MISSING 320@@
@@MISSING 321@@
@@MISSING 322@@
@@MISSING 323@@
@@MISSING 324@@
@@MISSING 325@@
@@MISSING 326@@
@@MISSING 327@@
@@MISSING 328@@
@@MISSING 329@@
@@MISSING 330@@
@@MISSING 331@@
@@MISSING 332@@
@@MISSING 333@@
@@MISSING 334@@
@@MISSING 335@@
@@MISSING 336@@
@@MISSING 337@@
@@MISSING 338@@
@@MISSING 339@@
@@MISSING 340@@
@@MISSING 341@@
@@MISSING 342@@
@@MISSING 343@@
@@MISSING 344@@
@@MISSING 345@@
@@MISSING 346@@
@@MISSING 347@@
@@MISSING 348@@
@@MISSING 349@@
@@MISSING 350@@
@@MISSING 351@@
@@MISSING 352@@
    this.dirty = true;
@@MISSING 354@@
@@MISSING 355@@
@@MISSING 356@@
@@MISSING 357@@
@@MISSING 358@@
@@MISSING 359@@
@@MISSING 360@@
@@MISSING 361@@
@@MISSING 362@@
@@MISSING 363@@
@@MISSING 364@@
@@MISSING 365@@
@@MISSING 366@@
@@MISSING 367@@
@@MISSING 368@@
@@MISSING 369@@
@@MISSING 370@@
@@MISSING 371@@
@@MISSING 372@@
@@MISSING 373@@
@@MISSING 374@@
@@MISSING 375@@
@@MISSING 376@@
@@MISSING 377@@
@@MISSING 378@@
@@MISSING 379@@
@@MISSING 380@@
@@MISSING 381@@
@@MISSING 382@@
@@MISSING 383@@
@@MISSING 384@@
@@MISSING 385@@
@@MISSING 386@@
@@MISSING 387@@
@@MISSING 388@@
@@MISSING 389@@
  show(player) {
@@MISSING 391@@
@@MISSING 392@@
@@MISSING 393@@
@@MISSING 394@@
@@MISSING 395@@
@@MISSING 396@@
@@MISSING 397@@
    this.dirty = true;
@@MISSING 399@@
@@MISSING 400@@
@@MISSING 401@@
@@MISSING 402@@
@@MISSING 403@@
@@MISSING 404@@
@@MISSING 405@@
@@MISSING 406@@
  close() {
@@MISSING 408@@
@@MISSING 409@@
@@MISSING 410@@
@@MISSING 411@@
@@MISSING 412@@
  toggle(player) {
@@MISSING 414@@
@@MISSING 415@@
@@MISSING 416@@
@@MISSING 417@@
@@MISSING 418@@
@@MISSING 419@@
@@MISSING 420@@
@@MISSING 421@@
@@MISSING 422@@
@@MISSING 423@@
@@MISSING 424@@
@@MISSING 425@@
@@MISSING 426@@
@@MISSING 427@@
@@MISSING 428@@
@@MISSING 429@@
@@MISSING 430@@
@@MISSING 431@@
@@MISSING 432@@
@@MISSING 433@@
@@MISSING 434@@
@@MISSING 435@@
@@MISSING 436@@
@@MISSING 437@@
@@MISSING 438@@
@@MISSING 439@@
@@MISSING 440@@
@@MISSING 441@@
@@MISSING 442@@
@@MISSING 443@@
@@MISSING 444@@
@@MISSING 445@@
@@MISSING 446@@
@@MISSING 447@@
@@MISSING 448@@
@@MISSING 449@@
@@MISSING 450@@
@@MISSING 451@@
@@MISSING 452@@
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
@@MISSING 490@@
@@MISSING 491@@
    drawMap(
@@MISSING 493@@
@@MISSING 494@@
@@MISSING 495@@
@@MISSING 496@@
@@MISSING 497@@
@@MISSING 498@@
@@MISSING 499@@
@@MISSING 500@@
@@MISSING 501@@
@@MISSING 502@@
@@MISSING 503@@
@@MISSING 504@@
@@MISSING 505@@
@@MISSING 506@@
@@MISSING 507@@
@@MISSING 508@@
        others: this.others,
@@MISSING 510@@
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
@@MISSING 561@@
@@MISSING 562@@
@@MISSING 563@@
@@MISSING 564@@
@@MISSING 565@@
@@MISSING 566@@
@@MISSING 567@@

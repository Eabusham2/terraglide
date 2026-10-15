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
@@MISSING 160@@
@@MISSING 161@@
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
@@MISSING 173@@
@@MISSING 174@@
@@MISSING 175@@
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
@@MISSING 199@@
@@MISSING 200@@
@@MISSING 201@@
@@MISSING 202@@
@@MISSING 203@@
@@MISSING 204@@
@@MISSING 205@@
@@MISSING 206@@
@@MISSING 207@@
@@MISSING 208@@
@@MISSING 209@@
@@MISSING 210@@
@@MISSING 211@@
@@MISSING 212@@
@@MISSING 213@@
@@MISSING 214@@
@@MISSING 215@@
@@MISSING 216@@
@@MISSING 217@@
@@MISSING 218@@
@@MISSING 219@@
@@MISSING 220@@
@@MISSING 221@@
@@MISSING 222@@
@@MISSING 223@@
@@MISSING 224@@
@@MISSING 225@@
@@MISSING 226@@
@@MISSING 227@@
@@MISSING 228@@
@@MISSING 229@@
@@MISSING 230@@
@@MISSING 231@@
@@MISSING 232@@
@@MISSING 233@@
@@MISSING 234@@
@@MISSING 235@@
@@MISSING 236@@
@@MISSING 237@@
@@MISSING 238@@
@@MISSING 239@@
@@MISSING 240@@
@@MISSING 241@@
@@MISSING 242@@
@@MISSING 243@@
@@MISSING 244@@
@@MISSING 245@@
@@MISSING 246@@
@@MISSING 247@@
@@MISSING 248@@
@@MISSING 249@@
@@MISSING 250@@
@@MISSING 251@@
@@MISSING 252@@
@@MISSING 253@@
@@MISSING 254@@
@@MISSING 255@@
@@MISSING 256@@
@@MISSING 257@@
@@MISSING 258@@
@@MISSING 259@@
@@MISSING 260@@
@@MISSING 261@@
@@MISSING 262@@
@@MISSING 263@@
@@MISSING 264@@
@@MISSING 265@@
@@MISSING 266@@
@@MISSING 267@@
@@MISSING 268@@
@@MISSING 269@@
@@MISSING 270@@
@@MISSING 271@@
@@MISSING 272@@
@@MISSING 273@@
@@MISSING 274@@
@@MISSING 275@@
@@MISSING 276@@
@@MISSING 277@@
@@MISSING 278@@
@@MISSING 279@@
@@MISSING 280@@
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
@@MISSING 353@@
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
@@MISSING 398@@
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
@@MISSING 453@@
@@MISSING 454@@
@@MISSING 455@@
@@MISSING 456@@
@@MISSING 457@@
@@MISSING 458@@
@@MISSING 459@@
@@MISSING 460@@
@@MISSING 461@@
@@MISSING 462@@
@@MISSING 463@@
@@MISSING 464@@
@@MISSING 465@@
@@MISSING 466@@
@@MISSING 467@@
@@MISSING 468@@
@@MISSING 469@@
@@MISSING 470@@
@@MISSING 471@@
@@MISSING 472@@
@@MISSING 473@@
@@MISSING 474@@
@@MISSING 475@@
@@MISSING 476@@
@@MISSING 477@@
@@MISSING 478@@
@@MISSING 479@@
@@MISSING 480@@
@@MISSING 481@@
@@MISSING 482@@
@@MISSING 483@@
@@MISSING 484@@
@@MISSING 485@@
@@MISSING 486@@
@@MISSING 487@@
@@MISSING 488@@
@@MISSING 489@@
@@MISSING 490@@
@@MISSING 491@@
@@MISSING 492@@
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
@@MISSING 511@@
@@MISSING 512@@
@@MISSING 513@@
@@MISSING 514@@
@@MISSING 515@@
@@MISSING 516@@
@@MISSING 517@@
@@MISSING 518@@
@@MISSING 519@@
@@MISSING 520@@
@@MISSING 521@@
@@MISSING 522@@
@@MISSING 523@@
@@MISSING 524@@
@@MISSING 525@@
@@MISSING 526@@
@@MISSING 527@@
@@MISSING 528@@
@@MISSING 529@@
@@MISSING 530@@
@@MISSING 531@@
@@MISSING 532@@
@@MISSING 533@@
@@MISSING 534@@
@@MISSING 535@@
@@MISSING 536@@
@@MISSING 537@@
@@MISSING 538@@
@@MISSING 539@@
@@MISSING 540@@
@@MISSING 541@@
@@MISSING 542@@
@@MISSING 543@@
@@MISSING 544@@
@@MISSING 545@@
@@MISSING 546@@
@@MISSING 547@@
@@MISSING 548@@
@@MISSING 549@@
@@MISSING 550@@
@@MISSING 551@@
@@MISSING 552@@
@@MISSING 553@@
@@MISSING 554@@
@@MISSING 555@@
@@MISSING 556@@
@@MISSING 557@@
@@MISSING 558@@
@@MISSING 559@@
@@MISSING 560@@
@@MISSING 561@@
@@MISSING 562@@
@@MISSING 563@@
@@MISSING 564@@
@@MISSING 565@@
@@MISSING 566@@
@@MISSING 567@@

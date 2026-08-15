import * as THREE from '../vendor/three/three.module.js';
import { clamp } from './core/math.js';
import { PerfGovernor } from './core/perf.js';
import { settings } from './core/settings.js';
import { readJSON, writeJSON } from './core/storage.js';
import { formatDistance, formatLatLon } from './core/units.js';
import { InputManager } from './camera/input.js';
import { CameraRig } from './camera/cameraRig.js';
import { LocalFrame } from './geo/frame.js';
import { geocoder } from './geo/geocode.js';
import { haversine, latToNormY, lonToNormX } from './geo/mercator.js';
import { waterMap } from './geo/water.js';
import { Avatar } from './player/avatar.js';
import { PlayerController } from './player/controller.js';
import { HOTBAR, Player } from './player/player.js';
import { ElevationField } from './tiles/elevation.js';
import { createElevationSource, createImagerySource } from './tiles/providers.js';
import { ImageryStreamer } from './tiles/streamer.js';
import { Buildings } from './world/buildings.js';
import { Panorama } from './world/panorama.js';
import { pickRandomDestination } from './world/rtp.js';
import { createSharedUniforms } from './world/shaders.js';
import { Sky } from './world/sky.js';
import { Terrain } from './world/terrain.js';
import { exploration } from './ui/exploration.js';
import { HelpCard } from './ui/help.js';
import { HUD } from './ui/hud.js';
import { mapTiles } from './ui/mapTiles.js';
import { Minimap } from './ui/minimap.js';
import { SettingsPanel } from './ui/settingsPanel.js';
import { trail } from './ui/trail.js';
import { waypoints } from './ui/waypoints.js';
import { WorldMap } from './ui/worldmap.js';

/**
 * The game: wiring, the frame loop, and the handful of decisions that only make
 * sense once everything is in one place — when to re-anchor the world, how a
 * teleport settles onto ground that has not streamed in yet, and which system
 * gets the frame's remaining milliseconds.
 */

const DEFAULT_SPAWN = { lat: 46.5606, lon: 7.9089 }; // Lauterbrunnen valley
const POSITION_KEY = 'last-position';
const SETTLE_MS = 2600;
/** Random teleports drop you here, high enough to open the wings. */
const SPAWN_HEIGHT_M = 420;

export class Game {
  constructor({ canvas, ui, onStatus }) {
    this.canvas = canvas;
    this.ui = ui;
    this.onStatus = onStatus ?? (() => {});
    this.running = false;
    this.lastTime = 0;
    this.perf = new PerfGovernor();
    this.settleUntil = 0;
    this.teleporting = false;
    this.debugVisible = false;
    this.landFraction = 0.6;
    this.saveTimer = 0;
    this.lastYaw = 0;
    this.notice = '';

    this.onStatus('Creating renderer');
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: settings.get('graphics') !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
      logarithmicDepthBuffer: true,
    });
    this.renderer.setClearColor(0x0d0f12, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xaebccd, 1 / 26000);
    this.camera = new THREE.PerspectiveCamera(settings.get('fov'), 1, 0.4, 260000);
    this.scene.add(this.camera);

    this.onStatus('Starting tile worker');
    this.worker = new Worker(new URL('./tiles/tileWorker.js', import.meta.url), { type: 'module' });

    this.frame = new LocalFrame(DEFAULT_SPAWN.lat, DEFAULT_SPAWN.lon);
    this.shared = createSharedUniforms();
    this.streamer = new ImageryStreamer(this.worker, this.renderer);
    this.elevation = new ElevationField(this.worker);
    this.terrain = new Terrain({
      scene: this.scene,
      frame: this.frame,
      streamer: this.streamer,
      elevation: this.elevation,
      shared: this.shared,
    });
    this.sky = new Sky(this.scene, this.shared);
    this.buildings = new Buildings({ scene: this.scene, frame: this.frame, terrain: this.terrain });
    this.panorama = new Panorama({ scene: this.scene, frame: this.frame, worker: this.worker });

    this.player = new Player(this.frame);
    this.controller = new PlayerController({
      player: this.player,
      terrain: this.terrain,
      buildings: this.buildings,
    });
    this.avatar = new Avatar(this.scene);
    this.rig = new CameraRig(this.camera);
    this.input = new InputManager(canvas);

    this.onStatus('Building interface');
    this.hud = new HUD(ui);
    this.minimap = new Minimap(ui, { tiles: mapTiles, exploration, waypointStore: waypoints, trail });
    this.worldmap = new WorldMap(ui, { tiles: mapTiles, exploration, waypointStore: waypoints, trail });
    this.settingsPanel = new SettingsPanel(ui);
    this.help = new HelpCard(ui);

    this.bindEvents();
    this.applyProviders();
    this.resize();
  }

  /* ---------------------------------------------------------------- setup */

  bindEvents() {
    this.input.on('action', ({ id, repeat }) => this.onAction(id, repeat));
    this.input.on('look', ({ dx, dy }) => this.rig.applyLook(this.player, dx, dy));
    this.input.on('boost', () => this.fireRocket());
    this.input.on('land', () => this.land());
    this.input.on('wheel', ({ delta }) => {
      if (this.rig.isFreecam) {
        const speed = this.rig.adjustFreecamSpeed(delta);
        this.toast(`Freecam ${Math.round(speed)} m/s`);
      } else {
        this.player.cycleSlot(delta);
      }
    });

    this.hud.onAction = (action) => {
      if (action.startsWith('slot:')) {
        this.player.selectSlot(Number(action.slice(5)));
        return;
      }
      const map = {
        rtp: 'rtp',
        map: 'worldMap',
        waypoint: 'waypoint',
        copy: 'copyCoords',
        settings: 'settings',
        help: 'help',
      };
      if (map[action]) this.onAction(map[action]);
    };

    // Clicking the minimap opens the big map centred where you are.
    this.minimap.onOpenMap = () => {
      this.worldmap.show({ lat: this.player.lat, lon: this.player.lon, heading: this.player.yaw });
    };

    this.worldmap.onTeleport = (lat, lon) => {
      this.worldmap.close();
      this.teleportTo(lat, lon, { reason: 'map' });
    };
    this.worldmap.onRandomTeleport = () => {
      this.worldmap.close();
      this.randomTeleport();
    };
    this.worldmap.onNotice = (message) => this.toast(message);

    this.settingsPanel.onChange = (key) => this.onSettingChanged(key);
    this.settingsPanel.onDataAction = (name, payload) => this.onDataAction(name, payload);

    geocoder.on('address', (place) => {
      this.address = place.label;
    });

    this.streamer.on('degraded', () => {
      mapTiles.setDegraded(true);
      this.toast('Imagery provider unreachable — showing generated terrain', 'warn');
    });

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.lastTime = performance.now();
    });
    window.addEventListener('beforeunload', () => {
      exploration.save();
      trail.save();
      this.savePosition();
    });
  }

  applyProviders() {
    this.imagerySource = createImagerySource(settings.values);
    this.elevationSource = createElevationSource(settings.values);
    this.streamer.setSource(this.imagerySource);
    this.elevation.setSource(this.elevationSource);
    mapTiles.setSource(this.imagerySource);
    mapTiles.setDegraded(false);
    waterMap.setSource(this.imagerySource);
    this.terrain.rebase();
    this.imagerySource.prepare();
    this.elevationSource.prepare();
  }

  onSettingChanged(key) {
    if (['imageryProvider', 'elevationProvider', 'googleKey', 'bingKey', 'mapboxKey'].includes(key)) {
      this.applyProviders();
      this.toast('Provider updated');
    }
    if (key === 'panoramaProvider' || key === 'mapillaryToken') this.panorama.clear();
    if (key === 'resolutionScale' || key === 'graphics') this.resize();
    if (key === 'meshDetail') this.terrain.rebase();
    if (key === 'mouseMode' && settings.get('mouseMode') === 'locked') this.input.requestPointerLock();
  }

  onDataAction(name, payload) {
    if (name === 'export') {
      const data = {
        version: 1,
        settings: settings.values,
        waypoints: waypoints.export(),
        trail: trail.legs,
        explored: [...exploration.cells],
        position: { lat: this.player.lat, lon: this.player.lon },
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'terraglide-save.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      this.toast('Save exported');
    } else if (name === 'import' && payload) {
      payload
        .text()
        .then((text) => {
          const data = JSON.parse(text);
          if (data.settings) settings.patch(data.settings);
          if (data.waypoints) waypoints.import(data.waypoints);
          if (Array.isArray(data.trail)) {
            trail.legs = data.trail;
            trail.dirty = true;
            trail.save();
          }
          if (Array.isArray(data.explored)) {
            for (const key of data.explored) exploration.cells.add(key);
            exploration.detailCount = exploration.countAt(14);
            exploration.dirty = true;
            exploration.save();
          }
          if (data.position) this.teleportTo(data.position.lat, data.position.lon, { reason: 'import' });
          this.toast('Save imported');
        })
        .catch(() => this.toast('That file could not be read', 'bad'));
    } else if (name === 'clear-explored') {
      exploration.clear();
      this.toast('Explored areas cleared');
    } else if (name === 'clear-marks') {
      waypoints.clearAll();
      trail.clear();
      this.toast('Waypoints and trail deleted');
    } else if (name === 'reset-settings') {
      this.applyProviders();
      this.toast('Settings reset');
    }
  }

  /* ------------------------------------------------------------- lifecycle */

  async start() {
    this.onStatus('Finding a place to stand');
    const saved = readJSON(POSITION_KEY, null);
    const spawn = saved && Number.isFinite(saved.lat) ? saved : DEFAULT_SPAWN;
    await this.teleportTo(spawn.lat, spawn.lon, { reason: 'spawn', quiet: true });

    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));

    if (this.help.firstRun) this.help.show();
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const cap = settings.preset().pixelRatioCap;
    const ratio = clamp((window.devicePixelRatio || 1) * this.perf.scale, 0.5, cap);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    if (this.worldmap.open) this.worldmap.resize();
  }

  loop(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this.loop(t));

    const dt = clamp((now - this.lastTime) / 1000, 0, 0.25);
    this.lastTime = now;
    if (document.hidden) return;

    this.perf.update(dt);
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /* ------------------------------------------------------------------ tick */

  update(dt) {
    const player = this.player;
    const panelOpen = this.settingsPanel.open || this.worldmap.open || this.help.open;
    if (panelOpen !== this.uiSuspended) {
      this.uiSuspended = panelOpen;
      this.input.setSuspended(panelOpen);
    }
    this.canvas.classList.toggle('pan', settings.get('mouseMode') === 'pan');

    const movement = this.input.movement();

    if (this.rig.isFreecam) {
      const ground = this.terrain.heightAt(this.rig.freecam.position.x, this.rig.freecam.position.z);
      this.rig.updateFreecam(dt, movement, ground);
      player.tickTimers(dt);
    } else if (this.settling) {
      this.settle(dt);
    } else {
      this.controller.update(dt, movement);
    }

    // Keep the world numerically comfortable around the player.
    if (this.frame.needsRebase(player.position.x, player.position.z)) this.rebase();
    player.syncGeo();

    const yawRate = (player.yaw - this.lastYaw) / Math.max(dt, 0.001);
    this.lastYaw = player.yaw;
    this.rig.setYawRate(yawRate);
    this.rig.update(player, dt, this.terrain);

    const budget = this.perf.budgetMs();
    this.terrain.update(this.camera, budget);
    this.terrain.invalidateStale(this.camera.position.x, this.camera.position.z);

    const groundHeight = player.groundHeight;
    this.sky.setLandFraction(this.landFraction);
    this.sky.update(this.camera, player.lat, player.lon, groundHeight);
    this.scene.fog.color.copy(this.sky.horizonColor);
    this.scene.fog.density = this.shared.uFogDensity.value;
    this.renderer.setClearColor(this.sky.horizonColor, 1);

    this.buildings.update(player.lat, player.lon, player.altitudeAboveGround);

    this.panorama.update(
      {
        lat: player.lat,
        lon: player.lon,
        altitudeAboveGround: player.altitudeAboveGround,
        speed: player.speed,
        groundHeight,
      },
      dt,
    );

    const showAvatar = settings.get('thirdPerson') || this.rig.isFreecam;
    this.avatar.setVisible(showAvatar);
    if (showAvatar) this.avatar.update(player, dt);

    exploration.visit(player.lat, player.lon, player.altitudeAboveGround);
    exploration.tick(dt);
    trail.record(player.lat, player.lon);
    trail.tick(dt);

    this.address = geocoder.lookup(player.lat, player.lon)?.label ?? this.address;

    this.hud.update({
      player,
      climate: this.sky.climate,
      address: this.address,
      status: this.statusLine(),
      attribution: this.attributionLine(),
      freecam: this.rig.isFreecam,
      onWater: this.terrain.isWaterAt(player.position.x, player.position.z),
      landAway: this.landAway,
      debug: this.debugVisible ? this.debugText() : '',
    });

    this.minimap.update(
      { lat: player.lat, lon: player.lon, heading: player.yaw },
      dt,
    );
    this.worldmap.update({ lat: player.lat, lon: player.lon, heading: player.yaw });

    this.updateWaterReadout(dt);

    this.saveTimer += dt;
    if (this.saveTimer > 8) {
      this.saveTimer = 0;
      this.savePosition();
    }
  }

  /**
   * Over open water, work out how far the nearest land is by walking outwards
   * through the elevation field. Cheap, and only while you are actually at sea.
   */
  updateWaterReadout(dt) {
    this.waterTimer = (this.waterTimer ?? 0) - dt;
    if (this.waterTimer > 0) return;
    this.waterTimer = 0.75;

    const player = this.player;
    if (!this.terrain.isWaterAt(player.position.x, player.position.z)) {
      this.landAway = '';
      return;
    }
    let nearest = Infinity;
    for (let ring = 1; ring <= 14; ring++) {
      const radius = ring * ring * 260;
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const x = player.position.x + Math.cos(angle) * radius;
        const z = player.position.z + Math.sin(angle) * radius;
        if (!this.terrain.isWaterAt(x, z)) nearest = Math.min(nearest, radius);
      }
      if (nearest < Infinity) break;
    }
    this.landAway = Number.isFinite(nearest)
      ? `land ~${formatDistance(nearest, settings.get('units'), 0)}`
      : 'open ocean';
  }

  get settling() {
    return performance.now() < this.settleUntil;
  }

  /**
   * Right after a teleport the elevation for the new place has not arrived, so
   * hold the player just above whatever the ground currently claims to be until
   * real data lands (or we give up waiting).
   */
  settle(dt) {
    const player = this.player;
    const ground = this.terrain.heightAt(player.position.x, player.position.z);
    player.position.y = ground + 1.2;
    player.groundHeight = ground;
    player.velocity.set(0, 0, 0);
    player.onGround = true;
    player.tickTimers(dt);

    // Release early once real elevation has landed and had a moment to settle.
    const waited = performance.now() - (this.settleUntil - SETTLE_MS);
    const norm = this.frame.worldToNorm(player.position.x, player.position.z);
    if (waited > 650 && this.elevation.hasData(norm.nx, norm.ny)) this.settleUntil = 0;
  }

  rebase() {
    const geo = this.player.syncGeo();
    const y = this.player.position.y;
    this.frame.setAnchor(geo.lat, geo.lon);
    this.player.position.set(0, y, 0);
    this.terrain.rebase();
    this.buildings.rebase();
    this.panorama.rebase();
    this.camera.position.set(0, y + this.player.eyeHeight, 0);
    if (this.rig.isFreecam) this.rig.freecam.position.set(0, y + 40, 0);
  }

  /* ------------------------------------------------------------- teleports */

  async teleportTo(lat, lon, { reason = 'manual', quiet = false } = {}) {
    this.teleporting = true;
    const player = this.player;
    const previous = { lat: player.lat, lon: player.lon };

    this.frame.setAnchor(lat, lon);
    this.terrain.rebase();
    this.buildings.rebase();
    this.panorama.clear();
    this.streamer.clear();

    // Prime elevation for the new area, coarse first so there is always
    // something to stand on.
    const nx = lonToNormX(lon);
    const ny = latToNormY(lat);
    this.elevation.ensureAround(nx, ny, 10, 1);
    this.elevation.ensureAround(nx, ny, Math.min(13, this.elevation.maxZoom), 1);

    const ground = Math.max(0, this.elevation.sampleLatLon(lat, lon));
    // Arrive in the air with the wings out: you are here to look around, and a
    // teleport that dumps you in a field facing a hedge wastes the trip.
    const airborne = reason === 'rtp' || reason === 'spawn';
    player.teleport(lat, lon, ground, airborne ? SPAWN_HEIGHT_M : 1.2);
    if (airborne) {
      player.onGround = false;
      player.toggleElytra(true);
    }
    trail.break();
    this.camera.position.set(0, ground + player.eyeHeight, 0);
    this.settleUntil = airborne ? 0 : performance.now() + SETTLE_MS;
    this.address = 'Locating…';

    if (!quiet) {
      const distance = haversine(previous, { lat, lon });
      this.toast(`Travelled ${formatDistance(distance, settings.get('units'))} · ${formatLatLon(lat, lon, 4)}`);
    }

    this.savePosition();
    this.refreshLandFraction(lat, lon);
    this.teleporting = false;
  }

  async randomTeleport() {
    if (this.rtpBusy) return;
    this.rtpBusy = true;
    this.toast('Looking for somewhere to land…');
    try {
      const destination = await pickRandomDestination({ waterMap });
      await this.teleportTo(destination.lat, destination.lon, { reason: 'rtp', quiet: true });
      const where = formatLatLon(destination.lat, destination.lon, 4);
      if (!destination.onLand && !settings.get('exploreSeas')) {
        this.toast(`Dropped at ${where} — could not confirm dry land`, 'warn');
      } else {
        this.toast(`Dropped at ${where}`);
      }
    } catch (err) {
      this.toast(`Teleport failed: ${err.message ?? err}`, 'bad');
    } finally {
      this.rtpBusy = false;
    }
  }

  refreshLandFraction(lat, lon) {
    waterMap
      .landFraction(lat, lon, 320)
      .then((value) => {
        this.landFraction = value;
      })
      .catch(() => {
        this.landFraction = 0.6;
      });
  }

  savePosition() {
    writeJSON(POSITION_KEY, { lat: this.player.lat, lon: this.player.lon });
  }

  /* --------------------------------------------------------------- actions */

  onAction(id, repeat = false) {
    if (repeat && id !== 'scaleUp' && id !== 'scaleDown') return;
    const player = this.player;

    switch (id) {
      case 'rtp':
        this.randomTeleport();
        break;
      case 'elytra': {
        const out = player.toggleElytra();
        this.toast(out ? 'Wings out' : 'Wings stowed');
        break;
      }
      case 'rocket':
        this.fireRocket();
        break;
      case 'speedMode':
        if (player.startSpeedMode()) this.toast('Speed mode — 2x');
        else if (player.speedCooldown > 0) {
          this.toast(`Speed mode recharging (${Math.ceil(player.speedCooldown)}s)`, 'warn');
        }
        break;
      case 'freecam': {
        const active = this.rig.toggleFreecam(player);
        this.toast(active ? 'Freecam on — wheel changes speed' : 'Freecam off');
        break;
      }
      case 'thirdPerson':
        settings.set('thirdPerson', !settings.get('thirdPerson'));
        break;
      case 'worldMap':
        this.worldmap.toggle({ lat: player.lat, lon: player.lon, heading: player.yaw });
        break;
      case 'waypoint': {
        const waypoint = waypoints.add(player.lat, player.lon, '', player.position.y);
        this.toast(`${waypoint.name} saved`);
        break;
      }
      case 'copyCoords':
        this.copyCoords();
        break;
      case 'minimapZoomIn':
        this.minimap.zoomBy(1);
        break;
      case 'minimapZoomOut':
        this.minimap.zoomBy(-1);
        break;
      case 'minimapToggle':
        this.minimap.toggle();
        break;
      case 'scaleUp':
      case 'scaleDown': {
        const factor = id === 'scaleUp' ? 1.12 : 1 / 1.12;
        const next = clamp(settings.get('playerScale') * factor, 0.25, 40);
        settings.set('playerScale', Number(next.toFixed(3)));
        this.toast(`Size ${next.toFixed(2)}x · ${(settings.get('playerHeightM') * next).toFixed(2)} m`);
        break;
      }
      case 'mouseMode': {
        const next = settings.get('mouseMode') === 'locked' ? 'pan' : 'locked';
        settings.set('mouseMode', next);
        this.toast(next === 'locked' ? 'Locked pointer — click to capture' : 'Click and pan');
        break;
      }
      case 'toggleHud':
        settings.set('hudVisible', !settings.get('hudVisible'));
        break;
      case 'settings':
        if (this.worldmap.open) this.worldmap.close();
        else if (this.help.open) this.help.close();
        else this.settingsPanel.toggle();
        break;
      case 'help':
        this.help.toggle();
        break;
      case 'debug':
        this.debugVisible = !this.debugVisible;
        break;
      default:
        if (id.startsWith('hotbar')) {
          const index = Number(id.slice(6)) - 1;
          this.useSlot(index);
        }
        break;
    }
  }

  /** Picking a hotbar slot just chooses which rocket you fire next. */
  useSlot(index) {
    this.player.selectSlot(index);
  }

  fireRocket() {
    const player = this.player;
    if (this.rig.isFreecam) return;
    if (!player.elytraDeployed) {
      if (!player.onGround) {
        player.toggleElytra(true);
      } else {
        this.toast('Jump, then open the wings before boosting', 'warn');
        return;
      }
    }
    if (player.fireRocket()) this.rig.kick(0.1 + player.rocketDuration * 0.02);
  }

  land() {
    const player = this.player;
    if (player.elytraDeployed) {
      player.toggleElytra(false);
      this.toast('Wings stowed');
    } else if (!player.onGround) {
      this.toast('Falling — open the wings to glide', 'warn');
    }
  }

  async copyCoords() {
    const text = formatLatLon(this.player.lat, this.player.lon, 6);
    try {
      await navigator.clipboard.writeText(text);
      this.toast(`Copied ${text}`);
    } catch {
      this.toast(`Clipboard blocked — ${text}`, 'warn');
    }
  }

  toast(message, tone = 'info') {
    this.hud.toast(message, tone);
  }

  /* --------------------------------------------------------------- readouts */

  statusLine() {
    const parts = [];
    const source = this.imagerySource;
    if (source) {
      if (source.state === 'needs-key') parts.push(`${source.descriptor.label}: key required`);
      else if (source.state === 'error') parts.push(`${source.descriptor.label}: ${source.error}`);
      else if (this.streamer.degraded) parts.push(`${source.descriptor.label}: unreachable, generated terrain`);
      else parts.push(source.descriptor.label);
    }
    if (this.elevation.unreachable) parts.push('elevation unavailable — flat terrain');
    if (this.panorama.status && this.panorama.status !== 'off') parts.push(`street: ${this.panorama.status}`);
    if (settings.get('showFps')) parts.push(`${Math.round(this.perf.fps)} fps`);
    return parts.join(' · ');
  }

  attributionLine() {
    const parts = [];
    if (this.imagerySource?.attribution) parts.push(this.imagerySource.attribution);
    if (this.elevationSource?.attribution) parts.push(this.elevationSource.attribution);
    if (settings.get('buildings')) parts.push('Buildings © OpenStreetMap contributors');
    if (settings.get('addressLookup') && !settings.get('googleKey')) parts.push('Geocoding: Nominatim');
    return parts.join(' · ');
  }

  debugText() {
    const player = this.player;
    const t = this.terrain.stats;
    return [
      `fps ${this.perf.fps.toFixed(0)}  frame ${this.perf.frameMs.toFixed(1)}ms  scale ${this.perf.scale.toFixed(2)}`,
      `draws ${this.renderer.info.render.calls}  tris ${(this.renderer.info.render.triangles / 1000).toFixed(0)}k`,
      `tiles drawn ${t.drawn}  nodes ${t.nodes}  z ${t.baseZoom}-${t.maxZoom}`,
      `imagery cache ${this.streamer.entries.size}  loading ${this.streamer.stats.pending}  failed ${this.streamer.stats.failed}`,
      `elevation tiles ${this.elevation.tiles.size}  buildings ${this.buildings.stats.buildings}`,
      `pos ${player.position.x.toFixed(1)}, ${player.position.y.toFixed(1)}, ${player.position.z.toFixed(1)}`,
      `geo ${player.lat.toFixed(5)}, ${player.lon.toFixed(5)}  ground ${player.groundHeight.toFixed(1)}m`,
      `mode ${player.mode}  vel ${player.velocity.length().toFixed(1)} m/s  land ${(this.landFraction * 100).toFixed(0)}%`,
    ].join('\n');
  }
}

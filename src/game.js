import * as THREE from '../vendor/three/three.module.js';
import { cheats } from './core/cheats.js';
import { clamp, damp } from './core/math.js';
import { PerfGovernor } from './core/perf.js';
import { Benchmark } from './core/benchmark.js';
import { settings } from './core/settings.js';
import { readJSON, writeJSON } from './core/storage.js';
import { formatDistance, formatLatLon } from './core/units.js';
import { InputManager } from './camera/input.js';
import { CameraRig } from './camera/cameraRig.js';
import { LocalFrame } from './geo/frame.js';
import { geocoder } from './geo/geocode.js';
import { haversine, latToNormY, lonToNormX } from './geo/mercator.js';
import { waterMap } from './geo/water.js';
import { weatherAt } from './geo/weather.js';
import { Autopilot } from './player/autopilot.js';
import { Avatar } from './player/avatar.js';
import { PlayerController } from './player/controller.js';
import { Player } from './player/player.js';
import { ElevationField } from './tiles/elevation.js';
import {
  IMAGERY_PROVIDERS,
  createElevationSource,
  createImagerySource,
  providerChain,
} from './tiles/providers.js';
import { ImageryStreamer } from './tiles/streamer.js';
import { createTileWorker } from './tiles/workerHost.js';
import { Buildings } from './world/buildings.js';
import { Panorama } from './world/panorama.js';
import { pickRandomDestination } from './world/rtp.js';
import { createSharedUniforms } from './world/shaders.js';
import { Scatter } from './world/scatter.js';
import { Sky } from './world/sky.js';
import { Terrain } from './world/terrain.js';
import { Weather } from './world/weather.js';
import { CheatPanel } from './ui/cheatPanel.js';
import { exploration } from './ui/exploration.js';
import { HelpCard } from './ui/help.js';
import { HUD } from './ui/hud.js';
import { mapTiles, streetTiles } from './ui/mapTiles.js';
import { Minimap } from './ui/minimap.js';
import { SettingsPanel } from './ui/settingsPanel.js';
import { TouchControls } from './ui/touch.js';
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
    this.benchmark = new Benchmark();
    /** Resolves on the next drawn frame, with its length in ms. */
    this.frameWaiters = [];
    this.settleUntil = 0;
    this._holdY = NaN;
    this.teleporting = false;
    this.debugVisible = false;
    this.landFraction = 0.6;
    this.saveTimer = 0;
    this.lastYaw = 0;
    this.notice = '';

    this.onStatus('Creating renderer');
    // Antialiasing is decided when the context is created and can never be
    // switched on afterwards, so it is always asked for. Tying it to the
    // graphics preset meant that booting on a slow machine — or letting the
    // automatic preset drop a tier and then reloading — left the world with
    // permanently stepped edges and no setting anywhere that would bring them
    // back. Multisampling is one of the cheapest things on this list; the
    // preset gives up tile detail and pixels instead.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      logarithmicDepthBuffer: true,
    });
    this.renderer.setClearColor(0x0d0f12, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xaebccd, 1 / 26000);
    // A near plane close enough to see your own legs when you look down.
    this.camera = new THREE.PerspectiveCamera(settings.get('fov'), 1, 0.15, 260000);
    this.scene.add(this.camera);

    this.onStatus('Starting tile worker');
    this.worker = createTileWorker();

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
    // Distant mode asks the explored map whether a far tile is worth drawing.
    // The terrain does not know about the UI, so it is handed the question.
    this.terrain.explored = (tile) => exploration.isExplored(tile.z, tile.x, tile.y);
    this.sky = new Sky(this.scene, this.shared);
    this.weather = new Weather(this.scene);
    this.scatter = new Scatter({ scene: this.scene, terrain: this.terrain, frame: this.frame });
    this.scatter.loadTextures();
    /** Real photogrammetry, loaded on demand — see loadWorld3D(). */
    this.tiles3d = null;
    this.buildings = new Buildings({ scene: this.scene, frame: this.frame, terrain: this.terrain });
    this.panorama = new Panorama({ scene: this.scene, frame: this.frame, worker: this.worker });

    this.player = new Player(this.frame);
    this.controller = new PlayerController({
      player: this.player,
      terrain: this.terrain,
      buildings: this.buildings,
    });
    this.avatar = new Avatar(this.scene);
    this.avatar.loadTextures();
    this.avatar.loadModel();
    // The held view model rides the camera, so it is hung off it rather than
    // off the scene root.
    this.avatar.attachTo(this.camera);
    this.rig = new CameraRig(this.camera);
    this.input = new InputManager(canvas);
    this.autopilot = new Autopilot({
      player: this.player,
      terrain: this.terrain,
      fireRocket: () => this.fireRocket(),
      onNotice: (message) => this.toast(message),
    });

    this.onStatus('Building interface');
    this.hud = new HUD(ui);
    this.minimap = new Minimap(ui, { tiles: mapTiles, streetTiles, exploration, waypointStore: waypoints, trail });
    this.worldmap = new WorldMap(ui, { tiles: mapTiles, streetTiles, exploration, waypointStore: waypoints, trail });
    this.settingsPanel = new SettingsPanel(ui);
    this.help = new HelpCard(ui);
    this.cheatPanel = new CheatPanel(ui);
    this.touch = new TouchControls(ui);
    this.input.attachTouch(this.touch);

    this.bindEvents();
    this.applyProviders();
    this.resize();
  }

  /* ---------------------------------------------------------------- setup */

  bindEvents() {
    this.input.on('action', ({ id, repeat }) => this.onAction(id, repeat));
    this.input.on('look', ({ dx, dy }) => this.rig.applyLook(this.player, dx, dy));
    this.input.on('boost', () => this.fireRocket());
    this.input.on('land', () => this.toggleWings());
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

    this.touch.onAction = (id) => {
      if (id === 'boost') this.fireRocket();
      else if (id === 'cheats') this.cheatPanel.toggle();
      else if (id === 'cheatsUnlocked') this.onCheatsUnlocked();
      else this.onAction(id);
    };
    this.touch.onLook = (dx, dy) => this.rig.applyLook(this.player, dx, dy);
    this.touch.watchForTouch();

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
    // Test the providers where you actually are. Asking about a fixed tile
    // somewhere in Europe would happily report USGS as broken while you stand
    // in Utah, and report it working while you stand in Rome.
    this.settingsPanel.onBenchmark = (onProgress) => {
      this.benchmark.onProgress = onProgress;
      return this.benchmark.run(this.perf, () => new Promise((resolve) => this.frameWaiters.push(resolve)));
    };
    this.settingsPanel.testTile = () => {
      const zoom = 14;
      const n = Math.pow(2, zoom);
      return {
        z: zoom,
        x: Math.floor(lonToNormX(this.player.lon) * n),
        y: Math.floor(clamp(latToNormY(this.player.lat), 0, 0.999999) * n),
      };
    };

    this.cheatPanel.onNotice = (message) => this.toast(message);
    this.cheatPanel.onTeleport = (lat, lon, label) => {
      this.autopilot.disengage();
      this.teleportTo(lat, lon, { reason: 'cheat', quiet: true });
      this.toast(`Teleported to ${label}`);
    };
    this.cheatPanel.onTravel = (lat, lon, label) => {
      this.cheatPanel.close();
      this.autopilot.engage(lat, lon, label);
    };
    this.cheatPanel.onStopTravel = () => this.autopilot.disengage('Auto-travel stopped');

    // The cheat code. Its own listener, in the capture phase so the letters of
    // the code never reach the game's own bindings on the way past.
    window.addEventListener('keydown', (event) => this.onCheatKey(event), true);
    cheats.on('change', () => this.onCheatChanged());

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

  /* ----------------------------------------------------------------- cheats */

  onCheatKey(event) {
    const target = event.target;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
    }
    const result = cheats.offerKey(event);
    if (!result) return;
    event.preventDefault();
    event.stopPropagation();
    if (result === 'unlock') this.onCheatsUnlocked();
    else if (result === 'panel') this.cheatPanel.toggle();
  }

  onCheatsUnlocked() {
    this.toast('Cheats unlocked — press ` for the panel', 'warn');
    this.cheatPanel.show();
  }

  /** A dial moved: some of them need the rest of the game told. */
  onCheatChanged() {
    // Lifting the fog changes what both maps should be drawing right now.
    this.minimap.timer = 1e6;
    this.worldmap.dirty = true;
    if (cheats.fly) {
      this.player.toggleElytra(false);
      this.player.onGround = false;
    }
    if (!cheats.unlocked) this.autopilot.disengage();
  }

  /**
   * @param {boolean} rebuild throw away the terrain meshes as well. Only an
   *   elevation change needs that; swapping imagery keeps the geometry and just
   *   re-resolves textures, which is the difference between a seamless swap and
   *   a second of blank ground you cannot move on.
   */
  applyProviders({ rebuild = true } = {}) {
    this.imagerySource = createImagerySource(settings.values);
    this.elevationSource = createElevationSource(settings.values);
    this.streamer.setSource(this.imagerySource);
    // Standbys for the ground itself, in the order asked for: providers you
    // hold a key for first, then the free ones, deepest first. A tile the
    // chosen provider will not serve moves down the list rather than leaving a
    // bare square — and there is nothing invented behind the list any more.
    this.streamer.setStandbys(
      providerChain(IMAGERY_PROVIDERS, settings.get('imageryProvider'), settings.values)
        .filter((p) => p.id !== this.imagerySource.descriptor.id)
        .slice(0, 3)
        .map((p) => createImagerySource({ ...settings.values, imageryProvider: p.id })),
    );
    this.elevation.setSource(this.elevationSource);
    mapTiles.setSource(this.imagerySource);
    // Whatever you chose to fly over, the flat maps fall back to the keyless
    // cloudless mosaic rather than to nothing.
    mapTiles.setFallback(
      this.imagerySource.descriptor.id === 'sentinel2'
        ? null
        : createImagerySource({ ...settings.values, imageryProvider: 'sentinel2' }),
    );
    mapTiles.setDegraded(false);
    // The unexplored-ground layer is always the drawn OSM map, whatever the
    // satellite provider is — it is a different question from which imagery
    // you fly over, and OSM needs no key.
    if (!this.streetSource) {
      this.streetSource = createImagerySource({ ...settings.values, imageryProvider: 'osm' });
      streetTiles.setSource(this.streetSource);
      // OSM's raster tiles come off one community server under a fair-use
      // policy, so "busy" is a normal answer and there are two standbys behind
      // it: Esri's street map, and then OpenFreeMap, which hands over the
      // geometry to draw ourselves and is the only one of the three that is
      // explicitly unmetered.
      streetTiles.setFallback([
        createImagerySource({ ...settings.values, imageryProvider: 'esri-street' }),
        createImagerySource({ ...settings.values, imageryProvider: 'openfreemap' }),
      ]);
    }
    waterMap.setSource(this.imagerySource);
    if (rebuild) this.terrain.rebase();
    this.imagerySource.prepare();
    this.elevationSource.prepare();
  }

  /**
   * Photorealistic 3D is a big optional dependency — the glTF and Draco
   * decoders — so it is fetched only when it is switched on and there is a key
   * to use it with. The single-file build has no module loader to fetch it
   * with, and says so instead of failing quietly.
   */
  async loadWorld3D() {
    if (this.tiles3d || this.loading3d) return this.tiles3d;
    if (settings.get('world3d') === 'off') return null;
    const cesium = settings.get('world3d') === 'cesium';
    if (!(cesium ? settings.get('cesiumToken') : settings.get('googleKey')).trim()) {
      this.notice3d = cesium
        ? 'Photorealistic 3D needs a Cesium ion access token'
        : 'Photorealistic 3D needs a Google Maps Platform key';
      return null;
    }
    this.loading3d = true;
    // We have a credential and we are about to use it; whatever the panel was
    // complaining about is answered, and the status line takes over from here.
    this.notice3d = '';
    try {
      // The single-file build has no module loader to resolve a specifier
      // with, so the bundler registers the on-demand modules and leaves a
      // resolver behind. It used to simply refuse here, which read as the
      // feature being make-believe rather than as a packaging limitation.
      const inline = globalThis.__TERRAGLIDE_REQUIRE__;
      const module = inline
        ? inline('src/world/tiles3d.js')
        : await import('./world/tiles3d.js');
      this.tiles3d = new module.Tiles3D({
        scene: this.scene,
        frame: this.frame,
        camera: this.camera,
        renderer: this.renderer,
      });
      await this.tiles3d.start();
      if (this.tiles3d.state === 'ready') this.toast('Photorealistic 3D connected');
      else this.toast(`Photorealistic 3D: ${this.tiles3d.error}`, 'bad');
    } catch (error) {
      this.notice3d = `Photorealistic 3D unavailable: ${error.message ?? error}`;
      this.toast(this.notice3d, 'bad');
    } finally {
      this.loading3d = false;
    }
    return this.tiles3d;
  }

  onSettingChanged(key) {
    const providerKeys = ['imageryProvider', 'elevationProvider', 'googleKey', 'mapboxKey', 'bingKey', 'azureKey'];
    if (providerKeys.includes(key)) {
      this.applyProviders({ rebuild: key === 'elevationProvider' });
      this.toast('Provider updated');
    }
    if (key === 'panoramaProvider' || key === 'mapillaryToken') this.panorama.clear();
    if (key === 'world3d' || key === 'googleKey' || key === 'cesiumToken') {
      if (settings.get('world3d') === 'off') {
        if (this.tiles3d) this.tiles3d.clear();
      } else if (this.tiles3d) {
        // Different provider or a new credential: drop the old account's
        // session and let the next frame reconnect.
        this.tiles3d.reconfigure();
        this.notice3d = '';
      } else {
        this.loadWorld3D();
      }
    }
    if (key === 'detailedPlayerModel') {
      this.avatar.loadModel().then(() => this.avatar.applyModelMode());
    }
    if (key === 'resolutionScale' || key === 'graphics') this.resize();
    // Choosing a preset by hand is a statement about what you want, so the
    // governor starts again from there rather than undoing it in a few
    // seconds and looking like the setting had not saved.

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
    if (saved && Number.isFinite(saved.lat)) {
      await this.teleportTo(saved.lat, saved.lon, { reason: 'spawn', quiet: true });
    } else {
      // First run: somewhere new, not the same Swiss valley for everybody
      // forever. The same search a random teleport uses, so it lands on
      // land, near something, and not in the middle of an ocean.
      await this.randomTeleport({ quiet: true });
    }

    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));

    if (this.help.firstRun) this.help.show();
  }

  /**
   * A stand-in camera parked where the player is, facing where they face.
   *
   * Used while the freecam is out, so the world keeps loading around the
   * person rather than around the roaming eye.
   */
  streamCamera(player) {
    const cam = this._streamCamera ?? (this._streamCamera = this.camera.clone());
    cam.fov = this.camera.fov;
    cam.aspect = this.camera.aspect;
    cam.near = this.camera.near;
    cam.far = this.camera.far;
    cam.position.set(player.position.x, player.position.y + player.eyeHeight, player.position.z);
    cam.rotation.set(player.pitch, -player.yaw, 0, 'YXZ');
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    return cam;
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
    // The minimap caps itself against the window, so it has to be told when
    // the window changes shape.
    this.minimap.onResize();
  }

  loop(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this.loop(t));

    // A second and a half, matching the fixed-step catch-up ceiling. A quarter
    // of a second here meant a machine drawing at three frames a second threw
    // three quarters of every second on the floor, and the whole world moved
    // in slow motion — which is what 'falling too slowly' actually was.
    const elapsed = clamp((now - this.lastTime) / 1000, 0, 1.5);
    this.lastTime = now;
    if (document.hidden) return;

    // The frame-rate governor wants real seconds; everything else runs on the
    // game clock, which the game-speed cheat is allowed to stretch.
    this.perf.update(elapsed);
    // Anything waiting on a real drawn frame — the benchmark, and nothing else
    // — is told how long this one took. Measuring the game is the only honest
    // way to measure the game.
    if (this.frameWaiters.length > 0) {
      const waiters = this.frameWaiters;
      this.frameWaiters = [];
      for (const resolve of waiters) resolve(elapsed * 1000);
    }
    // The governor only decides a scale — something has to act on it. Applied
    // in steps, and only when it has really moved, so it never oscillates a
    // few percent per frame and turns into the stutter it exists to prevent.
    if (Math.abs(this.perf.scale - (this.appliedScale ?? 1)) > 0.04) {
      this.appliedScale = this.perf.scale;
      this.resize();
    }
    // A menu pauses the world, the way it does in Minecraft. The frame is
    // still built and tiles still stream — you want the ground to have
    // finished arriving when you close the menu, not to start then — but the
    // clock that drives movement, timers and the burn on a firework stops, so
    // opening the settings mid-glide does not cost you the glide.
    this.update(this.paused ? 0 : elapsed * cheats.gameSpeed);
    this.renderer.render(this.scene, this.camera);
  }

  /* ------------------------------------------------------------------ tick */

  /**
   * Anything modal on screen means the world is stopped. Escape is the key
   * that gets you here and the key that gets you out, and while you are here
   * nothing moves, nothing burns down and nothing lands on you.
   */
  get paused() {
    return Boolean(
      this.settingsPanel.open || this.worldmap.open || this.help.open || this.cheatPanel.open,
    );
  }

  update(dt) {
    const player = this.player;
    const panelOpen = this.paused;
    if (panelOpen !== this.uiSuspended) {
      this.uiSuspended = panelOpen;
      this.input.setSuspended(panelOpen);
    }
    this.canvas.classList.toggle('pan', settings.get('mouseMode') === 'pan');

    let movement = this.input.movement();
    if (this.autopilot.active && !this.rig.isFreecam) {
      movement = this.autopilot.step(dt, movement);
    }

    if (this.rig.isFreecam) {
      const ground = this.terrain.heightAt(this.rig.freecam.position.x, this.rig.freecam.position.z);
      this.rig.updateFreecam(dt, movement, ground);
      player.tickTimers(dt);
      player.snapRender();
    } else if (this.settling && !this.wantsControl(movement)) {
      this.settle(dt);
      player.snapRender();
    } else {
      this.releaseSettle();
      this.controller.update(dt, movement);
    }

    // Keep the world numerically comfortable around the player. A rebase moves
    // the origin under you, so the drawn position has to come with it rather
    // than be interpolated across the jump.
    if (this.frame.needsRebase(player.position.x, player.position.z)) {
      this.rebase();
      player.snapRender();
    }
    player.syncGeo();

    this.rig.update(player, dt, this.terrain);

    // The shader shades unphotographed ground by slope, which means nothing
    // on a flat plate, so it needs to know whether any relief has arrived.
    this.shared.uHasRelief.value = this.elevation.hasRelief ? 1 : 0;

    const budget = this.perf.budgetMs();
    // Freecam looks around the world; it does not go and fetch more of it.
    // Streaming from the free camera meant flying it a hundred kilometres out
    // pulled a hundred kilometres of new tiles down behind it — which is the
    // opposite of what a look-around camera is for, and the reason it could
    // stall the game. The terrain keeps streaming around the player.
    this.terrain.update(this.rig.isFreecam ? this.streamCamera(player) : this.camera, budget);
    this.terrain.invalidateStale(this.camera.position.x, this.camera.position.z);

    const groundHeight = player.groundHeight;
    this.sky.setLandFraction(this.landFraction);
    this.sky.update(this.camera, player.lat, player.lon, groundHeight);
    this.scene.fog.color.copy(this.sky.horizonColor);
    this.scene.fog.density = this.shared.uFogDensity.value;
    this.renderer.setClearColor(this.sky.horizonColor, 1);

    // Weather for where and when you are, from the same climate model as the
    // temperature readout — no forecast service, no key.
    this.weatherState = weatherAt({
      lat: player.lat,
      lon: player.lon,
      date: this.sky.date,
      avgC: this.sky.climate ? this.sky.climate.avgC : 12,
      landFraction: this.landFraction,
    });
    this.weather.setState(this.weatherState);
    this.weather.update(this.camera, dt, this.sky);

    // Real photogrammetry first, where it is switched on and reaching Google.
    // Where its tiles are drawn, our own terrain, scenery and extruded
    // footprints step aside rather than fighting them for the same ground.
    if (settings.get('world3d') !== 'off' && !this.tiles3d) this.loadWorld3D();
    if (this.tiles3d) this.tiles3d.update(this.camera, player);
    // One photogrammetry tile arriving used to hide the entire terrain, which
    // on a slow connection meant the ground vanishing and coming back as
    // tiles trickled in and out of the frustum — ground that is invisible
    // because something better is *about* to cover it is still invisible
    // ground. It takes a few tiles held for a moment to hand over, and a
    // single frame with none of them to hand back.
    const drawn3d = this.tiles3d ? this.tiles3d.stats.drawn : 0;
    this.photorealFrames = drawn3d >= 3 ? (this.photorealFrames ?? 0) + 1 : 0;
    const photoreal = this.photorealFrames >= 3;
    this.terrain.group.visible = !photoreal;
    this.buildings.setVisible(!photoreal && settings.get('buildings'));

    // Trees, scrub and rock, in the places OpenStreetMap says they are. Where
    // it has nothing mapped, nothing is drawn.
    if (!photoreal) this.scatter.update(this.camera, player);
    else this.scatter.group.visible = false;

    // Nothing to extrude where Google is already handing us the real thing:
    // asking Overpass for footprints we are not going to draw is a request
    // against a shared community endpoint for nothing at all.
    if (!photoreal) this.buildings.update(player.lat, player.lon, player.altitudeAboveGround);

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

    // The body is drawn in first person too, minus the head, so you can see
    // your own legs and the wings you are flying on.
    // Second person is an outside view too: the body is drawn in full and the
    // camera is not behind your eyes, so it wants exactly the third-person
    // treatment — full head, no first-person offset.
    const outside =
      settings.get('perspective') !== 'first' || this.rig.isFreecam;
    const thirdPerson = outside;
    const showAvatar = thirdPerson || settings.get('showBody');
    this.avatar.setVisible(showAvatar);
    this.avatar.setFirstPerson(!thirdPerson);
    // Always update, even with the body switched off: the held view model
    // hangs off the camera rather than off the avatar root, and it is drawn in
    // first person whatever the body setting says — the same way every game
    // that has a first-person body still draws the thing in your hand.
    this.avatar.update(player, dt, this.camera);

    exploration.visit(player.lat, player.lon, player.altitudeAboveGround, this.seenRadius());
    exploration.tick(dt);
    trail.record(player.lat, player.lon);
    trail.tick(dt);

    this.address = geocoder.lookup(player.lat, player.lon)?.label ?? this.address;

    this.hud.update({
      player,
      climate: this.sky.climate,
      weather: this.weatherState,
      address: this.address,
      status: this.statusLine(),
      attribution: this.attributionLine(),
      freecam: this.rig.isFreecam,
      onWater: this.terrain.isWaterAt(player.position.x, player.position.z),
      landAway: this.landAway,
      cheats: cheats.active ? cheats.labels.join(' · ') : '',
      autopilot: this.autopilot.status(),
      debug: this.debugVisible ? this.debugText() : '',
    });

    this.cheatPanel.setStatus(this.autopilot.status());

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

  /**
   * How far you can actually see, in metres.
   *
   * The geometric horizon at your height — sqrt(2Rh) — capped by how far the
   * terrain is being drawn, because ground beyond the render distance is not
   * on the screen however high you are. This is what the explored map reveals,
   * so the map says you have seen what you have seen.
   */
  seenRadius() {
    const alt = Math.max(2, this.player.altitudeAboveGround);
    const horizon = Math.sqrt(2 * 6378137 * alt);
    return Math.max(240, Math.min(horizon, this.terrain.renderDistance));
  }

  get settling() {
    return performance.now() < this.settleUntil;
  }

  /** Has the player asked to do something? Then stop holding them still. */
  wantsControl(movement) {
    return !!(movement.forward || movement.back || movement.left || movement.right || movement.jump);
  }

  /**
   * End the arrival hold early.
   *
   * The hold exists to stop a teleport stuttering while the ground streams in.
   * It was ending only on its own clock, which meant two and a half seconds
   * after every arrival where the controls did nothing and every frame reset
   * your velocity to zero — you could not walk, and a rocket lit in that
   * window did nothing at all. Anything you press now ends it instead.
   */
  releaseSettle() {
    if (!this.settling) return;
    this.settleUntil = 0;
    // Hand over at exactly the height we were holding, so the release is not
    // a step either.
    if (Number.isFinite(this._holdY)) this.player.position.y = this._holdY;
    this._holdY = NaN;
    if (this.arrivalPending) this.finishArrival();
  }

  /**
   * Right after a teleport the elevation for the new place has not arrived, so
   * hold the player just above whatever the ground currently claims to be until
   * real data lands (or we give up waiting).
   */
  settle(dt) {
    const player = this.player;
    const ground = this.terrain.heightAt(player.position.x, player.position.z);
    player.groundHeight = ground;
    player.velocity.set(0, 0, 0);
    player.tickTimers(dt);

    // Where we want to be held. Note this is measured against ground that is
    // still arriving: every elevation tile that lands changes heightAt under
    // us, sometimes by hundreds of metres as a coarse LOD is replaced by a
    // finer one. Writing that straight into position.y snapped the camera on
    // every one of those, which is the jitter you get on an airborne teleport.
    if (this.holdInAir) {
      // An airborne arrival needs no tracking at all. You are four hundred
      // metres up: whether the ground below turns out to be sea level or an
      // alp does not move your eye by a pixel, so hold the height you were
      // put at and leave it alone. Easing toward `ground + 420` instead meant
      // every elevation tile that landed slid the whole world past you, which
      // is exactly the jitter an arrival had. The only thing worth reacting
      // to is ground arriving *above* you, and that is eased.
      if (!Number.isFinite(this._holdY)) this._holdY = player.position.y;
      const clearance = ground + SPAWN_HEIGHT_M * 0.1;
      if (this._holdY < clearance) this._holdY = damp(this._holdY, clearance, 6, dt);
    } else {
      const target = ground + 1.2;
      if (!Number.isFinite(this._holdY)) this._holdY = target;
      // On the ground the height *is* the ground, so it has to be tracked —
      // eased, so a late tile slides the world into place rather than jerking
      // it.
      this._holdY = damp(this._holdY, target, 6, dt);
    }
    player.position.y = this._holdY;
    player.onGround = !this.holdInAir;

    // Release once real elevation has landed, the tiles under you have been
    // built, and it has had a moment to settle.
    const waited = performance.now() - (this.settleUntil - SETTLE_MS);
    const norm = this.frame.worldToNorm(player.position.x, player.position.z);
    const ready = this.elevation.hasData(norm.nx, norm.ny) && this.terrain.stats.drawn > 6;
    if (waited > 650 && ready) this.releaseSettle();
  }

  /**
   * Once the ground is real, put the arrival where the settings asked for:
   * inside a building if there is one, and with street-level photography on if
   * the provider has any.
   */
  finishArrival() {
    this.arrivalPending = false;
    const player = this.player;

    // Arriving indoors and arriving with street-level photography on are both
    // simply what happens now. They were options, and an option nobody knew
    // to turn on is a feature nobody has.
    if (settings.get('buildings')) {
      const near = this.buildings.collidersNear(player.position.x, player.position.z, 90);
      const inside = near.find((collider) => collider.floors && collider.floors.length > 0);
      if (inside) {
        const centre = polygonCentre(inside.polygon);
        player.position.x = centre.x;
        player.position.z = centre.z;
        player.position.y = (inside.floors[0] ?? player.groundHeight) + 0.1;
        player.velocity.set(0, 0, 0);
        this.toast('Arrived indoors');
      }
    }

    if (settings.get('panoramaProvider') !== 'none') {
      settings.set('streetLevel', true);
    }
  }

  rebase() {
    const geo = this.player.syncGeo();
    const y = this.player.position.y;
    this.frame.setAnchor(geo.lat, geo.lon);
    this.player.position.set(0, y, 0);
    this.terrain.rebase();
    this.buildings.rebase();
    this.scatter.rebase();
    this.panorama.rebase();
    this.camera.position.set(0, y + this.player.eyeHeight, 0);
    if (this.rig.isFreecam) this.rig.freecam.position.set(0, y + 40, 0);
  }

  /* ------------------------------------------------------------- teleports */

  async teleportTo(lat, lon, { reason = 'manual', quiet = false } = {}) {
    this.teleporting = true;
    // Being somewhere else makes the old destination somebody else's problem.
    this.autopilot.disengage();
    const player = this.player;
    const previous = { lat: player.lat, lon: player.lon };

    this.frame.setAnchor(lat, lon);
    this.terrain.rebase();
    this.buildings.rebase();
    this.scatter.rebase();
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
    // teleport that dumps you in a field facing a hedge wastes the trip. Turn
    // "arrives in the sky" off in Settings → World to land on your feet instead.
    // Arrive doing what you were doing. With the setting on, a teleport called
    // while you are flying puts you back in the air and one called while you
    // are standing puts you back on your feet — the first load has no previous
    // state to match, so it takes the setting at its word.
    const wasFlying = !player.onGround || player.elytraDeployed;
    const airborne =
      settings.get('rtpSkySpawn') &&
      (reason === 'spawn' || ((reason === 'rtp' || reason === 'map') && wasFlying));
    player.teleport(lat, lon, ground, airborne ? SPAWN_HEIGHT_M : 1.2);
    // Arrive looking at the country rather than at your own boots. Teleporting
    // while you happened to be looking down dropped you four hundred metres up
    // staring into ground that had not streamed in yet, which reads as a
    // teleport into an empty void. Heading is yours; the pitch is levelled.
    player.pitch = clamp(player.pitch, -0.25, 0.25);
    if (airborne) {
      player.onGround = false;
      player.toggleElytra(true);
    }
    trail.break();
    this.camera.position.set(0, ground + player.eyeHeight, 0);
    // Hold still either way until the ground under you actually exists. Being
    // dropped into a hole while the tiles stream in is what made an arrival
    // feel like a stutter, and what left the ground invisible underfoot.
    this.holdInAir = airborne;
    this._holdY = NaN; // re-seeded on the first settle frame
    this.settleUntil = performance.now() + SETTLE_MS;
    this.arrivalPending = !airborne;
    this.address = 'Locating…';

    if (!quiet) {
      const distance = haversine(previous, { lat, lon });
      this.toast(`Travelled ${formatDistance(distance, settings.get('units'))} · ${formatLatLon(lat, lon, 4)}`);
    }

    this.savePosition();
    this.refreshLandFraction(lat, lon);
    this.teleporting = false;
  }

  async randomTeleport({ quiet = false } = {}) {
    if (this.rtpBusy) return;
    this.rtpBusy = true;
    if (!quiet) this.toast('Looking for somewhere to land…');
    try {
      const destination = await pickRandomDestination({ waterMap });
      await this.teleportTo(destination.lat, destination.lon, { reason: 'rtp', quiet: true });
      const where = formatLatLon(destination.lat, destination.lon, 4);
      if (quiet) {
        /* the first arrival of a session announces itself in the HUD already */
      } else if (!destination.onLand && !settings.get('exploreSeas')) {
        this.toast(`Dropped at ${where} — could not confirm dry land`, 'warn');
      } else if (destination.place) {
        this.toast(`Dropped near ${destination.place} · ${where}`);
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
      case 'rocket':
        this.fireRocket();
        break;
      case 'speedMode':
        // With unlimited speed mode on there is no timer to wait out, so the
        // key has to be able to switch it back off again.
        if (cheats.speedFree && player.speedActive) {
          player.stopSpeedMode();
          this.toast('Speed mode off');
        } else if (player.startSpeedMode()) this.toast('Speed mode — 2x');
        else if (player.speedCooldown > 0) {
          this.toast(`Speed mode recharging (${Math.ceil(player.speedCooldown)}s)`, 'warn');
        }
        break;
      case 'freecam': {
        const active = this.rig.toggleFreecam(player);
        this.toast(active ? 'Freecam on — wheel changes speed' : 'Freecam off');
        break;
      }
      case 'perspective': {
        const order = ['first', 'third', 'second'];
        const label = { first: 'First person', third: 'Third person', second: 'Second person' };
        const next = order[(order.indexOf(settings.get('perspective')) + 1) % order.length];
        settings.set('perspective', next);
        this.toast(label[next]);
        break;
      }
      case 'barrelRoll':
        if (this.rig.startBarrelRoll()) this.toast('Barrel roll');
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
        // Escape is the pause key: it closes whatever is open, and when
        // nothing is, it opens the settings — which is the pause menu, since
        // any menu stops the world. See `paused`.
        if (this.worldmap.open) this.worldmap.close();
        else if (this.help.open) this.help.close();
        else if (this.cheatPanel.open) this.cheatPanel.close();
        else this.settingsPanel.toggle();
        break;
      case 'wings':
        this.toggleWings();
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

  /**
   * Picking a hotbar slot chooses which rocket you fire next — and pressing the
   * number you are already on fires it, so a rocket is one key, not two.
   */
  useSlot(index) {
    if (index === this.player.selectedSlot) this.fireRocket();
    else this.player.selectSlot(index);
  }

  fireRocket() {
    const player = this.player;
    if (this.rig.isFreecam) return;
    // Lighting one is asking to move, so it ends the arrival hold too.
    this.releaseSettle();
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

  /**
   * Open the wings, or fold them away again.
   *
   * One key that always does the obvious thing, and the reason it exists is
   * timing. The double jump is Minecraft's gesture and it is the right default,
   * but it asks you to land a second press inside the half second you are off
   * the ground — and on a machine drawing at a handful of frames a second that
   * window can be shorter than the gap between two frames, so the press arrives
   * after you have already come back down and spends itself on another jump.
   * This key has no window at all: press it and the wings are out.
   *
   * Folding them in the air is the other half of it — you can drop out of a
   * glide deliberately rather than flying all the way down to something solid.
   */
  toggleWings() {
    const player = this.player;
    if (this.rig.isFreecam) return;
    this.releaseSettle();
    if (player.elytraDeployed) {
      player.toggleElytra(false);
      this.toast(player.onGround ? 'Wings stowed' : 'Wings stowed — falling');
      return;
    }
    if (player.onGround) {
      this.toast('Jump first — wings only open off the ground', 'warn');
      return;
    }
    player.toggleElytra(true);
    this.toast('Wings out');
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
    if (this.paused) parts.push('paused — Esc to carry on');
    const source = this.imagerySource;
    if (source) {
      const name = source.substitutedFor
        ? `${source.descriptor.label} (no key for ${source.substitutedFor.label})`
        : source.descriptor.label;
      if (source.state === 'needs-key') parts.push(`${name}: key required`);
      else if (source.state === 'error') parts.push(`${name}: ${source.error}`);
      else if (this.streamer.degraded) parts.push(`${name}: unreachable`);
      else parts.push(name);
      // What is on the ground right now, which is not the same question as
      // whether the provider is up: a tile past the provider's deepest zoom is
      // still that provider's photograph, stretched, and saying "unavailable"
      // about it was simply wrong.
      const relief = this.elevation.source;
      const reliefName = relief?.substitutedFor
        ? `${relief.descriptor.label} (no key for ${relief.substitutedFor.label})`
        : null;
      if (!this.elevation.hasRelief) {
        parts.push(reliefName ? `${reliefName}: loading` : 'elevation loading — flat for now');
      } else if (this.elevation.unreachable) {
        parts.push(
          reliefName ? `${reliefName}: unreachable` : 'elevation unreachable — flat ground',
        );
      } else if (reliefName) {
        parts.push(reliefName);
      }
      // Only worth saying when it actually bites. A provider that stops at 19
      // is not a fault, and announcing it every time you land was the "map
      // data not yet available" noise: the ground you are on *is* that
      // provider's photograph, stretched, which is a different thing from
      // having none.
      if (Number.isFinite(this.streamer.depthLimit) && this.streamer.depthLimit < 15) {
        parts.push(`this provider only has z${this.streamer.depthLimit} here`);
      }
      if (this.streamer.degraded) {
        parts.push('no provider answered — ground shaded from the relief');
      }
    }
    if (this.tiles3d) {
      const line = this.tiles3d.status();
      if (line) parts.push(line);
    } else if (this.notice3d) {
      parts.push(this.notice3d);
    }
    const scenery = this.scatter.status();
    if (scenery) parts.push(scenery);
    if (this.debugVisible) {
      const structures = this.buildings.status();
      if (structures) parts.push(structures);
    }
    // Only say something about street level when it is actually doing
    // something. Announcing "no coverage here" every time you walk about is
    // noise: most of the planet has no street-level photography, and the game
    // does not need it.
    const street = this.panorama.status;
    if (street === 'loading' || street === 'showing ground imagery') {
      parts.push(`street level: ${street === 'loading' ? 'loading' : 'on'}`);
    }
    if (settings.get('showFps')) parts.push(`${Math.round(this.perf.fps)} fps`);
    return parts.join(' · ');
  }

  attributionLine() {
    const parts = [];
    // Google requires the copyright that comes back with the 3D tiles to be
    // shown. It goes first, because when it is on it is what you are looking at.
    if (this.tiles3d?.attribution) parts.push(this.tiles3d.attribution);
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
      `elevation tiles ${this.elevation.tiles.size}  buildings ${this.buildings.stats.buildings}  scenery ${this.scatter.stats.placed} from ${this.scatter.stats.areas} areas / ${this.scatter.stats.points} trees`,
      this.tiles3d ? `3d tiles ${this.tiles3d.stats.drawn} drawn / ${this.tiles3d.stats.loaded} loaded / ${this.tiles3d.stats.failed} failed` : '3d tiles off',
      `pos ${player.position.x.toFixed(1)}, ${player.position.y.toFixed(1)}, ${player.position.z.toFixed(1)}`,
      `geo ${player.lat.toFixed(5)}, ${player.lon.toFixed(5)}  ground ${player.groundHeight.toFixed(1)}m`,
      `mode ${player.mode}  vel ${player.velocity.length().toFixed(1)} m/s  land ${(this.landFraction * 100).toFixed(0)}%`,
    ].join('\n');
  }
}

/** Centre of a building footprint, in world XZ. */
function polygonCentre(polygon) {
  let x = 0;
  let z = 0;
  for (const point of polygon) {
    x += point[0];
    z += point[1];
  }
  const n = Math.max(1, polygon.length);
  return { x: x / n, z: z / n };
}

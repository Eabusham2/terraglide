import * as THREE from '../../vendor/three/three.module.js';
import { GLTFLoader } from '../../vendor/three/loaders/GLTFLoader.js';
import { DRACOLoader } from '../../vendor/three/loaders/DRACOLoader.js';
import { DRACO_BASE } from '../core/paths.js';
import { settings } from '../core/settings.js';
import { boundingSphereOf, ecefToLocalMatrix, screenSpaceError } from '../geo/ecef.js';

/**
 * Real 3D map data: OGC 3D Tiles, as served by Google's Photorealistic 3D Tiles.
 *
 * This is the difference between a photograph draped on a hill and the actual
 * place. Those tiles are photogrammetry — built from oblique aerial passes, the
 * way you guessed — so the buildings, the trees and the bridges are *in the
 * mesh*. Nothing here is placed, invented, or filled in: if a tree is in the
 * tile, it is because somebody flew over it.
 *
 * Two ways in, because it is worth not depending on one account:
 *
 *   Google    tile.googleapis.com, on a Google Maps Platform key
 *   Cesium    the same photorealistic dataset through Cesium ion, on an ion
 *             access token — a different account and a different quota
 *
 * Microsoft is the obvious third and is not possible: Flight Simulator gets its
 * Bing imagery and photogrammetry through an internal agreement, Bing Maps has
 * never published a 3D tile API, and the platform is being retired into Azure
 * Maps, which does not serve photogrammetry either. Cesium ion is the nearest
 * real equivalent, and it is carrying the same scanned data.
 *
 * Without either credential the game falls back to what it already does — real
 * imagery, real elevation, real OpenStreetMap footprints and land cover, none
 * of which need an account — and with no network at all, to the generated
 * world. Three tiers, most real first.
 *
 * This module is loaded on demand and only when the option is on and a key is
 * present, so a player who never touches it never downloads the loaders, and
 * the single-file build leaves it out entirely.
 *
 * Attribution: Google requires the copyright string that comes back with the
 * tiles to be displayed. It is collected here and shown in the corner; removing
 * it breaks their terms and this project's licence.
 */

const GOOGLE_ROOT = 'https://tile.googleapis.com/v1/3dtiles/root.json';
/**
 * Cesium ion serves the same Google photorealistic tiles under asset 2275207,
 * on a Cesium token instead of a Google one. Worth having as a second door to
 * the same room: different account, different quota, same scanned world.
 */
const ION_ASSET = 2275207;
/**
 * Cesium ion assets worth flying, by id.
 *
 * All of these are real measurements of the real planet served as OGC 3D
 * Tiles, on the same ion token:
 *
 *   2275207  Google Photorealistic 3D Tiles — aerial photogrammetry, the
 *            buildings and the trees are in the mesh
 *   96188    Cesium OSM Buildings — every OpenStreetMap building on Earth,
 *            extruded from its recorded height. Not photogrammetry, so it is
 *            grey rather than photographed, but it is a real survey and it
 *            covers places the photogrammetry has never flown.
 *
 * Anything else in your own ion account works too; the number is the setting.
 */
export const ION_ASSETS = {
  photoreal: 2275207,
  'osm-buildings': 96188,
};
const ION_ENDPOINT = 'https://api.cesium.com/v1/assets';
/**
 * How hard to push the tile tree, by detail setting.
 *
 * `sse` is the screen-space error to refine down to — the smaller it is, the
 * deeper the tree is walked and the more triangles arrive. `loaded` caps how
 * much content is held at once, which is the memory ceiling. Photogrammetry is
 * heavy, and a machine that can fly the ordinary world happily will crawl
 * through a photorealistic city, so this is worth having a dial for rather
 * than one hard-coded compromise.
 */
const DETAIL = {
  low: { sse: 48, loaded: 90, active: 4, tilesets: 3 },
  medium: { sse: 32, loaded: 160, active: 6, tilesets: 4 },
  high: { sse: 24, loaded: 220, active: 6, tilesets: 4 },
  ultra: { sse: 16, loaded: 340, active: 8, tilesets: 6 },
};
/**
 * Why descending the tree has its own slots rather than sharing the content
 * ones.
 *
 * The tree is not a tree of tiles, it is a chain of tilesets: each level down
 * is a separate small JSON that has to arrive before the level under it can
 * even be considered. Sharing one pool meant the cheap thing that unlocks
 * depth queued behind the expensive thing that only refines width, so a few
 * hundred kilobytes of photogrammetry could hold up the four kilobytes that
 * says where the next storey of detail lives. That is backwards: you can draw
 * a coarse tile while waiting for a finer one, but you cannot draw a finer one
 * you have not been told about.
 */

/**
 * How long a content request may run before its slot is taken back.
 *
 * This is a safety net for a request that never settles, not a limit on how
 * long a tile may take. It has to be longer than a slow tile on a slow
 * connection or it will start cancelling work that was about to succeed.
 */
const CONTENT_TIMEOUT_MS = 30000;
/**
 * How long a tile that has left the view is kept before it may be evicted.
 *
 * Eviction used to be allowed the moment a tile was not wanted in one single
 * frame, which is the frame you turned your head in. Turning back found the
 * tile destroyed, so the coarse parent was drawn instead and the view went
 * blurry until the re-download landed — then sharp, then blurry again on the
 * next glance. That is the flicker, and it is a scheduling fault rather than
 * anything to do with detail settings.
 */
const KEEP_AFTER_SIGHT_MS = 15000;
/*
 * There was a rule here requiring photogrammetry to be at least as fine as the
 * ground it replaces before the terrain would step aside for it — ten metres of
 * geometric error, reasoned from a zoom-15 texel being about five.
 *
 * It is gone, because it was reasoned and not measured, and measuring it went
 * badly. In downtown San Francisco with the tileset settled it took the terrain
 * from 98 tiles drawn to 319 — three and a third times the ground work in the
 * one place the ground is least needed — and the rendered frame was identical,
 * pixel for pixel, with it and without it. A cost that size buys nothing here.
 *
 * The fault it was aimed at is real: one coarse ancestor's box can blank the
 * terrain over hundreds of cells while drawing them coarsely. But that happens
 * during loading, and the settled frame is all this measured, so the benefit
 * stayed unproven while the cost did not. If "the terrain goes flat" survives
 * the other three fixes, the thing to measure is the loading transient, and the
 * edge wall is the better suspect: it closes the world where the quadtree drew
 * nothing, and photogrammetry coverage is exactly a place the quadtree draws
 * nothing.
 */
/**
 * How many already-loaded tiles have their sampling changed per frame.
 *
 * Changing a texture's anisotropy means re-uploading it, and a city can easily
 * be three hundred textures. Doing all of them in the frame the setting changed
 * is a stall you would feel, so they go a few at a time and the view sharpens
 * over the next second instead of stopping for it.
 */
const RESHARPEN_PER_FRAME = 8;
/**
 * Putting the photogrammetry on the same vertical datum as the ground.
 *
 * These are two different surfaces measured against two different references
 * and nothing was reconciling them. 3D Tiles are ECEF, which is ellipsoidal by
 * definition. Terrarium, SRTM and Mapbox heights are orthometric — metres above
 * the geoid, which is the lumpy equipotential surface the sea would settle into.
 * The local frame is tangent to the ellipsoid, so the two get placed against
 * different surfaces and end up separated by the geoid height of wherever you
 * are standing.
 *
 * Measured, by raycasting the photogrammetry against the height field on a grid
 * and taking the median per city:
 *
 *   San Francisco   EGM96 -32.3    measured -32.8
 *   Denver          EGM96 -17.4    measured -17.9
 *
 * Two places whose geoid heights differ by fifteen metres, each matching its own
 * value to within half a metre. Worldwide the separation runs from about -107 m
 * to +85 m, so untreated this is tens of metres of error nearly everywhere and a
 * hundred in places.
 *
 * What that looked like: the city's streets sat below the sea-floor sheet, which
 * is drawn twelve metres under sea level, so the sheet covered them and you got
 * a flat pale plane where San Francisco should be. Standing on the height field
 * put you thirty metres above the photogrammetric street, which is inside the
 * ground floor of a building. Both went away when the tiles were lifted.
 *
 * It is measured rather than modelled. A geoid model would be a megabyte of
 * grid to carry and would still be a model; the two datasets the game is
 * actually drawing can be asked directly, and their difference is the truth for
 * this pair of providers — it absorbs anything else systematic between them as
 * well. The estimator has to be careful, because a ray fired down through a city
 * hits roofs, canopies and the occasional hole in a shell as well as the street.
 * So every hit from every ray goes into a histogram of its distance above the
 * height field, and the answer is the lowest dense cluster: the ground is the
 * one surface present in every column at the same offset, and it is below the
 * roofs. Measured in the City of London, every column had between seven and
 * twenty surfaces stacked in it and not one had a single hit — which is why
 * "the lowest hit" on its own is not good enough.
 */
const DATUM_INTERVAL_MS = 3000;
/** Below this there is not enough loaded to measure anything from. */
const DATUM_MIN_TILES = 12;
/** Rays per measurement, spread over a disc around the camera. */
const DATUM_SAMPLES = 24;
const DATUM_RADIUS_M = 220;
/**
 * How far above and below the height field to look. It has to clear the whole
 * geoid range in both directions plus anything tall standing on the ground.
 */
const DATUM_WINDOW_M = 420;
/** Histogram bin. Fine enough to be worth having, coarse enough to cluster. */
const DATUM_BIN_M = 2;
/** A cluster this dense relative to the densest counts as ground. */
const DATUM_CLUSTER_SHARE = 0.4;
/** Below this many samples in the winning cluster, say nothing. */
const DATUM_MIN_SAMPLES = 8;
/** Beyond this the answer is not a geoid separation and is not believed. */
const DATUM_LIMIT_M = 120;
const DEFAULT_DETAIL = 'high';
/**
 * How long a piece of content that refused is left alone before asking again.
 *
 * There was no memory of a refusal at all. The wanted list is rebuilt every
 * frame and every entry offered to `requestContent` again, and the only gates
 * were the concurrency budget and a fifty-millisecond in-flight flag — so a
 * tile the server would not serve was asked for sixteen times a second, and a
 * viewful of them ninety-four times a second. Measured, driving the real
 * request path with a loader that refuses. An expired session refuses every
 * tile at once, and both APIs this talks to bill per request, so that is the
 * player's money going out at a hundred requests a second with nothing on
 * screen to show for it.
 *
 * Eight seconds is short enough that a hiccup or a refreshed session comes
 * back almost at once, and long enough to turn a hundred requests a second
 * into rather fewer than one.
 */
const REFUSAL_REST_MS = 8000;
/**
 * How long to wait on the handshake before calling it dead. A request that
 * never answers is worse than one that fails: the status line would sit on
 * "connecting" forever and the player would have no idea anything was wrong.
 */
const CONNECT_TIMEOUT_MS = 15000;

/** A mesh's materials, however many it happens to have. */
function asMaterials(material) {
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

/** fetch that gives up rather than hanging. */
async function fetchWithin(url, options = {}, timeout = CONNECT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('timed out');
    // "failed to fetch" on its own is what this reported, and it is the least
    // useful thing a browser says: no status, no body, no origin. It is thrown
    // when the request never arrives at all, which happens for three quite
    // different reasons — nothing is reaching the network; the service would
    // not answer this page's origin, and a page opened from a file:// URL
    // sends `Origin: null`, which several metered APIs refuse before the
    // request is made; or an extension or proxy blocked it. None of those is
    // the token being wrong, which is what the bare message reads as.
    throw new Error(
      `could not be reached (${error?.message ?? error}) \u2014 the request never `
      + 'arrived rather than being refused, so the token is probably not what is wrong. '
      + 'Check the network, whether an extension is blocking it, and whether this page '
      + 'is on a file:// URL, which sends no origin. The online single file and the '
      + 'hosted page both have a real one.',
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The zoom the photogrammetry's footprint is recorded at.
 *
 * Sixteen is about six hundred metres at the equator — finer than the terrain
 * tiles that matter here, coarse enough that a city's worth of leaf tiles is a
 * few thousand keys rather than a few hundred thousand.
 */
const COVER_ZOOM = 16;

export class Tiles3D {
  constructor({ scene, frame, camera, renderer }) {
    this.scene = scene;
    this.frame = frame;
    this.camera = camera;
    this.renderer = renderer;
    // Which ion asset to fly. Photogrammetry by default; the setting can point
    // at OpenStreetMap's buildings instead, or at anything in your own account.
    this.ionAsset = ION_ASSETS[settings.get('world3dAsset')] ?? ION_ASSET;

    this.group = new THREE.Group();
    this.group.name = 'tiles3d';
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);

    this.loader = new GLTFLoader();
    const draco = new DRACOLoader();
    // Module-relative when served, and the published site when this is the
    // one-file build, which has no vendor folder next to it. See DRACO_BASE.
    draco.setDecoderPath(DRACO_BASE);
    this.loader.setDRACOLoader(draco);
    this.draco = draco;

    /** Loaded content keyed by tile URI. */
    this.loaded = new Map();
    /** Tileset JSON already fetched, keyed by URI. */
    this.tilesets = new Map();
    this.pending = new Set();
    /** What refused, and when — see REFUSAL_REST_MS. */
    this.refused = new Map();
    /** Content requests in flight. */
    this.active = 0;
    /** Tileset requests in flight — see the note on DETAIL.tilesets. */
    this.activeTilesets = 0;
    /** The anisotropy already applied to loaded tiles, so a preset change shows. */
    this._anisotropy = 0;
    /** Tiles still waiting for a changed sampler — see RESHARPEN_PER_FRAME. */
    this._resharpen = [];
    /**
     * Metres the tiles are lifted by to stand on the same ground the height
     * field describes. Zero until it has been measured; see the note above
     * DATUM_INTERVAL_MS.
     */
    this.datum = 0;
    this._datumAt = 0;
    this._ray = new THREE.Raycaster();
    this._rayFrom = new THREE.Vector3();
    this._down = new THREE.Vector3(0, -1, 0);
    /**
     * How to ask what the ground is here. The game wires this to the terrain,
     * the same way it wires the terrain's `covered3d` back to this object.
     */
    this.groundHeightAt = null;
    this.session = '';
    this.bearer = '';
    this.base = '';
    this.copyrights = new Set();
    this.state = 'idle';
    this.error = '';
    this.stats = { loaded: 0, pending: 0, drawn: 0, failed: 0 };
    /**
     * Which ground the photogrammetry is actually standing on, as mercator
     * tile keys at COVER_ZOOM.
     *
     * The terrain used to be hidden wholesale the moment three of these tiles
     * were drawn anywhere on screen — so flying over a city with coverage
     * removed the entire planet, horizon included, and put it back a second
     * later. Ground that is invisible because something better covers *some
     * other* part of the view is just missing ground. This is the map that
     * lets the quadtree step aside a tile at a time instead.
     */
    this.coverage = new Set();

    this._matrix = new THREE.Matrix4();
    this._forward = new THREE.Vector3();
    this._matrix2 = new THREE.Vector3();
    this._ecefToLocal = new THREE.Matrix4();
    /** Content wanted this frame but not yet loaded, in the order to fetch it. */
    this.wanted = [];
    this._anchorSerial = -1;
    /** Which provider and credential the current connection belongs to. */
    this._connectedAs = '';
  }

  get provider() {
    return settings.get('world3d');
  }

  get key() {
    return this.provider === 'cesium'
      ? settings.get('cesiumToken').trim()
      : settings.get('googleKey').trim();
  }

  /** The active detail tier's budgets. */
  get budget() {
    return DETAIL[settings.get('world3dDetail')] ?? DETAIL[DEFAULT_DETAIL];
  }

  get attribution() {
    const list = [...this.copyrights].slice(0, 3).join('; ');
    return list ? `3D: ${list}` : '';
  }

  /** Fetch the root tileset. Safe to call repeatedly. */
  async start() {
    if (this.state === 'loading' || this.state === 'ready') return;
    if (!this.key) {
      this.state = 'needs-key';
      this.error =
        this.provider === 'cesium'
          ? 'Cesium ion access token required for 3D tiles.'
          : 'Google Maps Platform key required for 3D tiles.';
      return;
    }
    this.state = 'loading';
    this._connectedAs = `${this.provider}:${this.key}`;
    try {
      let rootUrl = `${GOOGLE_ROOT}?key=${encodeURIComponent(this.key)}`;
      // Recorded for both providers: absolute() resolves children against it
      // and carries its query forward, so it cannot be set on one path only.
      this.base = rootUrl;

      if (this.provider === 'cesium') {
        // ion hands out a short-lived token and the real tileset URL; every
        // request after this one carries it as a bearer header.
        const endpoint = await fetchWithin(
          `${ION_ENDPOINT}/${this.ionAsset}/endpoint?access_token=${encodeURIComponent(this.key)}`,
        );
        if (!endpoint.ok) {
          throw new Error(
            endpoint.status === 401 || endpoint.status === 403
              ? 'Cesium ion rejected that token'
              : `ion ${endpoint.status}`,
          );
        }
        const grant = await endpoint.json();
        /*
          ion answers in two shapes and only one of them has a `url`.

          An asset ion hosts itself hands back `url` plus a short-lived
          `accessToken`, and every request after this carries that as a bearer.
          An *external* asset — Google's photorealistic tiles, which are the
          reason this route exists at all — hands back `externalType: '3DTILES'`
          and puts the real tileset under `options.url`, already carrying its
          own credential in the query string.

          Reading only `grant.url` there gives undefined, `fetch(undefined)`
          resolves against the page and 404s, and the player is told "root 404"
          with a token that is perfectly good. Every earlier test of this path
          used a stub that answered in the first shape, so the handshake was
          reported as working while the asset anybody would actually point it at
          could not load. It took a real token to see it.

          The bearer is deliberately not set for an external tileset: that
          credential is ion's, the server is Google's, and handing one service's
          token to another is at best ignored and at worst a refusal.
        */
        const external = grant.externalType ? grant.options?.url : null;
        rootUrl = external ?? grant.url;
        if (!rootUrl) throw new Error('ion gave no tileset URL');
        this.bearer = external ? '' : (grant.accessToken ?? '');
        this.base = rootUrl;
        for (const credit of grant.attributions ?? []) {
          if (credit.html) this.copyrights.add(stripTags(credit.html));
        }
        if (this.bearer) this.loader.setRequestHeader({ Authorization: `Bearer ${this.bearer}` });
      }

      const response = await fetchWithin(rootUrl, { headers: this.headers() });
      if (!response.ok) {
        throw new Error(
          response.status === 401 || response.status === 403
            ? 'that key was refused'
            : `root ${response.status}`,
        );
      }
      const tileset = await response.json();
      this.root = tileset.root;
      if (tileset.asset?.copyright) this.copyrights.add(tileset.asset.copyright);
      this.state = 'ready';
      this.error = '';
    } catch (error) {
      this.state = 'error';
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  /** Auth headers, if this provider uses them rather than a query parameter. */
  headers() {
    return this.bearer ? { Authorization: `Bearer ${this.bearer}` } : undefined;
  }

  /**
   * Google hands back a session token inside the child URIs. Every subsequent
   * request has to carry it along with the key, or it is refused. ion instead
   * signs with the bearer header, so its URIs resolve plainly.
   *
   * Which of those applies is decided by where the tiles actually live, not by
   * which provider was chosen in the settings — and that distinction is the
   * whole bug this replaced.
   *
   * Choosing 'cesium' took the ion branch unconditionally, so a Google tileset
   * reached *through* ion — which is what asset 2275207 is, and the thing
   * anybody turning this on actually wants — had its children resolved as bare
   * relative paths with no key and no session. Google refuses those: measured
   * against a real token, the root came back 200 and every one of the
   * twenty-four child requests came back 403, with no query string on any of
   * them. The tileset walk was reported as working because the stub it was
   * tested against did not care what the URL carried.
   *
   * The key for a Google tileset reached through ion is ion's own Google key,
   * which arrives inside the tileset URL rather than in any field, so it is
   * carried forward from the base rather than taken from `this.key` — that one
   * is the ion token and Google has never heard of it.
   */
  absolute(uri) {
    const base = this.base || 'https://assets.ion.cesium.com/';
    const url = new URL(uri, base);
    if (!/(^|\.)googleapis\.com$/.test(url.hostname)) return url.toString();
    if (!url.searchParams.has('key')) {
      const key = new URL(base).searchParams.get('key') || (this.provider === 'google' ? this.key : '');
      if (key) url.searchParams.set('key', key);
    }
    const session = url.searchParams.get('session');
    if (session) this.session = session;
    else if (this.session) url.searchParams.set('session', this.session);
    return url.toString();
  }

  /** Rebuild the ECEF→local matrix when the world re-anchors. */
  syncFrame() {
    if (this._anchorSerial === this.frame.anchorSerial) return;
    this._anchorSerial = this.frame.anchorSerial;
    this._ecefToLocal.fromArray(ecefToLocalMatrix(this.frame.anchorLat, this.frame.anchorLon, 0));
    // Everything already placed is now in the wrong place — including the
    // world-space boxes the coverage map is built from, and the datum, which
    // belonged to where you were: the geoid at the far end of a teleport is a
    // different number.
    this.clear();
    this.coverage.clear();
    this.datum = 0;
    this._datumAt = 0;
    this.group.position.y = 0;
    this.group.updateMatrix();
  }

  update(camera, player) {
    const on = settings.get('world3d') !== 'off';
    this.group.visible = on;
    if (!on) return;
    // Somebody swapped the provider or pasted a new credential. Nothing here
    // belongs to that account, so start over. Checked here rather than only on
    // the settings callback, so it holds however the value was changed.
    if (this._connectedAs && this._connectedAs !== `${this.provider}:${this.key}`) {
      this.reconfigure();
    }
    if (this.state === 'idle' || this.state === 'needs-key') {
      this.start();
      return;
    }
    if (this.state !== 'ready' || !this.root) return;

    this.syncFrame();

    // A quality change has to reach the city you are already standing in, or
    // turning the setting up appears to do nothing until you fly somewhere new.
    const sharpness = this.anisotropy;
    if (sharpness !== this._anisotropy) {
      this._anisotropy = sharpness;
      this._resharpen = [...this.loaded.values()];
    }
    for (let i = 0; i < RESHARPEN_PER_FRAME && this._resharpen.length; i++) {
      const entry = this._resharpen.pop();
      entry.object.traverse((node) => {
        if (node.isMesh) for (const m of asMaterials(node.material)) this.sharpen(m);
      });
    }

    // Where the camera is, in ECEF, so tiles can be measured against it.
    const inverse = this._matrix.copy(this._ecefToLocal).invert();
    const cameraEcef = new THREE.Vector3(camera.position.x, camera.position.y, camera.position.z)
      .applyMatrix4(inverse);

    const screenHeight = this.renderer ? this.renderer.domElement.height : 900;
    const fov = (camera.fov * Math.PI) / 180;

    this.visible = new Set();
    // Where the camera looks, flattened, in the local frame — so content can
    // be fetched in the order you are going to see it rather than in whatever
    // order the tree happens to be written in.
    camera.getWorldDirection(this._forward);
    const flat = Math.hypot(this._forward.x, this._forward.z) || 1;
    this._viewX = this._forward.x / flat;
    this._viewZ = this._forward.z / flat;
    this._camX = camera.position.x;
    this._camZ = camera.position.z;
    this.wanted = [];
    this.traverse(this.root, new THREE.Matrix4(), cameraEcef, screenHeight, fov, 0);

    // Nearest first, and ground you are facing before ground behind you.
    //
    // Content used to be requested as the walk reached it, so the six
    // concurrent slots went to whichever tiles the tree happened to list
    // first. That is why the city assembled in no particular order and why
    // what was in front of you could be the last thing to arrive.
    this.wanted.sort((a, b) => a.order - b.order);
    for (const item of this.wanted) {
      if (this.active >= this.budget.active) break;
      this.requestContent(item.uri, item.transform);
    }

    // Everything drawn this frame is in use now, whatever order it arrived in.
    // `used` was written once when a tile landed and then never read or
    // refreshed, so eviction walked the map in arrival order — and the ground
    // you had been standing on longest was the first thing destroyed.
    const now = performance.now();
    for (const [uri, entry] of this.loaded) {
      const seen = this.visible.has(uri);
      entry.object.visible = seen;
      if (seen) entry.used = now;
    }
    this.evict(now);

    this.measureDatum(now);
    this.buildCoverage();

    this.stats.loaded = this.loaded.size;
    this.stats.pending = this.active;
    this.stats.drawn = this.visible.size;
  }

  /**
   * Work out how far the photogrammetry has to move to stand on the same ground
   * the height field describes, and move it. See the note above
   * DATUM_INTERVAL_MS for why the two disagree at all.
   *
   * Every hit from every ray is counted, not just the lowest — a column in a
   * city has roofs and canopies above the street and sometimes a hole through
   * it, and the street is the surface that turns up in every column at the same
   * height. So: histogram the offsets, find the densest bins, take the lowest
   * one that is dense enough. Ground is below roofs, and roofs do not agree with
   * each other the way the ground does. Measured in the City of London, every
   * column had between seven and twenty surfaces stacked in it and not one had a
   * single hit, which is why "the lowest hit" on its own is not good enough.
   */
  measureDatum(now) {
    if (!this.groundHeightAt) return;
    if (this.loaded.size < DATUM_MIN_TILES) return;
    if (now - this._datumAt < DATUM_INTERVAL_MS) return;
    this._datumAt = now;

    this.group.updateMatrixWorld(true);
    const offsets = [];
    for (let i = 0; i < DATUM_SAMPLES; i++) {
      // A spiral rather than a ring, so the samples are spread over the disc
      // instead of all landing along one row of buildings.
      const angle = i * 2.399963;
      const radius = DATUM_RADIUS_M * Math.sqrt((i + 0.5) / DATUM_SAMPLES);
      const x = this._camX + Math.cos(angle) * radius;
      const z = this._camZ + Math.sin(angle) * radius;
      const field = this.groundHeightAt(x, z);
      if (!Number.isFinite(field)) continue;
      this._ray.set(this._rayFrom.set(x, field + DATUM_WINDOW_M, z), this._down);
      this._ray.far = DATUM_WINDOW_M * 2;
      for (const hit of this._ray.intersectObject(this.group, true)) {
        // Undo the lift already applied, so what is measured is the whole
        // disagreement rather than whatever is left of it.
        offsets.push(hit.point.y - this.group.position.y - field);
      }
    }
    if (offsets.length < DATUM_MIN_SAMPLES) return;

    const bins = new Map();
    for (const offset of offsets) {
      const bin = Math.round(offset / DATUM_BIN_M);
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }
    let densest = 0;
    for (const count of bins.values()) if (count > densest) densest = count;
    let ground = null;
    for (const [bin, count] of bins) {
      if (count < densest * DATUM_CLUSTER_SHARE) continue;
      if (ground === null || bin < ground) ground = bin;
    }
    if (ground === null) return;

    // The median of that cluster and its neighbours, so the answer is not
    // quantised to the bin width.
    const near = offsets.filter((o) => Math.abs(Math.round(o / DATUM_BIN_M) - ground) <= 1);
    if (near.length < DATUM_MIN_SAMPLES) return;
    near.sort((a, b) => a - b);
    const measured = near[Math.floor(near.length / 2)];
    if (!Number.isFinite(measured) || Math.abs(measured) > DATUM_LIMIT_M) return;

    // The tiles are low by `measured`, so they go up by it.
    const lift = -measured;
    if (Math.abs(lift - this.datum) < 0.5) return;
    this.datum = lift;
    this.group.position.y = lift;
    this.group.updateMatrix();
    // Cached world-space boxes belong to the height the tiles used to be at.
    for (const entry of this.loaded.values()) entry.bounds = null;
  }

  /**
   * Hold the memory ceiling, giving up what you looked at longest ago.
   *
   * A tile was evictable the moment it was not wanted in one single frame,
   * which is the frame you turned your head in — so a glance to the side
   * destroyed what was behind you, turning back drew the coarse parent while
   * the re-download ran, and the view went blurry, sharp, blurry again. The
   * grace period is what makes a look around free.
   *
   * The ceiling is still a ceiling: if everything spare is inside its grace
   * and we are over the cap, the grace yields — but it yields the tile you
   * last looked at longest ago, which is the one you are least likely to want
   * back.
   *
   * What is never given up is something on screen, so the real bound is the
   * larger of the cap and what the view is asking for — measured at High in a
   * city centre, 285 tiles drawn against a cap of 220, settling at exactly the
   * cap because tiles leave the visible set as their children replace them.
   * The view's own demand is bounded by the error threshold and the render
   * distance rather than by this, and that is the right way round: evicting
   * something you are looking at is how the flicker started.
   */
  evict(now) {
    const cap = this.budget.loaded;
    if (this.loaded.size <= cap) return;
    const spare = [];
    for (const [uri, entry] of this.loaded) {
      if (!this.visible.has(uri)) spare.push([uri, entry]);
    }
    spare.sort((a, b) => a[1].used - b[1].used);
    for (const [uri, entry] of spare) {
      if (this.loaded.size <= cap) return;
      if (now - entry.used < KEEP_AFTER_SIGHT_MS) break;
      this.dispose(uri, entry);
    }
    for (const [uri, entry] of spare) {
      if (this.loaded.size <= cap) return;
      if (this.loaded.has(uri)) this.dispose(uri, entry);
    }
  }

  /**
   * Work out which ground the drawn tiles are sitting on.
   *
   * A tile's world-space box is measured once when it lands and kept — the
   * meshes never move afterwards, and `setFromObject` walks the whole subtree,
   * which is not a per-frame cost worth paying a hundred times over.
   *
   * Only cells whose centre falls inside a box count. A tile's box is an axis
   * aligned hull around a mesh that does not fill it, so claiming every cell it
   * touches would hide terrain along every edge of the coverage and leave a
   * fringe of holes around the city.
   */
  buildCoverage() {
    this.coverage.clear();
    const n = Math.pow(2, COVER_ZOOM);
    for (const [uri, entry] of this.loaded) {
      if (!this.visible.has(uri)) continue;
      if (!entry.bounds) {
        entry.object.updateWorldMatrix(true, true);
        entry.bounds = new THREE.Box3().setFromObject(entry.object);
      }
      const box = entry.bounds;
      const a = this.frame.worldToNorm(box.min.x, box.min.z);
      const lowX = a.nx * n;
      const lowY = a.ny * n;
      const b = this.frame.worldToNorm(box.max.x, box.max.z);
      const x0 = Math.round(Math.min(lowX, b.nx * n) - 0.5);
      const x1 = Math.round(Math.max(lowX, b.nx * n) - 0.5);
      const y0 = Math.round(Math.min(lowY, b.ny * n) - 0.5);
      const y1 = Math.round(Math.max(lowY, b.ny * n) - 0.5);
      // A root tile's box can span a continent, and it tells us nothing about
      // what is actually loaded underneath it.
      if (x1 - x0 > 24 || y1 - y0 > 24) continue;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) this.coverage.add(`${COVER_ZOOM}/${x}/${y}`);
      }
    }
  }

  /** Is this patch of ground already drawn as photogrammetry? */
  covers(x, z) {
    if (!this.coverage.size) return false;
    const n = Math.pow(2, COVER_ZOOM);
    const norm = this.frame.worldToNorm(x, z);
    return this.coverage.has(`${COVER_ZOOM}/${Math.floor(norm.nx * n)}/${Math.floor(norm.ny * n)}`);
  }

  /**
   * Walk the tileset, refining while a tile would show too much error. Standard
   * 3D Tiles traversal: a tile's transform multiplies down the tree, `ADD`
   * refinement draws parent and child, `REPLACE` draws the child instead.
   *
   * Returns whether everything this subtree wants to draw is actually loaded.
   * That answer is the whole of the fix for 3D that vanishes and comes back: a
   * REPLACE parent used to stop being drawn the moment the error test said
   * "refine", which is long before any of its children have arrived. So the
   * ground under a city dropped out, stayed out for as long as the download
   * took, and came back the instant you moved far enough for the test to flip
   * the other way — flying towards a city made it blink. A parent is only let
   * go now once the tiles that replace it are really there.
   */
  traverse(tile, parentTransform, cameraEcef, screenHeight, fov, depth) {
    if (!tile || depth > 24) return true;

    const transform = tile.transform
      ? new THREE.Matrix4().fromArray(tile.transform).premultiply(parentTransform)
      : parentTransform.clone();

    const sphere = boundingSphereOf(tile.boundingVolume);
    if (!sphere) return true;

    const centre = new THREE.Vector3(sphere.x, sphere.y, sphere.z).applyMatrix4(transform);
    const distance = Math.max(1, centre.distanceTo(cameraEcef) - sphere.radius);

    // Beyond the render distance there is no point even considering it.
    const reach = settings.get('renderDistanceKm') * 1000;
    if (distance > reach) return true;

    const error = screenSpaceError(tile.geometricError ?? 0, distance, screenHeight, fov);
    const wantsChildren = error > this.budget.sse && Array.isArray(tile.children) && tile.children.length > 0;

    const uri = tile.content?.uri ?? tile.content?.url;
    const isTileset = uri && /\.json(\?|$)/i.test(uri);

    if (uri && isTileset) {
      // A child tileset: fetch it and splice it in where it belongs.
      const child = this.tilesets.get(uri);
      if (child) {
        if (child.asset?.copyright) this.copyrights.add(child.asset.copyright);
        return this.traverse(child.root, transform, cameraEcef, screenHeight, fov, depth + 1);
      }
      this.requestTileset(uri);
      return false;
    }

    if (wantsChildren) {
      let ready = true;
      for (const child of tile.children) {
        if (!this.traverse(child, transform, cameraEcef, screenHeight, fov, depth + 1)) ready = false;
      }
      // The children cover this tile and they are all here, so it can go.
      if (tile.refine !== 'ADD' && ready) return true;
      // Otherwise fall through and keep drawing this one as well — either
      // because ADD refinement says to, or because the replacement has not
      // arrived and coarse ground beats no ground.
    }

    if (!uri) return true;
    this.visible.add(uri);
    if (this.loaded.has(uri)) return true;
    this.want(uri, transform, centre);
    return false;
  }

  /**
   * Note that a piece of content is wanted, and how badly.
   *
   * Ordering is by distance from the camera with the ground you are facing
   * counted nearer than the ground behind you, so the city builds outwards
   * from under your feet in the direction you are going.
   */
  want(uri, transform, centreEcef) {
    if (this.pending.has(uri)) return;
    const local = this._matrix2.copy(centreEcef).applyMatrix4(this._ecefToLocal);
    const dx = local.x - this._camX;
    const dz = local.z - this._camZ;
    const len = Math.hypot(dx, dz);
    const facing = len < 1 ? 1 : (dx * this._viewX + dz * this._viewZ) / len;
    this.wanted.push({ uri, transform, order: len * (1.6 - facing * 0.6) });
  }

  requestTileset(uri) {
    const slots = this.budget.tilesets ?? this.budget.active;
    if (this.pending.has(uri) || this.resting(uri) || this.activeTilesets >= slots) return;
    this.pending.add(uri);
    this.activeTilesets++;
    fetch(this.absolute(uri), { headers: this.headers() })
      .then((response) => {
        if (!response.ok) throw new Error(`tileset ${response.status}`);
        return response.json();
      })
      .then((json) => {
        this.tilesets.set(uri, json);
        this.refused.delete(uri);
        if (json.asset?.copyright) this.copyrights.add(json.asset.copyright);
      })
      .catch(() => {
        this.stats.failed++;
        this.refused.set(uri, performance.now());
      })
      .finally(() => {
        this.pending.delete(uri);
        this.activeTilesets = Math.max(0, this.activeTilesets - 1);
      });
  }

  requestContent(uri, transform) {
    if (this.pending.has(uri) || this.resting(uri) || this.active >= this.budget.active) return;
    this.pending.add(uri);
    this.active++;

    /**
     * Release the slot when the request settles, and only then.
     *
     * It used to be released fifty milliseconds after the request *started*,
     * on the reasoning that the loader's callbacks are asynchronous and a slot
     * must not leak if one never fires. That does prevent the leak, and it also
     * removes the limit: four slots recycled every fifty milliseconds is eighty
     * requests a second with no ceiling on how many are in flight at once. The
     * `pending` mark went with it, so a tile still downloading no longer
     * counted as asked for and was asked for again on the very next frame, and
     * again on the one after that. The browser's handful of connections to the
     * host then filled with copies of tiles that were already arriving, and the
     * tiles you did not have yet queued behind them. That is the download that
     * takes for ever, and it gets worse the more of the city you can see.
     *
     * GLTFLoader calls exactly one of onLoad or onError, so settling on both is
     * the honest release. The timer stays as what it was meant to be — a net
     * under a request that never answers at all — at a length a real tile on a
     * real connection can finish inside.
     */
    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.pending.delete(uri);
      this.active = Math.max(0, this.active - 1);
    };
    const timer = setTimeout(release, CONTENT_TIMEOUT_MS);

    this.loader.load(
      this.absolute(uri),
      (gltf) => {
        const object = gltf.scene;
        // 3D Tiles content is Z-up in the tile's frame; glTF is Y-up. Undo that,
        // apply the tile's own transform, then bring ECEF into the local frame.
        object.matrixAutoUpdate = false;
        object.matrix
          .makeRotationX(Math.PI / 2)
          .premultiply(transform)
          .premultiply(this._ecefToLocal);
        object.matrixWorldNeedsUpdate = true;
        object.traverse((node) => {
          if (node.isMesh) {
            node.frustumCulled = true;
            // A mesh with several primitive groups carries an array here, which
            // dispose() has always known about and this did not: assigning
            // `side` to the array set a property on the array and sharpened
            // nothing at all.
            for (const material of asMaterials(node.material)) {
              material.side = THREE.FrontSide;
              this.sharpen(material);
            }
          }
        });
        this.group.add(object);
        this.loaded.set(uri, { object, used: performance.now() });
        this.refused.delete(uri);
        if (gltf.parser?.json?.asset?.copyright) {
          this.copyrights.add(gltf.parser.json.asset.copyright);
        }
        release();
      },
      undefined,
      () => {
        this.stats.failed++;
        this.refused.set(uri, performance.now());
        release();
      },
    );
  }

  /** How sharply textures may be sampled here: the preset, within the hardware. */
  get anisotropy() {
    const wanted = settings.preset().anisotropy ?? 1;
    const most = this.renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
    return Math.max(1, Math.min(wanted, most));
  }

  /**
   * Sample this material's textures the way the ground textures are sampled.
   *
   * Nothing set anisotropy on photogrammetry, so every one of these textures
   * was sampled at 1 while the flat imagery beside it used 8 or 16 and the
   * hardware offered 16. Measured, on a live tileset: eight textures loaded,
   * eight of them at anisotropy 1.
   *
   * At 1 the GPU picks its mip level from the *larger* of the two on-screen
   * derivatives, so a surface seen at a slant is sampled from a mip chosen for
   * its stretched axis — several levels coarser than the axis you are actually
   * reading. Standing in a street, almost every surface is at a slant: the road
   * underfoot, the pavement, every facade running away from you. That is why
   * the minimap looked sharper than the world it is a map of. The minimap is
   * drawn flat, face-on, at one texel per pixel, and never pays this at all.
   */
  sharpen(material) {
    const level = this.anisotropy;
    for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
      const texture = material[slot];
      if (!texture || texture.anisotropy === level) continue;
      texture.anisotropy = level;
      // Sampler state is set when the texture is uploaded, so a texture that
      // has already been to the GPU needs telling.
      texture.needsUpdate = true;
    }
  }

  /**
   * Is this one still sitting out its rest after a refusal?
   *
   * The wait is dropped as it expires, so the map holds only what has refused
   * recently rather than growing for the length of the session.
   */
  resting(uri) {
    const at = this.refused.get(uri);
    if (at === undefined) return false;
    if (performance.now() - at < REFUSAL_REST_MS) return true;
    this.refused.delete(uri);
    return false;
  }

  dispose(uri, entry) {
    this.group.remove(entry.object);
    entry.object.traverse((node) => {
      if (node.isMesh) {
        node.geometry?.dispose();
        const material = node.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      }
    });
    this.loaded.delete(uri);
  }

  clear() {
    for (const [uri, entry] of [...this.loaded]) this.dispose(uri, entry);
    this.loaded.clear();
  }

  /**
   * The provider or its credential changed under us. Everything cached belongs
   * to the old account — the session token, the bearer, the tiles themselves —
   * so it all goes, and the next frame connects again from scratch. Without
   * this a failed Google attempt would leave the state stuck at `error` and a
   * later Cesium token would never be tried.
   */
  reconfigure() {
    this.clear();
    this.tilesets.clear();
    // A new account may well be allowed what the old one was refused.
    this.refused.clear();
    this.copyrights.clear();
    this.root = null;
    this.session = '';
    this.bearer = '';
    this.base = '';
    this.error = '';
    this.state = 'idle';
    this.stats.failed = 0;
    this._connectedAs = '';
    this.loader.setRequestHeader({});
  }

  /** One line for the status readout. */
  status() {
    if (this.provider === 'off') return '';
    if (this.state === 'needs-key') {
      return this.provider === 'cesium'
        ? 'photorealistic 3D: Cesium token required'
        : 'photorealistic 3D: Google key required';
    }
    if (this.state === 'error') return `photorealistic 3D: ${this.error}`;
    if (this.state === 'loading') return 'photorealistic 3D: connecting';
    return `photorealistic 3D: ${this.stats.drawn} tiles`;
  }
}

/** Cesium's attributions arrive as HTML; the status line wants words. */
function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

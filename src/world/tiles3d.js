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
  low: { sse: 48, loaded: 90, active: 4 },
  medium: { sse: 32, loaded: 160, active: 6 },
  high: { sse: 24, loaded: 220, active: 6 },
  ultra: { sse: 16, loaded: 340, active: 8 },
};
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
    this.active = 0;
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
    // world-space boxes the coverage map is built from.
    this.clear();
    this.coverage.clear();
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

    // Anything not wanted this frame goes, oldest first.
    const maxLoaded = this.budget.loaded;
    if (this.loaded.size > maxLoaded) {
      for (const [uri, entry] of this.loaded) {
        if (this.loaded.size <= maxLoaded) break;
        if (this.visible.has(uri)) continue;
        this.dispose(uri, entry);
      }
    }
    for (const [uri, entry] of this.loaded) {
      entry.object.visible = this.visible.has(uri);
    }

    this.buildCoverage();

    this.stats.loaded = this.loaded.size;
    this.stats.pending = this.active;
    this.stats.drawn = this.visible.size;
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
    if (this.pending.has(uri) || this.resting(uri) || this.active >= this.budget.active) return;
    this.pending.add(uri);
    this.active++;
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
        this.active--;
      });
  }

  requestContent(uri, transform) {
    if (this.pending.has(uri) || this.resting(uri) || this.active >= this.budget.active) return;
    this.pending.add(uri);
    this.active++;

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
            if (node.material) node.material.side = THREE.FrontSide;
          }
        });
        this.group.add(object);
        this.loaded.set(uri, { object, used: performance.now() });
        this.refused.delete(uri);
        if (gltf.parser?.json?.asset?.copyright) {
          this.copyrights.add(gltf.parser.json.asset.copyright);
        }
      },
      undefined,
      () => {
        this.stats.failed++;
        this.refused.set(uri, performance.now());
      },
    );

    // GLTFLoader's callbacks fire asynchronously; free the slot either way.
    setTimeout(() => {
      if (this.pending.delete(uri)) this.active = Math.max(0, this.active - 1);
    }, 50);
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

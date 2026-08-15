import * as THREE from '../../vendor/three/three.module.js';
import { GLTFLoader } from '../../vendor/three/loaders/GLTFLoader.js';
import { DRACOLoader } from '../../vendor/three/loaders/DRACOLoader.js';
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
 * It needs a Google Maps Platform key, because Google does not serve it
 * otherwise. Without one the game falls back to what it already does — real
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

const ROOT_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json';
/** Refine while a tile would show more error than this many pixels. */
const MAX_SSE = 24;
/** How many tile requests may be in flight at once. */
const MAX_ACTIVE = 6;
/** Hard ceiling on loaded content, so a city cannot exhaust memory. */
const MAX_LOADED = 220;

export class Tiles3D {
  constructor({ scene, frame, camera, renderer }) {
    this.scene = scene;
    this.frame = frame;
    this.camera = camera;
    this.renderer = renderer;

    this.group = new THREE.Group();
    this.group.name = 'tiles3d';
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);

    this.loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('./vendor/draco/');
    this.loader.setDRACOLoader(draco);
    this.draco = draco;

    /** Loaded content keyed by tile URI. */
    this.loaded = new Map();
    /** Tileset JSON already fetched, keyed by URI. */
    this.tilesets = new Map();
    this.pending = new Set();
    this.active = 0;
    this.session = '';
    this.copyrights = new Set();
    this.state = 'idle';
    this.error = '';
    this.stats = { loaded: 0, pending: 0, drawn: 0, failed: 0 };

    this._matrix = new THREE.Matrix4();
    this._ecefToLocal = new THREE.Matrix4();
    this._anchorSerial = -1;
  }

  get key() {
    return settings.get('googleKey').trim();
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
      this.error = 'Google Maps Platform key required for 3D tiles.';
      return;
    }
    this.state = 'loading';
    try {
      const response = await fetch(`${ROOT_URL}?key=${encodeURIComponent(this.key)}`);
      if (!response.ok) throw new Error(`root ${response.status}`);
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

  /**
   * Google hands back a session token inside the child URIs. Every subsequent
   * request has to carry it along with the key, or it is refused.
   */
  absolute(uri) {
    const url = new URL(uri, 'https://tile.googleapis.com');
    if (!url.searchParams.has('key')) url.searchParams.set('key', this.key);
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
    // Everything already placed is now in the wrong place.
    this.clear();
  }

  update(camera, player) {
    const on = settings.get('world3d') !== 'off';
    this.group.visible = on;
    if (!on) return;
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
    this.traverse(this.root, new THREE.Matrix4(), cameraEcef, screenHeight, fov, 0);

    // Anything not wanted this frame goes, oldest first.
    if (this.loaded.size > MAX_LOADED) {
      for (const [uri, entry] of this.loaded) {
        if (this.loaded.size <= MAX_LOADED) break;
        if (this.visible.has(uri)) continue;
        this.dispose(uri, entry);
      }
    }
    for (const [uri, entry] of this.loaded) {
      entry.object.visible = this.visible.has(uri);
    }

    this.stats.loaded = this.loaded.size;
    this.stats.pending = this.active;
    this.stats.drawn = this.visible.size;
  }

  /**
   * Walk the tileset, refining while a tile would show too much error. Standard
   * 3D Tiles traversal: a tile's transform multiplies down the tree, `ADD`
   * refinement draws parent and child, `REPLACE` draws the child instead.
   */
  traverse(tile, parentTransform, cameraEcef, screenHeight, fov, depth) {
    if (!tile || depth > 24) return;

    const transform = tile.transform
      ? new THREE.Matrix4().fromArray(tile.transform).premultiply(parentTransform)
      : parentTransform.clone();

    const sphere = boundingSphereOf(tile.boundingVolume);
    if (!sphere) return;

    const centre = new THREE.Vector3(sphere.x, sphere.y, sphere.z).applyMatrix4(transform);
    const distance = Math.max(1, centre.distanceTo(cameraEcef) - sphere.radius);

    // Beyond the render distance there is no point even considering it.
    const reach = settings.get('renderDistanceKm') * 1000;
    if (distance > reach) return;

    const error = screenSpaceError(tile.geometricError ?? 0, distance, screenHeight, fov);
    const wantsChildren = error > MAX_SSE && Array.isArray(tile.children) && tile.children.length > 0;

    const uri = tile.content?.uri ?? tile.content?.url;
    const isTileset = uri && /\.json(\?|$)/i.test(uri);

    if (uri && isTileset) {
      // A child tileset: fetch it and splice it in where it belongs.
      const child = this.tilesets.get(uri);
      if (child) {
        this.traverse(child.root, transform, cameraEcef, screenHeight, fov, depth + 1);
        if (child.asset?.copyright) this.copyrights.add(child.asset.copyright);
      } else {
        this.requestTileset(uri);
      }
      return;
    }

    if (wantsChildren) {
      for (const child of tile.children) {
        this.traverse(child, transform, cameraEcef, screenHeight, fov, depth + 1);
      }
      if (tile.refine !== 'ADD') return;
    }

    if (!uri) return;
    this.visible.add(uri);
    if (!this.loaded.has(uri)) this.requestContent(uri, transform);
  }

  requestTileset(uri) {
    if (this.pending.has(uri) || this.active >= MAX_ACTIVE) return;
    this.pending.add(uri);
    this.active++;
    fetch(this.absolute(uri))
      .then((response) => {
        if (!response.ok) throw new Error(`tileset ${response.status}`);
        return response.json();
      })
      .then((json) => {
        this.tilesets.set(uri, json);
        if (json.asset?.copyright) this.copyrights.add(json.asset.copyright);
      })
      .catch(() => {
        this.stats.failed++;
      })
      .finally(() => {
        this.pending.delete(uri);
        this.active--;
      });
  }

  requestContent(uri, transform) {
    if (this.pending.has(uri) || this.active >= MAX_ACTIVE) return;
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
        if (gltf.parser?.json?.asset?.copyright) {
          this.copyrights.add(gltf.parser.json.asset.copyright);
        }
      },
      undefined,
      () => {
        this.stats.failed++;
      },
    );

    // GLTFLoader's callbacks fire asynchronously; free the slot either way.
    setTimeout(() => {
      if (this.pending.delete(uri)) this.active = Math.max(0, this.active - 1);
    }, 50);
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

  /** One line for the status readout. */
  status() {
    if (settings.get('world3d') === 'off') return '';
    if (this.state === 'needs-key') return 'photorealistic 3D: key required';
    if (this.state === 'error') return `photorealistic 3D: ${this.error}`;
    if (this.state === 'loading') return 'photorealistic 3D: connecting';
    return `photorealistic 3D: ${this.stats.drawn} tiles`;
  }
}

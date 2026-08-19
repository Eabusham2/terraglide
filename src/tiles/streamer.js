import * as THREE from '../../vendor/three/three.module.js';
import { Emitter } from '../core/events.js';
import { settings } from '../core/settings.js';
import { tileKey, wrapTileX } from '../geo/mercator.js';

/**
 * How many frames a tile stays safe from eviction after it was last drawn.
 * About four seconds at 60 fps — long enough to cover turning round.
 */
const KEEP_FRAMES = 240;

/**
 * Imagery streamer: a priority queue in front of the tile worker, plus an LRU
 * of GPU textures.
 *
 * Two things keep this smooth. Requests are re-prioritised every frame from
 * whatever the terrain actually wants *now* (so a fast flight cancels the tiles
 * it flew past instead of queueing behind them), and a tile that has not
 * arrived yet borrows its parent's texture with a UV window, so there is never
 * a blank hole in the ground.
 */

const STATE_PENDING = 1;
const STATE_READY = 2;
const STATE_FAILED = 3;

export class ImageryStreamer extends Emitter {
  constructor(worker, renderer) {
    super();
    this.worker = worker;
    this.renderer = renderer;
    this.source = null;
    this.entries = new Map();
    this.queue = [];
    this.active = 0;
    this.nextId = 1;
    this.jobs = new Map();
    this.frame = 0;
    this.stats = { loaded: 0, pending: 0, failed: 0, bytes: 0 };
    this.tileSizeHint = 256;
    this.consecutiveFailures = 0;
    /** Set when a provider is unreachable; tiles are generated locally instead. */
    this.degraded = false;

    this.worker.addEventListener('message', (event) => this.onWorkerMessage(event.data));
  }

  setSource(source) {
    this.source = source;
    this.clear();
  }

  clear() {
    for (const entry of this.entries.values()) {
      if (entry.texture) entry.texture.dispose();
    }
    this.entries.clear();
    for (const id of this.jobs.keys()) {
      this.worker.postMessage({ kind: 'cancel', channel: 'imagery', id });
    }
    this.jobs.clear();
    this.queue.length = 0;
    this.active = 0;
    this.stats.loaded = 0;
    this.stats.failed = 0;
    this.consecutiveFailures = 0;
    this.degraded = false;
  }

  beginFrame() {
    this.frame++;
    // Requests are collected fresh each frame; stale ones simply never re-queue.
    this.queue.length = 0;
  }

  /**
   * Ask for a tile. Returns the entry (possibly pending). `priority` is a
   * screen-space cost — smaller loads first.
   */
  request(tile, priority) {
    const key = tileKey(tile.z, tile.x, tile.y);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, tile, state: 0, texture: null, used: this.frame, priority };
      this.entries.set(key, entry);
    }
    entry.used = this.frame;
    entry.priority = priority;
    if (entry.state === 0 || (entry.state === STATE_FAILED && entry.retryAt < performance.now())) {
      this.queue.push(entry);
    }
    return entry;
  }

  /** Mark a tile as still in use without requesting a load. */
  touch(tile) {
    const entry = this.entries.get(tileKey(tile.z, tile.x, tile.y));
    if (entry) entry.used = this.frame;
    return entry;
  }

  /**
   * Best available texture for a tile: itself, or the nearest loaded ancestor
   * with the UV window that shows the right quarter/sixteenth of it.
   */
  resolve(tile, maxSteps = 6) {
    let z = tile.z;
    let x = tile.x;
    let y = tile.y;
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;

    for (let step = 0; step <= maxSteps && z >= 0; step++) {
      const entry = this.entries.get(tileKey(z, x, y));
      if (entry && entry.state === STATE_READY && entry.texture) {
        entry.used = this.frame;
        return { texture: entry.texture, scale, offsetX, offsetY, exact: step === 0 };
      }
      // Walk to the parent; track which quadrant we came from.
      const childX = x & 1;
      const childY = y & 1;
      offsetX = (offsetX + childX) * 0.5;
      offsetY = (offsetY + childY) * 0.5;
      scale *= 0.5;
      x >>= 1;
      y >>= 1;
      z -= 1;
    }
    return null;
  }

  pump() {
    if (!this.source) return;
    const limit = settings.preset().maxConcurrentRequests;
    if (this.active >= limit || this.queue.length === 0) return;

    this.queue.sort((a, b) => a.priority - b.priority);
    while (this.active < limit && this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry || entry.state === STATE_PENDING || entry.state === STATE_READY) continue;
      this.dispatch(entry);
    }
  }

  dispatch(entry) {
    const source = this.source;
    if (!source) return;
    if (!source.ready) {
      source.prepare();
      if (!source.synthetic) return;
    }
    const tile = { z: entry.tile.z, x: wrapTileX(entry.tile.x, entry.tile.z), y: entry.tile.y };
    const url = this.degraded ? null : source.urlFor(tile);
    if (url === null && !source.synthetic && !this.degraded) return;

    const id = this.nextId++;
    entry.state = STATE_PENDING;
    entry.jobId = id;
    this.jobs.set(id, entry);
    this.active++;
    this.stats.pending = this.active;
    this.worker.postMessage({ kind: 'imagery', channel: 'imagery', id, tile, url, size: 128 });
  }

  onWorkerMessage(msg) {
    if (!msg || msg.channel !== 'imagery' || msg.id === undefined) return;
    const entry = this.jobs.get(msg.id);
    if (!entry) {
      if (msg.bitmap) msg.bitmap.close();
      return;
    }
    this.jobs.delete(msg.id);
    this.active = Math.max(0, this.active - 1);
    this.stats.pending = this.active;

    if (!msg.ok) {
      entry.state = STATE_FAILED;
      entry.retryAt = performance.now() + (msg.aborted ? 0 : 20000);
      this.stats.failed++;
      if (!msg.aborted) {
        this.consecutiveFailures++;
        // A provider that will not answer at all (offline, blocked host, bad
        // key) should not leave the world as blank ground. Generate tiles
        // locally instead and say so in the status line.
        if (!this.degraded && this.consecutiveFailures >= 10 && this.stats.loaded === 0) {
          this.degraded = true;
          this.emit('degraded', { error: msg.error });
        }
      }
      this.emit('error', { key: entry.key, error: msg.error });
      return;
    }
    this.consecutiveFailures = 0;
    if (!msg.bitmap) return;

    const texture = new THREE.Texture(msg.bitmap);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.min(
      settings.preset().anisotropy,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    texture.needsUpdate = true;

    entry.texture = texture;
    entry.state = STATE_READY;
    this.tileSizeHint = msg.bitmap.width || this.tileSizeHint;
    this.stats.loaded++;
    this.emit('tile', entry);
  }

  /**
   * Drop textures that have not been asked for in a while.
   *
   * "A while" used to mean one frame: anything not drawn *this* frame was fair
   * game. Turn around, or let a ridge occlude a valley for a moment, and the
   * tiles behind you were gone and had to come down the wire again. Holding
   * them for a few seconds costs nothing but the cache slot and means staying
   * within range of somewhere keeps it loaded, which is the point.
   */
  evict() {
    const limit = settings.preset().textureCacheSize;
    if (this.entries.size <= limit) return;
    const sorted = [...this.entries.values()].sort((a, b) => a.used - b.used);
    let excess = this.entries.size - limit;
    for (const entry of sorted) {
      if (excess <= 0) break;
      if (entry.used >= this.frame - KEEP_FRAMES || entry.state === STATE_PENDING) continue;
      if (entry.texture) entry.texture.dispose();
      this.entries.delete(entry.key);
      excess--;
    }
  }
}

export { STATE_PENDING, STATE_READY, STATE_FAILED };

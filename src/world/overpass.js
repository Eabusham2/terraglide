/**
 * One queue for every OpenStreetMap query the game makes.
 *
 * Overpass is a free community service running on donated hardware. Two systems
 * asking it for things independently is how you get rate limited and deserve to
 * be, so buildings and scenery share this: one request in flight at a time, a
 * gap between them, endpoints rotated on failure, and a long backoff when a
 * server says it is busy. If it will not answer, callers draw nothing — none of
 * them invent data to fill the gap.
 */

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
/** Minimum spacing between requests, milliseconds. */
const MIN_GAP_MS = 2400;
/** How long to leave it alone after a refusal. */
const BACKOFF_MS = 45000;

class OverpassClient {
  constructor() {
    this.queue = [];
    this.busy = false;
    this.lastAt = -Infinity;
    this.backoffUntil = 0;
    this.endpointIndex = 0;
    this.stats = { ok: 0, failed: 0, queued: 0 };
  }

  /** True while the service has told us to go away. */
  get resting() {
    return performance.now() < this.backoffUntil;
  }

  get inflight() {
    return this.busy;
  }

  /**
   * Run an Overpass QL query. Resolves with the parsed JSON, rejects if the
   * service is unavailable — callers are expected to cope with nothing.
   */
  query(text) {
    if (this.resting) return Promise.reject(new Error('overpass resting'));
    return new Promise((resolve, reject) => {
      this.queue.push({ text, resolve, reject });
      this.stats.queued = this.queue.length;
      this.pump();
    });
  }

  async pump() {
    if (this.busy || this.queue.length === 0) return;
    const wait = MIN_GAP_MS - (performance.now() - this.lastAt);
    if (wait > 0) {
      setTimeout(() => this.pump(), wait);
      return;
    }

    const job = this.queue.shift();
    this.stats.queued = this.queue.length;
    this.busy = true;
    this.lastAt = performance.now();

    try {
      const endpoint = ENDPOINTS[this.endpointIndex % ENDPOINTS.length];
      const response = await fetch(endpoint, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(job.text),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (response.status === 429 || response.status === 504) {
        this.endpointIndex++;
        throw new Error(`overpass busy (${response.status})`);
      }
      if (!response.ok) throw new Error(`overpass ${response.status}`);
      const data = await response.json();
      this.stats.ok++;
      job.resolve(data);
    } catch (error) {
      this.stats.failed++;
      this.backoffUntil = performance.now() + BACKOFF_MS;
      job.reject(error);
      // Anything still waiting is not going to fare better right now.
      for (const pending of this.queue.splice(0)) {
        pending.reject(new Error('overpass resting'));
      }
      this.stats.queued = 0;
    } finally {
      this.busy = false;
      if (this.queue.length > 0) setTimeout(() => this.pump(), MIN_GAP_MS);
    }
  }
}

export const overpass = new OverpassClient();

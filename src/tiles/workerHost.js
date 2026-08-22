import { cancelJob, runJob } from './tileJobs.js';

/**
 * Gets you a tile worker, whatever the browser will allow.
 *
 * Normally that is a real Web Worker. But a page opened straight off the file
 * system cannot start one — and the single-file build is meant to be
 * double-clicked — so this falls back to an object with the same
 * postMessage/addEventListener surface that runs the jobs on the main thread,
 * one at a time, yielding between them so the frame still gets drawn.
 */

export function createTileWorker() {
  if (!globalThis.__TERRAGLIDE_INLINE_WORKER__ && typeof Worker === 'function') {
    try {
      const url = new URL('./tileWorker.js', import.meta.url);
      if (url.protocol !== 'file:') {
        const worker = new Worker(workerUrl(url), { type: 'module' });
        worker.inline = false;
        return worker;
      }
    } catch {
      /* fall through to the in-page host */
    }
  }
  return new InlineWorker();
}

/**
 * A worker script has to be same-origin, which the online single-file page is
 * not: that page is one small file that could be sitting anywhere while the
 * modules come off the published site. Handing `new Worker` a cross-origin URL
 * is a SecurityError, and it would drop the whole tile pipeline onto the main
 * thread.
 *
 * The way round it is a same-origin blob whose only job is to import the real
 * thing. A module worker can do that, and the imported module's own relative
 * imports resolve against *its* address rather than the blob's, so the rest of
 * the worker loads normally. Needs the host to allow cross-origin reads, which
 * GitHub Pages does.
 */
function workerUrl(url) {
  if (url.origin === globalThis.location?.origin) return url;
  const shim = `import ${JSON.stringify(url.href)};`;
  return URL.createObjectURL(new Blob([shim], { type: 'text/javascript' }));
}

/** Same protocol as the worker, run in the page. */
class InlineWorker {
  constructor() {
    this.inline = true;
    this.listeners = new Set();
    this.queue = [];
    this.running = false;
  }

  addEventListener(type, fn) {
    if (type === 'message') this.listeners.add(fn);
  }

  removeEventListener(type, fn) {
    if (type === 'message') this.listeners.delete(fn);
  }

  postMessage(msg) {
    if (!msg) return;
    if (msg.kind === 'cancel') {
      cancelJob(`${msg.channel}:${msg.id}`);
      this.queue = this.queue.filter((job) => !(job.channel === msg.channel && job.id === msg.id));
      return;
    }
    this.queue.push(msg);
    this.pump();
  }

  deliver(response) {
    const event = { data: response };
    for (const fn of this.listeners) fn(event);
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      try {
        await runJob(job, (response) => this.deliver(response));
      } catch (err) {
        this.deliver({
          ok: false,
          channel: job.channel,
          id: job.id,
          error: String(err && err.message ? err.message : err),
        });
      }
      // Hand the frame back before starting the next one.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    this.running = false;
  }

  terminate() {
    this.queue.length = 0;
    this.listeners.clear();
  }
}

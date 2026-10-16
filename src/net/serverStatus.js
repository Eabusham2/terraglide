import { Emitter } from '../core/events.js';

/**
 * Is a server up, and how quick is it from here?
 *
 * Asked of its /api/status (server/server.mjs), which every TerraGlide server
 * answers over plain HTTP to any page, uncached, with nobody signed in - so the
 * startup screen can say whether the main lobby is there, how many are on it
 * and how far away it is before anybody chooses it, without opening a game
 * connection to find out.
 *
 * Asked every couple of seconds while something is listening. Events:
 * 'change', with the probe itself.
 */

/** wss://host/ws -> https://host/api/status, and the same beside any path the socket sits under. */
export function statusUrl(server) {
  try {
    const url = new URL(server);
    if (url.protocol === 'wss:') url.protocol = 'https:';
    else if (url.protocol === 'ws:') url.protocol = 'http:';
    else return null;
    url.pathname = `${url.pathname.replace(/\/ws\/?$/, '/').replace(/\/?$/, '/')}api/status`;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** Only what the screen shows, in the shape it expects: it is another machine's reply. */
function cleanStatus(body) {
  const count = (value) => Math.max(0, Math.floor(Number(value) || 0));
  return {
    name: typeof body.name === 'string' ? body.name.slice(0, 80) : '',
    online: count(body.online),
    max: count(body.max),
  };
}

export class ServerProbe extends Emitter {
  /**
   * @param {string} server its socket address, as boot.js keeps it
   * @param {{every?: number, timeout?: number}} [options] milliseconds
   */
  constructor(server, { every = 2000, timeout = 4000 } = {}) {
    super();
    this.url = statusUrl(server);
    this.every = every;
    this.timeout = timeout;
    /** 'checking' until the first answer, then 'up' or 'down'. */
    this.state = 'checking';
    this.ping = null;
    this.info = null;
    this.samples = [];
    this.failures = 0;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.probe();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.abort?.abort();
  }

  async probe() {
    if (!this.running) return;
    if (!this.url) {
      this.settle(false, null, 0);
      return;
    }
    const stop = new AbortController();
    this.abort = stop;
    const giveUp = setTimeout(() => stop.abort(), this.timeout);
    const started = performance.now();
    let info = null;
    try {
      const reply = await fetch(this.url, { cache: 'no-store', signal: stop.signal });
      const body = reply.ok ? await reply.json() : null;
      if (body && body.terraglide === true) info = cleanStatus(body);
    } catch {
      info = null;
    }
    clearTimeout(giveUp);
    if (!this.running) return;
    this.settle(!!info, info, performance.now() - started);
  }

  settle(ok, info, ms) {
    let next = this.every;
    if (ok) {
      const first = this.samples.length === 0;
      this.samples.push(ms);
      if (this.samples.length > 3) this.samples.shift();
      // The best of the last three: the first answer carries setting the
      // connection up - a TLS handshake is several round trips of its own -
      // and one slow reply is a hiccup, not the distance to the server.
      this.ping = Math.min(...this.samples);
      this.info = info;
      this.failures = 0;
      this.state = 'up';
      // So the second, honest figure is not two seconds away.
      if (first) next = 250;
    } else {
      this.failures += 1;
      // Once up, one lost answer is not the server gone: two in a row are.
      if (this.state !== 'up' || this.failures >= 2) {
        this.state = 'down';
        this.ping = null;
        this.samples = [];
      }
    }
    this.emit('change', this);
    if (this.running) this.timer = setTimeout(() => this.probe(), next);
  }
}

/**
 * Which game this page is, decided once, before anything else reads a save.
 *
 * Two questions, and both are answered by the time the first module that
 * stores anything has run:
 *
 *   mode   'local'  — the game as it has always been: everything you explore,
 *                     every waypoint and every trail kept in this browser,
 *                     cheats available behind their code.
 *          'online' — playing on a server. The server holds your position,
 *                     what you have explored, your trail and your health, and
 *                     nothing it holds is written into the local save — or read
 *                     back out of it. The two never mix, in either direction.
 *   world  'earth', 'moon', 'mars'... — which body you are standing on. The
 *          geodesy, the gravity, the sky and the map providers all follow it.
 *
 * Both are fixed for the life of the page and changing either is a reload,
 * deliberately. A great deal of this game decides things at load time — the
 * radius of the world is baked into the local frame, the tile pyramid and the
 * shaders; every store reads its save when it is constructed — and the
 * single-file build publishes a module's exports once, as a snapshot, so a
 * value changed afterwards never reaches the modules that imported it. A
 * reload is the one switch that is guaranteed to reach everything. Travelling
 * to the Moon takes a second and a half of boot screen, which is shorter than
 * any rocket launch.
 *
 * How it is chosen, strongest first:
 *
 *   1. the address: ?server=wss://host joins that server (an invite link),
 *      ?world=moon picks the world, ?local goes back to playing alone.
 *      These are folded into the saved choice and then taken off the address,
 *      so reloading does not keep re-applying an old link over a later choice.
 *   2. the saved choice, written by relaunch().
 *   3. local, on Earth.
 *
 * Read with localStorage directly rather than through core/storage.js, because
 * storage.js asks this module which save it is reading — the dependency only
 * goes one way.
 */

const KEY = 'terraglide.boot';

/** Worlds a page can be told to start on. See geo/bodies.js for what each is. */
export const WORLD_IDS = [
  'earth', 'moon', 'mars', 'mercury', 'venus', 'ceres', 'vesta', 'io', 'europa',
  'ganymede', 'callisto', 'titan', 'enceladus', 'pluto', 'charon',
];

function readSaved() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeSaved(value) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Accept "wss://host", "https://host/", "host:8080" and turn it into the
 * WebSocket address the server listens on. Null if it is not one.
 *
 * People paste whatever is in their address bar, so an http(s) address is
 * taken to mean the same host's socket — a server that serves the game also
 * serves its socket, on the same port, at /ws.
 */
export function normaliseServer(input) {
  let text = String(input ?? '').trim();
  if (!text) return null;
  if (!/^[a-z]+:\/\//i.test(text)) {
    // A bare host. Plain ws:// for a machine on the local network, which never
    // has a certificate; wss:// for anything with a dot that is not an address.
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i.test(text);
    text = `${local ? 'ws' : 'wss'}://${text}`;
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null;
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/ws';
  url.hash = '';
  return url.href;
}

/** A short stable name for a server, for keeping its sign-in apart from others'. */
export function serverId(server) {
  try {
    const url = new URL(server);
    return `${url.host}${url.pathname === '/ws' ? '' : url.pathname}`.toLowerCase();
  } catch {
    return String(server ?? '');
  }
}

function resolve() {
  const saved = readSaved();
  let mode = saved.mode === 'online' ? 'online' : 'local';
  let world = null;
  let server = normaliseServer(saved.server);
  /** Which world each mode was last on, so switching modes comes back to it. */
  const worlds = { local: 'earth', online: 'earth', ...(saved.worlds ?? {}) };

  // A server that serves the game itself says so in the page it hands out, so
  // opening its address is joining it — no form to fill in with the address you
  // already typed.
  const hosted = globalThis.__TERRAGLIDE_SERVER__;
  let params = null;
  try {
    params = new URLSearchParams(globalThis.location?.search ?? '');
  } catch {
    params = null;
  }
  // Two different things an address can say: which way to play (a server, or
  // ?local), and which world. Only the first is a choice about the server —
  // ?world=moon on a server's own page must not stop it joining that server.
  let pickedMode = false;
  let pickedWorld = false;
  if (params) {
    const asked = params.get('server');
    if (asked && normaliseServer(asked)) {
      server = normaliseServer(asked);
      mode = 'online';
      pickedMode = true;
    }
    if (params.has('local')) {
      mode = 'local';
      pickedMode = true;
    }
    const wanted = params.get('world');
    if (wanted && WORLD_IDS.includes(wanted.toLowerCase())) {
      world = wanted.toLowerCase();
      pickedWorld = true;
    }
  }
  const fromAddress = pickedMode || pickedWorld;
  if (!pickedMode && hosted && !saved.chosen) {
    // First visit to a server's own page: that server, unless this browser
    // has already chosen something else on this same address. The page's
    // own address, less any query and the "index.html" a link may carry: the
    // server answers sockets at its root, and ws://host/index.html is a 404.
    const here = hostedServer();
    if (here) {
      server = here;
      mode = 'online';
    }
  }
  if (mode === 'online' && !server) mode = 'local';
  // The world this mode was last on, unless the address named one.
  if (!world) world = mode === saved.mode && WORLD_IDS.includes(saved.world) ? saved.world : worlds[mode];
  if (!WORLD_IDS.includes(world)) world = 'earth';

  if (fromAddress) {
    worlds[mode] = world;
    // Only choosing a way to play counts as having chosen: a link that just
    // names a world leaves a server's own page free to join it next time too.
    writeSaved({ ...saved, mode, world, server, worlds, chosen: Boolean(saved.chosen) || pickedMode });
    // Taken off the address so a reload does not apply the link again over
    // whatever has been chosen since — travelling to Mars and pressing F5
    // should leave you on Mars, not send you back to wherever the link said.
    try {
      const url = new URL(globalThis.location.href);
      for (const name of ['server', 'world', 'local']) url.searchParams.delete(name);
      globalThis.history?.replaceState(globalThis.history.state, '', url.href);
    } catch {
      /* file:// in some browsers; the saved choice still wins next time */
    }
  }
  return Object.freeze({ mode, world, server, worlds: Object.freeze({ ...worlds }) });
}

/**
 * The server whose own page this is, as a socket address, or null when the
 * page was not served by a TerraGlide server. The page's own address, less any
 * query and the "index.html" a link may carry: the server answers sockets at
 * its root, and ws://host/index.html is a 404.
 */
export function hostedServer() {
  const hosted = globalThis.__TERRAGLIDE_SERVER__;
  if (!hosted) return null;
  const page = String(globalThis.location?.href ?? '').replace(/[?#].*$/, '').replace(/\/index\.html$/i, '/');
  return normaliseServer(hosted === true ? page : hosted) || null;
}

export const BOOT = resolve();

/** True when playing on a server. Everything that behaves differently asks this. */
export const ONLINE = BOOT.mode === 'online';

/**
 * Start the game again as something else: another world, another mode, or
 * another server. Writes the choice and reloads; nothing after this runs.
 *
 * @param {{mode?: 'local'|'online', world?: string, server?: string|null, reason?: string}} next
 */
export function relaunch(next = {}) {
  const saved = readSaved();
  const mode = next.mode ?? BOOT.mode;
  const server = next.server !== undefined ? normaliseServer(next.server) : BOOT.server;
  const worlds = { ...BOOT.worlds, ...(saved.worlds ?? {}) };
  // Coming back to a mode puts you back on the world you left it on, unless
  // the caller has somewhere particular in mind.
  const world = next.world ?? (mode !== BOOT.mode ? worlds[mode] ?? 'earth' : BOOT.world);
  worlds[mode] = world;
  const going = server || mode === 'local' ? mode : 'local';
  const stored = writeSaved({ mode: going, world, server, worlds, chosen: true });
  try {
    // Said on the boot screen of the page that comes back, so a reload that
    // is really a launch to the Moon reads as one.
    globalThis.sessionStorage?.setItem('terraglide.relaunch', String(next.reason ?? ''));
  } catch {
    /* not important */
  }
  if (!stored) {
    // Storage blocked (a private window, site data turned off): a plain
    // reload would come back on the defaults — and a server that has you on
    // the Moon would send you round that loop for ever. The address carries
    // the choice instead, the way a link does.
    try {
      const url = new URL(globalThis.location.href);
      for (const name of ['server', 'world', 'local']) url.searchParams.delete(name);
      if (going === 'online') url.searchParams.set('server', server);
      else url.searchParams.set('local', '');
      url.searchParams.set('world', world);
      globalThis.location.replace(url.href);
      return;
    } catch {
      /* fall through to a plain reload */
    }
  }
  globalThis.location?.reload();
}

/** What relaunch() said it was doing, once, on the page it reloaded into. */
export function takeRelaunchReason() {
  try {
    const reason = globalThis.sessionStorage?.getItem('terraglide.relaunch') ?? '';
    globalThis.sessionStorage?.removeItem('terraglide.relaunch');
    return reason;
  } catch {
    return '';
  }
}

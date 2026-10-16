/**
 * Server settings: defaults, then server/config.json if there is one, then
 * environment variables — the last because that is how every cloud host hands
 * a process its port.
 *
 * Every field is optional. A server started with no config at all is a sensible
 * one: open sign-ups, PvP on, the game served at http://localhost:8080.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');

export const DEFAULTS = {
  /** Shown in the server list and at the top of the players panel. */
  name: 'TerraGlide server',
  /** A line under the name: rules, a welcome, where the Discord is. */
  motd: 'Fly safe. /help lists the commands.',
  host: '0.0.0.0',
  port: 8080,
  /** Where accounts and players are saved. Relative to the server folder. */
  dataDir: 'data',
  /** Most people online at once. */
  maxPlayers: 50,
  /** Accounts the server will hold; 0 for no limit. */
  maxAccounts: 0,
  /** Can anyone make an account? Off to freeze the list. */
  openSignups: true,
  /** If set, making an account needs this code — a private server for friends. */
  joinCode: '',
  /** New accounts allowed per address per hour. */
  signupsPerHour: 5,
  /** Names that are admins: /kick, /ban, /tp straight to someone, /heal, /setspawn. */
  admins: [],
  /** The very first account made on a fresh server is an admin, so its owner is. */
  firstAccountIsAdmin: true,
  /** Can players hurt each other? */
  pvp: true,
  /** No fighting this close to a world's spawn, metres, so arrivals are not camped. */
  spawnProtectionM: 64,
  /** Seconds between random teleports per player. */
  rtpCooldownS: 60,
  /** Seconds between /spawn uses. */
  spawnCooldownS: 15,
  /**
   * How fast anyone may fly, metres a second, across the ground and upwards,
   * before a move is refused. Falls never count.
   *
   * The fastest legitimate thing outside a surge is a Rocket V held on a
   * climb, 143 m/s on Earth; the room is for a bad network bunching updates
   * together. A surge is allowed 5.5 times this for its twelve seconds — it
   * stretches each tick and a rocket's push with it, so a Rocket V lit inside
   * one honestly climbs at about 870 m/s — and the server holds surges to the
   * same twelve on, thirty off that the game does. In thin air, where a glide
   * can reach the world's terminal speed, the limit is raised to clear it (on
   * Mars to about 490). On foot it is walking pace whatever this says.
   */
  maxSpeed: 180,
  /**
   * Which origins may connect, for the WebSocket. "*" for any — including the
   * single-file game opened from disk, whose origin is "null" — or a list.
   */
  allowedOrigins: '*',
  /**
   * ICE servers handed to browsers for voice chat. Public STUN by default,
   * which connects most people; add a TURN server here for the rest. See
   * HOSTING.md.
   */
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
  /** Serve the game itself on the same port, so the server's address is playable. */
  serveGame: true,
  /**
   * Behind a proxy or tunnel, take the client's address from what the proxy
   * reports (the last X-Forwarded-For entry, or proxyHeader) instead of from
   * the socket, which is the proxy's own. Off when players connect directly.
   */
  trustProxy: false,
  /**
   * With trustProxy on, a header the proxy names the visitor in, which then
   * wins over X-Forwarded-For — "cf-connecting-ip" behind Cloudflare. Empty
   * for none. Only behind that proxy: anyone can send the header otherwise.
   */
  proxyHeader: '',
  /** Seconds between saves to disk. */
  saveEveryS: 30,
};

export function loadConfig({ file = join(HERE, 'config.json'), env = process.env } = {}) {
  let fromFile = {};
  if (existsSync(file)) {
    try {
      fromFile = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`server/config.json is not valid JSON: ${error.message}`);
    }
  }
  // The same, as one JSON variable, for hosts that build from the repository and
  // so have no config.json: laid over the file, under the variables below.
  let fromEnv = {};
  if (env.TERRAGLIDE_CONFIG) {
    try {
      fromEnv = JSON.parse(env.TERRAGLIDE_CONFIG);
    } catch (error) {
      throw new Error(`TERRAGLIDE_CONFIG is not valid JSON: ${error.message}`);
    }
  }
  const config = { ...DEFAULTS, ...fromFile, ...fromEnv };
  const number = (name, key) => {
    if (!env[name]) return;
    const n = Number(env[name]);
    if (Number.isFinite(n) && n >= 0) config[key] = n;
    else console.warn(`${name}=${env[name]} is not a number; ${key} stays ${config[key]}`);
  };
  const flag = (name, key) => {
    if (!env[name]) return;
    if (/^(1|true|yes|on|0|false|no|off)$/i.test(env[name])) config[key] = /^(1|true|yes|on)$/i.test(env[name]);
    else console.warn(`${name}=${env[name]} is not on or off; ${key} stays ${config[key]}`);
  };
  if (env.TERRAGLIDE_MOTD) config.motd = env.TERRAGLIDE_MOTD;
  number('TERRAGLIDE_MAX_PLAYERS', 'maxPlayers');
  number('TERRAGLIDE_MAX_ACCOUNTS', 'maxAccounts');
  number('TERRAGLIDE_SIGNUPS_PER_HOUR', 'signupsPerHour');
  flag('TERRAGLIDE_OPEN_SIGNUPS', 'openSignups');
  flag('TERRAGLIDE_FIRST_ACCOUNT_ADMIN', 'firstAccountIsAdmin');
  flag('TERRAGLIDE_PVP', 'pvp');
  if (env.TERRAGLIDE_ALLOWED_ORIGINS) config.allowedOrigins = env.TERRAGLIDE_ALLOWED_ORIGINS;
  if (env.PORT) config.port = Number(env.PORT);
  if (env.HOST) config.host = env.HOST;
  if (env.DATA_DIR) config.dataDir = env.DATA_DIR;
  if (env.TERRAGLIDE_NAME) config.name = env.TERRAGLIDE_NAME;
  if (env.TERRAGLIDE_JOIN_CODE) config.joinCode = env.TERRAGLIDE_JOIN_CODE;
  if (env.TERRAGLIDE_ADMINS) config.admins = env.TERRAGLIDE_ADMINS.split(',').map((s) => s.trim()).filter(Boolean);
  if (env.TERRAGLIDE_TRUST_PROXY) config.trustProxy = env.TERRAGLIDE_TRUST_PROXY !== '0';
  if (env.TERRAGLIDE_PROXY_HEADER) config.proxyHeader = env.TERRAGLIDE_PROXY_HEADER;
  if (env.TURN_URL) {
    config.iceServers = [
      ...config.iceServers,
      { urls: env.TURN_URL.split(','), username: env.TURN_USERNAME ?? '', credential: env.TURN_CREDENTIAL ?? '' },
    ];
  }
  config.dataDir = resolve(HERE, config.dataDir);
  return config;
}

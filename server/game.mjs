/**
 * The shared world: who is online, where everyone is, and the rules.
 *
 * The page does the flying — the elytra model, collisions, streaming the
 * ground — because only the page has the ground to collide with. What the
 * server owns is everything that would be a cheat if the page owned it:
 *
 *   - whether a move was possible at all (speed, teleports nobody granted)
 *   - health: damage is applied here, from hits measured here
 *   - where you may teleport to, and when
 *   - what you have explored and the line you have flown, worked out from the
 *     moves it accepted rather than from anything the page claims
 *
 * Positions go out to everyone on the same world ten times a second to those
 * near you and once a second to everyone else — enough for the map, the
 * compass and the locator bar to follow somebody across a continent.
 */

import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { BODIES, aeroFactor, findBody, gravityRatio, terminalSpeed } from '../src/geo/bodies.js';
import { FLIGHT_GRAVITY_MPS2 } from '../src/player/elytra.js';
import { randomPopulatedPlace } from '../src/world/places.js';
import { randomFeature } from '../src/geo/gazetteer.js';
import {
  ATTACK_COOLDOWN_S,
  CHAT_MAX,
  PASSWORD_MAX,
  COMBAT_TAG_S,
  CRIT_MULTIPLIER,
  FLAG,
  HURT_IMMUNE_S,
  KNOCKBACK_MPS,
  KNOCKBACK_SPRINT_MPS,
  MAX_HEALTH,
  OXYGEN_REFILL_PER_S,
  OXYGEN_SECONDS,
  PROTOCOL_VERSION,
  REACH_M,
  REACH_SLACK_M,
  LANDER_EVERY_S,
  REFILL_AGL_M,
  REFILL_M,
  ROCKET_REFILL_S,
  ROCKET_STACK,
  REGEN_DELAY_S,
  REGEN_EVERY_S,
  SPEED_MODE_COOLDOWN_S,
  SPEED_MODE_SECONDS,
  SURGE_BLEED_PER_S,
  SURGE_FACTOR,
  SUFFOCATION_PER_S,
  SWORD_DAMAGE,
  SWORD_SLOT,
  TPA_COOLDOWN_S,
  TPA_TIMEOUT_S,
  VOICE_CONNECT_M,
  TWIN_DISTANCE,
  colourDistance,
  decodeState,
  distinctColour,
  nameKey,
  parseCommand,
  separation,
  snapshotRow,
} from '../src/net/protocol.js';
import { explorationScheme, readCells } from '../src/ui/exploration.js';
import { CellRuns } from './cells.mjs';
import { MAX_WAYPOINTS, PlayerRecord, circumferenceOf, radiusOf } from './records.mjs';
import { runCommand } from './commands.mjs';
import { MAX_FRIENDS, Social } from './social.mjs';

const TICK_MS = 100;
/** Everyone within this sees you at the full rate; further out, once a second. */
const NEAR_M = 6000;
/**
 * A client that has said nothing for this long, nor answered the server's own
 * pings, is gone.
 */
const SILENT_MS = 45000;
/** How long a world change may take before "left" is announced instead of "arrived". */
const TRAVEL_GRACE_MS = 30000;
/**
 * How far from where it was sent a page may say it arrived. It lands there
 * and reports at once (Session.arrive); this is for the heights settling.
 */
const ARRIVAL_SLACK_M = 400;
/** A page that has not said it arrived after this long is taken to be there. */
const ARRIVAL_TIMEOUT_MS = 20000;
/** After a burst or a refused move, how long the sword does not count. */
const BLINK_GUARD_MS = 800;
/** Metres over the limit a half second may carry you before it is a burst. */
const BLINK_SLACK_M = 20;
/** A gap between states longer than this, seconds, is a stall to catch up on. */
const CATCH_UP_AFTER_S = 1.5;
/** The longest stall caught up on; past it the page is put back as before. */
const CATCH_UP_MAX_S = 10;
/** How long the travel a stall held back stays lent, milliseconds. */
const CATCH_UP_MS = 2000;
/**
 * Seconds over which Earth's air takes a fall's extra speed away (fadeReserve);
 * thinner air takes it longer, none never. The glide's own drag does it in
 * about half this.
 */
const RESERVE_FADE_S = 5;
/** Room over a thin-air world's terminal glide, for the limit and for what a fall there can give. */
const GLIDE_ROOM = 1.3;
/**
 * What coming out of a surge leaves you, as speed squared over the limit. A
 * surge pushes every rocket 2.4 times as hard, and with no air nothing takes
 * the speed off afterwards: held level on rockets lit at any rhythm, from one
 * every quarter second to one every two, an honest pilot came out at 327 to
 * 334 m/s on the Moon, Io and Mercury (the game's own Player and controller).
 * A fifth more than that, for a surge that ran its time with rockets lit, and
 * as much of it as it ran. It fades like a fall's speed, and if it is not used.
 */
const SURGE_KEPT_MPS = 400;
const SURGE_KEPT_SQ = SURGE_KEPT_MPS ** 2 - 180 ** 2;
/**
 * A reserve the page is not using fades: moving slower than this share of
 * what it allows, over a second, it goes with this time constant. See fadeReserve.
 */
const UNUSED_FRACTION = 0.5;
const UNUSED_FADE_S = 4;
/**
 * How much of a pause a page has flown when it says nothing about it - all of
 * a shorter one - and so how much is judged like any other time: a frame the
 * page took that long over flies up to this much of it (MAX_FRAME_S in
 * src/core/perf.js). A tab back from the background flies none of the time
 * it was hidden, and says so (FLAG.woke). See fadeReserve.
 */
const PAGE_CATCH_UP_S = 1.5;
/**
 * A pause this long after the last one is a page woken once, not one pausing
 * on a rhythm - from a page that has never said it woke (FLAG.woke), which an
 * older one never does. One that says so may say it as often as it likes; no
 * more than two such pauses in twice this long are left out whole. See
 * fadeReserve.
 */
const PAUSE_APART_S = 5;
/** A gap before a state this long, seconds, starts a burst. See onState. */
const BURST_GAP_S = 0.25;
/** How long a burst's states keep arriving, ms, and how close together they come, s. */
const BURST_SETTLE_MS = 150;
const BACKLOG_GAP_S = 0.02;
/** The share of a surge's states with a rocket burning that earns all it leaves you. */
const SURGE_ROCKET_SHARE = 0.5;
/** Room over a flight's climbing pace that a climb in the arrival grace may take and still be earned. */
const GRACE_CLIMB_ROOM = 1.2;
/** How far above the height it was sent to an arrival may stand up as the ground loads. */
const ARRIVAL_STAND_M = 300;
/**
 * How long after a correction a refused state is one sent before it was
 * heard: this, and the round trip up to RTT_HEARD_MAX_MS - a page can only
 * make itself look slower by holding its answers back, and no more than that.
 */
const CORRECTION_HEARD_MS = 300;
const RTT_HEARD_MAX_MS = 700;
/** Room on top of what a fall gave, for the flight model's own rounding. */
const RESERVE_MARGIN = 1.25;
/** How far above a world's highest ground an arrival is taken to stand. */
const ARRIVAL_CEILING_M = 1000;
/** Ticks between the server's pings: a keepalive, and how the round trip is timed. */
const PING_EVERY_TICKS = 20;
/** The furthest back a hit is judged, however slow the connection says it is. */
const REWIND_MAX_MS = 400;
/** A hit counts only this soon after the swing that made it. */
const SWING_FRESH_MS = 1000;
/** Seconds of position history kept per player, for judging hits after the fact. */
const HISTORY_S = 1.5;
/** Repeated impossible moves before a player is disconnected. */
const KICK_AFTER_VIOLATIONS = 40;
/** States a second a page may send before the rest are dropped; pages send ten. */
const MAX_STATES_PER_S = 30;
/** Metres of grace on a single move, lent against the next allowance. */
const SPEED_SLACK_M = 25;
/** A paced send waits while this much is still waiting to go out on the socket. */
const PACE_BYTES = 256 * 1024;
/** New cells to a message when new ground on a shared map is sent. See flushShared. */
const SHARED_NEW_PER_MESSAGE = 20000;
/** Runs to a part when the shared map is sent or saved in pieces. */
const SHARED_PART_RUNS = 20000;
/** New cells one player may add to the shared maps in a day. See addShared. */
const SHARED_PER_DAY = 3500000;
/** The most cells a shared map holds. */
const SHARED_MAX = 30000000;
/**
 * The most a connection may fall behind, bytes queued for it here and in its
 * socket together. A page that stops reading - asleep, or hostile - is let
 * go past this rather than held in the server's memory without end; it
 * reconnects and starts clean.
 */
const BACKLOG_MAX = 24 * 1024 * 1024;
/** Past this many players on one world, the far-off ones are sent less often. */
const CROWD = 64;
/**
 * The most players one atlas lists: everybody online, then your party and
 * friends, then whoever was here most recently. A public server's list of
 * everyone who ever played is not something to send whole to each arrival.
 */
const ATLAS_MAX = 300;
/** Seconds either way a surge's timing may be out, for a slow connection. */
const SURGE_GRACE_S = 2;
/**
 * How many times the speed limit a surge is allowed. Not the page's 2.4: a
 * surge stretches each tick by that and a rocket's push with it, so a Rocket
 * V lit in one climbs at 873 m/s on Earth against 143 out of one — measured
 * with the game's own stepGlide and stepRocket, rockets held, and Earth is
 * where the ratio is widest. Speed from a fall, and what a surge leaves you
 * with afterwards, are counted on their own: see fallReserve.
 */
export const SURGE_ALLOWANCE = 5.5;
/**
 * The fastest anyone moves on their feet, metres a second: a sprint is under
 * six, seven for the tallest player. Rockets stop on the ground, so this is
 * all walking ever is; it leaves room for knockback and for sliding to a stop.
 */
const GROUND_MAX_MPS = 25;
/** Seconds after leaving the air that a landing may still be sliding along. */
const LANDING_GRACE_S = 2;
/**
 * Seconds after arriving somewhere that height is not judged: the page lands
 * at nought until the heights load, then stands up on the mountain at once.
 */
const ARRIVAL_GRACE_S = 30;
/** How long the combat tag and cooldowns survive a reconnect. */
const CARRY_MS = 10 * 60 * 1000;
/** Chat: this many lines in this many seconds. */
const CHAT_BURST = 6;
const CHAT_WINDOW_S = 6;

export class Game {
  /**
   * @param {object} deps
   * @param {object} deps.config
   * @param {import('./store.mjs').Store} deps.store
   * @param {import('./accounts.mjs').Accounts} deps.accounts
   * @param {() => number} [deps.now] milliseconds; replaceable for the tests
   */
  constructor({ config, store, accounts, now = () => Date.now() }) {
    this.config = config;
    this.store = store;
    this.accounts = accounts;
    this.now = now;
    /** Every open socket, signed in or not. */
    this.clients = new Set();
    /** Signed-in players by session id. */
    this.players = new Map();
    this.byKey = new Map();
    this.nextId = 1;
    /** Records of the players online, and of anybody touched since the last save. See evictRecords(). */
    this.records = new Map();
    /** Friend lists for /api/status, read off the disk at most once a minute each. See friendsStatus. */
    this.statusFriends = new Map();
    this.requests = new Map();
    this.nextRequest = 1;
    this.travelling = new Map();
    /** Combat tag and cooldowns, by account, kept across reconnects. See disconnect(). */
    this.carried = new Map();
    /**
     * When each account last spoke, and last used the players panel: by
     * account, not connection, or reconnecting was a fresh budget every time.
     */
    this.chatTimes = new Map();
    this.socialTimes = new Map();
    /** Set while the server shuts down: nobody is leaving a fight then. */
    this.stopping = false;
    this.tickCount = 0;
    this.lastSave = now();
    const saved = store.read('server.json', {});
    this.bans = saved.bans ?? {};
    this.spawns = { ...(saved.spawns ?? {}) };
    /** Friends and parties. */
    this.social = new Social(this, { parties: saved.parties });
    /** Per world, everything anybody has explored there: the shared map. See sharedMap(). */
    this.shared = new Map();
    /** What each player has added to the shared maps today. See addShared(). */
    this.sharedBudget = new Map();
    /** Who has been where, a few numbers each. See loadIndex(). */
    this.indexDirty = new Set();
    this.index = this.loadIndex();
  }

  saveServer() {
    this.store.mark('server.json', () => ({ bans: this.bans, spawns: this.spawns, parties: this.social.toJSON() }));
  }

  /* ------------------------------------------------------------ records */

  /** A record to change: kept in memory until it is saved and its player is gone. */
  record(key) {
    let record = this.records.get(key);
    if (record) return record;
    record = new PlayerRecord(key, this.store.read(`players/${key}.json`, {}));
    this.records.set(key, record);
    return record;
  }

  /** A record to read and let go of: the live one if there is one, else straight off the disk. */
  peek(key) {
    return this.records.get(key) ?? new PlayerRecord(key, this.store.read(`players/${key}.json`, {}));
  }

  saveRecord(record) {
    this.store.mark(`players/${record.key}.json`, () => record.toJSON());
    this.indexDirty.add(record.key);
    this.store.mark('index.json', () => this.indexJSON());
  }

  /**
   * Who has been where, in a few numbers each, kept beside the records and
   * read instead of them.
   *
   * Listing who had explored a world - every arrival, every time the players
   * panel opened - read every player's whole file into memory and kept it
   * there. Memory grew with every account ever made rather than with who was
   * on, and on the small machine the guide suggests, three thousand of them
   * were enough for the first sign-in to run it out, and every sign-in after
   * the restart to do it again. Now a player's file is read when they play,
   * or when somebody asks to see their map, and let go once it is saved.
   *
   * Built once from the files when it is missing (one at a time, none kept),
   * and kept up to date at every save.
   */
  loadIndex() {
    const saved = this.store.read('index.json', null);
    const index = new Map();
    const files = new Set(this.store.playerFiles().map((file) => file.slice(0, -5)));
    if (saved?.version === 1 && saved.players && typeof saved.players === 'object') {
      for (const [key, entry] of Object.entries(saved.players)) if (files.has(key)) index.set(key, entry);
    }
    let added = 0;
    for (const key of files) {
      if (index.has(key)) continue;
      index.set(key, summarise(this.peek(key)));
      added += 1;
    }
    if (added || index.size !== Object.keys(saved?.players ?? {}).length) {
      this.store.mark('index.json', () => this.indexJSON());
    }
    return index;
  }

  indexJSON() {
    for (const key of this.indexDirty) {
      const record = this.records.get(key);
      if (record) this.index.set(key, summarise(record, this.index.get(key)));
    }
    this.indexDirty.clear();
    return { version: 1, players: Object.fromEntries(this.index) };
  }

  /** How much somebody has explored on a world, and how long their path is there: [cells, points]. */
  countsOn(key, world) {
    const live = this.records.get(key)?.live.get(world);
    if (live) return countsOf(live);
    return this.index.get(key)?.worlds?.[world] ?? [0, 0];
  }

  /** The world somebody was last on, without reading their whole record. */
  worldOf(key) {
    return this.byKey.get(key)?.world ?? this.records.get(key)?.world ?? this.index.get(key)?.world ?? 'earth';
  }

  /**
   * Records of players who are not online, out of memory once they are
   * safely on disk: they are read again the next time they are wanted.
   */
  evictRecords() {
    // A traveller is gone from here for a few seconds and back on another
    // world; their record is on disk and is read again when they arrive. The
    // note that they are travelling outlives that only if they never do.
    const now = this.now();
    for (const [key, trip] of this.travelling) {
      if (now - trip.at > TRAVEL_GRACE_MS) this.travelling.delete(key);
    }
    for (const key of [...this.records.keys()]) {
      if (this.byKey.has(key)) continue;
      // Not written yet - a save that failed and will be tried again.
      if (this.store.dirty.has(`players/${key}.json`)) continue;
      this.records.delete(key);
    }
  }

  spawnOf(world) {
    const body = BODIES[world] ?? BODIES.earth;
    return this.spawns[world] ?? { lat: body.spawn.lat, lon: body.spawn.lon, label: body.spawn.label };
  }

  /* ------------------------------------------------------------- sockets */

  /** A socket opened. `address` is who it came from, for rate limits and bans. */
  connect(ws, address) {
    const client = {
      ws,
      address,
      player: null,
      hello: false,
      voiceTimes: [],
      lastHeard: this.now(),
    };
    this.clients.add(client);
    ws.on('message', (data, binary) => {
      client.lastHeard = this.now();
      if (binary) return;
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      if (!message || typeof message.t !== 'string') return;
      try {
        this.receive(client, message);
      } catch (error) {
        // A few in full, then only counted: a page that sends rubbish on
        // purpose should not be able to fill the host's log, and one that
        // keeps it up is let go.
        client.errors = (client.errors ?? 0) + 1;
        if (client.errors <= 3) console.error('[game] handling', String(message.t).slice(0, 24), 'failed:', error);
        if (client.errors > 100) client.ws.terminate();
      }
    });
    ws.on('close', () => this.disconnect(client));
    // The round trip, timed here on the server's own pings, which a browser
    // answers by itself: the middle of the last few, so one slow one does
    // not move it. For how far back a hit is judged (onAttack), and how long
    // after a correction a refused move is one sent before it was heard
    // (onState) - both capped, since holding answers back only looks slower.
    ws.on('pong', (payload) => {
      // Only an answer to a ping this server sent, and not yet answered: the
      // payload was the time it was sent, and a page that answered with one
      // of its own made its round trip ten seconds, which bought the longest
      // hit rewind and a ten-second wait before any refused move counted.
      const key = String(payload);
      const sent = client.pings?.get(key);
      if (sent === undefined) return;
      client.pings.delete(key);
      // Heard, too. A browser answers these itself, however its own timers
      // are held back: a tab five minutes in the background runs them once a
      // minute (Chrome), and one sending nothing but its own pings at that
      // pace was let go as silent, "left" for everybody, and back a minute later.
      client.lastHeard = this.now();
      const rtt = this.now() - sent;
      if (!(rtt >= 0 && rtt < 10000)) return;
      client.rtts = [...(client.rtts ?? []).slice(-4), rtt];
      const sorted = [...client.rtts].sort((a, b) => a - b);
      client.rtt = sorted[sorted.length >> 1];
      if (client.player) client.player.rtt = client.rtt;
    });
    return client;
  }

  send(client, message) {
    if (!client?.ws?.open) return;
    client.ws.send(JSON.stringify(message));
  }

  /** To everyone signed in, optionally only on one world. */
  /**
   * For the big ones — a whole map, a whole trail — sent no faster than the
   * connection takes them. All at once, a busy server's atlas went over the
   * socket's buffer limit and the newcomer was cut off, reconnected, asked
   * again and was cut off again. Queued messages keep their order, and
   * anything sent paced after them waits its turn too.
   */
  sendPaced(client, message) {
    const text = typeof message === 'string' ? message : JSON.stringify(message);
    client.outbox ??= [];
    client.outboxBytes ??= 0;
    if (!client.outbox.length && client.ws.open && client.ws.bufferedAmount < PACE_BYTES) client.ws.send(text);
    else {
      client.outbox.push(text);
      client.outboxBytes += text.length;
    }
  }

  drainOutboxes() {
    for (const client of this.clients) {
      if (client.ws.open && (client.outboxBytes ?? 0) + client.ws.bufferedAmount > BACKLOG_MAX) {
        // Not reading: let go, before it is all the memory there is. Not a
        // kick that sticks - the page reconnects and is sent what it needs.
        client.outbox = [];
        client.outboxBytes = 0;
        client.sharedStream = null;
        client.ws.terminate();
        continue;
      }
      const box = client.outbox;
      if (!box?.length && !client.sharedStream) continue;
      if (!client.ws.open) {
        if (box) box.length = 0;
        client.outboxBytes = 0;
        client.sharedStream = null;
        continue;
      }
      while (box?.length && client.ws.bufferedAmount < PACE_BYTES) {
        const text = box.shift();
        client.outboxBytes -= text.length;
        client.ws.send(text);
      }
      // A shared map on its way goes on once everything queued before it has.
      this.pumpShared(client);
    }
  }

  broadcast(message, { world = null, except = null } = {}) {
    const text = JSON.stringify(message);
    for (const player of this.players.values()) {
      if (player === except) continue;
      if (world && player.world !== world) continue;
      if (player.client.ws.open) player.client.ws.send(text);
    }
  }

  /** A line in everybody's chat from the server itself. */
  announce(text, { world = null, except = null, kind = 'system' } = {}) {
    this.broadcast({ t: 'chat', kind, text }, { world, except });
  }

  tell(player, text, kind = 'system') {
    this.send(player.client, { t: 'chat', kind, text });
  }

  receive(client, m) {
    // Refused for its version (below): nothing it sends after counts, the
    // sign-in it may already have on its way included.
    if (client.refused) return;
    if (m.t === 'hello') {
      client.hello = true;
      this.send(client, {
        t: 'welcome',
        v: PROTOCOL_VERSION,
        // The host playing on the machine the server runs on is told the
        // machine's network addresses, so the invite they copy is one their
        // friends can open — not "localhost", which is everybody's own.
        server: { ...this.publicInfo(), ...(isLoopback(client.address) ? { lan: lanAddresses() } : {}) },
      });
      if (Number(m.v) !== PROTOCOL_VERSION) {
        const text = Number(m.v) < PROTOCOL_VERSION
          ? 'This server runs a newer version of the game — reload the page'
          : 'This server runs an older version of the game';
        this.send(client, { t: 'error', code: 'version', text });
        // And no further. No page so far does anything with the error, so one
        // from before carried on as if nothing were wrong - a tab left open
        // across a restart reconnects by itself - and drew the explored ground
        // it was sent with the squares of its own version: off Earth and past
        // 60 degrees none of it at the zooms the maps open at, and 0%
        // explored, without a word why. A kick it does understand: it shows
        // the reason and stops reconnecting, as for "signed in from somewhere
        // else".
        this.send(client, { t: 'kick', reason: text });
        client.refused = true;
        client.ws.close(4001, 'version');
      }
      return;
    }
    if (m.t === 'ping') {
      // The page's own clock sync. The round trip it reports is not used: a
      // page that said a second bought itself a second of the hit rewind.
      // The server times its own pings instead - see connect.
      this.send(client, { t: 'pong', c: m.c, s: this.now() });
      return;
    }
    if (!client.player) {
      if (m.t === 'signup' || m.t === 'login' || m.t === 'resume') {
        // Async, and a throw in there - a record that will not load, a disk
        // that will not write - would otherwise be an unhandled rejection,
        // which ends the whole server for everyone on it.
        this.authenticate(client, m).catch((error) => {
          console.error('[terraglide] sign-in failed:', error?.stack ?? error);
          this.send(client, { t: 'auth', ok: false, error: 'The server could not sign you in — try again' });
        });
      }
      return;
    }
    const player = client.player;
    switch (m.t) {
      case 's': return this.onState(player, m);
      case 'chat': return this.onChat(player, m.text);
      case 'attack': return this.onAttack(player, m);
      case 'damage': return this.onSelfDamage(player, m);
      case 'respawn': return this.respawn(player);
      case 'travel': return this.travel(player, m.world);
      case 'arrived': return this.onArrived(player, m);
      case 'watch': return this.onWatch(player, m);
      case 'atlas': return this.sendAtlas(player);
      case 'waypoints': return this.onWaypoints(player, m.list);
      case 'lander': return this.onLander(player, m);
      case 'rtp': return this.randomTeleport(player);
      case 'voice': return this.onVoice(player, m);
      case 'socialPrefs': return this.social.setPrefs(player, m);
      case 'partyMark': return this.social.mark(player, m);
      case 'rockets': return this.onRockets(player, m);
      case 'partyUnmark': return this.social.unmark(player, m);
      case 'password': return this.onPassword(player, m);
      case 'social': return this.onSocial(player, m);
      case 'logout':
        if (client.token) this.accounts.closeSession(client.token);
        this.send(client, { t: 'loggedOut' });
        client.ws.close(1000, 'signed out');
        return;
      default:
    }
  }

  /**
   * What /api/status adds for a page that holds a session here: how many of
   * that account's friends are on, of how many. A look, not a sign-in - the
   * session is not refreshed - and since the startup screen asks every couple
   * of seconds, the list itself is read at most once a minute per account
   * rather than a whole player file each time. Who is on is always live.
   */
  friendsStatus(token) {
    const account = this.accounts.peekSession(token);
    if (!account) return null;
    const now = this.now();
    let cached = this.statusFriends.get(account.key);
    if (!cached || now - cached.at > 60000) {
      const social = this.peek(account.key).social;
      const friends = Array.isArray(social?.friends) ? social.friends.filter((k) => typeof k === 'string').slice(0, MAX_FRIENDS) : [];
      if (this.statusFriends.size > 1000) this.statusFriends.clear();
      this.statusFriends.set(account.key, (cached = { at: now, friends }));
    }
    // A friend made or lost while signed in is in the live record already.
    const live = this.records.get(account.key)?.social?.friends;
    const friends = Array.isArray(live) ? live : cached.friends;
    return { online: friends.filter((k) => this.byKey.has(k)).length, total: friends.length };
  }

  publicInfo() {
    return {
      name: this.config.name,
      motd: this.config.motd,
      online: this.players.size,
      max: this.config.maxPlayers,
      signups: this.config.openSignups,
      joinCode: !!this.config.joinCode,
      pvp: this.config.pvp,
      worlds: Object.keys(BODIES),
    };
  }

  /* ---------------------------------------------------------- signing in */

  async authenticate(client, m) {
    if (client.busy) return;
    client.busy = true;
    try {
      // An address ban stops new accounts at once; for an existing one it is
      // checked once the account is known, so an admin is never locked out
      // of their own server by sharing a network with somebody banned.
      const addressBanned = this.isBanned(client.address);
      if (addressBanned && m.t === 'signup') {
        this.send(client, { t: 'auth', ok: false, error: 'This address is banned from the server' });
        return;
      }
      let result;
      let token = null;
      // Strings or nothing. String() of {"toString":"x"} throws, and before
      // there was a catch round this, one such sign-in ended the server.
      const text = (value) => (typeof value === 'string' ? value : '');
      if (m.t === 'resume') {
        const account = this.accounts.resume(text(m.token));
        result = account ? { account } : { error: 'Signed out — sign in again', expired: true };
        if (account) token = text(m.token);
      } else if (m.t === 'signup') {
        result = await this.accounts.signup(text(m.name), text(m.password), client.address, text(m.code));
      } else {
        result = await this.accounts.login(text(m.name), text(m.password), client.address);
      }
      if (result.error) {
        this.send(client, { t: 'auth', ok: false, error: result.error, expired: !!result.expired });
        return;
      }
      const account = result.account;
      // A new account goes to disk at once: losing one to a hard stop would
      // leave somebody unable to sign in with the password they just chose.
      if (m.t === 'signup') this.store.flush();
      if (this.bans[account.key]) {
        this.send(client, { t: 'auth', ok: false, error: `Banned: ${this.bans[account.key].reason || 'no reason given'}` });
        return;
      }
      if (addressBanned && !account.admin && !this.accounts.isConfiguredAdmin(account.name)) {
        this.send(client, { t: 'auth', ok: false, error: 'This address is banned from the server' });
        return;
      }
      if (!client.ws.open) return;
      const existing = this.byKey.get(account.key);
      if (!existing && this.players.size >= this.config.maxPlayers) {
        this.send(client, { t: 'auth', ok: false, error: 'The server is full — try again in a bit' });
        return;
      }
      if (existing) {
        // The same account somewhere else — another tab, or this tab
        // reconnecting before the old socket noticed it was dead. The newest
        // one wins, and the old one is told why it was dropped.
        this.send(existing.client, { t: 'kick', reason: 'Signed in from somewhere else' });
        this.disconnect(existing.client, { quiet: true, replaced: true });
        existing.client.ws.close(4001, 'signed in elsewhere');
      }
      if (m.remember !== false && !token) token = this.accounts.openSession(account);
      client.token = token;
      this.accounts.touch(account);
      this.join(client, account, token);
    } finally {
      client.busy = false;
    }
  }

  join(client, account, token) {
    // Your colour is yours — unless somebody online now is wearing nearly the
    // same one. Then you get a new one, for good, so the two of you can be
    // told apart on the locator bar and the map.
    const online = [...this.players.values()].filter((p) => p.key !== account.key).map((p) => p.colour);
    if (online.some((c) => colourDistance(c, account.colour) < TWIN_DISTANCE)) {
      account.colour = distinctColour(online);
      this.accounts.save();
    }
    const record = this.record(account.key);
    const world = record.world;
    const live = record.on(world);
    const spawn = this.spawnOf(world);
    const pos = live.pos ?? { lat: spawn.lat, lon: spawn.lon, alt: null, yaw: 0, flying: false };
    const player = {
      id: this.nextId++,
      key: account.key,
      name: account.name,
      colour: account.colour,
      admin: !!account.admin || this.accounts.isConfiguredAdmin(account.name),
      account,
      client,
      record,
      world,
      state: null,
      history: [],
      lastStateAt: 0,
      budget: 0,
      violations: 0,
      /** When the page last arrived somewhere, and last left the ground. See onState. */
      arrivedAt: -Infinity,
      airborneAt: -Infinity,
      /** Until when a hit does not count, after a burst of speed. See onState. */
      blinkUntil: 0,
      /** Travel a quiet socket held back, lent for a moment; the last gap, and a hold's allowance. See onState. */
      catchUp: 0,
      catchUpUntil: 0,
      lastGap: null,
      heldUntil: 0,
      /** Speed squared a fall has given, and the height it may count from. See fallReserve. */
      reserve: 0,
      surgeKept: 0,
      ceiling: -Infinity,
      /** Time not yet judged for an unused reserve, and the pauses left out. See fadeReserve. */
      fadePool: 0,
      fadeBunch: null,
      fadeBack: null,
      fadeHeld: false,
      /** The last state before the latest gap, and how fast it was falling. See onState. */
      gapBack: null,
      pausedMs: 0,
      lastPauseAt: -Infinity,
      /** The last two pauses the page said it woke from, and whether it ever has. See fadeReserve. */
      wokeAt: -Infinity,
      prevWokeAt: -Infinity,
      saidWoke: false,
      /** When the page was last put back, and the burst it is in. See onState. */
      correctedAt: -Infinity,
      burst: null,
      health: Number.isFinite(record.health) && record.health > 0 ? record.health : MAX_HEALTH,
      /** The suit's tank, seconds: the server's to count, so a reload is not a refill. */
      oxygen: Number.isFinite(record.oxygen) ? Math.min(OXYGEN_SECONDS, Math.max(0, record.oxygen)) : OXYGEN_SECONDS,
      suffocateTimer: 0,
      oxygenSentAt: 0,
      dead: false,
      lastHurtAt: -Infinity,
      immuneUntil: 0,
      combatUntil: 0,
      lastAttackAt: -Infinity,
      regenAt: 0,
      selfDamage: [],
      rtt: client.rtt ?? 100,
      pending: null,
      nextTid: 1,
      lastRtpAt: -Infinity,
      lastSpawnAt: -Infinity,
      lastTravelAt: -Infinity,
      lastLanderAt: -Infinity,
      /** The surge the server has allowed: see surgeFactor. */
      surge: { on: false, since: 0, endedAt: -Infinity, readyAt: 0, prevEndedAt: -Infinity, rockets: 0, states: 0 },
      lastRequestAt: new Map(),
      watching: new Map(),
      /** "Everyone's" discoveries or paths: also anybody who turns up later. */
      watchAll: { explored: false, trail: false },
      flags: 0,
      item: 0,
      joinedAt: this.now(),
      replyTo: null,
    };
    const carried = this.carried.get(player.key);
    if (carried && this.now() - carried.at < CARRY_MS) {
      player.combatUntil = carried.combatUntil;
      player.lastRtpAt = carried.lastRtpAt;
      player.lastSpawnAt = carried.lastSpawnAt;
      player.lastTravelAt = carried.lastTravelAt;
      player.lastLanderAt = carried.lastLanderAt ?? -Infinity;
      player.lastHurtAt = carried.lastHurtAt ?? -Infinity;
      player.lastHitBy = carried.lastHitBy;
      player.surge = carried.surge;
      // The sword's clock and the blink guard are the account's too: signing
      // in again on a new socket - which takes a page a moment, and a page
      // that keeps one open a single message - was a fully charged blade
      // after every swing, and a hit straight after a dash, a drop or a
      // refused move, where the guard (onState) says no.
      player.lastAttackAt = carried.lastAttackAt ?? -Infinity;
      player.lastSwingAt = carried.lastSwingAt;
      player.blinkUntil = carried.blinkUntil ?? 0;
    }
    this.carried.delete(player.key);
    client.player = player;
    this.players.set(player.id, player);
    this.byKey.set(player.key, player);
    // Where you are until the page says otherwise: the saved spot, which the
    // first state has to be near or it is a teleport nobody granted.
    player.state = pos.alt != null
      ? { lat: pos.lat, lon: pos.lon, alt: pos.alt, agl: 0, vel: [0, 0, 0], yaw: pos.yaw ?? 0, pitch: 0, roll: 0, flags: 0, item: 0 }
      : null;
    player.pending = {
      tid: 0, lat: pos.lat, lon: pos.lon, alt: pos.alt ?? null, world, since: this.now(),
      ceiling: Number.isFinite(pos.ceiling) ? pos.ceiling : null,
      // Not somewhere new: the same spot, so the guard it left with stands.
      blinkUntil: player.blinkUntil,
    };

    this.send(client, {
      t: 'auth',
      ok: true,
      token,
      you: { id: player.id, name: player.name, colour: player.colour, admin: player.admin },
      world,
      pos,
      health: player.health,
      oxygen: player.oxygen,
      rockets: this.rocketsNow(record),
      // Seconds until a surge is allowed again. Its clock is the account's
      // (carried, above), but a reload, a second tab or a trip to another
      // world starts the page's afresh: told nothing, it offered a surge the
      // server was still recharging, and put the pilot back for flying it.
      // One still on ends with the first state, which does not ask for it.
      surgeIn: player.surge.on ? SPEED_MODE_COOLDOWN_S : Math.max(0, Math.ceil((player.surge.readyAt - this.now()) / 100) / 10),
      spawn,
      explored: live.explored.encode(),
      trail: live.trail.legs,
      waypoints: live.waypoints,
      lander: live.lander,
      stats: record.stats,
      rules: {
        pvp: !!this.config.pvp,
        spawnProtectionM: this.config.spawnProtectionM,
        tpaTimeoutS: TPA_TIMEOUT_S,
        rtpCooldownS: this.config.rtpCooldownS,
      },
      iceServers: this.config.iceServers,
      server: this.publicInfo(),
    });
    this.send(client, { t: 'roster', players: [...this.players.values()].map((p) => this.rosterEntry(p)) });
    this.broadcast({ t: 'join', p: this.rosterEntry(player) }, { except: player });

    const travelled = this.travelling.get(player.key);
    this.travelling.delete(player.key);
    const arriving = !!travelled && this.now() - travelled.at < TRAVEL_GRACE_MS;
    if (arriving) {
      if (travelled.world !== world) this.announce(`${player.name} arrived on ${BODIES[world].name}`, { kind: 'travel' });
    } else {
      this.announce(`${player.name} joined${world !== 'earth' ? ` on ${BODIES[world].name}` : ''}`, { kind: 'join', except: player });
      this.tell(player, `Welcome to ${this.config.name}. ${this.config.motd}`);
    }
    // A change of world is a reload, not a coming and going: friends are not
    // told twice that you left and came back.
    this.social.onJoin(player, { quiet: arriving });
  }

  rosterEntry(p) {
    return { id: p.id, name: p.name, colour: p.colour, world: p.world, admin: p.admin, dead: p.dead };
  }

  disconnect(client, { quiet = false, replaced = false } = {}) {
    if (!this.clients.has(client)) return;
    this.clients.delete(client);
    const player = client.player;
    if (!player) return;
    client.player = null;
    if (this.players.get(player.id) !== player) return;
    const travelling = this.travelling.get(player.key);
    const moving = !!travelling && this.now() - travelling.at < TRAVEL_GRACE_MS;
    // Leaving in the middle of a fight is losing it, as on most PvP servers:
    // otherwise closing the tab was the way out of every fight going badly.
    // The kill goes to whoever hit you last. Not when it is this account
    // signing in again somewhere else - the fight carries over to the new
    // connection - nor when the server itself is stopping.
    if (!replaced && !moving && !this.stopping && !player.dead && this.inCombat(player)) {
      const by = this.lastAttacker(player);
      this.kill(player, 'fled', by);
      player.combatUntil = 0;
      this.social.social(player.key).notices.push({
        text: by
          ? `You left in the middle of a fight with ${by.name}, which counts as dying`
          : 'You left in the middle of a fight, which counts as dying',
        kind: 'system',
      });
    }
    this.players.delete(player.id);
    if (this.byKey.get(player.key) === player) this.byKey.delete(player.key);
    // The clocks belong to the account, not the connection. Reloading the page
    // used to wipe the combat tag and every cooldown — and travelling always
    // reloads, so the travel cooldown never applied at all.
    this.carried.set(player.key, {
      at: this.now(),
      combatUntil: this.combatEnds(player),
      lastRtpAt: player.lastRtpAt,
      lastSpawnAt: player.lastSpawnAt,
      lastTravelAt: player.lastTravelAt,
      lastLanderAt: player.lastLanderAt,
      lastHurtAt: player.lastHurtAt,
      // Who you were fighting, with the fight: a second tab of your own took
      // the tag over but not the name, and leaving from there was a death
      // nobody was credited with.
      lastHitBy: player.lastHitBy,
      surge: player.surge,
      lastAttackAt: player.lastAttackAt,
      lastSwingAt: player.lastSwingAt,
      blinkUntil: player.blinkUntil,
    });
    this.remember(player);
    player.record.stats.playSeconds += Math.round((this.now() - player.joinedAt) / 1000);
    this.saveRecord(player.record);
    // On disk now, not at the next half-minute save: a server stopped hard —
    // a host's machine restarting, a container killed — keeps everything up
    // to the moment each player left.
    this.store.flush();
    for (const [id, request] of this.requests) {
      if (request.from === player || request.to === player) this.endRequest(id, 'left', player);
    }
    this.broadcast({ t: 'leave', id: player.id });
    if (!quiet && !moving) {
      this.announce(`${player.name} left`, { kind: 'leave' });
    }
    this.social.onLeave(player, { quiet: moving });
  }

  /** Copy what is live about a player into their lasting record. */
  remember(player) {
    const live = player.record.on(player.world);
    if (player.state && !player.pending) {
      live.pos = {
        lat: player.state.lat,
        lon: player.state.lon,
        alt: player.state.alt,
        yaw: player.state.yaw,
        flying: !(player.state.flags & FLAG.ground),
        // The height the server would let a fall count from here, which is
        // not the same as the height (see arrive) - and no higher than where
        // you are: a height you climbed to once and came down from is one
        // you have spent. Saved as the all-time highest, it let a player who
        // climbed thirty kilometres one day fall them again after every sign-in.
        ceiling: Number.isFinite(player.ceiling) ? Math.min(player.ceiling, player.state.alt) : null,
      };
    }
    // Leaving while dead is not a way out of dying: you come back where the
    // respawn would have put you, not where you fell.
    if (player.dead) {
      const at = this.respawnPoint(player);
      live.pos = { lat: at.lat, lon: at.lon, flying: false };
    }
    player.record.world = player.world;
    player.record.health = player.dead ? MAX_HEALTH : player.health;
    player.record.oxygen = player.dead ? OXYGEN_SECONDS : player.oxygen;
    this.saveRecord(player.record);
  }

  isBanned(address) {
    return Object.values(this.bans).some((ban) => ban.address && ban.address === address);
  }

  /* ---------------------------------------------------------- movement */

  /**
   * The fastest a player may fly on this world, outside a surge.
   *
   * Across the ground and upwards (see onState); a fall, however fast, does
   * not count. The fastest honest flight on rockets alone is a Rocket V held
   * on a climb, 143 m/s on Earth. What is faster is a glide in thin air,
   * which the flight model lets reach the world's terminal speed and no
   * further (stepGlide): on Mars that is 378 m/s. And anywhere, speed you
   * fell for or came out of a surge with, which is not a number per world
   * but an account kept per player: see fallReserve. tools/flightcheck.mjs
   * flies every world against all of it.
   */
  maxSpeed(world) {
    const base = this.config.maxSpeed ?? 180;
    const body = BODIES[world];
    const glide = body && body.id !== 'earth' ? terminalSpeed(body) : 0;
    return Number.isFinite(glide) ? Math.max(base, glide * GLIDE_ROOM) : base;
  }

  /**
   * The limit in a surge worth `factor` (1 out of one). SURGE_ALLOWANCE is
   * what a surge does to a rocket - every tick stretched and the push with
   * it - so it multiplies the rockets' limit; a glide at a thin-air world's
   * terminal speed is only stretched, by the page's own factor. Multiplying
   * Mars's 490 by five and a half allowed 2,700 m/s in a surge where the
   * fastest honest one, a long glide down and then the surge, made 1,170.
   */
  surgedSpeed(world, factor) {
    const rockets = (this.config.maxSpeed ?? 180) * factor;
    const stretch = 1 + ((factor - 1) * (SURGE_FACTOR - 1)) / (SURGE_ALLOWANCE - 1);
    return Math.max(rockets, this.maxSpeed(world) * stretch);
  }

  /**
   * How many times the limit a surge is worth right now.
   *
   * A surge multiplies how far each tick carries you and a rocket's push with
   * it, so a Rocket V lit inside one covers well over six hundred metres a
   * second, and honestly (SURGE_ALLOWANCE). The page says when it is surging; the server holds it to the
   * rules the page keeps — twelve seconds, then thirty to recharge — so the
   * flag cannot simply be left on. After a surge the extra fades as slowly as
   * the page lets it: with a firework still burning.
   */
  surgeFactor(player, flags, now) {
    const surge = player.surge;
    const asking = !!(flags & FLAG.surge);
    if (asking && !surge.on && now >= surge.readyAt) {
      surge.on = true;
      surge.prevEndedAt = surge.endedAt;
      surge.rockets = 0;
      // Seen first on the state that ends a gap, or in the backlog behind it,
      // it began as far as anyone can tell when the gap did - and its twelve
      // seconds are counted from there. Counted from here, a page that went
      // quiet for ten seconds around each surge was lent the quiet at five
      // and a half times the limit, and a surge lasted half a minute.
      // But no earlier than the page could have started it. The backlog is
      // the states arriving in the same moment as the one before them, as
      // onState counts it, and the page sent every one of them without the
      // flag: a surge first seen behind them began after the last of them
      // was sent, and dated back to the start of a nine-second stall it
      // ended seven seconds before the page's did. It may still have been
      // held - a socket can let its backlog go in more than one piece, the
      // rest a moment later or a fifth of a second after - so one seen first
      // a moment after the backlog, or in a later piece of it, is dated back
      // by no more than the grace a surge's end has, which never costs an
      // honest surge its last seconds. One a second later is the page's own
      // from there. And never into the recharge it waited out.
      // In a later piece of a hold (heldPiece) it may have begun as soon as
      // the hold did - back by no more than that same grace. Dated from the
      // piece before it landing, a surge begun a second into a two-second
      // stall lost that second of itself, and the page was put back.
      const gapMs = now - player.lastStateAt;
      const burst = player.burst;
      const inBurst = burst && now <= burst.until;
      const sameMoment = gapMs < BACKLOG_GAP_S * 1000;
      const graced = (gapFrom, hold) => (hold === undefined ? gapFrom : Math.min(gapFrom, Math.max(hold, now - SURGE_GRACE_S * 1000)));
      let from = now;
      if (gapMs >= BURST_GAP_S * 1000) {
        const piece = this.heldPiece(player, now);
        from = graced(player.lastStateAt, piece && (piece.shown || piece.bunched) ? piece.hold ?? piece.from : undefined);
      } else if (inBurst && sameMoment && now - burst.at < BURST_SETTLE_MS) from = graced(burst.from, burst.hold);
      else if (inBurst && (sameMoment || now - burst.at < BURST_SETTLE_MS)) from = Math.max(burst.shown ? burst.hold : burst.from, now - SURGE_GRACE_S * 1000);
      surge.since = Math.max(from, surge.readyAt);
      surge.states = 0;
    }
    if (surge.on) {
      surge.states = (surge.states ?? 0) + 1;
      if (flags & FLAG.rocket) surge.rockets += 1;
    }
    if (surge.on && (!asking || now - surge.since > (SPEED_MODE_SECONDS + SURGE_GRACE_S) * 1000)) {
      surge.on = false;
      surge.endedAt = now;
      surge.readyAt = now + (SPEED_MODE_COOLDOWN_S - SURGE_GRACE_S) * 1000;
      // Rockets push 2.4 times as hard in a surge, so you come out of one
      // going up to 2.4 times a Rocket V's cruise - and where there is no air
      // nothing ever takes that away again. Kept like a fall's speed is, and
      // faded by the air the same way (see fadeReserve) - for a surge that had
      // rockets lit in it, and as much of it as the surge ran: a page that
      // flicked the flag on for one state came out with all of it.
      const ran = Math.min(now, surge.since + (SPEED_MODE_SECONDS + SURGE_GRACE_S) * 1000) - surge.since;
      const share = Math.max(0, Math.min(1, ran / (SPEED_MODE_SECONDS * 1000)));
      // A rocket kept burning through it: one flagged state in a twelve-second
      // surge earned the lot. An honest pilot's are lit back to back.
      const lit = Math.min(1, surge.rockets / Math.max(1, surge.states) / SURGE_ROCKET_SHARE);
      player.surgeKept = Math.max(player.surgeKept ?? 0, SURGE_KEPT_SQ * share * lit);
    }
    return this.factorAt(surge, now);
  }

  /**
   * What the surge was worth at a moment, from its timeline alone - for the
   * seconds a gap covers, which the state that ends it does not speak for.
   */
  factorAt(surge, t) {
    const bleed = (from) => 1 + (SURGE_ALLOWANCE - 1) * Math.exp((-SURGE_BLEED_PER_S * Math.max(0, t - from)) / 1000);
    if (!(t >= surge.since)) return bleed(surge.prevEndedAt ?? -Infinity);
    const stop = Math.min(surge.on ? Infinity : surge.endedAt, surge.since + (SPEED_MODE_SECONDS + SURGE_GRACE_S) * 1000);
    return t <= stop ? SURGE_ALLOWANCE : bleed(stop);
  }

  /** The limit averaged over [from, to], by the surge's timeline. */
  averageLimit(surge, from, to, limitFor) {
    const STEPS = 8;
    let sum = 0;
    for (let i = 0; i < STEPS; i++) sum += limitFor(this.factorAt(surge, from + ((to - from) * (i + 0.5)) / STEPS));
    return sum / STEPS;
  }

  /**
   * The burst whose hold a state's gap goes on with, if it does. A socket that
   * held states back can let them go in more than one piece - the first when
   * the hold ends, the rest half a second or a second after, behind another
   * loss - and the states in a later piece were sent during the hold, not
   * after it. A gap of a quarter second or more that began as a burst's last
   * state landed, within the two seconds a stall's travel is lent, in a hold
   * by then longer than the allowance covers and no longer than a stall is
   * caught up on, is that hold going on. It counts as one (onState,
   * surgeFactor) only once the socket has shown it was holding states, with
   * a backlog in a piece before or in this one: a page sending once a second
   * sends nothing behind each state. `hold` on a burst that goes on with
   * one is when the hold began, and `shown` that it has shown it.
   */
  heldPiece(player, now) {
    const held = player.burst;
    if (!held || now > held.until || player.lastStateAt !== held.last || now - held.last < BURST_GAP_S * 1000) return null;
    const hold = held.hold ?? held.from;
    if (now - hold <= CATCH_UP_AFTER_S * 1000 || now - hold > CATCH_UP_MAX_S * 1000) return null;
    return held;
  }

  /**
   * Speed a fall has given you, as the square of it: what the limit is
   * raised by. See onState.
   *
   * Where there is no air nothing takes speed away. A dive on the Moon goes on
   * getting faster for as long as there is height to fall, and a rocket turns
   * that speed wherever you look without losing any of it (stepRocket: a
   * firework has no brakes) - so an honest pilot who climbed thirty
   * kilometres and dived came back across the ground at 300 m/s, and on
   * Mercury at 760, against a limit of 180. No one number is right for that:
   * how fast you can honestly go depends on how far you have fallen. So the
   * server keeps the account the flight model keeps - energy. Every metre you
   * fall adds 2gh to what the limit allows, every metre you climb takes it
   * back, and air takes it away over seconds as the glide's drag does.
   *
   * It is a fall the server saw, from a height it accepted. Height is taken
   * as given for half a minute after arriving (the ground loading in under
   * you), but only up to where the server sent you - no higher than you, or
   * whoever you were sent to, earned and still have - or, sent with no height
   * (a respawn, a random teleport), a kilometre over the world's highest
   * ground. A page that said it arrived thirty kilometres up does not get to
   * fall from there, nor does one that saved that height and signed in
   * again, or a friend who teleported to it; a height climbed once and come
   * down from is spent. Nothing below the world's lowest ground counts.
   */
  fallReserve(player, body, last, s, settled, now) {
    const [lowest, highest] = body.reach ?? [-11000, 9000];
    // Settled, a climb is counted, and so raises the ceiling - but only by the
    // climb itself when it starts from a height that was never earned, or
    // waiting out the half minute would make wherever the page said it was
    // the ceiling. In the half minute a climb is not held to the limit, since
    // the ground loading in stands you up at once - but climbing a flight
    // could have done is earned just the same (an honest pilot who rocketed
    // up the moment they arrived had nothing to fall from afterwards), and a
    // jump no flight makes stands you up only as far as the arrival allows
    // (arrive). What a flight could have done is counted over the time since
    // arriving, at the limit the surge allowed then - per state, a page
    // sending thirty small climbs a second reached forty-four kilometres,
    // while an honest surge climb's bigger steps were refused the height.
    const rise = Math.max(0, s.alt - last.alt);
    let flown = settled;
    if (!settled && rise > 0) {
      const elapsed = Math.max(0, now - player.arrivedAt);
      const could = (this.averageLimit(player.surge, player.arrivedAt, now, (f) => this.surgedSpeed(player.world, f)) * elapsed) / 1000;
      flown = (player.graceRise ?? 0) + rise <= could * GRACE_CLIMB_ROOM + SPEED_SLACK_M;
      if (flown) player.graceRise = (player.graceRise ?? 0) + rise;
    }
    if (!flown) player.ceiling = Math.max(player.ceiling, Math.min(s.alt, player.arrivalCap ?? highest + ARRIVAL_CEILING_M));
    else if (last.alt <= player.ceiling) player.ceiling = Math.max(player.ceiling, s.alt);
    else player.ceiling += rise;
    // Down to the world's lowest ground and no further: nobody falls below it.
    const fell = Math.min(last.alt, player.ceiling) - Math.max(s.alt, lowest);
    if (fell > 0) player.reserve += 2 * flightGravity(body) * fell;
    // Through air a fall gathers speed only up to what the air lets a faller
    // reach - the glide maxSpeed allows for already. Thick air takes the rest
    // away within seconds anyway (fadeReserve); Mars's is so thin that its
    // fade takes minutes, and a fall from Olympus Mons into Hellas was good
    // for 1,100 m/s for minutes where the game's own air holds a faller under
    // 400.
    const glide = body.id !== 'earth' && aeroFactor(body) > 0 ? terminalSpeed(body) * GLIDE_ROOM : Infinity;
    if (Number.isFinite(glide)) player.reserve = Math.min(player.reserve, glide * glide);
    return player.reserve + player.surgeKept;
  }

  /**
   * What time takes from the reserve: the air, over seconds, and anything not
   * being used. Kept whether or not the move that brings it is: a refused move
   * put the whole account back, the air's share too, and a page refused over
   * and over held a fall's speed on Earth for two minutes.
   *
   * Speed you are not using you no longer have. With no air nothing takes it
   * away in flight - rockets have no brakes, so the only ways to lose it are
   * climbing (paid for in onState) and landing (which clears it) - so a page
   * keeping a reserve while it dawdles never had it: one hovering below the
   * ground after a fall it only claimed kept 560 m/s on the Moon for as long
   * as it liked. Measured over a second or more, against half of what the
   * reserve would allow.
   *
   * Measured to the right state, though. A socket that holds states back
   * delivers the first of them seconds late, carrying a quarter of a second of
   * travel, with the rest in the same millisecond behind it: judged on that
   * first one, an honest pilot sending four states a second read as standing
   * still and lost a third of a dive's speed at every hold. So time is judged
   * a bunch at a time - a state and the backlog behind it - once the bunch is
   * over, to its last state, the freshest the socket let go. A page cannot
   * keep time from being judged by when it sends: every second goes in
   * (`fadePool`) and is judged with whatever comes next.
   *
   * Except a pause: a gap with nothing behind it, in a page that is not
   * sending slowly - fewer than three gaps in two seconds. Nothing was sent in
   * it because the game was not running: a frame that took that long to draw,
   * which flies up to a second and a half of it once it is drawn
   * (PAGE_CATCH_UP_S), or a tab in the background, where the game stops and
   * flies none of it on coming back - it starts its clock again
   * (src/game.js) - and the flight goes on at the speed it had. What the page
   * did not fly is not judged, and is left out of the time a later second is
   * measured over (`live`), so that second reads the speed actually flown.
   * A page back from the background says so on its first state (FLAG.woke),
   * and that gap is a pause however the socket brings it and whatever gaps
   * came before it: judged as a frame, a second and a half flown, two tab
   * switches two seconds apart cost an honest pilot on the Moon a third of a
   * dive's speed, and three put it back - and a hitch or a late state in the
   * five seconds before took the place of the one pause there that was left
   * out whole. Left out whole, a pause every
   * second between a few states sent at ten a second was time nobody judged,
   * and what was flown in it read as flown in the tenths around it: a page
   * crawling at a sixth of what keeps a dive's speed kept all of it. So it is
   * left out whole only when the page is sending once a second anyway, or
   * says it woke and has not said so more than once in the ten seconds
   * before; any other only for what was longer than a frame flies. A page
   * that has never said it woke - one older than the flag - has the first
   * pause in five seconds left out whole instead, as it always had. A
   * page that is slow is judged across all its gaps: taking out every gap
   * of a second or more let one hovering on a rhythm of long and short gaps
   * keep some of what only the short ones were judged on.
   * Sending once a second keeps a reserve for as long as you like, as a tab in
   * the background does; see HOSTING.md, "What it cannot check".
   *
   * @param {boolean} backlog this state arrived in the same moment as the one before, behind a gap
   * @param {boolean} [woke] the page says this is its first state back from the background
   */
  fadeReserve(player, body, dt, backlog, now, woke = false) {
    const air = aeroFactor(body);
    let fade = air > 0 ? Math.exp((-dt * air) / RESERVE_FADE_S) : 1;
    const bunch = player.fadeBunch;
    // While a stall's bunch waits to be judged (below), states arriving in
    // the same moment are one bunch, however long after the stall they come.
    if (backlog || (player.fadeHeld && now - player.lastStateAt < BACKLOG_GAP_S * 1000)) {
      if (bunch) {
        bunch.lone = false;
        // Back from the background behind states a stall held from before
        // the tab was hidden: the same pause, the gap the bunch ended.
        if (woke && bunch.gapMs >= BURST_GAP_S * 1000) bunch.woke = true;
      }
      player.fadePool += dt;
    } else {
      // The bunch before this state is over. A pause is taken out first:
      // all of it from a page sending once a second, or one back from the
      // background with no more than one other in the ten seconds before
      // (from a page that never says so, the first in five seconds); from
      // any other, only what was longer than a frame flies.
      const end = player.history.at(-1);
      if ((bunch?.lone && bunch.pause) || bunch?.woke) {
        const first = !player.saidWoke && bunch.lone && bunch.pause
          && bunch.at - (player.lastPauseAt ?? -Infinity) >= PAUSE_APART_S * 1000;
        const woken = bunch.woke && bunch.at - (player.prevWokeAt ?? -Infinity) >= 2 * PAUSE_APART_S * 1000;
        const whole = (bunch.lone && bunch.slow) || first || woken;
        const flown = whole ? 0 : PAGE_CATCH_UP_S;
        const slept = Math.max(0, bunch.gapMs - flown * 1000);
        player.fadePool = Math.max(0, player.fadePool - Math.max(0, bunch.dt - flown));
        player.pausedMs += slept;
        // The pause's own state, and any its socket brought with it.
        for (const h of player.history) if (h.t >= bunch.at) h.live -= slept;
        if (bunch.lone && bunch.pause) player.lastPauseAt = bunch.at;
        if (bunch.woke) {
          player.prevWokeAt = player.wokeAt ?? -Infinity;
          player.wokeAt = bunch.at;
        }
      }
      // Then it is judged - unless it is a stall's backlog, a bunch with
      // states behind it after a gap the catch-up lends for, and not one the
      // page woke from: that is judged with the bunch after it, once, from
      // the bunch judged before the stall. A socket can let a stall go in
      // more than one piece, and the first holds only what was sent before
      // it held again - judged on its own, two seconds that brought half a
      // second of travel, an honest dive read as standing still and lost two
      // fifths of its speed. From before the stall, not from a state inside
      // it, or what came after would be all that was judged.
      const held = !player.fadeHeld && !!bunch && !bunch.lone && !bunch.woke && bunch.gapMs > CATCH_UP_AFTER_S * 1000;
      if (!held) {
        // From a second before it - or, where the history no longer reaches
        // that far back, from the end of the bunch judged before it: the
        // history keeps a second and a half, so a page sending a state every
        // nine tenths of a second never had one a second old to be judged by,
        // and kept a fall's speed hovering, and a bunch after a long hold has
        // nothing in it but itself.
        const second = end && before(player.history, end.t - 1000);
        const back = player.fadeHeld ? player.fadeBack ?? second : second ?? player.fadeBack;
        if (back && back !== end) {
          if (player.reserve + player.surgeKept > 0) {
            const span = Math.max(0.1, (end.live - back.live) / 1000);
            const across = separation({ lat: back.lat, lon: back.lon, alt: end.alt }, end, radiusOf(player.world));
            const going = Math.hypot(across, end.alt - back.alt) / span;
            const allowed = Math.sqrt(this.maxSpeed(player.world) ** 2 + RESERVE_MARGIN * (player.reserve + player.surgeKept));
            if (going < allowed * UNUSED_FRACTION) fade *= Math.exp(-player.fadePool / UNUSED_FADE_S);
          }
          player.fadePool = 0;
        }
        if (end) player.fadeBack = end;
      }
      player.fadeHeld = held;
      // With nothing to judge it by yet - just after arriving - it waits.
      player.fadePool = Math.min(CATCH_UP_MAX_S, player.fadePool + dt);
      const gapMs = now - player.lastStateAt;
      const long = gapMs >= BURST_GAP_S * 1000;
      const pause = long && player.gapTimes.length < 3;
      // Sending once a second: the state before came after a pause too. A
      // page saying it woke does not make itself one: that is two in ten
      // seconds, and saying it of every state four times a second kept a
      // reserve hovering as only a page sending once a second may.
      const slow = pause && !!(bunch?.lone && bunch.pause);
      player.fadeBunch = { at: now, dt, gapMs, lone: true, pause, slow, woke: woke && long };
    }
    // From now on only what it says it woke from: see `first` above.
    if (woke) player.saidWoke = true;
    player.reserve *= fade;
    player.surgeKept = (player.surgeKept ?? 0) * fade;
  }

  onState(player, m) {
    const s = decodeState(m);
    if (!s) return;
    const now = this.now();
    if (player.pending) {
      // Waiting for the page to arrive somewhere the server sent it. Anything
      // it says before then is about where it was, which no longer matters.
      if (!player.pending.arrived) return;
      const from = { lat: player.pending.lat, lon: player.pending.lon, alt: s.alt };
      // The page lands where it was sent and says so with its very next
      // state, so anywhere else is a page that went somewhere else first.
      if (separation(from, s, radiusOf(player.world)) > ARRIVAL_SLACK_M) {
        // It says it arrived and it is somewhere else: put it where it was sent.
        this.correct(player, player.pending);
        return;
      }
      // Arrived exactly where it was sent, whatever the slack let it say:
      // the page lands on the spot itself (Game.teleportTo), and the slack
      // taken as a move was one nobody judged. Signing in arrives too, and
      // costs a page that keeps a socket open nothing but a message - so a
      // page that signed in again and again went four hundred metres each
      // time, thousands of metres a second, and arrived beside somebody it
      // had been hovering out of reach of, sword swinging. The height too,
      // when it was sent one: a page sent into the air arrives at it (or
      // higher, over ground it has higher there), and one sent to stand
      // stands on whatever ground it has, which may not have loaded yet -
      // so going from there to where it says it is is a move, judged from
      // the spot with its next state (the blink guard, below), and not
      // the page's word: a page that signed in again three kilometres over
      // somebody said it had arrived at their height, sword swinging.
      const { lat, lon, alt } = player.pending;
      this.arrive(player, { ...s, lat, lon, alt: Number.isFinite(alt) ? alt : s.alt }, now);
      return;
    }
    if (player.dead) {
      // A dead player stays where they fell until they respawn.
      return;
    }
    // A page sends ten a second. Far more than that is not a page — and each
    // accepted message used to come with its own few metres of grace, so a
    // flood of tiny steps added up to ten times the speed limit. Counted as
    // a bucket that fills while the page is quiet, not per second: after a
    // stall a page delivers everything it held at once, and a cap of thirty
    // in any one second threw half of a six-second stall away - and the move
    // after the gap was then four seconds of travel in one.
    const tokens = Math.min(MAX_STATES_PER_S * CATCH_UP_MAX_S,
      (player.stateTokens ?? MAX_STATES_PER_S) + ((now - (player.stateTokensAt ?? now)) / 1000) * MAX_STATES_PER_S);
    player.stateTokensAt = now;
    if (tokens < 1) {
      player.stateTokens = tokens;
      return;
    }
    player.stateTokens = tokens - 1;
    const last = player.state;
    if (last) {
      const gap = Math.max(0.001, (now - player.lastStateAt) / 1000);
      const dt = Math.min(2, gap);
      const radius = radiusOf(player.world);
      const body = BODIES[player.world];
      // Across the ground, and upwards once the ground has had time to arrive
      // under you. The server has no terrain, so it cannot tell a climb from
      // the ground arriving under you: a player teleported onto a mountain
      // lands at nought until the heights load, then stands up two kilometres
      // at once — honestly. So height counts only from half a minute after
      // you arrive, and only going up: a fall, however fast, is free.
      const ground = separation({ lat: last.lat, lon: last.lon, alt: s.alt }, s, radius);
      const settled = now - player.arrivedAt > ARRIVAL_GRACE_S * 1000;
      const climb = settled ? Math.max(0, s.alt - last.alt) : 0;
      const moved = Math.hypot(ground, climb);
      // On your feet you are held to walking pace, a little after landing:
      // a glide is still sliding to a stop for a moment once it touches down.
      // Counted from the first state on the ground, not the last one in the
      // air: after a socket held states back, the one it touched down on
      // arrives seconds behind the last one flying - its move flown at the
      // speed of the dive - and was judged at walking pace.
      const onFoot = (s.flags & (FLAG.ground | FLAG.swim)) && !(s.flags & FLAG.elytra);
      const wasOnFoot = (last.flags & (FLAG.ground | FLAG.swim)) && !(last.flags & FLAG.elytra);
      if (!onFoot || !wasOnFoot) player.airborneAt = now;
      const walking = onFoot && now - player.airborneAt > LANDING_GRACE_S * 1000;
      // The hold this state's gap goes on with (heldPiece), worked out
      // before the state starts a burst of its own.
      const piece = gap >= BURST_GAP_S ? this.heldPiece(player, now) : null;
      // Where the page was before a gap, and how fast it was falling there,
      // while the history still has it (the burst check below): a later piece
      // of a hold keeps the one from before the hold.
      if (gap >= BURST_GAP_S && !piece) {
        const end = player.history.at(-1);
        const earlier = end && before(player.history, end.t - 500);
        player.gapBack = end && { t: end.t, lat: end.lat, lon: end.lon, alt: end.alt,
          falling: earlier ? Math.max(0, earlier.alt - end.alt) / Math.max(0.5, (end.t - earlier.t) / 1000) : 0 };
      }
      const factor = this.surgeFactor(player, s.flags, now);
      const surged = player.surge.on && player.surge.states === 1;
      // What a fall has given you to spend. See fallReserve. The fade is
      // time's and stands; the fall is kept only if the move is: a refused
      // one is put back, and so is what it claimed to fall.
      // A gap's backlog is the states arriving with it, a few milliseconds
      // apart - not a live state a tenth of a second later. And three gaps in
      // two seconds is a page that is slow, not one pausing now and then.
      player.gapTimes = (player.gapTimes ?? []).filter((t) => now - t < 2000);
      if (gap >= BURST_GAP_S) player.gapTimes.push(now);
      const backlog = player.burst && now - player.burst.at < BURST_SETTLE_MS && gap < BACKLOG_GAP_S;
      this.fadeReserve(player, body, Math.min(CATCH_UP_MAX_S, gap), backlog, now, !!(s.flags & FLAG.woke));
      const account = [player.reserve, player.surgeKept, player.ceiling];
      const reserve = this.fallReserve(player, body, last, s, settled, now);
      // A surge stretches every tick 2.4 times, a fall's speed with the rest;
      // SURGE_ALLOWANCE is that and a rocket's push stretched too, which a
      // fall's speed is not. So the stretch on the reserve is the page's own.
      const limitFor = (f) => {
        if (walking) return GROUND_MAX_MPS * Math.min(f, SURGE_FACTOR);
        const stretch = 1 + ((f - 1) * (SURGE_FACTOR - 1)) / (SURGE_ALLOWANCE - 1);
        return Math.sqrt(this.surgedSpeed(player.world, f) ** 2 + stretch * stretch * RESERVE_MARGIN * reserve);
      };
      const limit = limitFor(factor);
      // What the gap before this state was worth: the limit over the time it
      // covers, not the limit of the state that ends it.
      const prevAt = player.lastStateAt;
      const gapLimit = gap >= BURST_GAP_S ? this.averageLimit(player.surge, prevAt, now, limitFor) : limit;
      // A leaky allowance rather than a per-message limit: networks deliver in
      // bunches, so two updates can arrive a millisecond apart carrying a
      // tenth of a second of travel each. The allowance fills at the speed
      // limit and a burst can spend what has built up; a cheat has to hold
      // the speed, and nothing legitimate does.
      // Capped at a second and a half saved, as a leaky bucket is. But a
      // hold close behind another - or a page sending a state a second
      // through one - is lent its time as it ends while part of that time's
      // travel comes with the next bunch, and capped there the page lost
      // what the gap before had lent it: a stall just after a hold, or a
      // surge begun inside a two-second one, was put back. So a gap of more
      // than a second and a half that began within two seconds of another
      // ending - one the catch-up covers, not ten seconds' quiet - keeps
      // what was saved on top of its own allowance, and until its backlog
      // has had time to arrive, what that leaves over the cap waits for the
      // bunches still to come: a gap in between adds its own time to it, and
      // only a live state, sent once the socket let go, is held to the cap
      // again. A single gap after a page sending ten a second keeps no more
      // than it ever did. A state in the backlog brings nothing new, and caps
      // nothing either: it is the gap's travel arriving.
      const cap = limit * 1.5;
      const over = now <= player.heldUntil && player.budget > cap;
      // What the cap throws away of a later piece's own time (heldPiece).
      let spilt = 0;
      if (gap >= BURST_GAP_S) {
        const close = player.lastGap && player.lastGap.at >= prevAt - CATCH_UP_MS && player.lastGap.gap < CATCH_UP_MAX_S;
        if (gap > CATCH_UP_AFTER_S && close) {
          player.budget = Math.min(cap, player.budget) + gapLimit * CATCH_UP_AFTER_S;
          player.heldUntil = now + CATCH_UP_MS;
        } else {
          const filled = player.budget + gapLimit * dt;
          player.budget = over ? filled : Math.min(cap, filled);
          if (piece) spilt = filled - player.budget;
        }
        player.lastGap = { at: now, gap };
      } else if (!backlog) {
        player.budget = Math.min(cap, player.budget + gapLimit * dt);
      }
      // A socket that went quiet for seconds and then delivers everything it
      // held at once: the first of them comes after the whole gap and the rest
      // in the same millisecond, carrying the gap's travel between them. The
      // allowance above only reaches a second and a half of it, so an honest
      // glide through a three-second stall was put back four times. The rest
      // of the gap is lent for a moment - no faster on average than the limit,
      // which is all the limit is.
      if (gap > CATCH_UP_AFTER_S) {
        // A later piece of a hold that has shown it is one keeps what the hold lent.
        const kept = piece && (piece.shown || piece.bunched) && now <= player.catchUpUntil ? player.catchUp : 0;
        player.catchUp = kept + gapLimit * (Math.min(CATCH_UP_MAX_S, gap) - CATCH_UP_AFTER_S);
        player.catchUpUntil = now + CATCH_UP_MS;
      } else if (now > player.catchUpUntil) {
        player.catchUp = 0;
      }
      // And the whole of a burst gets the fastest limit any state in it
      // earned. The allowance for the gap is worked out on the first state to
      // arrive, and the rest come in the same millisecond with nothing more:
      // a surge started while the socket was holding states back was judged
      // at the speed from before it, and a nine-second stall with a surge in
      // it put the page back thirty-nine times and disconnected it.
      // Worked out again over the gap's own time, with what is known now -
      // a surge first seen in the burst is dated back to the gap (surgeFactor),
      // and in a later piece of a hold into the hold.
      const regap = (burst) => {
        const then = this.averageLimit(player.surge, burst.from, burst.at, limitFor);
        if (then > burst.limit) {
          const more = then - burst.limit;
          player.budget += more * Math.min(2, burst.gap);
          if (burst.gap > CATCH_UP_AFTER_S) {
            player.catchUp += more * (Math.min(CATCH_UP_MAX_S, burst.gap) - CATCH_UP_AFTER_S);
            player.catchUpUntil = Math.max(player.catchUpUntil, now + CATCH_UP_MS);
          }
          burst.limit = then;
        }
      };
      // A later piece of a hold is the hold's time: what the cap threw away
      // of it is kept, up to what that hold lends in all past the second and
      // a half the allowance covers - so a page that has sent little of the
      // hold's travel yet keeps the time for the rest of it, and one that has
      // spent it all is filled no further than two gaps fill it. Once the
      // socket has shown it was holding states: then, or with the piece's own
      // backlog.
      const keep = (burst) => {
        const into = Math.max(0, Math.min(CATCH_UP_MAX_S, (burst.at - burst.hold) / 1000) - CATCH_UP_AFTER_S);
        player.budget += Math.max(0, Math.min(burst.owed, cap + burst.limit * into - player.catchUp - player.budget));
        burst.owed = 0;
        burst.shown = true;
      };
      if (gap >= BURST_GAP_S) {
        // `last` is when its last state arrived, the first or one in the
        // backlog behind it (`bunched`, once one has); `prev` the burst whose
        // hold it goes on with.
        player.burst = { at: now, from: prevAt, until: now + CATCH_UP_MS, gap, limit: gapLimit, last: now };
        if (piece) {
          piece.prev = null;
          Object.assign(player.burst, { prev: piece, hold: piece.hold ?? piece.from, owed: spilt });
          if (piece.shown || piece.bunched) {
            keep(player.burst);
            regap(piece);
          }
        }
      } else if (player.burst && now <= player.burst.until) {
        const burst = player.burst;
        if (backlog) {
          burst.last = now;
          burst.bunched = true;
          if (burst.prev && !burst.shown) keep(burst);
        }
        // On the burst's own states: the rest of it, in the same moment, and
        // one just behind it that a surge seen first in is dated back into
        // the gap (surgeFactor). A live state after them is the page's own,
        // and the limit it brings - a dive gathering speed - says nothing
        // about the gap's: worked out again on each, a page that kept a
        // dive's speed through a stall was lent a sliver of travel on every
        // state for two seconds after it, to spend first, and its sword did
        // not count.
        if (gap < BACKLOG_GAP_S || (surged && now - burst.at < BURST_SETTLE_MS)) {
          regap(burst);
          if (burst.prev && burst.shown) regap(burst.prev);
        }
      }
      const room = player.budget + player.catchUp + SPEED_SLACK_M;
      if (moved > room) {
        // Refused, but heard: the next state's allowance is from now. Leaving
        // the clock where it was gave the next one the same seconds again, and
        // a page asking for 400 m/s held 250 of it by being refused every
        // third state.
        player.lastStateAt = now;
        [player.reserve, player.surgeKept, player.ceiling] = account;
        // What the page sent before it could have heard the last correction
        // is refused with it, not counted again: a backlog arriving after a
        // stall is all from before, and each one counted towards the kick.
        if (now - player.correctedAt < CORRECTION_HEARD_MS + Math.min(player.rtt, RTT_HEARD_MAX_MS)) return;
        player.violations += 1;
        if (player.violations >= KICK_AFTER_VIOLATIONS) {
          this.kick(player, 'Moving impossibly fast');
          return;
        }
        // On your feet and only the height is out: the ground loading in
        // finer under you, most likely. Putting you back down would be into
        // the rock, so it stands - but it is counted, it is no height to fall
        // from (the ceiling stays where it was), and a page that keeps
        // standing up kilometres at a time is let go like any other.
        if (!(walking && ground <= room)) {
          player.blinkUntil = now + BLINK_GUARD_MS;
          player.correctedAt = now;
          this.correct(player, last);
          return;
        }
        player.budget = -SPEED_SLACK_M;
        player.catchUp = 0;
      } else {
        // The slack is lent, not given: it comes off the next allowance. What
        // a stall lent goes first - and a move that needed it is not one to
        // land a hit with: a pause is a stall as far as the server can tell,
        // and ten seconds quiet then one state beside somebody was a blink
        // across a field that the guard below, timing it from before the
        // pause, never saw.
        const lent = Math.min(player.catchUp, moved);
        player.catchUp -= lent;
        if (lent > 0) player.blinkUntil = now + BLINK_GUARD_MS;
        player.budget = Math.max(-SPEED_SLACK_M, player.budget - (moved - lent));
        player.violations = Math.max(0, player.violations - 0.05);
      }
      // Height bought with the reserve is paid for out of it - every metre of
      // it, in the arrival's half minute too, where a climb is not held to the
      // limit: free there and still earning on the way down, a page bouncing
      // between the ground and a kilometre over the highest peak banked a fall
      // of twenty kilometres every second. And the ground stops you dead:
      // walking, nothing a fall or a surge gave is left.
      const rose = Math.max(0, s.alt - last.alt);
      if (rose > 0) {
        const cost = 2 * flightGravity(body) * rose;
        const fromFall = Math.min(player.reserve, cost);
        player.reserve -= fromFall;
        player.surgeKept = Math.max(0, player.surgeKept - (cost - fromFall));
      }
      if (walking) {
        player.reserve = 0;
        player.surgeKept = 0;
      }
      // A burst: further in the last half second than the limit carries you.
      // The allowance lets a page that stood still a moment spend it all at
      // once - which honest play never does, and which is the reach a sword
      // needs to land from across a field. Allowed as movement; not as a hit.
      // Down too, flying: a fall is free to make, but it gathers speed as falls
      // do. Dropping five kilometres in one state onto somebody below was a
      // critical hit out of a clear sky. So a drop faster than the page was
      // already dropping counts, the extra against the limit like any other
      // move - while a dive keeping the speed it has counts nothing, however
      // fast, or every honest dive on the Moon would be a blink.
      // Up and down whatever the page says it is doing, and in the arrival's
      // half minute too. A climb the server lets stand without judging it -
      // the ground loading in under you, there or on your feet - is no way to
      // arrive beside somebody either, and the flags are the page's word: a
      // page "standing" or "swimming" five kilometres up dropped onto a
      // victim (critically, swimming), stood up into one flying overhead, and
      // in any arrival's first half minute - signing in again is one - did
      // both. An honest page stood up by the ground has 0.8 s without a hit.
      // Just after arriving there is no half second behind to measure from,
      // so the arrival is where it starts: measured only from half a second
      // back, a page that signed in again three kilometres over somebody
      // dropped onto them a tenth of a second later. After a gap there is
      // none either - the history keeps a second and a half, and a quiet
      // spell longer than that goes from it with the first state after it -
      // so it is measured from the last state before the gap, at the rate it
      // was falling there: a page that hovered over somebody, went quiet a
      // second and a half, sent a state or two and then dropped five
      // kilometres onto them landed a critical hit out of a clear sky, and a
      // fall moves nothing across, so no lent travel was spent either. From
      // before the gap, not from a state inside it: the states a stall held
      // back carry its travel, which is no faster than the limit over the
      // gap's own time.
      const back = before(player.history, now - 500)
        ?? (now - player.arrivedAt < 500 ? player.history[0] : null)
        ?? player.gapBack;
      if (back) {
        const span = Math.max(0.5, (now - back.t) / 1000);
        const across = separation({ lat: back.lat, lon: back.lon, alt: s.alt }, s, radius);
        const up = Math.max(0, s.alt - back.alt);
        let sooner = 0;
        if (back.alt > s.alt) {
          const earlier = back.falling === undefined && before(player.history, back.t - 500);
          const falling = back.falling ?? (earlier ? Math.max(0, earlier.alt - back.alt) / Math.max(0.5, (back.t - earlier.t) / 1000) : 0);
          sooner = Math.max(0, back.alt - s.alt - falling * span);
        }
        // The sudden drop over its own short time, not the whole gap: a fall
        // is free to make, and a page already falling keeps the speed it had
        // (sooner is nil for it, whatever the span), but a hit from a drop is
        // only as sudden as the page showed - so a page that hovered, went
        // quiet, and dropped five kilometres is held to what the limit carries
        // in a second and a half, not in the seconds it was silent.
        const dropSpan = Math.min(span, CATCH_UP_AFTER_S);
        if (Math.hypot(across, up, sooner) > limit * span + BLINK_SLACK_M
          || sooner > limit * dropSpan + BLINK_SLACK_M) player.blinkUntil = now + BLINK_GUARD_MS;
      }
    }
    player.lastStateAt = now;
    this.accept(player, s, now);
  }

  /**
   * The height a fall may count from beside a player, to send with somebody
   * teleported to them: what they earned and still have. Never nothing - a
   * missing ceiling arrived as "trust the height you were sent to", and a
   * host who had not yet arrived handed a visitor a fall from 199 km - but
   * the world's lowest ground, from which no fall counts at all.
   */
  spendableCeiling(host) {
    const lowest = BODIES[host.world]?.reach?.[0] ?? -11000;
    if (!host.state || !Number.isFinite(host.ceiling)) return lowest;
    return Math.max(lowest, Math.min(host.ceiling, host.state.alt));
  }

  /** Where the server sent the page is where it is now: back to normal rules. */
  arrive(player, s, now) {
    // Not the height it was sent to - that can be one a page only claimed,
    // its own in the half minute after it last arrived, saved and sent back
    // to it on the next sign-in, or a friend's it teleported to - but the
    // ceiling the server worked out for whoever was there. See fallReserve.
    const earned = Number.isFinite(player.pending?.ceiling) ? player.pending.ceiling : null;
    const sentAlt = Number.isFinite(player.pending?.alt) ? player.pending.alt : null;
    // The fight waited while nobody could hit it (inCombat).
    player.combatUntil = this.combatEnds(player);
    // Signing in again is the same spot, and keeps the guard it left with.
    const guard = player.pending?.blinkUntil ?? 0;
    player.pending = null;
    player.lastStateAt = now;
    player.arrivedAt = now;
    player.airborneAt = now;
    player.budget = 0;
    // Wherever it was in a hurry to before, it is somewhere new now and was
    // sent - unless it is the same spot.
    player.blinkUntil = guard;
    player.catchUp = 0;
    player.lastGap = null;
    player.heldUntil = 0;
    player.burst = null;
    // Nothing fallen yet, and the highest it may fall from is where it was
    // sent - no higher than was earned there - or, sent to the ground with no
    // height (a respawn, a random teleport), a kilometre above the highest
    // ground there is. And
    // as the ground loads in under it, it may stand up to no more than that:
    // a little over the height it was sent to, for ground that turns out
    // higher than it was. See fallReserve.
    const highest = BODIES[player.world]?.reach?.[1] ?? 9000;
    // A height sent with no ceiling (an older record's saved place) is held
    // to what a no-height arrival may stand up to.
    const trusted = earned ?? (sentAlt != null ? Math.min(sentAlt, highest + ARRIVAL_CEILING_M) : null);
    player.arrivalCap = sentAlt != null
      ? Math.min(sentAlt, trusted) + ARRIVAL_STAND_M
      : highest + ARRIVAL_CEILING_M;
    player.ceiling = Math.min(s.alt, player.arrivalCap, trusted ?? Infinity);
    player.graceRise = 0;
    player.reserve = 0;
    player.surgeKept = 0;
    player.fadePool = 0;
    player.fadeBunch = null;
    player.fadeBack = null;
    player.fadeHeld = false;
    player.gapBack = null;
    this.accept(player, s, now, { leg: true });
  }

  accept(player, s, now, { leg = false } = {}) {
    const swungBefore = player.flags & FLAG.swing;
    player.state = s;
    player.flags = s.flags & ~FLAG.dead & ~FLAG.hurt & ~FLAG.woke;
    if (swungBefore !== (s.flags & FLAG.swing)) {
      player.prevSwingAt = player.lastSwingAt;
      player.lastSwingAt = now;
    }
    player.item = s.item;
    // A teleport is not movement: the history starts again from where you
    // arrived, or the jump would read as a few thousand metres a second — to
    // the sword's reach allowance, and to the hit rewind.
    if (leg) player.history.length = 0;
    // `live` is the time with the pauses taken out (fadeReserve).
    player.history.push({ t: now, live: now - player.pausedMs, lat: s.lat, lon: s.lon, alt: s.alt });
    while (player.history.length && now - player.history[0].t > HISTORY_S * 1000) player.history.shift();

    const live = player.record.on(player.world);
    // Explored ground and the trail, worked out here from the move just
    // accepted — the same rule the game uses, on the same numbers.
    const agl = Math.max(0, Math.min(s.agl, s.alt + 12000));
    const seen = Math.max(240, Math.sqrt(2 * radiusOf(player.world) * Math.max(2, agl)));
    const fresh = live.explored.visit(s.lat, s.lon, agl, seen);
    if (fresh.length) {
      this.saveRecord(player.record);
      this.toWatchers(player, 'explored', { t: 'explored+', name: player.key, world: player.world, keys: fresh });
      this.addShared(player.world, fresh, player);
    }
    if (leg) live.trail.break();
    const point = live.trail.record(s.lat, s.lon);
    if (point) {
      this.saveRecord(player.record);
      this.toWatchers(player, 'trail', { t: 'trail+', name: player.key, world: player.world, p: point.point, leg: point.leg });
    }
  }

  /** Put a page back where the server last believed it was. */
  correct(player, where) {
    this.send(player.client, {
      t: 'correct',
      lat: where.lat,
      lon: where.lon,
      alt: where.alt ?? null,
    });
  }

  onArrived(player, m) {
    if (player.pending && Number(m.tid) === player.pending.tid) player.pending.arrived = true;
  }

  /**
   * Send a player somewhere. The page is told, holds still until it has
   * landed, and the server ignores everything it says about where it was
   * until it reports where it got to.
   *
   * @param {object} to {lat, lon, alt?, world?, yaw?, flying?}
   */
  teleport(player, to, reason) {
    const world = to.world ?? player.world;
    if (world !== player.world) return this.moveWorld(player, world, to, reason);
    const tid = player.nextTid++;
    player.pending = {
      tid, lat: to.lat, lon: to.lon, alt: to.alt ?? null, since: this.now(),
      ceiling: Number.isFinite(to.ceiling) ? to.ceiling : null,
    };
    player.record.on(player.world).trail.break();
    this.send(player.client, {
      t: 'teleport',
      tid,
      world,
      lat: to.lat,
      lon: to.lon,
      alt: to.alt ?? null,
      yaw: to.yaw ?? null,
      flying: !!to.flying,
      reason,
    });
    this.social.follow(player, { ...to, world }, reason);
    return true;
  }

  /**
   * Change worlds. The page reloads into the new one and signs back in, so
   * the server records where it will be and lets the connection go.
   */
  moveWorld(player, world, to = null, reason = 'travel') {
    if (!BODIES[world]) return false;
    // A full tank on arrival, as a first visit locally has: the tank was one
    // number for every world, so leaving the Moon with twenty-five seconds
    // put you down on Mars with twenty-five. Harmless to give - Earth fills
    // it anyway, and travel waits out fights and a cooldown.
    player.oxygen = OXYGEN_SECONDS;
    player.suffocateTimer = 0;
    this.remember(player);
    const from = player.world;
    const next = player.record.on(world);
    const spawn = this.spawnOf(world);
    next.pos = to
      ? { lat: to.lat, lon: to.lon, alt: to.alt ?? null, yaw: to.yaw ?? 0, flying: !!to.flying, ceiling: Number.isFinite(to.ceiling) ? to.ceiling : null }
      : next.pos ?? { lat: spawn.lat, lon: spawn.lon, alt: null, yaw: 0, flying: false };
    player.record.world = world;
    player.world = world;
    player.state = null;
    player.pending = {
      tid: 0, lat: next.pos.lat, lon: next.pos.lon, alt: next.pos.alt ?? null, since: this.now(),
      ceiling: Number.isFinite(next.pos.ceiling) ? next.pos.ceiling : null,
    };
    this.saveRecord(player.record);
    this.travelling.set(player.key, { at: this.now(), world: from });
    this.broadcast({ t: 'moved', id: player.id, world });
    this.send(player.client, { t: 'travelled', world, reason });
    if (reason !== 'tpa' && reason !== 'party') this.announce(`${player.name} left for ${BODIES[world].name}`, { kind: 'travel' });
    this.social.follow(player, { world, ...next.pos, host: to?.host }, reason);
    return true;
  }

  travel(player, worldName) {
    const body = findBody(worldName);
    if (!body) return this.tell(player, `No world called "${worldName}". Try /travel moon or /travel mars`, 'error');
    if (body.id === player.world) return this.tell(player, `You are already on ${body.name}`, 'error');
    if (this.inCombat(player)) return this.tell(player, 'You cannot leave in the middle of a fight', 'error');
    if (player.dead) return this.tell(player, 'Respawn first', 'error');
    const wait = 10 - (this.now() - player.lastTravelAt) / 1000;
    if (wait > 0) return this.tell(player, `The launch pad is cooling — ${Math.ceil(wait)} s`, 'error');
    player.lastTravelAt = this.now();
    this.moveWorld(player, body.id, null, 'travel');
  }

  randomTeleport(player) {
    if (player.dead) return;
    if (this.inCombat(player)) return this.tell(player, 'You cannot teleport away in the middle of a fight', 'error');
    const wait = this.config.rtpCooldownS - (this.now() - player.lastRtpAt) / 1000;
    if (wait > 0) return this.tell(player, `Random teleport is recharging — ${Math.ceil(wait)} s`, 'error');
    player.lastRtpAt = this.now();
    let to;
    if (player.world === 'earth') {
      // Somewhere with people in it, chosen here — a page that picked its own
      // "random" destination could pick anywhere it liked.
      const place = randomPopulatedPlace();
      to = { lat: place.lat, lon: place.lon, flying: true, label: place.name };
    } else {
      // Off Earth, somewhere the IAU has named: a crater, a mountain, a plain.
      const feature = randomFeature(player.world);
      if (feature) to = { lat: feature.lat, lon: feature.lon, flying: true, label: feature.label };
      else {
        const lat = (Math.asin(Math.random() * 2 - 1) * 180) / Math.PI * 0.75;
        to = { lat, lon: Math.random() * 360 - 180, flying: true };
      }
    }
    this.teleport(player, to, 'rtp');
    this.tell(player, to.label ? `Dropped near ${to.label}` : 'Dropped somewhere new');
  }

  /* ------------------------------------------------------------ fighting */

  inCombat(player) {
    return this.now() < this.combatEnds(player);
  }

  /**
   * When a player's fight is over. A page still arriving cannot be hit
   * (onAttack), so while it arrives the tag waits rather than runs: signing
   * in on a second tab - not a death, the fight goes with it - and never
   * saying it had arrived let the ten seconds run out where nobody could
   * reach it, and it then left the fight for free.
   */
  combatEnds(player) {
    const pending = player.pending;
    if (!pending || !(player.combatUntil > pending.since)) return player.combatUntil;
    return player.combatUntil + Math.max(0, this.now() - pending.since);
  }

  nearSpawn(player) {
    if (!player.state) return false;
    const spawn = this.spawnOf(player.world);
    return separation(spawn, { lat: player.state.lat, lon: player.state.lon, alt: 0 }, radiusOf(player.world))
      < (this.config.spawnProtectionM ?? 0);
  }

  /**
   * A swing landed, according to the page. Checked here before it counts:
   * the sword is in hand, both of you are alive and on the same world, the
   * blade has had time to come back round, and — the one that matters — the
   * target was actually within reach when the attacker saw them.
   */
  onAttack(attacker, m) {
    const now = this.now();
    const target = this.players.get(Number(m.target));
    if (!target || target === attacker || target.world !== attacker.world) return;
    if (attacker.dead || target.dead || attacker.pending || target.pending) return;
    if (!attacker.state || !target.state) return;
    if (attacker.item !== SWORD_SLOT) return;
    if (!this.config.pvp) return this.tell(attacker, 'PvP is off on this server', 'error');
    // A hit comes with the swing that made it: the page flips the swing bit
    // in the state it sends just before (Session.attack). Without one it is
    // a blade nobody saw move, and one that never reset its own charge.
    if (now - (attacker.lastSwingAt ?? -Infinity) > SWING_FRESH_MS) return;
    // Straight after a burst of speed - the allowance spent at once - or a
    // move the server refused, the sword does not count: that is a blink
    // across a field to land a hit, and nothing honest moves that way.
    if (now < attacker.blinkUntil) return;
    // Spawn protects people who are not in a fight. Somebody already in one
    // cannot run into it to get away — Minecraft's spawn protection is for
    // blocks, and a fight to the death has to be able to end in one.
    const sheltered = (p) => this.nearSpawn(p) && !this.inCombat(p);
    if (sheltered(attacker) || sheltered(target)) {
      return this.tell(attacker, 'No fighting at spawn', 'error');
    }
    // How charged the swing was, from the server's own clock: hitting again
    // before the blade has come round hits for less, down to a fifth.
    // Every swing resets the blade, a miss as much as a hit — as in
    // Minecraft, where spam-clicking your way in is punished. This attack's
    // own swing arrived just before it (the page sends its state first), so
    // the one that counts is the swing before that.
    const ownSwing = now - (attacker.lastSwingAt ?? -Infinity) < 400;
    const previous = ownSwing ? attacker.prevSwingAt ?? -Infinity : attacker.lastSwingAt ?? -Infinity;
    const since = (now - Math.max(attacker.lastAttackAt, previous)) / 1000;
    if (since < 0.1) return; // faster than any hand
    const charge = Math.max(0, Math.min(1, since / ATTACK_COOLDOWN_S));
    // Where the target was when the attacker saw them: half a round trip ago,
    // plus the tenth of a second remote players are drawn behind.
    // The round trip is the server's own measurement (see connect), and held
    // to REWIND_MAX_MS: a slower connection than that fights where it is.
    const seenAt = now - Math.min(REWIND_MAX_MS, attacker.rtt / 2 + 100);
    const then = positionAt(target, seenAt) ?? target.state;
    const radius = radiusOf(attacker.world);
    const reach = Math.min(
      separation(attacker.state, then, radius),
      separation(attacker.state, target.state, radius),
    );
    // Fast-moving pairs get a little more: at two hundred metres a second
    // between you, twenty milliseconds of disagreement is four metres. How
    // fast is measured here, from where each of them has actually been — the
    // velocity a page claims is just a number it sent, and claiming two
    // hundred and fifty metres a second while standing still bought thirteen
    // metres of reach and a critical on every swing. Across the ground only:
    // falling is free (onState), so a page could drop a kilometre a tenth of
    // a second to buy itself the reach.
    const va = measuredVelocity(attacker, radius, now);
    const vt = measuredVelocity(target, radius, now);
    const relative = Math.hypot(va[0] - vt[0], va[2] - vt[2]);
    const allowed = REACH_M + REACH_SLACK_M + Math.min(8, relative * 0.04);
    if (reach > allowed) return;
    attacker.lastAttackAt = now;
    if (now < target.immuneUntil) return;

    // Falling now, over the last fifth of a second: a jump is over in half a
    // second, so measured over the reach window it averaged out to nothing and
    // a jump-hit — Minecraft's critical — never counted.
    const vNow = measuredVelocity(attacker, radius, now, 200);
    const falling = !(attacker.state.flags & FLAG.ground) && vNow[1] < -1;
    const crit = falling && charge > 0.9;
    let amount = SWORD_DAMAGE * (0.2 + charge * charge * 0.8);
    if (crit) amount *= CRIT_MULTIPLIER;
    amount = Math.round(amount * 2) / 2;

    // Knocked away from the attacker, and up. A sprinting or fast-flying hit
    // knocks harder, which is Minecraft's sprint-hit.
    const DEG = Math.PI / 180;
    const east = (target.state.lon - attacker.state.lon) * DEG * Math.cos(attacker.state.lat * DEG) * radius;
    const north = (target.state.lat - attacker.state.lat) * DEG * radius;
    const flat = Math.hypot(east, north) || 1;
    const fast = (attacker.state.flags & FLAG.sprint) || Math.hypot(va[0], va[2]) > 12;
    const push = KNOCKBACK_MPS + (fast ? KNOCKBACK_SPRINT_MPS : 0);
    const kb = [(east / flat) * push, (target.state.flags & FLAG.ground) ? KNOCKBACK_MPS : KNOCKBACK_MPS * 0.5, (north / flat) * push];

    target.immuneUntil = now + HURT_IMMUNE_S * 1000;
    attacker.combatUntil = now + COMBAT_TAG_S * 1000;
    target.combatUntil = now + COMBAT_TAG_S * 1000;
    this.send(attacker.client, { t: 'hitConfirm', target: target.id, amount, crit });
    this.hurt(target, amount, { cause: 'slain', by: attacker, kb, crit });
  }

  /** Take health off somebody, from any cause, and see whether that was it. */
  hurt(player, amount, { cause, by = null, kb = null, crit = false }) {
    if (player.dead || !(amount > 0)) return;
    const now = this.now();
    player.health = Math.max(0, player.health - amount);
    player.lastHurtAt = now;
    player.regenAt = 0;
    // Who gets the kill if this ends by leaving, or by /kill (see lastAttacker).
    if (by) player.lastHitBy = by.key;
    this.send(player.client, {
      t: 'hit',
      amount,
      health: player.health,
      cause,
      by: by ? { id: by.id, name: by.name } : null,
      kb,
      crit,
    });
    this.broadcast({ t: 'hurt', id: player.id, health: player.health, crit }, { world: player.world, except: player });
    if (player.health <= 0) this.kill(player, cause, by);
  }

  /** Whoever last hit a player still in a fight with them, if they are still here. */
  lastAttacker(player) {
    if (!this.inCombat(player) || !player.lastHitBy) return null;
    const by = this.byKey.get(player.lastHitBy);
    return by && by !== player ? by : null;
  }

  kill(player, cause, by = null) {
    player.dead = true;
    player.health = 0;
    player.record.stats.deaths += 1;
    if (by) by.record.stats.kills += 1;
    this.saveRecord(player.record);
    if (by) this.saveRecord(by.record);
    const message = deathMessage(player.name, cause, by?.name);
    const { kills, deaths } = player.record.stats;
    this.send(player.client, { t: 'died', cause, by: by ? { id: by.id, name: by.name } : null, message, stats: { kills, deaths } });
    this.broadcast({ t: 'dead', id: player.id }, { except: player });
    this.announce(message, { kind: 'death' });
    for (const [id, request] of this.requests) {
      if (request.from === player || request.to === player) this.endRequest(id, 'died', player);
    }
  }

  respawn(player) {
    if (!player.dead) return;
    player.dead = false;
    player.health = MAX_HEALTH;
    player.oxygen = OXYGEN_SECONDS;
    player.immuneUntil = this.now() + 3000;
    player.combatUntil = 0;
    const at = this.respawnPoint(player);
    this.send(player.client, { t: 'health', health: player.health });
    this.send(player.client, { t: 'oxygen', oxygen: player.oxygen });
    this.broadcast({ t: 'alive', id: player.id }, { except: player });
    this.teleport(player, { lat: at.lat, lon: at.lon, flying: false }, 'respawn');
  }

  /**
   * Where a respawn puts you: back at your lander off Earth — that is where
   * the air is — and at the world's spawn otherwise.
   */
  respawnPoint(player) {
    const live = player.record.on(player.world);
    return player.world !== 'earth' && live.lander ? live.lander : this.spawnOf(player.world);
  }

  /**
   * Damage only the page can see: the water you are under, the tank that ran
   * dry. Taken at its word, because it only ever hurts the one reporting it,
   * but no faster than the real thing could happen.
   */
  onSelfDamage(player, m) {
    const now = this.now();
    const amount = Number(m.amount);
    const cause = ['drowned', 'suffocated', 'kill'].includes(m.cause) ? m.cause : 'suffocated';
    if (!(amount > 0) || amount > 4) return;
    player.selfDamage = player.selfDamage.filter((t) => now - t < 1000);
    if (player.selfDamage.length >= 3) return;
    player.selfDamage.push(now);
    this.hurt(player, amount, { cause });
  }

  /* ------------------------------------------------------------ requests */

  /**
   * /tpa and /tpahere: ask, and wait up to forty seconds for an answer.
   *
   * @param {'tpa'|'tpahere'} kind tpa brings you to them; tpahere brings them to you
   */
  request(from, to, kind) {
    const now = this.now();
    if (to === from) return this.tell(from, 'That is you', 'error');
    if (from.dead) return this.tell(from, 'Respawn first', 'error');
    // Dying ends every request a player has, so one sent to somebody dead
    // would only end the moment they answered it.
    if (to.dead) return this.tell(from, `${to.name} is dead — ask again when they respawn`, 'error');
    if (this.inCombat(from)) return this.tell(from, 'Not in the middle of a fight', 'error');
    const last = from.lastRequestAt.get(to.key) ?? -Infinity;
    if (now - last < TPA_COOLDOWN_S * 1000) {
      return this.tell(from, `Wait ${Math.ceil(TPA_COOLDOWN_S - (now - last) / 1000)} s before asking ${to.name} again`, 'error');
    }
    from.lastRequestAt.set(to.key, now);
    // One request between any two people at a time: asking again replaces it.
    for (const [id, existing] of this.requests) {
      if (existing.from === from && existing.to === to) this.endRequest(id, 'replaced');
    }
    const id = this.nextRequest++;
    const expires = now + TPA_TIMEOUT_S * 1000;
    // A friend who said yes in advance: carried out as soon as it can be -
    // now, or the moment a fight or a landing stops it (see tick).
    const auto = this.social.autoAcceptsTpa(to, from);
    this.requests.set(id, { id, from, to, kind, expires, auto });
    this.send(to.client, {
      t: 'tpreq',
      id,
      kind,
      from: { id: from.id, name: from.name, colour: from.colour, world: from.world },
      expiresIn: TPA_TIMEOUT_S,
    });
    this.tell(to, kind === 'tpa'
      ? `${from.name} wants to teleport to you. /tpaccept or /tpdeny — ${TPA_TIMEOUT_S} s`
      : `${from.name} wants you to teleport to them. /tpaccept or /tpdeny — ${TPA_TIMEOUT_S} s`, 'request');
    this.send(from.client, { t: 'tpsent', id, kind, to: { id: to.id, name: to.name }, expiresIn: TPA_TIMEOUT_S });
    this.tell(from, `Asked ${to.name}. They have ${TPA_TIMEOUT_S} s to answer — /tpacancel to take it back`);
    if (auto) this.autoAccept(this.requests.get(id));
  }

  /**
   * Accept a friend's request on its own, if nothing stands in the way. If
   * something does - a fight, a landing - the request stays open with its
   * prompt, and the tick tries again; nobody is told it was accepted until
   * it was.
   */
  autoAccept(request) {
    if (!request || this.whyNot(request, request.to)) return false;
    this.tell(request.to, `Accepted ${request.from.name}'s request (you accept teleport requests from friends)`);
    this.carryOut(request);
    return true;
  }

  /** Why a request cannot be carried out right now, said to `player`; null if it can. */
  whyNot(request, player) {
    const { from, to, kind } = request;
    const mover = kind === 'tpa' ? from : to;
    const host = kind === 'tpa' ? to : from;
    if (mover.dead || host.dead) return 'Too late — somebody died';
    if (this.inCombat(mover)) {
      return `${mover === player ? 'You are' : `${mover.name} is`} in a fight — try again in a few seconds`;
    }
    // Nor to somebody still arriving: where they are is where the server sent
    // them, not yet where they are, and their height is not yet one it knows.
    if (!host.state || host.pending) {
      return `${host === player ? 'You have' : `${host.name} has`} not landed yet — try again in a moment`;
    }
    return null;
  }

  /**
   * The newest request to `player` (or from them, with `sent`), from `name`
   * if given. A name can be shortened, as with /tpa: the whole name wins,
   * then the newest one it begins.
   */
  findRequest(player, name, { sent = false } = {}) {
    const wanted = name ? nameKey(name) : '';
    let exact = null;
    let partial = null;
    for (const request of this.requests.values()) {
      const mine = sent ? request.from === player : request.to === player;
      if (!mine) continue;
      const other = sent ? request.to : request.from;
      if (other.key === wanted || !wanted) {
        if (!exact || request.id > exact.id) exact = request;
      } else if (other.key.startsWith(wanted) && (!partial || request.id > partial.id)) {
        partial = request;
      }
    }
    return exact ?? partial;
  }

  acceptRequest(player, name) {
    const request = this.findRequest(player, name);
    if (!request) return this.tell(player, name ? `No request from ${name}` : 'Nobody has asked', 'error');
    const why = this.whyNot(request, player);
    if (why) {
      if (request.from.dead || request.to.dead) this.endRequest(request.id, 'died', request.from.dead ? request.from : request.to);
      return this.tell(player, why, 'error');
    }
    this.carryOut(request);
  }

  /** Teleport whoever a request moves, and close it. */
  carryOut(request) {
    const { from, to, kind } = request;
    const mover = kind === 'tpa' ? from : to;
    const host = kind === 'tpa' ? to : from;
    this.requests.delete(request.id);
    this.send(from.client, { t: 'tpreq-end', id: request.id, reason: 'accepted' });
    this.send(to.client, { t: 'tpreq-end', id: request.id, reason: 'accepted' });
    // Next to them, not inside them, and at their height: somebody flying at
    // two thousand metres gets their visitor beside them in the air.
    const s = host.state;
    const DEG = Math.PI / 180;
    const back = 4;
    const radius = radiusOf(host.world);
    const to3 = {
      world: host.world,
      lat: s.lat - (Math.cos(s.yaw) * back) / radius / DEG,
      lon: s.lon - (Math.sin(s.yaw) * back) / (radius * Math.cos(s.lat * DEG)) / DEG,
      alt: s.alt,
      // What a fall may count from beside them is what it may for them: their
      // height can be one they only claimed. See arrive and spendableCeiling.
      ceiling: this.spendableCeiling(host),
      yaw: s.yaw,
      flying: !(s.flags & FLAG.ground),
      // Who is being visited: a party comes along only to one of its own.
      host: host.key,
    };
    this.tell(mover, `Teleporting to ${host.name}`);
    this.tell(host, `${mover.name} is on the way`);
    this.teleport(mover, to3, 'tpa');
  }

  denyRequest(player, name) {
    const request = this.findRequest(player, name);
    if (!request) return this.tell(player, name ? `No request from ${name}` : 'Nobody has asked', 'error');
    this.endRequest(request.id, 'denied');
  }

  cancelRequest(player, name) {
    const request = this.findRequest(player, name, { sent: true });
    if (!request) return this.tell(player, 'You have not asked anyone', 'error');
    this.endRequest(request.id, 'cancelled');
  }

  endRequest(id, reason, gone = null) {
    const request = this.requests.get(id);
    if (!request) return;
    this.requests.delete(id);
    const { from, to } = request;
    for (const p of [from, to]) {
      if (this.players.get(p.id) === p) this.send(p.client, { t: 'tpreq-end', id, reason });
    }
    if (reason === 'denied') this.tell(from, `${to.name} said no`);
    if (reason === 'expired') {
      this.tell(from, `${to.name} did not answer in time`);
      this.tell(to, `The request from ${from.name} ran out`);
    }
    if (reason === 'cancelled') this.tell(to, `${from.name} took the request back`);
    // Whoever is still here hears why it ended, not just that it did.
    if (gone && (reason === 'died' || reason === 'left')) {
      const other = gone === from ? to : from;
      if (this.players.get(other.id) === other) {
        this.tell(other, `${gone.name} ${reason === 'died' ? 'died' : 'left'} — the teleport request is off`);
      }
    }
  }

  /* --------------------------------------------------------------- chat */

  onChat(player, text) {
    const whole = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    text = whole.slice(0, CHAT_MAX);
    if (!text) return;
    const now = this.now();
    const times = (this.chatTimes.get(player.key) ?? []).filter((t) => now - t < CHAT_WINDOW_S * 1000);
    this.chatTimes.set(player.key, times);
    if (times.length >= CHAT_BURST) {
      return this.tell(player, 'Slow down a little', 'error');
    }
    times.push(now);
    const command = parseCommand(text);
    // Cut to fit, a command could do something other than what was typed:
    // /password would set the first 117 characters of a new one.
    if (command) return runCommand(this, player, { ...command, cut: whole.length > text.length });
    this.broadcast({ t: 'chat', kind: 'chat', from: this.speaker(player), text });
  }

  /**
   * A friend or party action from the players panel - the same as the
   * command, but not out of the chat's budget: six lines in six seconds,
   * shared with talking, refused the seventh invite of a party of eight
   * clicked at an ordinary pace. A budget of its own, more generous.
   */
  onSocial(player, m) {
    const cmd = m.cmd === 'friend' || m.cmd === 'party' ? m.cmd : null;
    const op = typeof m.op === 'string' && /^[a-z]{1,16}$/.test(m.op) ? m.op : null;
    if (!cmd || !op) return;
    const now = this.now();
    const times = (this.socialTimes.get(player.key) ?? []).filter((t) => now - t < 6000);
    this.socialTimes.set(player.key, times);
    if (times.length >= 16) return this.tell(player, 'Slow down a little', 'error');
    times.push(now);
    const name = typeof m.name === 'string' ? m.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32) : '';
    const args = name ? [op, ...name.split(/\s+/)] : [op];
    runCommand(this, player, { name: cmd, args, rest: args.join(' ') });
  }

  /**
   * A new password, from the form for it, sent whole. As a chat command it
   * was split on spaces and cut to the chat's length, so a passphrase came
   * out as its first word - reported changed, and its owner locked out.
   */
  onPassword(player, m) {
    const client = player.client;
    const now = this.now();
    // Hashing is slow on purpose; one at a time, and not in a loop.
    if (client.passwordBusy || now - (client.passwordAt ?? -Infinity) < 2000) {
      return this.send(client, { t: 'password', ok: false, error: 'One moment — try again in a couple of seconds' });
    }
    client.passwordAt = now;
    client.passwordBusy = true;
    // One past the longest allowed, so a longer one is refused rather than cut.
    const oldPassword = typeof m.old === 'string' ? m.old.slice(0, PASSWORD_MAX + 1) : '';
    const newPassword = typeof m.new === 'string' ? m.new.slice(0, PASSWORD_MAX + 1) : '';
    this.accounts.changePassword(player.account, oldPassword, newPassword, client.token)
      .then((result) => {
        this.send(client, result.error ? { t: 'password', ok: false, error: result.error } : { t: 'password', ok: true });
      })
      .catch((error) => {
        console.error('[terraglide] password change failed:', error?.stack ?? error);
        this.send(client, { t: 'password', ok: false, error: 'The password could not be changed — try again' });
      })
      .finally(() => { client.passwordBusy = false; });
  }

  speaker(player) {
    return { id: player.id, name: player.name, colour: player.colour, world: player.world };
  }

  /** Find an online player by name, forgiving case and an unambiguous prefix. */
  findPlayer(name) {
    const wanted = nameKey(name ?? '');
    if (!wanted) return null;
    const exact = this.byKey.get(wanted);
    if (exact) return exact;
    const matches = this.playersStarting(wanted);
    return matches.length === 1 ? matches[0] : null;
  }

  playersStarting(wanted) {
    const matches = [];
    for (const player of this.players.values()) {
      if (player.key.startsWith(wanted)) matches.push(player);
    }
    matches.sort((a, b) => a.name.localeCompare(b.name));
    return matches;
  }

  nobodyCalled(name) {
    const typed = String(name ?? '').slice(0, 32);
    const wanted = nameKey(typed);
    const matches = wanted ? this.playersStarting(wanted) : [];
    if (matches.length > 1) {
      const names = matches.slice(0, 5).map((p) => p.name).join(', ');
      return `${typed} could be ${names}${matches.length > 5 ? ', …' : ''} — type more of the name`;
    }
    return `Nobody called ${typed} is online`;
  }

  kick(player, reason) {
    this.send(player.client, { t: 'kick', reason });
    player.client.ws.close(4000, reason.slice(0, 100));
    this.disconnect(player.client, { quiet: true });
    this.announce(`${player.name} was disconnected: ${reason}`, { kind: 'leave' });
  }

  /* ------------------------------------------------------- map overlays */

  /**
   * Somebody switched on another player's discoveries or trail on their map.
   * Everything they have on this world is sent once, and every new square or
   * point after that, for as long as it stays switched on.
   */
  onWatch(viewer, m) {
    // Each one can mean a whole map or a whole path to send: a handful a
    // second is plenty for a page, and a loop of them is not a page.
    const now = this.now();
    viewer.client.watchTimes = (viewer.client.watchTimes ?? []).filter((t) => now - t < 5000);
    if (viewer.client.watchTimes.length >= 40) return;
    viewer.client.watchTimes.push(now);
    const explored = !!m.explored;
    const trail = !!m.trail;
    if (m.name === '*') {
      if (explored) {
        // Everyone's discoveries are one map, not one per player: what anybody
        // has explored on this world, sent whole now and kept up to date.
        const was = viewer.watchAll.explored;
        viewer.watchAll.explored = !m.off;
        if (viewer.watchAll.explored && !was) this.sendSharedMap(viewer);
      }
      if (trail) viewer.watchAll.trail = !m.off;
      if (!trail) return;
    }
    // Everyone, for "everyone's paths": the players the atlas lists, not
    // every account that ever was - each is a whole path to send.
    const targets = m.name === '*'
      ? this.atlasKeys(viewer)
      : [nameKey(String(m.name ?? ''))].filter((key) => this.byKey.get(key)?.world === viewer.world || this.knownOn(viewer.world).includes(key));
    for (const key of targets) {
      if (key === viewer.key) continue;
      const before = viewer.watching.get(key) ?? { explored: false, trail: false };
      const now = {
        explored: m.name === '*' ? before.explored : explored,
        trail: m.name === '*' ? trail || before.trail : trail,
      };
      if (m.name === '*' && m.off) now.trail = false;
      viewer.watching.set(key, now);
      const live = this.peek(key).on(viewer.world);
      if (now.explored && !before.explored) {
        this.sendPaced(viewer.client, { t: 'explored', name: key, world: viewer.world, cells: live.explored.encode() });
      }
      if (now.trail && !before.trail) {
        this.sendPaced(viewer.client, { t: 'trail', name: key, world: viewer.world, legs: live.trail.legs });
      }
    }
  }

  /* --------------------------------------------------------- shared map */

  /**
   * Everything anybody has explored on a world, as one map — what a player
   * sees with "everyone's discoveries" on. Built once from every record the
   * first time it is wanted, kept up to date from the moves the server
   * accepts, and saved beside them so a restart does not rebuild it.
   */
  sharedMap(world) {
    let shared = this.shared.get(world);
    if (shared) return shared;
    // Kept as runs (see cells.mjs), not a Set of every cell's name.
    const cells = new CellRuns();
    const saved = this.store.read(`shared-${world}.json`, null);
    // A map saved before the squares were sized to the world is carried onto
    // them (ExplorationScheme in src/ui/exploration.js) and written back so.
    const scheme = explorationScheme(circumferenceOf(world));
    const add = (z, x, y, length) => cells.addRun(z, y, x, length);
    let carried = 0;
    if (Array.isArray(saved?.parts)) {
      for (const part of saved.parts) carried += readCells(part, scheme, add);
    } else if (saved?.cells) {
      carried += readCells(saved.cells, scheme, add);
    } else {
      // Read one at a time and let go: see loadIndex.
      for (const key of this.knownOn(world)) {
        this.peek(key).on(world).explored.eachRun((z, y, x, length) => cells.addRun(z, y, x, length));
      }
    }
    shared = { map: { cells }, pending: new Set() };
    this.shared.set(world, shared);
    if (carried > 0) this.store.mark(`shared-${world}.json`, () => ({ version: 2, parts: shared.map.cells.parts(SHARED_PART_RUNS) }));
    return shared;
  }

  /**
   * New ground onto a world's shared map. A player adds at most
   * SHARED_PER_DAY cells a day to it, and the map stops growing at
   * SHARED_MAX. What they find past that is still their own (their record
   * has it, and their own page counts it among everybody's); it just is not
   * on anybody else's.
   *
   * The cells are worked out here from moves the speed limits accepted, so
   * nobody adds more in an hour than an honest page flying flat out does.
   * Measured with the game's own flight model against this server (rockets
   * every second, a surge whenever it is ready, nothing put back): 3,800
   * to 6,700 km2 an hour on every world flown, and with the squares sized
   * to the world (ExplorationScheme in src/ui/exploration.js) that is, in
   * cells an hour, 11,000 on Earth's equator, 28,000 at 48 degrees, 40,000
   * at 57 and 29,000 at 70 and at 85, the most just short of where the
   * squares coarsen - 49,000 at 59.9 degrees, 57,000 at 75.5; 14,000 on the
   * equators of the Moon and Mars, 12,000 to 20,000 on Enceladus, and at
   * most 135,000 (3.2 million a day) on Pluto at 75 degrees, the world with
   * the smallest squares. SHARED_PER_DAY is a whole day of that, so all an
   * honest player explores in a day reaches everybody, wherever it is. It
   * was a million when the squares shrank on small worlds and towards the
   * poles (that was 6 minutes flat out on Enceladus and 38 near the pole)
   * and a page held the map as a Set of names, 55 to 100 bytes a cell. Now
   * a page holds it as runs (src/net/session.js): a million cells is up to
   * 2 MB to download and 8 MB to hold, thirty million - SHARED_MAX - up to
   * 60 MB to download, 50 MB to hold and 2 to 5 seconds to take in (north-
   * south tracks 5 km apart, the worst case for runs), where it was 1.6 to
   * 3 GB. Every account is held to the day's share, and accounts are cheap,
   * so what keeps a world's map in bounds is SHARED_MAX: up to 90 MB here as
   * runs and a 60 MB file - and reading that file in, or saving it, holds up
   * to two and a half times as much again while it does (306 MB of heap at
   * the top for a full map of north-south tracks).
   */
  addShared(world, keys, player = null) {
    const shared = this.sharedMap(world);
    let allowance = Infinity;
    let budget = null;
    if (player) {
      const day = Math.floor(this.now() / 86400000);
      budget = this.sharedBudget.get(player.key);
      if (!budget || budget.day !== day) this.sharedBudget.set(player.key, (budget = { day, used: 0 }));
      allowance = SHARED_PER_DAY - budget.used;
    }
    for (const key of keys) {
      if (allowance <= 0 || shared.map.cells.size >= SHARED_MAX) break;
      if (!shared.map.cells.add(key)) continue;
      shared.pending.add(key);
      allowance -= 1;
      if (budget) budget.used += 1;
    }
  }

  /**
   * The whole shared map, to one viewer - once per connection and world. The
   * page keeps it when "everyone's discoveries" is switched off and on again,
   * and the new ground found meanwhile reaches it anyway (see flushShared),
   * so switching it back on sends nothing. Switching it on and off in a loop
   * used to send the whole map each time.
   */
  sendSharedMap(viewer) {
    if (viewer.sharedSentWorld === viewer.world) return;
    viewer.sharedSentWorld = viewer.world;
    // A part at a time, made as the connection takes them (pumpShared), not
    // all at once. A busy world's map is tens of megabytes as text, and
    // queued whole for a page on a real connection it was over BACKLOG_MAX
    // at the next tick, so the page was let go as soon as it asked for it -
    // and again after every sign-in, since every page asks (session.js,
    // rewatch): a world's map past about 24 MB (twelve to twenty million
    // cells) and nobody there stayed connected. Made from the map as it is,
    // and new ground found meanwhile goes to this page as it is found.
    const cells = this.sharedMap(viewer.world).map.cells;
    const client = viewer.client;
    client.sharedStream = {
      world: JSON.stringify(viewer.world),
      parts: cells.streamParts(SHARED_PART_RUNS),
      index: 0,
      of: Math.max(1, Math.ceil(cells.runCount() / SHARED_PART_RUNS)),
    };
    // The first in line, now: the page takes the 'shared+' that follow only
    // once it has the first part.
    this.sendPaced(client, this.nextSharedPart(client.sharedStream));
    this.pumpShared(client);
  }

  /**
   * The next part of a shared map on its way to a page, as text. The count
   * it is sent with was made when it started; the last part is everything
   * left, and parts the map no longer needs are sent empty, so it is always
   * exactly that many.
   */
  nextSharedPart(stream) {
    let part;
    if (stream.index >= stream.of - 1) {
      part = { v: 2, runs: {} };
      for (let next = stream.parts.next(); !next.done; next = stream.parts.next()) {
        for (const [level, runs] of Object.entries(next.value.runs)) {
          const out = (part.runs[level] ??= []);
          for (const value of runs) out.push(value);
        }
      }
    } else {
      const next = stream.parts.next();
      part = next.done ? { v: 2, runs: {} } : next.value;
    }
    const text = `{"t":"shared","world":${stream.world},"part":${stream.index},"of":${stream.of},"cells":${JSON.stringify(part)}}`;
    stream.index += 1;
    return text;
  }

  /** More of a shared map on its way, while the page keeps up with it and nothing else waits. */
  pumpShared(client) {
    const stream = client.sharedStream;
    if (!stream) return;
    while (stream.index < stream.of && client.ws.open && !client.outbox?.length && client.ws.bufferedAmount < PACE_BYTES) {
      client.ws.send(this.nextSharedPart(stream));
    }
    if (stream.index >= stream.of || !client.ws.open) client.sharedStream = null;
  }

  /** New ground on the shared maps, to everyone looking, a couple of times a second at most. */
  flushShared() {
    for (const [world, shared] of this.shared) {
      if (!shared.pending.size) continue;
      const keys = [...shared.pending];
      shared.pending.clear();
      // In pieces: a busy half second can be hundreds of thousands of cells,
      // megabytes in one message for every page to take and parse at once.
      for (let from = 0; from < keys.length; from += SHARED_NEW_PER_MESSAGE) {
        const text = JSON.stringify({ t: 'shared+', world, keys: keys.slice(from, from + SHARED_NEW_PER_MESSAGE) });
        // To everyone holding the map, shown or not: a page that switched it off
        // and on again then has it whole without being sent it again.
        for (const viewer of this.players.values()) {
          if (viewer.world === world && viewer.sharedSentWorld === world) this.sendPaced(viewer.client, text);
        }
      }
      this.store.mark(`shared-${world}.json`, () => ({ version: 2, parts: shared.map.cells.parts(SHARED_PART_RUNS) }));
    }
  }

  toWatchers(player, what, message) {
    const text = JSON.stringify(message);
    for (const viewer of this.players.values()) {
      if (viewer === player || viewer.world !== player.world) continue;
      if (what === 'trail' && !viewer.watching.has(player.key) && viewer.watchAll.trail) {
        // Somebody new to this viewer, who asked to see everyone's paths: the
        // whole of theirs so far, which already includes this step.
        this.onWatch(viewer, { name: player.key, explored: false, trail: true });
        continue;
      }
      // Paced, so it never overtakes the whole record still queued for them.
      if (viewer.watching.get(player.key)?.[what]) this.sendPaced(viewer.client, text);
    }
  }

  /** Everybody with any record on a world, online or not - from the index, not their files. */
  knownOn(world) {
    const keys = [];
    const seen = new Set();
    const consider = (key) => {
      if (seen.has(key)) return;
      seen.add(key);
      const record = this.records.get(key);
      const entry = this.index.get(key);
      const here = record
        ? record.worlds().includes(world) || record.world === world
        : !!entry && (!!entry.worlds?.[world] || entry.world === world);
      if (here) keys.push(key);
    };
    for (const key of this.index.keys()) consider(key);
    // Somebody new, whose first save has not happened yet.
    for (const key of this.records.keys()) consider(key);
    return keys;
  }

  /**
   * The players one viewer's atlas lists, best first and at most ATLAS_MAX:
   * everybody online, then their party and friends, then the most recently
   * seen.
   */
  atlasKeys(viewer) {
    const mine = new Set([
      ...(this.social.partyFor(viewer.key)?.members ?? []),
      ...this.social.social(viewer.key).friends,
    ]);
    const rank = (key) => (this.byKey.has(key) ? 0 : mine.has(key) ? 1 : 2);
    return this.knownOn(viewer.world)
      .filter((key) => key !== viewer.key)
      .sort((a, b) => rank(a) - rank(b)
        || (this.accounts.get(b)?.lastSeen ?? 0) - (this.accounts.get(a)?.lastSeen ?? 0))
      .slice(0, ATLAS_MAX);
  }

  /** Who has been on this world, for the map's list of discoveries. */
  sendAtlas(viewer) {
    const known = this.knownOn(viewer.world).length - 1;
    const players = this.atlasKeys(viewer).map((key) => {
      const account = this.accounts.get(key);
      const [explored = 0, trailPoints = 0] = this.countsOn(key, viewer.world);
      return {
        name: account?.name ?? key,
        key,
        colour: account?.colour ?? '#999999',
        online: this.byKey.has(key),
        explored,
        trailPoints,
      };
    });
    this.send(viewer.client, { t: 'atlas', world: viewer.world, players, more: Math.max(0, known - players.length) });
  }

  onWaypoints(player, list) {
    if (!Array.isArray(list)) return;
    const clean = list.slice(0, MAX_WAYPOINTS).map((w) => ({
      id: Number(w?.id) || 0,
      name: String(w?.name ?? '').slice(0, 60),
      lat: Number(w?.lat),
      lon: Number(w?.lon),
      altitude: Number.isFinite(Number(w?.altitude)) ? Number(w.altitude) : 0,
      colour: /^#[0-9a-f]{6}$/i.test(String(w?.colour)) ? w.colour : '#c8b98f',
      createdAt: Number(w?.createdAt) || 0,
    })).filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lon) && Math.abs(w.lat) <= 90);
    player.record.on(player.world).waypoints = clean;
    this.saveRecord(player.record);
  }

  /** Put your lander down where you are standing. Off Earth only. */
  onLander(player, m) {
    if (player.world === 'earth' || !player.state || player.dead) return;
    // The page's rules, kept here too: on the ground, and not more often than
    // every LANDER_EVERY_S — a reload or a modified page does not skip them.
    if (!(player.state.flags & FLAG.ground)) return this.tell(player, 'Land first — a lander goes down on solid ground', 'error');
    const wait = LANDER_EVERY_S - (this.now() - player.lastLanderAt) / 1000;
    if (wait > 0) return this.tell(player, `The lander can move again in ${Math.ceil(wait)} s`, 'error');
    player.lastLanderAt = this.now();
    const live = player.record.on(player.world);
    live.lander = { lat: player.state.lat, lon: player.state.lon, alt: player.state.alt };
    this.saveRecord(player.record);
    this.send(player.client, { t: 'lander', lander: live.lander });
  }

  /**
   * What is left of each rocket the page carries, kept so that a reload is
   * not a full set. The page counts them — the speed check bounds what any
   * number of rockets can do — and the server keeps the count with you.
   */
  onRockets(player, m) {
    if (!Array.isArray(m.stock) || m.stock.length > 8) return;
    const stock = m.stock.map((n) => Math.max(0, Math.min(ROCKET_STACK, Math.floor(Number(n) || 0))));
    player.record.rockets = { stock, at: this.now() };
    this.saveRecord(player.record);
  }

  /** The saved stock, with what has come back since. */
  rocketsNow(record) {
    const saved = record.rockets;
    if (!saved || !Array.isArray(saved.stock)) return null;
    const back = Math.floor(Math.max(0, this.now() - (saved.at ?? 0)) / 1000 / ROCKET_REFILL_S);
    return saved.stock.map((n) => Math.min(ROCKET_STACK, n + back));
  }

  /* --------------------------------------------------------------- voice */

  /**
   * Relay one WebRTC signalling message between two players who are close
   * enough to hear each other. The audio itself goes browser to browser; all
   * the server ever sees is the handshake.
   */
  onVoice(player, m) {
    const now = this.now();
    const client = player.client;
    client.voiceTimes = client.voiceTimes.filter((t) => now - t < 1000);
    if (client.voiceTimes.length > 60) return;
    const to = this.players.get(Number(m.to));
    if (!to || to === player) return;
    const kind = String(m.kind ?? '');
    const data = voiceData(kind, m.data);
    if (!data) return;
    // Bytes as well as messages: sixty offers a second at full size would
    // have the server shovelling a megabyte a second for one player.
    const bytes = JSON.stringify(data).length;
    if (now - (client.voiceWindowAt ?? 0) >= 1000) {
      client.voiceWindowAt = now;
      client.voiceBytes = 0;
    }
    if (client.voiceBytes + bytes > VOICE_BYTES_PER_S) return;
    client.voiceTimes.push(now);
    client.voiceBytes += bytes;
    // Calling is for somebody near you on your world. Hanging up is for
    // somebody near you or somebody you have been talking to lately — who may
    // have just gone out of range, or to another world — and nobody else.
    // A party talks however far apart its members are, on any world.
    const near = this.social.sameParty(player.key, to.key) || (to.world === player.world && to.state && player.state &&
      separation(to.state, player.state, radiusOf(player.world)) <= VOICE_CONNECT_M * 1.5);
    const contacts = (player.voiceContacts ??= new Map());
    const lately = now - (contacts.get(to.id) ?? -Infinity) < VOICE_CONTACT_MS;
    if (!near && !(kind === 'bye' && lately)) return;
    if (kind !== 'bye') {
      contacts.set(to.id, now);
      (to.voiceContacts ??= new Map()).set(player.id, now);
    }
    this.send(to.client, { t: 'voice', from: player.id, kind, data });
  }

  /**
   * The suit's oxygen, counted here rather than by the page: it drains a
   * second a second off Earth (two in a surge), fills at the base or your
   * lander on the ground, fills on a world with air, and empty, suffocates —
   * the page only shows it. A reload, a reconnect or a page that says
   * otherwise changes nothing.
   */
  tickOxygen(player, dt, now) {
    if (player.dead || !player.state || player.pending) return;
    const before = player.oxygen;
    const body = BODIES[player.world];
    if (!body || body.breathable || this.nearAir(player)) {
      player.oxygen = Math.min(OXYGEN_SECONDS, player.oxygen + dt * OXYGEN_REFILL_PER_S);
      player.suffocateTimer = 0;
    } else {
      player.oxygen = Math.max(0, player.oxygen - dt * (player.state.flags & FLAG.surge ? 2 : 1));
      if (player.oxygen > 0) player.suffocateTimer = 0;
      else {
        player.suffocateTimer += dt;
        while (player.suffocateTimer >= 1 && !player.dead) {
          player.suffocateTimer -= 1;
          this.hurt(player, SUFFOCATION_PER_S, { cause: 'suffocated' });
        }
      }
    }
    // Once a second while it is changing, so the gauge on the page is never
    // more than a moment out.
    if (player.oxygen !== before && now - player.oxygenSentAt >= 1000) {
      player.oxygenSentAt = now;
      this.send(player.client, { t: 'oxygen', oxygen: Math.round(player.oxygen * 10) / 10 });
    }
  }

  /** At the base or your lander, on the ground: where the suit refills. */
  nearAir(player) {
    const s = player.state;
    if (!(s.flags & FLAG.ground) || !(s.agl < REFILL_AGL_M)) return false;
    const radius = radiusOf(player.world);
    const lander = player.record.on(player.world).lander;
    for (const site of [this.spawnOf(player.world), lander]) {
      if (site && separation({ lat: site.lat, lon: site.lon, alt: s.alt }, s, radius) <= REFILL_M) return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------- tick */

  tick() {
    const now = this.now();
    this.tickCount += 1;

    // Requests that ran out.
    for (const [id, request] of this.requests) {
      if (now >= request.expires) this.endRequest(id, 'expired');
      else if (request.auto) this.autoAccept(request);
    }
    // Party invitations that ran out, and parties everybody has left.
    this.social.tick(now);
    if (this.tickCount % 5 === 0) this.flushShared();
    this.drainOutboxes();

    // Somewhere the server sent you is where you are, said so or not. Nobody
    // can hit a player still on the way, so a page that never reported
    // arriving was out of every fight for good.
    for (const player of this.players.values()) {
      const pending = player.pending;
      if (!pending || now - pending.since < ARRIVAL_TIMEOUT_MS) continue;
      const was = player.state ?? { agl: 0, vel: [0, 0, 0], yaw: 0, pitch: 0, roll: 0, flags: 0, item: 0 };
      this.arrive(player, { ...was, lat: pending.lat, lon: pending.lon, alt: pending.alt ?? was.alt ?? 0 }, now);
    }

    // Hearts back, half at a time, once you have been left alone a while.
    for (const player of this.players.values()) {
      if (player.dead || player.health >= MAX_HEALTH) continue;
      if (now - player.lastHurtAt < REGEN_DELAY_S * 1000) continue;
      if (now - player.regenAt < REGEN_EVERY_S * 1000) continue;
      player.regenAt = now;
      player.health = Math.min(MAX_HEALTH, player.health + 1);
      this.send(player.client, { t: 'health', health: player.health });
    }

    // The suit's tank, wherever there is nothing to breathe.
    const dt = Math.min(1, Math.max(0, (now - (this.lastTickAt ?? now)) / 1000));
    this.lastTickAt = now;
    for (const player of this.players.values()) this.tickOxygen(player, dt, now);

    this.sendSnapshots(now);

    // Sockets that went quiet.
    for (const client of this.clients) {
      if (now - client.lastHeard > SILENT_MS) {
        client.ws.terminate();
        this.disconnect(client);
      } else if (this.tickCount % PING_EVERY_TICKS === 0) {
        client.pings ??= new Map();
        const key = randomBytes(8).toString('hex');
        client.pings.set(key, now);
        // A page that never answers keeps only the last few waiting.
        while (client.pings.size > 4) client.pings.delete(client.pings.keys().next().value);
        client.ws.ping(key);
      }
    }

    if (now - this.lastSave > (this.config.saveEveryS ?? 30) * 1000) {
      this.lastSave = now;
      for (const player of this.players.values()) this.remember(player);
      this.accounts.save();
      this.store.flush();
      this.evictRecords();
      // Budgets nobody has used for a while.
      for (const map of [this.chatTimes, this.socialTimes]) {
        for (const [key, times] of map) if (!times.length || now - times[times.length - 1] > 60000) map.delete(key);
      }
    }
  }

  sendSnapshots(now) {
    const everySecond = this.tickCount % 10 === 0;
    const byWorld = new Map();
    for (const player of this.players.values()) {
      if (!player.state || player.pending) continue;
      if (!byWorld.has(player.world)) byWorld.set(player.world, []);
      byWorld.get(player.world).push(player);
    }
    for (const [world, list] of byWorld) {
      const radius = radiusOf(world);
      const rows = new Map(list.map((p) => {
        const flags = p.flags | (p.dead ? FLAG.dead : 0) | (now - p.lastHurtAt < 400 ? FLAG.hurt : 0);
        return [p, snapshotRow(p.id, { ...p.state, flags, item: p.item }, p.health)];
      }));
      // Far-off players go out once a second, for the maps and the locator
      // bar — and on a crowded world once every five, or a public server
      // would spend everything it has telling everyone where everyone is.
      // Your party, wherever it is on the world, every second regardless.
      const farTick = list.length <= CROWD ? everySecond : this.tickCount % 50 === 0;
      for (const viewer of this.players.values()) {
        if (viewer.world !== world) continue;
        const out = [];
        for (const other of list) {
          if (other === viewer) continue;
          const near = viewer.state ? separation(viewer.state, other.state, radius) < NEAR_M : false;
          if (near || farTick || (everySecond && this.social.sameParty(viewer.key, other.key))) out.push(rows.get(other));
        }
        if (out.length) this.send(viewer.client, { t: 'snap', T: now, p: out });
      }
    }
  }

  /** Everything to disk, now. For shutdown. */
  saveAll() {
    // Ground found in the last half second is still waiting to go out to
    // everybody: out, and onto the shared map's file, before the stop - or
    // it vanished from everyone else's map at every restart and deploy.
    this.flushShared();
    for (const player of this.players.values()) this.remember(player);
    this.accounts.save();
    this.saveServer();
    return this.store.flush();
  }
}

/** Where a player was at time `t`, from their recent history. */
/**
 * How fast a player has really been going, in m/s east, up and north, from
 * the positions the server itself accepted over the last half second — never
 * the velocity the page says it has.
 */
function measuredVelocity(player, radius, now, windowMs = 500) {
  const h = player.history;
  if (h.length < 2) return [0, 0, 0];
  const last = h[h.length - 1];
  let first = h[h.length - 2];
  for (let i = h.length - 2; i >= 0 && last.t - h[i].t <= windowMs; i--) first = h[i];
  const dt = (last.t - first.t) / 1000;
  if (dt < 0.05 || now - last.t > 1000) return [0, 0, 0];
  const DEG = Math.PI / 180;
  const dLon = ((((last.lon - first.lon) + 540) % 360) + 360) % 360 - 180;
  const east = dLon * DEG * Math.cos(last.lat * DEG) * radius;
  const north = (last.lat - first.lat) * DEG * radius;
  return [east / dt, (last.alt - first.alt) / dt, north / dt];
}

/** The flight model's gravity on a world, m/s² (stepGlide's 0.08 blocks a tick², scaled). */
function flightGravity(body) {
  return FLIGHT_GRAVITY_MPS2 * gravityRatio(body);
}

/** The newest history entry at least as old as `t`. */
function before(history, t) {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].t <= t) return history[i];
  return null;
}

function positionAt(player, t) {
  const h = player.history;
  if (!h.length) return null;
  if (t <= h[0].t) return h[0];
  for (let i = 1; i < h.length; i++) {
    if (h[i].t >= t) {
      const a = h[i - 1];
      const b = h[i];
      const f = (t - a.t) / Math.max(1, b.t - a.t);
      return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, alt: a.alt + (b.alt - a.alt) * f };
    }
  }
  return h[h.length - 1];
}

export function deathMessage(name, cause, by) {
  switch (cause) {
    case 'slain': return by ? `${name} was slain by ${by}` : `${name} was slain`;
    case 'drowned': return `${name} drowned`;
    case 'suffocated': return `${name} ran out of oxygen`;
    case 'kill': return by ? `${name} gave up fighting ${by}` : `${name} gave up`;
    case 'fled': return by ? `${name} fled from ${by} and was counted dead` : `${name} fled a fight and was counted dead`;
    default: return `${name} died`;
  }
}

/** Voice signalling from one player to another, at most this much a second. */
const VOICE_BYTES_PER_S = 48 * 1024;
/** A hang-up may go to somebody you signalled within this long. */
const VOICE_CONTACT_MS = 10 * 60 * 1000;

/**
 * What a voice message may carry, rebuilt field by field: only the fields
 * the page sends, only as long as they ever need to be. Anything else is not
 * passed on at all.
 */
function voiceData(kind, data) {
  if (!data || typeof data !== 'object') return null;
  const text = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);
  const cid = text(data.cid, 32);
  switch (kind) {
    case 'offer':
      if (data.ask === true) return { ask: true };
    // falls through: an offer and an answer are both a session description
    case 'answer': {
      const sdp = text(data.sdp, 20000);
      return cid && sdp ? { cid, sdp } : null;
    }
    case 'ice': {
      if (!cid || !Array.isArray(data.c) || data.c.length > 20) return null;
      const c = [];
      for (const raw of data.c) {
        const candidate = text(raw?.candidate, 512);
        if (candidate === null) return null;
        c.push({
          candidate,
          sdpMid: text(raw.sdpMid, 16),
          sdpMLineIndex: Number.isInteger(raw.sdpMLineIndex) && raw.sdpMLineIndex >= 0 && raw.sdpMLineIndex < 16 ? raw.sdpMLineIndex : null,
          usernameFragment: text(raw.usernameFragment, 64),
        });
      }
      return { cid, c };
    }
    case 'bye':
      return { cid: cid ?? undefined, why: String(data.why ?? '').slice(0, 16) };
    default:
      return null;
  }
}

function isLoopback(address) {
  return /^(127\.|::1$|::ffff:127\.)/.test(String(address ?? ''));
}

/** This machine's IPv4 addresses on its local networks. */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address);
    }
  }
  return out.slice(0, 8);
}

/**
 * A player's line in the index: where they last were, and per world how much
 * they had explored (cells at the finest level) and how long their path is.
 */
function summarise(record, previous = null) {
  const worlds = {};
  for (const world of record.worlds()) {
    // A world this record has not opened has not changed since it was
    // counted: its old numbers stand, rather than decoding it to count again.
    const live = record.live.get(world);
    worlds[world] = live ? countsOf(live) : previous?.worlds?.[world] ?? countsOf(record.on(world));
  }
  return { world: record.world, worlds };
}

function countsOf(live) {
  return [live.explored.detailCount, live.trail.legs.reduce((n, leg) => n + leg.length, 0)];
}

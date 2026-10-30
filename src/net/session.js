import { Emitter } from '../core/events.js';
import { settings } from '../core/settings.js';
import { BOOT, relaunch, serverId } from '../core/boot.js';
import { readJSON, writeJSON } from '../core/storage.js';
import { BODIES, BODY, ON_EARTH } from '../geo/bodies.js';
import { WORLD_CIRCUMFERENCE } from '../geo/mercator.js';
import { Exploration } from '../ui/exploration.js';
import { exploration } from '../ui/exploration.js';
import { trail } from '../ui/trail.js';
import { waypoints } from '../ui/waypoints.js';
import { NetClient } from './client.js';
import { RemotePlayers, cleanColour } from './remotePlayers.js';

/** Friend preferences changed on this page while it was not connected, still to be sent. */
export const PREFS_UNSENT_KEY = 'social-prefs-unsent';
/** The settings the server keeps with your account, and its name for each. See sendSocialPrefs. */
const PREF_OF = { friendsAutoTpa: 'autoTpa', friendsAutoParty: 'autoParty', friendsAutoAccept: 'autoFriends', friendNotices: 'notify' };
export const SOCIAL_PREFS = Object.keys(PREF_OF);

/** A friend setting's value here, as the account stores it. */
function prefValue(key) {
  return key === 'friendNotices' ? settings.get(key) !== false : !!settings.get(key);
}

/** The same choice as the account has it, from a 'friends' message. */
function accountValue(key, prefs) {
  const name = PREF_OF[key];
  return key === 'friendNotices' ? prefs[name] !== false : !!prefs[name];
}

/** Only real friend choices, each true or false. */
function cleanPrefs(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of SOCIAL_PREFS) if (typeof raw[key] === 'boolean') out[key] = raw[key];
  return out;
}

/**
 * The friend choices changed here that the server has not yet confirmed, as
 * {setting: value}, in two lots: `prefs`, changed while signed in as
 * `account`, which are that account's alone; and `next`, changed while signed
 * in as nobody (the sign-in screen, playing locally), which go to whoever
 * signs in next. One at a time, each with its own value: it was a single
 * flag, and switching one choice on a fresh browser sent all four - the other
 * three whatever this browser happened to hold - over the account's. And one
 * lot, it was: a choice made on the sign-in screen joined the last account's
 * leftovers and was thrown away with them when somebody else signed in.
 */
function readUnsent() {
  const saved = readJSON(PREFS_UNSENT_KEY, null);
  const out = { account: null, prefs: {}, next: {} };
  // An older page's flag: everything it holds, for the next sign-in.
  if (saved === true) {
    out.next = Object.fromEntries(SOCIAL_PREFS.map((key) => [key, prefValue(key)]));
    return out;
  }
  if (!saved || typeof saved !== 'object') return out;
  if ('prefs' in saved || 'next' in saved) {
    const account = typeof saved.account === 'string' ? saved.account : null;
    if (account) {
      out.account = account;
      out.prefs = cleanPrefs(saved.prefs);
    } else {
      out.next = cleanPrefs(saved.prefs);
    }
    Object.assign(out.next, cleanPrefs(saved.next));
    return out;
  }
  // The round before's plain {setting: value}.
  out.next = cleanPrefs(saved);
  return out;
}

/** Everything still to be sent: signed in, `next` was folded into `prefs` (see onAuth). */
function unsentPrefs() {
  const was = readUnsent();
  return { ...was.prefs, ...was.next };
}

function writeUnsent({ account = null, prefs = {}, next = {} } = {}) {
  const any = Object.keys(prefs).length || Object.keys(next).length;
  writeJSON(PREFS_UNSENT_KEY, any ? { account: Object.keys(prefs).length ? account : null, prefs, next } : {});
}

/**
 * Note a friend choice changed here, to send - and to keep until the server
 * has it: as `account`'s if signed in, otherwise for whoever signs in next.
 */
export function markPrefUnsent(key, account = null) {
  if (!SOCIAL_PREFS.includes(key)) return;
  const was = readUnsent();
  if (account) {
    if (was.account !== account) {
      was.account = account;
      was.prefs = {};
    }
    was.prefs[key] = prefValue(key);
    delete was.next[key];
  } else {
    was.next[key] = prefValue(key);
  }
  writeUnsent(was);
}

/** A choice put back to what the account has: nothing left to send for it. */
function dropPrefUnsent(key) {
  const was = readUnsent();
  delete was.prefs[key];
  delete was.next[key];
  writeUnsent(was);
}

/** The friend choices as this page shows them now. */
function shownPrefs() {
  return Object.fromEntries(SOCIAL_PREFS.map((key) => [key, prefValue(key)]));
}
import { FLAG, ROCKET_STACK, SPEED_MODE_COOLDOWN_S, encodeState, nameKey } from './protocol.js';

/**
 * Playing on a server, from the page's side.
 *
 * This is the one place that knows both the game and the wire. It signs in,
 * puts you where the server says you are, tells the server where you go ten
 * times a second, and turns everything the server says into something the
 * game already knows how to do: a teleport, a hit, a line of chat, a player
 * appearing over the hill.
 *
 * What is yours on a server is the server's. The explored map, the trail and
 * the waypoints you see while online came from it at sign-in, and the local
 * save is never read or written while you are here — see core/storage.js.
 *
 * Events for the interface: 'auth', 'status', 'chat', 'roster', 'request',
 * 'requestEnd', 'died', 'overlays', 'atlas'.
 */

/** Ten updates a second while anything is changing, one a second at rest. */
const SEND_MS = 100;
const IDLE_SEND_MS = 1000;

export class OnlineSession extends Emitter {
  /**
   * @param {import('../game.js').Game} game
   */
  constructor(game) {
    super();
    this.game = game;
    this.net = new NetClient(BOOT.server);
    this.remote = new RemotePlayers({
      scene: game.scene,
      shared: game.shared,
      frame: game.frame,
      ui: game.ui,
      serverNow: () => this.net.serverNow(),
    });
    this.remote.isParty = (p) => this.inParty(p);
    this.you = null;
    this.rules = {};
    this.arrived = false;
    this.pendingTid = null;
    this.seq = 0;
    this.lastSent = 0;
    this.lastSentKey = '';
    /** Back from the background and not yet said so. See woke. */
    this.waking = false;
    this.requests = new Map();
    this.sent = new Map();
    /** Other players' discoveries and trails, by account name. See maps. */
    this.overlays = new Map();
    /**
     * Who you have switched on or off one by one, remembered for this server
     * and world: a reload, or a trip to the Moon and back, used to put every
     * one of them back to the defaults.
     */
    this.choicesKey = `overlay-choices.${serverId(BOOT.server)}.${BOOT.world}`;
    this.choices = readJSON(this.choicesKey, {}) ?? {};
    /**
     * Everybody's discoveries, or paths, at once — what the Online settings
     * say, and the server is told again on every sign-in, so it also covers
     * players who first come to this world later.
     */
    this.watchingAll = {
      explored: !!settings.get('othersDiscoveries'),
      trail: !!settings.get('othersTrails'),
    };
    this.atlas = [];
    /** Everything anybody has explored on this world, from the server; see sharedMap(). */
    this.shared = null;
    this.lander = null;
    this.spawn = BODY.spawn;
    /** Your friends, the requests either way, and what you let them do. */
    // prefs null until the server has said: before that, the account's
    // choices are not known, and nothing here can be compared with them.
    this.friends = { friends: [], incoming: [], outgoing: [], prefs: null };
    /** Your party as the server keeps it, or null. */
    this.party = null;
    /** Party invitations waiting for an answer, by party id. */
    this.partyInvites = new Map();
    this.swingBit = 0;
    this.bind();
  }

  get server() {
    return this.net.server;
  }

  get serverName() {
    return this.net.info?.name ?? serverId(this.net.server);
  }

  get signedIn() {
    return this.net.signedIn && !!this.you;
  }

  start() {
    this.net.connect();
  }

  bind() {
    const net = this.net;
    net.on('status', (s) => this.emit('status', s));
    net.on('needsAuth', (m) => this.emit('needsAuth', m));
    net.on('auth', (m) => this.onAuth(m));
    net.on('roster', (m) => {
      // The whole list: anyone not on it left while we were not listening.
      const ids = [];
      for (const entry of Array.isArray(m.players) ? m.players : []) {
        if (Number(entry?.id) === this.you?.id) continue;
        const p = this.remote.upsert(entry);
        if (p) ids.push(p.id);
      }
      this.remote.keepOnly(ids);
      this.emit('roster');
    });
    net.on('join', (m) => {
      if (Number(m.p?.id) !== this.you?.id) this.remote.upsert(m.p);
      this.emit('roster');
    });
    net.on('leave', (m) => {
      this.remote.remove(Number(m.id));
      this.emit('roster');
    });
    net.on('moved', (m) => {
      const p = this.remote.get(m.id);
      if (p) {
        p.world = m.world;
        p.snapshots.length = 0;
      }
      this.emit('roster');
    });
    net.on('dead', (m) => {
      const p = this.remote.get(m.id);
      if (p) p.dead = true;
      this.emit('roster');
    });
    net.on('alive', (m) => {
      const p = this.remote.get(m.id);
      if (p) p.dead = false;
      this.emit('roster');
    });
    net.on('snap', (m) => this.remote.snapshot(Number(m.T), m.p ?? []));
    net.on('hurt', (m) => this.remote.flash(m.id));
    net.on('chat', (m) => this.emit('chat', m));
    net.on('teleport', (m) => this.onTeleport(m));
    net.on('travelled', (m) => {
      this.emit('travelling', m);
      this.leaving = true;
      relaunch({ world: m.world, reason: `Travelling to ${BODIES[m.world]?.name ?? m.world}` });
    });
    net.on('correct', (m) => this.game.correctTo(m.lat, m.lon, m.alt));
    net.on('hit', (m) => this.onHit(m));
    net.on('health', (m) => this.game.player.setHealth(m.health));
    // The suit's tank, as the server counts it.
    net.on('oxygen', (m) => {
      if (Number.isFinite(m.oxygen)) this.game.player.oxygen = Math.max(0, m.oxygen);
    });
    net.on('died', (m) => {
      const stats = m.stats && Number.isFinite(m.stats.kills) ? { kills: m.stats.kills, deaths: m.stats.deaths } : null;
      const how = { cause: m.cause, by: m.by?.name ?? null, message: typeof m.message === 'string' ? m.message.slice(0, 200) : '', stats };
      // Usually dead already, by the hit that did it (see DeathScreen.update).
      if (this.game.player.dead) this.game.deathScreen?.update(how);
      else this.game.player.die(how);
    });
    net.on('hitConfirm', (m) => this.emit('hitConfirm', m));
    // The answer to a new password, from the form or /password.
    net.on('password', (m) => this.emit('password', {
      ok: m.ok === true,
      error: m.ok === true ? '' : String(m.error ?? 'The password was not changed').slice(0, 200),
    }));
    net.on('tpreq', (raw) => {
      const m = cleanRequest(raw, 'from');
      if (!m) return;
      // One request from anyone at a time: a new one replaces theirs.
      for (const [id, r] of this.requests) {
        if (r.from.id === m.from.id) this.endRequest(id, 'replaced');
      }
      this.requests.set(m.id, m);
      this.emit('request', m);
    });
    net.on('tpsent', (raw) => {
      const m = cleanRequest(raw, 'to');
      if (!m) return;
      for (const [id, r] of this.sent) {
        if (r.to.id === m.to.id) this.endRequest(id, 'replaced');
      }
      this.sent.set(m.id, m);
      this.emit('requestSent', m);
    });
    net.on('tpreq-end', (m) => this.endRequest(Number(m.id), String(m.reason ?? '')));
    net.on('explored', (m) => {
      if (m.world !== BOOT.world) return;
      const overlay = this.overlay(m.name);
      overlay.explored = new Exploration({ circumference: WORLD_CIRCUMFERENCE, stored: false, compact: true });
      overlay.explored.mergeCells(m.cells);
      this.emit('overlays');
    });
    net.on('shared', (m) => {
      if (m.world !== BOOT.world) return;
      // Sent in parts; the first starts it afresh.
      if (!m.part || !this.shared) {
        // As runs (ui/cellRuns.js): a busy server's map is millions of
        // squares, and as a Set of their names that was 50 to 100 bytes each.
        this.shared = new Exploration({ circumference: WORLD_CIRCUMFERENCE, stored: false, compact: true });
        // Its coverage counted a part at a time as it arrives, not all at once
        // the first time the world map is opened - which on a server a lot of
        // people have flown over is millions of squares in one go.
        this.shared.covered = 0;
        // Its land too, on Earth, the only world the land figure is for.
        if (ON_EARTH) this.shared.landCovered = 0;
        // With your own ground in it, as your new ground goes in while you fly
        // (game.js): past a day's share (the server's SHARED_PER_DAY) it is not
        // on the server's copy, and everybody's figure read less than yours.
        this.shared.merge(exploration.cells);
      }
      this.shared.mergeCells(m.cells);
      this.emit('overlays');
    });
    net.on('shared+', (m) => {
      if (m.world !== BOOT.world || !this.shared) return;
      this.shared.merge(Array.isArray(m.keys) ? m.keys : []);
      this.emit('overlays');
    });
    net.on('explored+', (m) => {
      if (m.world !== BOOT.world) return;
      const overlay = this.overlays.get(m.name);
      if (overlay?.explored) overlay.explored.merge(m.keys ?? []);
      this.emit('overlays');
    });
    net.on('trail', (m) => {
      if (m.world !== BOOT.world) return;
      this.overlay(m.name).legs = (m.legs ?? []).map((leg) => leg.map(([lat, lon]) => ({ lat, lon })));
      this.emit('overlays');
    });
    net.on('trail+', (m) => {
      if (m.world !== BOOT.world) return;
      const overlay = this.overlays.get(m.name);
      if (!overlay?.legs) return;
      const point = { lat: m.p[0], lon: m.p[1] };
      if (m.leg || overlay.legs.length === 0) overlay.legs.push([point]);
      else overlay.legs[overlay.legs.length - 1].push(point);
      this.emit('overlays');
    });
    net.on('atlas', (m) => {
      if (m.world !== BOOT.world) return;
      this.atlas = m.players ?? [];
      for (const entry of this.atlas) {
        const overlay = this.overlay(entry.key);
        overlay.name = entry.name;
        overlay.colour = entry.colour;
      }
      this.emit('atlas', this.atlas);
    });
    net.on('lander', (m) => {
      this.lander = m.lander;
      this.emit('lander', m.lander);
    });
    net.on('kick', (m) => this.emit('kicked', m));
    net.on('friends', (m) => {
      const list = (v) => (Array.isArray(v) ? v.map(cleanWho).filter(Boolean).slice(0, 200) : []);
      this.friends = {
        friends: list(m.friends),
        incoming: list(m.incoming),
        outgoing: list(m.outgoing),
        prefs: m.prefs && typeof m.prefs === 'object' ? { ...m.prefs } : null,
      };
      // The account's choices are the ones that count: they came back here
      // and were only kept, while the page sent its own over the top on every
      // sign-in - so a second browser, or cleared site data, quietly turned
      // auto-accept off. Except a choice changed here that the server does
      // not have yet: that one stays as it is here, and is forgotten as
      // unsent only once the server says it has it - not when it was sent,
      // which on a connection that had quietly died was never.
      if (m.prefs && typeof m.prefs === 'object') {
        const was = readUnsent();
        for (const lot of [was.prefs, was.next]) {
          for (const key of Object.keys(lot)) if (accountValue(key, m.prefs) === lot[key]) delete lot[key];
        }
        writeUnsent(was);
        const unsent = { ...was.prefs, ...was.next };
        this.applyingPrefs = true;
        try {
          for (const key of SOCIAL_PREFS) {
            if (key in unsent) continue;
            const value = accountValue(key, m.prefs);
            if (prefValue(key) !== value) settings.set(key, value);
          }
        } finally {
          this.applyingPrefs = false;
        }
      }
      this.emit('friends', this.friends);
    });
    net.on('party', (m) => {
      this.party = cleanParty(m.party);
      this.emit('party', this.party);
    });
    // A party that ended, its waypoints on this world handed to you to keep:
    // into your own, which then sync back like any you made.
    net.on('partyKept', (m) => {
      const list = Array.isArray(m.waypoints) ? m.waypoints.slice(0, 50) : [];
      for (const w of list) {
        const lat = Number(w?.lat);
        const lon = Number(w?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) continue;
        if (waypoints.waypoints.some((o) => Math.abs(o.lat - lat) < 1e-6 && Math.abs(o.lon - lon) < 1e-6)) continue;
        waypoints.add(lat, lon, String(w.name ?? '').slice(0, 60), 0);
      }
    });
    net.on('partyInvite', (m) => {
      const from = cleanWho(m.from);
      const id = Number(m.party);
      if (!from || !Number.isSafeInteger(id)) return;
      const expiresIn = Number(m.expiresIn);
      this.partyInvites.set(id, { id, from, expiresIn: expiresIn > 0 && expiresIn <= 600 ? expiresIn : 60, at: performance.now() });
      this.emit('partyInvite', this.partyInvites.get(id));
    });
    net.on('partyInviteEnd', (m) => {
      if (this.partyInvites.delete(Number(m.party))) this.emit('partyInviteEnd', { id: Number(m.party), reason: String(m.reason ?? '') });
    });

    // The page's own events, out to the server.
    this.game.player.on('damageRequest', (how) => {
      this.net.send({ t: 'damage', amount: how.amount, cause: how.cause });
    });
    // What the friend choices showed before a reset or an import: see 'bulk'.
    let shown = shownPrefs();
    settings.on('change', ({ key, value }) => {
      if (SOCIAL_PREFS.includes(key)) {
        shown = shownPrefs();
        if (!this.applyingPrefs) {
          markPrefUnsent(key, this.accountKey);
          if (this.signedIn) this.sendSocialPrefs();
        }
      }
      if (key === 'othersDiscoveries') this.watchAll('explored', !!value);
      if (key === 'othersTrails') this.watchAll('trail', !!value);
    });
    settings.on('bulk', () => {
      for (const [what, key] of [['explored', 'othersDiscoveries'], ['trail', 'othersTrails']]) {
        if (!!settings.get(key) !== this.watchingAll[what]) this.watchAll(what, !!settings.get(key));
      }
      // Reset or imported all at once: a friend choice it changed is a change
      // like any other. It used to show off here while the server kept it on
      // - and strangers kept becoming friends. One put back to what the
      // account has is nothing to send - and an older change still waiting
      // for it goes, or it won the next sign-in. A choice it left as it was
      // is not a change at all: on the sign-in screen, where the account's
      // are not known yet, all four used to be sent - a file holding only the
      // mouse speed handed the next account the last one's auto-accept.
      const before = shown;
      shown = shownPrefs();
      if (this.applyingPrefs) return;
      const account = this.friends?.prefs ?? null;
      let changed = false;
      for (const key of SOCIAL_PREFS) {
        if (shown[key] === before[key]) continue;
        if (account && accountValue(key, account) === shown[key]) {
          dropPrefUnsent(key);
        } else {
          markPrefUnsent(key, this.accountKey);
          changed = true;
        }
      }
      if (changed && this.signedIn) this.sendSocialPrefs();
    });
    waypoints.on('change', () => {
      if (this.applying) return;
      if (this.signedIn) this.net.send({ t: 'waypoints', list: waypoints.export().waypoints });
      // Changed while the connection was down: sent when it is back, rather
      // than overwritten by the server's older list.
      else if (this.you) this.waypointsUnsent = true;
    });
  }

  endRequest(id, reason) {
    const asked = this.requests.delete(id);
    const sent = this.sent.delete(id);
    if (!asked && !sent) return;
    this.emit('requestEnd', { id, reason });
  }

  /**
   * Requests the server forgot to close — a lost message, a server that went
   * away — run out here too, a moment after they would have there.
   */
  expireRequests(now = performance.now()) {
    for (const list of [this.requests, this.sent]) {
      for (const [id, r] of list) {
        if (now - r.at > (r.expiresIn + 2) * 1000) this.endRequest(id, 'expired');
      }
    }
    for (const [id, invite] of this.partyInvites) {
      if (now - invite.at > (invite.expiresIn + 2) * 1000) {
        this.partyInvites.delete(id);
        this.emit('partyInviteEnd', { id, reason: 'expired' });
      }
    }
  }

  overlay(key) {
    let overlay = this.overlays.get(key);
    if (!overlay) {
      const remote = this.remote.byName(key);
      overlay = {
        key,
        name: remote?.name ?? key,
        colour: remote?.colour ?? '#9aa4b2',
        explored: null,
        legs: null,
        showExplored: !!this.choices[key]?.explored,
        showTrail: this.choices[key]?.trail ?? this.watchingAll.trail,
      };
      this.overlays.set(key, overlay);
    }
    return overlay;
  }

  /**
   * Switch another player's discoveries or trail on or off on your map.
   * The server sends what it has and keeps it coming while it is on.
   */
  watch(key, { explored, trail }) {
    const overlay = this.overlay(key);
    if (explored !== undefined) overlay.showExplored = explored;
    if (trail !== undefined) overlay.showTrail = trail;
    this.choices[key] = { explored: overlay.showExplored, trail: overlay.showTrail };
    writeJSON(this.choicesKey, this.choices);
    this.net.send({ t: 'watch', name: key, explored: overlay.showExplored, trail: overlay.showTrail });
    this.emit('overlays');
  }

  /**
   * Everyone's discoveries ('explored') or paths ('trail') at once, on or off:
   * everybody known on this world now, and — the server remembers it —
   * anybody who turns up later.
   */
  watchAll(what, on) {
    this.watchingAll[what] = on;
    // Everyone's discoveries are one shared map; everyone's paths are a line
    // each, in each player's colour.
    if (what === 'trail') {
      for (const entry of this.atlas) this.overlay(entry.key).showTrail = on;
      for (const overlay of this.overlays.values()) overlay.showTrail = on;
      // "Everyone" overrides the one-by-one choices of paths.
      for (const choice of Object.values(this.choices)) delete choice.trail;
      writeJSON(this.choicesKey, this.choices);
    }
    this.net.send({ t: 'watch', name: '*', explored: what === 'explored', trail: what === 'trail', off: !on });
    this.emit('overlays');
  }

  /**
   * After signing in, the server knows nothing of what this page was
   * showing — a reconnect starts it afresh — so all of it is asked for again.
   */
  rewatch() {
    // Everyone's discoveries are asked for whether they are shown or not: the
    // world map counts how much of the world everybody has explored between
    // them, and the server sends the map once a connection, so switching the
    // setting off only stops it being drawn.
    this.net.send({ t: 'watch', name: '*', explored: true, trail: false });
    if (this.watchingAll.trail) this.net.send({ t: 'watch', name: '*', explored: false, trail: true });
    // Everyone you chose one by one, including from before this page loaded.
    for (const key of Object.keys(this.choices)) this.overlay(key);
    for (const overlay of this.overlays.values()) {
      if (!overlay.showExplored && overlay.showTrail === this.watchingAll.trail) continue;
      this.net.send({ t: 'watch', name: overlay.key, explored: overlay.showExplored, trail: overlay.showTrail });
    }
  }

  requestAtlas() {
    this.net.send({ t: 'atlas' });
  }

  /* -------------------------------------------------------- signing in */

  onAuth(m) {
    if (!m.ok) {
      this.emit('authFailed', m);
      return;
    }
    this.you = { ...m.you, id: Number(m.you?.id) };
    this.rules = m.rules ?? {};
    // A new sign-in, perhaps after a dropped connection: the server's lists
    // start again from nothing, so ours do too. The roster follows.
    for (const id of [...this.requests.keys(), ...this.sent.keys()]) this.endRequest(id, 'reconnected');
    this.partyInvites.clear();
    this.remote.clear();
    this.iceServers = m.iceServers ?? [];
    this.spawn = m.spawn ?? BODY.spawn;
    this.lander = m.lander ?? null;
    this.emit('auth', m);
    if (m.world !== BOOT.world) {
      // The server has you on another world: go there. The page comes back
      // signed in, on the right body, at the right spot.
      this.leaving = true;
      relaunch({ world: m.world, reason: `Joining ${this.serverName} on ${BODIES[m.world]?.name ?? m.world}` });
      return;
    }
    // Your record, as the server keeps it, replaces whatever this page had.
    this.applying = true;
    exploration.cells.clear();
    exploration.detailCount = 0;
    // And forget where the last visit was, or the ground round where you stand
    // is not counted until you have moved a good way from it.
    exploration.lastVisit = null;
    exploration.coarseCache.clear();
    exploration.covered = null;
    exploration.landCovered = null;
    exploration.mergeCells(m.explored ?? []);
    trail.legs = Array.isArray(m.trail) ? m.trail.map((leg) => leg.map(([lat, lon]) => ({ lat, lon }))) : [];
    trail.last = null;
    if (!this.waypointsUnsent) waypoints.import({ waypoints: m.waypoints ?? [] });
    this.applying = false;
    if (this.waypointsUnsent) {
      this.waypointsUnsent = false;
      this.net.send({ t: 'waypoints', list: waypoints.export().waypoints });
    }

    const player = this.game.player;
    player.authority = 'server';
    player.revive();
    player.setHealth(m.health ?? player.maxHealth);
    // Not a fresh tank because the page was reloaded: what the server has.
    if (Number.isFinite(m.oxygen)) player.oxygen = Math.max(0, m.oxygen);
    // Nor a full set of rockets.
    if (Array.isArray(m.rockets) && m.rockets.length === player.stock.length) {
      player.stock = m.rockets.map((n) => Math.max(0, Math.min(ROCKET_STACK, Math.floor(Number(n) || 0))));
    }
    this.rocketsSent = player.stock.join();
    // Nor a surge the server is still recharging: its clock is the account's.
    const surgeIn = Number(m.surgeIn);
    if (surgeIn > 0 && !player.speedActive) {
      player.speedCooldown = Math.max(player.speedCooldown, Math.min(SPEED_MODE_COOLDOWN_S, surgeIn));
    }
    this.arrived = false;
    const pos = m.pos ?? this.spawn;
    this.game.teleportTo(pos.lat, pos.lon, {
      reason: 'online',
      quiet: true,
      flying: !!pos.flying,
      altitude: Number.isFinite(pos.alt) ? pos.alt : undefined,
    });
    this.arrive(0);
    this.requestAtlas();
    this.rewatch();
    // Only what was changed here while away - as this account, or before any
    // sign-in; another account's leftovers are not this one's. Otherwise the
    // account's stand.
    const was = readUnsent();
    const prefs = { ...(was.account === this.accountKey ? was.prefs : {}), ...was.next };
    writeUnsent({ account: this.accountKey, prefs });
    if (Object.keys(prefs).length) this.sendSocialPrefs();
  }

  /** What your friends may do without asking, and whether to hear about them. */
  sendSocialPrefs() {
    // Only the choices changed here, each by the account's name for it; the
    // server keeps the rest as they are. Still marked unsent until its answer
    // (the 'friends' it sends back) shows it has them.
    const unsent = unsentPrefs();
    const fields = Object.fromEntries(Object.entries(unsent).map(([key, value]) => [PREF_OF[key], value]));
    if (!Object.keys(fields).length) return;
    this.net.send({ t: 'socialPrefs', ...fields });
  }

  /* ------------------------------------------------- friends and parties */

  isFriend(name) {
    const key = String(name ?? '').toLowerCase();
    return this.friends.friends.some((f) => f.key === key);
  }

  /** Is this player — by name, or a remote player — in your party? */
  inParty(who) {
    if (!this.party) return false;
    const key = String(typeof who === 'object' ? who?.name : who ?? '').toLowerCase();
    return this.party.members.some((m) => m.key === key);
  }

  get partyLeader() {
    return !!this.party && this.party.leader === this.you?.name?.toLowerCase();
  }

  /** Friend and party actions from the panel: their own message, not chat - see the server's onSocial. */
  friend(sub, name = '') {
    return this.net.send({ t: 'social', cmd: 'friend', op: String(sub), name: String(name ?? '') });
  }

  partyCommand(sub, name = '') {
    return this.net.send({ t: 'social', cmd: 'party', op: String(sub), name: String(name ?? '') });
  }

  /** Answer a party invitation by its party's id. */
  answerParty(id, accept) {
    const invite = this.partyInvites.get(id);
    if (!invite) return;
    this.partyCommand(accept ? 'accept' : 'deny', invite.from.name);
  }

  /** A waypoint for the whole party, here or wherever the map says. */
  partyMark(name, lat, lon) {
    this.net.send({ t: 'partyMark', name, lat, lon, world: BOOT.world });
  }

  partyUnmark(id) {
    this.net.send({ t: 'partyUnmark', id });
  }

  /** The party's waypoints on this world, for the maps and the compass. */
  partyWaypoints() {
    return (this.party?.waypoints ?? []).filter((w) => w.world === BOOT.world);
  }

  arrive(tid) {
    this.arrived = true;
    this.pendingTid = null;
    this.net.send({ t: 'arrived', tid });
    this.sendState(true);
  }

  onTeleport(m) {
    if (m.world && m.world !== BOOT.world) {
      this.leaving = true;
      relaunch({ world: m.world, reason: `Teleporting to ${BODIES[m.world]?.name ?? m.world}` });
      return;
    }
    this.game.teleportTo(m.lat, m.lon, {
      reason: m.reason === 'rtp' ? 'rtp' : 'server',
      quiet: m.reason !== 'tpa',
      flying: !!m.flying,
      altitude: Number.isFinite(m.alt) ? m.alt : undefined,
      yaw: Number.isFinite(m.yaw) ? m.yaw : undefined,
    });
    if (m.reason === 'respawn') this.game.player.revive();
    this.arrive(m.tid);
  }

  onHit(m) {
    const player = this.game.player;
    if (Array.isArray(m.kb)) {
      // East, up, north, into the frame.
      player.knock(m.kb[0], m.kb[1], -m.kb[2]);
    }
    player.setHealth(m.health, { cause: m.cause, by: m.by?.name ?? null, crit: !!m.crit });
    this.emit('hit', m);
  }

  /* ------------------------------------------------------------ sending */

  /** What a rocket flag, a surge, a swing look like on the wire. */
  flags(player, input) {
    let f = 0;
    if (player.onGround) f |= FLAG.ground;
    if (player.elytraDeployed) f |= FLAG.elytra;
    if (player.swimming) f |= FLAG.swim;
    if (player.rocketTicksLeft > 0) f |= FLAG.rocket;
    if (player.speedActive) f |= FLAG.surge;
    if (input?.crouch) f |= FLAG.crouch;
    if (input?.sprint) f |= FLAG.sprint;
    if (player.swings % 2 === 1) f |= FLAG.swing;
    if (this.talking) f |= FLAG.talking;
    return f;
  }

  /**
   * The tab is back from the background, where the game flies none of the
   * time it was hidden: the next state says so. The server leaves that time
   * out of what it judges a fall's speed by - as it does for a frame that took
   * long to draw, but all of it - instead of reading it as a pilot who stopped.
   */
  woke() {
    this.waking = true;
  }

  sendState(force = false, input = null) {
    if (!this.signedIn || !this.arrived || this.leaving) return;
    const now = performance.now();
    const player = this.game.player;
    if (player.dead) return;
    const geo = this.game.frame.toGeo(player.position.x, player.position.z);
    const flags = this.flags(player, input ?? this.lastInput) | (this.waking ? FLAG.woke : 0);
    const state = {
      seq: ++this.seq,
      lat: geo.lat,
      lon: geo.lon,
      alt: player.position.y,
      agl: player.altitudeAboveGround,
      vel: [
        player.velocity.x * player.speedMultiplier,
        player.velocity.y * player.speedMultiplier,
        -player.velocity.z * player.speedMultiplier,
      ],
      yaw: player.yaw,
      pitch: player.pitch,
      roll: player.roll,
      flags,
      item: player.selectedSlot,
    };
    // At rest, once a second is enough; anything changing goes ten times one.
    const key = `${geo.lat.toFixed(6)},${geo.lon.toFixed(6)},${player.position.y.toFixed(1)},${player.yaw.toFixed(2)},${player.pitch.toFixed(2)},${flags},${state.item}`;
    const since = now - this.lastSent;
    if (!force && (since < SEND_MS || (key === this.lastSentKey && since < IDLE_SEND_MS))) return;
    this.lastSent = now;
    this.lastSentKey = key;
    this.waking = false;
    this.net.send(encodeState(state));
  }

  /** Per frame, from the game loop. */
  update(dt, camera, input, rebaseX, rebaseZ) {
    this.lastInput = input;
    this.sendState(false, input);
    // The rocket stock, to be kept with you, every few seconds it changes.
    this.rocketsTimer = (this.rocketsTimer ?? 0) + dt;
    if (this.rocketsTimer > 5 && this.signedIn) {
      this.rocketsTimer = 0;
      const stock = this.game.player.stock;
      if (stock.join() !== this.rocketsSent) {
        this.rocketsSent = stock.join();
        this.net.send({ t: 'rockets', stock });
      }
    }
    this.remote.update(camera, dt, BOOT.world, rebaseX, rebaseZ);
    // Requests that have run out on this side too, so the countdown on the
    // prompt never shows a negative number while the server's word is late.
    this.expireRequests();
  }

  /* ------------------------------------------------------------ actions */

  chat(text) {
    return this.net.send({ t: 'chat', text });
  }

  /**
   * A swing that connected, for the server to judge.
   *
   * The state goes first, always. The server checks the sword is in your hand
   * against the last state it has, and a swing made the moment you drew the
   * sword — inside the tenth of a second before the next update was due —
   * reached it holding a rocket and was refused. One socket keeps the two in
   * order, so sending the state first is all it takes.
   */
  attack(targetId) {
    this.sendState(true);
    this.net.send({ t: 'attack', target: targetId });
  }

  respawn() {
    this.net.send({ t: 'respawn' });
  }

  travel(world) {
    this.net.send({ t: 'chat', text: `/travel ${world}` });
  }

  randomTeleport() {
    this.net.send({ t: 'rtp' });
  }

  placeLander() {
    this.net.send({ t: 'lander' });
  }

  answer(id, accept) {
    const request = this.requests.get(id);
    if (!request) return;
    this.net.send({ t: 'chat', text: `/${accept ? 'tpaccept' : 'tpdeny'} ${request.from.name}` });
  }

  /** Online players on this world and elsewhere, for the panel and the maps. */
  players() {
    return this.remote.list();
  }

  /** A new password, sent whole: see the server's onPassword. */
  changePassword(oldPassword, newPassword) {
    this.net.send({ t: 'password', old: String(oldPassword ?? ''), new: String(newPassword ?? '') });
  }

  /** The signed-in account, as the server keys it. */
  get accountKey() {
    return this.you?.name ? nameKey(this.you.name) : null;
  }

  /** Sign out of this server and go back to playing locally. */
  leaveServer({ forget = false } = {}) {
    // Signing out: whatever this account had not had confirmed is its own,
    // and not for whoever signs in here next.
    if (forget) writeUnsent();
    if (forget) this.net.logout();
    this.net.disconnect();
    this.leaving = true;
    relaunch({ mode: 'local', reason: 'Back to playing locally' });
  }
}

/** A teleport request as the server sent it, made safe to show. */
function cleanRequest(m, side) {
  const id = Number(m?.id);
  const who = m?.[side];
  const whoId = Number(who?.id);
  if (!Number.isSafeInteger(id) || !Number.isSafeInteger(whoId)) return null;
  const expiresIn = Number(m.expiresIn);
  return {
    id,
    kind: m.kind === 'tpahere' ? 'tpahere' : 'tpa',
    [side]: {
      id: whoId,
      name: String(who.name ?? '').slice(0, 32),
      colour: cleanColour(who.colour),
      world: String(who.world ?? '').slice(0, 24),
    },
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? Math.min(expiresIn, 600) : 40,
    at: performance.now(),
  };
}

/** Somebody as the server names them in a friends list or a party: safe to show. */
function cleanWho(w) {
  if (!w || typeof w !== 'object') return null;
  const key = String(w.key ?? w.name ?? '').toLowerCase().slice(0, 32);
  if (!/^[a-z0-9_]{1,32}$/.test(key)) return null;
  const id = Number(w.id);
  return {
    key,
    name: String(w.name ?? key).slice(0, 32),
    colour: cleanColour(w.colour),
    online: !!w.online,
    world: String(w.world ?? '').slice(0, 24),
    id: Number.isSafeInteger(id) ? id : null,
  };
}

/** The party message, made safe to show; null for "no party". */
function cleanParty(p) {
  if (!p || typeof p !== 'object') return null;
  const members = (Array.isArray(p.members) ? p.members : []).slice(0, 16).map((m) => {
    const who = cleanWho(m);
    return who ? { ...who, together: !!m.together, leader: !!m.leader } : null;
  }).filter(Boolean);
  if (!members.length) return null;
  const waypoints = (Array.isArray(p.waypoints) ? p.waypoints : []).slice(0, 100).map((w) => {
    const lat = Number(w?.lat);
    const lon = Number(w?.lon);
    const id = Number(w?.id);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isSafeInteger(id)) return null;
    return {
      id,
      name: String(w.name ?? '').slice(0, 40),
      world: String(w.world ?? '').slice(0, 24),
      lat,
      lon,
      by: String(w.by ?? '').slice(0, 32),
      colour: cleanColour(w.colour),
    };
  }).filter(Boolean);
  return {
    id: Number(p.id) || 0,
    leader: String(p.leader ?? '').toLowerCase().slice(0, 32),
    members,
    invited: (Array.isArray(p.invited) ? p.invited : []).map(cleanWho).filter(Boolean).slice(0, 16),
    waypoints,
  };
}

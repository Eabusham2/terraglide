import { Emitter } from '../core/events.js';
import { BOOT, relaunch, serverId } from '../core/boot.js';
import { BODIES, BODY } from '../geo/bodies.js';
import { WORLD_CIRCUMFERENCE } from '../geo/mercator.js';
import { Exploration, decodeCells } from '../ui/exploration.js';
import { exploration } from '../ui/exploration.js';
import { trail } from '../ui/trail.js';
import { waypoints } from '../ui/waypoints.js';
import { NetClient } from './client.js';
import { RemotePlayers } from './remotePlayers.js';
import { FLAG, encodeState } from './protocol.js';

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
    this.you = null;
    this.rules = {};
    this.arrived = false;
    this.pendingTid = null;
    this.seq = 0;
    this.lastSent = 0;
    this.lastSentKey = '';
    this.requests = new Map();
    this.sent = new Map();
    /** Other players' discoveries and trails, by account name. See maps. */
    this.overlays = new Map();
    this.atlas = [];
    this.lander = null;
    this.spawn = BODY.spawn;
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
      for (const entry of m.players) {
        if (entry.id !== this.you?.id) this.remote.upsert(entry);
      }
      this.emit('roster');
    });
    net.on('join', (m) => {
      if (m.p.id !== this.you?.id) this.remote.upsert(m.p);
      this.emit('roster');
    });
    net.on('leave', (m) => {
      this.remote.remove(m.id);
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
    net.on('died', (m) => {
      this.game.player.die({ cause: m.cause, by: m.by?.name ?? null, message: m.message });
    });
    net.on('hitConfirm', (m) => this.emit('hitConfirm', m));
    net.on('tpreq', (m) => {
      this.requests.set(m.id, { ...m, at: performance.now() });
      this.emit('request', m);
    });
    net.on('tpsent', (m) => {
      this.sent.set(m.id, { ...m, at: performance.now() });
      this.emit('requestSent', m);
    });
    net.on('tpreq-end', (m) => {
      this.requests.delete(m.id);
      this.sent.delete(m.id);
      this.emit('requestEnd', m);
    });
    net.on('explored', (m) => {
      if (m.world !== BOOT.world) return;
      const overlay = this.overlay(m.name);
      overlay.explored = new Exploration({ circumference: WORLD_CIRCUMFERENCE, stored: false });
      overlay.explored.merge(decodeCells(m.cells));
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

    // The page's own events, out to the server.
    this.game.player.on('damageRequest', (how) => {
      this.net.send({ t: 'damage', amount: how.amount, cause: how.cause });
    });
    waypoints.on('change', () => {
      if (this.signedIn && !this.applying) this.net.send({ t: 'waypoints', list: waypoints.export() });
    });
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
        showExplored: false,
        showTrail: false,
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
    this.net.send({ t: 'watch', name: key, explored: overlay.showExplored, trail: overlay.showTrail });
    this.emit('overlays');
  }

  /** Everyone at once: the whole server's map of this world. */
  watchEveryone(on) {
    for (const entry of this.atlas) {
      const overlay = this.overlay(entry.key);
      overlay.showExplored = on;
      overlay.showTrail = on;
    }
    this.net.send({ t: 'watch', name: '*', explored: true, trail: true, off: !on });
    this.emit('overlays');
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
    this.you = m.you;
    this.rules = m.rules ?? {};
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
    exploration.merge(decodeCells(m.explored ?? []));
    trail.legs = Array.isArray(m.trail) ? m.trail.map((leg) => leg.map(([lat, lon]) => ({ lat, lon }))) : [];
    trail.last = null;
    waypoints.import(m.waypoints ?? [], { replace: true });
    this.applying = false;

    const player = this.game.player;
    player.authority = 'server';
    player.revive();
    player.setHealth(m.health ?? player.maxHealth);
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

  sendState(force = false, input = null) {
    if (!this.signedIn || !this.arrived || this.leaving) return;
    const now = performance.now();
    const player = this.game.player;
    if (player.dead) return;
    const geo = this.game.frame.toGeo(player.position.x, player.position.z);
    const flags = this.flags(player, input ?? this.lastInput);
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
    this.net.send(encodeState(state));
  }

  /** Per frame, from the game loop. */
  update(dt, camera, input, rebaseX, rebaseZ) {
    this.lastInput = input;
    this.sendState(false, input);
    this.remote.update(camera, dt, BOOT.world, rebaseX, rebaseZ);
    // Requests that have run out on this side too, so the countdown on the
    // prompt never shows a negative number while the server's word is late.
    const now = performance.now();
    for (const [id, request] of this.requests) {
      if (now - request.at > (request.expiresIn ?? 40) * 1000 + 2000) {
        this.requests.delete(id);
        this.emit('requestEnd', { id, reason: 'expired' });
      }
    }
  }

  /* ------------------------------------------------------------ actions */

  chat(text) {
    return this.net.send({ t: 'chat', text });
  }

  attack(targetId) {
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

  /** Sign out of this server and go back to playing locally. */
  leaveServer({ forget = false } = {}) {
    if (forget) this.net.logout();
    this.net.disconnect();
    this.leaving = true;
    relaunch({ mode: 'local', reason: 'Back to playing locally' });
  }
}
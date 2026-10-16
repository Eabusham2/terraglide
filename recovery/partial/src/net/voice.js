import { BOOT } from '../core/boot.js';
import { Emitter } from '../core/events.js';
import { settings as sharedSettings } from '../core/settings.js';
import { VOICE_CONNECT_M, VOICE_FULL_M, VOICE_RANGE_M } from './protocol.js';

/**
 * Proximity voice: the people flying near you, heard from where they are.
 *
 * The audio goes browser to browser over WebRTC. The server never touches it;
 * all it carries is the handshake — offers, answers and network candidates —
 * relayed between two players on the same world who are close enough to hear
 * each other (see onVoice in server/game.mjs). That keeps a hobby server's
 * bandwidth bill at the size of a chat room however much talking goes on.
 *
 * Who calls whom. Two pages that both decide "we are in range" at the same
 * moment and both send an offer is the classic WebRTC collision, and range is
 * symmetric, so here it would be the normal case rather than the rare one. So
 * only the lower player id ever opens a connection. The higher one, if it has
 * waited a moment and nothing has arrived — because the lower one has voice
 * off, or was mid-respawn, or turned it on later — sends an offer with no
 * description in it, just `{ask: true}`, which the lower one answers by
 * calling. Every connection carries a random `cid` so a message about a
 * connection that has since been closed and reopened is recognised as stale
 * and dropped instead of being applied to its successor. Renegotiating an
 * existing connection — the microphone arriving after it was set up listen-
 * only — can start from either side, so that uses the "perfect negotiation"
 * pattern from the WebRTC specification, with the higher id as the polite
 * peer that gives way when both offer at once.
 *
 * What you hear. Each voice runs through its own chain:
 *
 *   remote stream -> source -> gain (mute) -> panner (HRTF) -> master (volume) -> speakers
 *                          \-> analyser (are they talking?)
 *
 * The panner uses the linear distance model between VOICE_FULL_M and
 * VOICE_RANGE_M, so somebody is at full volume close in and fades evenly to
 * nothing at the edge of range — the curve a player can actually learn, which
 * the inverse-square default is not: it is still loud at ten times the
 * reference distance and never reaches silence at all.
 *
 * Positions are given to Web Audio relative to the camera, with the listener
 * left at the origin and only turned. The local frame is rebased as you fly
 * (see game.js rebase()), and handing the audio graph absolute coordinates
 * would mean every rebase dragged every voice across the sky while the
 * smoothing caught up; relative ones do not change when the origin moves.
 *
 * Nothing here draws anything. The HUD indicator and the settings rows are
 * the interface's; this module only says, through status() and its events,
 * what there is to show.
 *
 * Events: 'status' (the status() string, when it changes), 'talking' (you
 * started or stopped talking), 'speakers' (the ids of whoever is talking now),
 * 'drop' ({id, why} when a connection closes), 'mute' ({id, muted}).
 */

/** A connection opened inside VOICE_CONNECT_M is kept until this, so a voice at the edge does not flap. */
const KEEP_M = VOICE_CONNECT_M * 1.25;

/**
 * Used when the server hands out none. Public STUN finds the address a
 * router presents to the outside, which is enough for most home networks; a
 * TURN relay for the rest is the server operator's to add (server/config.mjs).
 */
const FALLBACK_ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

/**
 * The browser's own voice processing, all of it. Echo cancellation matters
 * most: without it everyone near you hears themselves come back out of your
 * speakers a quarter of a second late.
 */
const MIC_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/** How often connections are opened and closed. Distance changes slowly next to a frame. */
const MANAGE_MS = 250;
/** How often the talking meters are read. */
const LEVEL_MS = 50;
/** How long the higher id waits for the lower one to call before asking it to. */
const ASK_AFTER_MS = 1500;
/** And how often it asks again while nothing comes of it. */
const ASK_EVERY_MS = 8000;
/** After a connection closes or fails, how long before trying that player again. */
const RETRY_MS = 4000;
/** After a player says their voice is off, how long before asking again. They call when they turn it on. */
const REFUSED_MS = 30000;
/** A connection that has not connected in this long is given up and retried. */
const CONNECT_TIMEOUT_MS = 20000;
/** A connection that dropped and has not come back in this long is closed. */
const LOST_MS = 8000;
/** A connection to somebody who is not on the roster is closed after this. */
const GONE_MS = 10000;
/** Network candidates are sent in bunches, so one connection is a handful of messages, not dozens. */
const ICE_BATCH_MS = 40;
/**
 * Signalling messages sent in any one second, at most. The server relays
 * sixty a second from one player and drops the rest; this leaves room for
 * the network bunching them up on the way. See signal().
 */
const SIGNAL_PER_S = 40;
/**
 * The most people heard at once. Each one is a connection with its own
 * encoder on your machine; past this the nearest win. A crowd at spawn would
 * otherwise be forty encoders on a phone.
 */
const MAX_PEERS = 16;
@@MISSING 105@@
@@MISSING 106@@
@@MISSING 107@@
@@MISSING 108@@
@@MISSING 109@@
@@MISSING 110@@
@@MISSING 111@@
@@MISSING 112@@
const RADIO_GAIN = 0.35;
const RADIO_FROM_M = VOICE_FULL_M + (1 - RADIO_GAIN) * (VOICE_RANGE_M - VOICE_FULL_M);
/** A full list swaps its farthest call for somebody this much nearer. */
const SWAP_MARGIN_M = 15;
/** Opus at this rate is clear speech; the browser default is several times it, for music. */
const MAX_BITRATE = 32000;
/**
 * The talking gate: on above the first level (RMS of the waveform, about -34
 * dBFS), off once below the second (-42 dBFS) for the hold time. Two levels
 * and a hold so the indicator does not flicker between words.
 */
const TALK_ON = 0.02;
const TALK_OFF = 0.008;
const TALK_HOLD_MS = 350;
const FFT_SIZE = 1024;
/** Time constant for position and volume changes, seconds: smooth at sixty updates a second, no lag you can hear. */
const GLIDE_S = 0.03;
/** Where a voice comes from when the figure does not say how tall it is, metres above its feet. */
const EYE_M = 1.7;

/** Microphone states in which this page can still hear but cannot be heard. */
const LISTEN_ONLY = new Set(['blocked', 'missing', 'insecure']);

/**
 * @typedef {object} Peer
 * @property {number} id          the other player's id
 * @property {string} cid         this connection's id, shared with them
 * @property {RTCPeerConnection} pc
 * @property {boolean} polite     gives way when both sides offer at once
 * @property {boolean} makingOffer
 * @property {boolean} ignoreOffer
 * @property {Promise<void>} chain incoming signalling, one message at a time
 * @property {RTCIceCandidateInit[]} pendingIce candidates that arrived before the description
 * @property {RTCIceCandidateInit[]} outIce     candidates waiting to be sent
 * @property {number} createdAt
 * @property {number} connectedAt  0 until connected
 * @property {number} lostAt       when it dropped, 0 while up
 * @property {boolean} talking
 * @property {number} level        RMS of what they are sending, 0..1
 * @property {number} distance     metres from the camera
 */

export class ProximityVoice extends Emitter {
  /**
   * Starts at once if voice is switched on in settings, and follows the
   * setting from then on.
   *
   * @param {object} deps
   * @param {import('./session.js').OnlineSession} deps.session
   * @param {import('../core/settings.js').SettingsStore} [deps.settings]
   * @param {string} [deps.world] the world this page is on
   */
  constructor({ session, settings = sharedSettings, world = BOOT.world } = {}) {
    super();
    this.session = session;
    this.net = session.net;
    this.settings = settings;
    this.world = world;
    /** @type {Map<number, Peer>} */
    this.peers = new Map();
    /** Players there is no connection to yet: when to try them next, when they were asked. */
    this.contacts = new Map();
    this.mutedIds = new Set();
    /** Mutes by name as well, so somebody reconnecting under a new id stays muted. */
    this.mutedNames = new Set();
    this.mode = 'off';
    this.running = false;
    this.unsupported = false;
    this.pushed = false;
    /** You are talking: transmitting, and loud enough to be speech. What FLAG.talking carries. */
    this.talking = false;
    /** Your microphone's level, 0..1, whether or not you are transmitting — for a mic check. */
    this.level = 0;
    /** 'off' | 'asking' | 'live' | 'blocked' | 'missing' | 'insecure' */
    this.micState = 'off';
    this.micError = '';
    this.mic = null;
    this.micTrack = null;
    this.micNodes = null;
    this.micToken = 0;
    /** The microphone's PermissionStatus, watched once it has been refused. */
    this.permission = null;
    this.permissionAsked = false;
    this.disposed = false;
    this.ctx = null;
    this.master = null;
    this.sink = null;
    this.cam = null;
    this.gate = { open: false, loudAt: 0 };
    this.buffer = new Float32Array(FFT_SIZE);
    this.lastManage = 0;
    this.lastLevels = 0;
    this.lastStatus = '';
    this.speakerKey = '';
    /** Signalling waiting its turn under the server's rate limit, and when the last second's went. */
    this.outbox = [];
    this.sentTimes = [];
    this.outboxTimer = 0;

    const net = this.net;
    this.unsubscribe = [
      net.on('voice', (m) => this.onSignal(m)),
      // Somebody left, changed world or died: their connection goes now
      // rather than at the next distance check.
      net.on('leave', (m) => {
        this.drop(Number(m.id), 'left', false);
        this.contacts.delete(Number(m.id));
      }),
      net.on('moved', (m) => this.drop(Number(m.id), 'world', true)),
      net.on('dead', (m) => this.drop(Number(m.id), 'dead', true)),
      net.on('died', () => {
        this.closeAll('dead', true);
        this.applyTransmit();
      }),
      // Signed in again — a reconnect is a new id, and everyone has already
      // been told the old one left.
      net.on('auth', (m) => {
        if (!m.ok) return;
        this.clearSignals();
        this.closeAll('reconnect', false);
        this.contacts.clear();
      }),
      net.on('status', ({ status }) => {
        if (status === 'closed' || status === 'failed') {
          this.clearSignals();
          this.closeAll('offline', false);
        }
        this.refreshStatus();
      }),
      settings.on('change', ({ key }) => {
        if (key === 'voiceMode') this.sync();
        else if (key === 'voiceVolume') this.applyVolume();
      }),
      settings.on('bulk', () => this.sync()),
    ];

    // A browser only lets sound start from something the player did, and
    // the first thing they do may well be pressing the push-to-talk key, so
    // any press or click resumes the audio. Losing focus lets go of the key:
    // the keyup for it goes to whichever window has focus by then.
    this.onGesture = () => {
      if (this.running && this.ctx && this.ctx.state !== 'running') this.resume();
    };
    this.onBlur = () => this.setPushed(false);
    const win = globalThis.window;
    if (win?.addEventListener) {
      for (const type of ['pointerdown', 'keydown', 'touchend']) win.addEventListener(type, this.onGesture, true);
      win.addEventListener('blur', this.onBlur);
    }
    // The game loop drives this through update(), but a menu or a hidden tab
    // can stop the loop; connections should still open and close meanwhile.
    this.timer = setInterval(() => this.tick(), 1000);

    this.sync();
  }

  /* -------------------------------------------------------------- control */

  /** Follow the voiceMode setting: start, stop, or change between push and open. */
  sync() {
    this.mode = readMode(this.settings);
    if (this.mode === 'off') this.stop();
    else this.start();
    this.applyTransmit();
    this.applyVolume();
    this.refreshStatus();
  }

  /**
   * Switch voice on, if the setting allows it: the audio output, the
   * microphone, and connections to whoever is in range. Idempotent.
   */
  start() {
    this.mode = readMode(this.settings);
    if (this.disposed) return;
    if (this.mode === 'off') {
      this.stop();
      return;
    }
    if (this.running) return;
    if (typeof globalThis.RTCPeerConnection !== 'function') {
      this.unsupported = true;
      this.refreshStatus();
      return;
    }
    this.running = true;
    const ctx = this.ensureAudio();
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
    this.lastManage = 0;
    this.acquireMic();
    this.refreshStatus();
  }

  /** Switch voice off: every connection closed (with a goodbye), the microphone released. */
  stop() {
    // Also cancels a microphone request that has not been answered yet.
    this.micToken += 1;
    if (!this.running) return;
    this.running = false;
    this.closeAll('off', true);
    this.releaseMic();
    this.micState = 'off';
    this.setTalking(false);
    this.contacts.clear();
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
    this.refreshStatus();
  }

  /**
   * Push to talk: the key went down (true) or came up (false). In open mode
   * the microphone is live regardless; in push mode only while this is held.
   */
  setPushed(on) {
    const pushed = !!on;
    if (pushed) this.onGesture();
    if (pushed === this.pushed) return;
    this.pushed = pushed;
    this.applyTransmit();
    this.refreshStatus();
  }

  /**
   * Resume the audio output. Browsers start it suspended until the player
   * has clicked or pressed something; call this from such a handler (any
   * press or click on the page already does).
   *
   * @returns {Promise<string>} the context's state afterwards
   */
  resume() {
    const ctx = this.running ? this.ensureAudio() : this.ctx;
    if (!ctx) return Promise.resolve('none');
    if (ctx.state === 'running' || ctx.state === 'closed') return Promise.resolve(ctx.state);
    return ctx.resume().then(
      () => {
        this.refreshStatus();
        return ctx.state;
      },
      () => ctx.state,
    );
  }

  /** Ask for the microphone again — after the player has unblocked it in the browser, say. */
  retryMic() {
    if (!this.running || this.micState === 'live' || this.micState === 'asking') return;
    this.acquireMic();
  }

  /** Mute one player for yourself (or unmute them). Nobody else is affected. */
  mute(id, on = true) {
    const key = this.nameKey(id);
    if (on) {
      this.mutedIds.add(id);
      if (key) this.mutedNames.add(key);
    } else {
      this.mutedIds.delete(id);
      if (key) this.mutedNames.delete(key);
    }
    const peer = this.peers.get(id);
    if (peer && this.ctx) this.placePeer(peer, this.remoteById(id), this.ctx.currentTime);
    this.emit('mute', { id, muted: !!on });
  }

  isMuted(id) {
    if (this.mutedIds.has(id)) return true;
    const key = this.nameKey(id);
    return !!key && this.mutedNames.has(key);
  }

  /** Everyone currently muted, by id. */
  get muted() {
    const out = new Set(this.mutedIds);
    for (const p of this.remotes()) if (this.isMuted(p.id)) out.add(p.id);
    return out;
  }

  /** Is this player talking right now, as heard here? */
  isTalking(id) {
    return !!this.peers.get(id)?.talking;
  }

  /** The ids of everyone talking right now. */
  speaking() {
    const out = [];
    for (const peer of this.peers.values()) if (peer.talking) out.push(peer.id);
    return out;
  }

  /** How many voices are connected. */
  get connected() {
    let n = 0;
    for (const peer of this.peers.values()) if (peer.connectedAt && !peer.lostAt) n += 1;
    return n;
  }

  /** Your microphone is live and sending: open mode, or push mode with the key held. */
  get transmitting() {
    return this.running
      && this.micState === 'live'
      && !this.localDead()
      && (this.mode === 'open' || (this.mode === 'push' && this.pushed));
  }

  /** One line for the HUD. */
  status() {
    if (!this.running) return this.unsupported ? 'voice not supported in this browser' : 'voice off';
    if (this.myId() == null || !this.net.open) return 'voice waiting for the server';
    if (this.localDead()) return 'voice back when you respawn';
    const connected = this.connected;
    const connecting = this.peers.size - connected;
    if (connected && this.ctx && this.ctx.state !== 'running') return 'voice paused \u2014 click to hear';
    if (this.micState === 'asking') return 'asking for the microphone\u2026';
    if (LISTEN_ONLY.has(this.micState)) {
      const why = this.micState === 'blocked' ? 'mic blocked'
        : this.micState === 'insecure' ? 'mic needs https' : 'no microphone';
      return connected ? `${why} \u2014 listening to ${connected}` : `${why} \u2014 listening only`;
    }
    if (!connected) return connecting ? 'connecting voice\u2026' : 'nobody in voice range';
    return this.transmitting ? `talking to ${connected}` : `listening to ${connected}`;
  }

  /** Everything the interface might want to show, at once. */
  info() {
    return {
      mode: this.mode,
      running: this.running,
      mic: this.micState,
      micError: this.micError,
      pushed: this.pushed,
      transmitting: this.transmitting,
      talking: this.talking,
      level: this.level,
      connected: this.connected,
      audio: this.ctx?.state ?? 'none',
      status: this.status(),
      peers: this.list(),
    };
  }

  /** The connections, for a players panel: who, how far, talking, muted. */
  list() {
    return [...this.peers.values()].map((peer) => ({
      id: peer.id,
      name: this.remoteById(peer.id)?.name ?? '',
      state: peer.connectedAt && !peer.lostAt ? 'connected' : 'connecting',
      talking: peer.talking,
      level: peer.level,
      muted: this.isMuted(peer.id),
      distance: peer.distance,
    }));
  }

  /** Close everything and stop listening to anything. The object is finished with. */
  dispose() {
    this.disposed = true;
    // The goodbyes go now, up to the rate limit; anything over it is left to
    // the server, which tells everyone when the socket closes.
    this.stop();
    this.clearSignals();
    if (this.permission) this.permission.onchange = null;
    this.permission = null;
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    clearInterval(this.timer);
    const win = globalThis.window;
    if (win?.removeEventListener) {
      for (const type of ['pointerdown', 'keydown', 'touchend']) win.removeEventListener(type, this.onGesture, true);
      win.removeEventListener('blur', this.onBlur);
    }
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.clear();
  }

  /* ------------------------------------------------------------ per frame */

  /**
   * Per frame, after the session has placed everyone (so their positions and
   * the camera are in the same frame — see the note on rebasing above).
   *
   * @param {import('../../vendor/three/three.module.js').Camera} camera
   */
  update(camera) {
    const now = performance.now();
    if (camera) this.placeListener(camera);
    if (now - this.lastManage >= MANAGE_MS) this.manage(now);
    if (this.ctx && this.peers.size) {
      const t = this.ctx.currentTime;
      for (const peer of this.peers.values()) this.placePeer(peer, this.remoteById(peer.id), t);
    }
    if (now - this.lastLevels >= LEVEL_MS) this.levels(now);
    this.refreshStatus();
  }

  /** The once-a-second fallback for when nothing is calling update(). */
  tick() {
    const now = performance.now();
    if (now - this.lastManage < 900) return;
    this.manage(now);
    this.levels(now);
    this.refreshStatus();
  }

  /**
   * Turn the listener to face where the camera faces. Its position stays at
   * the origin and every voice is placed relative to the camera instead.
   *
   * The camera hangs straight off the scene in this game, so its position and
   * quaternion are already world values and are current this frame, where
   * matrixWorld is only brought up to date by the next render. A camera
   * parented to something else falls back to matrixWorld.
   */
  placeListener(camera) {
    let x;
    let y;
    let z;
    let forward;
    let up;
    if (camera.parent && !camera.parent.isScene && camera.matrixWorld) {
      const e = camera.matrixWorld.elements;
      x = e[12];
      y = e[13];
      z = e[14];
      forward = normalise(-e[8], -e[9], -e[10]);
      up = normalise(e[4], e[5], e[6]);
    } else {
      ({ x, y, z } = camera.position);
      const q = camera.quaternion;
      forward = q ? rotate(q, 0, 0, -1) : [0, 0, -1];
      up = q ? rotate(q, 0, 1, 0) : [0, 1, 0];
    }
    this.cam = { x, y, z };
    if (!this.ctx) return;
    const listener = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (listener.forwardX) {
      glide(listener.forwardX, forward[0], t);
      glide(listener.forwardY, forward[1], t);
      glide(listener.forwardZ, forward[2], t);
      glide(listener.upX, up[0], t);
      glide(listener.upY, up[1], t);
      glide(listener.upZ, up[2], t);
    } else if (listener.setOrientation) {
      listener.setOrientation(forward[0], forward[1], forward[2], up[0], up[1], up[2]);
    }
  }

  /**
   * Put one voice where its figure is, relative to the camera, at head
   * height. Somebody whose position is not known yet is held silent rather
   * than played from inside your own head.
   */
  placePeer(peer, p, t) {
    const pos = p?.pose?.position;
    const known = !!(pos && p.now && this.cam && p.world === this.world && !p.dead);
    // Your party, out of earshot or on another world: a radio, steady and
    // from nowhere in particular, rather than nothing at all.
    if (this.partyMember(p) && !p.dead) {
      const x = known ? pos.x - this.cam.x : 0;
      const y = known ? pos.y + (p.pose.eyeHeight ?? EYE_M) - this.cam.y : 0;
      const z = known ? pos.z - this.cam.z : 0;
      const near = known && Math.hypot(x, y, z) < RADIO_FROM_M;
      peer.distance = near ? Math.hypot(x, y, z) : 0;
      if (peer.panner) {
        if (near) setPosition(peer.panner, x, y, z, peer.placed ? t : -1);
        else setPosition(peer.panner, 0, 0.3, 0, -1);
        peer.placed = near;
      }
      const gain = this.isMuted(peer.id) ? 0 : near ? 1 : RADIO_GAIN;
      if (peer.gain && peer.gainValue !== gain) {
        glide(peer.gain.gain, gain, t);
        peer.gainValue = gain;
      }
      return;
    }
    if (known) {
      const x = pos.x - this.cam.x;
      const y = pos.y + (p.pose.eyeHeight ?? EYE_M) - this.cam.y;
      const z = pos.z - this.cam.z;
      peer.distance = Math.hypot(x, y, z);
      if (peer.panner) {
        // The first placement jumps; after that it glides.
        setPosition(peer.panner, x, y, z, peer.placed ? t : -1);
        peer.placed = true;
      }
    }
    const gain = known && !this.isMuted(peer.id) ? 1 : 0;
    if (peer.gain && peer.gainValue !== gain) {
      glide(peer.gain.gain, gain, t);
      peer.gainValue = gain;
    }
  }

  /** Read the talking meters: yours, and everybody you can hear. */
  levels(now) {
    this.lastLevels = now;
    if (this.micNodes) {
      this.level = readRms(this.micNodes.analyser, this.buffer);
      const loud = voiceGate(this.gate, this.level, now);
      this.setTalking(loud && this.transmitting);
    } else {
      this.level = 0;
      this.setTalking(false);
    }
    let key = '';
    for (const peer of this.peers.values()) {
      if (!peer.analyser) continue;
      peer.level = readRms(peer.analyser, this.buffer);
      peer.talking = voiceGate(peer.gateState, peer.level, now);
      if (peer.talking) key += `${peer.id};`;
    }
    if (key !== this.speakerKey) {
      this.speakerKey = key;
      this.emit('speakers', this.speaking());
    }
  }

  setTalking(on) {
    if (this.talking === on) return;
    this.talking = on;
    // The session puts FLAG.talking on the wire from this field; see
    // OnlineSession.flags(). A change of flags is sent within a tenth of a
    // second, so the indicator over your head keeps up with your voice.
    if (this.session) this.session.talking = on;
    this.emit('talking', on);
  }

  refreshStatus() {
    const status = this.status();
    if (status === this.lastStatus) return;
    this.lastStatus = status;
    this.emit('status', status);
  }

  /* ---------------------------------------------------------- connections */

  /**
   * Open what should be open and close what should not.
   *
   * In range is decided here from the figures as this page draws them, which
   * is a tenth of a second behind; the other page decides from its own copy,
   * which is about as far behind the other way. The quarter between opening
   * and closing distances is far more than that disagreement, so two pages
   * near the edge do not take turns hanging up on each other.
   */
  manage(now) {
    this.lastManage = now;
    const me = this.myId();
    if (!this.running || me == null || this.localDead()) {
      if (this.peers.size) this.closeAll(this.running && me != null ? 'dead' : 'off', me != null);
      this.applyTransmit();
      return;
    }
    this.applyTransmit();
    for (const peer of [...this.peers.values()]) {
      const want = this.wanted(peer.id);
      if (want === 'no') this.drop(peer.id, 'range', true);
      else if (want === 'gone' && now - peer.createdAt > GONE_MS) this.drop(peer.id, 'gone', true);
      else if (!peer.connectedAt && now - peer.createdAt > CONNECT_TIMEOUT_MS) this.drop(peer.id, 'timeout', true);
      else if (peer.lostAt && now - peer.lostAt > LOST_MS) this.drop(peer.id, 'lost', true);
    }
    const near = [];
    for (const p of this.remotes()) {
      if (p.id === me || this.peers.has(p.id)) continue;
      const contact = this.contact(p.id);
      if (this.wanted(p) !== 'open') {
        contact.inRangeSince = 0;
        continue;
      }
      if (!contact.inRangeSince) contact.inRangeSince = now;
      if (now < contact.backoffUntil) continue;
      // The party first: they are who you came to talk to.
      near.push({ p, contact, d: this.partyMember(p) ? -1 : this.distanceTo(p) });
    }
    near.sort((a, b) => a.d - b.d);
    for (const { p, contact, d } of near) {
      if (!this.makeRoom(d)) break;
      if (me < p.id) {
        this.open(p.id);
      } else if (now - contact.inRangeSince >= ASK_AFTER_MS && now - contact.askedAt >= ASK_EVERY_MS) {
        contact.askedAt = now;
        this.signal(p.id, 'offer', { ask: true });
      }
    }
    for (const id of this.contacts.keys()) if (!this.remoteById(id)) this.contacts.delete(id);
  }

  /**
   * Should there be a connection to this player? 'open' inside the connect
   * distance, 'keep' in the band beyond it, 'no' past that or on another
   * world or dead, 'unknown' when where they are is not known yet, 'gone'
   * when they are not on the roster at all.
   */
  wanted(target) {
    const p = typeof target === 'object' ? target : this.remoteById(target);
    if (!p) return 'gone';
    // Your party, however far, on whichever world: the server introduces
    // party members to each other wherever they are.
    if (this.partyMember(p) && !p.dead) return 'open';
    if (p.world !== this.world || p.dead) return 'no';
    const d = this.distanceTo(p);
    if (!Number.isFinite(d)) return 'unknown';
    if (d <= VOICE_CONNECT_M) return 'open';
    return d <= KEEP_M ? 'keep' : 'no';
  }

  /**
   * How far away a player is, for deciding whether to be connected to them.
   *
   * Measured from your own figure, feet to feet, when there is one — not
   * from the camera. The server decides who may signal whom from where the
   * players are (onVoice in server/game.mjs), and the freecam can be flown
   * a hundred kilometres off: measured from it, voice would hang up on the
   * friend standing next to you and keep ringing strangers the server will
   * never introduce you to. What you hear is still placed from the camera
   * (placePeer), so someone beside your figure while the camera is away is
   * connected but out of earshot, which is the truth.
   */
  distanceTo(p) {
    const pos = p.pose?.position;
    if (!p.now || !pos) return NaN;
    const self = this.session.game?.player?.position;
    if (self && Number.isFinite(self.x) && Number.isFinite(self.y) && Number.isFinite(self.z)) {
      return Math.hypot(pos.x - self.x, pos.y - self.y, pos.z - self.z);
    }
    if (!this.cam) return Number.isFinite(p.distance) ? p.distance : NaN;
    return Math.hypot(pos.x - this.cam.x, pos.y + (p.pose.eyeHeight ?? EYE_M) - this.cam.y, pos.z - this.cam.z);
  }

  /** Call somebody: a new connection, offered from this side. */
  open(id) {
    const peer = this.createPeer(id, newCid());
    // Adding the transceiver is what sets negotiation off; the offer goes
    // out from onnegotiationneeded, the same path a renegotiation takes.
    const transceiver = peer.pc.addTransceiver('audio', { direction: this.direction() });
    if (this.micTrack) transceiver.sender.replaceTrack(this.micTrack).catch(() => {});
    return peer;
  }

  createPeer(id, cid) {
    const me = this.myId();
    const pc = new RTCPeerConnection({ iceServers: this.iceServers() });
    /** @type {Peer} */
    const peer = {
      id,
      cid,
      pc,
      polite: me > id,
      makingOffer: false,
      ignoreOffer: false,
      chain: Promise.resolve(),
      pendingIce: [],
      outIce: [],
      iceTimer: 0,
      createdAt: performance.now(),
      connectedAt: 0,
      lostAt: 0,
      talking: false,
      level: 0,
      gateState: { open: false, loudAt: 0 },
      distance: Infinity,
      placed: false,
      gainValue: -1,
      track: null,
      stream: null,
      element: null,
      source: null,
      analyser: null,
      gain: null,
      panner: null,
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) peer.outIce.push(candidate.toJSON());
      if (peer.iceTimer) return;
      peer.iceTimer = setTimeout(() => {
        peer.iceTimer = 0;
        if (this.peers.get(id) !== peer || peer.outIce.length === 0) return;
        // Twenty at most to a message, which is all the server passes on.
        while (peer.outIce.length) this.signal(id, 'ice', { cid, c: peer.outIce.splice(0, 20) });
      }, ICE_BATCH_MS);
    };
    pc.ontrack = (event) => this.attachRemote(peer, event);
    pc.onnegotiationneeded = () => this.negotiate(peer);
    pc.onconnectionstatechange = () => this.onPeerState(peer);
    pc.oniceconnectionstatechange = () => this.onPeerState(peer);
    this.peers.set(id, peer);
    this.contacts.delete(id);
    this.refreshStatus();
    return peer;
  }

  /** Send an offer for whatever needs negotiating. Either side may; see acceptOffer for collisions. */
  async negotiate(peer) {
    if (this.peers.get(peer.id) !== peer) return;
    try {
      peer.makingOffer = true;
      await peer.pc.setLocalDescription();
      const description = peer.pc.localDescription;
      if (this.peers.get(peer.id) !== peer || description?.type !== 'offer') return;
      this.signal(peer.id, 'offer', { cid: peer.cid, sdp: description.sdp });
    } catch (error) {
      // An offer can lose a race with the other side's offer arriving, which
      // perfect negotiation then sorts out; that is not worth hanging up
      // over. A connection that never comes up is closed by the timeout in
      // manage() instead.
      console.debug('[terraglide] voice offer not sent', error);
    } finally {
      peer.makingOffer = false;
    }
  }

  onPeerState(peer) {
    if (this.peers.get(peer.id) !== peer) return;
    const pc = peer.pc;
    const state = pc.connectionState ?? pc.iceConnectionState;
    if (state === 'connected' || state === 'completed') {
      if (!peer.connectedAt) peer.connectedAt = performance.now();
      peer.lostAt = 0;
      this.limitBitrate(peer);
    } else if (state === 'disconnected') {
      if (!peer.lostAt) peer.lostAt = performance.now();
    } else if (state === 'failed') {
      this.drop(peer.id, 'failed', true);
      return;
    }
    this.refreshStatus();
  }

  /**
   * Hang up on one player.
   *
   * @param {number} id
   * @param {string} why  said to them in the goodbye, and in the 'drop' event
   * @param {boolean} bye send them a goodbye (not when they are the one who left)
   */
  drop(id, why, bye) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    if (bye) this.signal(id, 'bye', { cid: peer.cid, why });
    clearTimeout(peer.iceTimer);
    const pc = peer.pc;
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onnegotiationneeded = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    try {
      pc.close();
    } catch {
      /* already closed */
    }
    this.detachRemote(peer);
    peer.talking = false;
    // Not straight back: a connection that failed will fail again this
    // second, and one closed for range should not reopen on a wobble.
    if (why !== 'left' && why !== 'off' && why !== 'offline' && why !== 'reconnect') {
      this.contact(id).backoffUntil = performance.now() + RETRY_MS;
    }
    this.emit('drop', { id, why });
    this.refreshStatus();
  }

  closeAll(why, bye) {
    for (const id of [...this.peers.keys()]) this.drop(id, why, bye && this.net.open);
  }

  fail(peer, error) {
    if (this.peers.get(peer.id) !== peer) return;
    console.warn('[terraglide] voice connection failed', error);
    this.drop(peer.id, 'failed', true);
  }

  /* ------------------------------------------------------------ signalling */

  /**
   * Send one signalling message, through a queue that keeps under the
   * server's relay limit.
   *
   * The server passes on at most sixty voice messages a second from any one
   * player and silently drops the rest (onVoice in server/game.mjs). One
   * call is four or five messages, but flying into a crowd at spawn opens a
   * dozen at once, each trickling candidates in two or three bunches as the
   * network answers — enough to go over, and a dropped offer or answer is a
   * call that hangs for CONNECT_TIMEOUT_MS and then starts again. Order is
   * kept, so a goodbye never overtakes the offer it cancels.
   */
  signal(to, kind, data) {
    this.outbox.push({ t: 'voice', to, kind, data });
    this.flushSignals();
  }

  flushSignals() {
    const now = performance.now();
    const sent = this.sentTimes;
    while (sent.length && now - sent[0] >= 1000) sent.shift();
    while (this.outbox.length && sent.length < SIGNAL_PER_S) {
      if (!this.net.send(this.outbox.shift())) {
        // Not connected: whatever is queued is addressed to ids that will
        // mean nothing on the next connection.
        this.outbox.length = 0;
        break;
      }
      sent.push(now);
    }
    if (this.outbox.length && !this.outboxTimer) {
      this.outboxTimer = setTimeout(() => {
        this.outboxTimer = 0;
        this.flushSignals();
      }, Math.max(10, 1005 - (now - sent[0])));
    }
  }

  /** Forget anything still waiting to be sent (signed out, or reconnected under a new id). */
  clearSignals() {
    this.outbox.length = 0;
    clearTimeout(this.outboxTimer);
    this.outboxTimer = 0;
  }

  /** A signalling message from another player, relayed by the server. */
  onSignal(m) {
    const from = Number(m?.from);
    const me = this.myId();
    if (!Number.isInteger(from) || me == null || from === me) return;
    const data = m.data && typeof m.data === 'object' ? m.data : {};
    switch (m.kind) {
      case 'offer':
        if (data.ask) this.onAsk(from);
        else this.onOffer(from, data);
        break;
      case 'answer':
        this.onAnswer(from, data);
        break;
      case 'ice':
        this.onIce(from, data);
        break;
      case 'bye':
        this.onBye(from, data);
        break;
      default:
    }
  }

  /** Why this page will not take a call right now, or null if it will. */
  refusal() {
    if (!this.running) return 'off';
    if (this.localDead()) return 'dead';
    return null;
  }

  /** The higher id asking the lower to call it. */
  onAsk(from) {
    const refused = this.refusal();
    if (refused) {
      this.signal(from, 'bye', { why: refused });
      return;
    }
    if (this.peers.has(from)) return;
    if (this.wanted(from) === 'no') {
      this.signal(from, 'bye', { why: 'range' });
      return;
    }
    if (!this.makeRoom(this.distanceTo(this.remoteById(from) ?? {}))) {
      this.signal(from, 'bye', { why: 'full' });
      return;
    }
    this.open(from);
  }

  /**
   * Room for one more connection, to somebody `d` metres away. With every
   * line taken, the farthest call is hung up when the newcomer is clearly
   * nearer — in a crowd you hear the people round you, not the first sixteen
   * who happened to be in range. False when there is no room to be had.
   */
  makeRoom(d) {
    if (this.peers.size < MAX_PEERS) return true;
    if (!Number.isFinite(d)) return false;
    let farthest = null;
    let far = -Infinity;
    for (const peer of this.peers.values()) {
      const p = this.remoteById(peer.id);
      // A party member is never the one dropped for a stranger.
      const distance = p ? (this.partyMember(p) ? -Infinity : this.distanceTo(p)) : Infinity;
      const away = Number.isFinite(distance) ? distance : Infinity;
      if (away > far) {
        far = away;
        farthest = peer;
      }
    }
    // A margin, so two people at much the same distance are not swapped
    // back and forth as they walk.
    if (!farthest || far < d + SWAP_MARGIN_M) return false;
    this.drop(farthest.id, 'full', true);
    return this.peers.size < MAX_PEERS;
  }

  onOffer(from, data) {
    if (typeof data.sdp !== 'string' || typeof data.cid !== 'string' || data.sdp.length > 60000) return;
    const refused = this.refusal();
    if (refused) {
      this.signal(from, 'bye', { cid: data.cid, why: refused });
      return;
    }
    let peer = this.peers.get(from);
    if (peer && peer.cid !== data.cid) {
@@MISSING 1011@@
@@MISSING 1012@@
@@MISSING 1013@@
@@MISSING 1014@@
@@MISSING 1015@@
@@MISSING 1016@@
@@MISSING 1017@@
@@MISSING 1018@@
@@MISSING 1019@@
@@MISSING 1020@@
@@MISSING 1021@@
@@MISSING 1022@@
@@MISSING 1023@@
@@MISSING 1024@@
@@MISSING 1025@@
@@MISSING 1026@@
@@MISSING 1027@@
@@MISSING 1028@@
@@MISSING 1029@@
@@MISSING 1030@@
@@MISSING 1031@@
@@MISSING 1032@@
@@MISSING 1033@@
@@MISSING 1034@@
@@MISSING 1035@@
@@MISSING 1036@@
@@MISSING 1037@@
@@MISSING 1038@@
@@MISSING 1039@@
@@MISSING 1040@@
@@MISSING 1041@@
@@MISSING 1042@@
@@MISSING 1043@@
@@MISSING 1044@@
@@MISSING 1045@@
@@MISSING 1046@@
@@MISSING 1047@@
@@MISSING 1048@@
  onAnswer(from, data) {
    const peer = this.peers.get(from);
    if (!peer || peer.cid !== data.cid || typeof data.sdp !== 'string') return;
    this.enqueue(peer, async () => {
      // An answer to an offer that has since been rolled back is stale.
      if (peer.pc.signalingState !== 'have-local-offer') return;
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      await this.drainIce(peer);
      this.limitBitrate(peer);
    });
  }

  onIce(from, data) {
    const peer = this.peers.get(from);
    if (!peer || peer.cid !== data.cid || !Array.isArray(data.c)) return;
    const list = data.c.slice(0, 50).filter((c) => c && typeof c.candidate === 'string');
    this.enqueue(peer, async () => {
      for (const candidate of list) {
        if (!peer.pc.remoteDescription) {
          if (peer.pendingIce.length < 100) peer.pendingIce.push(candidate);
          continue;
        }
        await this.addCandidate(peer, candidate);
      }
    });
  }

  async drainIce(peer) {
    for (const candidate of peer.pendingIce.splice(0)) await this.addCandidate(peer, candidate);
  }

  async addCandidate(peer, candidate) {
    try {
      await peer.pc.addIceCandidate(candidate);
    } catch (error) {
      // Candidates for an offer this side chose to ignore are expected to
      // fail; anything else is worth a line in the console, not a hang-up.
      if (!peer.ignoreOffer) console.debug('[terraglide] voice candidate refused', error);
    }
  }

  onBye(from, data) {
    const peer = this.peers.get(from);
    if (peer && (!data.cid || data.cid === peer.cid)) this.drop(from, `bye:${String(data.why ?? '')}`, false);
    // Somebody with voice off, or full, is left alone for a while; they call
    // when that changes. Anything else is worth another try shortly.
    const quiet = data.why === 'off' || data.why === 'full';
    this.contact(from).backoffUntil = performance.now() + (quiet ? REFUSED_MS : RETRY_MS);
  }

  /** Signalling for one connection is handled one message at a time, in order. */
  enqueue(peer, job) {
    peer.chain = peer.chain
      .then(() => (this.peers.get(peer.id) === peer ? job() : null))
      .catch((error) => this.fail(peer, error));
  }

  /* ---------------------------------------------------------- microphone */

  /** sendrecv while the microphone is coming or here, recvonly once it is known not to be. */
  direction() {
    return LISTEN_ONLY.has(this.micState) ? 'recvonly' : 'sendrecv';
  }

  /**
   * Make this connection send the microphone, if there is one. Changing a
   * listen-only connection to send fires negotiationneeded, which
   * renegotiates it through negotiate() — that is how a microphone allowed
   * after the call started gets heard. A connection set up while the
   * question was still open was already sendrecv, and only needs the track.
   */
  prepareSender(peer) {
    const transceiver = audioTransceiver(peer.pc);
    if (!transceiver) return;
    const direction = this.direction();
    if (transceiver.direction !== direction && transceiver.direction !== 'stopped') {
      // Never take a sending connection back to listen-only: that is a
      // renegotiation to send nothing, which an absent track already does.
      if (direction === 'sendrecv' || transceiver.direction === 'recvonly' || transceiver.direction === 'inactive') {
        transceiver.direction = direction;
      }
    }
    if (this.micTrack && transceiver.sender.track !== this.micTrack) {
      transceiver.sender.replaceTrack(this.micTrack).then(() => this.limitBitrate(peer), () => {});
    }
  }

  async acquireMic() {
    const token = ++this.micToken;
    const devices = globalThis.navigator?.mediaDevices;
    if (!devices?.getUserMedia) {
      // Browsers only offer the microphone to secure pages: https, or
      // localhost. A server's page on plain http over the network can hear
      // but never be heard, which is what this says.
      this.micState = globalThis.isSecureContext === false ? 'insecure' : 'missing';
      this.micError = 'getUserMedia unavailable';
      this.refreshStatus();
      return;
    }
    this.micState = 'asking';
    this.refreshStatus();
    let stream;
    try {
      stream = await devices.getUserMedia({ audio: MIC_CONSTRAINTS, video: false });
    } catch (error) {
      if (token !== this.micToken || !this.running) return;
      const name = error?.name ?? '';
      this.micState = name === 'NotAllowedError' || name === 'SecurityError' ? 'blocked' : 'missing';
      this.micError = name || String(error);
      if (this.micState === 'blocked') this.watchPermission();
      this.refreshStatus();
      return;
    }
    if (token !== this.micToken || !this.running) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const track = stream.getAudioTracks()[0] ?? null;
    if (!track) {
      this.micState = 'missing';
      this.refreshStatus();
      return;
    }
    this.mic = stream;
    this.micTrack = track;
    this.micError = '';
    track.addEventListener('ended', () => {
      // Unplugged, or the permission taken back mid-game — the browser ends
      // the track itself when the padlock is turned to block, and the
      // permission (watched from here on) says which of the two it was.
      if (this.micTrack !== track) return;
      this.releaseMic();
      this.micState = this.permission?.state === 'denied' ? 'blocked' : 'missing';
      this.setTalking(false);
      this.refreshStatus();
    });
    this.watchPermission();
    this.listenToMic();
    this.micState = 'live';
    this.applyTransmit();
    for (const peer of this.peers.values()) this.prepareSender(peer);
    this.refreshStatus();
  }

  /**
   * Keep an eye on the microphone permission, once it has been answered
   * either way. The way a player takes a refusal back is the padlock in the
   * address bar, which tells the page nothing directly — but the Permissions
   * API does, so they are heard the moment they allow it, with no reload and
   * no trip to the settings; and a microphone blocked mid-game is reported as
   * blocked rather than missing. A permission merely reset to "ask" after a
   * refusal asks again, since voice is on and the player has just touched
   * it; a working microphone is never re-asked for. Where the browser cannot
   * report on the microphone (older Safari, older Firefox), retryMic() is the
   * way back.
   */
  watchPermission() {
    if (this.permission || this.permissionAsked) return;
    const permissions = globalThis.navigator?.permissions;
    if (!permissions?.query) return;
    this.permissionAsked = true;
    let query;
    try {
      query = permissions.query({ name: 'microphone' });
    } catch {
      return;
    }
    Promise.resolve(query).then(
      (status) => {
        if (this.disposed) return;
        this.permission = status;
        status.onchange = () => {
          const state = status.state;
          if (state === 'denied') {
            // Chrome ends the track as well, and the 'ended' handler then
            // finds the state already denied; this covers a browser that
            // only reports it.
            if (this.micState === 'missing') {
              this.micState = 'blocked';
              this.refreshStatus();
            }
          } else if (this.micState === 'blocked' || (state === 'granted' && this.micState === 'missing')) {
            this.retryMic();
          }
        };
      },
      () => {
        /* this browser will not say; retryMic() it is */
      },
    );
  }

  /**
   * A meter on the microphone, fed from a copy of the track so it reads
   * whether or not push to talk is held — a mic check in settings needs
   * that. Whether you are *talking* also needs the transmit side; see levels().
   */
  listenToMic() {
    const ctx = this.ensureAudio();
    if (!ctx || !this.micTrack) return;
    const track = this.micTrack.clone();
    track.enabled = true;
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    source.connect(analyser);
    analyser.connect(this.sink);
    this.micNodes = { track, source, analyser };
  }

  releaseMic() {
    if (this.micNodes) {
      this.micNodes.source.disconnect();
      this.micNodes.analyser.disconnect();
      this.micNodes.track.stop();
      this.micNodes = null;
    }
    if (this.mic) for (const track of this.mic.getTracks()) track.stop();
    for (const peer of this.peers.values()) {
      const sender = audioTransceiver(peer.pc)?.sender;
      if (sender?.track) sender.replaceTrack(null).catch(() => {});
    }
    this.mic = null;
    this.micTrack = null;
    this.level = 0;
  }

  /** The outgoing track is enabled exactly while you should be heard. */
  applyTransmit() {
    const on = this.transmitting;
    if (this.micTrack && this.micTrack.enabled !== on) this.micTrack.enabled = on;
    if (!on) this.setTalking(false);
    // The HUD's live dot follows this, and the status line alone does not
    // always change with it: "nobody in voice range" reads the same either way.
    if (on !== this.wasTransmitting) {
      this.wasTransmitting = on;
      this.emit('transmit', on);
    }
  }

  /* ---------------------------------------------------------------- audio */

  ensureAudio() {
    if (this.ctx) return this.ctx;
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Context) return null;
    let ctx;
    try {
      ctx = new Context({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = readVolume(this.settings);
    this.master.connect(ctx.destination);
    // Analysers only run when something downstream pulls on them; a silent
    // sink into the speakers is that something, in every browser.
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(ctx.destination);
    const listener = ctx.listener;
    if (listener.positionX) {
      listener.positionX.value = 0;
      listener.positionY.value = 0;
      listener.positionZ.value = 0;
    } else if (listener.setPosition) {
      listener.setPosition(0, 0, 0);
    }
    ctx.onstatechange = () => this.refreshStatus();
    return ctx;
  }

  applyVolume() {
    if (this.master && this.ctx) glide(this.master.gain, readVolume(this.settings), this.ctx.currentTime);
  }

  /**
   * A voice arrived: wire it into the graph.
   *
   * Chrome will not deliver a remote WebRTC stream into Web Audio unless the
   * same stream is also playing through a media element — a long-standing
   * bug, and the reason for the muted <audio> below, which is never added to
   * the page and never makes a sound of its own.
   */
  attachRemote(peer, event) {
    const track = event.track;
    if (!track || track.kind !== 'audio' || peer.track === track) return;
    if (this.peers.get(peer.id) !== peer) return;
    this.detachRemote(peer);
    const stream = event.streams?.[0] ?? new MediaStream([track]);
    peer.track = track;
    peer.stream = stream;
    const Element = globalThis.Audio;
    if (Element) {
      const element = new Element();
      element.muted = true;
      element.autoplay = true;
      element.srcObject = stream;
      element.play?.()?.catch?.(() => {});
      peer.element = element;
    }
    const ctx = this.ensureAudio();
    if (!ctx) return;
    peer.source = ctx.createMediaStreamSource(stream);
    peer.analyser = ctx.createAnalyser();
    peer.analyser.fftSize = FFT_SIZE;
    peer.gain = ctx.createGain();
    peer.gain.gain.value = 0;
    peer.gainValue = 0;
    peer.panner = makePanner(ctx);
    peer.source.connect(peer.analyser);
    peer.source.connect(peer.gain);
    peer.gain.connect(peer.panner);
    peer.panner.connect(this.master);
    peer.analyser.connect(this.sink);
    peer.placed = false;
    this.placePeer(peer, this.remoteById(peer.id), ctx.currentTime);
  }

  detachRemote(peer) {
    for (const node of [peer.source, peer.analyser, peer.gain, peer.panner]) {
      try {
        node?.disconnect();
      } catch {
        /* never connected */
      }
    }
    if (peer.element) {
      peer.element.pause?.();
      peer.element.srcObject = null;
    }
    peer.source = null;
    peer.analyser = null;
    peer.gain = null;
    peer.panner = null;
    peer.element = null;
    peer.stream = null;
    peer.track = null;
    peer.level = 0;
    peer.talking = false;
  }

  limitBitrate(peer) {
    const sender = audioTransceiver(peer.pc)?.sender;
    if (!sender?.getParameters || !sender.setParameters) return;
    try {
      const params = sender.getParameters();
      const encoding = params.encodings?.[0];
      if (!encoding || encoding.maxBitrate === MAX_BITRATE) return;
      encoding.maxBitrate = MAX_BITRATE;
      sender.setParameters(params).catch(() => {});
    } catch {
      /* not negotiated yet; the next state change tries again */
    }
  }

  /* -------------------------------------------------------------- lookups */

  myId() {
    return this.session.you?.id ?? null;
  }

  localDead() {
    return !!this.session.game?.player?.dead;
  }

  iceServers() {
    const list = this.session.iceServers;
    return Array.isArray(list) && list.length ? list : FALLBACK_ICE_SERVERS;
  }

  remotes() {
    return this.session.remote?.list?.() ?? [];
  }

  /** In your party, with party voice on. */
  partyMember(p) {
    if (!p || this.settings.get?.('partyVoice') === false) return false;
    return !!this.session.inParty?.(p);
  }

  remoteById(id) {
    return this.session.remote?.get?.(id) ?? null;
  }

  nameKey(id) {
    const name = this.remoteById(id)?.name;
    return name ? String(name).toLowerCase() : null;
  }

  contact(id) {
    let contact = this.contacts.get(id);
    if (!contact) {
      contact = { backoffUntil: 0, inRangeSince: 0, askedAt: -Infinity };
      this.contacts.set(id, contact);
    }
    return contact;
  }
}

/* ------------------------------------------------------------------ helpers */

function readMode(store) {
  const mode = store.get('voiceMode');
  return mode === 'push' || mode === 'open' ? mode : 'off';
}

function readVolume(store) {
  const v = Number(store.get('voiceVolume'));
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.9;
}

/** A short random id for one connection. Not a secret, only a label. */
function newCid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function audioTransceiver(pc) {
  return pc.getTransceivers().find((t) => t.receiver?.track?.kind === 'audio' && !t.stopped) ?? null;
}

function makePanner(ctx) {
  const options = {
    panningModel: 'HRTF',
    distanceModel: 'linear',
    refDistance: VOICE_FULL_M,
    maxDistance: VOICE_RANGE_M,
    rolloffFactor: 1,
    coneInnerAngle: 360,
    coneOuterAngle: 360,
    coneOuterGain: 1,
  };
  try {
    return new PannerNode(ctx, options);
  } catch {
    // Older Safari: no constructor, only the factory, and plain properties.
    const panner = ctx.createPanner();
    Object.assign(panner, options);
    return panner;
  }
}

/** Ease an AudioParam towards a value, or set it outright when `t` is negative. */
function glide(param, value, t) {
  if (t < 0) param.value = value;
  else param.setTargetAtTime(value, t, GLIDE_S);
}

function setPosition(panner, x, y, z, t) {
  if (panner.positionX) {
    glide(panner.positionX, x, t);
    glide(panner.positionY, y, t);
    glide(panner.positionZ, z, t);
  } else {
    panner.setPosition(x, y, z);
  }
}

/** Root mean square of what an analyser holds now, 0..1. */
function readRms(analyser, buffer) {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

/**
 * Two thresholds and a hold: on above TALK_ON, still on above TALK_OFF, and
 * off only once it has been quiet for TALK_HOLD_MS.
 */
function voiceGate(state, rms, now) {
  if (rms >= TALK_ON || (state.open && rms >= TALK_OFF)) {
    state.open = true;
    state.loudAt = now;
  } else if (state.open && now - state.loudAt > TALK_HOLD_MS) {
    state.open = false;
  }
  return state.open;
}

/** Rotate a vector by a quaternion ({x, y, z, w}), as three.js does. */
function rotate(q, vx, vy, vz) {
  const tx = 2 * (q.y * vz - q.z * vy);
  const ty = 2 * (q.z * vx - q.x * vz);
  const tz = 2 * (q.x * vy - q.y * vx);
  return [
    vx + q.w * tx + (q.y * tz - q.z * ty),
    vy + q.w * ty + (q.z * tx - q.x * tz),
    vz + q.w * tz + (q.x * ty - q.y * tx),
  ];
}

function normalise(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

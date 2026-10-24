#!/usr/bin/env node
/**
 * The server, exercised over real sockets.
 *
 * Starts the actual server on a spare port with a throwaway data folder, and
 * signs players in with Node's own WebSocket client — the same protocol, the
 * same framing, the same handshake a browser uses. Everything a player can do
 * to another player is driven end to end: seeing each other, chatting,
 * teleport requests and their forty-second timeout, a sword fight to the death,
 * and the moves the server has to refuse.
 *
 *   node tools/servertest.mjs
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientAddress, startServer } from '../server/server.mjs';
import { SURGE_ALLOWANCE } from '../server/game.mjs';
import {
  FLAG, MAX_HEALTH, PROTOCOL_VERSION, SWORD_SLOT, TPA_TIMEOUT_S, encodeState,
} from '../src/net/protocol.js';

let failures = 0;
let passes = 0;
function ok(label, condition, detail = '') {
  if (condition) passes++;
  else failures++;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
}

const dir = mkdtempSync(join(tmpdir(), 'terraglide-server-'));
const server = startServer({ port: 0, host: '127.0.0.1', dataDir: dir, serveGame: true, saveEveryS: 3600 });
const address = await server.ready;
const URL_WS = `ws://127.0.0.1:${address.port}/ws`;
const BASE = `http://127.0.0.1:${address.port}`;

/** A player, as the test drives one. */
class Bot {
  constructor(name) {
    this.name = name;
    this.inbox = [];
    this.waiters = [];
    this.seq = 0;
  }

  async open() {
    this.ws = new WebSocket(URL_WS);
    this.ws.onmessage = (event) => {
      const m = JSON.parse(event.data);
      this.inbox.push(m);
      for (const w of [...this.waiters]) {
        if (w.match(m)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          m.taken = true;
          w.resolve(m);
          break;
        }
      }
    };
    this.closed = new Promise((resolve) => { this.ws.onclose = (e) => resolve(e); });
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.send({ t: 'hello', v: PROTOCOL_VERSION, client: 'test' });
    await this.next('welcome');
    // As a page does: never quiet for long. A bot left idle through a long
    // section was let go as silent after forty-five seconds, and a later
    // check on it found nobody there - now and then, by how long things took.
    this.keepalive = setInterval(() => {
      if (this.ws.readyState === 1) this.send({ t: 'ping', c: Date.now() });
    }, 10000);
    this.keepalive.unref?.();
    return this;
  }

  send(m) {
    this.ws.send(JSON.stringify(m));
  }

  /** The next message of a type (optionally matching), from now or already queued since `from`. */
  next(type, test = () => true, timeout = 3000) {
    const match = (m) => m.t === type && test(m);
    // Something that has already arrived and nobody has taken yet counts: a
    // broadcast can easily land before the test gets round to asking for it.
    const waiting = this.inbox.find((m) => !m.taken && match(m));
    if (waiting) {
      waiting.taken = true;
      return Promise.resolve(waiting);
    }
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          reject(new Error(`${this.name}: no ${type} within ${timeout} ms`));
        }
      }, timeout);
    });
  }

  has(type, test = () => true) {
    return this.inbox.some((m) => m.t === type && test(m));
  }

  clear() {
    this.inbox.length = 0;
  }

  async signup(password = 'hunter22') {
    this.send({ t: 'signup', name: this.name, password });
    const auth = await this.next('auth');
    this.auth = auth;
    if (auth.ok) this.id = auth.you.id;
    return auth;
  }

  /** Arrive where the server put us, then report a state there. */
  async land(lat = this.auth.pos.lat, lon = this.auth.pos.lon, alt = 800) {
    this.send({ t: 'arrived', tid: this.lastTid ?? 0 });
    this.pos = { lat, lon, alt };
    this.state({});
  }

  state({ lat = this.pos.lat, lon = this.pos.lon, alt = this.pos.alt, flags = FLAG.ground, item = 0, vel = [0, 0, 0] }) {
    this.pos = { lat, lon, alt };
    this.send(encodeState({ seq: ++this.seq, lat, lon, alt, agl: 2, vel, yaw: 0, pitch: 0, roll: 0, flags, item }));
  }

  /**
   * A swing that connected, the way the page sends one (Session.attack): a
   * state with the swing bit flipped and the sword in hand, then the hit.
   */
  strike(target) {
    this.swings = (this.swings ?? 0) + 1;
    this.state({ item: SWORD_SLOT, flags: FLAG.ground | (this.swings % 2 ? FLAG.swing : 0) });
    this.send({ t: 'attack', target });
  }

  close() {
    clearInterval(this.keepalive);
    this.ws.close();
    return this.closed;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A spot away from spawn, where fighting is allowed.
const FIELD = { lat: 46.6, lon: 7.95 };
const metresNorth = (m) => m / 111320;

try {
  console.log('\nthe web half serves the game, and only the game');
  {
    const index = await fetch(`${BASE}/`);
    const html = await index.text();
    ok('the page is served', index.status === 200 && /TerraGlide/.test(html));
    ok('and tells the game it is on a server', /window\.__TERRAGLIDE_SERVER__ = true;/.test(html));
    const status = await (await fetch(`${BASE}/api/status`)).json();
    ok('the status answers with the server name', status.terraglide === true && typeof status.name === 'string');
    const secret = await fetch(`${BASE}/server/data/accounts.json`);
    ok('the data folder is never served', secret.status === 404);
    const code = await fetch(`${BASE}/server/game.mjs`);
    ok('nor the server code', code.status === 404);
    const sneaky = await fetch(`${BASE}/src/../server/accounts.mjs`);
    ok('nor anything reached by climbing out of a public folder', sneaky.status === 404);
    const module = await fetch(`${BASE}/src/main.js`, { headers: { 'Accept-Encoding': 'gzip' } });
    ok('the game modules are served', module.status === 200);
  }

  console.log('\nsigning up');
  const alex = await new Bot('Alex').open();
  const blake = await new Bot('Blake').open();
  {
    const bad = new Bot('x');
    await bad.open();
    const auth = await bad.signup();
    ok('a two-letter name is refused', !auth.ok && /at least 3/.test(auth.error));
    bad.close();
    const a = await alex.signup();
    ok('Alex gets an account', a.ok && a.you.name === 'Alex' && /^#[0-9a-f]{6}$/.test(a.you.colour));
    ok('and a session token to come back with', typeof a.token === 'string' && a.token.length > 30);
    ok('the first account on a fresh server is its admin', a.you.admin === true);
    ok('arriving at the spawn', Math.abs(a.pos.lat - 46.5606) < 1e-6);
    const b = await blake.signup();
    ok('Blake gets one too, not an admin', b.ok && !b.you.admin);
    ok('in a different colour', b.you.colour !== a.you.colour);
    const dupe = await new Bot('alex').open();
    const again = await dupe.signup();
    ok('the same name in another case is taken', !again.ok && /taken/.test(again.error));
    dupe.close();
  }

  console.log('\nseeing each other');
  {
    const spawn = alex.auth.pos;
    await alex.land(spawn.lat, spawn.lon, 900);
    await blake.land(spawn.lat + metresNorth(2), spawn.lon, 900);
    const snap = await blake.next('snap', (m) => m.p.some((row) => row[0] === alex.id));
    const row = snap.p.find((r) => r[0] === alex.id);
    ok('Blake receives Alex\'s position', Math.abs(row[1] - spawn.lat) < 1e-6 && Math.abs(row[3] - 900) < 0.01);
    ok('with Alex\'s health', row[12] === MAX_HEALTH);
    ok('the roster knows both', alex.has('join', (m) => m.p.name === 'Blake') || blake.has('roster', (m) => m.players.length === 2));
  }

  console.log('\nchat');
  {
    alex.send({ t: 'chat', text: 'hello <b>world</b>' });
    const line = await blake.next('chat', (m) => m.kind === 'chat');
    ok('a line reaches everyone, as text', line.text === 'hello <b>world</b>' && line.from.name === 'Alex');
    alex.send({ t: 'chat', text: '/msg Blake psst' });
    const w = await blake.next('chat', (m) => m.kind === 'whisper');
    ok('a whisper reaches its target', w.text === 'psst');
    blake.send({ t: 'chat', text: '/r hi back' });
    const r = await alex.next('chat', (m) => m.kind === 'whisper');
    ok('and /r answers it', r.text === 'hi back' && r.from.name === 'Blake');
    alex.send({ t: 'chat', text: '/nonsense' });
    const err = await alex.next('chat', (m) => m.kind === 'error');
    ok('an unknown command says so', /Unknown command/.test(err.text));
  }

  console.log('\nteleport requests');
  {
    alex.send({ t: 'chat', text: '/tpa blake' });
    const req = await blake.next('tpreq');
    ok('Blake is asked', req.kind === 'tpa' && req.from.name === 'Alex' && req.expiresIn === TPA_TIMEOUT_S);
    blake.send({ t: 'chat', text: '/tpaccept' });
    const tp = await alex.next('teleport');
    ok('accepting sends Alex to Blake', Math.abs(tp.lat - (alex.auth.pos.lat + metresNorth(2))) < 0.001 && tp.reason === 'tpa');
    ok('at Blake\'s height', Math.abs(tp.alt - 900) < 0.01);
    alex.lastTid = tp.tid;
    // A state before arriving is ignored; after arriving it is accepted.
    alex.send({ t: 'arrived', tid: tp.tid });
    alex.state({ lat: tp.lat, lon: tp.lon, alt: tp.alt });

    blake.send({ t: 'chat', text: '/tpahere Alex' });
    const here = await alex.next('tpreq');
    ok('/tpahere asks the other way', here.kind === 'tpahere');
    alex.send({ t: 'chat', text: '/tpdeny Blake' });
    const end = await blake.next('tpreq-end', (m) => m.reason === 'denied');
    ok('and /tpdeny ends it for both', end.reason === 'denied');

    // The forty-second timeout. The clock is not moved for this — a clock
    // moved forward forty seconds also makes every socket look silent — the
    // request's own deadline is read and then stood on either side of.
    blake.send({ t: 'chat', text: '/tpa Alex' });
    const cooling = await blake.next('chat', (m) => m.kind === 'error');
    ok('asking the same person again at once has to wait', /before asking Alex again/.test(cooling.text));
    server.game.players.get(blake.id).lastRequestAt.clear();
    blake.send({ t: 'chat', text: '/tpa Alex' });
    await alex.next('tpreq');
    const request = [...server.game.requests.values()].find((r) => r.from.key === 'blake');
    const lifetime = (request.expires - Date.now()) / 1000;
    ok(`the request is given forty seconds  (${lifetime.toFixed(1)} s)`, Math.abs(lifetime - TPA_TIMEOUT_S) < 1);
    request.expires = Date.now() + 1000;
    server.game.tick();
    ok('it is still open just before its deadline', !blake.has('tpreq-end', (m) => m.reason === 'expired'));
    request.expires = Date.now() - 1;
    server.game.tick();
    const expired = await blake.next('tpreq-end', (m) => m.reason === 'expired');
    ok('and runs out after it, for both of them', expired.reason === 'expired'
      && (await alex.next('tpreq-end', (m) => m.reason === 'expired').then(() => true, () => alex.has('tpreq-end'))));

    // Asking again replaces the old request — and says so, or a prompt for
    // the old one could still be answered and do the opposite.
    const blakeP = server.game.players.get(blake.id);
    // Past the chat limit by now, which commands count against too.
    server.game.chatTimes.delete('blake');
    blakeP.lastRequestAt.clear();
    blake.send({ t: 'chat', text: '/tpa Alex' });
    const first = await alex.next('tpreq');
    blakeP.lastRequestAt.clear();
    blake.send({ t: 'chat', text: '/tpahere Alex' });
    const replaced = await alex.next('tpreq-end', (m) => m.id === first.id);
    const second = await alex.next('tpreq', (m) => m.id !== first.id);
    ok('a second request replaces the first, and the first is closed', replaced.reason === 'replaced' && second.kind === 'tpahere');
    // Names can be shortened, as with /tpa.
    alex.send({ t: 'chat', text: '/tpdeny bla' });
    const denied = await blake.next('tpreq-end', (m) => m.id === second.id);
    ok('/tpdeny takes a shortened name', denied.reason === 'denied');
    // /tphere is the same command as /tpahere.
    blakeP.lastRequestAt.clear();
    blake.send({ t: 'chat', text: '/tphere Alex' });
    const alias = await alex.next('tpreq', (m) => m.id !== second.id && m.id !== first.id);
    ok('/tphere is /tpahere', alias.kind === 'tpahere');
    server.game.chatTimes.delete('alex');
    alex.send({ t: 'chat', text: '/tpdeny Blake' });
    await blake.next('tpreq-end', (m) => m.id === alias.id);
    // A shortened name that fits more than one person names them all, rather
    // than claiming there is nobody called that.
    const blakely = await new Bot('Blakely').open();
    await blakely.signup();
    await blakely.land();
    alex.clear();
    alex.send({ t: 'chat', text: '/tpa bla' });
    const which = await alex.next('chat', (m) => m.kind === 'error');
    ok('a shortened name that fits two people names them both', /could be Blake, Blakely/.test(which.text), which.text);

    // Nobody dead can be asked: dying ends every request a player has, so
    // one sent to somebody dead would only end the moment they answered.
    const blakelyP = server.game.players.get(blakely.id);
    server.game.kill(blakelyP, 'fall');
    alex.send({ t: 'chat', text: '/tpa Blakely' });
    const dead = await alex.next('chat', (m) => m.kind === 'error' && /dead/.test(m.text));
    ok('asking somebody dead is refused, and says why', /Blakely is dead — ask again when they respawn/.test(dead.text), dead.text);
    server.game.respawn(blakelyP);

    // And a request the other one dies in ends saying so, not silently.
    const alexP = server.game.players.get(alex.id);
    server.game.chatTimes.delete('alex');
    alexP.lastRequestAt.clear();
    alex.send({ t: 'chat', text: '/tpa Blakely' });
    await blakely.next('tpreq');
    server.game.kill(blakelyP, 'fall');
    const told = await alex.next('chat', (m) => /died — the teleport request is off/.test(m.text));
    ok('a request that ends with a death says so to the other side', !!told && alex.has('tpreq-end', (m) => m.reason === 'died'));
    await blakely.close();
  }

  console.log('\nvoice signalling');
  {
    alex.clear();
    blake.clear();
    alex.send({ t: 'voice', to: blake.id, kind: 'offer', data: { cid: 'c1', sdp: 'v=0 test', extra: '<b>hi</b>' } });
    const got = await blake.next('voice');
    ok('an offer to somebody near is passed on', got.kind === 'offer' && got.data.sdp === 'v=0 test' && got.from === alex.id);
    ok('with only the fields an offer has', Object.keys(got.data).sort().join() === 'cid,sdp');
    alex.send({ t: 'voice', to: blake.id, kind: 'offer', data: { cid: 'c1', sdp: 'x'.repeat(30000) } });
    alex.send({ t: 'voice', to: blake.id, kind: 'ice', data: { cid: 'c1', c: Array.from({ length: 30 }, () => ({ candidate: 'a' })) } });
    alex.send({ t: 'voice', to: blake.id, kind: 'bye', data: { cid: 'c1', why: 'x'.repeat(100) } });
    const bye = await blake.next('voice', (m) => m.kind === 'bye');
    ok('an oversized offer and a flood of candidates are not',
      !blake.inbox.some((m) => m.t === 'voice' && (m.kind === 'ice' || m.data?.sdp?.length > 20000)));
    ok('and a hang-up is cut to size', bye.data.why.length <= 16);
  }

  console.log('\nmoves the server will not accept');
  {
    alex.clear();
    // Three hundred kilometres in a tenth of a second is not a rocket.
    alex.state({ lat: alex.pos.lat + 3, lon: alex.pos.lon, alt: 900 });
    const fix = await alex.next('correct');
    ok('a teleport nobody granted is put back', Math.abs(fix.lat - alex.pos.lat + 3) < 0.01);
    alex.pos = { lat: fix.lat, lon: fix.lon, alt: 900 };
    await sleep(120);
    alex.clear();
    alex.state({ lat: alex.pos.lat + metresNorth(20), lon: alex.pos.lon, alt: 900 });
    await sleep(150);
    ok('an ordinary step is not', !alex.has('correct'));

    // A surge covers ground several times as fast, and honestly — but only for
    // as long as a surge lasts, not for as long as a page says it is surging.
    const p = server.game.players.get(alex.id);
    const dash = async (flags) => {
      alex.clear();
      const before = alex.pos;
      p.budget = 0;
      p.lastStateAt = Date.now() - 1000;
      p.correctedAt = -Infinity;
      alex.state({ lat: alex.pos.lat + metresNorth(800), lon: alex.pos.lon, alt: 900, flags });
      await sleep(150);
      if (alex.has('correct')) {
        alex.pos = before;
        return false;
      }
      return true;
    };
    // Flying: on foot the limit is a runner's (see 'held to what the game can do').
    ok('800 m in a second is too fast outside a surge', !(await dash(FLAG.elytra)));
    ok('and not inside one', await dash(FLAG.elytra | FLAG.surge));
    p.violations = 0;
    // The surge's own timeline, on a player of its own: the twelve seconds,
    // the grace after them, the fade, and the thirty to recharge.
    const g = server.game;
    const t0 = 1e9;
    const fake = { surge: { on: false, since: 0, endedAt: -Infinity, readyAt: 0 }, lastStateAt: t0, burst: null };
    ok('a surge is worth its allowance of the limit', g.surgeFactor(fake, FLAG.surge, t0) === SURGE_ALLOWANCE);
    fake.lastStateAt = t0 + 13000;
    ok('for its twelve seconds', g.surgeFactor(fake, FLAG.surge, t0 + 13000) === SURGE_ALLOWANCE);
    g.surgeFactor(fake, FLAG.surge, t0 + 14500);
    ok('and not for ever, however long the flag stays on', g.surgeFactor(fake, FLAG.surge, t0 + 16000) < SURGE_ALLOWANCE);
    const fade = 1 + (SURGE_ALLOWANCE - 1) * Math.exp(-0.25 * 4.5);
    ok('it fades as slowly as the game lets it', Math.abs(g.surgeFactor(fake, FLAG.surge, t0 + 18500) - fade) < 0.01);
    ok('and cannot start again while it recharges', g.surgeFactor(fake, FLAG.surge, t0 + 30000) < 1.1);
    ok('but can once it has', g.surgeFactor(fake, FLAG.surge, t0 + 43000) === SURGE_ALLOWANCE);
  }

  console.log('\na sword fight');
  {
    // Face to face, two metres apart, away from spawn.
    const where = { lat: FIELD.lat + 0.01, lon: FIELD.lon + 0.01 };
    // Put both in the field through an admin teleport so the server agrees.
    const game = server.game;
    for (const [bot, dLat] of [[alex, 0], [blake, metresNorth(2)]]) {
      const p = game.players.get(bot.id);
      p.lastSpawnAt = -Infinity;
      game.teleport(p, { lat: where.lat + dLat, lon: where.lon, alt: 500, flying: false }, 'test');
      const tp = await bot.next('teleport', (m) => m.reason === 'test');
      bot.send({ t: 'arrived', tid: tp.tid });
      bot.state({ lat: tp.lat, lon: tp.lon, alt: 500, item: bot === alex ? SWORD_SLOT : 0 });
    }
    await sleep(150);
    blake.clear();
    alex.strike(blake.id);
    const hit = await blake.next('hit');
    ok('a hit lands', hit.amount > 0 && hit.by.name === 'Alex' && hit.health < MAX_HEALTH, `took ${hit.amount}`);
    ok('and knocks Blake back, away from Alex', Array.isArray(hit.kb) && hit.kb[2] > 0 && hit.kb[1] > 0);
    const first = hit.amount;
    alex.strike(blake.id);
    await sleep(120);
    ok('a second swing inside the immunity does nothing', blake.inbox.filter((m) => m.t === 'hit').length === 1);
    ok('the first hit was a fresh swing\'s worth', first >= 5);

    // A fight to the death, with the cooldown respected.
    let died = null;
    for (let i = 0; i < 12 && !died; i++) {
      await sleep(650);
      alex.strike(blake.id);
      died = await blake.next('died', () => true, 700).catch(() => null);
    }
    ok('enough hits kill', !!died && died.by?.name === 'Alex', died?.message);
    const notice = await alex.next('chat', (m) => m.kind === 'death');
    ok('and everybody hears about it', /Blake was slain by Alex/.test(notice.text));
    blake.send({ t: 'respawn' });
    const back = await blake.next('teleport', (m) => m.reason === 'respawn');
    const health = blake.inbox.find((m) => m.t === 'health');
    ok('respawning sends Blake back to spawn with full hearts', Math.abs(back.lat - 46.5606) < 1e-4 && health?.health === MAX_HEALTH);

    // Out of reach.
    blake.send({ t: 'arrived', tid: back.tid });
    blake.state({ lat: back.lat, lon: back.lon, alt: 600 });
    await sleep(700);
    blake.clear();
    alex.strike(blake.id);
    await sleep(200);
    ok('a swing at somebody kilometres away does nothing', !blake.has('hit'));
  }

  console.log('\nwhat other people have discovered');
  {
    alex.send({ t: 'watch', name: 'blake', explored: true, trail: true });
    const explored = await alex.next('explored');
    ok('switching on Blake\'s discoveries sends them', explored.name === 'blake' && explored.cells?.v === 2);
    const trail = await alex.next('trail');
    ok('and the trail', Array.isArray(trail.legs) && trail.legs.length >= 1);
    alex.send({ t: 'atlas' });
    const atlas = await alex.next('atlas');
    ok('the atlas lists who has been here', atlas.players.some((p) => p.key === 'blake' && p.explored > 0));

    // Everyone's discoveries are one shared map: sent whole when asked for,
    // and new ground from anybody — a newcomer too — as it is found.
    const g = server.game;
    const viewer = g.players.get(alex.id);
    alex.send({ t: 'watch', name: '*', explored: true, trail: false });
    const whole = await alex.next('shared');
    ok('asking for everyone\'s discoveries sends the shared map of this world',
      viewer.watchAll.explored === true && whole.world === 'earth' && whole.cells?.v === 2);
    server.accounts.signups.hits.clear();
    const cara = await new Bot('Cara').open();
    await cara.signup();
    await cara.land();
    // Somewhere nobody has been: sent there the way the server sends anyone.
    g.teleport(g.byKey.get('cara'), { lat: 12.5, lon: 15.5, alt: 900, flying: true }, 'test');
    const sent = await cara.next('teleport', (m) => m.reason === 'test');
    cara.send({ t: 'arrived', tid: sent.tid });
    cara.state({ lat: sent.lat, lon: sent.lon, alt: 900 });
    const added = await alex.next('shared+', (m) => m.keys?.length > 0, 4000).catch(() => null);
    ok('and a newcomer\'s new ground arrives on it without asking for anybody by name', !!added);
    ok('the shared map holds everybody\'s ground', g.sharedMap('earth').map.cells.size >= g.record('cara').on('earth').explored.cells.size);
    cara.close();
    // Off and on again is not a way to be sent the whole map again: it goes
    // once per connection and world (a toggle in a loop sent it every time).
    alex.send({ t: 'watch', name: '*', explored: true, off: true });
    await sleep(100);
    alex.clear();
    alex.send({ t: 'watch', name: '*', explored: true });
    await sleep(300);
    ok('switching everyone\'s discoveries off and on again does not send the whole map again', !alex.has('shared'));
    // A busy server's map is big: it goes in parts, paced, and nobody is cut
    // off. Every other cell of a block, so it is kept as runs, not one run.
    const big = g.sharedMap('earth').map;
    for (let i = 0; i < 150000; i++) big.cells.add(`16/${30000 + 2 * (i % 400)}/${20000 + Math.floor(i / 400)}`);
    const dora = await new Bot('Dora').open();
    await dora.signup();
    await dora.land();
    // Somebody not yet sent it is sent the whole of it, in parts that wait
    // for the page to have read the one before.
    dora.clear();
    dora.send({ t: 'watch', name: '*', explored: true });
    let parts = 0;
    let of = 0;
    for (;;) {
      const part = await dora.next('shared', () => true, 8000).catch(() => null);
      if (!part) break;
      parts += 1;
      of = part.of;
      if (parts >= of) break;
    }
    ok(`a big shared map arrives in parts and the connection survives  (${parts} of ${of})`,
      of > 1 && parts === of && g.players.has(dora.id));
    // Kept as runs, not a name per cell: it goes out whole and exactly.
    const cells = g.sharedMap('earth').map.cells;
    const { decodeCells } = await import('../src/ui/exploration.js');
    const back = cells.parts(20000).reduce((n, part) => n + decodeCells(part).length, 0);
    ok(`the shared map is kept as runs and goes out exactly  (${cells.size} cells)`,
      back === cells.size && cells.has('16/30000/20000') && !cells.has('16/30001/20000') && !cells.has('16/29999/20000'));
    // One player adds at most a day's worth of honest flying to everybody's
    // map: a script claiming to fly flat out all day is held to it.
    const doraP = g.byKey.get('dora');
    const before = g.sharedMap('earth').map.cells.size;
    const flood = [];
    for (let i = 0; i < 200000; i++) flood.push(`16/${i % 60000}/${40000 + Math.floor(i / 60000)}`);
    g.addShared('earth', flood, doraP);
    const grew = g.sharedMap('earth').map.cells.size - before;
    ok(`one player adds at most a day's honest flying to the shared map  (${grew})`, grew === 150000);
    dora.close();
    // That is a lot of new ground at once for everybody looking: it reaches
    // them in pieces, and nobody looking is cut off for being sent it (Alex,
    // sent it in one five megabyte message, was dropped by the next position).
    const pieces = [];
    for (let total = 0; total < 150000;) {
      const piece = await alex.next('shared+', () => true, 4000).catch(() => null);
      if (!piece) break;
      pieces.push(piece.keys.length);
      total += piece.keys.length;
    }
    await sleep(300);
    ok(`new ground on the shared map goes out in pieces, and the page looking keeps its connection  (${pieces.length} pieces, biggest ${Math.max(...pieces)})`,
      pieces.reduce((a, b) => a + b, 0) >= 150000 && Math.max(...pieces) <= 20000 && g.players.has(alex.id) && alex.ws.readyState === 1);
  }

  console.log('\ntravelling to another world');
  {
    blake.send({ t: 'chat', text: '/travel the moon' });
    const went = await blake.next('travelled');
    ok('/travel moves you to the Moon', went.world === 'moon');
    await blake.close();
    const back = await new Bot('Blake').open();
    back.send({ t: 'resume', token: blake.auth.token });
    const auth = await back.next('auth');
    ok('signing back in with the token puts you there', auth.ok && auth.world === 'moon');
    ok('at Tranquility Base', Math.abs(auth.pos.lat - 0.67416) < 1e-4);
    // A random teleport off Earth goes somewhere with a name.
    // The suit's tank is the server's to count.
    const g = server.game;
    const me = g.byKey.get('blake');
    ok('signing in tells the page what is left in the tank', Number.isFinite(auth.oxygen));
    const base = g.spawnOf('moon');
    me.state = { vel: [0, 0, 0], yaw: 0, pitch: 0, roll: 0, item: 0, ...(me.state ?? {}), lat: base.lat + metresNorth(2000), lon: base.lon, alt: 0, agl: 2, flags: FLAG.ground };
    me.pending = null;
    me.oxygen = 100;
    g.tickOxygen(me, 10, Date.now());
    ok('away from the base it drains a second a second', Math.abs(me.oxygen - 90) < 1e-9);
    me.state.flags = FLAG.surge;
    g.tickOxygen(me, 10, Date.now());
    ok('twice that in a surge', Math.abs(me.oxygen - 70) < 1e-9);
    me.oxygen = 0;
    const hearts = me.health;
    g.tickOxygen(me, 1, Date.now());
    const choke = await back.next('hit', (m) => m.cause === 'suffocated');
    ok('and empty, the server suffocates you itself', me.health === hearts - 2 && choke.amount === 2);
    me.state = { ...me.state, lat: base.lat, lon: base.lon + 0.0001, agl: 1, flags: FLAG.ground };
    g.tickOxygen(me, 1, Date.now());
    ok('at the base it refills', me.oxygen === 40);
    g.remember(me);
    ok('and what is left is kept, so a reload is not a refill', me.record.oxygen === 40);
    // The lander, by the page's rules, kept here too.
    me.state = { ...me.state, flags: 0 };
    back.clear();
    back.send({ t: 'lander' });
    const airborne = await back.next('chat', (m) => m.kind === 'error');
    ok('a lander will not go down in mid-air', /Land first/.test(airborne.text));
    me.state = { ...me.state, flags: FLAG.ground };
    back.send({ t: 'lander' });
    await back.next('lander');
    back.send({ t: 'lander' });
    const again = await back.next('chat', (m) => m.kind === 'error');
    ok('nor move again straight away, whatever the page says', /can move again/.test(again.text));
    // Rockets: what the page had is kept, and comes back at the page's rate.
    back.send({ t: 'rockets', stock: [10, 64, 64, 64, 64] });
    await sleep(100);
    me.record.rockets.at = Date.now() - 8000;
    ok('the rocket stock is kept, with what has come back since', g.rocketsNow(me.record)[0] === 12);
    back.send({ t: 'rtp' });
    const dropped = await back.next('teleport');
    const said = await back.next('chat', (m) => /Dropped/.test(m.text ?? ''));
    ok('a random teleport on the Moon lands on a named feature', Number.isFinite(dropped.lat) && /Dropped near \S/.test(said.text), said.text);
    // The base limit is the same everywhere: what a fall gives you is counted
    // per player on top of it (fallReserve, and tools/flightcheck.mjs). A glide
    // in thin air, which reaches the world's terminal speed, raises the base.
    ok('the base speed limit on the Moon is the same as on Earth',
      server.game.maxSpeed('moon') === 180 && server.game.maxSpeed('earth') === 180);
    ok(`on Mars it clears a glide at terminal speed  (${server.game.maxSpeed('mars').toFixed(0)} m/s)`,
      server.game.maxSpeed('mars') > 378 * 1.1);
    // Another world, a full tank: it was one number for every world, so the
    // Moon's last twenty-five seconds came along to Mars.
    me.oxygen = 25;
    g.moveWorld(me, 'mars');
    const onMars = me.oxygen;
    g.moveWorld(me, 'moon');
    ok('travelling to another world arrives with a full tank', onMars === 300 && me.record.oxygen === 300, `${onMars}`);
    back.close();
  }

  console.log('\nsign-in');
  {
    const wrong = await new Bot('Alex').open();
    wrong.send({ t: 'login', name: 'Alex', password: 'not it' });
    const no = await wrong.next('auth');
    ok('a wrong password is refused', !no.ok && /Wrong name or password/.test(no.error));
    wrong.send({ t: 'login', name: 'alex', password: 'hunter22' });
    const yes = await wrong.next('auth');
    ok('the right one is not, whatever the case of the name', yes.ok && yes.you.name === 'Alex');
    const kicked = await alex.next('kick');
    ok('and the older connection is told it was replaced', /somewhere else/.test(kicked.reason));
    wrong.close();
  }

  console.log('\nbehind a proxy');
  {
    const req = (forwarded, extra = {}) => ({ headers: { 'x-forwarded-for': forwarded, ...extra }, socket: { remoteAddress: '127.0.0.1' } });
    ok('without trustProxy the socket is believed, not the header',
      clientAddress(req('6.6.6.6'), { trustProxy: false }) === '127.0.0.1');
    // A visitor can start X-Forwarded-For with anything; the proxy appends
    // what it saw. The last entry is the one the proxy wrote.
    ok('with it, the last X-Forwarded-For entry — the one the proxy added',
      clientAddress(req('6.6.6.6, 203.0.113.9'), { trustProxy: true }) === '203.0.113.9');
    ok('and a named proxy header wins when one is set',
      clientAddress(req('6.6.6.6, 203.0.113.9', { 'cf-connecting-ip': '198.51.100.4' }), { trustProxy: true, proxyHeader: 'CF-Connecting-IP' }) === '198.51.100.4');
    ok('but is ignored when none is',
      clientAddress(req('203.0.113.9', { 'cf-connecting-ip': '6.6.6.6' }), { trustProxy: true }) === '203.0.113.9');
  }

  console.log('\nhostile connections');
  {
    const net = await import('node:net');
    const raw = async () => {
      const socket = net.connect(address.port, '127.0.0.1');
      await new Promise((r) => socket.once('connect', r));
      socket.on('error', () => {});
      socket.write('GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
        + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
      await new Promise((r) => socket.once('data', r));
      return socket;
    };
    // One message in thousands of empty pieces: no bytes to trip the size
    // limit, and every piece still had to be held.
    const flood = await raw();
    let closed = false;
    flood.on('close', () => { closed = true; });
    flood.write(Buffer.from([0x01, 0x81, 0, 0, 0, 0, 0x41]));
    flood.write(Buffer.concat(Array(500).fill(Buffer.from([0x00, 0x80, 0, 0, 0, 0]))));
    await new Promise((r) => setTimeout(r, 400));
    ok('a message sent in hundreds of empty pieces is refused, not held', closed);
    // Hanging up halfway — FIN sent, still reading — must not keep a socket.
    const before = server.game.clients.size;
    const half = await raw();
    await new Promise((r) => setTimeout(r, 200));
    half.end();
    let gone = false;
    half.on('close', () => { gone = true; });
    await new Promise((r) => setTimeout(r, 600));
    ok('a half-closed connection is let go', gone && server.game.clients.size === before);
  }

  console.log('\na slow connection is not a stalled one');
  {
    const net = await import('node:net');
    const { WebSocket: Wire, MAX_BUFFERED_BYTES } = await import('../server/ws.mjs');
    // The server's own kind of socket on a plain TCP pair (the handshake is
    // not what is under test), and a far end that reads only when told to.
    const pair = () => new Promise((resolve) => {
      let far;
      const srv = net.createServer((socket) => {
        srv.close();
        far.pause();
        resolve({ near: new Wire(socket), far });
      });
      srv.listen(0, '127.0.0.1', () => {
        far = net.connect(srv.address().port, '127.0.0.1');
        far.on('error', () => {});
      });
    });
    const BIG = 16 * 1024 * 1024;
    const small = 'x'.repeat(1000);
    // A whole map on its way to a page that has not got to it yet, and the
    // positions after it: the socket says all of it is waiting until the map's
    // last byte has gone, and that is not a page that stopped reading.
    const slow = await pair();
    slow.near.send('m'.repeat(BIG));
    for (let i = 0; i < 1500; i++) slow.near.send(small);
    ok('a big message still on its way out does not make a reading page look stalled',
      slow.near.open, `${(slow.near.bufferedAmount / 1048576).toFixed(1)} MB waiting`);
    let got = 0;
    slow.far.on('data', (chunk) => { got += chunk.length; });
    slow.far.resume();
    const expected = BIG + 10 + 1500 * (1000 + 4);
    for (let waited = 0; got < expected && waited < 10000; waited += 50) await sleep(50);
    ok('and the page reading it gets every byte', got === expected, `${got} of ${expected}`);
    slow.near.close();
    slow.far.destroy();
    // Positions piling up behind it past the limit: that page has stopped.
    const stalled = await pair();
    stalled.near.send('m'.repeat(BIG));
    let sent = 0;
    while (stalled.near.open && sent < 10000) {
      stalled.near.send(small);
      sent += 1;
    }
    ok('positions piling up past the limit behind it still drop a page that stopped reading',
      !stalled.near.open && sent * 1004 > MAX_BUFFERED_BYTES && sent * 1004 < MAX_BUFFERED_BYTES * 1.2, `after ${sent} positions`);
    stalled.far.destroy();
    // Nor one that only pings: each ping is answered with a pong written
    // straight to the socket, and a peer that never read them piled them up
    // where the limit above never looked - until the game's backlog check let
    // it go at 24 MB, with no account needed.
    const pinger = await pair();
    pinger.near.send('m'.repeat(BIG));
    const ping = Buffer.from([0x89, 0x80 | 125, 1, 2, 3, 4, ...new Array(125).fill(0)]);
    let pings = 0;
    while (pinger.near.open && pings < 40000) {
      pinger.near.receive(ping);
      pings += 1;
    }
    ok('a peer that pings and never reads is dropped past the same limit',
      !pinger.near.open && pings * 127 > MAX_BUFFERED_BYTES && pings * 127 < MAX_BUFFERED_BYTES * 1.2, `after ${pings} pings`);
    pinger.far.destroy();
  }

  console.log('\nguessing a join code');
  {
    const gated = startServer({ port: 0, host: '127.0.0.1', dataDir: mkdtempSync(join(tmpdir(), 'terraglide-gated-')), joinCode: 'river-otter-42', saveEveryS: 3600 });
    const gatedAt = await gated.ready;
    let refusedAt = 0;
    for (let i = 0; i < 12 && !refusedAt; i++) {
      const reply = await gated.accounts.signup(`Guess${i}x`, 'hunter22', '203.0.113.7', `wrong-${i}`);
      if (/Too many tries/.test(reply.error ?? '')) refusedAt = i + 1;
    }
    ok(`wrong join codes run out after a few tries, like wrong passwords  (refused on try ${refusedAt})`, refusedAt > 0 && refusedAt <= 9);
    const rightful = await gated.accounts.signup('Rightful', 'hunter22', '198.51.100.9', 'river-otter-42');
    ok('while somebody else with the right code still gets in', !!rightful.account && !rightful.error);
    await gated.stop();
    void gatedAt;
  }

  console.log('\nbans');
  {
    const g = server.game;
    const { readFileSync: readDisk, existsSync } = await import('node:fs');
    server.accounts.signups.hits.clear();
    // Alex's own connection was replaced in 'sign-in': the admin is back by token.
    const asAlex = async (bot = new Bot('Alex')) => {
      (await bot.open()).send({ t: 'resume', token: alex.auth.token, remember: false });
      return [bot, await bot.next('auth')];
    };
    const [admin] = await asAlex();
    const eli = await new Bot('Eli').open();
    await eli.signup();
    await eli.land();
    const onDisk = JSON.parse(readDisk(join(dir, 'accounts.json'), 'utf8'));
    ok('a new account is on disk at once, not at the next save', JSON.stringify(onDisk).includes('"eli"'));
    // Everybody here is 127.0.0.1: the address is shared, so only the account goes.
    admin.send({ t: 'chat', text: '/ban Eli testing' });
    const said = await admin.next('chat', (m) => /Eli is banned/.test(m.text));
    ok('banning someone whose address others share bans the account only', /only the account/.test(said.text) && g.bans.eli?.address === null);
    await eli.closed;
    ok('and what they had is on disk the moment they leave', existsSync(join(dir, 'players', 'eli.json')));
    const fay = await new Bot('Fay').open();
    ok('somebody else from the same address can still sign up', (await fay.signup()).ok === true);
    await fay.close();
    g.bans.eli.address = '127.0.0.1'; // as if Eli had had an address of their own
    const gusAuth = await (await new Bot('Gus').open()).signup();
    ok('an address ban refuses a new account from it', gusAuth.ok === false && /address is banned/.test(gusAuth.error));
    ok('but never an admin', (await asAlex())[1].ok === true);
    delete g.bans.eli;
  }

  console.log('\nfriends');
  {
    // Every bot signs up from 127.0.0.1; the hourly limit is not under test here.
    server.accounts.signups.hits.clear();
    const gina = await new Bot('Gina').open();
    await gina.signup();
    await gina.land();
    const hugo = await new Bot('Hugo').open();
    await hugo.signup();
    await hugo.land();
    gina.send({ t: 'chat', text: '/friend add Hugo' });
    const asked = await hugo.next('chat', (m) => m.kind === 'friend' && /wants to be friends/.test(m.text));
    const lists = await hugo.next('friends', (m) => m.incoming.some((f) => f.key === 'gina'));
    ok('a friend request reaches them, with a notice', !!asked && !!lists);
    hugo.send({ t: 'chat', text: '/friend accept' });
    const both = await gina.next('friends', (m) => m.friends.some((f) => f.key === 'hugo' && f.online));
    ok('accepting makes you friends, both ways', !!both && server.game.social.areFriends('hugo', 'gina'));
    // Two people online in near enough the same colour: the one joining gets
    // another, for good.
    const { colourDistance, TWIN_DISTANCE } = await import('../src/net/protocol.js');
    server.accounts.get('hugo').colour = server.accounts.get('gina').colour;
    // The startup screen's view: a page with Gina's session asks the status
    // how many of her friends are on, before signing in.
    const status = async (token) => (await fetch(`${BASE}/api/status`, { method: 'POST', body: token, headers: { 'content-type': 'text/plain' } })).json();
    const sessionOf = (token) => server.accounts.sessions[createHash('sha256').update(token).digest('base64url')];
    const usedBefore = sessionOf(gina.auth.token).used;
    const withHugo = await status(gina.auth.token);
    ok('the status tells a page with a session how many of its friends are on', withHugo.friends?.online === 1 && withHugo.friends?.total === 1, JSON.stringify(withHugo.friends));
    ok('and is still the public status besides', withHugo.terraglide === true && withHugo.online >= 2);
    ok('a look is not a sign-in: the session is not refreshed', sessionOf(gina.auth.token).used === usedBefore);
    const stranger = await status('not-a-token');
    ok('a token that is not one gets the plain status, no friends', stranger.terraglide === true && !('friends' in stranger));
    await hugo.close();
    const gone = await gina.next('chat', (m) => m.kind === 'friend' && /Hugo went offline/.test(m.text));
    ok('friends hear when you go offline', !!gone);
    const without = await status(gina.auth.token);
    ok('and the status count drops with them, at once', without.friends?.online === 0 && without.friends?.total === 1, JSON.stringify(without.friends));
    // Back with the token, as a reload does.
    const back = await new Bot('Hugo').open();
    back.send({ t: 'resume', token: hugo.auth.token });
    back.auth = await back.next('auth');
    back.id = back.auth.you.id;
    const online = await gina.next('chat', (m) => m.kind === 'friend' && /Hugo is online/.test(m.text));
    ok('and when you come back', !!online);
    const hugoNow = server.accounts.get('hugo').colour;
    ok('somebody joining in another player\'s colour is given a different one',
      colourDistance(hugoNow, server.accounts.get('gina').colour) >= TWIN_DISTANCE);
    await back.land(hugo.pos.lat, hugo.pos.lon, hugo.pos.alt);
    // A request to somebody offline waits for them.
    const ivy = await new Bot('Ivy').open();
    await ivy.signup();
    await ivy.close();
    gina.send({ t: 'chat', text: '/friend add Ivy' });
    await gina.next('chat', (m) => /Friend request sent to Ivy/.test(m.text));
    const ivyBack = await new Bot('Ivy').open();
    ivyBack.send({ t: 'login', name: 'Ivy', password: 'hunter22' });
    await ivyBack.next('auth');
    const waiting = await ivyBack.next('chat', (m) => m.kind === 'friend' && /1 friend request waiting/.test(m.text));
    ok('a request made while you were away is waiting when you sign in', !!waiting);
    ivyBack.close();
    // Auto-accept teleport requests from friends.
    back.send({ t: 'socialPrefs', autoTpa: true, autoParty: true, notify: true });
    await sleep(100);
    gina.send({ t: 'chat', text: '/tpa Hugo' });
    const went = await gina.next('teleport', (m) => m.reason === 'tpa');
    ok('a friend who accepts automatically sends you straight there', !!went);
    gina.send({ t: 'arrived', tid: went.tid });
    gina.state({ lat: went.lat, lon: went.lon, alt: went.alt });
    // Not into the middle of a fight: the request waits while the one who
    // would move is in one, and goes through by itself once it is over.
    gina.clear();
    const hugoP = server.game.byKey.get('hugo');
    server.game.byKey.get('gina').lastRequestAt.clear();
    server.game.chatTimes.delete('gina');
    hugoP.combatUntil = server.game.now() + 60000;
    back.clear();
    gina.send({ t: 'chat', text: '/tpahere Hugo' });
    await sleep(400);
    server.game.tick();
    ok('auto-accept waits while the one who would move is in a fight', !back.has('teleport') && server.game.requests.size > 0);
    // Held, not refused: the next tick after the fight carries it out.
    hugoP.combatUntil = 0;
    server.game.tick();
    const later = await back.next('teleport', (m) => m.reason === 'tpa', 3000).catch(() => null);
    ok('and goes through by itself when the fight is over', !!later);
    if (later) {
      back.send({ t: 'arrived', tid: later.tid });
      back.state({ lat: later.lat, lon: later.lon, alt: later.alt });
    }

    console.log('\nparties');
    // Hugo accepts party invites from friends too.
    gina.send({ t: 'chat', text: '/party invite Hugo' });
    const joined = await gina.next('party', (m) => m.party?.members.length === 2);
    ok('a friend who accepts party invites automatically is in the party at once', !!joined && joined.party.leader === 'gina');
    back.send({ t: 'socialPrefs', autoTpa: false, autoParty: false, notify: true });
    // /pc talks to the party, wherever its members are.
    gina.send({ t: 'chat', text: '/pc over here' });
    const said = await back.next('chat', (m) => m.kind === 'party' && m.text === 'over here');
    ok('party chat reaches the party', !!said && said.from.name === 'Gina');
    back.send({ t: 'partyMark', name: 'Camp', lat: 46.61, lon: 7.95 });
    const marked = await gina.next('party', (m) => m.party?.waypoints.some((w) => w.name === 'Camp'));
    ok('a party waypoint is everyone\'s', !!marked && marked.party.waypoints[0].by === 'Hugo');
    // On disk as it is now, which is what a restart would find.
    server.game.saveServer();
    server.game.store.flush();
    const { readFileSync: readSaved } = await import('node:fs');
    const kept = JSON.parse(readSaved(join(dir, 'server.json'), 'utf8')).parties ?? [];
    ok('the party and its waypoints are kept across a restart',
      kept.length === 1 && kept[0].members.join() === 'gina,hugo' && kept[0].waypoints[0]?.name === 'Camp');
    // Voice reaches the party however far apart: the radio, heard from
    // anywhere on any world.
    const hp = server.game.byKey.get('hugo');
    hp.state = { ...hp.state, lat: hp.state.lat + 5 };
    gina.send({ t: 'voice', to: back.id ?? hp.id, kind: 'offer', data: { cid: 'p1', sdp: 'v=0 party' } });
    const far = await back.next('voice', (m) => m.data?.cid === 'p1', 2000).catch(() => null);
    ok('party voice reaches a member 500 km away', !!far);
    hp.state = { ...hp.state, lat: hp.state.lat - 5 };
    // Joining is not agreeing to be pulled about: the tick starts off.
    const party = server.game.social.partyFor('hugo');
    ok('nobody joins a party already ticked to teleport with it', !!party && !party.together.has('hugo'));
    back.send({ t: 'chat', text: '/party together on' });
    await back.next('party', (m) => m.party && m.party.members.find((x) => x.key === 'hugo')?.together);
    // The leader teleports, and the party comes along.
    server.game.byKey.get('gina').lastRtpAt = -Infinity;
    gina.send({ t: 'rtp' });
    const leaderTo = await gina.next('teleport', (m) => m.reason === 'rtp');
    const along = await back.next('teleport', (m) => m.reason === 'party');
    const apart = Math.hypot(along.lat - leaderTo.lat, along.lon - leaderTo.lon) * 111320;
    ok(`teleporting together: the party lands beside its leader  (${apart.toFixed(1)} m)`, apart < 20);
    // Unticked, the leader's next teleport leaves Hugo behind.
    back.send({ t: 'chat', text: '/party together off' });
    await back.next('party', (m) => m.party && !m.party.members.find((x) => x.key === 'hugo').together);
    server.game.byKey.get('gina').lastRtpAt = -Infinity;
    back.clear();
    gina.send({ t: 'arrived', tid: leaderTo.tid });
    gina.send({ t: 'rtp' });
    await gina.next('teleport', (m) => m.reason === 'rtp');
    await sleep(200);
    ok('and untick it to stay put', !back.has('teleport'));
    // Leaving a party of two ends it: a party of one is nobody's party.
    // The waypoints go to the members' own (see social.keepWaypoints).
    back.send({ t: 'chat', text: '/party leave' });
    const over = await gina.next('party', (m) => m.party === null);
    ok(`the last but one leaving ends the party  (${JSON.stringify([...server.game.social.parties.keys()])})`, !!over && server.game.social.parties.size === 0);
    // Invitations run out: a minute, then gone for both sides.
    gina.send({ t: 'chat', text: '/party invite Hugo' });
    const invite = await back.next('partyInvite');
    const invited = server.game.social.parties.get(invite.party);
    invited.invites.get('hugo').expires = Date.now() - 1;
    server.game.tick();
    const ran = await back.next('partyInviteEnd', (m) => m.reason === 'expired');
    ok(`a party invite lasts ${invite.expiresIn} s and then runs out`, !!ran && invite.expiresIn === 60);
    gina.close();
    back.close();
  }

  console.log('\npasswords');
  {
    server.accounts.signups.hits.clear();
    const pia = await new Bot('Pia').open();
    await pia.signup('first one');
    // The Online panel's form sends both whole; /password in chat splits on
    // spaces, so it takes two words exactly.
    const change = async (old, next) => {
      pia.send({ t: 'password', old, new: next });
      const reply = await pia.next('password');
      server.game.byKey.get('pia').client.passwordAt = -Infinity;
      return reply;
    };
    const spaced = await change('first one', 'a long one with spaces');
    ok('a new password with spaces in it is changed whole', spaced.ok === true);
    ok('and is the whole of what was typed', !!(await server.accounts.login('Pia', 'a long one with spaces', '127.0.0.1')).account);
    pia.send({ t: 'chat', text: '/password a long one with spaces and more' });
    const pointed = await pia.next('chat', (m) => m.kind === 'error');
    ok('/password with spaces is refused and points to the form', /Change password/.test(pointed.text));
    pia.send({ t: 'chat', text: `/password x ${'y'.repeat(400)}` });
    const cut = await pia.next('chat', (m) => m.kind === 'error');
    ok('and one cut short by the chat\'s length is refused rather than half set', /Change password/.test(cut.text));
    const wrong = await change('not it', 'whatever-else');
    ok('the wrong current password changes nothing', wrong.ok === false && !!(await server.accounts.login('Pia', 'a long one with spaces', '127.0.0.1')).account);
    // One past the longest allowed is read, so a longer one is refused, not
    // cut down to a password nobody typed.
    const long = await change('a long one with spaces', 'z'.repeat(200));
    ok('a new password over the limit is refused, not cut', long.ok === false && /at most/.test(long.error));
    // Signing out closes the session the token stood for.
    const token = pia.auth.token;
    pia.send({ t: 'logout' });
    await pia.next('loggedOut');
    await pia.closed;
    const again = await new Bot('Pia').open();
    again.send({ t: 'resume', token });
    const resumed = await again.next('auth');
    ok('signing out ends the session: its token no longer signs in', typeof token === 'string' && token.length > 30 && resumed.ok === false);
    again.close();
  }

  console.log('\nheld to what the game can do');
  {
    const g = server.game;
    server.accounts.signups.hits.clear();
    const ivo = await new Bot('Ivo').open();
    await ivo.signup();
    const jun = await new Bot('Jun').open();
    await jun.signup();
    // Sent somewhere the way the server sends anyone, and arrived.
    const place = async (bot, lat, lon, alt = 500, flags = FLAG.ground) => {
      const p = g.byKey.get(bot.name.toLowerCase());
      g.teleport(p, { lat, lon, alt, flying: false }, 'test');
      const tp = await bot.next('teleport', (m) => m.reason === 'test');
      bot.send({ t: 'arrived', tid: tp.tid });
      bot.pos = { lat: tp.lat, lon: tp.lon, alt };
      bot.state({ flags });
      await sleep(120);
      return p;
    };
    // One move, a second after the last, from an empty allowance.
    const move = async (bot, p, { north = 0, up = 0, flags = FLAG.ground }) => {
      bot.clear();
      const before = bot.pos;
      p.budget = 0;
      p.lastStateAt = Date.now() - 1000;
      p.correctedAt = -Infinity;
      bot.state({ lat: bot.pos.lat + metresNorth(north), alt: bot.pos.alt + up, flags });
      await sleep(150);
      if (bot.has('correct')) {
        bot.pos = before;
        return false;
      }
      return true;
    };
    const ip = await place(ivo, FIELD.lat + 0.05, FIELD.lon);
    const long = Date.now() - 60000;

    // On your feet you walk: a sprint is under six metres a second.
    ip.airborneAt = long;
    ok('on foot, sixty metres in a second is too fast', !(await move(ivo, ip, { north: 60 })));
    ip.airborneAt = Date.now() - 500;
    ok('but not just after landing from a glide, still sliding', await move(ivo, ip, { north: 60 }));
    ok('nor in the air', await move(ivo, ip, { north: 60, flags: FLAG.elytra }));

    // Height counts going up, once the ground has had time to load.
    ip.arrivedAt = long;
    ok('a kilometre straight up in a second is too fast', !(await move(ivo, ip, { up: 1000, flags: FLAG.elytra })));
    ok('a kilometre straight down is a fall, and free', await move(ivo, ip, { up: -1000, flags: FLAG.elytra }));
    ip.arrivedAt = Date.now();
    ok('and just after arriving the ground standing you up is not judged', await move(ivo, ip, { up: 1500, flags: FLAG.elytra }));
    ip.arrivedAt = long;
    // Standing first: a landing is timed from the first state on the ground.
    await move(ivo, ip, {});
    ip.airborneAt = long;
    const violations = ip.violations;
    ok('on foot, the ground loading in finer under you stands, but is counted',
      (await move(ivo, ip, { up: 300 })) && ip.violations > violations);
    ip.violations = 0;

    // A burst - the allowance saved up, spent at once - is movement, not a hit.
    ivo.state({ flags: FLAG.elytra });
    await sleep(600);
    ivo.clear();
    ip.budget = g.maxSpeed('earth') * 1.5;
    ip.lastStateAt = Date.now() - 100;
    ivo.state({ lat: ivo.pos.lat + metresNorth(250), flags: FLAG.elytra });
    await sleep(120);
    ok('a burst of 250 m is let through as movement', !ivo.has('correct') && ip.blinkUntil > Date.now());
    const jp = await place(jun, ivo.pos.lat + metresNorth(2), ivo.pos.lon, ivo.pos.alt);
    jun.clear();
    ivo.strike(jun.id);
    await sleep(150);
    ok('but a swing straight after it does not count', !jun.has('hit'));
    await sleep(800);
    ivo.strike(jun.id);
    const landed = await jun.next('hit', () => true, 1500).catch(() => null);
    ok('once it is over, it does', !!landed && landed.by?.name === 'Ivo');
    await sleep(1100);
    jun.clear();
    ivo.send({ t: 'attack', target: jun.id });
    await sleep(150);
    ok('a hit with no swing to go with it does not count', !jun.has('hit'));
    // Nor with a swing sent on its own: the swing is the bit in the state
    // everybody else is sent, so a blade nobody saw move does not land.
    await sleep(1100);
    jun.clear();
    ivo.send({ t: 'swing' });
    ivo.send({ t: 'attack', target: jun.id });
    await sleep(150);
    ok('nor one with a swing nobody else was shown', !jun.has('hit'));
    // Nor out of a clear sky. A fall is free to make, but it gathers speed as
    // falls do: dropping five kilometres in one state onto somebody below was
    // a critical hit at once.
    await sleep(1100);
    await place(ivo, jun.pos.lat - metresNorth(2), jun.pos.lon, jun.pos.alt + 5000, FLAG.elytra);
    ip.arrivedAt = long;
    for (let i = 0; i < 12; i++) {
      ivo.state({ flags: FLAG.elytra });
      await sleep(100);
    }
    jun.clear();
    ivo.state({ alt: jun.pos.alt + 2, flags: FLAG.elytra });
    ivo.strike(jun.id);
    // Two swings, so the swing bit (which strike flips) is where it was.
    ivo.strike(jun.id);
    await sleep(150);
    ok('nor one dropped five kilometres onto somebody in a single state', !jun.has('hit') && ip.blinkUntil > Date.now());

    // How far back a hit is judged comes from the server's own pings.
    ip.client.pings ??= new Map();
    ip.client.pings.set('test-ping', Date.now());
    ip.client.ws.ping('test-ping');
    await sleep(100);
    ivo.send({ t: 'ping', c: Date.now(), rtt: 5000 });
    // An answer to a ping the server never sent is not one: it was how a page
    // made its round trip ten seconds.
    ip.client.ws.emit('pong', Buffer.from(String(Date.now() - 9900)));
    await sleep(100);
    ok(`the round trip is timed by the server, not taken from the page  (${ip.rtt} ms)`,
      Number.isFinite(ip.client.rtt) && ip.rtt < 1000);

    // Leaving in the middle of a fight is losing it.
    const kills = g.record('ivo').stats.kills;
    const deaths = g.record('jun').stats.deaths;
    ok('both are in a fight', g.inCombat(ip) && g.inCombat(jp) && jp.lastHitBy === 'ivo');
    jun.close();
    const fled = await ivo.next('chat', (m) => m.kind === 'death' && /Jun fled from Ivo/.test(m.text), 2000).catch(() => null);
    ok('leaving in the middle of a fight counts as dying, to whoever was winning', !!fled
      && g.record('jun').stats.deaths === deaths + 1 && g.record('ivo').stats.kills === kills + 1, fled?.text);
    const jun2 = await new Bot('Jun').open();
    jun2.send({ t: 'login', name: 'Jun', password: 'hunter22' });
    const rejoined = await jun2.next('auth');
    const told = await jun2.next('chat', (m) => /left in the middle of a fight with Ivo/.test(m.text ?? ''), 2000).catch(() => null);
    ok('and they are told so when they come back, at the respawn', rejoined.ok && !!told
      && Math.abs(rejoined.pos.lat - 46.5606) < 1e-3);
    jun2.id = rejoined.you.id;
    jun2.auth = rejoined;
    await jun2.land();
    // /kill in a fight gives the kill to the other side too.
    const jp2 = g.byKey.get('jun');
    jp2.combatUntil = Date.now() + 10000;
    jp2.lastHitBy = 'ivo';
    jun2.send({ t: 'chat', text: '/kill' });
    const gaveUp = await ivo.next('chat', (m) => m.kind === 'death' && /Jun gave up fighting Ivo/.test(m.text), 2000).catch(() => null);
    ok('/kill in the middle of a fight is a kill for the other side', !!gaveUp && g.record('ivo').stats.kills === kills + 2);
    // A page that never says it arrived is taken to be there.
    jun2.send({ t: 'respawn' });
    const sent = await jun2.next('teleport', (m) => m.reason === 'respawn');
    await sleep(120);
    jp2.pending.since -= 21000;
    await sleep(300);
    ok('a page that never says it arrived is put there after twenty seconds anyway',
      !jp2.pending && Math.abs(jp2.state.lat - sent.lat) < 1e-6);

    // The chat's budget belongs to the account, not to the connection.
    g.chatTimes.delete('jun');
    for (let i = 0; i < 6; i++) jun2.send({ t: 'chat', text: `line ${i}` });
    await sleep(100);
    jun2.close();
    await sleep(100);
    const jun3 = await new Bot('Jun').open();
    jun3.send({ t: 'login', name: 'Jun', password: 'hunter22' });
    await jun3.next('auth');
    jun3.clear();
    jun3.send({ t: 'chat', text: 'and again' });
    const slow = await jun3.next('chat', (m) => m.kind === 'error' && /Slow down/.test(m.text), 1500).catch(() => null);
    ok('reconnecting is not a fresh chat budget', !!slow);
    jun3.close();

    // Wrong passwords lock out whoever is guessing, not the account's owner.
    const acc = server.accounts;
    for (let i = 0; i < 5; i++) await acc.login('Ivo', 'not it', '198.51.100.7');
    const locked = await acc.login('Ivo', 'hunter22', '198.51.100.7');
    ok('five wrong passwords from one address lock that address out of the account', /Too many tries for that account/.test(locked.error ?? ''));
    const owner = await acc.login('Ivo', 'hunter22', '203.0.113.5');
    ok('but not its owner, signing in from somewhere else', !!owner.account);
    for (let i = 0; i < 30; i++) await acc.login('Ivo', 'not it', `192.0.2.${i + 1}`);
    const guesser = await acc.login('Ivo', 'hunter22', '192.0.2.1');
    const home = await acc.login('Ivo', 'hunter22', '203.0.113.6');
    ok('guessed at from thirty addresses, only one that has not been guessing may still try',
      /Too many tries/.test(guesser.error ?? '') && !!home.account);
    const ivoAccount = acc.get('ivo');
    for (let i = 0; i < 5; i++) await acc.changePassword(ivoAccount, 'not it', 'brand new one');
    const stopped = await acc.changePassword(ivoAccount, 'hunter22', 'brand new one');
    ok('changing the password stops taking guesses at the old one', /Too many wrong passwords/.test(stopped.error ?? ''));

    // A gather is a teleport for everybody, so not a gather a second.
    ip.combatUntil = 0;
    const kit = await new Bot('Kit').open();
    await kit.signup();
    await kit.land();
    ivo.send({ t: 'social', cmd: 'party', op: 'invite', name: 'Kit' });
    await kit.next('partyInvite');
    kit.send({ t: 'social', cmd: 'party', op: 'accept', name: 'Ivo' });
    await ivo.next('party', (m) => m.party?.members.length === 2);
    ivo.send({ t: 'social', cmd: 'party', op: 'gather' });
    await ivo.next('chat', (m) => /Gathering the party/.test(m.text ?? ''));
    ivo.send({ t: 'social', cmd: 'party', op: 'gather' });
    const again = await ivo.next('chat', (m) => m.kind === 'error' && /Gathered just now/.test(m.text), 1500).catch(() => null);
    ok('gathering the party again at once has to wait', !!again);
    kit.close();

    // Refused is still heard: a page asking for 400 m/s, put back every
    // other state, used to hold 250 of it on the refills in between.
    ip.combatUntil = 0;
    const fast = await place(ivo, FIELD.lat + 0.2, FIELD.lon, 2000, FLAG.elytra);
    fast.arrivedAt = long;
    fast.violations = 0;
    const startLat = fast.state.lat;
    const t0 = Date.now();
    let asked = ivo.pos.lat;
    for (let i = 0; i < 30; i++) {
      asked += metresNorth(40);
      ivo.state({ lat: asked, alt: 2000, flags: FLAG.elytra });
      await sleep(100);
      if (ivo.has('correct')) {
        asked = fast.state.lat;
        ivo.clear();
      }
    }
    const held = ((fast.state.lat - startLat) * 111320) / ((Date.now() - t0) / 1000);
    ok(`a page asking for 400 m/s is held to the limit  (${held.toFixed(0)} m/s against ${g.maxSpeed('earth')})`,
      held < g.maxSpeed('earth') * 1.1);
    fast.violations = 0;

    // A socket that goes quiet for six seconds and then delivers everything
    // at once, from an honest 100 m/s glide: nothing put back, nothing lost.
    ivo.clear();
    let at = fast.state.lat;
    ivo.state({ lat: at, alt: 2000, flags: FLAG.elytra });
    await sleep(6000);
    for (let i = 0; i < 60; i++) {
      at += metresNorth(10);
      ivo.state({ lat: at, alt: 2000, flags: FLAG.elytra });
    }
    await sleep(300);
    ok('six seconds of an honest glide delivered at once after a stall is all taken',
      !ivo.has('correct') && Math.abs(fast.state.lat - at) * 111320 < 0.5,
      `${ivo.inbox.filter((m) => m.t === 'correct').length} put back, ${((at - fast.state.lat) * 111320).toFixed(0)} m short, tokens ${fast.stateTokens?.toFixed(1)}, catch-up ${fast.catchUp?.toFixed(0)}`);

    // A fall is speed the server counts: sent twenty kilometres up, fall ten,
    // and cross the ground at 500 m/s - in the air of Earth, for a moment.
    const faller = await place(ivo, FIELD.lat + 0.3, FIELD.lon, 20000, FLAG.elytra);
    faller.arrivedAt = long;
    faller.ceiling = 20000;
    ivo.pos.alt = 10000;
    ok('falling ten kilometres is free', await move(ivo, faller, { flags: FLAG.elytra }));
    ok('and the speed it gave is let through', await move(ivo, faller, { north: 500, flags: FLAG.elytra }));
    // Waiting out the arrival does not make a height that was only claimed
    // one to fall from: sent to the ground, saying twenty kilometres.
    const claimer = await place(ivo, FIELD.lat + 0.4, FIELD.lon, 0, FLAG.ground);
    ivo.pos.alt = 20000;
    ivo.state({ flags: FLAG.elytra });
    await sleep(150);
    claimer.arrivedAt = long;
    ivo.pos.alt = 10000;
    await move(ivo, claimer, { flags: FLAG.elytra });
    ok('a height only claimed on arrival gives a fall nothing', !(await move(ivo, claimer, { north: 500, flags: FLAG.elytra })),
      `ceiling ${Math.round(claimer.ceiling)}`);
    claimer.violations = 0;
    // Nor does bouncing up and down while the arrival's half minute lasts.
    // The server cannot see the ground, so a page may be standing on the
    // highest peak there is and step off it - one fall's worth, honestly -
    // but the climbs back up are free then, and they still pay for the falls:
    // six bounces bank one fall, not six.
    const bouncer = await place(ivo, FIELD.lat + 0.45, FIELD.lon, 0, FLAG.ground);
    for (let i = 0; i < 6; i++) {
      ivo.pos.alt = 10000;
      ivo.state({ flags: FLAG.elytra });
      await sleep(40);
      ivo.pos.alt = 0;
      ivo.state({ flags: FLAG.elytra });
      await sleep(40);
    }
    ok(`bouncing through the arrival banks one fall at most, not one a bounce  (${Math.round(bouncer.reserve)} m²/s² kept)`,
      bouncer.reserve <= 2 * 32 * 10000 + 1);
    bouncer.violations = 0;
    // A refused move is put back, and so is the fall it claimed.
    const refused = await place(ivo, FIELD.lat + 0.55, FIELD.lon, 10000, FLAG.elytra);
    refused.arrivedAt = long;
    for (let i = 0; i < 4; i++) {
      ivo.clear();
      refused.budget = 0;
      refused.correctedAt = -Infinity;
      ivo.state({ lat: ivo.pos.lat + metresNorth(5000), alt: -11000, flags: FLAG.elytra });
      await sleep(120);
    }
    ok(`a refused move keeps none of the fall it claimed  (${Math.round(refused.reserve)} m²/s² kept)`,
      ivo.has('correct') && refused.reserve < 1);
    refused.violations = 0;

    // Out of a surge with no air, the speed stays; Earth's air takes it away.
    const { BODIES } = await import('../src/geo/bodies.js');
    const pilot = (world) => ({
      surge: { on: false, since: 0, endedAt: -Infinity, readyAt: 0 }, reserve: 0, surgeKept: 0, ceiling: 0,
      history: [], gapTimes: [], fadePool: 0, fadeBunch: null, pausedMs: 0, world,
    });
    const kept = {};
    for (const world of ['moon', 'earth']) {
      const fake = pilot(world);
      fake.lastStateAt = 1e9 - 100;
      g.surgeFactor(fake, FLAG.surge | FLAG.rocket, 1e9);
      g.surgeFactor(fake, 0, 1e9 + 12000);
      for (let i = 0; i < 600; i++) {
        fake.lastStateAt = 1e9 + 12000 + i * 100 - 100;
        g.fadeReserve(fake, BODIES[world], 0.1, false, 1e9 + 12000 + i * 100);
      }
      kept[world] = Math.sqrt(g.maxSpeed(world) ** 2 + 1.25 * fake.surgeKept);
    }
    ok(`a minute after a surge on the Moon you may still go as fast as one left you  (${kept.moon.toFixed(0)} m/s)`,
      kept.moon > 256);
    ok(`on Earth the air has taken it  (${kept.earth.toFixed(0)} m/s)`, kept.earth < g.maxSpeed('earth') + 1);
    // Mars's thin air: a surge stretches a glide only by the page's own 2.4,
    // not by the 5.5 it gives a rocket's push (2,700 m/s was allowed, the
    // fastest honest surge there makes 1,170), and a fall there gives no more
    // than the air lets a faller reach (from Olympus Mons into Hellas it was
    // 1,100 m/s for minutes).
    const marsSurge = g.surgedSpeed('mars', SURGE_ALLOWANCE);
    ok(`on Mars a surge stretches the glide as the page stretches it, not five and a half times  (${Math.round(marsSurge)} m/s)`,
      marsSurge < g.maxSpeed('mars') * 2.5 && Math.abs(g.surgedSpeed('moon', SURGE_ALLOWANCE) - g.maxSpeed('moon') * SURGE_ALLOWANCE) < 1);
    const marsFall = { ...pilot('mars'), ceiling: 21000 };
    g.fallReserve(marsFall, BODIES.mars, { alt: 21000 }, { alt: -8000 }, true, 1e9);
    const fellFor = Math.sqrt(g.maxSpeed('mars') ** 2 + 1.25 * marsFall.reserve);
    ok(`and a fall there gives no more than the air lets a faller reach  (${Math.round(fellFor)} m/s after 29 km)`,
      fellFor < g.maxSpeed('mars') * 1.6);
    // A surge flicked on for one state, or run with no rocket lit, leaves nothing.
    const flick = pilot('moon');
    flick.lastStateAt = 1e9 - 100;
    g.surgeFactor(flick, FLAG.surge | FLAG.rocket, 1e9);
    g.surgeFactor(flick, 0, 1e9 + 100);
    const bare = pilot('moon');
    bare.lastStateAt = 1e9 - 100;
    g.surgeFactor(bare, FLAG.surge, 1e9);
    g.surgeFactor(bare, 0, 1e9 + 12000);
    ok(`a surge flicked on for a moment, or with no rocket lit, leaves no speed behind  (${Math.round(flick.surgeKept)}, ${Math.round(bare.surgeKept)})`,
      flick.surgeKept < 0.02 * 127600 && bare.surgeKept === 0);
    // One rocket flagged in a whole surge is not rockets lit through it.
    const once = pilot('moon');
    once.lastStateAt = 1e9 - 100;
    g.surgeFactor(once, FLAG.surge | FLAG.rocket, 1e9);
    for (let i = 1; i < 120; i++) g.surgeFactor(once, FLAG.surge, 1e9 + i * 100);
    g.surgeFactor(once, 0, 1e9 + 12000);
    ok(`one rocket flagged in a twelve-second surge earns a sliver of what it leaves, not all  (${Math.round(once.surgeKept)})`,
      once.surgeKept < 0.05 * 127600);
    // A surge dated back to a gap is never dated into the recharge it waited out.
    const cool = pilot('moon');
    cool.surge.readyAt = 1e9 - 2000;
    cool.lastStateAt = 1e9 - 10000;
    g.surgeFactor(cool, FLAG.surge | FLAG.rocket, 1e9);
    ok('a surge dated back to a gap starts no earlier than its recharge allowed', cool.surge.since === 1e9 - 2000);
    // A surge a second after a stall's backlog is its own, not the stall's.
    const after = pilot('moon');
    after.burst = { at: 1e9 - 1500, from: 1e9 - 7500, until: 1e9 + 500 };
    after.lastStateAt = 1e9 - 100;
    g.surgeFactor(after, FLAG.surge | FLAG.rocket, 1e9);
    ok('a surge started after a stall\'s backlog has landed is not dated back into the stall', after.surge.since === 1e9);
    // Seen first after a gap, a surge is dated from the gap: quiet around it
    // does not make it longer.
    const quiet = pilot('moon');
    quiet.lastStateAt = 1e9 - 10000;
    g.surgeFactor(quiet, FLAG.surge | FLAG.rocket, 1e9);
    ok('a surge first seen after ten quiet seconds is counted from the start of them',
      quiet.surge.since === 1e9 - 10000 && g.factorAt(quiet.surge, 1e9 + 5000) < SURGE_ALLOWANCE);
    // Seen first in a bunch the socket let go a moment after the backlog, it
    // may have begun while held - but is dated back no further than the
    // grace a surge's end has.
    const bunched = pilot('moon');
    bunched.burst = { at: 1e9 - 200, from: 1e9 - 5200, until: 1e9 + 1800 };
    bunched.lastStateAt = 1e9 - 5;
    g.surgeFactor(bunched, FLAG.surge | FLAG.rocket, 1e9);
    ok('a surge first seen in a second bunch of a backlog is dated back two seconds at most', bunched.surge.since === 1e9 - 2000);

    // Flown on a clock of the test's own that stands still in between: a
    // player sent to the Moon, ten kilometres up, and states handed to the
    // server one at a time, each when a socket would let it go. Metres north.
    const { radiusOf } = await import('../server/records.mjs');
    const onClock = async (name, plan) => {
      server.accounts.signups.hits.clear();
      const bot = await new Bot(name).open();
      await bot.signup();
      const p = g.byKey.get(name.toLowerCase());
      const realNow = g.now;
      let clock = Date.now();
      g.now = () => clock;
      let result;
      try {
        g.moveWorld(p, 'moon');
        p.pending.arrived = true;
        let at = { lat: p.pending.lat, lon: p.pending.lon, alt: 10000 };
        let seq = 0;
        const send = (ms, metres, { flags = FLAG.elytra, alt = at.alt } = {}) => {
          clock += ms;
          at = { lat: at.lat + (metres / radiusOf('moon')) * (180 / Math.PI), lon: at.lon, alt };
          g.onState(p, encodeState({ seq: ++seq, ...at, agl: 100, vel: [0, 0, 0], yaw: 0, pitch: 0, roll: 0, flags, item: 0 }));
        };
        send(0, 0);
        result = plan(send, p);
      } finally {
        g.now = realNow;
      }
      await sleep(150);
      const putBack = bot.inbox.filter((m) => m.t === 'correct').length;
      await bot.close();
      return { ...result, putBack };
    };
    // A slow page whose socket holds: four states a second, flying on the
    // speed a dive gave it, and every four seconds the socket holds a second
    // and a half of them and lets them go at once. The first of a held bunch
    // is a quarter second of travel arriving a second and a half late: judged
    // on it, the page read as standing still and lost a third of its speed at
    // every hold, and was put back within half a minute.
    const holds = (metres) => (send, p) => {
      for (let i = 1; i <= 20; i++) send(250, 0, { alt: 10000 - i * 400 });
      const fell = p.reserve;
      for (let cycle = 0; cycle < 10; cycle++) {
        for (let i = 0; i < 10; i++) send(250, metres);
        send(1500, metres);
        for (let i = 1; i < 6; i++) send(0, metres);
      }
      return { fell, kept: p.reserve };
    };
    const slowPage = await onClock('Uma', holds(57));
    ok(`a page sending four states a second keeps a dive's speed through its socket's holds  (${Math.round(slowPage.kept)} of ${Math.round(slowPage.fell)} kept)`,
      slowPage.putBack === 0 && slowPage.kept > slowPage.fell * 0.95, `${slowPage.putBack} put back`);
    const slowHover = await onClock('Vic', holds(0));
    ok(`and one hovering at the same rhythm, holds and all, still loses it  (${Math.round(slowHover.kept)} of ${Math.round(slowHover.fell)} kept)`,
      slowHover.kept < slowHover.fell * 0.01);
    // A surge the page starts as a nine-second stall ends: the socket lets
    // the stall's ninety states go at once, none of them surging, and the
    // surge is on the live state behind them. Dated back to the start of the
    // stall, it ended five seconds in.
    const stallSurge = await onClock('Wes', (send, p) => {
      for (let i = 0; i < 50; i++) send(100, 10);
      send(9000, 10);
      for (let i = 1; i < 90; i++) send(0, 10);
      for (let i = 0; i < 115; i++) send(100, 60, { flags: FLAG.elytra | FLAG.surge | FLAG.rocket });
      return { on: p.surge.on };
    });
    ok('a surge started as a nine-second stall ends runs its twelve seconds', stallSurge.on && stallSurge.putBack === 0,
      `${stallSurge.putBack} put back`);
    // A landing whose touchdown the socket held: the slide arrives two and a
    // half seconds after the last state in the air, and was judged at
    // walking pace from that one.
    const heldLanding = await onClock('Xan', (send) => {
      for (let i = 1; i <= 20; i++) send(250, 20, { alt: 10000 - i * 500 });
      send(2500, 20, { flags: FLAG.ground, alt: 0 });
      for (let i = 1; i < 10; i++) send(0, 20 - i * 2, { flags: FLAG.ground, alt: 0 });
      for (let i = 0; i < 12; i++) send(250, 1, { flags: FLAG.ground, alt: 0 });
      return {};
    });
    ok('a touchdown the socket held back is judged from the touchdown, not from the last state in the air',
      heldLanding.putBack === 0, `${heldLanding.putBack} put back`);
    // A stall just after a hold: the hold's bunch is a third of a second of
    // travel lent a second and seven tenths, and the stall's, a moment later,
    // three seconds of it lent a second and six. Capped between them, the
    // page lost what the first had lent it and was put back.
    const twoHolds = await onClock('Yul', (send) => {
      for (let i = 0; i < 50; i++) send(100, 11);
      send(1700, 11);
      for (let i = 1; i < 3; i++) send(0, 11);
      send(1600, 11);
      for (let i = 1; i < 30; i++) send(0, 11);
      for (let i = 0; i < 20; i++) send(100, 11);
      return {};
    });
    ok('a stall close behind a hold keeps what the hold lent', twoHolds.putBack === 0, `${twoHolds.putBack} put back`);
    // But one quiet spell, after a page sending ten a second, still lends no
    // more than its own time: ten seconds at the limit, and nothing saved
    // before it on top.
    const oneQuiet = await onClock('Zia', (send) => {
      for (let i = 0; i < 50; i++) send(100, 0);
      send(10000, 10 * g.maxSpeed('moon') + 200);
      return {};
    });
    ok('a single quiet spell lends its own time and no saving on top', oneQuiet.putBack === 1, `${oneQuiet.putBack} put back`);
    // A pause is time a page slept through, not a rhythm to keep a reserve
    // on. Sending ten a second for three tenths and then nothing for a second,
    // over and over, a page crawling at a sixth of what keeps a dive's speed
    // kept all of it: every second it did not send was left out, and what it
    // flew in it read as flown in the three tenths. A page that pauses as a
    // background tab does - asleep ten seconds, a second and a half flown on
    // waking - still keeps it, a hitch two seconds before or not.
    const dive = (send, p) => {
      for (let i = 1; i <= 20; i++) send(250, 0, { alt: 10000 - i * 400 });
      return p.reserve;
    };
    const crawler = await onClock('Abe', (send, p) => {
      const fell = dive(send, p);
      for (let cycle = 0; cycle < 50; cycle++) {
        for (let i = 0; i < 3; i++) send(100, 6);
        send(1000, 60);
      }
      return { fell, kept: p.reserve };
    });
    ok(`a page pausing a second at a time between bursts, crawling, does not keep a dive's speed  (${Math.round(crawler.kept)} of ${Math.round(crawler.fell)} kept)`,
      crawler.kept < crawler.fell * 0.05);
    const sleeper = (hitch) => (send, p) => {
      const fell = dive(send, p);
      for (let i = 0; i < 30; i++) send(100, 25);
      if (hitch) {
        send(400, 100);
        for (let i = 0; i < 20; i++) send(100, 25);
      }
      send(10000, 375);
      for (let i = 0; i < 50; i++) send(100, 25);
      return { fell, kept: p.reserve };
    };
    for (const hitch of [false, true]) {
      const tab = await onClock(hitch ? 'Bea' : 'Cal', sleeper(hitch));
      ok(`a page asleep in a background tab keeps a dive's speed${hitch ? ', after a hitch' : ''}  (${Math.round(tab.kept)} of ${Math.round(tab.fell)} kept)`,
        tab.putBack === 0 && tab.kept > tab.fell * 0.95, `${tab.putBack} put back`);
    }

    // Who you were fighting survives a second tab of your own.
    const mia = await new Bot('Mia').open();
    await mia.signup();
    const miaP = await place(mia, FIELD.lat + 0.5, FIELD.lon);
    const ivoP = await place(ivo, FIELD.lat + 0.5 + metresNorth(2), FIELD.lon);
    ivoP.combatUntil = 0;
    ivoP.blinkUntil = 0;
    await sleep(900);
    ivo.strike(mia.id);
    const struck = await mia.next('hit', () => true, 2000).catch(() => null);
    const tab = await new Bot('Mia').open();
    tab.send({ t: 'resume', token: mia.auth.token });
    const back2 = await tab.next('auth');
    ok('a fight carries over to a second tab, opponent and all',
      !!struck && back2.ok && g.byKey.get('mia')?.lastHitBy === 'ivo' && g.inCombat(g.byKey.get('mia')));
    const ivoKills = g.record('ivo').stats.kills;
    tab.close();
    const credited = await ivo.next('chat', (m) => m.kind === 'death' && /Mia fled from Ivo/.test(m.text), 2000).catch(() => null);
    ok('and leaving from there is still a kill for whoever was winning', !!credited && g.record('ivo').stats.kills === ivoKills + 1);
    mia.close();

    // Friend requests taken without being asked, for whoever wants that.
    server.accounts.signups.hits.clear();
    const noa = await new Bot('Noa').open();
    await noa.signup();
    noa.send({ t: 'socialPrefs', autoTpa: false, autoParty: false, autoFriends: true, notify: true });
    await sleep(100);
    ivo.send({ t: 'social', cmd: 'friend', op: 'add', name: 'Noa' });
    const friended = await ivo.next('chat', (m) => /You and Noa are friends/.test(m.text ?? ''), 2000).catch(() => null);
    const toldNoa = await noa.next('chat', (m) => /Ivo is your friend now/.test(m.text ?? ''), 2000).catch(() => null);
    ok('somebody who accepts friend requests automatically is a friend at once, and is told who',
      !!friended && !!toldNoa && g.social.areFriends('noa', 'ivo'));
    noa.close();

    // A height only claimed in the arrival's half minute, saved and signed
    // in with again, is no height to fall from - nor for a friend who
    // teleports to it.
    server.accounts.signups.hits.clear();
    const ola = await new Bot('Ola').open();
    await ola.signup();
    const olaP = await place(ola, FIELD.lat + 0.6, FIELD.lon, 0, FLAG.ground);
    ola.pos.alt = 150000;
    ola.state({ flags: FLAG.elytra });
    await sleep(150);
    g.remember(olaP);
    const ola2 = await new Bot('Ola').open();
    ola2.send({ t: 'resume', token: ola.auth.token });
    const olaBack = await ola2.next('auth');
    ola2.send({ t: 'arrived', tid: 0 });
    ola2.pos = { lat: olaBack.pos.lat, lon: olaBack.pos.lon, alt: olaBack.pos.alt };
    ola2.state({ flags: FLAG.elytra });
    await sleep(150);
    ok(`a height only claimed on arriving, saved and signed in with again, is not one to fall from  (${Math.round(g.byKey.get('ola').ceiling)} m)`,
      olaBack.pos.alt === 150000 && g.byKey.get('ola').ceiling <= 9000 + 1000);
    const ivoNow = g.byKey.get('ivo');
    ivoNow.combatUntil = 0;
    ivoNow.lastRequestAt.clear();
    g.chatTimes.delete('ivo');
    ivo.send({ t: 'chat', text: '/tpa Ola' });
    await ola2.next('tpreq');
    g.chatTimes.delete('ola');
    ola2.send({ t: 'chat', text: '/tpaccept' });
    const sentUp = await ivo.next('teleport', (m) => m.reason === 'tpa');
    ivo.send({ t: 'arrived', tid: sentUp.tid });
    ivo.pos = { lat: sentUp.lat, lon: sentUp.lon, alt: sentUp.alt };
    ivo.state({ flags: FLAG.elytra });
    await sleep(150);
    ok(`and teleporting to it does not make it one  (${Math.round(g.byKey.get('ivo').ceiling)} m)`,
      sentUp.alt === 150000 && g.byKey.get('ivo').ceiling <= 9000 + 1000);
    // Nor to somebody who has not arrived yet: their height is not one the
    // server knows, and a visitor was handed a fall from 199 km.
    const olaNow = g.byKey.get('ola');
    olaNow.pending = { tid: 99, lat: olaNow.state.lat, lon: olaNow.state.lon, alt: 199000, since: Date.now() };
    ivoNow.lastRequestAt.clear();
    ivoNow.combatUntil = 0;
    g.chatTimes.delete('ivo');
    g.chatTimes.delete('ola');
    ivo.clear();
    ivo.send({ t: 'chat', text: '/tpa Ola' });
    await ola2.next('tpreq');
    ola2.send({ t: 'chat', text: '/tpaccept' });
    const waitFor = await ola2.next('chat', (m) => m.kind === 'error' && /^You have not landed yet/.test(m.text), 2000).catch(() => null);
    await sleep(100);
    ok('a teleport to somebody still arriving waits for them to land', !!waitFor && !ivo.has('teleport'));
    // An admin's /tp too: a dive from beside a host sent to 199 km was put back
    // (it counted from no height at all), and a claimed one must not count.
    ivoNow.admin = true;
    g.chatTimes.delete('ivo');
    ivo.clear();
    ivo.send({ t: 'chat', text: '/tp Ola' });
    const adminWait = await ivo.next('chat', (m) => m.kind === 'error' && /Ola has not landed yet/.test(m.text), 2000).catch(() => null);
    await sleep(100);
    ivoNow.admin = false;
    ok('and so does an admin\'s /tp', !!adminWait && !ivo.has('teleport'));
    ok('and the height a fall may count from beside somebody unknown is the lowest ground there is',
      g.spendableCeiling({ world: 'earth', state: { alt: 5000 }, ceiling: -Infinity }) === -11000);
    olaNow.pending = null;
    ola2.close();

    // In the arrival's half minute, climbing is earned only as fast as a
    // flight could climb in the time since arriving - however small the steps.
    const climber = await place(ivo, FIELD.lat + 0.65, FIELD.lon, 0, FLAG.elytra);
    for (let i = 0; i < 40; i++) {
      ivo.pos.alt += 50;
      ivo.state({ flags: FLAG.elytra });
    }
    await sleep(150);
    ok(`thirty small climbs in an instant on arriving earn no more height than a flight could have  (${Math.round(climber.ceiling)} m)`,
      climber.ceiling < 1000);

    // Standing up on your feet - the ground loading in finer - stands, but it
    // is no height to fall from either.
    const stander = await place(ivo, FIELD.lat + 0.7, FIELD.lon, 0, FLAG.ground);
    stander.arrivedAt = long;
    stander.airborneAt = long;
    stander.correctedAt = -Infinity;
    const ceilingBefore = stander.ceiling;
    ivo.clear();
    stander.budget = 0;
    stander.lastStateAt = Date.now() - 1000;
    ivo.pos.alt = 50000;
    ivo.state({ flags: FLAG.ground });
    await sleep(150);
    ok('standing up on the ground loading in stands, and raises no ceiling',
      !ivo.has('correct') && stander.state.alt === 50000 && stander.ceiling === ceilingBefore);
    stander.violations = 0;

    // A pause, then one state beside somebody and a swing: the travel the
    // pause lent back is movement, not a hit.
    server.accounts.signups.hits.clear();
    const pax = await new Bot('Pax').open();
    await pax.signup();
    await place(pax, FIELD.lat + 0.8, FIELD.lon, 500);
    const pauser = await place(ivo, FIELD.lat + 0.8 - metresNorth(600), FIELD.lon, 500, FLAG.elytra);
    pauser.arrivedAt = long;
    pauser.combatUntil = 0;
    await sleep(4000);
    pax.clear();
    ivo.clear();
    ivo.pos = { lat: FIELD.lat + 0.8 - metresNorth(2), lon: FIELD.lon, alt: 500 };
    ivo.swings = (ivo.swings ?? 0) + 1;
    ivo.state({ item: SWORD_SLOT, flags: FLAG.elytra | (ivo.swings % 2 ? FLAG.swing : 0) });
    ivo.send({ t: 'attack', target: pax.id });
    await sleep(200);
    ok('a pause, then one move beside somebody and a swing: let through, but no hit',
      !ivo.has('correct') && !pax.has('hit') && pauser.blinkUntil > Date.now() - 600);
    pax.close();

    // Signing in again - a reload, a dropped socket, a second tab - is an
    // arrival too, and one a page can have whenever it likes: no way into a
    // fight either. Kai hovers out of Lux's reach and signs in again on a new
    // socket with the token it has, as a page does.
    server.accounts.signups.hits.clear();
    const kai = await new Bot('Kai').open();
    await kai.signup();
    const lux = await new Bot('Lux').open();
    await lux.signup();
    const ring = { lat: FIELD.lat + 0.85, lon: FIELD.lon, alt: 3000 };
    const luxP = await place(lux, ring.lat, ring.lon, ring.alt, FLAG.elytra);
    const nextTo = ring.lat - metresNorth(2);
    let kaiTab = kai;
    // The same account on a new page: the server drops the old one. It has
    // not arrived until it says so, at `arrive`.
    const kaiAgain = async (arrive) => {
      const tab = await new Bot('Kai').open();
      tab.send({ t: 'resume', token: kai.auth.token });
      tab.auth = await tab.next('auth');
      tab.id = tab.auth.you.id;
      tab.pos = { ...tab.auth.pos };
      kaiTab = tab;
      tab.send({ t: 'arrived', tid: 0 });
      tab.state({ ...arrive, flags: FLAG.elytra });
      await sleep(120);
      return g.byKey.get('kai');
    };
    // Lux, ready to be hit: not just hit, and nowhere near dead.
    const ready = () => { luxP.health = MAX_HEALTH; luxP.immuneUntil = 0; lux.clear(); };
    const lands = async () => { kaiTab.strike(lux.id); await sleep(150); return lux.has('hit'); };
    // Somewhere to be, half a second of it settled; the guard from before let go.
    const hover = async (alt, flags = FLAG.elytra, settled = true) => {
      const p = await place(kaiTab, nextTo, ring.lon, alt, FLAG.elytra);
      if (settled) p.arrivedAt = long;
      for (let i = 0; i < 6; i++) { kaiTab.state({ flags }); await sleep(100); }
      p.blinkUntil = 0;
      p.correctedAt = -Infinity;
      return p;
    };
    let kp = await place(kai, ring.lat - metresNorth(390), ring.lon, ring.alt, FLAG.elytra);
    kp.arrivedAt = long;
    for (let i = 0; i < 6; i++) { kai.state({ flags: FLAG.elytra }); await sleep(100); }
    const left = { ...kp.state };
    kp = await kaiAgain({ lat: nextTo });
    const signedIn = { ...kp.state };
    ready();
    ok(`signing in again lands you where you left, not up to 400 m off it  (${Math.round((signedIn.lat - left.lat) * 111320)} m)`,
      Math.abs(signedIn.lat - left.lat) < metresNorth(1));
    ok('so signing in again out of reach is not arriving beside somebody, sword swinging', !(await lands()));
    await hover(ring.alt + 3000);
    kp = await kaiAgain({ alt: ring.alt });
    ready();
    ok(`nor, three kilometres over them, saying it arrived at their height  (held ${Math.round(kp.state.alt - ring.alt)} m over them)`, !(await lands()));
    kp = await hover(ring.alt + 3000, FLAG.elytra, false);
    await place(kaiTab, nextTo, ring.lon, ring.alt + 3000, FLAG.elytra);
    kaiTab.pos.alt = ring.alt;
    ready();
    ok('nor, just arrived three kilometres over them, being at their height a moment later', !(await lands()));
    kp = await hover(ring.alt + 5000, FLAG.elytra, false);
    kaiTab.state({ alt: ring.alt, flags: FLAG.elytra });
    ready();
    ok('nor dropping five kilometres onto them in the half minute after arriving', !(await lands()));
    kp = await hover(ring.alt + 5000, FLAG.swim);
    kp.airborneAt = long;
    kaiTab.state({ alt: ring.alt, flags: FLAG.swim });
    ready();
    ok('nor "swimming" five kilometres up and dropping onto them', !(await lands()));
    kp = await hover(ring.alt - 3000, FLAG.ground);
    kp.airborneAt = long;
    kaiTab.pos.alt = ring.alt;
    ready();
    ok('nor stood up three kilometres by "the ground loading in", into them overhead', !(await lands()));
    kp = await hover(ring.alt + 5000);
    kaiTab.state({ alt: ring.alt, flags: FLAG.elytra });
    await sleep(100);
    const guarded = kp.blinkUntil > Date.now();
    kp = await kaiAgain({ alt: ring.alt });
    ready();
    ok('and signing in again straight after a guarded move keeps the guard', guarded && !(await lands()));
    await sleep(700);
    ready();
    kaiTab.clear();
    kaiTab.strike(lux.id);
    const charged = await kaiTab.next('hitConfirm', () => true, 1500).catch(() => null);
    kp = await kaiAgain({ alt: ring.alt });
    ready();
    kaiTab.strike(lux.id);
    const recharged = await kaiTab.next('hitConfirm', () => true, 1500).catch(() => null);
    ok(`and the sword's recharge  (${charged?.amount} then ${recharged?.amount})`, !!charged && !!recharged && recharged.amount < charged.amount);
    // A fight waits for a page that signed in again and never says it arrived:
    // nobody can hit it, so the ten seconds running out there was a way out.
    await sleep(700);
    ready();
    kaiTab.strike(lux.id);
    const fought = await lux.next('hit', () => true, 1500).catch(() => null);
    const luxDeaths = g.record('lux').stats.deaths;
    const luxTab = await new Bot('Lux').open();
    luxTab.send({ t: 'resume', token: lux.auth.token });
    await luxTab.next('auth');
    const arriving = g.byKey.get('lux');
    arriving.combatUntil = Date.now() + 300;
    await sleep(600);
    const still = g.inCombat(arriving);
    luxTab.close();
    const fledLux = await kaiTab.next('chat', (m) => m.kind === 'death' && /Lux fled from Kai/.test(m.text), 2000).catch(() => null);
    ok('a fight waits for a second tab that never says it arrived, and leaving from there is still losing it',
      !!fought && still && !!fledLux && g.record('lux').stats.deaths === luxDeaths + 1);
    kaiTab.close();

    // What a page sent before it could have heard it was put back is refused
    // with it, not counted again.
    const lagger = await place(ivo, FIELD.lat + 0.9, FIELD.lon, 2000, FLAG.elytra);
    lagger.arrivedAt = long;
    lagger.violations = 0;
    lagger.correctedAt = -Infinity;
    ivo.clear();
    for (let i = 0; i < 6; i++) ivo.state({ lat: ivo.pos.lat + metresNorth(3000), flags: FLAG.elytra });
    await sleep(200);
    ok(`moves sent before the page could hear it was put back count once  (${lagger.violations} counted, ${ivo.inbox.filter((m) => m.t === 'correct').length} put back)`,
      lagger.violations === 1 && ivo.inbox.filter((m) => m.t === 'correct').length === 1);
    lagger.violations = 0;

    // Accepting friend requests automatically, the rest of it.
    server.accounts.signups.hits.clear();
    const ria = await new Bot('Ria').open();
    await ria.signup();
    const sol = await new Bot('Sol').open();
    await sol.signup();
    sol.send({ t: 'social', cmd: 'friend', op: 'add', name: 'Ria' });
    await ria.next('chat', (m) => /Sol wants to be friends/.test(m.text ?? ''));
    ria.send({ t: 'socialPrefs', autoTpa: false, autoParty: false, autoFriends: true, notify: true });
    const echoed = await ria.next('friends', (m) => m.prefs?.autoFriends === true, 2000).catch(() => null);
    ok('switching it on answers whoever was already waiting, and the page is told what was kept',
      g.social.areFriends('ria', 'sol') && !!echoed);
    ria.close();
    await sleep(150);
    g.socialTimes.delete('ivo');
    ivo.send({ t: 'social', cmd: 'friend', op: 'add', name: 'Ria' });
    await ivo.next('chat', (m) => /You and Ria are friends/.test(m.text ?? ''), 2000).catch(() => null);
    const ria2 = await new Bot('Ria').open();
    ria2.send({ t: 'resume', token: ria.auth.token });
    await ria2.next('auth');
    const awayNotice = await ria2.next('chat', (m) => /Ivo became your friend while you were away/.test(m.text ?? ''), 2000).catch(() => null);
    ok('made a friend while away, they are told as a friend\'s notice, not a party\'s', awayNotice?.kind === 'friend');
    const solRecord = g.social.social('sol');
    const solFriends = solRecord.friends;
    solRecord.friends = [...solFriends, ...Array.from({ length: 100 }, (_, i) => `filler${i}`)].slice(0, 100);
    g.socialTimes.delete('ivo');
    ivo.send({ t: 'social', cmd: 'friend', op: 'add', name: 'Sol' });
    const full = await ivo.next('chat', (m) => m.kind === 'error' && /as many friends as there is room for/.test(m.text), 2000).catch(() => null);
    ok('asking somebody whose list is full says so, rather than sending a request they could not accept',
      !!full && !g.social.social('sol').incoming.includes('ivo'));
    solRecord.friends = solFriends;
    // Only the choices a page sends change: the rest stay as the account has them.
    ria2.send({ t: 'socialPrefs', notify: false });
    const merged = await ria2.next('friends', (m) => m.prefs?.notify === false, 2000).catch(() => null);
    ok('a page that changed one friend choice changes only that one',
      !!merged && merged.prefs.autoFriends === true && merged.prefs.autoTpa === false);
    ria2.send({ t: 'socialPrefs', notify: true, autoFriends: false });
    await ria2.next('friends', (m) => m.prefs?.autoFriends === false, 2000).catch(() => null);
    // Switching auto-accept on with a request waiting from somebody who has
    // no room: told so, and it stays waiting.
    const fullOne = g.social.social('sol');
    const solOwn = fullOne.friends;
    fullOne.friends = Array.from({ length: 100 }, (_, i) => `filler${i}`);
    g.social.social('ria').incoming.push('sol');
    ria2.clear();
    ria2.send({ t: 'socialPrefs', autoFriends: true });
    const noRoom = await ria2.next('chat', (m) => /Sol has as many friends as there is room for/.test(m.text ?? ''), 2000).catch(() => null);
    ok('switching it on says so for a request from somebody with no room left, which stays waiting',
      !!noRoom && g.social.social('ria').incoming.includes('sol'));
    // And when it is your own list that is full, says that.
    g.social.social('ria').prefs.autoFriends = false;
    const riaOwn = g.social.social('ria').friends;
    g.social.social('ria').friends = Array.from({ length: 100 }, (_, i) => `mine${i}`);
    fullOne.friends = solOwn;
    ria2.clear();
    ria2.send({ t: 'socialPrefs', autoFriends: true });
    const ownFull = await ria2.next('chat', (m) => /Your friends list is full — Sol's request is still waiting/.test(m.text ?? ''), 2000).catch(() => null);
    ok('and when it is your own list that is full, says so', !!ownFull);
    g.social.social('ria').friends = riaOwn;
    fullOne.friends = solOwn;
    // An older record's plain notices: a friend's reads as a friend's.
    const ria3 = g.record('ria');
    ria3.social.notices = ['Zed accepted your friend request — you are friends', 'Bob removed you from the party while you were away'];
    const kinds = g.social.social('ria').notices.map((n) => n.kind).join(',');
    ok('an older record\'s friend notice is told as a friend\'s, its party notice as a party\'s', kinds === 'friend,party', kinds);
    ria2.close();
    sol.close();
    ivo.close();
  }

  console.log('\nsaved to disk');
  {
    server.game.saveAll();
    const { readFileSync } = await import('node:fs');
    const accounts = JSON.parse(readFileSync(join(dir, 'accounts.json'), 'utf8'));
    const alexAccount = accounts.accounts.alex;
    ok('accounts are saved', !!alexAccount && alexAccount.name === 'Alex');
    ok('with a scrypt hash and never the password', /^scrypt\$/.test(alexAccount.hash) && !JSON.stringify(accounts).includes('hunter22'));
    const record = JSON.parse(readFileSync(join(dir, 'players/blake.json'), 'utf8'));
    ok('Blake\'s record knows the Moon and the Earth', record.world === 'moon' && record.worlds.earth && record.worlds.moon);
    ok('with explored ground on Earth', record.worlds.earth.explored?.v === 2);

    // Memory follows who is on, not everybody who ever played: a record is
    // let go once it is saved and its player has gone, and the list of who
    // explored a world comes from a small index rather than their files.
    const game = server.game;
    game.store.flush();
    game.evictRecords();
    const offline = [...game.records.keys()].filter((key) => !game.byKey.has(key));
    ok('records of players who have left are let go once saved', offline.length === 0, offline.join(','));
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
    ok('and an index of who has been where is saved beside them',
      index.version === 1 && !!index.players.blake?.worlds?.moon && Array.isArray(index.players.blake.worlds.earth));
    server.accounts.signups.hits.clear();
    const quinn = await new Bot('Quinn').open();
    await quinn.signup();
    const before = game.records.size;
    quinn.send({ t: 'atlas' });
    const atlas = await quinn.next('atlas', (m) => m.players.some((p) => p.key === 'blake'));
    ok('listing everybody who explored a world reads none of their files',
      game.records.size === before && atlas.players.every((p) => Number.isFinite(p.explored)),
      `${before} -> ${game.records.size} records; ${atlas.players.length} listed`);
    quinn.close();
  }
} catch (error) {
  failures++;
  console.log(`  FAIL ${error.message}`, process.env.STACK ? error.stack : "");
} finally {
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

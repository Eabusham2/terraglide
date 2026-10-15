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
@@MISSING 146@@
@@MISSING 147@@
@@MISSING 148@@
@@MISSING 149@@
@@MISSING 150@@
@@MISSING 151@@
@@MISSING 152@@
@@MISSING 153@@
@@MISSING 154@@
@@MISSING 155@@
@@MISSING 156@@
@@MISSING 157@@
@@MISSING 158@@
@@MISSING 159@@
@@MISSING 160@@
@@MISSING 161@@
@@MISSING 162@@
@@MISSING 163@@
@@MISSING 164@@
@@MISSING 165@@
@@MISSING 166@@
@@MISSING 167@@
@@MISSING 168@@
@@MISSING 169@@
@@MISSING 170@@
@@MISSING 171@@
@@MISSING 172@@
@@MISSING 173@@
@@MISSING 174@@
@@MISSING 175@@
@@MISSING 176@@
@@MISSING 177@@
@@MISSING 178@@
@@MISSING 179@@
@@MISSING 180@@
@@MISSING 181@@
@@MISSING 182@@
@@MISSING 183@@
@@MISSING 184@@
@@MISSING 185@@
@@MISSING 186@@
@@MISSING 187@@
@@MISSING 188@@
@@MISSING 189@@
@@MISSING 190@@
@@MISSING 191@@
@@MISSING 192@@
@@MISSING 193@@
@@MISSING 194@@
@@MISSING 195@@
@@MISSING 196@@
@@MISSING 197@@
@@MISSING 198@@
@@MISSING 199@@
@@MISSING 200@@
@@MISSING 201@@
@@MISSING 202@@
@@MISSING 203@@
@@MISSING 204@@
@@MISSING 205@@
@@MISSING 206@@
@@MISSING 207@@
@@MISSING 208@@
@@MISSING 209@@
@@MISSING 210@@
@@MISSING 211@@
@@MISSING 212@@
@@MISSING 213@@
@@MISSING 214@@
@@MISSING 215@@
@@MISSING 216@@
@@MISSING 217@@
@@MISSING 218@@
@@MISSING 219@@
@@MISSING 220@@
@@MISSING 221@@
@@MISSING 222@@
@@MISSING 223@@
@@MISSING 224@@
@@MISSING 225@@
@@MISSING 226@@
@@MISSING 227@@
@@MISSING 228@@
@@MISSING 229@@
@@MISSING 230@@
@@MISSING 231@@
@@MISSING 232@@
@@MISSING 233@@
@@MISSING 234@@
@@MISSING 235@@
@@MISSING 236@@
@@MISSING 237@@
@@MISSING 238@@
@@MISSING 239@@
@@MISSING 240@@
@@MISSING 241@@
@@MISSING 242@@
@@MISSING 243@@
@@MISSING 244@@
@@MISSING 245@@
@@MISSING 246@@
@@MISSING 247@@
@@MISSING 248@@
@@MISSING 249@@
@@MISSING 250@@
@@MISSING 251@@
@@MISSING 252@@
@@MISSING 253@@
@@MISSING 254@@
@@MISSING 255@@
@@MISSING 256@@
@@MISSING 257@@
@@MISSING 258@@
@@MISSING 259@@
@@MISSING 260@@
@@MISSING 261@@
@@MISSING 262@@
@@MISSING 263@@
@@MISSING 264@@
@@MISSING 265@@
@@MISSING 266@@
@@MISSING 267@@
@@MISSING 268@@
@@MISSING 269@@
@@MISSING 270@@
@@MISSING 271@@
@@MISSING 272@@
@@MISSING 273@@
@@MISSING 274@@
@@MISSING 275@@
@@MISSING 276@@
@@MISSING 277@@
@@MISSING 278@@
@@MISSING 279@@
@@MISSING 280@@
@@MISSING 281@@
@@MISSING 282@@
@@MISSING 283@@
@@MISSING 284@@
@@MISSING 285@@
@@MISSING 286@@
@@MISSING 287@@
@@MISSING 288@@
@@MISSING 289@@
@@MISSING 290@@
@@MISSING 291@@
@@MISSING 292@@
@@MISSING 293@@
@@MISSING 294@@
@@MISSING 295@@
@@MISSING 296@@
@@MISSING 297@@
@@MISSING 298@@
@@MISSING 299@@
@@MISSING 300@@
@@MISSING 301@@
@@MISSING 302@@
@@MISSING 303@@
@@MISSING 304@@
@@MISSING 305@@
@@MISSING 306@@
@@MISSING 307@@
@@MISSING 308@@
@@MISSING 309@@
@@MISSING 310@@
@@MISSING 311@@
@@MISSING 312@@
@@MISSING 313@@
@@MISSING 314@@
@@MISSING 315@@
@@MISSING 316@@
@@MISSING 317@@
@@MISSING 318@@
@@MISSING 319@@
@@MISSING 320@@
@@MISSING 321@@
@@MISSING 322@@
@@MISSING 323@@
@@MISSING 324@@
@@MISSING 325@@
@@MISSING 326@@
@@MISSING 327@@
@@MISSING 328@@
@@MISSING 329@@
@@MISSING 330@@
@@MISSING 331@@
@@MISSING 332@@
@@MISSING 333@@
@@MISSING 334@@
@@MISSING 335@@
@@MISSING 336@@
@@MISSING 337@@
@@MISSING 338@@
@@MISSING 339@@
@@MISSING 340@@
@@MISSING 341@@
@@MISSING 342@@
@@MISSING 343@@
@@MISSING 344@@
@@MISSING 345@@
@@MISSING 346@@
@@MISSING 347@@
@@MISSING 348@@
@@MISSING 349@@
@@MISSING 350@@
@@MISSING 351@@
@@MISSING 352@@
@@MISSING 353@@
@@MISSING 354@@
@@MISSING 355@@
@@MISSING 356@@
@@MISSING 357@@
@@MISSING 358@@
@@MISSING 359@@
@@MISSING 360@@
@@MISSING 361@@
@@MISSING 362@@
@@MISSING 363@@
@@MISSING 364@@
@@MISSING 365@@
@@MISSING 366@@
@@MISSING 367@@
@@MISSING 368@@
@@MISSING 369@@
@@MISSING 370@@
@@MISSING 371@@
@@MISSING 372@@
@@MISSING 373@@
@@MISSING 374@@
@@MISSING 375@@
@@MISSING 376@@
@@MISSING 377@@
@@MISSING 378@@
@@MISSING 379@@
@@MISSING 380@@
@@MISSING 381@@
@@MISSING 382@@
@@MISSING 383@@
@@MISSING 384@@
@@MISSING 385@@
@@MISSING 386@@
@@MISSING 387@@
@@MISSING 388@@
@@MISSING 389@@
@@MISSING 390@@
@@MISSING 391@@
@@MISSING 392@@
@@MISSING 393@@
@@MISSING 394@@
@@MISSING 395@@
@@MISSING 396@@
@@MISSING 397@@
@@MISSING 398@@
@@MISSING 399@@
@@MISSING 400@@
@@MISSING 401@@
@@MISSING 402@@
@@MISSING 403@@
    alex.strike(blake.id);
@@MISSING 405@@
@@MISSING 406@@
@@MISSING 407@@
@@MISSING 408@@
    alex.strike(blake.id);
@@MISSING 410@@
@@MISSING 411@@
@@MISSING 412@@
@@MISSING 413@@
@@MISSING 414@@
@@MISSING 415@@
@@MISSING 416@@
@@MISSING 417@@
      alex.strike(blake.id);
@@MISSING 419@@
@@MISSING 420@@
@@MISSING 421@@
@@MISSING 422@@
@@MISSING 423@@
@@MISSING 424@@
@@MISSING 425@@
@@MISSING 426@@
@@MISSING 427@@
@@MISSING 428@@
@@MISSING 429@@
@@MISSING 430@@
@@MISSING 431@@
@@MISSING 432@@
@@MISSING 433@@
    alex.strike(blake.id);
@@MISSING 435@@
@@MISSING 436@@
@@MISSING 437@@
@@MISSING 438@@
@@MISSING 439@@
@@MISSING 440@@
@@MISSING 441@@
@@MISSING 442@@
@@MISSING 443@@
@@MISSING 444@@
@@MISSING 445@@
@@MISSING 446@@
@@MISSING 447@@
@@MISSING 448@@
@@MISSING 449@@
@@MISSING 450@@
@@MISSING 451@@
@@MISSING 452@@
@@MISSING 453@@
@@MISSING 454@@
@@MISSING 455@@
@@MISSING 456@@
@@MISSING 457@@
@@MISSING 458@@
@@MISSING 459@@
@@MISSING 460@@
@@MISSING 461@@
@@MISSING 462@@
@@MISSING 463@@
@@MISSING 464@@
@@MISSING 465@@
@@MISSING 466@@
@@MISSING 467@@
@@MISSING 468@@
@@MISSING 469@@
@@MISSING 470@@
@@MISSING 471@@
@@MISSING 472@@
@@MISSING 473@@
@@MISSING 474@@
@@MISSING 475@@
@@MISSING 476@@
@@MISSING 477@@
@@MISSING 478@@
@@MISSING 479@@
@@MISSING 480@@
@@MISSING 481@@
@@MISSING 482@@
@@MISSING 483@@
@@MISSING 484@@
@@MISSING 485@@
@@MISSING 486@@
@@MISSING 487@@
@@MISSING 488@@
@@MISSING 489@@
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
@@MISSING 740@@
@@MISSING 741@@
@@MISSING 742@@
@@MISSING 743@@
@@MISSING 744@@
@@MISSING 745@@
@@MISSING 746@@
@@MISSING 747@@
@@MISSING 748@@
@@MISSING 749@@
@@MISSING 750@@
@@MISSING 751@@
@@MISSING 752@@
@@MISSING 753@@
@@MISSING 754@@
@@MISSING 755@@
@@MISSING 756@@
@@MISSING 757@@
@@MISSING 758@@
@@MISSING 759@@
@@MISSING 760@@
@@MISSING 761@@
@@MISSING 762@@
@@MISSING 763@@
@@MISSING 764@@
@@MISSING 765@@
@@MISSING 766@@
@@MISSING 767@@
@@MISSING 768@@
@@MISSING 769@@
@@MISSING 770@@
@@MISSING 771@@
@@MISSING 772@@
@@MISSING 773@@
@@MISSING 774@@
@@MISSING 775@@
@@MISSING 776@@
@@MISSING 777@@
@@MISSING 778@@
@@MISSING 779@@
@@MISSING 780@@
@@MISSING 781@@
@@MISSING 782@@
@@MISSING 783@@
@@MISSING 784@@
@@MISSING 785@@
@@MISSING 786@@
@@MISSING 787@@
@@MISSING 788@@
@@MISSING 789@@
@@MISSING 790@@
@@MISSING 791@@
@@MISSING 792@@
@@MISSING 793@@
@@MISSING 794@@
@@MISSING 795@@
@@MISSING 796@@
@@MISSING 797@@
@@MISSING 798@@
@@MISSING 799@@
@@MISSING 800@@
@@MISSING 801@@
@@MISSING 802@@
@@MISSING 803@@
@@MISSING 804@@
@@MISSING 805@@
@@MISSING 806@@
@@MISSING 807@@
@@MISSING 808@@
@@MISSING 809@@
@@MISSING 810@@
@@MISSING 811@@
@@MISSING 812@@
@@MISSING 813@@
@@MISSING 814@@
@@MISSING 815@@
@@MISSING 816@@
@@MISSING 817@@
@@MISSING 818@@
@@MISSING 819@@
@@MISSING 820@@
@@MISSING 821@@
@@MISSING 822@@
@@MISSING 823@@
@@MISSING 824@@
@@MISSING 825@@
@@MISSING 826@@
@@MISSING 827@@
@@MISSING 828@@
@@MISSING 829@@
@@MISSING 830@@
@@MISSING 831@@
@@MISSING 832@@
@@MISSING 833@@
@@MISSING 834@@
@@MISSING 835@@
@@MISSING 836@@
@@MISSING 837@@
@@MISSING 838@@
@@MISSING 839@@
@@MISSING 840@@
@@MISSING 841@@
@@MISSING 842@@
@@MISSING 843@@
@@MISSING 844@@
@@MISSING 845@@
@@MISSING 846@@
@@MISSING 847@@
@@MISSING 848@@
@@MISSING 849@@
@@MISSING 850@@
@@MISSING 851@@
@@MISSING 852@@
@@MISSING 853@@
@@MISSING 854@@
@@MISSING 855@@
@@MISSING 856@@
@@MISSING 857@@
@@MISSING 858@@
@@MISSING 859@@
@@MISSING 860@@
@@MISSING 861@@
@@MISSING 862@@
@@MISSING 863@@
@@MISSING 864@@
@@MISSING 865@@
@@MISSING 866@@
@@MISSING 867@@
@@MISSING 868@@
@@MISSING 869@@
@@MISSING 870@@
@@MISSING 871@@
@@MISSING 872@@
@@MISSING 873@@
@@MISSING 874@@
@@MISSING 875@@
@@MISSING 876@@
@@MISSING 877@@
@@MISSING 878@@
@@MISSING 879@@
@@MISSING 880@@
@@MISSING 881@@
@@MISSING 882@@
@@MISSING 883@@
@@MISSING 884@@
@@MISSING 885@@
@@MISSING 886@@
@@MISSING 887@@
@@MISSING 888@@
@@MISSING 889@@
@@MISSING 890@@
@@MISSING 891@@
@@MISSING 892@@
@@MISSING 893@@
@@MISSING 894@@
@@MISSING 895@@
@@MISSING 896@@
@@MISSING 897@@
@@MISSING 898@@
@@MISSING 899@@
@@MISSING 900@@
@@MISSING 901@@
@@MISSING 902@@
@@MISSING 903@@
@@MISSING 904@@
@@MISSING 905@@
@@MISSING 906@@
@@MISSING 907@@
@@MISSING 908@@
@@MISSING 909@@
@@MISSING 910@@
@@MISSING 911@@
@@MISSING 912@@
@@MISSING 913@@
@@MISSING 914@@
@@MISSING 915@@
@@MISSING 916@@
@@MISSING 917@@
@@MISSING 918@@
@@MISSING 919@@
@@MISSING 920@@
@@MISSING 921@@
@@MISSING 922@@
@@MISSING 923@@
@@MISSING 924@@
@@MISSING 925@@
@@MISSING 926@@
@@MISSING 927@@
@@MISSING 928@@
@@MISSING 929@@
@@MISSING 930@@
@@MISSING 931@@
@@MISSING 932@@
@@MISSING 933@@
@@MISSING 934@@
@@MISSING 935@@
@@MISSING 936@@
@@MISSING 937@@
@@MISSING 938@@
@@MISSING 939@@
@@MISSING 940@@
@@MISSING 941@@
@@MISSING 942@@
@@MISSING 943@@
@@MISSING 944@@
@@MISSING 945@@
@@MISSING 946@@
@@MISSING 947@@
@@MISSING 948@@
@@MISSING 949@@
@@MISSING 950@@
@@MISSING 951@@
@@MISSING 952@@
@@MISSING 953@@
@@MISSING 954@@
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
@@MISSING 1077@@
@@MISSING 1078@@
@@MISSING 1079@@
@@MISSING 1080@@
@@MISSING 1081@@
@@MISSING 1082@@
@@MISSING 1083@@
@@MISSING 1084@@
@@MISSING 1085@@
@@MISSING 1086@@
@@MISSING 1087@@
@@MISSING 1088@@
@@MISSING 1089@@
@@MISSING 1090@@
@@MISSING 1091@@
@@MISSING 1092@@
@@MISSING 1093@@
@@MISSING 1094@@
@@MISSING 1095@@
@@MISSING 1096@@
@@MISSING 1097@@
@@MISSING 1098@@
@@MISSING 1099@@
@@MISSING 1100@@
@@MISSING 1101@@
@@MISSING 1102@@
@@MISSING 1103@@
@@MISSING 1104@@
@@MISSING 1105@@
@@MISSING 1106@@
@@MISSING 1107@@
@@MISSING 1108@@
@@MISSING 1109@@
@@MISSING 1110@@
@@MISSING 1111@@
@@MISSING 1112@@
@@MISSING 1113@@
@@MISSING 1114@@
@@MISSING 1115@@
@@MISSING 1116@@
@@MISSING 1117@@
@@MISSING 1118@@
@@MISSING 1119@@
@@MISSING 1120@@
@@MISSING 1121@@
@@MISSING 1122@@
@@MISSING 1123@@
@@MISSING 1124@@
@@MISSING 1125@@
@@MISSING 1126@@
@@MISSING 1127@@
@@MISSING 1128@@
@@MISSING 1129@@
@@MISSING 1130@@
@@MISSING 1131@@
@@MISSING 1132@@
@@MISSING 1133@@
@@MISSING 1134@@
@@MISSING 1135@@
@@MISSING 1136@@
@@MISSING 1137@@
@@MISSING 1138@@
@@MISSING 1139@@
@@MISSING 1140@@
@@MISSING 1141@@
@@MISSING 1142@@
@@MISSING 1143@@
@@MISSING 1144@@
@@MISSING 1145@@
@@MISSING 1146@@
@@MISSING 1147@@
@@MISSING 1148@@
@@MISSING 1149@@
@@MISSING 1150@@
@@MISSING 1151@@
@@MISSING 1152@@
@@MISSING 1153@@
@@MISSING 1154@@
@@MISSING 1155@@
@@MISSING 1156@@
@@MISSING 1157@@
@@MISSING 1158@@
@@MISSING 1159@@
@@MISSING 1160@@
@@MISSING 1161@@
@@MISSING 1162@@
@@MISSING 1163@@
@@MISSING 1164@@
@@MISSING 1165@@
@@MISSING 1166@@
@@MISSING 1167@@
@@MISSING 1168@@
@@MISSING 1169@@
@@MISSING 1170@@
@@MISSING 1171@@
@@MISSING 1172@@
@@MISSING 1173@@
@@MISSING 1174@@
@@MISSING 1175@@
@@MISSING 1176@@
@@MISSING 1177@@
@@MISSING 1178@@
@@MISSING 1179@@
@@MISSING 1180@@
@@MISSING 1181@@
@@MISSING 1182@@
@@MISSING 1183@@
@@MISSING 1184@@
@@MISSING 1185@@
@@MISSING 1186@@
@@MISSING 1187@@
@@MISSING 1188@@
@@MISSING 1189@@
@@MISSING 1190@@
@@MISSING 1191@@
@@MISSING 1192@@
@@MISSING 1193@@
@@MISSING 1194@@
@@MISSING 1195@@
@@MISSING 1196@@
@@MISSING 1197@@
@@MISSING 1198@@
@@MISSING 1199@@
@@MISSING 1200@@
@@MISSING 1201@@
@@MISSING 1202@@
@@MISSING 1203@@
@@MISSING 1204@@
@@MISSING 1205@@
@@MISSING 1206@@
@@MISSING 1207@@
@@MISSING 1208@@
@@MISSING 1209@@
@@MISSING 1210@@
@@MISSING 1211@@
@@MISSING 1212@@
@@MISSING 1213@@
@@MISSING 1214@@
@@MISSING 1215@@
@@MISSING 1216@@
@@MISSING 1217@@
@@MISSING 1218@@
@@MISSING 1219@@
@@MISSING 1220@@
@@MISSING 1221@@
@@MISSING 1222@@
@@MISSING 1223@@
@@MISSING 1224@@
@@MISSING 1225@@
@@MISSING 1226@@
@@MISSING 1227@@
@@MISSING 1228@@
@@MISSING 1229@@
@@MISSING 1230@@
@@MISSING 1231@@
@@MISSING 1232@@
@@MISSING 1233@@
@@MISSING 1234@@
@@MISSING 1235@@
@@MISSING 1236@@
@@MISSING 1237@@
@@MISSING 1238@@
@@MISSING 1239@@
@@MISSING 1240@@
@@MISSING 1241@@
@@MISSING 1242@@
@@MISSING 1243@@
@@MISSING 1244@@
@@MISSING 1245@@
@@MISSING 1246@@
@@MISSING 1247@@
@@MISSING 1248@@
@@MISSING 1249@@
@@MISSING 1250@@
@@MISSING 1251@@

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

@@MISSING 1585@@
@@MISSING 1586@@
@@MISSING 1587@@
@@MISSING 1588@@
@@MISSING 1589@@
@@MISSING 1590@@
@@MISSING 1591@@
@@MISSING 1592@@
@@MISSING 1593@@
@@MISSING 1594@@
@@MISSING 1595@@
@@MISSING 1596@@
@@MISSING 1597@@
@@MISSING 1598@@
@@MISSING 1599@@
@@MISSING 1600@@
@@MISSING 1601@@
@@MISSING 1602@@
@@MISSING 1603@@
@@MISSING 1604@@
@@MISSING 1605@@
@@MISSING 1606@@
@@MISSING 1607@@
@@MISSING 1608@@
@@MISSING 1609@@
@@MISSING 1610@@
@@MISSING 1611@@
@@MISSING 1612@@
@@MISSING 1613@@
@@MISSING 1614@@
@@MISSING 1615@@
@@MISSING 1616@@
@@MISSING 1617@@
@@MISSING 1618@@
@@MISSING 1619@@
      !ivo.has('correct') && !pax.has('hit') && pauser.blinkUntil > Date.now() - 600);
@@MISSING 1621@@
@@MISSING 1622@@
@@MISSING 1623@@
@@MISSING 1624@@
@@MISSING 1625@@
@@MISSING 1626@@
@@MISSING 1627@@
@@MISSING 1628@@
@@MISSING 1629@@
@@MISSING 1630@@
@@MISSING 1631@@
@@MISSING 1632@@
@@MISSING 1633@@
@@MISSING 1634@@
@@MISSING 1635@@
@@MISSING 1636@@
@@MISSING 1637@@
@@MISSING 1638@@
@@MISSING 1639@@
@@MISSING 1640@@
@@MISSING 1641@@
@@MISSING 1642@@
@@MISSING 1643@@
@@MISSING 1644@@
@@MISSING 1645@@
@@MISSING 1646@@
@@MISSING 1647@@
@@MISSING 1648@@
@@MISSING 1649@@
@@MISSING 1650@@
@@MISSING 1651@@
@@MISSING 1652@@
@@MISSING 1653@@
@@MISSING 1654@@
@@MISSING 1655@@
@@MISSING 1656@@
@@MISSING 1657@@
@@MISSING 1658@@
@@MISSING 1659@@
@@MISSING 1660@@
@@MISSING 1661@@
@@MISSING 1662@@
@@MISSING 1663@@
@@MISSING 1664@@
@@MISSING 1665@@
@@MISSING 1666@@
@@MISSING 1667@@
@@MISSING 1668@@
@@MISSING 1669@@
@@MISSING 1670@@
@@MISSING 1671@@
@@MISSING 1672@@
@@MISSING 1673@@
@@MISSING 1674@@
@@MISSING 1675@@
@@MISSING 1676@@
@@MISSING 1677@@
@@MISSING 1678@@
@@MISSING 1679@@
@@MISSING 1680@@
@@MISSING 1681@@
@@MISSING 1682@@
@@MISSING 1683@@
@@MISSING 1684@@
@@MISSING 1685@@
@@MISSING 1686@@
@@MISSING 1687@@
@@MISSING 1688@@
@@MISSING 1689@@
@@MISSING 1690@@
@@MISSING 1691@@
@@MISSING 1692@@
@@MISSING 1693@@
@@MISSING 1694@@
@@MISSING 1695@@
@@MISSING 1696@@
@@MISSING 1697@@
@@MISSING 1698@@
@@MISSING 1699@@
@@MISSING 1700@@
@@MISSING 1701@@
@@MISSING 1702@@
@@MISSING 1703@@
@@MISSING 1704@@
@@MISSING 1705@@
@@MISSING 1706@@
@@MISSING 1707@@
@@MISSING 1708@@
@@MISSING 1709@@
@@MISSING 1710@@
@@MISSING 1711@@
@@MISSING 1712@@
@@MISSING 1713@@
@@MISSING 1714@@
@@MISSING 1715@@
@@MISSING 1716@@
@@MISSING 1717@@
@@MISSING 1718@@
@@MISSING 1719@@
@@MISSING 1720@@
@@MISSING 1721@@
@@MISSING 1722@@
@@MISSING 1723@@
@@MISSING 1724@@
@@MISSING 1725@@
@@MISSING 1726@@
@@MISSING 1727@@
@@MISSING 1728@@
@@MISSING 1729@@
@@MISSING 1730@@
@@MISSING 1731@@
@@MISSING 1732@@
@@MISSING 1733@@
@@MISSING 1734@@
@@MISSING 1735@@
@@MISSING 1736@@
@@MISSING 1737@@
@@MISSING 1738@@
@@MISSING 1739@@
@@MISSING 1740@@
@@MISSING 1741@@
@@MISSING 1742@@
@@MISSING 1743@@
@@MISSING 1744@@
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

// Two (then four) real Chromium pages, the real TerraGlide server, the real
// ProximityVoice. Prints PASS/FAIL lines with the numbers behind them.
import { mkdtempSync, readFile, rmSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { chromium } from '/home/user/terraglide/node_modules/playwright/index.mjs';
import { startServer } from '/home/user/terraglide/server/server.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = '/home/user/terraglide';
const LAN = process.env.LAN_IP ?? '192.0.2.2';
const dataDir = mkdtempSync(join(HERE, 'data-'));

let failures = 0;
const ok = (cond, msg, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const game = startServer({ port: 0, host: '0.0.0.0', dataDir, serveGame: false, signupsPerHour: 50 });
const address = await game.ready;
const wsUrl = `ws://127.0.0.1:${address.port}/ws`;
console.log('server', wsUrl, 'iceServers', JSON.stringify(game.config.iceServers));

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm' };
const statik = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = null;
  if (p === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  if (p === '/harness.html' || p === '/harness.js') file = join(HERE, p);
  else if (p.startsWith('/src/') || p.startsWith('/vendor/')) {
    file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT + '/')) file = null;
  }
  if (!file) {
    res.writeHead(404).end('nope');
    return;
  }
  readFile(file, (error, body) => {
    if (error) {
      res.writeHead(404).end('missing');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  });
});
await new Promise((r) => statik.listen(0, '0.0.0.0', r));
const httpPort = statik.address().port;

let browser2 = null;
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${HERE}speech.wav`,
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
  ],
});

async function openPage(name, { host = '127.0.0.1', deny = false, mode = 'open' } = {}) {
  const context = await browser.newContext({ permissions: host === '127.0.0.1' ? ['microphone'] : [] });
  const page = await context.newPage();
  const lines = [];
  page.on('console', (m) => lines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => lines.push(`[pageerror] ${e.message}`));
  page.lines = lines;
  await page.goto(`http://${host}:${httpPort}/harness.html?name=${name}&ws=${encodeURIComponent(wsUrl)}&mode=${mode}${deny ? '&deny=1' : ''}`);
  await page.waitForFunction(() => window.T?.session?.you, null, { timeout: 15000 });
  page.id = await page.evaluate(() => window.T.session.you.id);
  page.label = name;
  return page;
}

const wait = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 50 }).then(() => true, () => false);
const stats = (page) => page.evaluate(() => window.T.stats());
const log = (page) => page.evaluate(() => window.T.log);
const linear = (d) => 1 - (Math.min(Math.max(d, 40), 800) - 40) / (800 - 40);

try {
  /* ---------------------------------------------------------------- 1 */
  console.log('\n1. two pages, signed in, in range: connect');
  const A = await openPage('alice');
  const B = await openPage('bob');
  console.log(`alice id ${A.id}, bob id ${B.id}`);
  await wait(A, (id) => window.T.others.has(id), B.id);
  await wait(B, (id) => window.T.others.has(id), A.id);
  const t0 = Date.now();
  const connA = await wait(A, (id) => window.T.voice.peers.get(id)?.pc.connectionState === 'connected', B.id, 20000);
  const connB = await wait(B, (id) => window.T.voice.peers.get(id)?.pc.connectionState === 'connected', A.id, 20000);
  ok(connA && connB, 'both RTCPeerConnections reach connected', `${Date.now() - t0} ms after both were listed`);
  // Connected can come before a side has gathered its own candidates (the
  // other side's were enough); read the logs once both have finished.
  await wait(A, (id) => window.T.voice.peers.get(id)?.pc.iceGatheringState === 'complete', B.id, 5000);
  await wait(B, (id) => window.T.voice.peers.get(id)?.pc.iceGatheringState === 'complete', A.id, 5000);
  await new Promise((r) => setTimeout(r, 200));
  const logA = await log(A);
  const logB = await log(B);
  const count = (l, dir, kind, extra = () => true) => l.filter((e) => e.dir === dir && e.kind === kind && extra(e)).length;
  ok(count(logA, 'out', 'offer', (e) => !e.ask) === 1 && count(logB, 'in', 'offer', (e) => !e.ask) === 1,
    'the lower id (alice) sent exactly one offer, and bob received it through the server',
    `alice out offers ${count(logA, 'out', 'offer', (e) => !e.ask)}, bob in ${count(logB, 'in', 'offer', (e) => !e.ask)}, bob out offers ${count(logB, 'out', 'offer', (e) => !e.ask)}`);
  ok(count(logB, 'out', 'answer') === 1 && count(logA, 'in', 'answer') === 1, 'bob answered once, alice received it',
    `bob out answers ${count(logB, 'out', 'answer')}, alice in ${count(logA, 'in', 'answer')}`);
  const iceOutA = logA.filter((e) => e.dir === 'out' && e.kind === 'ice');
  const iceInB = logB.filter((e) => e.dir === 'in' && e.kind === 'ice');
  const iceOutB = logB.filter((e) => e.dir === 'out' && e.kind === 'ice');
  ok(iceOutA.length > 0 && iceInB.length === iceOutA.length && iceOutB.length > 0,
    'trickle ICE flows both ways through the relay, batched',
    `alice sent ${iceOutA.length} ice messages carrying ${iceOutA.reduce((s, e) => s + e.candidates, 0)} candidates; bob got ${iceInB.length}; bob sent ${iceOutB.length} carrying ${iceOutB.reduce((s, e) => s + e.candidates, 0)}`);
  ok(new Set([...logA, ...logB].filter((e) => e.cid).map((e) => e.cid)).size === 1, 'one connection id on every message of the call');
  console.log('   alice log:', JSON.stringify(logA));
  console.log('   bob log:  ', JSON.stringify(logB));

  /* ---------------------------------------------------------------- 2 */
  console.log('\n2. audio arrives');
  await sleep(3000);
  const sA = (await stats(A))[B.id];
  const sB = (await stats(B))[A.id];
  ok(sA.inPackets > 50 && sB.inPackets > 50, 'getStats inbound-rtp packetsReceived > 0 on both sides',
    `alice received ${sA.inPackets} packets / ${sA.inBytes} bytes, bob received ${sB.inPackets} / ${sB.inBytes}; sent ${sA.outPackets} / ${sB.outPackets}`);
  // The received stream reaches Web Audio (Chrome's muted-<audio> workaround).
  const levelMax = await A.evaluate(async (id) => {
    let max = 0;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 50));
      max = Math.max(max, window.T.voice.peers.get(id).level);
    }
    return max;
  }, B.id);
  ok(levelMax > 0.02, 'the received voice reaches the Web Audio graph (analyser on the remote stream)', `peak RMS ${levelMax.toFixed(4)}`);
  const talk = await A.evaluate(() => ({ talking: window.T.voice.talking, session: window.T.session.talking, level: window.T.voice.level, status: window.T.voice.status(), speaking: window.T.voice.speaking() }));
  console.log('   alice:', JSON.stringify(talk));
  ok(sA.pannerModel?.join() === 'HRTF,linear,40,800,1', 'panner is HRTF, linear, ref VOICE_FULL_M, max VOICE_RANGE_M, rolloff 1', sA.pannerModel?.join());
  ok(sA.direction === 'sendrecv' && sB.direction === 'sendrecv', 'both directions negotiated sendrecv', `${sA.direction} / ${sB.direction}`);

  /* ---------------------------------------------------------------- 3 */
  console.log('\n3. distance: panner position and gain follow the stub pose');
  const rows = [];
  for (const d of [20, 420, 610, 790]) {
    await A.evaluate(([id, z]) => window.T.place(id, 0, 0, -z), [B.id, d]);
    await sleep(400);
    const st = (await stats(A))[B.id];
    const m = await A.evaluate((id) => window.T.measure(id, 2500), B.id);
    rows.push({ d, panner: st.panner.map((v) => +v.toFixed(2)), measured: (m.gainL + m.gainR) / 2, L: m.gainL, R: m.gainR });
  }
  const base = rows[0].measured;
  for (const r of rows) {
    r.relative = r.measured / base;
    r.expected = linear(r.d);
    console.log(`   d=${r.d} m  panner=(${r.panner.join(', ')})  post/pre=${r.measured.toFixed(4)}  relative=${r.relative.toFixed(3)}  linear model=${r.expected.toFixed(3)}`);
  }
  ok(Math.abs(rows[1].panner[2] + 420) < 1 && Math.abs(rows[1].panner[1]) < 0.01, 'panner sits at the pose relative to the camera, at head height', rows[1].panner.join(', '));
  ok(rows.every((r) => Math.abs(r.relative - r.expected) < 0.06 + 0.1 * r.expected), 'measured loudness follows the linear model at every distance',
    rows.map((r) => `${r.d} m: ${r.relative.toFixed(3)} vs ${r.expected.toFixed(3)}`).join('; '));

  console.log('\n   left/right (HRTF): bob 30 m ahead, then 30 m east, then alice turns round');
  const lr = (m) => `L ${m.gainL.toFixed(3)} R ${m.gainR.toFixed(3)} (R/L ${(m.gainR / m.gainL).toFixed(2)}), right ear leads by ${m.rightLeads} samples = ${m.rightLeadsMs.toFixed(3)} ms at ${m.sampleRate} Hz`;
  await A.evaluate((id) => window.T.place(id, 0, 0, -30), B.id);
  await sleep(400);
  const ahead = await A.evaluate((id) => window.T.measure(id, 2000), B.id);
  console.log(`   ahead:  ${lr(ahead)}`);
  await A.evaluate((id) => window.T.place(id, 30, 0, 0), B.id);
  await sleep(400);
  const east = await A.evaluate((id) => window.T.measure(id, 2000), B.id);
  console.log(`   east:   ${lr(east)}`);
  await A.evaluate(() => window.T.face(Math.PI));
  await sleep(400);
  const eastBehind = await A.evaluate((id) => window.T.measure(id, 2000), B.id);
  console.log(`   turned: ${lr(eastBehind)}`);
  await A.evaluate(() => window.T.face(0));
  // HRTF is not a pan pot: the far ear is shadowed (a few dB broadband, more
  // in the treble) and hears it later. Both are asserted, and straight ahead
  // both have to vanish.
  ok(Math.abs(ahead.gainR / ahead.gainL - 1) < 0.1 && Math.abs(ahead.rightLeads) <= 2, 'straight ahead: both ears equal, no time difference', lr(ahead));
  ok(east.gainR > east.gainL * 1.25 && east.rightLeads >= 15, 'facing north, a voice to the east is louder and earlier in the right ear', lr(east));
  ok(eastBehind.gainL > eastBehind.gainR * 1.25 && eastBehind.rightLeads <= -15, 'turn round (camera yaw 180) and it is in the left ear', lr(eastBehind));

  /* ---------------------------------------------------------------- 4 */
  console.log('\n4. hysteresis and closing on distance');
  const mark = async (p) => (await log(p)).length;
  let a0 = await mark(A);
  let b0 = await mark(B);
  for (const p of [A, B]) await p.evaluate(([id, z]) => window.T.place(id, 0, 0, -z), [p === A ? B.id : A.id, 1100]);
  await sleep(1500);
  ok((await A.evaluate((id) => window.T.voice.peers.has(id), B.id)) && (await B.evaluate((id) => window.T.voice.peers.has(id), A.id)),
    'at 1100 m (past VOICE_CONNECT_M, inside 1.25x) the call is kept');
  const tClose = Date.now();
  for (const p of [A, B]) await p.evaluate(([id, z]) => window.T.place(id, 0, 0, -z), [p === A ? B.id : A.id, 1300]);
  const closedA = await wait(A, (id) => !window.T.voice.peers.has(id), B.id, 3000);
  const closedB = await wait(B, (id) => !window.T.voice.peers.has(id), A.id, 3000);
  ok(closedA && closedB, 'at 1300 m (past 1.25 x VOICE_CONNECT_M) both sides close', `${Date.now() - tClose} ms`);
  let la = (await log(A)).slice(a0);
  let lb = (await log(B)).slice(b0);
  const byes = [...la, ...lb].filter((e) => e.kind === 'bye');
  ok(byes.some((e) => e.dir === 'out' && e.why === 'range') && byes.some((e) => e.dir === 'in'), "a 'bye' with why 'range' is sent and received", JSON.stringify(byes));
  const eventsA = await A.evaluate(() => window.T.events.filter((e) => e.type === 'drop'));
  console.log('   alice drop events:', JSON.stringify(eventsA));
  await sleep(6000);
  la = (await log(A)).slice(a0);
  lb = (await log(B)).slice(b0);
  ok(![...la, ...lb].some((e) => e.kind === 'offer'), 'and no new offers or asks while out of range (6 s)', `${la.length + lb.length} messages since`);
  a0 = await mark(A);
  b0 = await mark(B);
  for (const p of [A, B]) await p.evaluate(([id, z]) => window.T.place(id, 0, 0, -z), [p === A ? B.id : A.id, 900]);
  const back = await wait(A, (id) => window.T.voice.peers.get(id)?.pc.connectionState === 'connected', B.id, 15000);
  ok(back, 'back inside VOICE_CONNECT_M (900 m): reconnected with a fresh connection id',
    JSON.stringify((await log(A)).slice(a0).filter((e) => e.kind === 'offer').map((e) => e.cid)));
  for (const p of [A, B]) await p.evaluate(([id, z]) => window.T.place(id, 0, 0, -z), [p === A ? B.id : A.id, 20]);

  /* --------------------------------------------------------------- 4b */
  console.log('\n4b. freecam: range is measured from your figure, what you hear from the camera');
  // Alice now has a figure (feet at the origin, as game.player.position is),
  // and flies her camera 5 km off. The call must stay: the server judges
  // range from the players, not the cameras.
  await A.evaluate(() => {
    window.T.session.game.player.position = new window.T.THREE.Vector3(0, 0, 0);
    window.T.camera.position.set(0, 1.7, 5000);
    window.T.camera.updateMatrixWorld();
  });
  await sleep(1500);
  const free = await A.evaluate(async (id) => {
    const s = (await window.T.stats())[id];
    return { has: window.T.voice.peers.has(id), state: s?.state, panner: s?.panner?.map((v) => Math.round(v)), distance: Math.round(s?.distance ?? -1) };
  }, B.id);
  ok(free.has && free.state === 'connected', 'camera flown 5 km off, figure still 20 m from bob: the call stays', JSON.stringify(free));
  ok(free.panner && free.panner[2] <= -5000 && free.distance >= 5000, 'and bob is placed from the camera, 5 km away (out of earshot)', `panner ${JSON.stringify(free.panner)}, distance ${free.distance} m`);
  // Now the figure walks away while the camera stays where bob is: the
  // figure decides, so the call closes.
  a0 = await mark(A);
  await A.evaluate(() => {
    window.T.camera.position.set(0, 1.7, 0);
    window.T.camera.updateMatrixWorld();
    window.T.session.game.player.position.set(0, 0, 1300);
  });
  // Only alice's page moves her: bob still sees her 20 m away, so the hang-up
  // can only come from alice's own figure.
  const freeClosed = await wait(A, (id) => !window.T.voice.peers.has(id), B.id, 3000);
  const freeByes = (await log(A)).slice(a0).filter((e) => e.kind === 'bye').map((e) => `${e.dir}:${e.why}`);
  ok(freeClosed && freeByes[0] === 'out:range', 'camera back beside bob, figure 1320 m off: alice closes for range', JSON.stringify(freeByes));
  await B.evaluate((id) => window.T.place(id, 0, 0, -1320), A.id);
  // Back as it was (no figure: the camera path the rest of the run uses).
  await A.evaluate(() => {
    delete window.T.session.game.player.position;
  });
  await B.evaluate((id) => window.T.place(id, 0, 0, -20), A.id);
  const back4b = await wait(A, (id) => window.T.voice.peers.get(id)?.pc.connectionState === 'connected', B.id, 15000);
  ok(back4b, 'figure back: reconnected');

  /* --------------------------------------------------------------- 4c */
  console.log("\n4c. a burst of signalling stays under the server's relay limit (60 a second per player)");
  // 100 goodbyes for a connection id that does not exist (so bob ignores
  // them) through voice.signal() at once. The server drops anything past
  // 60 in a second; the outbox should spread them so all 100 arrive.
  const burstAt = await B.evaluate(() => performance.now());
  await A.evaluate((id) => {
    for (let i = 0; i < 100; i++) window.T.voice.signal(id, 'bye', { cid: 'no-such-call', why: `burst${i}` });
  }, B.id);
  await wait(B, (t0) => window.T.log.filter((e) => e.at >= t0 && e.dir === 'in' && String(e.why).startsWith('burst')).length >= 100, burstAt, 6000);
  const burst = await B.evaluate((t0) => {
    const got = window.T.log.filter((e) => e.at >= t0 && e.dir === 'in' && String(e.why).startsWith('burst'));
    const inOrder = got.every((e, i) => e.why === `burst${i}`);
    let peak = 0;
    for (const e of got) peak = Math.max(peak, got.filter((f) => f.at >= e.at && f.at < e.at + 1000).length);
    return { n: got.length, inOrder, peak, spanMs: got.length ? got[got.length - 1].at - got[0].at : 0 };
  }, burstAt);
  ok(burst.n === 100 && burst.inOrder, 'all 100 relayed, in order (without the outbox the server passes 61)', `received ${burst.n}, in order ${burst.inOrder}, over ${burst.spanMs} ms, at most ${burst.peak} in any second`);
  ok(await B.evaluate((id) => window.T.voice.peers.get(id)?.pc.connectionState === 'connected', A.id), 'and the call they did not match is untouched');
  // The control: the same burst straight onto the socket, past the outbox.
  await sleep(1500);
  const rawAt = await B.evaluate(() => performance.now());
  await A.evaluate((id) => {
    for (let i = 0; i < 100; i++) window.T.session.net.send({ t: 'voice', to: id, kind: 'bye', data: { cid: 'no-such-call', why: `raw${i}` } });
  }, B.id);
  await sleep(2000);
  const raw = await B.evaluate((t0) => window.T.log.filter((e) => e.at >= t0 && e.dir === 'in' && String(e.why).startsWith('raw')).length, rawAt);
  console.log(`   control: the same 100 sent raw, past the outbox: ${raw} relayed`);
  await sleep(1200);

  /* ---------------------------------------------------------------- 5 */
  console.log('\n5. push to talk and the talking flag');
  await sleep(1500);
  const openTalk = await A.evaluate(async () => {
    let t = 0;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 50));
      if (window.T.voice.talking && window.T.session.talking) t++;
    }
    return t;
  });
  ok(openTalk > 10, 'open mode: alice.talking (and session.talking) goes true while the mic carries speech', `${openTalk}/40 samples`);
  await A.evaluate(() => window.T.settings.set('voiceMode', 'push'));
  await sleep(1500);
  const pushOff = await B.evaluate(async (id) => {
    let max = 0;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 50));
      max = Math.max(max, window.T.voice.peers.get(id)?.level ?? 0);
    }
    return { max, status: null };
  }, A.id);
  const aPush = await A.evaluate(() => ({ talking: window.T.voice.talking, transmitting: window.T.voice.transmitting, enabled: window.T.voice.micTrack?.enabled, level: window.T.voice.level, status: window.T.voice.status() }));
  ok(pushOff.max < 0.005 && !aPush.talking && aPush.enabled === false, 'push mode, key up: bob hears silence, alice is not talking', `bob peak RMS ${pushOff.max.toFixed(5)}; alice ${JSON.stringify(aPush)}`);
  await A.evaluate(() => window.T.voice.setPushed(true));
  await sleep(800);
  const pushOn = await B.evaluate(async (id) => {
    let max = 0;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 50));
      max = Math.max(max, window.T.voice.peers.get(id)?.level ?? 0);
    }
    return max;
  }, A.id);
  const aPushed = await A.evaluate(async () => {
    let t = 0;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 50));
      if (window.T.voice.talking) t++;
    }
    return { t, status: window.T.voice.status() };
  });
  ok(pushOn > 0.02 && aPushed.t > 10, 'key down: bob hears alice again, alice.talking true', `bob peak ${pushOn.toFixed(4)}; alice talking ${aPushed.t}/40; status "${aPushed.status}"`);
  const bobSees = await B.evaluate((id) => window.T.voice.isTalking(id), A.id);
  console.log('   bob voice.isTalking(alice) =', bobSees);
  await A.evaluate(() => window.T.voice.setPushed(false));
  await A.evaluate(() => window.T.settings.set('voiceMode', 'open'));

  /* ---------------------------------------------------------------- 6 */
  console.log('\n6. mute');
  await A.evaluate((id) => window.T.voice.mute(id, true), B.id);
  await sleep(300);
  const muted = await A.evaluate((id) => ({ gain: window.T.voice.peers.get(id).gain.gain.value, set: [...window.T.voice.muted] }), B.id);
  await A.evaluate((id) => window.T.voice.mute(id, false), B.id);
  await sleep(300);
  const unmuted = await A.evaluate((id) => window.T.voice.peers.get(id).gain.gain.value, B.id);
  ok(muted.gain < 0.01 && muted.set.includes(B.id) && unmuted > 0.99, 'mute(id) silences one voice locally, unmute brings it back', `muted gain ${muted.gain.toFixed(4)}, set ${JSON.stringify(muted.set)}, unmuted ${unmuted.toFixed(3)}`);

  /* ---------------------------------------------------------------- 7 */
  console.log("\n7. voice off: bye 'off', and turning back on is an ask");
  a0 = await mark(A);
  b0 = await mark(B);
  await B.evaluate(() => window.T.settings.set('voiceMode', 'off'));
  const offClosed = await wait(A, (id) => !window.T.voice.peers.has(id), B.id, 3000);
  const bStatus = await B.evaluate(() => window.T.voice.status());
  la = (await log(A)).slice(a0);
  ok(offClosed && la.some((e) => e.dir === 'in' && e.kind === 'bye' && e.why === 'off') && bStatus === 'voice off', "bob switching off sends 'bye' (off); alice closes", `bob status "${bStatus}"`);
  a0 = await mark(A);
  b0 = await mark(B);
  await B.evaluate(() => window.T.settings.set('voiceMode', 'open'));
  const reconnected = await wait(B, (id) => window.T.voice.peers.get(id)?.pc.connectionState === 'connected', A.id, 15000);
  la = (await log(A)).slice(a0);
  lb = (await log(B)).slice(b0);
  ok(reconnected && lb.some((e) => e.dir === 'out' && e.kind === 'offer' && e.ask) && la.some((e) => e.dir === 'out' && e.kind === 'offer' && !e.ask),
    'bob (higher id) back on asks; alice calls; connected again inside her 30 s back-off',
    `bob: ${lb.filter((e) => e.kind === 'offer').map((e) => `${e.dir}:${e.ask ? 'ask' : 'offer'}`).join(',')}; alice: ${la.filter((e) => e.kind === 'offer').map((e) => `${e.dir}:${e.ask ? 'ask' : 'offer'}`).join(',')}`);

  /* --------------------------------------------------------------- 7b */
  console.log('\n7b. death: bob types /kill, everyone hangs up on him; he respawns and is heard again');
  a0 = await mark(A);
  b0 = await mark(B);
  const tKill = Date.now();
  await B.evaluate(() => window.T.session.net.send({ t: 'chat', text: '/kill' }));
  const deadA = await wait(A, (id) => !window.T.voice.peers.has(id), B.id, 3000);
  const deadB = await wait(B, (id) => !window.T.voice.peers.has(id), A.id, 3000);
  const deadStatus = await B.evaluate(() => window.T.voice.status());
  const dropA = await A.evaluate((id) => window.T.events.filter((e) => e.type === 'drop' && e.id === id).pop()?.why, B.id);
  ok(deadA && deadB && dropA === 'dead' && deadStatus === 'voice back when you respawn', 'both sides close at once on the death',
    `${Date.now() - tKill} ms; alice drop reason "${dropA}"; bob status "${deadStatus}"`);
  await sleep(3000);
  la = (await log(A)).slice(a0);
  lb = (await log(B)).slice(b0);
  ok(![...la, ...lb].some((e) => e.dir === 'out' && e.kind === 'offer'), 'and nobody calls a dead player (3 s)',
    [...la, ...lb].filter((e) => e.dir === 'out').map((e) => `${e.kind}:${e.why ?? ''}`).join(', '));
  const tRespawn = Date.now();
  await B.evaluate(() => window.T.session.net.send({ t: 'respawn' }));
  const alive = await wait(A, (id) => window.T.voice.peers.get(id)?.pc.connectionState === 'connected', B.id, 15000);
  ok(alive, 'respawned: connected again', `${Date.now() - tRespawn} ms after the respawn (alice's 4 s retry back-off from the drop runs from the death)`);

  /* ---------------------------------------------------------------- 8 */
  console.log('\n8. mic refused: listen only, then the mic arrives and the call renegotiates');
  const C = await openPage('carol', { deny: true });
  console.log(`carol id ${C.id}`);
  for (const p of [A, B]) await wait(p, (id) => window.T.others.has(id), C.id);
  const cConn = await wait(C, (id) => window.T.voice.peers.get(id)?.pc.connectionState === 'connected', A.id, 20000);
  await sleep(2500);
  const cStatus = await C.evaluate(() => window.T.voice.status());
  const cs = await stats(C);
  const ac = (await stats(A))[C.id];
  ok(cConn && /^mic blocked — listening to [12]$/.test(cStatus), 'carol, mic refused, connects listen-only', `status "${cStatus}"`);
  ok(cs[A.id].inPackets > 50 && ac.inPackets === 0 && ac.direction === 'sendonly', 'carol hears alice; alice receives nothing from carol (sendonly)',
    `carol in ${cs[A.id].inPackets} packets; alice in ${ac.inPackets}, alice direction ${ac.direction}`);
  const c0 = (await log(C)).length;
  const a1 = (await log(A)).length;
  await C.evaluate(() => {
    window.T.restoreMic();
    window.T.voice.retryMic();
  });
  const live = await wait(C, () => window.T.voice.micState === 'live', null, 5000);
  const reneg = await wait(A, (id) => window.T.voice.peers.get(id)?.track != null, C.id, 10000);
  await sleep(2500);
  const lc = (await log(C)).slice(c0);
  const la1 = (await log(A)).slice(a1);
  const ac2 = (await stats(A))[C.id];
  const cidC = cs[A.id].cid;
  ok(live && reneg && lc.some((e) => e.dir === 'out' && e.kind === 'offer' && e.cid === cidC && e.sendrecv === 'sendrecv') && la1.some((e) => e.dir === 'out' && e.kind === 'answer' && e.cid === cidC),
    'mic allowed later: carol (polite side) renegotiates the same connection, alice answers',
    lc.concat(la1).filter((e) => e.kind !== 'ice').map((e) => `${e.dir}:${e.kind}:${e.cid === cidC ? 'same-cid' : e.cid}:${e.sendrecv}`).join(', '));
  ok(ac2.inPackets > 50 && ac2.direction === 'sendrecv', 'and alice now receives carol', `alice in ${ac2.inPackets} packets, direction ${ac2.direction}`);
  const cStatus2 = await C.evaluate(() => window.T.voice.status());
  console.log(`   carol status now "${cStatus2}"`);

  /* --------------------------------------------------------------- 8c */
  console.log('\n8c. glare: alice and carol both renegotiate the same call at the same moment (restartIce on both, 250 ms simulated signalling latency)');
  {
    const ac0 = (await stats(A))[C.id];
    const ca0 = (await stats(C))[A.id];
    const aMark = await mark(A);
    const cMark = await mark(C);
    // Armed on both pages first, fired on the same wall-clock instant, so the
    // two offers are in flight past each other.
    await Promise.all([A, C].map((p) => p.evaluate(() => window.T.setLatency(250))));
    const at = Date.now() + 300;
    await Promise.all([
      A.evaluate(([id, t]) => setTimeout(() => window.T.voice.peers.get(id).pc.restartIce(), t - Date.now()), [C.id, at]),
      C.evaluate(([id, t]) => setTimeout(() => window.T.voice.peers.get(id).pc.restartIce(), t - Date.now()), [A.id, at]),
    ]);
    await sleep(3000);
    await Promise.all([A, C].map((p) => p.evaluate(() => window.T.setLatency(0))));
    await sleep(500);
    const seqA = (await log(A)).slice(aMark).filter((e) => (e.to === C.id || e.from === C.id) && e.kind !== 'ice');
    const seqC = (await log(C)).slice(cMark).filter((e) => (e.to === A.id || e.from === A.id) && e.kind !== 'ice');
    const fmt = (l) => l.map((e) => `${e.dir}:${e.kind}@${e.at}`).join(', ');
    console.log(`   alice: ${fmt(seqA)}`);
    console.log(`   carol: ${fmt(seqC)}`);
    const firstAnswerA = seqA.find((e) => e.dir === 'in' && e.kind === 'answer');
    const crossed = seqA.some((e) => e.dir === 'in' && e.kind === 'offer' && (!firstAnswerA || e.at < firstAnswerA.at))
      && seqA.some((e) => e.dir === 'out' && e.kind === 'offer');
    const ac1 = (await stats(A))[C.id];
    const ca1 = (await stats(C))[A.id];
    const states = await Promise.all([
      A.evaluate((id) => { const p = window.T.voice.peers.get(id); return p && `${p.cid}:${p.pc.signalingState}:${p.pc.connectionState}`; }, C.id),
      C.evaluate((id) => { const p = window.T.voice.peers.get(id); return p && `${p.cid}:${p.pc.signalingState}:${p.pc.connectionState}`; }, A.id),
    ]);
    ok(crossed, 'the two offers really did cross (alice received carol\'s offer before her own was answered)');
    ok(states[0] === states[1] && /:stable:connected$/.test(states[0]) && ac1.inPackets - ac0.inPackets > 50 && ca1.inPackets - ca0.inPackets > 50,
      'perfect negotiation settles it: same call, stable, connected, audio still flowing both ways',
      `${states.join(' | ')}; alice +${ac1.inPackets - ac0.inPackets} packets, carol +${ca1.inPackets - ca0.inPackets}`);
  }

  /* --------------------------------------------------------------- 8b */
  console.log('\n8b. a real browser refusal (permission denied through CDP), then allowed from the padlock: no retryMic() call');
  let E = null;
  try {
    // A browser of its own, without --use-fake-ui-for-media-stream: that flag
    // answers every microphone question with yes, a denied permission
    // included, so a refusal can only be real in a browser that asks.
    browser2 = await chromium.launch({
      executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${HERE}speech.wav`, '--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
    });
    const context = await browser2.newContext();
    E = await context.newPage();
    E.lines = [];
    E.on('console', (m) => E.lines.push(`[${m.type()}] ${m.text()}`));
    E.label = 'erin';
    const pageSession = await context.newCDPSession(E);
    const { targetInfo } = await pageSession.send('Target.getTargetInfo');
    const browserSession = await browser2.newBrowserCDPSession();
    const origin = `http://127.0.0.1:${httpPort}`;
    const setMic = (setting) => browserSession.send('Browser.setPermission', {
      permission: { name: 'microphone' }, setting, origin, browserContextId: targetInfo.browserContextId,
    });
    await setMic('denied');
    await E.goto(`${origin}/harness.html?name=erin&ws=${encodeURIComponent(wsUrl)}&mode=open`);
    await E.waitForFunction(() => window.T?.session?.you, null, { timeout: 15000 });
    E.id = await E.evaluate(() => window.T.session.you.id);
    console.log(`erin id ${E.id}`);
    const eConn = await wait(E, (id) => window.T.voice.peers.get(id)?.pc.connectionState === 'connected', A.id, 20000);
    const eBlocked = await E.evaluate(() => ({ mic: window.T.voice.micState, error: window.T.voice.micError, status: window.T.voice.status(), permission: window.T.voice.permission?.state ?? null }));
    ok(eConn && eBlocked.mic === 'blocked' && eBlocked.permission === 'denied' && /^mic blocked — listening to \d$/.test(eBlocked.status),
      'erin, refused for real, connects listen-only and watches the permission', JSON.stringify(eBlocked));
    const t1 = Date.now();
    await setMic('granted');
    const eLive = await wait(E, () => window.T.voice.micState === 'live', null, 5000);
    const heard = await wait(A, (id) => window.T.voice.peers.get(id)?.track != null, E.id, 10000);
    await sleep(2000);
    const ae = (await stats(A))[E.id];
    ok(eLive && heard && ae.inPackets > 30 && ae.direction === 'sendrecv', 'allowed: the mic goes live by itself and alice hears erin',
      `${Date.now() - t1} ms to live + heard; alice in ${ae.inPackets} packets, direction ${ae.direction}; erin status "${await E.evaluate(() => window.T.voice.status())}"`);
    // Blocked again from the padlock, mid-call: the browser ends the track.
    await setMic('denied');
    const reblocked = await wait(E, () => window.T.voice.micState === 'blocked', null, 5000);
    const eStatus = await E.evaluate(() => ({ mic: window.T.voice.micState, status: window.T.voice.status(), talking: window.T.voice.talking }));
    ok(reblocked && /^mic blocked — listening to \d$/.test(eStatus.status) && !eStatus.talking,
      'blocked again mid-call: reported as blocked (not missing), still listening', JSON.stringify(eStatus));
    await setMic('granted');
    const relive = await wait(E, () => window.T.voice.micState === 'live', null, 5000);
    ok(relive, 'and allowed once more: live again by itself', await E.evaluate(() => window.T.voice.status()));
    E.keepSession = browserSession;
  } catch (error) {
    ok(false, 'real permission refusal', error.message);
  }

  /* ---------------------------------------------------------------- 9 */
  console.log('\n9. insecure origin (plain http on the LAN address): no getUserMedia, listen only');
  let D = null;
  try {
    D = await openPage('dave', { host: LAN });
    const dConn = await wait(D, (id) => window.T.voice.peers.get(id)?.pc.connectionState === 'connected', A.id, 20000);
    await sleep(2000);
    const dInfo = await D.evaluate(() => ({ secure: window.isSecureContext, gum: !!navigator.mediaDevices?.getUserMedia, status: window.T.voice.status(), mic: window.T.voice.micState }));
    const ds = await stats(D);
    ok(dConn && !dInfo.secure && dInfo.mic === 'insecure' && /^mic needs https — listening to \d$/.test(dInfo.status) && ds[A.id].inPackets > 50,
      'dave on http://LAN: status says so, still hears alice', `${JSON.stringify(dInfo)}; in ${ds[A.id].inPackets} packets`);
  } catch (error) {
    ok(false, 'insecure-origin page', error.message);
  }

  /* --------------------------------------------------------------- 10 */
  console.log('\n10. counts and status strings');
  for (const p of [A, B, C, D, E].filter(Boolean)) {
    const info = await p.evaluate(() => {
      const v = window.T.voice;
      return { status: v.status(), connected: v.connected, peers: v.list().map((x) => `${x.name}:${x.state}`) };
    });
    console.log(`   ${p.label}: ${JSON.stringify(info)}`);
  }
  const statusesA = await A.evaluate(() => [...new Set(window.T.events.filter((e) => e.type === 'status').map((e) => e.s))]);
  console.log('   alice status strings seen:', JSON.stringify(statusesA));

  /* --------------------------------------------------------------- 11 */
  console.log('\n11. leaving: a page that closes its socket is dropped by everyone (server leave)');
  const n0 = await A.evaluate(() => window.T.voice.peers.size);
  await B.context().close();
  const leftA = await wait(A, (id) => !window.T.voice.peers.has(id), B.id, 5000);
  const dropWhy = await A.evaluate((id) => window.T.events.filter((e) => e.type === 'drop' && e.id === id).map((e) => e.why).pop(), B.id);
  ok(leftA, 'bob closing the tab drops him from alice', `alice had ${n0} peers; last drop reason "${dropWhy}"`);

  /* --------------------------------------------------------------- 11b */
  console.log('\n11b. changing world: frank joins, connects, then /travel moon');
  const F = await openPage('frank');
  console.log(`frank id ${F.id}`);
  const fConn = await wait(A, (id) => window.T.voice.peers.get(id)?.pc.connectionState === 'connected', F.id, 20000);
  ok(fConn, 'frank connected to alice');
  const a2 = await mark(A);
  const tTravel = Date.now();
  await F.evaluate(() => window.T.session.net.send({ t: 'chat', text: '/travel moon' }));
  const fGone = await wait(A, (id) => !window.T.voice.peers.has(id), F.id, 3000);
  const fWhy = await A.evaluate((id) => window.T.events.filter((e) => e.type === 'drop' && e.id === id).pop()?.why, F.id);
  const fBye = (await log(A)).slice(a2).filter((e) => e.kind === 'bye' && (e.to === F.id || e.from === F.id));
  ok(fGone && fWhy === 'world' && fBye.some((e) => e.dir === 'out' && e.why === 'world'), "alice drops him on the server's 'moved', with a 'bye' (world)",
    `${Date.now() - tTravel} ms; reason "${fWhy}"; ${JSON.stringify(fBye.map((e) => `${e.dir}:${e.why}`))}; frank travelled ${await F.evaluate(() => !!window.__travelled)}`);
  await sleep(3000);
  const offersToF = (await log(A)).slice(a2).filter((e) => e.dir === 'out' && e.kind === 'offer' && e.to === F.id).length;
  ok(offersToF === 0, 'and alice does not call him on the other world (3 s)', `${offersToF} offers`);

  /* --------------------------------------------------------------- 12 */
  console.log('\n12. dispose');
  const before = await C.evaluate(() => window.T.voice.peers.size);
  await A.evaluate(() => window.T.voice.dispose());
  const goneC = await wait(C, (id) => !window.T.voice.peers.has(id), A.id, 5000);
  const aAfter = await A.evaluate(() => ({ peers: window.T.voice.peers.size, ctx: window.T.voice.ctx, mic: window.T.voice.micTrack }));
  ok(goneC && aAfter.peers === 0 && aAfter.mic === null, "alice.dispose() closes every call with a 'bye' and releases the mic", `carol had ${before}, now without alice: ${goneC}`);

  for (const p of [A, C, D, E, F].filter(Boolean)) {
    const bad = p.lines.filter((l) => /\[(error|pageerror)\]/.test(l));
    console.log(`   ${p.label} console errors: ${bad.length ? bad.join(' | ') : 'none'}`);
    const warn = p.lines.filter((l) => /\[warning\]/.test(l));
    if (warn.length) console.log(`   ${p.label} console warnings: ${warn.slice(0, 5).join(' | ')}`);
  }
} catch (error) {
  console.error(error);
  failures++;
} finally {
  await browser.close();
  await browser2?.close();
  await game.stop();
  statik.close();
  rmSync(dataDir, { recursive: true, force: true });
  console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
  process.exit(failures ? 1 : 0);
}

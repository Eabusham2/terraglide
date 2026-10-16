// Test harness: a real NetClient against the real server, a minimal stand-in
// for OnlineSession around it, and the real ProximityVoice. Remote players are
// stubs whose pose.position the test moves by hand (local frame metres).
import * as THREE from '/vendor/three/three.module.js';
import { NetClient } from '/src/net/client.js';
import { ProximityVoice } from '/src/net/voice.js';
import { settings } from '/src/core/settings.js';
import { encodeState } from '/src/net/protocol.js';

const q = new URLSearchParams(location.search);
const name = q.get('name');
const server = q.get('ws');
const log = [];
const consoleLines = [];

// Mic denial, for the listen-only test: getUserMedia rejects as a refused
// permission prompt would, until the test restores it.
const realGUM = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
if (q.get('deny') === '1' && navigator.mediaDevices) {
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
}

const net = new NetClient(server);
// Simulated network latency for incoming signalling, so a test can make two
// offers really cross in flight (on loopback the relay takes a millisecond).
// A constant delay keeps the order.
let latency = 0;
const rawHandle = net.handle.bind(net);
net.handle = (m) => {
  if (m.t === 'voice' && latency > 0) setTimeout(() => rawHandle(m), latency);
  else rawHandle(m);
};
const rawSend = net.send.bind(net);
const summary = (m) => ({
  kind: m.kind,
  ask: !!m.data?.ask,
  cid: m.data?.cid ?? null,
  why: m.data?.why ?? null,
  candidates: Array.isArray(m.data?.c) ? m.data.c.length : 0,
  sdpBytes: typeof m.data?.sdp === 'string' ? m.data.sdp.length : 0,
  sendrecv: typeof m.data?.sdp === 'string' ? (/a=(sendrecv|recvonly|sendonly|inactive)/.exec(m.data.sdp)?.[1] ?? null) : null,
});
net.send = (m) => {
  if (m.t === 'voice') log.push({ at: Math.round(performance.now()), dir: 'out', to: m.to, ...summary(m) });
  return rawSend(m);
};
net.on('voice', (m) => log.push({ at: Math.round(performance.now()), dir: 'in', from: m.from, ...summary(m) }));

const others = new Map();
const remote = { list: () => [...others.values()], get: (id) => others.get(id) ?? null };
const session = { net, remote, you: null, iceServers: null, game: { player: { dead: false } }, talking: false };

function stub(entry) {
  let p = others.get(entry.id);
  if (!p) {
    p = {
      id: entry.id,
      name: entry.name,
      world: entry.world,
      dead: false,
      now: { lat: 0, lon: 0, alt: 0 },
      pose: { position: new THREE.Vector3(0, 0, -20), height: 1.8, eyeHeight: 1.7 },
      distance: 20,
    };
    others.set(entry.id, p);
  }
  p.world = entry.world;
  p.dead = !!entry.dead;
}
net.on('roster', (m) => { for (const e of m.players) if (e.id !== session.you?.id) stub(e); });
net.on('join', (m) => { if (m.p.id !== session.you?.id) stub(m.p); });
net.on('leave', (m) => others.delete(m.id));

let pos = null;
let seq = 0;
function sendState() {
  if (!pos || session.game.player.dead) return;
  net.send(encodeState({ seq: ++seq, lat: pos.lat, lon: pos.lon, alt: 5, agl: 0, vel: [0, 0, 0], yaw: 0, pitch: 0, roll: 0, flags: 1 | (session.talking ? 256 : 0), item: 0 }));
}
net.on('needsAuth', () => net.signup(name, `password-${name}`));
net.on('auth', (m) => {
  if (!m.ok) {
    window.__authError = m.error;
    return;
  }
  session.you = m.you;
  session.iceServers = m.iceServers;
  pos = m.pos ?? m.spawn;
  net.send({ t: 'arrived', tid: 0 });
  sendState();
});
setInterval(sendState, 250);

// What OnlineSession and RemotePlayers do with the same messages, in the same
// order relative to the voice (these are bound before it is constructed, as
// the session's are in the game).
net.on('died', () => {
  session.game.player.dead = true;
});
net.on('teleport', (m) => {
  if (m.reason === 'respawn') session.game.player.dead = false;
  pos = { lat: m.lat, lon: m.lon };
  net.send({ t: 'arrived', tid: m.tid });
  sendState();
});
net.on('dead', (m) => {
  const p = others.get(m.id);
  if (p) p.dead = true;
});
net.on('alive', (m) => {
  const p = others.get(m.id);
  if (p) p.dead = false;
});
net.on('moved', (m) => {
  const p = others.get(m.id);
  if (p) p.world = m.world;
});
// The game reloads the page for another world; the nearest thing here is to
// finish with the voice.
net.on('travelled', () => {
  window.__travelled = true;
  window.T.voice.dispose();
});

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 5000);
scene.add(camera);
camera.position.set(0, 1.7, 0);
camera.updateMatrixWorld();

settings.set('voiceVolume', 0.9);
settings.set('voiceMode', q.get('mode') ?? 'open');
const voice = new ProximityVoice({ session });
const events = [];
voice.on('status', (s) => events.push({ at: Math.round(performance.now()), type: 'status', s }));
voice.on('drop', (d) => events.push({ at: Math.round(performance.now()), type: 'drop', ...d }));
voice.on('talking', (on) => events.push({ at: Math.round(performance.now()), type: 'talking', on }));
setInterval(() => voice.update(camera), 16);
net.connect();

const buf = new Float32Array(1024);
const rms = (a) => {
  a.getFloatTimeDomainData(buf);
  let s = 0;
  for (const v of buf) s += v * v;
  return Math.sqrt(s / buf.length);
};

window.T = {
  voice,
  session,
  others,
  camera,
  settings,
  log,
  events,
  consoleLines,
  THREE,
  setLatency(ms) {
    latency = ms;
  },
  restoreMic() {
    navigator.mediaDevices.getUserMedia = realGUM;
  },
  place(id, x, y, z) {
    const p = others.get(id);
    p.pose.position.set(x, y, z);
    p.distance = Math.hypot(x, y, z);
  },
  face(yaw) {
    camera.rotation.set(0, yaw, 0);
    camera.updateMatrixWorld();
  },
  async stats() {
    const out = {};
    for (const [id, peer] of voice.peers) {
      const s = {
        state: peer.pc.connectionState,
        cid: peer.cid,
        polite: peer.polite,
        direction: peer.pc.getTransceivers()[0]?.currentDirection ?? null,
        inPackets: 0,
        inBytes: 0,
        outPackets: 0,
        track: !!peer.track,
        level: peer.level,
        talking: peer.talking,
        distance: peer.distance,
        gain: peer.gain ? peer.gain.gain.value : null,
        panner: peer.panner ? [peer.panner.positionX.value, peer.panner.positionY.value, peer.panner.positionZ.value] : null,
        pannerModel: peer.panner ? [peer.panner.panningModel, peer.panner.distanceModel, peer.panner.refDistance, peer.panner.maxDistance, peer.panner.rolloffFactor] : null,
      };
      const report = await peer.pc.getStats();
      report.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio') {
          s.inPackets += r.packetsReceived;
          s.inBytes += r.bytesReceived;
        }
        if (r.type === 'outbound-rtp' && r.kind === 'audio') s.outPackets += r.packetsSent;
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') s.pair = true;
      });
      out[id] = s;
    }
    return out;
  },
  /**
   * Energy before the panner (the peer's own analyser) and after it, left and
   * right, summed over the same window: the ratio is what the panner did.
   */
  async measure(id, ms = 2500) {
    const peer = voice.peers.get(id);
    const ctx = voice.ctx;
    const split = ctx.createChannelSplitter(2);
    const aL = ctx.createAnalyser();
    const aR = ctx.createAnalyser();
    aL.fftSize = 1024;
    aR.fftSize = 1024;
    const zero = ctx.createGain();
    zero.gain.value = 0;
    peer.panner.connect(split);
    split.connect(aL, 0);
    split.connect(aR, 1);
    aL.connect(zero);
    aR.connect(zero);
    zero.connect(ctx.destination);
    let pre = 0;
    let L = 0;
    let R = 0;
    let n = 0;
    // Interaural time difference: cross-correlate the two ears over +-48
    // samples (a head is about 0.7 ms across, ~33 samples at 48 kHz). Both
    // analysers are read in the same task, so they hold the same render
    // quanta and the lag between them is the panner's, not the harness's.
    const MAXLAG = 48;
    const bl = new Float32Array(1024);
    const br = new Float32Array(1024);
    const xc = new Float64Array(2 * MAXLAG + 1);
    const end = performance.now() + ms;
    while (performance.now() < end) {
      await new Promise((r) => setTimeout(r, 20));
      pre += rms(peer.analyser);
      L += rms(aL);
      R += rms(aR);
      aL.getFloatTimeDomainData(bl);
      aR.getFloatTimeDomainData(br);
      for (let lag = -MAXLAG; lag <= MAXLAG; lag++) {
        let sum = 0;
        for (let i = MAXLAG; i < 1024 - MAXLAG; i++) sum += bl[i] * br[i + lag];
        xc[lag + MAXLAG] += sum;
      }
      n++;
    }
    let best = 0;
    for (let i = 1; i < xc.length; i++) if (xc[i] > xc[best]) best = i;
    // bl[i] ~ br[i + lag] at the peak: a negative lag means the right ear
    // hears it first. Reported as "right ear leads by", in samples.
    const rightLeads = -(best - MAXLAG);
    peer.panner.disconnect(split);
    split.disconnect();
    zero.disconnect();
    return {
      samples: n, pre: pre / n, L: L / n, R: R / n, gainL: L / pre, gainR: R / pre, distance: peer.distance,
      rightLeads, rightLeadsMs: (rightLeads / ctx.sampleRate) * 1000, sampleRate: ctx.sampleRate,
    };
  },
};
document.getElementById('out').textContent = `ready ${name}`;

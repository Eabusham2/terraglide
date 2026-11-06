import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { WORLD_RADIUS } from '../geo/mercator.js';
import { Avatar } from '../player/avatar.js';
import { RocketTrail } from '../player/effects.js';
import { HOTBAR } from '../player/player.js';
import { FLAG, readSnapshotRow } from './protocol.js';

/**
 * Everybody else, in the world.
 *
 * Each remote player is drawn with the same figure you are — the built body,
 * the same wings, the same arms reaching out in a dive — driven by what the
 * server says rather than by a controller. With the scanned body on (Settings
 * → Player) the nearest of them are drawn as it too, with the generated sword
 * and firework in its hand and the same swing: see SCAN_NEAR_M. On the built
 * body their jacket and their wings are their colour, so the dot on the map,
 * the name over their head, the line they leave on the map and the shape
 * crossing the sky are recognisably one person; the scan is a photograph and
 * the same for everybody, so there the name tag says who it is.
 *
 * Positions arrive ten times a second and the screen draws sixty, so nobody
 * is drawn where they are: they are drawn where they were a tenth of a second
 * ago, between the two updates either side of that moment. That is the price
 * of smooth movement, and it is the same one every online game pays. When the
 * next update is late they carry on along their velocity for a moment rather
 * than freezing.
 */

/**
 * How near somebody has to come before they are drawn with the scanned body,
 * when you have it on, and how many at once. Each one is the scan loaded
 * again - a couple of megabytes of picture on the graphics card - so it is
 * the people you are actually near, not everybody on the server.
 */
const SCAN_NEAR_M = 400;
const MAX_SCANNED = 6;
/** How long somebody holds a scan once they are no longer among the nearest. */
const SCAN_RELEASE_MS = 8000;
/** How often who gets the scan is worked out again. */
const SCAN_CHOOSE_MS = 500;
/** When every slot is taken, a newcomer has to be this much nearer than the furthest holder. */
const SCAN_SWAP_SHARE = 0.85;
const SCAN_SWAP_M = 30;
/** The settings that decide which body and which kit are drawn. */
const BODY_SETTINGS = ['detailedPlayerModel', 'detailedRocketModel'];

/** How far behind the newest update everyone is drawn, milliseconds. */
const INTERP_MS = 120;
/** How far past the newest update a late player is carried on, milliseconds. */
const EXTRAPOLATE_MS = 300;
/** Beyond this there is nothing to draw but a name, metres. */
const DRAW_M = 4000;
/** Name tags are shown out to here. Past it, the locator bar does the job. */
const TAG_M = 1500;
/** How far off a party member's name still shows, metres. */
const PARTY_TAG_M = 50000;
const DEG = Math.PI / 180;

/**
 * What the avatar reads off a player, for somebody who is not here.
 *
 * Quacks like Player as far as Avatar and RocketTrail are concerned — the
 * fields they read and nothing else — so the figure is drawn by exactly the
 * same code that draws you.
 */
class RemotePose {
  constructor() {
    this.position = new THREE.Vector3();
    this.renderPosition = this.position;
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.mode = 'walk';
    this.onGround = true;
    this.elytraDeployed = false;
    this.swimming = false;
    this.groundSlope = 0;
    this.groundBank = 0;
    this.rocketsFired = 0;
    this.rocketDuration = 1;
    this.rocketTicksLeft = 0;
    this.selectedSlot = 0;
    this.speedActive = false;
    this.swings = 0;
    this.height = 1.8288;
    this.scale = 1;
  }

  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get eyeHeight() {
    return this.height * 0.94;
  }
}

/**
 * A player as the server describes them, made safe to draw: the id a number,
 * the name and world plain short strings, the colour a colour. The page can
 * be pointed at any server, so nothing it sends goes into the page as it is.
 */
export function cleanPlayer(entry) {
  const id = Number(entry?.id);
  if (!Number.isSafeInteger(id)) return null;
  return {
    id,
    name: String(entry.name ?? '').slice(0, 32),
    colour: cleanColour(entry.colour),
    world: String(entry.world ?? '').slice(0, 24),
    admin: !!entry.admin,
    dead: !!entry.dead,
  };
}

export function cleanColour(colour) {
  return typeof colour === 'string' && /^#[0-9a-f]{3,8}$/i.test(colour) ? colour : '#9aa4b2';
}

/**
 * Free what a figure loaded of the scan: the pictures are its own, loaded for
 * it alone. (Its built body's go too, in dropAvatar, when the figure does.)
 */
function disposeScan(avatar) {
  for (const loaded of [avatar.model, avatar.rocketModel, avatar.swordModel]) {
    loaded?.traverse((o) => {
      o.geometry?.dispose?.();
      disposeMaterials(o);
    });
  }
}

/** A mesh's materials and the pictures on them. */
function disposeMaterials(o) {
  for (const material of [o.material].flat().filter(Boolean)) {
    for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
    material.dispose();
  }
}

export class RemotePlayers {
  /**
   * @param {object} deps
   * @param {THREE.Scene} deps.scene
   * @param {object} deps.shared the shared uniform block
   * @param {import('../geo/frame.js').LocalFrame} deps.frame
   * @param {HTMLElement} deps.ui where name tags go
   * @param {() => number} deps.serverNow
   */
  constructor({ scene, shared, frame, ui, serverNow }) {
    this.scene = scene;
    this.shared = shared;
    this.frame = frame;
    this.serverNow = serverNow;
    /** id -> { id, name, colour, world, snapshots, pose, avatar, trail, tag, ... } */
    this.players = new Map();
    this.tags = document.createElement('div');
    this.tags.className = 'nametags';
    ui.appendChild(this.tags);
    this._v = new THREE.Vector3();
    /** How many figures have the scan loaded, against MAX_SCANNED. */
    this.scanned = 0;
    // Switching the body or the firework over switches everybody's, as it
    // does yours: what is loaded shows or hides, and the update loop loads
    // the scan for whoever is near and does not have it yet.
    this.onSetting = ({ key }) => {
      if (!BODY_SETTINGS.includes(key)) return;
      for (const p of this.players.values()) {
        this.applyBody(p);
        // Switched on: whatever this figure did not load while it was off.
        if (p.scanAsked) this.requestScan(p);
      }
      this.chosenAt = 0;
    };
    settings.on('change', this.onSetting);
  }

  /** Show the scanned body and kit, or the built ones, as your settings say. */
  applyBody(p) {
    if (!p.avatar) return;
    p.avatar.applyModelMode();
    p.avatar.applyRocketModel();
    p.avatar.applySwordModel();
  }

  /**
   * The scan for somebody near, the first time they are. Loading is the
   * avatar's own (loadModel and the rest), which checks the settings itself
   * and does nothing in the single file, where there are no scanned assets.
   */
  loadScan(p) {
    if (!p.avatar || p.scanAsked || this.scanned >= MAX_SCANNED) return;
    if (!settings.get('detailedPlayerModel') && !settings.get('detailedRocketModel')) return;
    p.scanAsked = true;
    this.scanned += 1;
    this.requestScan(p);
  }

  /** The three loads, each of which does nothing when it is done already. */
  requestScan(p) {
    const avatar = p.avatar;
    if (!avatar) return;
    const shown = () => {
      if (p.avatar === avatar && this.players.get(p.id) === p) {
        this.applyBody(p);
        // Its materials join the hurt flash, which was collected before the
        // scan arrived: a hit on a scanned figure flashed nothing.
        this.paint(p);
      } else {
        // Let go of while it was loading: what it loaded goes with it.
        disposeScan(avatar);
      }
    };
    avatar.loadModel().then(shown);
    avatar.loadRocketModel().then(shown);
    avatar.loadSwordModel().then(shown);
  }

  /**
   * Who gets the scan: the nearest MAX_SCANNED within SCAN_NEAR_M, worked out
   * again as people move. It used to be the first six to come near, kept
   * until they left the server - six figures two kilometres off held every
   * slot while somebody beside you was drawn plain.
   *
   * Somebody who has drifted out of range keeps the scan a few seconds, so a
   * figure at the edge does not flicker between bodies, then gives it up:
   * rebuilt plain, the scan freed. When every slot is taken a newcomer gets
   * one only by being clearly nearer than the furthest holder - two people at
   * 199 and 201 metres swapping places every second rebuilt both, and
   * reloaded seven megabytes of scan, every second.
   */
  chooseScanned(now) {
    if (now - (this.chosenAt ?? 0) < SCAN_CHOOSE_MS) return;
    this.chosenAt = now;
    const wanted = !!settings.get('detailedPlayerModel') || !!settings.get('detailedRocketModel');
    for (const p of this.players.values()) {
      if (!p.scanAsked) continue;
      const near = wanted && p.avatar && p.visible && p.distance < SCAN_NEAR_M;
      if (near) {
        p.scanOutSince = null;
        continue;
      }
      p.scanOutSince ??= now;
      if (!wanted || now - p.scanOutSince > SCAN_RELEASE_MS) this.dropAvatar(p);
    }
    if (!wanted) return;
    const waiting = [...this.players.values()]
      .filter((p) => !p.scanAsked && p.avatar && p.visible && p.distance < SCAN_NEAR_M)
      .sort((a, b) => a.distance - b.distance);
    for (const p of waiting) {
      if (this.scanned >= MAX_SCANNED) {
        const holders = [...this.players.values()].filter((q) => q.scanAsked);
        const furthest = holders.reduce((a, b) => (b.distance > a.distance ? b : a), holders[0]);
        if (!furthest || p.distance > furthest.distance * SCAN_SWAP_SHARE - SCAN_SWAP_M) break;
        this.dropAvatar(furthest);
      }
      this.loadScan(p);
    }
  }

  /** Take a figure out of the world and free what it holds; the next frame builds a plain one. */
  dropAvatar(p) {
    if (p.avatar) {
      p.avatar.root.parent?.remove(p.avatar.root);
      disposeScan(p.avatar);
      // Its own materials too: every figure is built with materials of its
      // own (Avatar's mat()), coloured for its player, and a rebuild left
      // them all behind.
      p.avatar.root.traverse((o) => {
        o.geometry?.dispose?.();
        disposeMaterials(o);
      });
    }
    // The sparks with it, or they hung in the sky where it was, frozen.
    p.trail?.dispose();
    p.trail = null;
    p.avatar = null;
    p.visible = false;
    p.materials = [];
    if (p.scanAsked) this.scanned = Math.max(0, this.scanned - 1);
    p.scanAsked = false;
    p.scanOutSince = null;
  }

  /** Someone is online. Called from the roster; idempotent. */
  upsert(raw) {
    const entry = cleanPlayer(raw);
    if (!entry) return null;
    let p = this.players.get(entry.id);
    if (p && p.name !== entry.name) {
      // A new account behind an old number: none of the old one's motion.
      p.snapshots.length = 0;
    }
    if (!p) {
      p = {
        id: entry.id,
        snapshots: [],
        pose: new RemotePose(),
        avatar: null,
        trail: null,
        tag: null,
        hurtUntil: 0,
        lastSwingBit: 0,
        lastRocket: false,
        visible: false,
      };
      this.players.set(entry.id, p);
    }
    p.name = entry.name;
    p.colour = entry.colour;
    p.world = entry.world;
    p.admin = !!entry.admin;
    p.dead = !!entry.dead;
    if (p.avatar) this.paint(p);
    return p;
  }

  /** Everyone not in `ids` has gone: what a fresh roster says. */
  keepOnly(ids) {
    const keep = new Set(ids);
    for (const id of [...this.players.keys()]) if (!keep.has(id)) this.remove(id);
  }

  remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.dropAvatar(p);
    p.trail?.dispose();
    p.tag?.remove();
  }

  clear() {
    for (const id of [...this.players.keys()]) this.remove(id);
  }

  get(id) {
    return this.players.get(id) ?? null;
  }

  byName(name) {
    const wanted = String(name).toLowerCase();
    for (const p of this.players.values()) if (p.name.toLowerCase() === wanted) return p;
    return null;
  }

  /** A snapshot arrived: one row per player the server thought we should hear about. */
  snapshot(serverTime, rows) {
    for (const raw of rows) {
      const row = readSnapshotRow(raw);
      if (!row) continue;
      const p = this.players.get(row.id);
      if (!p) continue;
      row.t = serverTime;
      const list = p.snapshots;
      // Out-of-order or duplicate updates are dropped rather than sorted in:
      // TCP delivers in order, so one arriving late is a stale resend.
      if (list.length && list[list.length - 1].t >= serverTime) continue;
      list.push(row);
      // Two seconds is plenty to interpolate across.
      while (list.length > 2 && serverTime - list[0].t > 2000) list.shift();
      p.health = row.health;
      p.dead = !!(row.flags & FLAG.dead);
      // Speaking, by the speaker's own account — so a name tag can say so
      // even before (or without) a voice connection to them.
      p.talking = !!(row.flags & FLAG.talking);
      if (row.flags & FLAG.hurt) p.hurtUntil = performance.now() + 350;
      p.lastHeard = performance.now();
    }
  }

  /** A hit landed on someone: flash them red, the way Minecraft does. */
  flash(id) {
    const p = this.players.get(id);
    if (p) p.hurtUntil = performance.now() + 350;
  }

  /**
   * Where everyone is right now, interpolated, in the local frame.
   * Also the list the maps, the compass and the locator bar read.
   */
  sample(p) {
    const list = p.snapshots;
    if (!list.length) return null;
    const t = this.serverNow() - INTERP_MS;
    let a = list[0];
    let b = null;
    for (let i = 1; i < list.length; i++) {
      if (list[i].t >= t) {
        a = list[i - 1];
        b = list[i];
        break;
      }
      a = list[i];
    }
    if (b && b.t > a.t) {
      const f = clamp((t - a.t) / (b.t - a.t), 0, 1);
      return {
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + wrapDelta(b.lon - a.lon) * f,
        alt: a.alt + (b.alt - a.alt) * f,
        yaw: a.yaw + wrapAngle(b.yaw - a.yaw) * f,
        pitch: a.pitch + (b.pitch - a.pitch) * f,
        roll: a.roll + wrapAngle(b.roll - a.roll) * f,
        vel: b.vel,
        flags: b.flags,
        item: b.item,
      };
    }
    // Past the newest: carry on along the velocity, for a little while.
    const ahead = clamp(t - a.t, 0, EXTRAPOLATE_MS) / 1000;
    const north = a.vel[2] * ahead;
    const east = a.vel[0] * ahead;
    return {
      lat: a.lat + (north / WORLD_RADIUS) / DEG,
      lon: a.lon + (east / (WORLD_RADIUS * Math.cos(a.lat * DEG))) / DEG,
      alt: a.alt + a.vel[1] * ahead,
      yaw: a.yaw,
      pitch: a.pitch,
      roll: a.roll,
      vel: a.vel,
      flags: a.flags,
      item: a.item,
    };
  }

  /**
   * Per frame: place and pose every figure, and move the name tags.
   *
   * @param {THREE.Camera} camera
   * @param {number} dt
   * @param {string} world the world this page is on
   * @param {number} rebaseX the local frame's shift this frame, for the spark trails
   * @param {number} rebaseZ
   */
  update(camera, dt, world, rebaseX = 0, rebaseZ = 0) {
    const width = globalThis.innerWidth || 1;
    const height = globalThis.innerHeight || 1;
    const curvature = this.shared?.uCurvature?.value ?? 1;
    this.camX = camera.position.x;
    this.camZ = camera.position.z;
    for (const p of this.players.values()) {
      const here = p.world === world;
      const s = here ? this.sample(p) : null;
      p.now = s;
      if (!s || p.dead) {
        this.hide(p);
        continue;
      }
      const at = this.frame.toWorld(s.lat, s.lon, this._v);
      const d = Math.hypot(at.x - camera.position.x, at.z - camera.position.z);
      p.distance = Math.hypot(d, s.alt - camera.position.y);
      // The ground is bent down by the planet's curvature in the shader; a
      // figure standing on it has to come down with it, or a friend a few
      // kilometres off floats above the hill they are standing on.
      const drop = curvature * (d * d) / (2 * WORLD_RADIUS);
      const pose = p.pose;
      pose.position.set(at.x, s.alt - drop, at.z);
      // East, up, north, into the frame: +X east, +Y up, -Z north.
      pose.velocity.set(s.vel[0], s.vel[1], -s.vel[2]);
      pose.yaw = s.yaw;
      pose.pitch = s.pitch;
      pose.roll = s.roll;
      pose.onGround = !!(s.flags & FLAG.ground);
      pose.elytraDeployed = !!(s.flags & FLAG.elytra);
      pose.swimming = !!(s.flags & FLAG.swim);
      pose.speedActive = !!(s.flags & FLAG.surge);
      pose.mode = pose.elytraDeployed && !pose.onGround ? 'glide' : pose.onGround ? 'walk' : 'fall';
      const rocket = !!(s.flags & FLAG.rocket);
      if (rocket && !p.lastRocket) pose.rocketsFired += 1;
      p.lastRocket = rocket;
      pose.rocketTicksLeft = rocket ? 1 : 0;
      pose.selectedSlot = s.item;
      if (s.item < HOTBAR.length) pose.rocketDuration = s.item + 1;
      const swingBit = s.flags & FLAG.swing;
      if (swingBit !== p.lastSwingBit) pose.swings += 1;
      p.lastSwingBit = swingBit;

      if (p.distance > DRAW_M) {
        this.hide(p);
      } else {
        this.show(p);
        p.avatar.update(pose, dt, camera);
        this.tint(p);
        p.trail.update(pose, dt, rebaseX, rebaseZ);
      }
      this.placeTag(p, camera, width, height, pose);
    }
    this.chooseScanned(performance.now());
  }

  show(p) {
    if (!p.avatar) {
      p.avatar = new Avatar(this.scene, this.shared);
      p.avatar.loadTextures();
      p.avatar.root.name = `player:${p.name}`;
      p.avatar.rollSource = () => p.pose.roll;
      // Rebuilt, it starts where the pose already is: a fresh figure counted
      // swings and rockets from nought and played one it never made.
      p.avatar.lastSwings = p.pose.swings ?? 0;
      p.avatar.lastRockets = p.pose.rocketsFired ?? 0;
      p.avatar.firedCount = p.pose.rocketsFired ?? 0;
      p.trail ??= new RocketTrail(this.scene);
      this.paint(p);
    }
    if (!p.visible) {
      p.avatar.setVisible(true);
      p.avatar.setFirstPerson(false);
      p.visible = true;
    }
  }

  hide(p) {
    if (p.visible && p.avatar) p.avatar.setVisible(false);
    // Their sparks go with them: hidden, the trail stops being aged, and a
    // player killed mid-firework, or gone to another world, left eleven
    // sparks hanging in the sky at full brightness until they came back.
    if (p.visible) p.trail?.clear();
    p.visible = false;
    if (p.tag) p.tag.hidden = true;
  }

  /** Their colour on their jacket and their wings. */
  paint(p) {
    // Mid-flash, put the red back first: what is read below is taken as how
    // the figure looks at rest, and a repaint during a hit kept it red.
    if (p.flashing) {
      for (const { material, emissive } of p.materials ?? []) material.emissive.copy(emissive);
      p.flashing = false;
    }
    const colour = new THREE.Color(p.colour);
    const cloth = p.avatar.cloth;
    for (const material of [...cloth.jacket, ...cloth.wing]) {
      material.color.copy(colour);
      material.emissive?.copy(colour).multiplyScalar(0.18);
    }
    p.materials = [];
    p.avatar.root.traverse((o) => {
      if (o.material && o.material.emissive) {
        p.materials.push({ material: o.material, emissive: o.material.emissive.clone() });
      }
    });
    p.flashing = false;
  }

  /** Red while hurt, then back to what they were. */
  tint(p) {
    const hurt = performance.now() < p.hurtUntil;
    if (hurt === p.flashing) return;
    p.flashing = hurt;
    for (const { material, emissive } of p.materials ?? []) {
      if (hurt) material.emissive.setRGB(0.65, 0.05, 0.05);
      else material.emissive.copy(emissive);
    }
  }

  placeTag(p, camera, width, height, pose) {
    // Your party's names show from much further off: finding each other is
    // the point of being in one.
    const party = !!this.isParty?.(p);
    const range = party ? PARTY_TAG_M : TAG_M;
    if (!settings.get('showNametags') || p.distance > range) {
      if (p.tag) p.tag.hidden = true;
      return;
    }
    if (!p.tag) {
      p.tag = document.createElement('div');
      p.tag.className = 'nametag';
      p.tag.innerHTML = '<span class="nametag-name"></span><span class="nametag-hearts"></span>';
      this.tags.appendChild(p.tag);
    }
    const head = this._v.set(pose.position.x, pose.position.y + pose.height * 1.12, pose.position.z);
    head.project(camera);
    if (head.z > 1 || head.z < -1) {
      p.tag.hidden = true;
      return;
    }
    p.tag.hidden = false;
    p.tag.style.transform = `translate(${((head.x + 1) / 2) * width}px, ${((1 - head.y) / 2) * height}px) translate(-50%, -100%)`;
    p.tag.style.setProperty('--player', p.colour);
    p.tag.classList.toggle('talking', !!p.talking && !p.dead);
    p.tag.classList.toggle('party', party);
    p.tag.style.opacity = String(clamp(1.15 - p.distance / range, 0.35, 1));
    const name = p.tag.firstChild;
    if (name.textContent !== p.name) name.textContent = p.name;
    // A heart drawn by the stylesheet and a count beside it: the heart glyph
    // itself is one a minimal font set does not have.
    const hearts = String(Math.ceil((p.health ?? 20) / 2));
    const heartNode = p.tag.lastChild;
    if (heartNode.textContent !== hearts) heartNode.textContent = hearts;
  }

  /** Everyone, for the maps, the compass, the locator bar and the players panel. */
  list() {
    return [...this.players.values()];
  }
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function wrapDelta(d) {
  if (d > 180) return d - 360;
  if (d < -180) return d + 360;
  return d;
}

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
 * server says rather than by a controller. Their jacket and their wings are
 * their colour, so the dot on the map, the name over their head, the line
 * they leave on the map and the shape crossing the sky are recognisably one
 * person.
 *
 * Positions arrive ten times a second and the screen draws sixty, so nobody
 * is drawn where they are: they are drawn where they were a tenth of a second
 * ago, between the two updates either side of that moment. That is the price
 * of smooth movement, and it is the same one every online game pays. When the
 * next update is late they carry on along their velocity for a moment rather
 * than freezing.
 */

/** How far behind the newest update everyone is drawn, milliseconds. */
const INTERP_MS = 120;
/** How far past the newest update a late player is carried on, milliseconds. */
const EXTRAPOLATE_MS = 300;
/** Beyond this there is nothing to draw but a name, metres. */
const DRAW_M = 4000;
/** Name tags are shown out to here. Past it, the locator bar does the job. */
const TAG_M = 1500;
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
  }

  /** Someone is online. Called from the roster; idempotent. */
  upsert(entry) {
    let p = this.players.get(entry.id);
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

  remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (p.avatar) {
      p.avatar.root.parent?.remove(p.avatar.root);
      p.avatar.root.traverse((o) => {
        o.geometry?.dispose?.();
      });
    }
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
  }

  show(p) {
    if (!p.avatar) {
      p.avatar = new Avatar(this.scene, this.shared);
      p.avatar.loadTextures();
      p.avatar.root.name = `player:${p.name}`;
      p.avatar.rollSource = () => p.pose.roll;
      p.trail = new RocketTrail(this.scene);
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
    p.visible = false;
    if (p.tag) p.tag.hidden = true;
  }

  /** Their colour on their jacket and their wings. */
  paint(p) {
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
    if (!settings.get('showNametags') || p.distance > TAG_M) {
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
    p.tag.style.opacity = String(clamp(1.15 - p.distance / TAG_M, 0.35, 1));
    const name = p.tag.firstChild;
    if (name.textContent !== p.name) name.textContent = p.name;
    const hearts = `${Math.ceil((p.health ?? 20) / 2)}♥`;
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
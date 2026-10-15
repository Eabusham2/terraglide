import * as THREE from '../../vendor/three/three.module.js';

/**
 * What stands at the two places off Earth where your suit refills: your
 * lander, wherever you last set it down, and the base at the landing site.
 *
 * The lander is drawn after the Apollo lunar module, because that is what a
 * lander looks like to almost everybody: a gold-foil descent stage on four
 * splayed legs, and a grey crew cabin on top. It is a model built from
 * boxes and cylinders, at the real thing's size — nine metres across the
 * footpads, seven high — and does not pretend to be anything more.
 *
 * The base is different on the Moon, because there it is real. Tranquility
 * Base is where Eagle's descent stage still stands, the cabin having flown
 * back up on 21 July 1969, so that is what is drawn there: the descent stage
 * alone, legs and foil. Everywhere else there is nothing at the landing site
 * but the game's own refill point, so it is drawn as what it is — a small
 * white shelter with a light on it, plainly a game's furniture.
 */

const DRAW_M = 6000;

function standard(colour, metal = 0.1, rough = 0.7) {
  return new THREE.MeshStandardMaterial({ color: colour, metalness: metal, roughness: rough });
}

const FOIL = standard(0xc49a3a, 0.65, 0.42);
const FOIL_DARK = standard(0x7d6127, 0.6, 0.5);
const CABIN = standard(0xb4b7ba, 0.25, 0.6);
const DARK = standard(0x1c1f24, 0.2, 0.4);
const STRUT = standard(0x9a9488, 0.5, 0.5);
const SHELTER = standard(0xe7e6e1, 0.05, 0.8);

/** The descent stage: an octagonal box on four legs. Origin at the ground. */
function descentStage() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 1.7, 8), FOIL);
  body.position.y = 2.15;
  body.rotation.y = Math.PI / 8;
  group.add(body);
  // The engine bell underneath.
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.75, 0.9, 16, 1, true), FOIL_DARK);
  bell.position.y = 0.95;
  group.add(bell);
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const top = new THREE.Vector3(Math.cos(angle) * 1.9, 2.6, Math.sin(angle) * 1.9);
    const foot = new THREE.Vector3(Math.cos(angle) * 4.2, 0.12, Math.sin(angle) * 4.2);
    group.add(strut(top, foot, 0.09));
    // The lower brace, from the bottom of the stage to halfway down the leg.
    const brace = new THREE.Vector3(Math.cos(angle) * 1.95, 1.4, Math.sin(angle) * 1.95);
    group.add(strut(brace, top.clone().lerp(foot, 0.62), 0.06));
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.12, 14), STRUT);
    pad.position.copy(foot).setY(0.06);
    group.add(pad);
  }
  return group;
}

/** The crew cabin: a boxy grey module with dark windows and a dish. */
function ascentStage() {
  const group = new THREE.Group();
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.3, 2.7), CABIN);
  cabin.position.y = 4.15;
  group.add(cabin);
  const front = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.3, 10, 1, false, -Math.PI / 2, Math.PI), CABIN);
  front.position.set(0, 4.15, 1.35);
  front.rotation.y = Math.PI / 2;
  group.add(front);
  for (const side of [-1, 1]) {
    const window_ = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.06), DARK);
    window_.position.set(side * 0.55, 4.7, 2.52);
    window_.rotation.y = side * 0.35;
    group.add(window_);
  }
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.35, 14), CABIN);
  hatch.position.y = 5.45;
  group.add(hatch);
  const mast = strut(new THREE.Vector3(1.0, 5.2, -0.9), new THREE.Vector3(1.5, 6.4, -1.4), 0.04);
  group.add(mast);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.1, 0.25, 16, 1, true), CABIN);
  dish.position.set(1.5, 6.5, -1.4);
  dish.rotation.x = -0.6;
  group.add(dish);
  return group;
}

function shelter() {
  const group = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 2.6, 24), SHELTER);
  drum.position.y = 1.3;
  group.add(drum);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.2, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), SHELTER);
  dome.position.y = 2.6;
  group.add(dome);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.3), DARK);
  door.position.set(0, 0.95, 3.3);
  group.add(door);
  return group;
}

/** A cylinder from a to b. */
function strut(a, b, radius) {
  const length = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 6), STRUT);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

export class Landers {
  /**
   * @param {{scene: THREE.Scene, terrain: object, frame: object, worldRadius: number, bodyId: string}} options
   */
  constructor({ scene, terrain, frame, worldRadius, bodyId }) {
    this.terrain = terrain;
    this.frame = frame;
    this.radius = worldRadius;
    this.group = new THREE.Group();
    this.group.name = 'landers';
    scene.add(this.group);

    this.lander = new THREE.Group();
    this.lander.add(descentStage(), ascentStage());
    this.base = new THREE.Group();
    this.base.add(bodyId === 'moon' ? descentStage() : shelter());
    // A light on the shelter, so it can be found at night.
    if (bodyId !== 'moon') {
      const lamp = new THREE.PointLight(0xffe3b0, 4, 40, 2);
      lamp.position.set(0, 6.5, 0);
      this.base.add(lamp);
    }
    this.group.add(this.lander, this.base);
    this.lander.visible = false;
    this.base.visible = false;
    this._world = { x: 0, z: 0 };
  }

  place(model, site, camera, yaw = 0) {
    if (!site) {
      model.visible = false;
      return;
    }
    this.frame.toWorld(site.lat, site.lon, this._world);
    const x = this._world.x;
    const z = this._world.z;
    const flat = Math.hypot(x - camera.position.x, z - camera.position.z);
    if (flat > DRAW_M || !this.terrain.hasElevationAt?.(x, z)) {
      model.visible = false;
      return;
    }
    // On the ground as drawn, which sinks away with the curve of the world.
    const drop = (flat * flat) / (2 * this.radius);
    model.position.set(x, this.terrain.heightAt(x, z) - drop, z);
    model.rotation.y = yaw;
    model.visible = true;
  }

  /**
   * @param {THREE.Camera} camera
   * @param {{lat:number, lon:number}|null} lander yours, if you have set one down
   * @param {{lat:number, lon:number}|null} base the landing site
   */
  update(camera, lander, base) {
    this.place(this.lander, lander, camera, 0.6);
    // Eagle's descent stage faces west, as it landed.
    this.place(this.base, base, camera, Math.PI / 2);
  }
}
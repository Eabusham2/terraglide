import * as THREE from '../../vendor/three/three.module.js';
import { clamp, damp, dampAngle } from '../core/math.js';

/**
 * The character you can see in third person and freecam: a plain figure with a
 * pair of elytra on its back. Deliberately simple — the world is the thing worth
 * looking at — but it animates enough to read what you are doing: legs swing
 * when you walk, arms sweep back and the wings open when you glide.
 *
 * Built at 1 metre tall and scaled to the player's height, so growing works for
 * free.
 */

const SKIN = 0xb9906f;
const JACKET = 0x53627a;
const TROUSERS = 0x3a4149;
const BOOTS = 0x23262b;
const WING = 0x8d9a86;
const WING_EDGE = 0x5f6a5b;

export class Avatar {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'avatar';
    scene.add(this.root);

    const body = new THREE.Group();
    this.body = body;
    this.root.add(body);

    const mat = (colour) => new THREE.MeshLambertMaterial({ color: colour });

    // Proportions as fractions of standing height.
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.15), mat(JACKET));
    this.torso.position.y = 0.66;
    body.add(this.torso);

    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.16, 0.15), mat(SKIN));
    this.head.position.y = 0.9;
    body.add(this.head);

    this.hair = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.16), mat(0x2f2a26));
    this.hair.position.y = 0.965;
    body.add(this.hair);

    this.armL = this.makeLimb(0.075, 0.3, mat(JACKET), -0.17, 0.79);
    this.armR = this.makeLimb(0.075, 0.3, mat(JACKET), 0.17, 0.79);
    this.legL = this.makeLimb(0.09, 0.36, mat(TROUSERS), -0.07, 0.51);
    this.legR = this.makeLimb(0.09, 0.36, mat(TROUSERS), 0.07, 0.51);
    body.add(this.armL.pivot, this.armR.pivot, this.legL.pivot, this.legR.pivot);

    const bootGeo = new THREE.BoxGeometry(0.1, 0.05, 0.14);
    this.bootL = new THREE.Mesh(bootGeo, mat(BOOTS));
    this.bootL.position.set(0, -0.34, 0.02);
    this.legL.limb.add(this.bootL);
    this.bootR = new THREE.Mesh(bootGeo, mat(BOOTS));
    this.bootR.position.set(0, -0.34, 0.02);
    this.legR.limb.add(this.bootR);

    this.wings = new THREE.Group();
    this.wings.position.set(0, 0.76, -0.08);
    body.add(this.wings);
    this.wingL = this.makeWing(mat(WING), mat(WING_EDGE), -1);
    this.wingR = this.makeWing(mat(WING), mat(WING_EDGE), 1);
    this.wings.add(this.wingL, this.wingR);

    this.walkPhase = 0;
    this.glideBlend = 0;
    this.visibleYaw = 0;
    this.root.visible = false;
  }

  makeLimb(width, length, material, x, y) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const limb = new THREE.Mesh(new THREE.BoxGeometry(width, length, width), material);
    limb.position.y = -length / 2;
    pivot.add(limb);
    return { pivot, limb, length };
  }

  makeWing(material, edgeMaterial, side) {
    const group = new THREE.Group();
    const shape = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.015), material);
    shape.position.set(side * 0.22, -0.06, 0);
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.03), edgeMaterial);
    spar.position.set(side * 0.22, 0.05, 0);
    group.add(shape, spar);
    group.userData.side = side;
    return group;
  }

  setVisible(visible) {
    this.root.visible = visible;
  }

  /**
   * @param {object} player
   * @param {number} dt
   */
  update(player, dt) {
    const height = player.height;
    this.root.scale.setScalar(height);
    this.root.position.copy(player.position);

    const gliding = player.mode === 'glide';
    this.glideBlend = damp(this.glideBlend, gliding ? 1 : 0, 7, dt);

    // Body faces travel direction on foot, look direction in the air.
    const moving = player.horizontalSpeed > 0.4;
    const travelYaw = moving
      ? Math.atan2(player.velocity.x, -player.velocity.z)
      : player.yaw;
    const targetYaw = gliding ? player.yaw : travelYaw;
    this.visibleYaw = dampAngle(this.visibleYaw, targetYaw, 9, dt);
    this.root.rotation.set(0, this.visibleYaw, 0);

    // Gliding pitches the whole body forward toward the look direction.
    this.body.rotation.x = damp(this.body.rotation.x, gliding ? -player.pitch + 1.15 : 0, 8, dt);
    this.body.position.y = damp(this.body.position.y, gliding ? 0.28 : 0, 8, dt);

    const stride = clamp(player.horizontalSpeed / (4.3 * Math.pow(player.scale, 0.75)), 0, 1.8);
    if (player.onGround) this.walkPhase += dt * stride * 9;
    else this.walkPhase = damp(this.walkPhase % (Math.PI * 2), 0, 4, dt);

    const swing = Math.sin(this.walkPhase) * 0.7 * stride * (1 - this.glideBlend);
    this.legL.pivot.rotation.x = swing;
    this.legR.pivot.rotation.x = -swing;
    this.armL.pivot.rotation.x = -swing * 0.8;
    this.armR.pivot.rotation.x = swing * 0.8;

    // Arms sweep back into the slipstream while gliding.
    const tuck = this.glideBlend;
    this.armL.pivot.rotation.x = this.armL.pivot.rotation.x * (1 - tuck) + 2.5 * tuck;
    this.armR.pivot.rotation.x = this.armR.pivot.rotation.x * (1 - tuck) + 2.5 * tuck;
    this.armL.pivot.rotation.z = 0.25 * tuck;
    this.armR.pivot.rotation.z = -0.25 * tuck;
    this.legL.pivot.rotation.x += 0.25 * tuck;
    this.legR.pivot.rotation.x += 0.25 * tuck;

    const open = player.elytraDeployed ? this.glideBlend : 0;
    this.wings.visible = open > 0.02 || player.elytraDeployed;
    this.wingL.rotation.set(-0.15 * open, 0.35 - 1.5 * (1 - open), -0.2 * open);
    this.wingR.rotation.set(-0.15 * open, -0.35 + 1.5 * (1 - open), 0.2 * open);

    this.head.rotation.x = damp(this.head.rotation.x, gliding ? 0 : clamp(player.pitch, -0.9, 0.9), 10, dt);
  }
}

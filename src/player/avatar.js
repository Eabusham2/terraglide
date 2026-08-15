import * as THREE from '../../vendor/three/three.module.js';
import { clamp, damp, dampAngle } from '../core/math.js';

/**
 * The character.
 *
 * You see it in third person and in freecam, and — with the head hidden — you
 * see your own body in first person too: legs below you, arms out in front when
 * the wings are open, which is what makes strafing and flying read as yours.
 *
 * The model faces −Z, the direction three.js treats as forward, so the root
 * yaw is simply the negative of the compass bearing. Getting that wrong is what
 * used to lay the character out backwards in a glide and look upside down.
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
const ROCKET = 0xc9a97c;

/**
 * Your kit — jacket, trousers, wings — can carry a generated texture in every
 * mode, unlike the scenery. The rule about generated art has always been about
 * the *world*: nothing invented may stand in where real map data belongs. The
 * character has no real-world counterpart to fetch, in any provider, so there
 * is nothing here for a texture to displace. Absent the files it stays flat
 * colour, which is what the single-file build gets.
 */
const CLOTH_TINT = 0xffffff;

export class Avatar {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'avatar';
    scene.add(this.root);

    const body = new THREE.Group();
    this.body = body;
    this.root.add(body);

    const mat = (colour) => new THREE.MeshLambertMaterial({ color: colour });
    // Kept so a texture can be dropped onto the right pieces once it arrives.
    this.cloth = { jacket: [], trousers: [], wing: [], rocket: [] };

    // Proportions as fractions of standing height.
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.15), mat(JACKET));
    this.torso.position.y = 0.66;
    body.add(this.torso);
    this.cloth.jacket.push(this.torso.material);

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
    this.cloth.jacket.push(this.armL.limb.material, this.armR.limb.material);
    this.cloth.trousers.push(this.legL.limb.material, this.legR.limb.material);

    // Toes point forward, which is −Z.
    const bootGeo = new THREE.BoxGeometry(0.1, 0.05, 0.14);
    this.bootL = new THREE.Mesh(bootGeo, mat(BOOTS));
    this.bootL.position.set(0, -0.34, -0.02);
    this.legL.limb.add(this.bootL);
    this.bootR = new THREE.Mesh(bootGeo, mat(BOOTS));
    this.bootR.position.set(0, -0.34, -0.02);
    this.legR.limb.add(this.bootR);

    // Wings sit on the back, which is +Z.
    this.wings = new THREE.Group();
    this.wings.position.set(0, 0.76, 0.08);
    body.add(this.wings);
    const wingMat = mat(WING);
    this.wingL = this.makeWing(wingMat, mat(WING_EDGE), -1);
    this.wingR = this.makeWing(wingMat, mat(WING_EDGE), 1);
    this.wings.add(this.wingL, this.wingR);
    this.cloth.wing.push(wingMat);

    // The selected rocket, in your right hand — the way Minecraft shows the
    // firework you are about to use. Visible in first person too, since the
    // arms are, so the slot you are on is readable without the HUD.
    const rocketMat = mat(ROCKET);
    this.rocket = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.13, 8), rocketMat);
    // The limb mesh is a box of its own length centred on its origin, so the
    // hand is at −length/2. Sit the rocket just past the fingers, pointing the
    // way the arm does: the cylinder's +Y axis is turned onto −Z, forward.
    this.rocket.position.set(0, -this.armR.length / 2 + 0.01, -0.03);
    this.rocket.rotation.x = -Math.PI / 2;
    this.armR.limb.add(this.rocket);
    this.cloth.rocket = [rocketMat];

    this.walkPhase = 0;
    this.glideBlend = 0;
    this.visibleYaw = 0;
    this.firstPerson = false;
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
   * Optional kit textures from the assets folder. Same shape as the scenery
   * loader, and the same manifest, but with no provider gate: see the note by
   * CLOTH_TINT for why the character is not held to the world's rule. Missing
   * files are not an error — the flat colours underneath are the fallback, and
   * they are what the single-file build ships with.
   */
  async loadTextures(base = './assets/') {
    if (typeof document === 'undefined' || typeof fetch !== 'function') return;
    // The single-file build has no assets folder beside it, and asking for one
    // over file:// is a CORS error in the console rather than a 404. Don't ask.
    if (globalThis.__TERRAGLIDE_INLINE_WORKER__) return;
    let manifest;
    try {
      const response = await fetch(`${base}manifest.json`, { cache: 'force-cache' });
      if (!response.ok) return;
      manifest = await response.json();
    } catch {
      return;
    }
    const files = manifest?.kit;
    if (!files) return;

    const loader = new THREE.TextureLoader();
    for (const part of ['jacket', 'trousers', 'wing', 'rocket']) {
      const file = files[part];
      if (!file || !this.cloth[part].length) continue;
      loader.load(
        `${base}${file}`,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          for (const material of this.cloth[part]) {
            material.map = texture;
            // The tint has done the colouring so far; let the weave through.
            material.color.setHex(CLOTH_TINT);
            material.needsUpdate = true;
          }
        },
        undefined,
        () => {},
      );
    }
  }

  /**
   * First person shows the same body with the head taken off, so looking down
   * shows your legs instead of the inside of your own skull.
   */
  setFirstPerson(firstPerson) {
    if (this.firstPerson === firstPerson) return;
    this.firstPerson = firstPerson;
    this.head.visible = !firstPerson;
    this.hair.visible = !firstPerson;
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
    const flying = player.mode === 'fly';
    this.glideBlend = damp(this.glideBlend, gliding || flying ? 1 : 0, 7, dt);

    // The model faces −Z, so the root turns by the negative of the bearing. In
    // first person the body must not lag the view at all or it swims about.
    this.visibleYaw = this.firstPerson
      ? -player.yaw
      : dampAngle(this.visibleYaw, -player.yaw, 14, dt);
    this.root.rotation.set(0, this.visibleYaw, 0);

    const forwardSpeed =
      player.velocity.x * Math.sin(player.yaw) - player.velocity.z * Math.cos(player.yaw);
    const sideSpeed =
      player.velocity.x * Math.cos(player.yaw) + player.velocity.z * Math.sin(player.yaw);

    // Gliding lays the body along the flight path. The head points where you
    // look: level flight is face down, a dive is head down, a climb stands up.
    const glidePitch = player.pitch - Math.PI / 2;
    this.body.rotation.x = damp(this.body.rotation.x, gliding || flying ? glidePitch : 0, 9, dt);
    this.body.rotation.z = damp(
      this.body.rotation.z,
      gliding || flying ? 0 : clamp(sideSpeed * 0.05, -0.25, 0.25),
      8,
      dt,
    );
    this.body.position.y = damp(this.body.position.y, gliding || flying ? 0.3 : 0, 8, dt);

    const stride = clamp(player.horizontalSpeed / (4.3 * Math.pow(player.scale, 0.75)), 0, 1.8);
    const strafing = Math.abs(sideSpeed) > Math.abs(forwardSpeed) * 1.2 && stride > 0.15;
    if (player.onGround || player.swimming) this.walkPhase += dt * stride * 9;
    else this.walkPhase = damp(this.walkPhase % (Math.PI * 2), 0, 4, dt);

    const swing = Math.sin(this.walkPhase) * 0.7 * stride * (1 - this.glideBlend);
    // Strafing swings the legs sideways instead of marching on the spot.
    const side = strafing ? swing : 0;
    const fore = strafing ? swing * 0.25 : swing;
    this.legL.pivot.rotation.x = fore;
    this.legR.pivot.rotation.x = -fore;
    this.legL.pivot.rotation.z = side * 0.5;
    this.legR.pivot.rotation.z = -side * 0.5;
    this.armL.pivot.rotation.x = -fore * 0.8;
    this.armR.pivot.rotation.x = fore * 0.8;

    // Arms reach out in front in the air — which is what you see of yourself.
    const tuck = this.glideBlend;
    this.armL.pivot.rotation.x = this.armL.pivot.rotation.x * (1 - tuck) - 2.5 * tuck;
    this.armR.pivot.rotation.x = this.armR.pivot.rotation.x * (1 - tuck) - 2.5 * tuck;
    // In first person the arms are swept wider so they frame the view instead
    // of filling it — you should see the world, with your arms at the edges.
    const spread = this.firstPerson ? 0.62 : 0.25;
    this.armL.pivot.rotation.z = spread * tuck;
    this.armR.pivot.rotation.z = -spread * tuck;
    this.legL.pivot.rotation.x -= 0.2 * tuck;
    this.legR.pivot.rotation.x -= 0.2 * tuck;
    this.legL.pivot.rotation.z *= 1 - tuck;
    this.legR.pivot.rotation.z *= 1 - tuck;

    const open = player.elytraDeployed ? Math.max(this.glideBlend, 0.6) : 0;
    this.wings.visible = player.elytraDeployed;
    this.wingL.rotation.set(0.15 * open, -0.35 + 1.5 * (1 - open), 0.2 * open);
    this.wingR.rotation.set(0.15 * open, 0.35 - 1.5 * (1 - open), -0.2 * open);

    // The head counter-rotates so the character keeps looking where you look.
    if (!this.firstPerson) {
      this.head.rotation.x = damp(
        this.head.rotation.x,
        gliding || flying ? clamp(-glidePitch - 1.1, -1.2, 0.6) : clamp(-player.pitch, -0.9, 0.9),
        10,
        dt,
      );
    }
  }
}

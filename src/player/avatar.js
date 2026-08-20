import * as THREE from '../../vendor/three/three.module.js';
import { clamp, damp, dampAngle, wrapAngle } from '../core/math.js';
import { settings } from '../core/settings.js';
import { ROCKET_COLOURS } from './player.js';

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
 * How far the head may twist before the body gives up and turns to follow.
 * Minecraft uses fifty degrees and it is the single detail that makes a
 * first-person body read as a body rather than a pair of floating arms: you
 * glance sideways and your shoulders stay put, you keep turning and they come
 * round after you.
 */
const BODY_LIMIT = 0.87;
/** How briskly the body catches up, in damp-per-second. */
const BODY_TURN = 8;
/**
 * How far back the model sits in first person, as a fraction of height.
 *
 * The eye is at 0.94 and the chest tops out at 0.81, so without this you are
 * looking straight into your own jacket the moment you glance down — it fills
 * the screen at the near plane. Real proportions have the same gap; what they
 * also have is eyes set forward of the spine, which is what this restores.
 * Roughly ten centimetres on a person, so a fifteenth of standing height.
 *
 * Enough to look *over* your chest, and no more: push it further and glancing
 * down shows the ground where your legs ought to be.
 */
const BODY_BACK = 0.07;

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
    this.noseMat = mat(0xffffff);
    this.rocket = this.makeRocket(rocketMat, this.noseMat, mat(0x6b5334));
    // The limb mesh is a box of its own length centred on its origin, so the
    // hand is at −length/2. Sit the rocket just past the fingers, pointing the
    // way the arm does: the group's +Y axis is turned onto −Z, forward.
    this.rocket.position.set(0, -this.armR.length / 2 + 0.01, -0.03);
    this.rocket.rotation.x = -Math.PI / 2;
    this.armR.limb.add(this.rocket);
    this.cloth.rocket = [rocketMat];
    this.rocketColour = -1;

    this.walkPhase = 0;
    this.glideBlend = 0;
    /** Where the shoulders point. Its own value, not a copy of the camera's. */
    this.bodyYaw = 0;
    this.firstPerson = false;
    /** Optional generated mesh; null until asked for. See loadModel(). */
    this.model = null;
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

  /**
   * A firework: paper tube, cone nose, guide stick. Built by hand rather than
   * generated — a text-to-3D pass on this came back at fifty thousand
   * triangles with no UVs and no material, for a prop that is thirteen
   * centimetres long and covered by a hand at arm's length. This is about a
   * hundred triangles, takes the paper texture properly, and the nose is a
   * flat colour so the strength can be read off it.
   *
   * Points along +Y, so the caller turns it onto whatever axis it wants.
   */
  makeRocket(paper, nose, stick) {
    const group = new THREE.Group();

    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.095, 10), paper);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.034, 10), nose);
    cone.position.y = 0.0645;
    const guide = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.1, 5), stick);
    guide.position.y = -0.095;

    group.add(tube, cone, guide);
    return group;
  }

  makeWing(material, edgeMaterial, side) {
    const group = new THREE.Group();
    // Wider and deeper than they were. Open elytra are roughly as broad as the
    // player is tall, and at any distance the wings *are* the silhouette — the
    // old stubs left a gliding figure looking like a thrown box.
    const shape = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.34, 0.016), material);
    shape.position.set(side * 0.29, -0.09, 0);
    // A taper at the tip, so the outline is a wing rather than a plank.
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.014), material);
    tip.position.set(side * 0.63, -0.15, 0);
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.035, 0.035), edgeMaterial);
    spar.position.set(side * 0.37, 0.06, 0);
    group.add(shape, tip, spar);
    group.userData.side = side;
    return group;
  }

  setVisible(visible) {
    this.root.visible = visible;
  }

  /**
   * An optional generated character mesh, in place of the built model.
   *
   * Made with TRELLIS.2 on Hugging Face, then cut down here: the generator
   * reconstructs what it sees, and what it saw was a figure standing on an
   * implied floor — so it built the floor too, welded under the boots. That
   * slab and eleven thousand triangles of it are removed, the textures are
   * halved and re-encoded, and the normals and UVs are quantised, which takes
   * it from 3.9 MB to under 900 KB.
   *
   * It is off by default and says why in the settings: it is one fused mesh
   * with no skeleton, so it cannot walk, cannot open its wings, and cannot be
   * cut down for the first-person body. It is more detailed standing still and
   * worse at everything else. That is a real trade, so it is offered as one
   * rather than chosen for you.
   */
  async loadModel(base = './assets/') {
    if (globalThis.__TERRAGLIDE_INLINE_WORKER__) return false;
    if (!settings.get('detailedPlayerModel')) return false;
    if (this.model) return true;
    try {
      const { GLTFLoader } = await import('../../vendor/three/loaders/GLTFLoader.js');
      const gltf = await new Promise((resolve, reject) =>
        new GLTFLoader().load(`${base}player.glb`, resolve, undefined, reject),
      );
      const model = gltf.scene;
      // Normalise to a 1-unit-tall figure standing on the origin, matching the
      // built model's convention so the same root transform drives both.
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const scale = 1 / Math.max(size.y, 1e-6);
      model.scale.setScalar(scale);
      model.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);

      this.model = new THREE.Group();
      this.model.add(model);
      this.root.add(this.model);
      this.applyModelMode();
      return true;
    } catch {
      return false;
    }
  }

  /** Show whichever of the two bodies is wanted, and only that one. */
  applyModelMode() {
    const useModel = !!this.model && settings.get('detailedPlayerModel') && !this.firstPerson;
    if (this.model) this.model.visible = useModel;
    // The built rig stays for first person and for everything that moves.
    this.body.visible = !useModel;
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
    this.applyModelMode();
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

    const forwardSpeed =
      player.velocity.x * Math.sin(player.yaw) - player.velocity.z * Math.cos(player.yaw);
    const sideSpeed =
      player.velocity.x * Math.cos(player.yaw) + player.velocity.z * Math.sin(player.yaw);

    // Where the shoulders want to point.
    //
    // Standing still they stay where they are, and only come round once the
    // neck has twisted further than it likes. Walking, they lead with the
    // direction of travel — strafing turns you side-on, the way it does in
    // Minecraft. Flying, the body *is* the flight path, so it locks to the
    // look direction and the split goes away.
    //
    // Taking the absolute of the forward component is what stops the body
    // spinning through 180° when you walk backwards: reversing keeps your
    // shoulders where they were and runs the legs the other way instead.
    const lookYaw = player.yaw;
    let target = this.bodyYaw;
    if (gliding || flying) {
      target = lookYaw;
    } else if (player.horizontalSpeed > 0.6) {
      target = lookYaw + clamp(
        Math.atan2(sideSpeed, Math.abs(forwardSpeed)), -BODY_LIMIT, BODY_LIMIT,
      );
    } else {
      const twist = wrapAngle(lookYaw - this.bodyYaw);
      if (Math.abs(twist) > BODY_LIMIT) {
        target = lookYaw - Math.sign(twist) * BODY_LIMIT;
      }
    }
    this.bodyYaw = dampAngle(this.bodyYaw, target, BODY_TURN, dt);

    // The model faces −Z, so the root turns by the negative of the bearing.
    this.root.rotation.set(0, -this.bodyYaw, 0);
    // Whatever the shoulders did not turn, the neck does.
    const neck = wrapAngle(lookYaw - this.bodyYaw);

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
    // +Z is behind you, so this walks the model backwards out of the view.
    this.body.position.z = damp(this.body.position.z, this.firstPerson ? BODY_BACK : 0, 10, dt);

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
    // From outside they go wider still: a glider seen from behind is mostly
    // silhouette, and arms tight to the body turn it into a blob.
    const spread = this.firstPerson ? 0.62 : 0.85;
    this.armL.pivot.rotation.z = spread * tuck;
    this.armR.pivot.rotation.z = -spread * tuck;

    // Legs together and trailing along the body, with a little bend at the
    // hip. Splayed straight legs read as two blocks end-on from behind, which
    // is exactly the angle you see yourself from in third person.
    this.legL.pivot.rotation.x -= 0.34 * tuck;
    this.legR.pivot.rotation.x -= 0.34 * tuck;
    this.legL.pivot.rotation.z = this.legL.pivot.rotation.z * (1 - tuck) + 0.06 * tuck;
    this.legR.pivot.rotation.z = this.legR.pivot.rotation.z * (1 - tuck) - 0.06 * tuck;

    // The nose takes the colour of the slot you are on, so what is in your
    // hand and what is lit in the hotbar are visibly the same rocket.
    const slot = player.selectedSlot ?? 0;
    if (slot !== this.rocketColour) {
      this.rocketColour = slot;
      this.noseMat.color.set(ROCKET_COLOURS[clamp(slot, 0, ROCKET_COLOURS.length - 1)]);
    }

    const open = player.elytraDeployed ? Math.max(this.glideBlend, 0.6) : 0;
    this.wings.visible = player.elytraDeployed;
    this.wingL.rotation.set(0.15 * open, -0.35 + 1.5 * (1 - open), 0.2 * open);
    this.wingR.rotation.set(0.15 * open, 0.35 - 1.5 * (1 - open), -0.2 * open);

    // The head keeps looking where you look, whatever the shoulders are doing.
    this.head.rotation.y = -neck;
    this.hair.rotation.y = -neck;
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

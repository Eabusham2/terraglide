import * as THREE from '../../vendor/three/three.module.js';
import { clamp, damp, dampAngle, wrapAngle } from '../core/math.js';
import { ASSET_BASE } from '../core/paths.js';
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
/**
 * Zero, now that the camera moves forward instead.
 *
 * Walking the whole body backwards cleared the chest and put the feet behind
 * you, which is the wrong trade: you look down far more often than you look at
 * your own back. The rig leans the camera out to where a face is instead —
 * see EYE_FORWARD — and the body stays where the body is.
 */
const BODY_BACK = 0;
/**
 * Where the glide pose turns, as a fraction of height.
 *
 * It used to turn about the feet, which is where a model's origin happens to
 * be and nowhere a body bends. Laying out a 1.9 m figure about its ankles
 * threw the whole thing a metre and a half forward and down, so in first
 * person you flew along looking at your own back from behind — a paper
 * aeroplane two metres ahead of your face rather than a body you were inside.
 * Turning about the base of the neck instead keeps the head where the eyes
 * are and trails the spine, hips and legs out behind you, which is what lying
 * face down actually looks like from inside.
 *
 * The number is the eye height exactly, so in first person the pose turns
 * about the camera itself: every part of you keeps its own distance from your
 * eye whatever attitude you are in, and nothing can swing through your head.
 */
const POSE_PIVOT = 0.94;

/**
 * The held view model: how far in front of the eye it sits, and where in the
 * frame it hangs as a fraction of the half-frustum at that distance.
 *
 * Anchored to the frustum rather than to fixed metres because the frame is not
 * a fixed shape: a phone held upright is narrower than it is tall, and a hand
 * parked at a fixed x sails off the side of it. Proportions of the frustum
 * keep it in the bottom-right corner at every aspect from 9:21 to 32:9.
 */
/**
 * The two poses, as [across, down, forward, pitch, yaw, roll].
 *
 * `across` and `down` are fractions of the half-frustum at the pose's own
 * depth, so they mean "this far toward the corner" rather than "this many
 * metres" and survive being handed a phone stood on its end. `forward` is
 * metres from the eye and the last three are radians.
 *
 * HELD is a firework carried at your side, the way Minecraft holds an item.
 * GLIDE is the superman pose from inside it: both arms out along the flight
 * path, converging ahead of you, entering frame from the bottom corners.
 */
const HAND_HELD = [0.62, 0.82, 0.52, -0.35, 0, 0.34];
const HAND_GLIDE = [0.62, 0.62, 0.85, -1.3, 0.42, 0.1];

/**
 * Your kit — jacket, trousers, wings — can carry a generated texture in every
 * mode, unlike the scenery. The rule about generated art has always been about
 * the *world*: nothing invented may stand in where real map data belongs. The
 * character has no real-world counterpart to fetch, in any provider, so there
 * is nothing here for a texture to displace. Absent the files it stays flat
 * colour, which is what the single-file build gets.
 */
const CLOTH_TINT = 0xffffff;

/** The firework mesh runs along its own +Y; these are what it gets aimed at. */
/**
 * Closer than this to the eye and a part of your own body is not visible, it
 * is something you are inside. A third of a metre on a person of average
 * height, scaled with you — about the distance from your eye to the tip of
 * your nose plus a hand.
 */
const TOO_CLOSE_M = 0.34;
const ROCKET_AXIS = new THREE.Vector3(0, 1, 0);
/**
 * Where the held one points, in view space.
 *
 * Not straight down the view axis, even though that is exactly where the
 * thrust goes: aim it there and you are looking down the barrel, so the whole
 * rocket hides behind the fist and only the guide stick shows. Up and inward
 * from the corner keeps its length on screen and still reads as pointing the
 * way you are about to go. The world model has no such problem and is aimed at
 * the look vector itself, which is what you see from the chase camera.
 */
const VIEW_AIM = new THREE.Vector3(-0.3, 0.55, -0.78).normalize();

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
    // hand is at −length/2. The grip goes there; which way the rocket then
    // points is decided every frame by aimRocket.
    this.rocket.position.set(0, -this.armR.length / 2 + 0.015, -0.02);
    this.armR.limb.add(this.rocket);
    this.cloth.rocket = [rocketMat];
    this.rocketColour = -1;

    // The view model: your arms and the firework in one of them, drawn in view
    // space instead of world space.
    //
    // The world body alone left first person with nothing of you in it at all.
    // Stand, walk, fall — pure scenery, because your arms hang at your sides
    // behind your own eyes and nothing in front of you is you. Turning the
    // glide pose about the eye fixed the flying case in world space and made
    // this one worse: the shoulders end up a hand's width *behind* the camera,
    // so an arm has to be longer than an arm to reach into frame at all.
    //
    // Everything that draws a first-person hand draws it this way for exactly
    // that reason: in view space you place the arm where it should look, and
    // the frame is the only geometry it has to agree with. The world arms are
    // hidden in first person so there is never a second pair.
    //
    // Materials are shared with the world body, so one kit texture dresses
    // both and the nose keeps the colour of the slot you are on.
    this.viewModel = new THREE.Group();
    this.viewModel.name = 'view-model';
    this.viewModel.visible = false;
    this.handR = this.makeHand(this.armR.limb.material, mat(SKIN));
    this.handL = this.makeHand(this.armL.limb.material, mat(SKIN));
    this.handRocket = this.makeRocket(rocketMat, this.noseMat, mat(0x6b5334));
    // Clear of the fist rather than half inside it: the tube is 9.5 cm and the
    // fist 8.5, so anything under a quarter of a metre up buries the thing you
    // are meant to be able to read the colour off.
    this.handRocket.position.set(0, 0.155, 0);
    this.handR.add(this.handRocket);
    this.viewModel.add(this.handR, this.handL);
    /** Look-lag and the shove a firework gives the arm. */
    this.handSway = { yaw: 0, pitch: 0, lastYaw: 0, lastPitch: 0 };
    this.handPunch = 0;
    this.lastRockets = 0;

    this.walkPhase = 0;
    this.glideBlend = 0;
    /** Scratch for the pose pivot, and the damped first-person set-back. */
    this._pivot = new THREE.Vector3();
    this.backBlend = 0;
    /** Scratch for aiming the firework along the thrust. */
    this._aim = new THREE.Vector3();
    this._world = new THREE.Vector3();
    this._aimQuat = new THREE.Quaternion();
    this._holdQuat = new THREE.Quaternion();
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

    // Full size of the real thing — a hand's length of tube and a stick as
    // long again. It was built at two thirds of this and read as a matchstick
    // in the hand and as nothing at all from the chase camera; the colour on
    // the nose is meant to be readable, and at that size it was not.
    // Everything sits above the group origin, because the origin is the *grip*
    // — the point a fist closes around, a little below the middle of the tube.
    // Aiming the thing then turns it in the hand instead of swinging it round
    // some point in mid-air, which is what left it floating beside the fist.
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.14, 10), paper);
    tube.position.y = 0.04;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.05, 10), nose);
    cone.position.y = 0.135;
    const guide = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.15, 5), stick);
    guide.position.y = -0.1;

    group.add(tube, cone, guide);
    return group;
  }

  /** One view-model forearm: sleeve and fist, reaching along its own +Y. */
  makeHand(sleeve, skin) {
    const group = new THREE.Group();
    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.32, 0.085), sleeve);
    forearm.position.y = -0.05;
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.085, 0.09), skin);
    fist.position.y = 0.15;
    group.add(forearm, fist);
    return group;
  }

  /**
   * One wing.
   *
   * It was three boxes: a slab, a smaller slab for the tip, and a bar along
   * the top. At any distance the wings *are* the silhouette of a gliding
   * figure, and a silhouette made of rectangles reads as a thrown crate. This
   * is the real outline instead — broad at the shoulder, swept back, tapering
   * to a point — extruded from a profile, which costs a few dozen triangles
   * and is the difference between a wing and a plank.
   *
   * The profile is drawn for the right wing and mirrored by negating x, so one
   * set of numbers describes both and they cannot drift apart.
   */
  makeWing(material, edgeMaterial, side) {
    const group = new THREE.Group();

    const outline = [
      [0, 0.17], [0.3, 0.15], [0.58, 0.06], [0.76, -0.1],
      [0.8, -0.19], [0.6, -0.23], [0.24, -0.25], [0, -0.21],
    ];
    const shape = new THREE.Shape();
    shape.moveTo(side * outline[0][0], outline[0][1]);
    for (const [x, y] of outline.slice(1)) shape.lineTo(side * x, y);
    shape.closePath();

    const membrane = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: 0.014,
        bevelEnabled: true,
        bevelThickness: 0.004,
        bevelSize: 0.004,
        bevelSegments: 1,
        curveSegments: 1,
      }),
      material,
    );
    membrane.position.z = -0.007;
    // Extrusion runs along +Z and the outline is drawn in XY, which is already
    // the plane a wing lies in: outboard along X, along the back on Y.
    group.add(membrane);

    // The leading edge, thicker and darker, running from the shoulder to the
    // tip. It is what catches the light and tells you which way the wing is
    // pointing when the membrane is edge-on.
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.034, 0.034), edgeMaterial);
    spar.position.set(side * 0.4, 0.12, 0);
    spar.rotation.z = side * -0.31;
    group.add(spar);

    group.userData.side = side;
    return group;
  }

  setVisible(visible) {
    this.root.visible = visible;
  }

  /**
   * Hang the view model off the camera. It rides the camera's transform, so it
   * is stuck to the frame the way a held thing is, and it is depth-tested like
   * everything else — walk your fist into a wall and the wall wins, which is
   * what Minecraft does too.
   */
  attachTo(camera) {
    if (this.viewModel.parent === camera) return;
    camera.add(this.viewModel);
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
  async loadModel(base = ASSET_BASE) {
    if (globalThis.__TERRAGLIDE_INLINE_WORKER__) return false;
    if (!settings.get('detailedPlayerModel')) return false;
    if (this.model) return true;
    try {
      const inline = globalThis.__TERRAGLIDE_REQUIRE__;
      const { GLTFLoader } = inline
        ? inline('vendor/three/loaders/GLTFLoader.js')
        : await import('../../vendor/three/loaders/GLTFLoader.js');
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
  async loadTextures(base = ASSET_BASE) {
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
  update(player, dt, camera) {
    const height = player.height;
    this.root.scale.setScalar(height);
    this.root.position.copy(player.renderPosition);

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
    // On foot the body leans with the grade — a fraction of it, the way a
    // walker actually leans, rather than standing perpendicular to a hillside
    // like a flagpole. The pose turns about the neck, so leaning does not move
    // the head off the camera.
    const lean = gliding || flying ? glidePitch : -(player.groundSlope ?? 0) * 0.45;
    this.body.rotation.x = damp(this.body.rotation.x, lean, 9, dt);
    this.body.rotation.z = damp(
      this.body.rotation.z,
      gliding || flying ? 0 : clamp(sideSpeed * 0.05, -0.25, 0.25),
      8,
      dt,
    );
    // Turn the pose about the base of the neck rather than about the origin
    // under the feet, so that whatever the body does the head stays where the
    // eyes are and the spine trails out behind it. See POSE_PIVOT. The lift
    // that used to be here was papering over the same thing.
    this._pivot.set(0, POSE_PIVOT, 0).applyEuler(this.body.rotation);
    // +Z is behind you, so this walks the model backwards out of the view.
    this.backBlend = damp(this.backBlend, this.firstPerson ? BODY_BACK : 0, 10, dt);
    this.body.position.set(
      -this._pivot.x,
      POSE_PIVOT - this._pivot.y,
      -this._pivot.z + this.backBlend,
    );

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
    //
    // Not as far in front from inside your own head. The pose turns about your
    // eyes, so a shoulder swung a hundred and forty degrees brings the hand up
    // past your face, and what you are holding in it arrives on the lens: a
    // firework three centimetres from your eye, filling a quarter of the
    // screen as a pale disc. From outside the same sweep is right — a glider
    // reaches.
    const tuck = this.glideBlend;
    const reach = this.firstPerson ? -1.85 : -2.5;
    this.armL.pivot.rotation.x = this.armL.pivot.rotation.x * (1 - tuck) + reach * tuck;
    this.armR.pivot.rotation.x = this.armR.pivot.rotation.x * (1 - tuck) + reach * tuck;
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
    // Wings are strapped to your back, and now that the pose turns about your
    // eyes rather than your ankles they are where a back is: directly behind
    // your head. Drawing them in first person put a metre of canvas through
    // the camera. You cannot see your own wings, so do not draw them.
    this.wings.visible = player.elytraDeployed && !this.firstPerson;
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

    // What is left of you in first person.
    //
    // The arms come off: they are the view model's job now, and two right arms
    // is worse than none. The wings come off with them — they are strapped to
    // your back, which since the pose turns about your eyes is directly behind
    // your head, and a metre of canvas through the camera is not a wing you
    // can see. Chest and legs stay while you are on your feet or falling and
    // go in a glide, where they are behind your head rather than below you and
    // only ever appear as a shape passing through the near plane.
    // First person is the whole body, less the head you are looking out of.
    //
    // Hiding the chest and the arms and drawing a hand in the corner instead
    // fixed one problem and caused a worse one: looking down showed a pair of
    // boots with nothing above them and a firework floating off to one side,
    // which is not what a first-person body mod looks like. What those mods
    // do is simpler — draw everything, and put the camera where the eyes are,
    // which is at the *front* of the head rather than on the spine. That last
    // part is what keeps the chest out of your face, and the camera rig does
    // it now, so the chest can come back.
    //
    // The wings stay off. They are strapped across your back a hand's width
    // behind your skull, and no offset makes a metre of canvas at that range
    // into something you can see rather than something you are inside.
    const inside = this.firstPerson;
    const prone = inside && this.glideBlend > 0.5;
    this.armL.pivot.visible = true;
    this.armR.pivot.visible = true;
    this.torso.visible = true;
    this.legL.pivot.visible = !prone;
    this.legR.pivot.visible = !prone;

    // No separate view model: the rocket is already in the hand of the arm you
    // can see, which is the whole idea.
    this.viewModel.visible = false;

    this.aimRocket(player);
    // Last, because it measures against where the camera actually is.
    this.hideWhatIsInYourEye(camera);
  }

  /**
   * Nothing of yours may be drawn inside your own eye.
   *
   * A backstop rather than a fix: the arm sweep is tuned so the hand stays out
   * of the frame, but attitudes compound — a hard pull-up while looking over
   * your shoulder puts things where no single number predicted. Anything of
   * your own body closer than arm's reach is not something you would see, it
   * is something you would be inside, so it is simply not drawn. The distance
   * is measured from the camera the rig actually placed, which is why this
   * runs after the pose rather than as part of it.
   */
  hideWhatIsInYourEye(camera) {
    if (!camera || !this.firstPerson) {
      if (this.rocket) this.rocket.visible = true;
      return;
    }
    this.root.updateMatrixWorld(true);
    const limit = TOO_CLOSE_M * (this.root.scale.x || 1);
    for (const part of [this.rocket]) {
      if (!part) continue;
      part.getWorldPosition(this._world);
      part.visible = this._world.distanceTo(camera.position) > limit;
    }
  }

  /**
   * Point the firework where it is about to push you.
   *
   * It used to lie along the forearm, which is where a hand holds a stick and
   * not where a rocket is aimed: look straight up and the thing that was going
   * to throw you at the sky was still pointing off to one side. Thrust runs
   * along your look vector, so the rocket does — in the world model by undoing
   * the arm's rotation, and in the view model by undoing the hand's, since
   * there "along your look" is simply forward out of the screen.
   */
  aimRocket(player) {
    const cp = Math.cos(player.pitch ?? 0);
    this._aim.set(
      cp * Math.sin(player.yaw ?? 0),
      Math.sin(player.pitch ?? 0),
      -cp * Math.cos(player.yaw ?? 0),
    );
    this._aimQuat.setFromUnitVectors(ROCKET_AXIS, this._aim);
    this.root.updateMatrixWorld(true);
    this.armR.limb.getWorldQuaternion(this._holdQuat);
    this.rocket.quaternion.copy(this._holdQuat).invert().multiply(this._aimQuat);

    if (!this.viewModel.visible) return;
    this._aimQuat.setFromUnitVectors(ROCKET_AXIS, VIEW_AIM);
    this._holdQuat.copy(this.viewModel.quaternion).multiply(this.handR.quaternion);
    this.handRocket.quaternion.copy(this._holdQuat).invert().multiply(this._aimQuat);
  }

  /**
   * Where the view model sits, and how it moves.
   *
   * Anchored to the frustum rather than to fixed metres, so the bottom-right
   * corner is the bottom-right corner whether the frame is a phone stood on
   * end or an ultrawide; scaled with you, so a giant's fist is a giant's fist
   * and still covers the same part of the screen; blended between the carried
   * pose and the flying one by the same number the body uses, so opening the
   * wings sweeps your arms forward rather than swapping them; and given the
   * three motions a carried thing has — it lags behind a turn and swings back,
   * it bobs with your stride, and it kicks when the firework in it lights.
   */
  updateHand(player, dt, camera) {
    if (!camera) return;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const aspect = camera.aspect || 1;
    this.viewModel.scale.setScalar(player.scale);

    const glide = this.glideBlend;
    const lerp = (a, b) => a + (b - a) * glide;
    const across = lerp(HAND_HELD[0], HAND_GLIDE[0]);
    const down = lerp(HAND_HELD[1], HAND_GLIDE[1]);
    const forward = lerp(HAND_HELD[2], HAND_GLIDE[2]);
    // Half-frustum at the depth this pose actually sits at, not at some fixed
    // reference depth: the glide pose is further out than the carried one, and
    // measuring both against the same plane would drag it toward the middle.
    const half = tan * forward;
    this.handR.position.set(half * aspect * across, -half * down, -forward);
    this.handR.rotation.set(
      lerp(HAND_HELD[3], HAND_GLIDE[3]),
      lerp(HAND_HELD[4], HAND_GLIDE[4]),
      lerp(HAND_HELD[5], HAND_GLIDE[5]),
    );
    // The left arm only exists once the wings are open; carried, there is
    // nothing in it worth a quarter of the screen. It is the right arm's
    // mirror, so one set of numbers drives both.
    const farHalf = tan * HAND_GLIDE[2];
    this.handL.visible = glide > 0.02;
    this.handL.position.set(-farHalf * aspect * HAND_GLIDE[0], -farHalf * HAND_GLIDE[1], -HAND_GLIDE[2]);
    this.handL.rotation.set(HAND_GLIDE[3], -HAND_GLIDE[4], -HAND_GLIDE[5]);
    this.handL.scale.setScalar(glide);

    const sway = this.handSway;
    const yawStep = wrapAngle(player.yaw - sway.lastYaw);
    const pitchStep = player.pitch - sway.lastPitch;
    sway.lastYaw = player.yaw;
    sway.lastPitch = player.pitch;
    sway.yaw = damp(clamp(sway.yaw - yawStep * 0.9, -0.28, 0.28), 0, 7, dt);
    sway.pitch = damp(clamp(sway.pitch - pitchStep * 0.9, -0.24, 0.24), 0, 7, dt);

    if (player.rocketsFired !== this.lastRockets) {
      this.lastRockets = player.rocketsFired;
      this.handPunch = 1;
    }
    this.handPunch = damp(this.handPunch, 0, 6, dt);

    const stride = player.onGround ? clamp(player.horizontalSpeed / 4.3, 0, 1.4) : 0;
    // Sway, bob and the firework's shove ride on top of whichever pose is in
    // force, so they read the same carried or flying.
    this.viewModel.position.set(
      Math.sin(this.walkPhase) * 0.02 * stride + sway.yaw * 0.24,
      -Math.abs(Math.cos(this.walkPhase)) * 0.016 * stride +
        sway.pitch * 0.22 -
        this.handPunch * 0.05,
      -this.handPunch * 0.12,
    );
    this.viewModel.rotation.set(sway.pitch * 0.5 + this.handPunch * 0.5, sway.yaw * 0.7, 0);
  }
}

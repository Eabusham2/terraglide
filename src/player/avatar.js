import * as THREE from '../../vendor/three/three.module.js';
import { clamp, damp, dampAngle, wrapAngle } from '../core/math.js';
import { ASSET_BASE } from '../core/paths.js';

/**
 * The built firework's tube and cone together, in metres, and how far up it the
 * fist closes.
 *
 * Named because the scanned mesh has to match them: it is dropped into the same
 * pivot and has to stand the same height above the same grip, or the aim swings
 * it round a point in mid-air. Taken from makeRocket, which builds a 0.14 tube
 * at y = 0.04 with a 0.05 cone on top of it.
 */
const ARM_LENGTH = 0.3;
const ROCKET_LEN = 0.19;
const ROCKET_GRIP = 0.03;
/** White, for lightening the slot colour before it tints a photograph. */
const WHITE_TINT = new THREE.Color(0xffffff);
import { litLikeTheWorld } from './effects.js';
import { settings } from '../core/settings.js';
import { ROCKET_COLOURS } from './player.js';

/**
 * The character.
 *
 * You see it in third person and in freecam, and — with the head hidden — you
 * see your own body in first person too: legs below you, arms out in front when
 * the wings are open, which is what makes strafing and flying read as yours.
 *
 * The model faces -Z, the direction three.js treats as forward, so the root
 * yaw is simply the negative of the compass bearing. Getting that wrong is what
 * used to lay the character out backwards in a glide and look upside down.
 *
 * Built at 1 metre tall and scaled to the player's height, so growing works for
 * free.
 */

const SKIN = 0xb9906f;
const JACKET = 0x53627a;
/**
 * The sleeves, a shade off the chest.
 *
 * An arm hangs flush against the side of the chest — that is where an arm is,
 * and moving it out to make a gap detaches the shoulder. So what separates
 * them has to be tone rather than daylight, which is also what separates them
 * on a real jacket: a sleeve is a different panel of cloth, cut on a different
 * grain, and it never quite matches the front. Without this the standing
 * figure is one slab of jacket from shoulder to hip with no arms in it at all.
 */
const SLEEVE = 0x46556c;
// Lightened from 0x3a4149. Measured against the rest of the body under the
// game's own lights, the trousers came back at 87 while the wings above them
// read 130 — and a gliding figure is mostly trailing legs, so the character
// read as a dark slab hung under two pale sails. Cloth this dark is a colour a
// person would wear; it is not a colour a character can be lit in.
const TROUSERS = 0x4d5665;
const BOOTS = 0x23262b;
// Darker than it was: from above, the top of a wing is the one surface facing
// both the sun and the camera, and at 0x8d9a86 it came back at 142 against a
// body at 87 — a pale board with a dark blob under it. See tools/model.mjs.
const WING = 0x67725e;
/** What a wing gets, against SELF_FILL. See the material factory. */
const WING_FILL = 0.12;
// Dark enough to be seen. It was 0x5f6a5b against a membrane of 0x67725e —
// luma 100 against 108, a difference of eight, which is no difference at all
// at the size a gliding figure occupies. The leading edge is the one mark on
// the wing that says which way it is pointing, so it has to read.
const WING_EDGE = 0x3f4739;
const ROCKET = 0xc9a97c;

/**
 * The character carries its own fill light.
 *
 * The scene has a sun and a hemisphere, which is the right lighting for a
 * landscape and the wrong lighting for the one object that has to stay
 * readable in it. Glide with the sun ahead of you and every surface pointing
 * at the chase camera is a back face: it gets the hemisphere's ground colour,
 * 0x4a4a44, and nothing else. A jacket at 0x53627a lit by that alone is a
 * black slab with a silhouette — which is exactly what the body looked like
 * from behind, a grey wardrobe hanging under the wings.
 *
 * A film crew fixes it with a fill light off the key. Doing that literally
 * would mean a light following the camera, and a light is a light: every
 * shader in the world pays for it, for the sake of one object a couple of
 * hundred triangles big. Self-emissive is the same fill with none of that
 * cost, and it lands on the character and on nothing else in the world.
 *
 * A fraction of each garment's own colour, so the fill is the colour the
 * garment is rather than a grey wash over it — and a floor under it, because
 * a quarter of nearly nothing is still nothing and the trousers and the boots
 * are dark enough that the fraction alone left them black.
 */
const SELF_FILL = 0.28;
const FILL_FLOOR = 0.085;

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
 *
 * What they carry is the *weave*, not the colour.
 *
 * They used to carry both: the material's colour was set to white when a
 * texture arrived, so the photograph decided what the garment looked like and
 * every colour chosen in this file was dead code in the served build. Which
 * would be fine if the four photographs had been balanced against each other,
 * and they were not — mean luminance 183 for the wing, 41 for the trousers, a
 * four-and-a-half to one range across one character. That is the whole of
 * "pale sails over a dark body": the wings were near-white cloth and the legs
 * were near-black, and no amount of adjusting constants that the loader threw
 * away was ever going to change it.
 *
 * So each one is reduced to luminance and normalised to this mean before it is
 * used, which turns a photograph of a material into a detail map: it modulates
 * around one rather than replacing what it multiplies. The colour then comes
 * from the constants above, the weave comes from the photograph, and the
 * served build and the single file finally look the same.
 */
const WEAVE_MEAN = 232;

/** The firework mesh runs along its own +Y; these are what it gets aimed at. */
/**
 * Closer than this to the eye and a part of your own body is not visible, it
 * is something you are inside.
 *
 * It was 0.34 of height, which on a 1.83 m player is a bubble 62 cm across —
 * and a thing held in your hand sits 30 to 45 cm from your eye, so the
 * backstop was deleting the firework at every distance a hand actually holds
 * one at. It is meant to catch the case where an attitude nobody predicted
 * puts a limb through the lens, so it belongs just past the near plane and not
 * out at arm's length: 0.12 of height is 22 cm, against a near plane of 15.
 */
const TOO_CLOSE_M = 0.12;
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

/**
 * Where the legs hang from, how long they are, and how tall a boot is — all as
 * fractions of standing height, and all three used to place the boots too.
 *
 * They have to add up: HIP_Y - LEG_LENGTH - BOOT_HEIGHT is where the sole
 * lands, and it must be zero, because the model is built one unit tall with
 * the origin at the feet and scaled to the player's height. It did not add up
 * — 0.51 - 0.36 - 0.05 = 0.10 — and the boots were placed by a hand-written
 * offset that missed in the other direction, so the legs floated and the boots
 * sank.
 */
/**
 * How many tiles of a cloth photograph fit across one body height.
 *
 * A weave photograph stands for about twelve centimetres of real fabric, and a
 * body is a shade under two metres, so about sixteen of them head to foot.
 */
const CLOTH_TILES_PER_HEIGHT = 16.5;

const HIP_Y = 0.51;
const LEG_LENGTH = 0.46;
const BOOT_HEIGHT = 0.05;

/**
 * How far the wing lifts out of its own plane by the tip, as a fraction of
 * standing height. Applied by the square of how far out a point is, so the
 * root sits flat against the back and the curve gathers toward the tip —
 * which is the shape a shell has and a board does not.
 *
 * This used to have a partner that displaced along Y as well, meant as droop.
 * Y is in the plane the outline is drawn in, so it was not droop at all: it
 * sheared the outline backward, by the square of the span, and a square-law
 * shear turns two straight edges into two arcs. That is why the wings came out
 * as fat rounded lobes — a moth, or a pair of leaves — however the outline
 * itself was drawn. Sweep belongs in the wing's attitude, where it can be
 * measured; the outline should be the shape it says it is.
 */
const WING_CAMBER = 0.03;
/** Where the wing meets the back. Everything outboard of this bends. */
const WING_ROOT_X = 0.045;
/** The tip, and so half the spread. */
const WING_TIP_X = 0.505;

/** How far out a point is: 0 at the root, 1 at the tip. */
function wingFraction(x) {
  return clamp((Math.abs(x) - WING_ROOT_X) / (WING_TIP_X - WING_ROOT_X), 0, 1);
}

/** One outline point, bent — for the pieces built from the outline directly. */
function bentPoint(x, y) {
  return new THREE.Vector3(x, y, WING_CAMBER * wingFraction(x) ** 2);
}

/**
 * How much darker the wing gets by the tip, as a fraction of its own colour.
 *
 * A flat panel of one colour has nothing in it to read. Lambert shading gives
 * it almost nothing either: the surface barely curves, so every point on it
 * faces about the same way and takes about the same light. Elytra are shells
 * with a darkening toward the margin, so the wing carries that in its vertices
 * — which costs nothing per frame and gives the surface somewhere to go.
 */
const WING_TIP_SHADE = 0.78;

/**
 * Paint the span gradient into the geometry, in place.
 *
 * Vertex colours rather than a second material or a texture: one attribute,
 * no extra draw call, and it survives the kit weave being multiplied over the
 * top of it.
 */
function shadeWing(geometry) {
  const position = geometry.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const shade = 1 - (1 - WING_TIP_SHADE) * wingFraction(position.getX(i));
    colours[i * 3] = shade;
    colours[i * 3 + 1] = shade;
    colours[i * 3 + 2] = shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}

/**
 * Bend an extruded wing into a shell, in place.
 *
 * The displacement is a function of x alone, so the top surface, the bottom
 * surface and the rim all move together and the solid stays solid. The normals
 * are then thrown away and recomputed, which is the entire point of doing it:
 * the flat prism's normals were what made it shade like a sheet of paper.
 */
function bendWing(geometry) {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 1) {
    const t = wingFraction(position.getX(i)) ** 2;
    position.setZ(i, position.getZ(i) + WING_CAMBER * t);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/**
 * A photograph of a material, turned into a weave.
 *
 * Two steps, and both matter. It is reduced to luminance, so the jacket's
 * olive and the wing's near-white stop fighting the colour the model asked
 * for — a detail map should say where the threads are, not what colour they
 * are. Then it is scaled so its mean lands on WEAVE_MEAN, so multiplying by it
 * leaves a garment roughly the colour it was given rather than a fraction of
 * it, and the four of them stop being four different exposures.
 *
 * Returns a canvas to use in place of the image, or null if there is no canvas
 * to draw on — in which case the caller keeps the photograph, which is what
 * the model looked like before any of this and is not worse than nothing.
 */
function toWeave(image) {
  if (typeof document === 'undefined' || !image?.width) return null;
  let canvas;
  try {
    canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = frame.data;
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const luma = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
      pixels[i] = luma;
      pixels[i + 1] = luma;
      pixels[i + 2] = luma;
      sum += luma;
    }
    const mean = sum / (pixels.length / 4);
    if (!(mean > 1)) return null;
    const gain = WEAVE_MEAN / mean;
    for (let i = 0; i < pixels.length; i += 4) {
      const lit = Math.min(255, pixels[i] * gain);
      pixels[i] = lit;
      pixels[i + 1] = lit;
      pixels[i + 2] = lit;
    }
    context.putImageData(frame, 0, 0);
    return canvas;
  } catch {
    // A tainted canvas, or no 2d context. The photograph still dresses the
    // model; it just dresses it in its own colour, as it always did.
    return null;
  }
}

export class Avatar {
  constructor(scene, shared = null) {
    /**
     * The shared uniform block, so the figure can be lit by the same weather
     * the ground is. See effects.js litLikeTheWorld.
     */
    this.shared = shared;
    this.root = new THREE.Group();
    this.root.name = 'avatar';
    scene.add(this.root);

    const body = new THREE.Group();
    this.body = body;
    this.root.add(body);

    // The fill is for surfaces the key light does not reach, so how much a part
    // needs depends on how well lit it already is. The wings are the exception
    // on this body: their broad faces are canted up and back, toward the sky
    // and the sun, so they are the one part that is reliably lit — and giving
    // them a jacket's worth of fill took them to 182 against a body at 95 and a
    // landscape at 100, which is a character with two lamps strapped to its
    // back.
    const mat = (colour, fill = SELF_FILL) => {
      const emissive = new THREE.Color(colour).multiplyScalar(fill);
      const level = emissive.r * 0.299 + emissive.g * 0.587 + emissive.b * 0.114;
      if (level > 0 && level < FILL_FLOOR) emissive.multiplyScalar(FILL_FLOOR / level);
      const made = new THREE.MeshLambertMaterial({ color: colour, emissive });
      // Lit by the world's own weather, not only by its sun: the cloud deck's
      // moving shadow crosses the ground, and a figure that stays bright while
      // the ground darkens reads as pasted on to the photograph.
      return this.shared ? litLikeTheWorld(made, this.shared) : made;
    };
    // Kept so a texture can be dropped onto the right pieces once it arrives.
    this.cloth = { jacket: [], trousers: [], wing: [], rocket: [] };

    // Proportions as fractions of standing height, and they are a person's.
    //
    // They were Minecraft's, which is a different thing. Measured against real
    // anthropometry the figure was 1.68x too wide across the chest, 1.80x
    // across the shoulders and 2.09x across the hips — that is "why do I feel
    // so big", "the player size should match up" and "the player width does not
    // feel real".
    //
    // It is also why looking down in first person filled the screen with a wall
    // of cloth. Your own chest sits a quarter of a metre from your eye; at half
    // a metre wide it is not a chest you are looking at, it is a wall.
    //
    //   measure          was     now     a real person
    //   chest width      0.26    0.17    0.155
    //   chest depth      0.15    0.105   0.10
    //   shoulder span    0.415   0.231   0.23
    //   hip span         0.24    0.135   0.115
    //   head height      0.16    0.135   0.13
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.3, 0.105), mat(JACKET));
    this.torso.position.y = 0.66;
    body.add(this.torso);
    this.cloth.jacket.push(this.torso.material);

    // A neck. The chest tops out at 0.81 and the jaw starts at 0.832, so
    // without one there are twenty-two thousandths of a height — four
    // centimetres on a person — of open sky between the head and the
    // shoulders, and the head reads as floating above the body rather than
    // sitting on it.
    this.neck = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.045, 0.058), mat(SKIN));
    this.neck.position.y = 0.822;
    body.add(this.neck);

    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.135, 0.135), mat(SKIN));
    this.head.position.y = 0.9;
    body.add(this.head);

    // The crown lands on exactly 1.0, because the model is built one unit tall
    // and scaled by the player's height — a hair that stopped at 0.9775 made
    // everyone 2 cm shorter than the number they had set, and put the eye
    // fractionally higher up the skull than it belongs.
    const hairMat = mat(0x2f2a26);
    this.hair = new THREE.Mesh(new THREE.BoxGeometry(0.132, 0.045, 0.142), hairMat);
    this.hair.position.y = 1 - 0.045 / 2;
    body.add(this.hair);

    // Hair over the back of the skull as well as the top of it. From the chase
    // camera you spend most of your time looking at the back of your own head,
    // and a cap alone leaves that a blank tan box.
    this.hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.129, 0.105, 0.026), hairMat);
    this.hairBack.position.set(0, 0.912, 0.0605);
    body.add(this.hairBack);

    // Eyes. Two blocks and nothing else, but they are the difference between a
    // head and a tan box: a box has no front, so without them there was no
    // telling which way the figure faced at any distance at all. The model
    // faces -Z, so they sit a whisker proud of the front face and are children
    // of the head, which turns under them when you look about.
    const eyeGeo = new THREE.BoxGeometry(0.024, 0.017, 0.006);
    const eyeMat = mat(0x25201c);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(side * 0.029, 0.013, -0.0665);
      this.head.add(eye);
    }

    // Arms hang beside the chest, not inside it.
    //
    // At x = 0.088 with a chest 0.17 wide, the shoulder joint sat three
    // thousandths outside the jacket and 45 per cent of each arm was buried in
    // it — so the standing figure had no arms in silhouette at all, just a
    // slab with a head, and the firework appeared to float beside a shoulder
    // with nothing holding it. Biacromial breadth is 0.23 of stature, which
    // puts the joints at 0.115 and the inner face of the arm flush with the
    // side of the chest: the whole arm shows, and the shoulder still joins.
    this.armL = this.makeLimb(0.055, ARM_LENGTH, mat(SLEEVE), -0.115, 0.79);
    this.armR = this.makeLimb(0.055, ARM_LENGTH, mat(SLEEVE), 0.115, 0.79);

    // Hands, because a person has them and because a sleeve ending in mid-air
    // is where the firework appeared to be held by nothing. The wrist is at
    // 0.485 of stature and the fingertips at 0.38, which is what these are.
    const handGeo = new THREE.BoxGeometry(0.052, 0.09, 0.062);
    const handY = -0.15 - 0.045;
    this.fistL = new THREE.Mesh(handGeo, mat(SKIN));
    this.fistL.position.y = handY;
    this.armL.limb.add(this.fistL);
    this.fistR = new THREE.Mesh(handGeo, mat(SKIN));
    this.fistR.position.y = handY;
    this.armR.limb.add(this.fistR);
    // The legs reach the ground.
    //
    // They were 0.36 long from a hip at 0.51, so they stopped at 0.15 — a
    // sixth of a body height above the sole, twenty-seven centimetres on a
    // person. The boots were parked at 0.015 to 0.035 *below* the origin, so
    // the picture was a pair of boots buried to the ankle with a hand's span of
    // nothing between them and the trousers. That is "still floating or
    // underground, and the feet are separate", and it is both halves of it.
    //
    // Hip 0.51 (the underside of the torso), leg 0.46, boot 0.05: the boot top
    // meets the leg bottom at 0.05 and the sole lands on exactly 0. See the
    // boots below, which are positioned from these numbers rather than beside
    // them.
    //
    // Set apart far enough to be two of them. At x = 0.030 with a leg 0.062
    // wide the pair overlapped by two thousandths, so they drew as one column
    // of trouser from hip to floor — a figure standing on a plinth. Thigh
    // centres are about 0.045 of stature apart, which leaves 0.028 between
    // them: five centimetres of daylight on a person, and enough that the
    // glide tuck can bring the feet together without them passing through each
    // other.
    // 0.078 thick and set at 0.051, so the pair measures 0.180 across the
    // thighs against a bitrochanteric breadth of 0.191, with 44 mm of daylight
    // between them on a 1.83 m player. They were 0.062 at 0.030, which is both
    // too thin for a thigh and two thousandths short of the gap needed to be
    // two of anything: they intersected, and drew as one column of trouser
    // from hip to floor.
    this.legL = this.makeLimb(0.078, LEG_LENGTH, mat(TROUSERS), -0.051, HIP_Y);
    this.legR = this.makeLimb(0.078, LEG_LENGTH, mat(TROUSERS), 0.051, HIP_Y);
    body.add(this.armL.pivot, this.armR.pivot, this.legL.pivot, this.legR.pivot);
    this.cloth.jacket.push(this.armL.limb.material, this.armR.limb.material);
    this.cloth.trousers.push(this.legL.limb.material, this.legR.limb.material);

    // Toes point forward, which is -Z.
    //
    // A boot is a child of its leg, and the leg mesh is centred on itself, so
    // the offset that puts the boot's top against the leg's bottom is half the
    // leg plus half the boot. Derived rather than typed, because typing it is
    // how the boots ended up hanging a quarter of a metre clear of the legs.
    const bootGeo = new THREE.BoxGeometry(0.088, BOOT_HEIGHT, 0.135);
    const bootY = -(LEG_LENGTH + BOOT_HEIGHT) / 2;
    this.bootL = new THREE.Mesh(bootGeo, mat(BOOTS));
    this.bootL.position.set(0, bootY, -0.02);
    this.legL.limb.add(this.bootL);
    this.bootR = new THREE.Mesh(bootGeo, mat(BOOTS));
    this.bootR.position.set(0, bootY, -0.02);
    this.legR.limb.add(this.bootR);

    // Wings sit on the back, which is +Z.
    this.wings = new THREE.Group();
    // Behind the back, not inside it. The torso is 0.15 deep about its own
    // axis, so its back face is at 0.075 — parking the wings at 0.08 left five
    // thousandths of a height between them, which at human scale is a
    // centimetre, and the spars and the folded canvas ate straight through it.
    // That is the elytra "halfway in the player". A further four centimetres
    // clears the jacket at every pose.
    this.wings.position.set(0, 0.76, 0.092);
    body.add(this.wings);
    const wingMat = mat(WING, WING_FILL);
    // The membrane carries a gradient of its own — see shadeWing.
    wingMat.vertexColors = true;
    const wingEdge = mat(WING_EDGE, WING_FILL);
    this.wingL = this.makeWing(wingMat, wingEdge, -1);
    this.wingR = this.makeWing(wingMat, wingEdge, 1);
    this.wings.add(this.wingL, this.wingR);

    // The spine the two shells are hinged to.
    //
    // Without it the pair met at the centreline with nothing between them, and
    // from the chase camera — which is where you look at this from — the whole
    // thing read as one continuous sheet with a notch cut out of the top,
    // rather than as two wings worn on a back. A hang-glider, not an elytra.
    //
    // Sized off the roots rather than picked: the outline starts at WING_ROOT_X
    // either side, so the gap between the shells is exactly twice that, and the
    // spine fills it with a millimetre of daylight left at each edge so the
    // seam still reads. It spans the root chord, which is the outline's own
    // first and last y, and it stands a little proud of the shells so it
    // catches the light as a separate surface instead of disappearing into
    // them.
    const rootTop = 0.090;
    const rootBottom = -0.137;
    const spine = new THREE.Mesh(
      new THREE.BoxGeometry(WING_ROOT_X * 2 - 0.004, rootTop - rootBottom, 0.036),
      wingEdge,
    );
    spine.position.set(0, (rootTop + rootBottom) / 2, 0.012);
    this.wings.add(spine);
    this.spine = spine;

    this.cloth.wing.push(wingMat);

    // The selected rocket, in your right hand — the way Minecraft shows the
    // firework you are about to use. Visible in first person too, since the
    // arms are, so the slot you are on is readable without the HUD.
    const rocketMat = mat(ROCKET);
    this.noseMat = mat(0xffffff);
    this.rocket = this.makeRocket(rocketMat, this.noseMat, mat(0x6b5334));
    // The limb mesh is a box of its own length centred on its origin, so the
    // hand is at -length/2. The grip goes there; which way the rocket then
    // points is decided every frame by aimRocket.
    // In the fist, not up the sleeve: the grip sits at the centre of the hand
    // that closes around it, which is where the hand now is.
    // On the pivot, not on the sleeve.
    //
    // Visibility inherits, and the scanned body stands in for the sleeve — so
    // with the sleeve hidden the firework in the fist went with it. The pivot
    // is the shoulder joint and turns with the arm exactly as the sleeve does;
    // the sleeve is a box centred on its own length below it, so the same point
    // in the fist is that much further down from here. `aimRocket` reads the
    // pivot's world rotation for the same reason, and gets the same answer:
    // the sleeve carries an offset and no rotation of its own.
    this.rocket.position.set(0, ARM_LENGTH / -2 + handY, -0.02);
    this.armR.pivot.add(this.rocket);
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

    /**
     * How the arms sit in a first-person glide: how far the shoulder swings
     * and how wide the pair is set.
     *
     * Fields rather than constants because they cannot be reasoned out on
     * paper. Where a hand lands on screen depends on the camera's pitch and
     * the FOV of the moment as much as on the arm, so both were swept in the
     * running game with the camera the rig actually places — see
     * tools/probe.mjs. Guessing them from the model's own axis is what put the
     * hands eleven centimetres in front of a fifteen-centimetre near plane and
     * off both edges of the screen.
     */
    // Swept in the running game against four look angles. The screen position
    // came back identical at every one of them, which is the pose pivot doing
    // its job: it turns about the eye, so your hands stay where they are in the
    // frame however you pitch. At -3.05 and 0.26 the fist lands at (0.87, 0.41)
    // and the firework at (0.87, 0.35) — out at the edges, above the horizon
    // you are flying at rather than across it.
    this.glidePose = { reach: -3.05, spread: 0.26 };

    /**
     * How the open wings sit on your back.
     *
     * Three Euler angles rather than three numbers typed into the pose, because
     * what they produce is not what they look like: the wing is drawn in the
     * body's XY plane and then the whole body is laid face down, so a rotation
     * that reads as "tilt" on paper comes out as sweep in the air. They are
     * solved against the flight path instead — see tools/wingpose.mjs, which
     * reports the sweep and the dihedral a set of angles actually produces.
     */
    // Solved against the camera you actually watch from, which is the part
    // that was missing. 28 degrees of sweep along the mid-chord line, 5 of
    // dihedral so the tips sit above the shoulders rather than hanging below
    // them, and — the number that matters — a face 0.85 square to the chase
    // camera at every pitch from a climb to a steep dive.
    //
    // It was 40 degrees of sweep and *minus* 22 of dihedral, so the tips hung
    // 30 cm below the shoulders: a wing hanging off a body rather than one
    // holding it up. Fixing that alone gave a wing flat to the airflow and
    // 0.06 square to the camera — correct, and useless. The chase camera sits
    // 16 degrees above the flight line in level flight, so a horizontal wing
    // seen from there is a blade, and a blade has no shape to read: it looks
    // like it is on backwards or inside out because there is nothing in the
    // silhouette to say it is not. The wing is set at a real angle to the
    // airflow now, which is what a beetle's shell is and what Minecraft's
    // elytra are, and it is the surface you see rather than the edge.
    //
    // And then the search that found it was run inside a box that did not
    // contain the answer. Its first angle was pinned at the edge of the range
    // in every candidate it returned, which is what a boundary optimum looks
    // like, and past that edge there are poses that hold the tips *above* the
    // root at every pitch you fly at without giving up any of the face. Over
    // the pitches of a real glide — a shallow dive through to a climb — the
    // old pose ran -13.6, -9.2, -4.6, +3.4 degrees of dihedral: tips below the
    // root except when pulling up, which is a wing hanging off a body, and is
    // "it kinda looks backwards or upside down". This one runs +8.1 at worst,
    // sweeps 29.6 back, and is 0.88 square to the chase camera, which is what
    // the old one measured.
    this.wingPose = { x: 1.3, y: -0.5, z: -0.3 };

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
   * The extrusion alone was still a prism, though: one polygon pushed 14 mm
   * along Z, so every point on the top surface shared a normal and the whole
   * wing shaded as one flat colour whatever the light was doing. A pale board.
   * Real elytra are shells — they curve down and back from the shoulder — and
   * that curve is what puts a gradient across the surface and makes it read as
   * a wing rather than as a cut-out. So the extrusion is bent after the fact
   * and its normals recomputed from the geometry that results: one pass over a
   * few hundred floats at build time, and nothing at all per frame.
   *
   * The profile is drawn for the right wing and mirrored by negating x, so one
   * set of numbers describes both and they cannot drift apart.
   */
  makeWing(material, edgeMaterial, side) {
    const group = new THREE.Group();

    // Outline in fractions of standing height: x outboard from the spine, y
    // along the back with +y toward the shoulders.
    //
    //   span 0.475   root chord 0.215   tip chord 0.028   aspect 2.21:1
    //   spread 2 x 0.525 = 1.05 of standing height
    //
    // The tip is the point of it, in both senses. The previous outline put its
    // outermost vertex at 0.505 with neighbours at 0.009 and -0.145, so the
    // last fifth of the wing carried a chord of 0.154 — 28 cm of wing hanging
    // off the end. That is not a wingtip, it is a paddle. The tip chord is
    // 0.028 now, the leading edge runs almost straight out before it kinks
    // into the sweep, and the trailing edge carries its depth inboard where a
    // wing's depth belongs.
    //
    // It ran to x = 0.8 originally, so the pair spanned 1.60 of height — 2.9
    // metres on a 1.83 metre player, nine times his own width. That is a hang
    // glider, and from the chase camera it was the entire frame with a person
    // hanging under it as a detail. An elytron spans about as wide as its
    // wearer is tall, which is where the span comes from.
    //
    // The aspect ratio was reasoned out the same way — an elytron is about
    // 1.5:1 — and 1.5 came out looking like a moth. Depth is what does it: at
    // 1.5 the chord is two thirds of the span and the pair read as leaves
    // stuck on a back however the edges are drawn. Slenderness is what reads
    // as a wing, so it is 2.2. Both numbers are checked in the self-test,
    // because the silhouette is the character.
    const outline = [
      [0.050, 0.090], [0.230, 0.072], [0.400, 0.020], [0.525, -0.070],
      [0.510, -0.098], [0.330, -0.132], [0.170, -0.137], [0.050, -0.125],
    ];
    const shape = new THREE.Shape();
    shape.moveTo(side * outline[0][0], outline[0][1]);
    for (const [x, y] of outline.slice(1)) shape.lineTo(side * x, y);
    shape.closePath();

    const membrane = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: 0.012,
        bevelEnabled: true,
        bevelThickness: 0.003,
        bevelSize: 0.003,
        bevelSegments: 1,
        curveSegments: 1,
      }),
      material,
    );
    membrane.position.z = -0.006;
    shadeWing(membrane.geometry);
    // Extrusion runs along +Z and the outline is drawn in XY, which is already
    // the plane a wing lies in: outboard along X, along the back on Y. Then it
    // is bent out of that plane — see bendWing, and the comment on the method.
    bendWing(membrane.geometry);
    group.add(membrane);

    // The leading edge, darker and standing a little proud, built from the
    // outline's own front points so it follows the bend instead of cutting
    // across it. One straight bar over a curved wing is the join that gives a
    // flat plank away, and it is what the old single 0.8-long spar was.
    const front = outline.slice(0, 4).map(([x, y]) => bentPoint(side * x, y));
    for (let i = 0; i < front.length - 1; i += 1) {
      const a = front[i];
      const b = front[i + 1];
      const segment = new THREE.Mesh(
        new THREE.BoxGeometry(a.distanceTo(b), 0.024, 0.034),
        edgeMaterial,
      );
      segment.position.copy(a).lerp(b, 0.5);
      segment.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
      group.add(segment);
    }

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

      /*
        Paper is not a mirror and neither is a person.

        TRELLIS writes metallicFactor 1.0 with a metal-roughness map on
        everything it makes. A fully metallic surface has no diffuse colour at
        all — it shows you its reflections — so under a hemisphere light and a
        sun the photograph is barely visible through it. That is a property of
        the file rather than of the scan: the same fault was found and fixed in
        tools/glb-optimise.py, but this asset was made before that, so it is
        undone here at load instead of re-encoding a picture to get at one
        number.

        This was *not* the black smudging, though it was blamed for it and the
        blame survived a commit. The smudging was the mesh's normals arriving
        at a stride the file never declared — see assets/manifest.json — and
        this material change on its own left the figure exactly as blotchy as
        before. Two faults in one file, and fixing the visible one first is how
        you talk yourself into thinking the other is gone.
      */
      model.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        child.material = child.material.clone();
        child.material.metalness = 0;
        child.material.roughness = 0.85;
        child.material.metalnessMap = null;
        child.material.roughnessMap = null;
        child.material.side = THREE.DoubleSide;
        child.material.needsUpdate = true;
      });

      this.model = new THREE.Group();
      this.model.add(model);
      /*
        On the body, not on the root.

        The pose lives on `body` — it is rotated and moved every frame for the
        lean, the bank and the prone glide, about the eye. Hung off the root
        instead, the scan ignored all of it and stood bolt upright while
        gliding, which is most of what "it does not work with movement" is. It
        still cannot move an arm, because it has no skeleton; it can at least
        lie down when you are lying down, and lean when you lean.
      */
      this.body.add(this.model);
      this.applyModelMode();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The scanned firework, in place of the built one.
   *
   * The rocket is the one object on the character you look at from a hand's
   * breadth away — it is in your fist in first person, held up in front of the
   * camera — and it was five boxes. A generated mesh is worth having for
   * exactly that reason and for no other: it is a prop with no real-world
   * counterpart to fetch, so nothing invented is displacing anything measured.
   *
   * It goes inside the pivot the built one lives in rather than replacing it,
   * so every line that aims, holds and hides the rocket keeps working without
   * knowing which of the two is showing. The nose material still takes the
   * slot's colour; on the scanned one the whole mesh is tinted with it
   * instead, because a photograph of red and white paper has no separate nose
   * to recolour.
   */
  async loadRocketModel(base = ASSET_BASE) {
    if (globalThis.__TERRAGLIDE_INLINE_WORKER__) return false;
    if (!settings.get('detailedRocketModel')) return false;
    if (this.rocketModel) return true;
    try {
      const inline = globalThis.__TERRAGLIDE_REQUIRE__;
      const { GLTFLoader } = inline
        ? inline('vendor/three/loaders/GLTFLoader.js')
        : await import('../../vendor/three/loaders/GLTFLoader.js');
      const gltf = await new Promise((resolve, reject) =>
        new GLTFLoader().load(`${base}rocket.glb`, resolve, undefined, reject),
      );
      const mesh = gltf.scene;
      // The built rocket stands along +Y above the group origin, and the origin
      // is the grip — the point a fist closes around, a little below the middle
      // of the tube — because aiming then turns the thing in the hand instead
      // of swinging it round a point in mid-air. The scanned one was
      // photographed standing up, so it needs the same convention and nothing
      // else: every line that aims, holds and hides the rocket is untouched.
      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const scale = ROCKET_LEN / Math.max(size.y, 1e-6);
      mesh.scale.setScalar(scale);
      mesh.position.set(
        -centre.x * scale,
        -box.min.y * scale - ROCKET_GRIP,
        -centre.z * scale,
      );
      const held = new THREE.Group();
      held.add(mesh);
      this.rocketModel = held;
      this.rocketTints = [];
      mesh.traverse((child) => {
        if (!child.isMesh) return;
        child.material = child.material.clone();
        child.material.metalness = 0;
        child.material.roughness = 0.85;
        this.rocketTints.push(child.material);
      });
      this.rocket.add(held);
      this.handRocket?.add(held.clone(true));
      this.applyRocketModel();
      return true;
    } catch (err) {
      // Say so. A silent catch here is how "the player GLB never loads" stayed
      // a mystery for a week: the asset is optional, so failing is allowed, but
      // failing quietly means nobody can tell a missing file from a broken one.
      console.warn('TerraGlide: scanned firework not loaded —', err?.message ?? err);
      return false;
    }
  }

  /** Show one rocket or the other, never both. */
  applyRocketModel() {
    const useModel = !!this.rocketModel && settings.get('detailedRocketModel');
    for (const holder of [this.rocket, this.handRocket]) {
      if (!holder) continue;
      for (const child of holder.children) {
        // The generated one is the only Group in there; the built one is meshes.
        child.visible = child.isGroup ? useModel : !useModel;
      }
    }
    // Force the tint to be re-applied on the next frame.
    this.rocketColour = -1;
  }

  /**
   * Show whichever of the two bodies is wanted, and only that one — but a body
   * is not everything on it.
   *
   * This hid `body` outright, and the wings are a child of `body`, and so is
   * the arm the firework hangs from. So turning the scanned model on took the
   * elytra off your back and the rocket out of your hand: you glided with
   * nothing between you and the air. The scan stands in for a person, not for
   * their kit — nobody scanned your elytra — so only the person goes.
   *
   * The pose still comes from `body` either way. It is rotated and moved every
   * frame for the lean, the bank and the glide, and the scan hangs inside it,
   * so it has to stay visible whichever body is showing.
   */
  applyModelMode() {
    const useModel = !!this.model && settings.get('detailedPlayerModel') && !this.firstPerson;
    if (this.model) this.model.visible = useModel;
    for (const part of this.skin()) part.visible = !useModel;
    // The head is not this method's to show. First person takes it off so that
    // looking down shows your legs rather than the inside of your own skull,
    // and that decision outranks this one — which is only ever reached with the
    // scan off, because the scan is not used in first person at all.
    if (this.firstPerson) {
      this.head.visible = false;
      this.hair.visible = false;
      this.hairBack.visible = false;
    }
  }

  /** The parts a scanned body stands in for. Everything else is kit. */
  skin() {
    return [
      this.torso, this.neck, this.head, this.hair, this.hairBack,
      this.armL?.limb, this.armR?.limb, this.legL?.limb, this.legR?.limb,
    ].filter(Boolean);
  }

  /**
   * Optional kit textures from the assets folder. Same shape as the scenery
   * loader, and the same manifest, but with no provider gate: see the note by
   * WEAVE_MEAN for why the character is not held to the world's rule, and for
   * why what arrives is turned into a weave rather than used as a colour.
   * Missing files are not an error — the flat colours underneath are what a
   * garment is, and they are what the single-file build ships with.
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
          const weave = toWeave(texture.image);
          if (weave) texture.image = weave;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.needsUpdate = true;
          for (const material of this.cloth[part]) {
            // A repeat sized to the garment, not one image stretched over it.
            //
            // The wrapping was set to repeat and the repeat itself never was,
            // so it stayed at one — and a box's UVs run nought to one across
            // each face, which means the whole photograph of the weave was
            // spread over the whole chest. Magnified about fifty times, cloth
            // stops looking like cloth and starts looking like tarpaulin, which
            // is what you saw when you looked down at yourself.
            //
            // Each mesh gets its own copy so a sleeve and a chest, which are
            // very different sizes, both come out at the size of real fabric.
            const own = texture.clone();
            own.needsUpdate = true;
            const size = this.clothSizeOf(material);
            own.repeat.set(
              Math.max(1, Math.round(size.x * CLOTH_TILES_PER_HEIGHT)),
              Math.max(1, Math.round(size.y * CLOTH_TILES_PER_HEIGHT)),
            );
            material.map = own;
            material.needsUpdate = true;
          }
        },
        undefined,
        () => {},
      );
    }
  }

  /**
   * How big the garment on this material actually is, in body heights.
   *
   * Found by asking the body rather than by a table beside it, so reshaping a
   * limb reshapes its weave too.
   */
  clothSizeOf(material) {
    let found = { x: 0.2, y: 0.3 };
    this.root.traverse((object) => {
      if (object.material !== material || !object.geometry) return;
      object.geometry.computeBoundingBox();
      const box = object.geometry.boundingBox;
      found = {
        x: Math.max(box.max.x - box.min.x, box.max.z - box.min.z),
        y: box.max.y - box.min.y,
      };
    });
    return found;
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
    this.hairBack.visible = !firstPerson;
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

    // The model faces -Z, so the root turns by the negative of the bearing.
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
    // A barrel roll turns you, not just the view. Rolling the camera alone
    // left the figure flying serenely level while the horizon spun, which
    // reads as a broken camera rather than as a manoeuvre.
    const roll = this.rollSource ? this.rollSource() : 0;
    // On foot the body also banks with the grade across it. Standing along a
    // contour is what anyone does on a steep hillside, and standing upright out
    // of one is what a flagpole does.
    const bank = gliding || flying
      ? 0
      : clamp(sideSpeed * 0.05, -0.25, 0.25) - (player.groundBank ?? 0) * 0.45;
    this.body.rotation.z = roll ? roll : damp(this.body.rotation.z, bank, 8, dt);
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
    //
    // -1.85 was chosen to keep the firework off the lens and went too far the
    // other way: it left the hand four centimetres in front of the eye, and
    // the near plane is fifteen. Gliding in first person you saw nothing of
    // yourself at all — no arms, no hands, no rocket, just landscape.
    //
    // Swept for it instead of guessed. Your shoulder is a quarter of a metre
    // behind your eye when you are lying face down, so however far the arm
    // swings the hand can only get about 0.36 m in front of the camera, and it
    // peaks around -2.7. Past that it starts coming back.
    const reach = this.firstPerson ? this.glidePose.reach : -2.5;
    this.armL.pivot.rotation.x = this.armL.pivot.rotation.x * (1 - tuck) + reach * tuck;
    this.armR.pivot.rotation.x = this.armR.pivot.rotation.x * (1 - tuck) + reach * tuck;
    // In first person the arms are swept wider so they frame the view instead
    // of filling it — you should see the world, with your arms at the edges.
    // From outside they go wider still: a glider seen from behind is mostly
    // silhouette, and arms tight to the body turn it into a blob.
    //
    // Out, not across. An arm hangs along -Y from its shoulder, so a positive
    // Z rotation swings it toward +X — which for the *left* arm is over the
    // chest and out the other side. Both signs were that way round, so a
    // gliding figure crossed its arms in front of itself: the left hand
    // finished at x +0.26 and the right at -0.26, mirrored from where they
    // stand, and the firework held in the right hand appeared on the left of
    // the body with nothing near it. Which is a thing you can see in a
    // screenshot and cannot see in a wireframe, and is why the hands are
    // measured in the self-test now.
    //
    // 0.62 put the hand 0.58 m out at 0.25 m ahead, which is 66 degrees off the
    // view axis — outside the frame at every FOV the game offers, so widening
    // the arms to "frame the view" pushed them out of it. 0.32 lands them at
    // 50 degrees against a half-frame of 55 at the default 78 FOV: the hands
    // sit near the edges and the forearms sweep in from the corners, which is
    // the shape that was wanted.
    const spread = this.firstPerson ? this.glidePose.spread : 0.85;
    this.armL.pivot.rotation.z = -spread * tuck;
    this.armR.pivot.rotation.z = spread * tuck;

    // Legs together and trailing along the body, with a little bend at the
    // hip. Splayed straight legs read as two blocks end-on from behind, which
    // is exactly the angle you see yourself from in third person.
    this.legL.pivot.rotation.x -= 0.34 * tuck;
    this.legR.pivot.rotation.x -= 0.34 * tuck;
    //
    // Apart at the ankle, not crossed at it. Bringing the legs together was
    // meant to stop them reading as two blocks end-on; taken this far it did
    // the opposite. Each foot swings 50 mm and the hips are only 44 mm apart,
    // so the ankles crossed by 31 mm and the pair drew as one featureless
    // rectangle — which from directly behind is the largest thing on the
    // character. The other way round leaves 145 mm between the boots, which is
    // roughly what a person's feet do in the air and reads as a pair of legs.
    this.legL.pivot.rotation.z = this.legL.pivot.rotation.z * (1 - tuck) - 0.06 * tuck;
    this.legR.pivot.rotation.z = this.legR.pivot.rotation.z * (1 - tuck) + 0.06 * tuck;

    // The nose takes the colour of the slot you are on, so what is in your
    // hand and what is lit in the hotbar are visibly the same rocket.
    const slot = player.selectedSlot ?? 0;
    if (slot !== this.rocketColour) {
      this.rocketColour = slot;
      const colour = ROCKET_COLOURS[clamp(slot, 0, ROCKET_COLOURS.length - 1)];
      this.noseMat.color.set(colour);
      // The scanned one has no separate nose, so the whole of it takes the
      // slot's colour — lightly, so the paper still reads as paper.
      for (const material of this.rocketTints ?? []) {
        material.color.set(colour);
        material.color.lerp(WHITE_TINT, 0.55);
      }
    }

    const open = player.elytraDeployed ? Math.max(this.glideBlend, 0.6) : 0;
    // Wings are strapped to your back, and now that the pose turns about your
    // eyes rather than your ankles they are where a back is: directly behind
    // your head. Drawing them in first person put a metre of canvas through
    // the camera. You cannot see your own wings, so do not draw them.
    this.wings.visible = player.elytraDeployed && !this.firstPerson;
    const wing = this.wingPose;
    this.wingL.rotation.set(wing.x * open, -wing.y + 1.5 * (1 - open), wing.z * open);
    this.wingR.rotation.set(wing.x * open, wing.y - 1.5 * (1 - open), -wing.z * open);

    // The head keeps looking where you look, whatever the shoulders are doing.
    this.head.rotation.y = -neck;
    this.hair.rotation.y = -neck;
    this.hairBack.rotation.y = -neck;
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
    // Unless a scanned body is standing in for it, in which case this line was
    // quietly undoing the swap every frame and drawing the built chest inside
    // the scanned one.
    this.torso.visible = !(this.model && this.model.visible);
    /*
      Your legs stay on when you are gliding.

      They were hidden with the arms, and the arms had a reason: prone, the
      pose turns about your eye, so the shoulder arrives *at* the camera and
      an arm drawn from there is a slab across a fifth of the screen. None of
      that is true of a leg. A leg in a prone glide trails behind and below
      you, a good metre from the eye, which is exactly where the mod this
      copies puts it — look down while flying and your own boots are the thing
      that tells you you are a body in the air rather than a floating camera.
      Hiding them is why "can't see body when flying".

      hideWhatIsInYourEye is still the backstop, so an attitude nobody
      predicted cannot put a boot through the lens.
    */
    this.legL.pivot.visible = true;
    this.legR.pivot.visible = true;

    // Which arms you get depends on where your shoulders have ended up.
    //
    // Standing, the shoulder is a quarter of a metre below your eye and the
    // arm hangs down from it. Look down and there it is, at half a metre,
    // seen from the side — which is the whole reason the body is drawn at all,
    // and a view model would be a worse version of it.
    //
    // Prone in a glide the pose turns about your eye, so the shoulder arrives
    // *at* the camera and the arm reaches away from it. You are then looking
    // down the length of a 0.7 m box from its own root, and what that draws is
    // a flat slab across a fifth of the screen whatever it is coloured or lit
    // like — not an arm. No arm pose fixes it, because the problem is that the
    // camera is inside the shoulder.
    //
    // That is the case a view model exists for, and there has been one here
    // all along: hands drawn in view space at a distance chosen for the frame
    // rather than inherited from a skeleton. So the glide gets those, the
    // world arms come off with them so there is never a second pair, and the
    // world firework comes off too because the view model carries its own.
    this.armL.pivot.visible = !prone;
    this.armR.pivot.visible = !prone;
    this.viewModel.visible = prone;

    // The view model is placed in the frame rather than in the world, so it is
    // posed here rather than by the body pose above — and before aimRocket,
    // which turns the firework in a hand whose rotation this sets.
    //
    // It had stopped being called at all when the world arms took over. The
    // group sat at the camera's own origin, so switching back to it drew
    // nothing: every part of it was at (0, 0, 0), inside the near plane.
    if (this.viewModel.visible) this.updateHand(player, dt, camera);
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
    // The view model carries its own firework. Drawing the world one as well
    // is two fireworks, one of them inside your head.
    if (this.viewModel.visible) {
      if (this.rocket) this.rocket.visible = false;
      return;
    }
    this.root.updateMatrixWorld(true);
    const limit = TOO_CLOSE_M * (this.root.scale.x || 1);
    for (const part of [this.rocket]) {
      if (!part) continue;
      part.getWorldPosition(this._world);
      part.visible = this._world.distanceTo(camera.position) > limit;
    }
    // The legs are drawn in first person now, so they are guarded too — a hard
    // pull-up while looking over your shoulder is exactly the attitude no
    // single pose number predicts.
    for (const leg of [this.legL, this.legR]) {
      if (!leg?.pivot?.visible) continue;
      leg.limb.getWorldPosition(this._world);
      if (this._world.distanceTo(camera.position) <= limit) leg.pivot.visible = false;
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
    this.armR.pivot.getWorldQuaternion(this._holdQuat);
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

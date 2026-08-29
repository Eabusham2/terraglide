import * as THREE from '../../vendor/three/three.module.js';
import { cheats } from '../core/cheats.js';
import { clamp, damp } from '../core/math.js';
import { FixedStep, catchUpSteps } from '../core/perf.js';
import { settings } from '../core/settings.js';
import { TICK, stepGlide, stepRocket } from './elytra.js';

/**
 * Movement, collision and the two flight modes.
 *
 * Physics run on a fixed 20 Hz clock so the elytra constants behave the same on
 * a 30 Hz laptop and a 240 Hz monitor. Speed mode multiplies displacement rather
 * than forces, so a 2x burst covers twice the ground without making the aircraft
 * handle like a different machine.
 */

const GRAVITY = 32; // metres / second^2, Minecraft-flavoured rather than 9.81
/**
 * Minecraft's own ground speeds, converted from blocks per tick.
 *
 * Walking is 0.21585 b/t, sprinting 0.2806 and sneaking 0.06475 — 4.32, 5.61
 * and 1.30 metres a second. Sprinting used to be 8.2, which is a fast jog for
 * a helicopter and made every other number in the movement model a guess.
 */
const WALK_SPEED = 4.32;
const SPRINT_SPEED = 5.61;
const CROUCH_SPEED = 1.3;
/** 0.42 blocks per tick off the ground, which clears a block and a quarter. */
const JUMP_SPEED = 8.4;
/**
 * Minecraft's vertical drag: velocity is multiplied by 0.98 every tick after
 * gravity, which is what stops a fall accelerating forever and puts terminal
 * velocity at 3.92 blocks a tick — 78.4 m/s. Without it a long drop reached
 * speeds nothing in the game could survive or render, and the ground arrived
 * as a single frame.
 */
const FALL_DRAG_PER_TICK = 0.98;
const GROUND_ACCEL = 14;
const AIR_ACCEL = 2.4;
const SWIM_SPEED = 2.4;
const SWIM_SINK = 0.9;
const SWIM_RISE = 3.2;
const WATER_DRAG = 5.5;
/**
 * How soon after one jump press the next one may touch the wings.
 *
 * Only there to keep a single press from doing both jobs. The press that
 * launches you off the ground is spent on the jump; a hundredth of a second
 * later the feet have left the floor, and without this the *same* press would
 * come back round as an airborne press and open the wings from standing. Short
 * enough that a deliberate second tap is never swallowed.
 */
const WING_LOCKOUT_S = 0.12;
/** How long a jump press waits for a tick that finds you on the ground. */
const JUMP_BUFFER_S = 0.16;
/**
 * Further than a tick could possibly move you, so a gap this big means the
 * ground moved rather than you did — a teleport or a frame rebase. Terminal
 * velocity is 78 m/s and a tick is a twentieth of a second, so four metres is
 * the real ceiling; this leaves room for speed mode and every cheat at once.
 */
/**
 * How hard a fully banked wing turns you, radians a second.
 *
 * A quarter-turn every couple of seconds on its side, which is a wide, readable
 * arc rather than a pivot.
 */
const BANK_TURN = 0.8;
const RESYNC_M = 200;
/** How far the feet can be lifted per second when walking up a slope. */
const STEP_SMOOTHING = 12;
/** Creative flight, metres per second, cruise and sprint. */
const FLY_SPEED = 18;
const FLY_SPRINT = 46;

export class PlayerController {
  constructor({ player, terrain, buildings }) {
    this.player = player;
    this.terrain = terrain;
    this.buildings = buildings;
    this.fixed = new FixedStep(TICK);
    this.look = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    /** Where the player was at the start of the most recent physics tick. */
    this.prevPosition = new THREE.Vector3();
    this.lastGroundContact = 0;
    this.landedThisFrame = false;
    /** Jump-key bookkeeping, read at frame rate rather than tick rate. */
    this.clock = 0;
    this.jumpHeld = false;
    this.jumpQueued = false;
    this.jumpQueuedAt = -Infinity;
    this.lastJumpTap = -Infinity;
    /**
     * The last floor height that came from data rather than from a guess.
     *
     * Held so that flying into a square whose elevation has not arrived does
     * not drop the floor to sea level under you. See groundHeightAt.
     */
    this.lastKnownFloor = NaN;
  }

  /**
   * @param {number} dt seconds
   * @param {object} input {forward, back, left, right, jump, sprint, crouch}
   */
  update(dt, input) {
    const player = this.player;
    this.landedThisFrame = false;
    player.tickTimers(dt);

    // Jump is read here, once a frame, and not inside the fixed step. Physics
    // run at 20 Hz, so on a 60 Hz screen only one frame in three carries a
    // tick: an edge detected in there misses any press shorter than about
    // fifty milliseconds, and a *double* tap has to get two edges past the
    // same sieve. That is why tapping twice sometimes did nothing at all.
    this.readJumpEdges(dt, input);

    // A stretched clock needs proportionally more catch-up ticks per frame, or
    // the substep cap quietly swallows the extra speed on a slow machine.
    //
    // Sized from the same ceiling the frame clock clamps to, rather than from
    // a number of its own. It was five ticks — a quarter of a second — while
    // the frame clock allowed a second and a half, so below four frames a
    // second the game threw the difference away and ran in slow motion: at two
    // frames a second gravity was doing exactly half its job. See MAX_FRAME_S.
    this.fixed.maxSteps = catchUpSteps(TICK, cheats.gameSpeed);
    this.fixed.run(dt, (step) => this.tick(step, input));

    // Draw somewhere between the last two ticks rather than on the last one.
    // A tick moves you at most a few metres, so anything further apart than
    // that is a teleport or a rebase rather than motion, and is not something
    // to interpolate across.
    if (this.prevPosition.distanceToSquared(player.position) > RESYNC_M * RESYNC_M) {
      player.snapRender();
    } else {
      player.renderPosition.lerpVectors(
        this.prevPosition,
        player.position,
        clamp(this.fixed.alpha, 0, 1),
      );
    }

    player.syncGeo();
    player.groundHeight = this.groundHeightAt(player.position.x, player.position.z, player.position.y);
    this.readGroundSlope(player);
    // Under water the useful floor is the sea bed, not the surface above you.
    if (player.swimming) {
      player.groundHeight = Math.min(
        player.groundHeight,
        this.terrain.bedAt(player.position.x, player.position.z),
      );
    }
  }

  /**
   * How steep the ground is along the way you are facing.
   *
   * Measured over a couple of metres either side of you rather than from a
   * surface normal, because the mesh normal is per-vertex and a person is
   * longer than a vertex: what you want is the grade a walker feels, not the
   * tilt of the polygon under one boot.
   */
  readGroundSlope(player) {
    if (!player.onGround) {
      player.groundSlope = damp(player.groundSlope, 0, 6, 1 / 60);
      player.groundBank = damp(player.groundBank, 0, 6, 1 / 60);
      return;
    }
    const reach = Math.max(1, player.height * 0.8);
    const fx = Math.sin(player.yaw) * reach;
    const fz = -Math.cos(player.yaw) * reach;
    const ahead = this.terrain.heightAt(player.position.x + fx, player.position.z + fz);
    const behind = this.terrain.heightAt(player.position.x - fx, player.position.z - fz);
    const target = clamp(Math.atan2(ahead - behind, reach * 2), -0.7, 0.7);
    player.groundSlope = damp(player.groundSlope, target, 8, 1 / 60);

    // And the grade *across* you, which is the other half of standing on a
    // hillside and the half that was missing.
    //
    // Only the fore-and-aft grade was measured, so walking along a contour —
    // which is what anyone does on a steep slope, because it is the only way
    // up one — read as flat: the figure stood bolt upright out of the hill
    // with one boot in the air and the other buried. A person standing across
    // a slope tilts, and one foot is higher than the other. Same fraction as
    // the lean, for the same reason: a walker takes up some of the grade in
    // their ankles rather than all of it in their spine.
    const rx = Math.cos(player.yaw) * reach;
    const rz = Math.sin(player.yaw) * reach;
    const right = this.terrain.heightAt(player.position.x + rx, player.position.z + rz);
    const left = this.terrain.heightAt(player.position.x - rx, player.position.z - rz);
    const bank = clamp(Math.atan2(right - left, reach * 2), -0.7, 0.7);
    player.groundBank = damp(player.groundBank, bank, 8, 1 / 60);
  }

  tick(step, input) {
    const player = this.player;
    this.prevPosition.copy(player.position);
    const scale = player.scale;
    player.lookVector(this.look);

    const flying = cheats.fly;
    const gliding = !flying && player.elytraDeployed && !player.onGround;
    player.mode = flying ? 'fly' : gliding ? 'glide' : player.onGround ? 'walk' : 'fall';

    if (flying) this.tickFly(step, input, scale);
    else if (gliding) this.tickGlide(step, input);
    else this.tickGround(step, input, scale);

    // Speed mode stretches distance covered, not the handling model.
    const multiplier = player.speedMultiplier;
    player.position.x += player.velocity.x * step * multiplier;
    player.position.y += player.velocity.y * step * multiplier;
    player.position.z += player.velocity.z * step * multiplier;
    player.distanceTravelled += player.velocity.length() * step * multiplier;
    // How far this tick's gravity dropped the feet. The ground resolve needs
    // it to tell a step in the terrain apart from its own settling; see the
    // note there.
    this.fallThisTick = Math.max(0, -player.velocity.y * step * multiplier);

    this.resolveCollisions(step, input);
  }

  tickGlide(step, input) {
    const player = this.player;

    // One push per firework still burning, not one for the last one lit. See
    // Player.burnRockets — this is what makes spamming them worth anything.
    player.burnRockets((power, spent) => {
      stepRocket(player.velocity, this.look, power, spent);
    });

    // One set of wings. See src/player/elytra.js.
    stepGlide(player.velocity, this.look, player.pitch);
    player.airborneSeconds += step;

    // A banked wing turns you, which is the whole reason to roll one.
    //
    // Lift acts along the wing's own up, so tipping it over points part of that
    // lift sideways and the flight path curves — that is what an aircraft does,
    // and it is what the mod this is copied from does. Without it a roll is a
    // camera trick: the horizon tilts and you carry on in a straight line.
    //
    // Scaled by how fast you are going, because a wing with no air over it
    // turns nothing, and capped so a full inversion does not spin you.
    if (player.roll) {
      const bite = Math.min(1, player.horizontalSpeed / 28);
      player.yaw += Math.sin(player.roll) * BANK_TURN * bite * step;
    }

    // Crouch pulls the nose down a touch — handy for shedding altitude.
    if (input.crouch) player.velocity.y -= 4 * step;
  }

  /**
   * Creative flight (a cheat). No gravity, no wings: you move along your look
   * vector, jump and crouch trade height, and sprint makes it a cruise missile.
   */
  tickFly(step, input, scale) {
    const player = this.player;
    const strideScale = Math.pow(scale, 0.75);
    const speed = (input.sprint ? FLY_SPRINT : FLY_SPEED) * strideScale;

    const forward = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);

    let tx = this.look.x * forward + cos * strafe;
    let ty = this.look.y * forward;
    let tz = this.look.z * forward + sin * strafe;
    const length = Math.hypot(tx, ty, tz);
    if (length > 0) {
      tx = (tx / length) * speed;
      ty = (ty / length) * speed;
      tz = (tz / length) * speed;
    }
    if (input.jump) ty += speed * 0.7;
    if (input.crouch) ty -= speed * 0.7;

    player.velocity.x = damp(player.velocity.x, tx, 9, step);
    player.velocity.y = damp(player.velocity.y, ty, 9, step);
    player.velocity.z = damp(player.velocity.z, tz, 9, step);

    player.airborneSeconds = 0;
    player.stopRockets();
  }

  tickGround(step, input, scale) {
    const player = this.player;
    const strideScale = Math.pow(scale, 0.75);
    const swimming = player.swimming;

    let speed = swimming ? SWIM_SPEED : WALK_SPEED;
    if (!swimming && input.sprint) speed = SPRINT_SPEED;
    if (!swimming && input.crouch) speed = CROUCH_SPEED;
    if (swimming && input.sprint) speed = SWIM_SPEED * 1.7;
    speed *= strideScale;

    const forward = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let targetX = 0;
    let targetZ = 0;
    if (forward !== 0 || strafe !== 0) {
      const length = Math.hypot(forward, strafe);
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      const fx = (sin * forward) / length;
      const fz = (-cos * forward) / length;
      const sx = (cos * strafe) / length;
      const sz = (sin * strafe) / length;
      targetX = (fx + sx) * speed;
      targetZ = (fz + sz) * speed;
    }

    const accel = swimming ? WATER_DRAG : player.onGround ? GROUND_ACCEL : AIR_ACCEL;
    player.velocity.x = damp(player.velocity.x, targetX, accel, step);
    player.velocity.z = damp(player.velocity.z, targetZ, accel, step);

    if (swimming) {
      // Treading water: rise on jump, sink on crouch, otherwise float.
      const target = input.jump
        ? SWIM_RISE * strideScale
        : input.crouch
          ? -SWIM_RISE * strideScale
          : -SWIM_SINK;
      player.velocity.y = damp(player.velocity.y, target, WATER_DRAG, step);
    } else {
      player.velocity.y -= GRAVITY * step;
      // Drag on the fall, so terminal velocity exists. Raised to the power of
      // the step so it is the same 0.98 a tick whatever the frame rate.
      player.velocity.y *= Math.pow(FALL_DRAG_PER_TICK, step / TICK);
      if (player.onGround && (input.jump || this.jumpQueued)) {
        player.velocity.y = JUMP_SPEED * Math.sqrt(scale);
        player.onGround = false;
        this.jumpQueued = false;
      }
    }

    if (player.onGround) {
      player.airborneSeconds = 0;
      player.stopRockets();
    } else {
      player.airborneSeconds += step;
    }
  }

  /**
   * The jump key's edges: buffer one press for the next ground tick, and let a
   * press made in the air open the wings — or close them again.
   *
   * This is Minecraft's own rule, and it is worth spelling out because the
   * obvious reading of "double jump" is the wrong one. Pressing jump on the
   * ground jumps; pressing it *again while off the ground* opens the wings.
   * Two presses in total, which is what a double jump is — not two presses
   * after you are already airborne, which is four presses from standing and is
   * why the wings would not come out.
   *
   * Holding the key does nothing on its own: only the press edge counts, and
   * an ordinary jump ends with the key still held, so the wings never snap out
   * unasked. Pressing it once more in a glide stows them, exactly as it does
   * in the game this borrows from.
   */
  readJumpEdges(dt, input) {
    const player = this.player;
    this.clock += dt;
    if (this.jumpQueued && this.clock - this.jumpQueuedAt > JUMP_BUFFER_S) this.jumpQueued = false;

    const edge = !!input.jump && !this.jumpHeld;
    this.jumpHeld = !!input.jump;
    // The input layer counts presses, so a frame slow enough to hold two taps
    // reports two rather than one. Falling back to the edge keeps this working
    // for anything that feeds the controller a plain snapshot — the autopilot,
    // the touch pad, and the tests.
    const presses = Math.max(edge ? 1 : 0, input.jumpPresses ?? 0);

    for (let i = 0; i < presses; i++) {
      if (cheats.fly) {
        // While the fly cheat is on, jump is the ascend key and nothing else.
        //
        // Without this it was also the wings key, because the branch below only
        // asks whether you are off the ground and flying always is: one press
        // of ascend deployed the elytra behind your back. You could not see it
        // — the fly tick draws and moves you the same either way — but it made
        // rockets lightable in a mode that has no use for them, and the moment
        // you turned the cheat off you were gliding instead of falling, from
        // wherever you happened to be.
        this.lastJumpTap = this.clock;
        continue;
      }
      if (!player.onGround) {
        // A press made in the air is about the wings, never about jumping.
        // Guard the frame you leave the ground on: the buffered jump has not
        // been spent yet, and toggling on the same press that launched you
        // would open the wings from standing.
        if (this.clock - this.lastJumpTap < WING_LOCKOUT_S) continue;
        // Opens the wings. Never closes them.
        //
        // This was a toggle, and a toggle is what "pressing jump breaks it"
        // was: gliding along at 1.4 m/s down, one press of the key you jump
        // with, and the wings shut and you are falling at 16. Minecraft does
        // not do that — space deploys an elytra and pressing it again while
        // you are gliding does nothing at all. You stow the wings by landing,
        // or with the key that is for stowing them.
        if (!player.elytraDeployed) player.toggleElytra(true);
        this.lastJumpTap = this.clock;
        continue;
      }
      this.lastJumpTap = this.clock;
      // Held for the next tick that finds you on the ground, so a tap made
      // between ticks — or a fraction of a second before you land — still
      // jumps.
      this.jumpQueued = true;
      this.jumpQueuedAt = this.clock;
    }
  }

  resolveCollisions(step, input) {
    const player = this.player;
    const radius = player.radius;
    const height = player.height;
    const stepUp = Math.max(0.35, height * 0.3);


    if (cheats.noclip) {
      // Nothing stops you: no walls, no floor, not even the sea.
      player.groundHeight = this.terrain.heightAt(player.position.x, player.position.z);
      player.onGround = false;
      player.swimming = false;
      return;
    }

    const colliders = this.buildings
      ? this.buildings.collidersNear(player.position.x, player.position.z, radius + 1.5)
      : [];

    // Walls: push the capsule out of any segment it has entered.
    for (const collider of colliders) {
      const feet = player.position.y;
      const head = feet + height;
      if (head < collider.base || feet > collider.top) continue;

      for (const seg of collider.segments) {
        const closest = closestPointOnSegment(
          player.position.x,
          player.position.z,
          seg[0],
          seg[1],
          seg[2],
          seg[3],
        );
        const dx = player.position.x - closest.x;
        const dz = player.position.z - closest.z;
        const distance = Math.hypot(dx, dz);
        if (distance >= radius || distance === 0) continue;
        // Do not push through a wall segment we are standing above.
        if (feet > collider.top - 0.2) continue;
        const push = (radius - distance) / distance;
        player.position.x += dx * push;
        player.position.z += dz * push;
        const normalDot = (player.velocity.x * dx + player.velocity.z * dz) / distance;
        if (normalDot < 0) {
          player.velocity.x -= (normalDot * dx) / distance;
          player.velocity.z -= (normalDot * dz) / distance;
        }
      }

      // A building is solid. Standing inside the footprint below the roof can
      // only happen by being put there, so it lifts you out onto the roof
      // rather than trapping you in a box with no door.
      if (
        player.position.y < collider.top
        && pointInPolygon(player.position.x, player.position.z, collider.polygon)
      ) {
        player.position.y = collider.top;
        if (player.velocity.y < 0) player.velocity.y = 0;
      }
    }

    const ground = this.groundHeightAt(
      player.position.x,
      player.position.z,
      player.position.y + stepUp,
      colliders,
    );
    player.groundHeight = ground;

    if (cheats.fly) {
      // Flying still lands on solid ground rather than sinking into it.
      if (player.position.y < ground) {
        player.position.y = ground;
        if (player.velocity.y < 0) player.velocity.y = 0;
      }
      player.onGround = false;
      player.swimming = false;
      return;
    }

    // Swimming: the sea sits at height zero, so anything below it is water.
    // Once you are in it the floor becomes the sea bed rather than the surface,
    // which is what lets you dive instead of standing on the water.
    const bed = this.terrain.bedAt(player.position.x, player.position.z);
    player.swimming = -bed > 0.6 && player.position.y < height * 0.55 && !player.elytraDeployed;
    const floor = player.swimming ? Math.min(ground, bed) : ground;
    if (player.swimming) player.groundHeight = floor;

    if (player.position.y <= floor + 0.001) {
      // Walking uphill lifts the feet over a step or two rather than snapping,
      // which is what made short slopes feel like stairs before.
      const rise = floor - player.position.y;
      // Standing perfectly still, gravity still pulls the feet a few
      // centimetres under the floor every tick and this resolve puts them
      // back. That is not a step, and smoothing it was why you stood a hand's
      // width *into* the ground for as long as you stood anywhere: the damp
      // recovered less than half the drop, the next tick took it again, and
      // the pair settled about ten centimetres down. Only the part of the rise
      // that this tick's fall cannot account for is a step to be climbed.
      const settling = (this.fallThisTick ?? 0) + 0.01;
      if (player.onGround && rise > settling && rise < stepUp) {
        player.position.y = damp(player.position.y, floor, STEP_SMOOTHING, step);
        if (floor - player.position.y < 0.02) player.position.y = floor;
      } else {
        player.position.y = floor;
      }
      if (player.velocity.y < 0) player.velocity.y = 0;
      if (!player.onGround) this.landedThisFrame = true;
      player.onGround = true;
      if (player.elytraDeployed) player.toggleElytra(false);
      // Friction on touchdown so a fast landing does not skate forever.
      if (!input.forward && !input.back && !input.left && !input.right) {
        player.velocity.x = damp(player.velocity.x, 0, 8, step);
        player.velocity.z = damp(player.velocity.z, 0, 8, step);
      }
    } else {
      player.onGround = false;
    }
  }

  /** Highest walkable surface under a point: the terrain, or a building roof. */
  groundHeightAt(x, z, referenceY, colliders) {
    let ground = this.terrain.heightAt(x, z);

    // Stand on the ground you can see.
    //
    // Two different things go wrong here and they need the same answer. The
    // small one: the elevation field is finer than the mesh built from it, so
    // on broken ground the drawn surface sits a little above the sampled
    // height, and standing at the sample leaves you shin-deep in a hill. The
    // large one: the field for a square can be *missing* — never fetched, or
    // evicted from under you — and a missing sample reads back as exactly sea
    // level while the mesh you are looking at is still four hundred metres up.
    //
    // This used to only trust the mesh when the two agreed to within
    // twenty-five metres, which handled the first case and made the second one
    // worse: the bigger the disagreement, the more certain it is that the
    // field is the one that is wrong, and that is precisely when the clamp
    // gave up and dropped you through the world. The mesh is what exists.
    if (this.terrain.meshHeightAt) {
      const drawn = this.terrain.meshHeightAt(x, z);
      if (drawn !== null && drawn > ground) ground = drawn;
      // Nothing drawn here at all — the tile has not been built yet. Sea level
      // is a guess, and it is the one guess that drops you inside a mountain,
      // so carry the last floor we actually stood on instead until the ground
      // arrives. Only while it is genuinely unknown: real sea is measured, and
      // measured sea reads as data.
      else if (drawn === null && !this.terrain.hasElevationAt(x, z)) {
        if (Number.isFinite(this.lastKnownFloor)) ground = Math.max(ground, this.lastKnownFloor);
      } else {
        this.lastKnownFloor = ground;
      }
    }
    const list =
      colliders ?? (this.buildings ? this.buildings.collidersNear(x, z, this.player.radius + 1) : []);

    for (const collider of list) {
      if (!pointInPolygon(x, z, collider.polygon)) continue;
      // Solid: the ground inside a footprint is its roof, at any height.
      ground = Math.max(ground, collider.top);
    }
    return ground;
  }
}

function closestPointOnSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) return { x: ax, z: az };
  let t = ((px - ax) * dx + (pz - az) * dz) / lengthSq;
  t = clamp(t, 0, 1);
  return { x: ax + dx * t, z: az + dz * t };
}

function pointInPolygon(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const zi = polygon[i][1];
    const xj = polygon[j][0];
    const zj = polygon[j][1];
    const intersects = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export { pointInPolygon };

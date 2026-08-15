import * as THREE from '../../vendor/three/three.module.js';
import { cheats } from '../core/cheats.js';
import { clamp, damp } from '../core/math.js';
import { FixedStep } from '../core/perf.js';
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
const WALK_SPEED = 4.3;
const SPRINT_SPEED = 8.2;
const CROUCH_SPEED = 1.7;
const JUMP_SPEED = 8.4;
const GROUND_ACCEL = 14;
const AIR_ACCEL = 2.4;
const CLIMB_SPEED = 3.4;
const SWIM_SPEED = 2.4;
const SWIM_SINK = 0.9;
const SWIM_RISE = 3.2;
const WATER_DRAG = 5.5;
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
    this.fixed = new FixedStep(TICK, 5);
    this.look = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.lastGroundContact = 0;
    this.landedThisFrame = false;
    this.climbing = false;
  }

  /**
   * @param {number} dt seconds
   * @param {object} input {forward, back, left, right, jump, sprint, crouch}
   */
  update(dt, input) {
    const player = this.player;
    this.landedThisFrame = false;
    player.tickTimers(dt);

    // A stretched clock needs proportionally more catch-up ticks per frame, or
    // the substep cap quietly swallows the extra speed on a slow machine.
    this.fixed.maxSteps = Math.ceil(5 * Math.max(1, cheats.gameSpeed));
    this.fixed.run(dt, (step) => this.tick(step, input));

    player.syncGeo();
    player.groundHeight = this.groundHeightAt(player.position.x, player.position.z, player.position.y);
    // Under water the useful floor is the sea bed, not the surface above you.
    if (player.swimming) {
      player.groundHeight = Math.min(
        player.groundHeight,
        this.terrain.bedAt(player.position.x, player.position.z),
      );
    }
  }

  tick(step, input) {
    const player = this.player;
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

    this.resolveCollisions(step, input);
  }

  tickGlide(step, input) {
    const player = this.player;

    if (player.rocketTicksLeft > 0) {
      stepRocket(player.velocity, this.look, player.rocketPower, player.rocketSpent);
      player.rocketTicksLeft--;
    }

    stepGlide(player.velocity, this.look, player.pitch);
    player.airborneSeconds += step;

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
    player.rocketTicksLeft = 0;
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
    } else if (this.climbing) {
      // Stair shaft: hold jump to go up, crouch to come down.
      player.velocity.y = input.jump
        ? CLIMB_SPEED * strideScale
        : input.crouch
          ? -CLIMB_SPEED * strideScale
          : 0;
    } else {
      player.velocity.y -= GRAVITY * step;
      if (player.onGround && input.jump) {
        player.velocity.y = JUMP_SPEED * Math.sqrt(scale);
        player.onGround = false;
      }
    }

    if (player.onGround) {
      player.airborneSeconds = 0;
      player.rocketTicksLeft = 0;
    } else {
      player.airborneSeconds += step;
      // Falling with jump held snaps the wings open, like the real thing.
      if (input.jump && player.velocity.y < -2 && player.airborneSeconds > 0.25) {
        player.toggleElytra(true);
      }
    }
  }

  resolveCollisions(step, input) {
    const player = this.player;
    const radius = player.radius;
    const height = player.height;
    const stepUp = Math.max(0.35, height * 0.3);

    this.climbing = false;
    player.inBuilding = false;

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

      if (pointInPolygon(player.position.x, player.position.z, collider.polygon)) {
        player.inBuilding = player.position.y < collider.top - 0.5;
        if (collider.stair) {
          const d = Math.hypot(
            player.position.x - collider.stair.x,
            player.position.z - collider.stair.z,
          );
          if (d < 1.5 + radius && (input.jump || input.crouch) && player.position.y < collider.top) {
            this.climbing = true;
          }
        }
        // Ceilings: do not let the head pass up through a slab.
        for (const floorY of collider.floors) {
          const head = player.position.y + height;
          if (floorY > player.position.y + 0.2 && floorY < head) {
            player.position.y = floorY - height - 0.02;
            if (player.velocity.y > 0) player.velocity.y = 0;
          }
        }
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
      if (player.onGround && rise > 0 && rise < stepUp) {
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

  /**
   * Highest walkable surface under a point: terrain, a building roof, or an
   * interior floor slab.
   */
  groundHeightAt(x, z, referenceY, colliders) {
    let ground = this.terrain.heightAt(x, z);
    const list =
      colliders ?? (this.buildings ? this.buildings.collidersNear(x, z, this.player.radius + 1) : []);

    for (const collider of list) {
      if (!pointInPolygon(x, z, collider.polygon)) continue;
      if (referenceY >= collider.top - 0.05) {
        ground = Math.max(ground, collider.top);
        continue;
      }
      for (const floorY of collider.floors) {
        if (floorY <= referenceY + 0.05 && floorY > ground) ground = floorY;
      }
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

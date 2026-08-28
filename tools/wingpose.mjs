#!/usr/bin/env node
/**
 * What attitude the open wings actually fly at.
 *
 * The wing is drawn in the body's XY plane and the whole body is then laid
 * face down, so the three Euler angles on the wing group do not mean on paper
 * what they produce in the air: the one that reads as "tilt" comes out as
 * sweep, and the one that reads as "cant" comes out as something else again.
 * Working them out by hand got the signs wrong twice.
 *
 * So they are measured. This poses a level glide — flight along -Z, up along
 * +Y — and reports, for each candidate set of angles, the two numbers that
 * decide whether a wing looks like a wing:
 *
 *   sweep     how far back the tip sits from the root, as an angle
 *   dihedral  how far up. Positive is tips above the root, which is what a
 *             gliding bird does; negative is tips below, which is what a dead
 *             one does, and is what these were doing at -22 degrees.
 *
 *   node tools/wingpose.mjs            report the pose in the file
 *   node tools/wingpose.mjs --sweep    search for a target attitude
 */
import * as THREE from '../vendor/three/three.module.js';
import { Avatar } from '../src/player/avatar.js';

const scene = new THREE.Scene();
const avatar = new Avatar(scene);
avatar.setVisible(true);

const player = (pitch = 0) => ({
  pitchOverride: pitch,
  position: new THREE.Vector3(), renderPosition: new THREE.Vector3(),
  velocity: new THREE.Vector3(0, 0, -45), height: 1.83, scale: 1,
  pitch, yaw: 0, mode: 'glide', onGround: false, swimming: false,
  groundSlope: 0, elytraDeployed: true, horizontalSpeed: 45,
  selectedSlot: 0, rocketsFired: 0,
});

/** Sweep and dihedral, in degrees, for the pose currently set. */
let settleFrames = 400;
function attitude(pitch = 0) {
  const p = player(pitch);
  p.velocity.set(0, -45 * Math.sin(-pitch), -45 * Math.cos(pitch));
  for (let i = 0; i < settleFrames; i += 1) avatar.update(p, 1 / 60);
  scene.updateMatrixWorld(true);
  const mesh = avatar.wingR.children[0];
  const position = mesh.geometry.getAttribute('position');
  // Sweep is the angle of the *mid-chord line*, root to tip. Taking one
  // extreme vertex at each end instead measures whichever corner happened to
  // be found first, so changing the outline's tip shape moved a number that
  // describes the wing's attitude — they are different things and the first
  // version of this confused them.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < position.count; i += 1) {
    lo = Math.min(lo, position.getX(i));
    hi = Math.max(hi, position.getX(i));
  }
  const band = (from, to) => {
    const mid = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      if (x < from || x > to) continue;
      mid.add(new THREE.Vector3(x, position.getY(i), position.getZ(i))
        .applyMatrix4(mesh.matrixWorld));
      n += 1;
    }
    return n ? mid.divideScalar(n) : null;
  };
  const width = hi - lo;
  const root = band(lo, lo + width * 0.15);
  const tip = band(hi - width * 0.15, hi);
  const out = tip.x - root.x;
  const back = tip.z - root.z;
  const up = tip.y - root.y;
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
  // How square the wing is to the chase camera. A wing can be perfectly flat
  // to the air and still be a blade on screen if the body's pitch has turned
  // its face away from where you are watching from — so this uses the rig's
  // own offset rather than a fixed direction, because the chase camera climbs
  // as you dive. See CameraRig.update.
  const toCamera = new THREE.Vector3(0, -Math.sin(pitch) + 0.28, Math.cos(pitch)).normalize();
  return {
    sweep: (Math.atan2(back, out) * 180) / Math.PI,
    dihedral: (Math.atan2(up, out) * 180) / Math.PI,
    flat: Math.abs(normal.y),
    seen: Math.abs(normal.dot(toCamera)),
  };
}

const line = (label, a) => console.log(
  `${label.padEnd(22)} sweep ${a.sweep.toFixed(1).padStart(6)}°`
  + `  dihedral ${a.dihedral.toFixed(1).padStart(6)}°`
  + `  face-up ${a.flat.toFixed(2)}`
  + `  seen-from-chase ${a.seen.toFixed(2)}`);

if (!process.argv.includes('--sweep')) {
  for (const pitch of [0.2, 0, -0.25, -0.5, -0.8]) {
    line(`pitch ${pitch.toFixed(2)}`, attitude(pitch));
  }
  console.log('\n  a gliding bird sweeps 25-35° back and holds 3-8° of dihedral;');
  console.log('  negative dihedral is a wing hanging off a body, not holding it up.');
} else {
  // Solve for a wing you can actually see.
  //
  // The first pass here aimed at a gliding bird — 25-35 degrees of sweep and a
  // few degrees of dihedral — and produced a wing that is edge-on to the chase
  // camera at every pitch you fly at. Which is correct, and useless: a flat
  // horizontal wing seen from behind is a blade, and a blade has no shape to
  // read, so it looks like it is on backwards or inside out because there is
  // nothing there to say it is not.
  //
  // The chase camera sits 16 degrees above the flight line in level flight and
  // climbs to 55 in a dive, so the surface has to be canted well up to face it.
  // That is what Minecraft's elytra do and why they read as a pair of shells:
  // they make a steep V, not a wing plane.
  const PITCHES = [0.1, -0.3, -0.7];
  const results = [];
  const floor = Number(process.argv.find((a) => a.startsWith('--dihedral='))?.slice(11) ?? -90);
  settleFrames = 90;
  for (let x = -0.8; x <= 0.9; x += 0.1) {
    for (let y = -0.8; y <= 0.6; y += 0.1) {
      for (let z = -0.2; z <= 0.9; z += 0.1) {
        avatar.wingPose = { x, y, z };
        const all = PITCHES.map((p) => attitude(p));
        const sweep = all.reduce((t, a) => t + a.sweep, 0) / all.length;
        if (sweep < 20 || sweep > 36) continue;
        if (all[1].dihedral < floor) continue;
        // The worst angle matters more than the average: a wing that vanishes
        // in a dive is a wing that vanishes exactly when you are looking at it.
        const worst = Math.min(...all.map((a) => a.seen));
        const mean = all.reduce((t, a) => t + a.seen, 0) / all.length;
        results.push({ x, y, z, sweep, worst, mean,
          dihedral: all[1].dihedral, score: worst * 2 + mean });
      }
    }
  }
  results.sort((p, q) => q.score - p.score);
  console.log('most visible from the chase camera, holding 20-36 degrees of sweep:\n');
  console.log(`${'x'.padStart(5)} ${'y'.padStart(5)} ${'z'.padStart(5)}`
    + `   sweep  dihedral   seen worst   seen mean`);
  for (const r of results.slice(0, 10)) {
    console.log(`${r.x.toFixed(2).padStart(5)} ${r.y.toFixed(2).padStart(5)} ${r.z.toFixed(2).padStart(5)}`
      + `  ${r.sweep.toFixed(1).padStart(5)}°  ${r.dihedral.toFixed(1).padStart(7)}°`
      + `  ${r.worst.toFixed(2).padStart(10)}  ${r.mean.toFixed(2).padStart(10)}`);
  }
}

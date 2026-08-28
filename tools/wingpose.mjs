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

const player = () => ({
  position: new THREE.Vector3(), renderPosition: new THREE.Vector3(),
  velocity: new THREE.Vector3(0, 0, -45), height: 1.83, scale: 1,
  pitch: 0, yaw: 0, mode: 'glide', onGround: false, swimming: false,
  groundSlope: 0, elytraDeployed: true, horizontalSpeed: 45,
  selectedSlot: 0, rocketsFired: 0,
});

/** Sweep and dihedral, in degrees, for the pose currently set. */
function attitude() {
  const p = player();
  for (let i = 0; i < 400; i += 1) avatar.update(p, 1 / 60);
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
  return {
    sweep: (Math.atan2(back, out) * 180) / Math.PI,
    dihedral: (Math.atan2(up, out) * 180) / Math.PI,
    flat: Math.abs(normal.y),
  };
}

const line = (label, a) => console.log(
  `${label.padEnd(22)} sweep ${a.sweep.toFixed(1).padStart(6)}°`
  + `  dihedral ${a.dihedral.toFixed(1).padStart(6)}°`
  + `  face-up ${a.flat.toFixed(2)}`);

if (!process.argv.includes('--sweep')) {
  line('as shipped', attitude());
  console.log('\n  a gliding bird sweeps 25-35° back and holds 3-8° of dihedral;');
  console.log('  negative dihedral is a wing hanging off a body, not holding it up.');
} else {
  // Sweep the three angles and keep the ones nearest a bird.
  const want = { sweep: 29, dihedral: 6 };
  const results = [];
  for (let x = -0.35; x <= 0.45; x += 0.1) {
    for (let y = 0.05; y <= 0.65; y += 0.1) {
      for (let z = -0.5; z <= 0.5; z += 0.1) {
        avatar.wingPose = { x, y, z };
        const a = attitude();
        if (a.flat < 0.75) continue;
        const miss = Math.abs(a.sweep - want.sweep) + Math.abs(a.dihedral - want.dihedral) * 1.5;
        results.push({ x, y, z, a, miss });
      }
    }
  }
  results.sort((p, q) => p.miss - q.miss);
  console.log(`closest to ${want.sweep}° sweep and ${want.dihedral}° dihedral, keeping the wing flat:\n`);
  for (const r of results.slice(0, 8)) {
    line(`x ${r.x.toFixed(2)} y ${r.y.toFixed(2)} z ${r.z.toFixed(2)}`, r.a);
  }
}

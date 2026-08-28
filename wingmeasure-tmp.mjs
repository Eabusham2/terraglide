import * as THREE from '/home/user/terraglide/vendor/three/three.module.js';
const { Avatar } = await import('/home/user/terraglide/src/player/avatar.js');
const scene = new THREE.Scene();
const a = new Avatar(scene);
a.setVisible(true);
const P = (o = {}) => ({
  position: new THREE.Vector3(), renderPosition: new THREE.Vector3(),
  velocity: new THREE.Vector3(), height: 1.83, scale: 1, pitch: 0, yaw: 0,
  mode: 'walk', onGround: true, swimming: false, groundSlope: 0,
  elytraDeployed: false, horizontalSpeed: 0, selectedSlot: 0, rocketsFired: 0, ...o,
});
// A level glide, so "forward" is unambiguously -Z and "up" is +Y.
const p = P({ elytraDeployed: true, onGround: false, mode: 'glide', pitch: 0,
  horizontalSpeed: 45, velocity: new THREE.Vector3(0, 0, -45) });
for (let i = 0; i < 400; i++) a.update(p, 1 / 60);
scene.updateMatrixWorld(true);

// The extreme corners of the right wing's membrane, in the world.
const m = a.wingR.children[0];
m.geometry.computeBoundingBox();
const pos = m.geometry.getAttribute('position');
const v = new THREE.Vector3();
let tip = null, root = null, lead = null, trail = null;
for (let i = 0; i < pos.count; i++) {
  const local = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
  const world = local.clone().applyMatrix4(m.matrixWorld);
  if (!tip || local.x > tip.local.x) tip = { local, world };
  if (!root || local.x < root.local.x) root = { local, world };
  if (!lead || local.y > lead.local.y) lead = { local, world };
  if (!trail || local.y < trail.local.y) trail = { local, world };
}
const show = (name, e) => console.log(
  name.padEnd(8), 'world x', e.world.x.toFixed(3).padStart(7),
  ' y', e.world.y.toFixed(3).padStart(7), ' z', e.world.z.toFixed(3).padStart(7));
console.log('LEVEL GLIDE — flight is toward -Z, up is +Y, right wing\n');
show('root', root); show('tip', tip); show('leading', lead); show('trailing', trail);

console.log('\n--- what that means ---');
const sweep = tip.world.z - root.world.z;
console.log('tip vs root, along the flight path:', sweep.toFixed(3),
  sweep > 0.01 ? '=> SWEPT BACK (like a bird)' : sweep < -0.01 ? '=> SWEPT FORWARD' : '=> straight out');
const rise = tip.world.y - root.world.y;
console.log('tip vs root, in height          :', rise.toFixed(3),
  rise > 0.01 ? '=> tips up (dihedral)' : rise < -0.01 ? '=> tips down (anhedral)' : '=> flat');
const chord = lead.world.z - trail.world.z;
console.log('leading vs trailing, along path :', chord.toFixed(3),
  chord < -0.01 ? '=> leading edge is AHEAD, correct' : '=> LEADING EDGE IS BEHIND — the wing is on backwards');

// Is the wing a lifting surface? Its face should point up in a glide.
const normal = new THREE.Vector3(0, 0, 1).transformDirection(m.matrixWorld);
console.log('\nwing face points            :', `(${normal.x.toFixed(2)}, ${normal.y.toFixed(2)}, ${normal.z.toFixed(2)})`);
console.log('  vertical component        :', Math.abs(normal.y).toFixed(2),
  Math.abs(normal.y) > 0.8 ? '=> flat like a wing' : Math.abs(normal.y) < 0.4 ? '=> ON EDGE, not a lifting surface' : '=> canted');

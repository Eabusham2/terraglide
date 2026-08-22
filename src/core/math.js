/** Small numeric helpers shared across the engine. */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Frame-rate independent exponential approach. `rate` is how aggressively the
 * value chases the target; higher is snappier.
 */
export function damp(current, target, rate, dt) {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

export function wrapAngle(a) {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
}

export function dampAngle(current, target, rate, dt) {
  return current + wrapAngle(target - current) * (1 - Math.exp(-rate * dt));
}

export function mod(a, n) {
  return ((a % n) + n) % n;
}

/** Deterministic 32-bit hash of three integers, used for procedural content. */
export function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1442695041);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Deterministic float in [0,1) from three integers. */
export function rand3(x, y, z) {
  return hash3(x, y, z) / 4294967296;
}

/** Mulberry32 — compact seeded PRNG. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fract(x) {
  return x - Math.floor(x);
}

/** Bilinear sample of a row-major grid. */
export function bilinear(grid, width, height, fx, fy) {
  const x = clamp(fx, 0, width - 1.0001);
  const y = clamp(fy, 0, height - 1.0001);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = grid[y0 * width + x0];
  const b = grid[y0 * width + x1];
  const c = grid[y1 * width + x0];
  const d = grid[y1 * width + x1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

/** Rough "is this number usable" guard for values coming from the network. */
export function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

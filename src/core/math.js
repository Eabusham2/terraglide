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

/*
 * There was a seeded hash, a float derived from it, and a Mulberry32 generator
 * here. All three existed to make up terrain, and the terrain they made up is
 * gone — nothing in the game or the tools referenced any of them any more. Left
 * in place they are an invitation: the next person wanting a height for a
 * square with no data has a ready-made way to invent one, and that is the one
 * thing this world does not do.
 *
 * Choosing is not inventing, and the two places that still choose at random are
 * choosing rather than inventing: a random teleport picks a bearing, and the
 * place list picks one of a set of real settlements. Neither makes up ground.
 */

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

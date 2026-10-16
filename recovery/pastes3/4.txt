/**
 * What your sword would hit.
 *
 * A ray from your eyes along where you are looking, out to Minecraft's three
 * metres, against every other player's body. A body is a capsule — a line
 * from feet to crown with some width around it — stood up when they are on
 * their feet and laid along their flight path when they are gliding, because
 * that is the shape you are actually swinging at.
 *
 * The page only proposes the hit. The server measures it again against where
 * it saw both of you (see server/game.mjs) and decides; this exists so a swing
 * that obviously misses is never sent, and so the one you aimed at is the one
 * that is checked.
 *
 * Pure arithmetic on plain objects, so it is tested without a scene.
 */

/** How wide a body counts as, metres either side of its line. */
export const BODY_RADIUS_M = 0.42;

/**
 * @param {{x:number,y:number,z:number}} eye
 * @param {{x:number,y:number,z:number}} look unit vector
 * @param {Array<{id:number, feet:{x,y,z}, height:number, lying?:boolean, along?:{x,y,z}}>} bodies
 * @param {number} reach metres
 * @returns {{id:number, distance:number}|null} the nearest body the ray meets
 */
export function findTarget(eye, look, bodies, reach) {
  let best = null;
  for (const body of bodies) {
    const [a, b] = bodyLine(body);
    const hit = rayToSegment(eye, look, a, b);
    if (hit.gap > BODY_RADIUS_M) continue;
    if (hit.t < 0 || hit.t > reach + BODY_RADIUS_M) continue;
    if (!best || hit.t < best.distance) best = { id: body.id, distance: hit.t };
  }
  return best;
}

/** The two ends of a body's line: feet and crown, or nose and tail in a glide. */
export function bodyLine(body) {
  const h = body.height ?? 1.83;
  if (!body.lying || !body.along) {
    return [
      { x: body.feet.x, y: body.feet.y + 0.1, z: body.feet.z },
      { x: body.feet.x, y: body.feet.y + h * 0.95, z: body.feet.z },
    ];
  }
  // Gliding: the figure turns about its neck, so the head stays put and the
  // body trails back along the flight path from there.
  const head = { x: body.feet.x, y: body.feet.y + h * 0.94, z: body.feet.z };
  const len = Math.hypot(body.along.x, body.along.y, body.along.z) || 1;
  return [
    head,
    {
      x: head.x - (body.along.x / len) * h * 0.9,
      y: head.y - (body.along.y / len) * h * 0.9,
      z: head.z - (body.along.z / len) * h * 0.9,
    },
  ];
}

/**
 * Closest approach between a ray and a segment.
 * Returns t (distance along the ray) and gap (how close they came).
 */
export function rayToSegment(origin, dir, a, b) {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const w = { x: origin.x - a.x, y: origin.y - a.y, z: origin.z - a.z };
  const dd = dot(dir, dir);
  const du = dot(dir, u);
  const uu = dot(u, u);
  const dw = dot(dir, w);
  const uw = dot(u, w);
  const denom = dd * uu - du * du;
  let t;
  let s;
  if (denom < 1e-9) {
    // Parallel: measure from the segment's start.
    t = -dw / dd;
    s = 0;
  } else {
    t = (du * uw - uu * dw) / denom;
    s = (dd * uw - du * dw) / denom;
  }
  s = Math.max(0, Math.min(1, s));
  // With the segment point clamped, the best t follows from it.
  const p = { x: a.x + u.x * s, y: a.y + u.y * s, z: a.z + u.z * s };
  t = dot({ x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z }, dir) / dd;
  const q = { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t };
  return { t, gap: Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

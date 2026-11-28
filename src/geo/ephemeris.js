import { DEG, RAD } from '../core/math.js';

/**
 * Where the sun and the stars are, seen from somewhere that is not Earth.
 *
 * Two published tables do all of it. The orbits are JPL's "Approximate
 * Positions of the Planets" (Standish), Keplerian elements good to a fraction
 * of a degree between 1800 and 2050, plus JPL's own elements for Ceres and
 * Vesta, which the small-body database publishes the same way. The way each
 * world is turned is the IAU working group's: the direction its north pole
 * points among the stars, and the angle its prime meridian has turned through
 * since the start of 2000 — the same numbers the maps are drawn against, so
 * noon on Mars falls where Mars's own maps say it does.
 *
 * Accurate to about a degree, which is far finer than a sky needs. The Moon's
 * libration and the small periodic wobbles in the IAU series are left out.
 */

const DAY_MS = 86400000;
/** 2000 January 1, 12:00 — the epoch every table here counts from. */
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const JD_J2000 = 2451545.0;
const OBLIQUITY = 23.43928 * DEG;

/*
  a (AU), e, I, L, longitude of perihelion, longitude of the ascending node
  (degrees), then the same six per Julian century. Standish, table 1.
*/
const PLANETS = {
  mercury: [
    [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  ],
  venus: [
    [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  ],
  // The Earth-Moon barycentre, which is where both of them are to a sky's
  // precision.
  earth: [
    [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
  ],
  mars: [
    [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  ],
  jupiter: [
    [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  ],
  saturn: [
    [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  ],
  pluto: [
    [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
    [-0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
  ],
};

/*
  Osculating elements from JPL's small-body database at JD 2461200.5:
  a, e, i, node, argument of perihelion, mean anomaly, mean motion (deg/day).
*/
const ASTEROIDS = {
  ceres: { epoch: 2461200.5, a: 2.765552595, e: 0.079692295, i: 10.588027802, node: 80.24862682, peri: 73.29421453, m: 274.41934638, n: 0.21430445 },
  vesta: { epoch: 2461200.5, a: 2.361365965, e: 0.090203744, i: 7.143925545, node: 103.701293265, peri: 151.468647822, m: 81.190156077, n: 0.27161836 },
};

function julianDate(date) {
  return (date.getTime() - J2000_MS) / DAY_MS + JD_J2000;
}

/** Days since J2000. */
export function daysSinceJ2000(date) {
  return (date.getTime() - J2000_MS) / DAY_MS;
}

function solveKepler(meanAnomaly, e) {
  let E = meanAnomaly + e * Math.sin(meanAnomaly);
  for (let i = 0; i < 8; i++) {
    const step = (E - e * Math.sin(E) - meanAnomaly) / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  return E;
}

function orbitPosition(a, e, inclination, node, peri, meanAnomaly) {
  const E = solveKepler(meanAnomaly, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(peri), sw = Math.sin(peri);
  const cO = Math.cos(node), sO = Math.sin(node);
  const cI = Math.cos(inclination), sI = Math.sin(inclination);
  return {
    x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    z: sw * sI * xp + cw * sI * yp,
  };
}

/**
 * Heliocentric position in AU, ecliptic and equinox of J2000, of a planet or
 * of one of the two asteroids. Null for a name it does not know.
 */
export function heliocentric(name, date) {
  const planet = PLANETS[name];
  if (planet) {
    const T = (julianDate(date) - JD_J2000) / 36525;
    const [a, e, I, L, varpi, node] = planet[0].map((v, i) => v + planet[1][i] * T);
    const peri = varpi - node;
    let M = (L - varpi) % 360;
    if (M > 180) M -= 360;
    if (M < -180) M += 360;
    return orbitPosition(a, e, I * DEG, node * DEG, peri * DEG, M * DEG);
  }
  const rock = ASTEROIDS[name];
  if (rock) {
    const M = (rock.m + rock.n * (julianDate(date) - rock.epoch)) % 360;
    return orbitPosition(rock.a, rock.e, rock.i * DEG, rock.node * DEG, rock.peri * DEG, M * DEG);
  }
  return null;
}

/** Unit vector from the body to the sun, in J2000 equatorial axes. */
export function sunVectorFrom(body, date) {
  const p = heliocentric(body.orbit ?? 'earth', date) ?? { x: 1, y: 0, z: 0 };
  const length = Math.hypot(p.x, p.y, p.z) || 1;
  // From the body to the sun is minus its position; then ecliptic to
  // equatorial, which is a turn about the equinox by the obliquity.
  const x = -p.x / length;
  const y = -p.y / length;
  const z = -p.z / length;
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  return { x, y: y * c - z * s, z: y * s + z * c, au: length };
}

// Row-major 3x3 helpers. These are coordinate-frame turns — the IAU's
// convention — so they carry a vector's components from the old axes to the
// new ones.
function rotZ(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}
function rotX(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}
function multiply(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}
function apply(m, v) {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  };
}

/**
 * Everything the sky needs for one place at one moment.
 *
 *   toScene   3x3, J2000 equatorial to the scene's axes (+X east, +Y up,
 *             -Z north), for the stars
 *   sun       unit vector to the sun in scene axes, with altitude and
 *             azimuth (radians, azimuth clockwise from north)
 *   parent    unit vector to the point the body keeps facing its planet
 *             with, for a world that is locked to one; null otherwise
 *   pole      the body's north pole in scene axes
 *   hour      local solar time, 0-24
 *   au        distance from the sun
 *
 * With `hour` given, the body is turned so that it is that time of day where
 * you are — what the time-of-day setting means everywhere — while the sun
 * stays where the orbit puts it, so the seasons are still the real ones.
 */
export function skyFrame(body, date, lat, lon, hour = null) {
  const [ra, dec] = body.pole ?? [0, 90];
  const [w0, rate] = body.spin ?? [190.147, 360.9856235];
  const sun = sunVectorFrom(body, date);
  const toPoleFrame = multiply(rotX((90 - dec) * DEG), rotZ((90 + ra) * DEG));
  const sunPole = apply(toPoleFrame, sun);
  const sunLongitude = Math.atan2(sunPole.y, sunPole.x) * RAD;
  const prograde = rate >= 0;
  let W;
  if (Number.isFinite(hour)) {
    const offset = (hour - 12) * 15;
    W = sunLongitude - lon + (prograde ? offset : -offset);
  } else {
    W = w0 + rate * daysSinceJ2000(date);
  }
  const toBody = multiply(rotZ((W % 360) * DEG), toPoleFrame);

  const phi = lat * DEG;
  const lambda = lon * DEG;
  const sp = Math.sin(phi), cp = Math.cos(phi);
  const sl = Math.sin(lambda), cl = Math.cos(lambda);
  // Body-fixed to scene: the rows are east, up and south.
  const local = [
    -sl, cl, 0,
    cp * cl, cp * sl, sp,
    sp * cl, sp * sl, -cp,
  ];
  const toScene = multiply(local, toBody);
  const sunScene = apply(toScene, sun);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sunScene.y)));
  const azimuth = Math.atan2(sunScene.x, -sunScene.z);

  const subsolar = sunLongitude - W;
  let solarHour = 12 + ((prograde ? 1 : -1) * (lon - subsolar)) / 15;
  solarHour = ((solarHour % 24) + 24) % 24;

  return {
    toScene,
    sun: { ...sunScene, altitude, azimuth, altitudeDeg: altitude * RAD },
    parent: body.parent ? apply(local, { x: 1, y: 0, z: 0 }) : null,
    pole: apply(local, { x: 0, y: 0, z: 1 }),
    hour: solarHour,
    // The sun's height above the body's equator: its season.
    declination: Math.asin(Math.max(-1, Math.min(1, sunPole.z))),
    au: sun.au,
  };
}

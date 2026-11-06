import { BOOT } from '../core/boot.js';

/**
 * The worlds you can stand on, and what each one is like.
 *
 * Every figure here is a measurement: radius, surface gravity and the density
 * of the air at the surface are the published values for each body, and the
 * places you arrive at are real landing sites and named features. The game's
 * own rule — nothing invented about somewhere that exists — applies off Earth
 * as much as on it: the ground is NASA's photography draped over NASA's
 * altimetry, and where a mission never measured the relief, the ground is
 * flat rather than made up. See tiles/providers.js for the sources.
 *
 * `gravity` and `air` are given as the real thing, and the physics turns them
 * into the game's scale: the walking, jumping and gliding numbers are
 * Minecraft's, which assume Minecraft's gravity of 32 m/s², so another world's
 * gravity is applied as its *ratio* to Earth's rather than in m/s² — the Moon
 * pulls a sixth as hard as Earth here exactly as it does there.
 *
 *   radius     metres, the sphere the body's maps are projected onto
 *   gravity    m/s² at the surface
 *   density    kg/m³ of air at the surface (Earth 1.225)
 *   breathable can you take your helmet off
 *   water      does sea level mean sea — only on Earth
 *   day        hours from one noon to the next (negative: the sun rises in the west)
 *   spawn      where you arrive: { lat, lon, label }
 *   sky        which sky to draw — see world/sky.js
 *   tempC      a typical surface temperature, for the corner readout
 *   reach      metres: the elevation range the body's relief can honestly
 *              span, so a corrupt sample can be told from a real cliff
 *   orbit      whose orbit carries it round the sun — a moon rides its
 *              planet's — for where the sun is; see geo/ephemeris.js
 *   pole       [right ascension, declination] of its north pole, degrees,
 *              J2000 — the IAU working group's figures
 *   spin       [W at J2000, degrees per day]: how far round its prime meridian
 *              has turned, also the IAU's. Negative turns backwards.
 *   landmark   something real standing at the landing site, drawn there
 *   parent     for a moon that keeps one face to its planet (and Pluto, which
 *              keeps one to Charon): what hangs over the middle of that face —
 *              its name, angular size in degrees from the surface, and colours
 */
export const BODIES = {
  earth: {
    id: 'earth',
    name: 'Earth',
    radius: 6378137,
    gravity: 9.80665,
    density: 1.225,
    breathable: true,
    water: true,
    day: 24,
    spawn: { lat: 46.5606, lon: 7.9089, label: 'Lauterbrunnen valley' },
    sky: 'earth',
    tempC: null,
    reach: [-11000, 9000],
    orbit: 'earth',
    pole: [0, 90],
    spin: [190.147, 360.9856235],
    blurb: 'Home. Real imagery, real relief, real buildings.',
  },
  moon: {
    id: 'moon',
    name: 'The Moon',
    radius: 1737400,
    gravity: 1.62,
    density: 0,
    breathable: false,
    water: false,
    day: 708.7,
    // Twenty-five metres west of where Eagle came down, so you arrive beside
    // its descent stage rather than inside it — see `landmark`.
    spawn: { lat: 0.67416, lon: 23.47232, label: 'Tranquility Base, Apollo 11' },
    landmark: { lat: 0.67416, lon: 23.47314, label: "Eagle's descent stage" },
    sky: 'vacuum',
    tempC: -20,
    reach: [-9200, 10900],
    orbit: 'earth',
    pole: [269.9949, 66.5392],
    spin: [38.3213, 13.17635815],
    parent: { name: 'Earth', size: 1.91, colour: [0.4, 0.55, 0.82], polar: [0.92, 0.94, 0.97] },
    blurb: 'A sixth of the pull and no air at all: the wings do nothing, the rockets everything.',
  },
  mars: {
    id: 'mars',
    name: 'Mars',
    radius: 3396190,
    gravity: 3.721,
    density: 0.02,
    breathable: false,
    water: false,
    day: 24.66,
    spawn: { lat: 18.4447, lon: 77.4508, label: 'Jezero crater, Perseverance' },
    sky: 'mars',
    tempC: -63,
    reach: [-8300, 21300],
    orbit: 'mars',
    pole: [317.68143, 52.8865],
    spin: [176.63, 350.89198226],
    blurb: 'Air a sixtieth as thick as ours. A glide is a fall with opinions.',
  },
  mercury: {
    id: 'mercury',
    name: 'Mercury',
    radius: 2439400,
    gravity: 3.7,
    density: 0,
    breathable: false,
    water: false,
    day: 4222.6,
    spawn: { lat: 30.5, lon: -170.2, label: 'Caloris Montes, the rim of the Caloris basin' },
    sky: 'vacuum',
    tempC: 167,
    reach: [-11000, 8500],
    orbit: 'mercury',
    pole: [281.0097, 61.4143],
    spin: [329.5469, 6.1385025],
    blurb: 'The sun is up to three times wider here, and there is no air to soften it.',
  },
  venus: {
    id: 'venus',
    name: 'Venus',
    radius: 6051800,
    gravity: 8.87,
    density: 65,
    breathable: false,
    water: false,
    day: -2802,
    spawn: { lat: 0.5, lon: -165.4, label: 'Maat Mons' },
    sky: 'venus',
    tempC: 464,
    // Magellan's Maxwell Montes reads 11,613 m against this datum.
    reach: [-3000, 12000],
    orbit: 'venus',
    pole: [272.76, 67.16],
    spin: [160.2, -1.4813688],
    blurb: 'Air fifty times thicker than ours. You could almost swim in it.',
  },
  ceres: {
    id: 'ceres',
    name: 'Ceres',
    radius: 470000,
    gravity: 0.28,
    density: 0,
    breathable: false,
    water: false,
    day: 9.07,
    spawn: { lat: 19.82, lon: -120.67, label: 'Occator crater' },
    sky: 'vacuum',
    tempC: -105,
    // Heights are measured from a 470 km sphere and Ceres is not one, so the
    // poles read twenty kilometres low and the equator twelve high. Real data,
    // and the range has to hold it.
    reach: [-28500, 17500],
    orbit: 'ceres',
    pole: [291.418, 66.764],
    spin: [170.65, 952.1532],
    blurb: 'A dwarf planet in the asteroid belt. Jump carefully.',
  },
  vesta: {
    id: 'vesta',
    name: 'Vesta',
    radius: 262700,
    gravity: 0.25,
    density: 0,
    breathable: false,
    water: false,
    day: 5.34,
    // In the IAU frame Dawn's maps use, which is the frame the photographs
    // and the relief are both published in.
    spawn: { lat: 8.98, lon: -20.45, label: 'Marcia crater' },
    sky: 'vacuum',
    tempC: -100,
    // Vesta is lumpy: measured against its mean radius the relief runs from
    // fifty kilometres down to thirty up.
    reach: [-52000, 31000],
    orbit: 'vesta',
    pole: [309.031, 42.235],
    spin: [285.39, 1617.3329428],
    blurb: 'An asteroid with a mountain twice the height of Everest.',
  },
  io: {
    id: 'io',
    name: 'Io',
    radius: 1821600,
    gravity: 1.796,
    density: 0,
    breathable: false,
    water: false,
    day: 42.46,
    spawn: { lat: 13, lon: 51.2, label: 'Loki Patera' },
    sky: 'vacuum',
    tempC: -143,
    reach: [-4000, 17500],
    orbit: 'jupiter',
    pole: [268.05, 64.5],
    spin: [200.39, 203.4889538],
    parent: { name: 'Jupiter', size: 19.3, colour: [0.86, 0.79, 0.66], belts: [0.6, 0.45, 0.33] },
    blurb: 'The most volcanic place in the solar system, with Jupiter overhead.',
  },
  europa: {
    id: 'europa',
    name: 'Europa',
    radius: 1560800,
    gravity: 1.315,
    density: 0,
    breathable: false,
    water: false,
    day: 85.2,
    spawn: { lat: 9.7, lon: 86.3, label: 'Conamara Chaos' },
    sky: 'vacuum',
    tempC: -160,
    reach: [-2000, 2000],
    orbit: 'jupiter',
    pole: [268.08, 64.51],
    spin: [36.022, 101.3747235],
    parent: { name: 'Jupiter', size: 12.2, colour: [0.86, 0.79, 0.66], belts: [0.6, 0.45, 0.33] },
    blurb: 'An ice shell over an ocean nobody has seen.',
  },
  ganymede: {
    id: 'ganymede',
    name: 'Ganymede',
    radius: 2634100,
    gravity: 1.428,
    density: 0,
    breathable: false,
    water: false,
    day: 171.7,
    spawn: { lat: 11, lon: -27, label: 'Tros crater' },
    sky: 'vacuum',
    tempC: -163,
    reach: [-3000, 3000],
    orbit: 'jupiter',
    pole: [268.2, 64.57],
    spin: [44.064, 50.3176081],
    parent: { name: 'Jupiter', size: 7.6, colour: [0.86, 0.79, 0.66], belts: [0.6, 0.45, 0.33] },
    blurb: 'The largest moon in the solar system — bigger than Mercury.',
  },
  callisto: {
    id: 'callisto',
    name: 'Callisto',
    radius: 2410300,
    gravity: 1.235,
    density: 0,
    breathable: false,
    water: false,
    day: 400.5,
    spawn: { lat: 18, lon: -57, label: 'Valhalla basin' },
    sky: 'vacuum',
    tempC: -139,
    reach: [-3000, 3000],
    orbit: 'jupiter',
    pole: [268.72, 64.83],
    spin: [259.51, 21.5710715],
    parent: { name: 'Jupiter', size: 4.35, colour: [0.86, 0.79, 0.66], belts: [0.6, 0.45, 0.33] },
    blurb: 'The most cratered surface we know of.',
  },
  titan: {
    id: 'titan',
    name: 'Titan',
    radius: 2574730,
    gravity: 1.352,
    density: 5.4,
    breathable: false,
    water: false,
    day: 382.7,
    spawn: { lat: -10.573, lon: 167.665, label: 'Huygens landing site' },
    sky: 'titan',
    tempC: -179,
    reach: [-1500, 3500],
    orbit: 'saturn',
    pole: [39.4827, 83.4279],
    spin: [186.5855, 22.5769768],
    parent: { name: 'Saturn', size: 5.65, colour: [0.88, 0.8, 0.6], belts: [0.78, 0.68, 0.5], rings: true },
    blurb: 'Thick air and weak gravity: the best gliding in the solar system.',
  },
  enceladus: {
    id: 'enceladus',
    name: 'Enceladus',
    radius: 252100,
    gravity: 0.113,
    density: 0,
    breathable: false,
    water: false,
    day: 32.9,
    spawn: { lat: 30, lon: 32.5, label: 'Samarkand Sulci' },
    sky: 'vacuum',
    tempC: -198,
    reach: [-6000, 6500],
    orbit: 'saturn',
    pole: [40.66, 83.52],
    spin: [6.32, 262.7318996],
    parent: { name: 'Saturn', size: 28.4, colour: [0.88, 0.8, 0.6], belts: [0.78, 0.68, 0.5], rings: true },
    blurb: "Saturn's ice moon, venting an ocean into space.",
  },
  pluto: {
    id: 'pluto',
    name: 'Pluto',
    radius: 1188300,
    gravity: 0.62,
    density: 0,
    breathable: false,
    water: false,
    day: -153.3,
    spawn: { lat: 20, lon: 175, label: 'Sputnik Planitia' },
    sky: 'vacuum',
    tempC: -229,
    reach: [-4500, 7000],
    orbit: 'pluto',
    pole: [132.993, -6.163],
    spin: [302.695, 56.3625225],
    parent: { name: 'Charon', size: 3.77, colour: [0.58, 0.57, 0.56], polar: [0.5, 0.33, 0.26] },
    blurb: 'Nitrogen glaciers, and the heart New Horizons photographed.',
  },
  charon: {
    id: 'charon',
    name: 'Charon',
    radius: 606000,
    gravity: 0.288,
    density: 0,
    breathable: false,
    water: false,
    day: 153.3,
    spawn: { lat: -5.12, lon: 7.05, label: 'Clarke Montes' },
    sky: 'vacuum',
    tempC: -220,
    // New Horizons' map runs from about -14,100 m to +6,600 m, with room.
    reach: [-15000, 7500],
    orbit: 'pluto',
    pole: [132.993, -6.163],
    spin: [122.695, 56.3625225],
    parent: { name: 'Pluto', size: 7.16, colour: [0.84, 0.72, 0.58] },
    blurb: "Pluto's partner, half its size, locked face to face with it.",
  },
};

/** Earth's surface gravity: what the game's own numbers were tuned against. */
export const EARTH_GRAVITY = BODIES.earth.gravity;

/** The world this page is on. Fixed for the life of the page — see core/boot.js. */
export const BODY = BODIES[BOOT.world] ?? BODIES.earth;

/** True on Earth: water, weather, buildings, addresses and the rest exist. */
export const ON_EARTH = BODY.id === 'earth';

/**
 * How much the air does, as a single number the flight model can scale by.
 *
 * One on Earth and nought in a vacuum. Thin air scales straight down — Mars
 * is a sixtieth of Earth, so its wings do a sixtieth of the work — and thick
 * air is compressed rather than taken at face value: Venus's surface air is
 * fifty-three times ours, and a drag fifty-three times bigger would stop you
 * dead in a tick. Doubling the density buys a quarter more effect, which keeps
 * Titan floaty and Venus soupy without either one becoming a wall.
 */
export function aeroFactor(body = BODY) {
  const ratio = body.density / BODIES.earth.density;
  if (ratio <= 1) return ratio;
  return 1 + Math.log2(ratio) * 0.25;
}

/** The body's gravity as a fraction of Earth's. */
export function gravityRatio(body = BODY) {
  return body.gravity / EARTH_GRAVITY;
}

/** Minecraft's straight-down dive: the game's terminal velocity on Earth, m/s. */
export const EARTH_TERMINAL_MPS = 78.4;
/**
 * How fast you can fall through this world's air, in metres per second.
 *
 * The flight model's drag is Minecraft's, a fixed share of your speed each
 * tick, and that is fine for Earth and for thick air — but real drag grows
 * with the square of speed, and in thin air the difference is everything:
 * scaled linearly, Mars's air would let you reach eighteen hundred metres a
 * second before it pushed back. Real terminal speed goes as the square root
 * of gravity over air density, so that is used here, from Earth's 78.4:
 * about 380 on Mars, and no limit at all with no air.
 */
export function terminalSpeed(body = BODY) {
  const air = aeroFactor(body);
  if (air <= 0) return Infinity;
  return EARTH_TERMINAL_MPS * Math.sqrt(gravityRatio(body) / air);
}

/** Look a world up by id, alias or name, for /travel. Null if unknown. */
export function findBody(text) {
  const wanted = String(text ?? '').trim().toLowerCase().replace(/^the\s+/, '');
  if (!wanted) return null;
  for (const body of Object.values(BODIES)) {
    if (body.id === wanted || body.name.toLowerCase().replace(/^the\s+/, '') === wanted) return body;
  }
  if (wanted === 'luna') return BODIES.moon;
  if (wanted === 'home' || wanted === 'terra') return BODIES.earth;
  return null;
}

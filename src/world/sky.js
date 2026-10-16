import * as THREE from '../../vendor/three/three.module.js';
import { clamp, smoothstep } from '../core/math.js';
import { settings } from '../core/settings.js';
import { BODY, ON_EARTH, gravityRatio } from '../geo/bodies.js';
import { climateAt, snowLineM } from '../geo/climate.js';
import { skyFrame } from '../geo/ephemeris.js';
import { skyDate, solarPosition, sunDirection } from '../geo/sun.js';
import { createSkyMaterial } from './shaders.js';
import { Stars } from './stars.js';

/**
 * Sky, sun and the lighting the rest of the world reads from.
 *
 * The palette is keyed off the real solar altitude for the place you are
 * standing, so flying east into the sunrise actually works. Colours are muted
 * and photographic rather than saturated — the world is the subject, not the
 * sky.
 */

const DAY = {
  zenith: new THREE.Color(0.17, 0.34, 0.66),
  horizon: new THREE.Color(0.71, 0.79, 0.88),
  sun: new THREE.Color(1.0, 0.97, 0.92),
  ambient: new THREE.Color(0.36, 0.4, 0.47),
};
const GOLDEN = {
  zenith: new THREE.Color(0.21, 0.31, 0.55),
  horizon: new THREE.Color(0.86, 0.66, 0.47),
  sun: new THREE.Color(1.0, 0.79, 0.55),
  ambient: new THREE.Color(0.34, 0.32, 0.34),
};
const TWILIGHT = {
  zenith: new THREE.Color(0.07, 0.1, 0.21),
  horizon: new THREE.Color(0.33, 0.29, 0.4),
  sun: new THREE.Color(0.5, 0.4, 0.42),
  ambient: new THREE.Color(0.15, 0.16, 0.22),
};
// Night is dim but never pitch black — you should still be able to explore.
const NIGHT = {
  zenith: new THREE.Color(0.05, 0.07, 0.13),
  horizon: new THREE.Color(0.13, 0.16, 0.24),
  sun: new THREE.Color(0.3, 0.33, 0.42),
  ambient: new THREE.Color(0.16, 0.18, 0.24),
};

/**
 * Every other world's sky, in the same four moments of the day.
 *
 * A vacuum is black at noon: there is no air to light up, so the only light in
 * the sky is the sun itself and whatever the sun is shining on. The ground is
 * lit by the sun and by the ground — never fully black in the shade, because
 * the sunlit regolith around it is bright.
 *
 * Mars's air is thin and full of fine dust, which turns its sky butterscotch
 * by day and, because the dust throws blue light forward, blue round the sun —
 * see `glow`. Titan's is an orange haze ten times deeper than ours, and
 * Venus's a yellow overcast so thick the sun is never seen at all; on both the
 * light comes from everywhere at once.
 *
 *   glow   the colour scattered forward round the sun, and how strongly
 *   haze   how much of the sun's disc the air hides
 *   night  how dark the ground is drawn with the sun down: the same cap as
 *          Earth's, a cast rather than a blackout
 *   stars  how many of the stars the air lets through by day and by night
 */
const VACUUM_NIGHT = {
  zenith: new THREE.Color(0, 0, 0),
  horizon: new THREE.Color(0.006, 0.007, 0.01),
  sun: new THREE.Color(0.32, 0.34, 0.42),
  ambient: new THREE.Color(0.14, 0.15, 0.19),
};
const WORLD_SKIES = {
  vacuum: {
    day: {
      zenith: new THREE.Color(0, 0, 0),
      horizon: new THREE.Color(0.012, 0.012, 0.016),
      sun: new THREE.Color(1.0, 0.99, 0.97),
      ambient: new THREE.Color(0.24, 0.24, 0.25),
    },
    night: VACUUM_NIGHT,
    golden: null,
    twilight: null,
    glow: [new THREE.Color(0, 0, 0), 0],
    haze: 0,
    nightCap: 0.7,
    stars: [0.55, 1],
    fog: 0,
    // Below the horizon is ground, sunlit regolith — the colour the sky dome
    // and the far rim are painted where the terrain has not been drawn.
    ground: new THREE.Color(0.2, 0.2, 0.19),
  },
  mars: {
    day: {
      zenith: new THREE.Color(0.5, 0.38, 0.28),
      horizon: new THREE.Color(0.79, 0.64, 0.49),
      sun: new THREE.Color(1.0, 0.94, 0.86),
      ambient: new THREE.Color(0.4, 0.33, 0.27),
    },
    golden: {
      zenith: new THREE.Color(0.3, 0.24, 0.2),
      horizon: new THREE.Color(0.56, 0.45, 0.36),
      sun: new THREE.Color(0.95, 0.86, 0.78),
      ambient: new THREE.Color(0.3, 0.26, 0.23),
    },
    twilight: {
      zenith: new THREE.Color(0.07, 0.065, 0.07),
      horizon: new THREE.Color(0.22, 0.2, 0.21),
      sun: new THREE.Color(0.45, 0.48, 0.58),
      ambient: new THREE.Color(0.15, 0.15, 0.17),
    },
    night: {
      zenith: new THREE.Color(0.006, 0.006, 0.009),
      horizon: new THREE.Color(0.025, 0.024, 0.028),
      sun: new THREE.Color(0.28, 0.29, 0.36),
      ambient: new THREE.Color(0.13, 0.13, 0.16),
    },
    glow: [new THREE.Color(0.4, 0.6, 1.0), 1.6],
    haze: 0.15,
    nightCap: 0.7,
    stars: [0, 0.85],
    fog: 1.6,
  },
  titan: {
    day: {
      zenith: new THREE.Color(0.4, 0.28, 0.11),
      horizon: new THREE.Color(0.66, 0.48, 0.22),
      sun: new THREE.Color(0.8, 0.62, 0.36),
      ambient: new THREE.Color(0.46, 0.36, 0.22),
    },
    golden: {
      zenith: new THREE.Color(0.25, 0.17, 0.07),
      horizon: new THREE.Color(0.45, 0.31, 0.14),
      sun: new THREE.Color(0.6, 0.44, 0.24),
      ambient: new THREE.Color(0.34, 0.27, 0.17),
    },
    twilight: null,
    night: {
      zenith: new THREE.Color(0.02, 0.014, 0.008),
      horizon: new THREE.Color(0.05, 0.035, 0.018),
      sun: new THREE.Color(0.24, 0.2, 0.16),
      ambient: new THREE.Color(0.14, 0.12, 0.1),
    },
    glow: [new THREE.Color(0.95, 0.72, 0.4), 0.6],
    haze: 1,
    nightCap: 0.65,
    stars: [0, 0],
    fog: 0.45,
  },
  venus: {
    day: {
      zenith: new THREE.Color(0.6, 0.5, 0.3),
      horizon: new THREE.Color(0.78, 0.64, 0.38),
      sun: new THREE.Color(1.0, 0.86, 0.58),
      ambient: new THREE.Color(0.5, 0.42, 0.28),
    },
    golden: {
      zenith: new THREE.Color(0.4, 0.3, 0.17),
      horizon: new THREE.Color(0.58, 0.44, 0.24),
      sun: new THREE.Color(0.8, 0.6, 0.36),
      ambient: new THREE.Color(0.38, 0.3, 0.2),
    },
    twilight: null,
    // The night side glows, faintly: the ground is at 460 degrees, hot enough
    // to give off a dull red light of its own.
    night: {
      zenith: new THREE.Color(0.03, 0.012, 0.006),
      horizon: new THREE.Color(0.09, 0.035, 0.015),
      sun: new THREE.Color(0.32, 0.16, 0.1),
      ambient: new THREE.Color(0.2, 0.11, 0.07),
    },
    glow: [new THREE.Color(1.0, 0.86, 0.6), 0.7],
    haze: 1,
    nightCap: 0.6,
    stars: [0, 0],
    fog: 0.6,
  },
};

/**
 * How big to draw the sun from `au` astronomical units out, in radians of
 * radius. Earth's is drawn larger than life, as the sky has always drawn it;
 * everywhere else keeps the same proportion, so from Mars it is two thirds of
 * the size and from Pluto a fortieth — a dot, still brighter than anything
 * else up there.
 */
const EARTH_SUN_RADIUS = Math.acos(0.9994);
function sunRadiusAt(au) {
  return Math.max(0.0035, EARTH_SUN_RADIUS / Math.max(0.1, au));
}

/** Surface air density as a readable fraction of Earth's. */
function airFraction(density) {
  const ratio = density / 1.225;
  if (ratio >= 2) return `${Math.round(ratio)} times`;
  if (ratio >= 0.1) return `${Math.round(ratio * 100)}%`;
  return `${(ratio * 100).toFixed(1)}%`;
}

function blend(a, b, t, out) {
  out.zenith.copy(a.zenith).lerp(b.zenith, t);
  out.horizon.copy(a.horizon).lerp(b.horizon, t);
  out.sun.copy(a.sun).lerp(b.sun, t);
  out.ambient.copy(a.ambient).lerp(b.ambient, t);
  return out;
}

export class Sky {
  constructor(scene, shared) {
    this.shared = shared;
    this.material = createSkyMaterial(shared);
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.scale.setScalar(100);
    scene.add(this.mesh);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.1);
    this.sunLight.position.set(0.4, 0.9, 0.3);
    scene.add(this.sunLight);
    this.ambientLight = new THREE.HemisphereLight(0xbcd0e4, 0x4a4a44, 1.1);
    scene.add(this.ambientLight);

    this.current = {
      zenith: DAY.zenith.clone(),
      horizon: DAY.horizon.clone(),
      sun: DAY.sun.clone(),
      ambient: DAY.ambient.clone(),
    };
    this.sunVec = new THREE.Vector3(0.4, 0.8, 0.3);
    this.solar = { altitude: 0.8, azimuth: 2.4, altitudeDeg: 45 };
    this.climate = null;
    this.date = new Date();
    this.stars = new Stars(scene);
    /** The renderer's pixel ratio, so a star is the same size at any render scale. Set by the game. */
    this.pixelRatio = 1;
    /** This world's sky, when it is not Earth's. */
    this.world = ON_EARTH ? null : WORLD_SKIES[BODY.sky] ?? WORLD_SKIES.vacuum;
    this.frame = null;
  }

  /** Colour of the horizon — the HUD and the minimap borrow it for fog edges. */
  get horizonColor() {
    return this.current.horizon;
  }

  get isNight() {
    return this.solar.altitudeDeg < -4;
  }

  update(camera, lat, lon, elevationM) {
    if (!ON_EARTH) {
      this.updateWorld(camera, lat, lon, elevationM);
      return;
    }
    this.date = skyDate(settings.get('timeMode'), settings.get('customHour'), lon);
    this.solar = solarPosition(this.date, lat, lon);
    const alt = this.solar.altitudeDeg;

    if (alt > 12) blend(GOLDEN, DAY, smoothstep(12, 26, alt), this.current);
    else if (alt > 0) blend(TWILIGHT, GOLDEN, smoothstep(0, 12, alt), this.current);
    else if (alt > -9) blend(NIGHT, TWILIGHT, smoothstep(-9, 0, alt), this.current);
    else blend(NIGHT, NIGHT, 0, this.current);

    sunDirection(this.solar.altitude, this.solar.azimuth, this.sunVec);
    const sunDir = new THREE.Vector3(this.sunVec.x, this.sunVec.y, this.sunVec.z).normalize();

    this.material.uniforms.uZenith.value.copy(this.current.zenith);
    this.material.uniforms.uHorizon.value.copy(this.current.horizon);
    this.material.uniforms.uGround.value.copy(this.current.horizon).multiplyScalar(0.55);
    this.material.uniforms.uSunDir.value.copy(sunDir);
    this.material.uniforms.uSunColor.value.copy(this.current.sun).multiplyScalar(1.6);
    this.mesh.position.copy(camera.position);

    this.sunLight.position.copy(sunDir).multiplyScalar(1000).add(camera.position);
    this.sunLight.target.position.copy(camera.position);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.color.copy(this.current.sun);
    this.sunLight.intensity = clamp(0.5 + Math.max(0, Math.sin(this.solar.altitude)) * 2.0, 0.45, 2.5);
    this.ambientLight.color.copy(this.current.horizon);
    this.ambientLight.groundColor.copy(this.current.ambient);
    this.ambientLight.intensity = clamp(0.75 + Math.max(0, this.solar.altitude) * 0.7, 0.65, 1.5);

    const shared = this.shared;
    shared.uSunDir.value.copy(sunDir);
    shared.uSunColor.value.copy(this.current.sun);
    shared.uAmbient.value.copy(this.current.ambient);
    // Which band of the planet the ground belongs to, for colouring terrain
    // that has no photograph. It changes about as fast as you can fly, so one
    // value a frame is plenty.
    if (shared.uLatitude) shared.uLatitude.value = lat;
    shared.uFogColor.value.copy(this.current.horizon);
    // Cap the night tint: a dim blue cast, not a blackout.
    shared.uNight.value = clamp(smoothstep(2, -8, alt), 0, 1) * 0.7;
    shared.uFogEnabled.value = settings.get('fog') ? 1 : 0;

    const renderDistance = settings.get('renderDistanceKm') * 1000;
    shared.uFogDensity.value = 1 / Math.max(2000, renderDistance * 0.92);

    // The stars come out once the sun is well down and the cloud lets them.
    this.frame = skyFrame(BODY, this.date, lat, lon);
    const dark = smoothstep(-6, -14, alt) * (1 - clamp(shared.uCloudCover.value * 1.3, 0, 1));
    this.stars.update(this.frame.toScene, {
      visibility: dark * 0.8,
      sunDir,
      horizonFade: 1,
      pixelRatio: this.pixelRatio,
    });
    // The rim of the world scatters toward the sun's own colour here.
    shared.uScatterColor.value.copy(this.material.uniforms.uSunColor.value);
    shared.uScatterStrength.value = 1;

    this.climate = climateAt({
      lat,
      elevationM,
      date: this.date,
      landFraction: this.landFraction ?? 0.6,
    });
    // Off is a line nothing can reach: the shader's own smoothstep then never
    // leaves zero, so there is no second code path to keep in step.
    shared.uSnowLine.value = settings.get('seasonalSnow')
      ? snowLineM(this.climate.seaLevelAvgC)
      : 1e9;
  }

  /**
   * Any other world: its own colours, the sun where its orbit and its turning
   * really put it, the stars, and the planet a locked moon hangs under.
   */
  updateWorld(camera, lat, lon, elevationM = 0) {
    const world = this.world;
    const now = new Date();
    const mode = settings.get('timeMode');
    // The time-of-day setting means the same thing on every world: an hour of
    // the local day, however long that day is. Golden hour is worked out
    // rather than read off Earth's clock — the sun eight degrees up, in the
    // afternoon, for this latitude and this world's season.
    let hour = null;
    if (mode === 'day') hour = 10.5;
    else if (mode === 'night') hour = 0.5;
    else if (mode === 'custom') hour = settings.get('customHour');
    else if (mode === 'golden') {
      const season = skyFrame(BODY, now, lat, lon, 12).declination;
      const phi = (lat * Math.PI) / 180;
      const cosH = (Math.sin((8 * Math.PI) / 180) - Math.sin(phi) * Math.sin(season)) / (Math.cos(phi) * Math.cos(season));
      hour = Math.abs(cosH) <= 1 ? 12 + (Math.acos(cosH) * 180) / Math.PI / 15 : 17.4;
    }
    const frame = skyFrame(BODY, now, lat, lon, hour);
    this.frame = frame;
    this.date = now;
    this.solar = {
      altitude: frame.sun.altitude,
      azimuth: frame.sun.azimuth,
      altitudeDeg: frame.sun.altitudeDeg,
    };
    const alt = this.solar.altitudeDeg;

    // The palette for the sun's height. A vacuum has no twilight — the light
    // goes when the disc does — and a haze has no separate golden hour.
    const day = world.day;
    const golden = world.golden ?? day;
    const twilight = world.twilight ?? golden;
    if (BODY.sky === 'vacuum') blend(world.night, day, smoothstep(-0.6, 0.6, alt), this.current);
    else if (world.twilight) {
      if (alt > 12) blend(golden, day, smoothstep(12, 26, alt), this.current);
      else if (alt > 0) blend(twilight, golden, smoothstep(0, 12, alt), this.current);
      else if (alt > -12) blend(world.night, twilight, smoothstep(-12, 0, alt), this.current);
      else blend(world.night, world.night, 0, this.current);
    } else if (alt > 0) blend(golden, day, smoothstep(0, 25, alt), this.current);
    else blend(world.night, golden, smoothstep(-10, 0, alt), this.current);

    const sunDir = new THREE.Vector3(frame.sun.x, frame.sun.y, frame.sun.z).normalize();
    this.sunVec.copy(sunDir);
    const u = this.material.uniforms;
    u.uZenith.value.copy(this.current.zenith);
    u.uHorizon.value.copy(this.current.horizon);
    // Where a world has a ground colour of its own, below the horizon is
    // that, lit by the sun; elsewhere the horizon darkened, as on Earth.
    const daylight = 0.25 + 0.75 * clamp(smoothstep(-1, 8, this.solar.altitudeDeg), 0, 1);
    if (world.ground) u.uGround.value.copy(world.ground).multiplyScalar(daylight);
    else u.uGround.value.copy(this.current.horizon).multiplyScalar(0.55);
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(this.current.sun).multiplyScalar(1.6);
    u.uSunRadius.value = sunRadiusAt(frame.au);
    u.uHaze.value = world.haze;
    this.mesh.position.copy(camera.position);

    const parent = BODY.parent;
    if (parent && frame.parent) {
      u.uParentDir.value.set(frame.parent.x, frame.parent.y, frame.parent.z);
      u.uParentRadius.value = ((parent.size / 2) * Math.PI) / 180;
      u.uParentColour.value.setRGB(...parent.colour);
      u.uParentBelts.value.setRGB(...(parent.belts ?? parent.colour));
      u.uParentPolar.value.setRGB(...(parent.polar ?? [0, 0, 0]));
      u.uParentPole.value.set(frame.pole.x, frame.pole.y, frame.pole.z);
      u.uParentRings.value = parent.rings ? 1 : 0;
      // Through Titan's haze, Saturn is never seen.
      u.uParentVisible.value = 1 - world.haze;
    } else {
      u.uParentVisible.value = 0;
    }

    // Further from the sun is dimmer, but eyes adapt: a gentle fall-off, not
    // the inverse square, or Saturn's moons would be lit like a cellar. Under
    // a haze the light comes from the whole sky rather than from the sun.
    const reach = clamp(Math.pow(frame.au, -0.4), 0.3, 1.5);
    const direct = world.haze >= 1 ? 0.45 : 1;
    this.sunLight.position.copy(sunDir).multiplyScalar(1000).add(camera.position);
    this.sunLight.target.position.copy(camera.position);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.color.copy(this.current.sun);
    this.sunLight.intensity = clamp(0.5 + Math.max(0, Math.sin(this.solar.altitude)) * 2.0, 0.45, 2.5) * reach * direct;
    this.ambientLight.color.copy(this.current.horizon).lerp(this.current.ambient, 0.5);
    this.ambientLight.groundColor.copy(this.current.ambient);
    this.ambientLight.intensity = clamp(0.75 + Math.max(0, this.solar.altitude) * 0.7, 0.65, 1.5) * (world.haze >= 1 ? 1.25 : 1);

    const shared = this.shared;
    shared.uSunDir.value.copy(sunDir);
    shared.uSunColor.value.copy(this.current.sun).multiplyScalar(reach * direct);
    shared.uAmbient.value.copy(this.current.ambient);
    if (shared.uLatitude) shared.uLatitude.value = lat;
    // The fog colour is also what the far rim of the world is painted. With
    // air that is the haze at the horizon; with none, the rim stands in for
    // ground beyond the drawn edge, and is the ground's colour.
    if (world.ground && world.fog <= 0) shared.uFogColor.value.copy(u.uGround.value);
    else shared.uFogColor.value.copy(this.current.horizon);
    const nightFall = BODY.sky === 'vacuum' ? smoothstep(0.5, -1, alt) : world.twilight ? smoothstep(2, -10, alt) : smoothstep(3, -8, alt);
    shared.uNight.value = clamp(nightFall, 0, 1) * world.nightCap;
    // No air, no aerial perspective: the far side of a crater is as sharp as
    // the near one.
    shared.uFogEnabled.value = world.fog > 0 && settings.get('fog') ? 1 : 0;
    const renderDistance = settings.get('renderDistanceKm') * 1000;
    shared.uFogDensity.value = world.fog > 0 ? 1 / Math.max(2000, renderDistance * world.fog) : 0;
    shared.uScatterColor.value.copy(world.glow[0]);
    shared.uScatterStrength.value = world.glow[1] * smoothstep(-8, 2, alt);

    const [starsByDay, starsByNight] = world.stars;
    const dark = BODY.sky === 'vacuum' ? smoothstep(0.5, -0.5, alt) : smoothstep(-4, -14, alt);
    this.stars.update(frame.toScene, {
      visibility: starsByDay + (starsByNight - starsByDay) * dark,
      sunDir,
      parentDir: u.uParentVisible.value > 0 ? u.uParentDir.value : null,
      parentRadius: u.uParentRadius.value * 1.02,
      horizonFade: BODY.sky === 'vacuum' ? 0 : 1,
      horizonDip: Math.acos(BODY.radius / (BODY.radius + Math.max(0, camera.position.y - elevationM))),
      pixelRatio: this.pixelRatio,
    });

    // Not a climate: one figure, the typical surface temperature, and what
    // the place is like to stand on.
    this.climate = {
      offworld: true,
      avgC: BODY.tempC,
      annualC: BODY.tempC,
      monthName: BODY.name,
      season: BODY.breathable ? 'breathable air' : 'suit on',
      band: BODY.density > 0 ? `air ${airFraction(BODY.density)} of Earth's` : 'no air',
      gravity: gravityRatio(),
    };
    shared.uSnowLine.value = 1e9;
  }

  setLandFraction(value) {
    this.landFraction = value;
  }
}

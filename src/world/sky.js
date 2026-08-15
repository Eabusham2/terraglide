import * as THREE from '../../vendor/three/three.module.js';
import { clamp, smoothstep } from '../core/math.js';
import { settings } from '../core/settings.js';
import { climateAt, snowLineM } from '../geo/climate.js';
import { skyDate, solarPosition, sunDirection } from '../geo/sun.js';
import { createSkyMaterial } from './shaders.js';

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
    this.material = createSkyMaterial();
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
  }

  /** Colour of the horizon — the HUD and the minimap borrow it for fog edges. */
  get horizonColor() {
    return this.current.horizon;
  }

  get isNight() {
    return this.solar.altitudeDeg < -4;
  }

  update(camera, lat, lon, elevationM) {
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
    shared.uFogColor.value.copy(this.current.horizon);
    // Cap the night tint: a dim blue cast, not a blackout.
    shared.uNight.value = clamp(smoothstep(2, -8, alt), 0, 1) * 0.7;
    shared.uFogEnabled.value = settings.get('fog') ? 1 : 0;

    const renderDistance = settings.get('renderDistanceKm') * 1000;
    shared.uFogDensity.value = 1 / Math.max(2000, renderDistance * 0.92);

    this.climate = climateAt({
      lat,
      elevationM,
      date: this.date,
      landFraction: this.landFraction ?? 0.6,
    });
    shared.uSnowLine.value = snowLineM(this.climate.avgC);
  }

  setLandFraction(value) {
    this.landFraction = value;
  }
}

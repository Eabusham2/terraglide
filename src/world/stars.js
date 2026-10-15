import * as THREE from '../../vendor/three/three.module.js';
import { KELVIN_MAX, KELVIN_MIN, MAG_MIN, MAG_STEP, STARS_BASE64, STAR_COUNT } from './starCatalogue.js';

/**
 * The real night sky: the Yale Bright Star Catalogue, every star down to
 * magnitude 5.5, at its real place among the others and turned to wherever
 * you are standing on whichever world. Orion is Orion from the Moon too — the
 * stars are far enough away that nowhere in the solar system moves them.
 *
 * One point per star, sized and brightened by magnitude and tinted by colour
 * temperature. The sky decides how much of them can be seen: all of them in
 * a vacuum, the bright ones through thin air, none through Titan's haze, and
 * on Earth only once the sun is well down.
 */

const VERT = /* glsl */ `
  attribute float aMagnitude;
  attribute vec3 aColour;
  uniform mat3 uToScene;
  uniform float uVisibility;
  uniform float uPixelRatio;
  uniform vec3 uSunDir;
  uniform vec3 uParentDir;
  uniform float uParentCos;
  uniform float uHorizonFade;
  varying vec3 vColour;
  varying float vAlpha;

  void main() {
    vec3 dir = normalize(uToScene * position);
    // Two and a half magnitudes is ten times fainter. Brightness by Pogson's
    // ratio, then split between the size of the dot and how bright it is, so
    // Sirius is a point and not a disc and magnitude five is still there.
    float flux = pow(10.0, -0.4 * (aMagnitude - 1.0));
    float size = clamp(1.2 + sqrt(flux) * 1.5, 1.2, 4.6) * uPixelRatio;
    float alpha = clamp(flux * 1.6 + 0.22, 0.0, 1.0) * uVisibility;
    // Gone in the sun's glare, behind the planet in the sky, and thinned by
    // the air near the horizon where there is any.
    alpha *= smoothstep(0.985, 0.94, dot(dir, uSunDir));
    alpha *= 1.0 - step(uParentCos, dot(dir, uParentDir));
    alpha *= mix(1.0, smoothstep(-0.02, 0.25, dir.y), uHorizonFade);
    vColour = aColour;
    vAlpha = alpha;
    gl_PointSize = alpha > 0.004 ? size : 0.0;
    // The dome is drawn at a fixed distance round the camera; so are these.
    gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + dir * 90.0, 1.0);
    gl_Position.z = gl_Position.w * 0.99999;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColour;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = dot(p, p);
    if (r > 1.0) discard;
    float core = exp(-r * 3.2);
    gl_FragColor = vec4(vColour * core * vAlpha, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * Colour of a black body at `kelvin`, as display RGB. Tanner Helland's fit to
 * the CIE tables, which is plenty for a dot a few pixels wide.
 */
function blackbody(kelvin) {
  const t = kelvin / 100;
  let r;
  let g;
  let b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v) => Math.min(1, Math.max(0, v / 255));
  // Pulled two thirds of the way to white: to the eye only the extremes look
  // coloured at all, Betelgeuse orange and Rigel blue.
  return [c(r) * 0.35 + 0.65, c(g) * 0.35 + 0.65, c(b) * 0.35 + 0.65];
}

function decode() {
  const text = atob(STARS_BASE64);
  const positions = new Float32Array(STAR_COUNT * 3);
  const magnitudes = new Float32Array(STAR_COUNT);
  const colours = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    const o = i * 6;
    const raw = (k) => text.charCodeAt(o + k);
    const ra = (((raw(0) << 8) | raw(1)) / 65535) * Math.PI * 2;
    const dec = (((raw(2) << 8) | raw(3)) / 65535) * Math.PI - Math.PI / 2;
    // J2000 equatorial: x to the equinox, z to the celestial pole.
    positions[i * 3] = Math.cos(dec) * Math.cos(ra);
    positions[i * 3 + 1] = Math.cos(dec) * Math.sin(ra);
    positions[i * 3 + 2] = Math.sin(dec);
    magnitudes[i] = MAG_MIN + raw(4) * MAG_STEP;
    const kelvin = KELVIN_MIN * Math.pow(KELVIN_MAX / KELVIN_MIN, raw(5) / 255);
    colours.set(blackbody(kelvin), i * 3);
  }
  return { positions, magnitudes, colours };
}

export class Stars {
  constructor(scene) {
    const { positions, magnitudes, colours } = decode();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aMagnitude', new THREE.BufferAttribute(magnitudes, 1));
    geometry.setAttribute('aColour', new THREE.BufferAttribute(colours, 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uToScene: { value: new THREE.Matrix3() },
        uVisibility: { value: 0 },
        uPixelRatio: { value: 1 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uParentDir: { value: new THREE.Vector3(0, -1, 0) },
        uParentCos: { value: 2 },
        uHorizonFade: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      fog: false,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    // After the dome, before everything standing in front of it.
    this.points.renderOrder = -999;
    scene.add(this.points);
  }

  /**
   * @param {number[]} toScene row-major 3x3, J2000 equatorial to scene axes
   * @param {object} view { visibility, sunDir, parentDir, parentRadius,
   *                        horizonFade, pixelRatio }
   */
  update(toScene, view) {
    const u = this.material.uniforms;
    // Matrix3.set takes rows, which is how the frame is written.
    u.uToScene.value.set(...toScene);
    u.uVisibility.value = view.visibility;
    u.uSunDir.value.copy(view.sunDir);
    if (view.parentDir) {
      u.uParentDir.value.copy(view.parentDir);
      u.uParentCos.value = Math.cos(view.parentRadius);
    } else {
      u.uParentCos.value = 2;
    }
    u.uHorizonFade.value = view.horizonFade;
    u.uPixelRatio.value = view.pixelRatio ?? 1;
    this.points.visible = view.visibility > 0.004;
  }
}

import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../core/math.js';
import { settings } from '../core/settings.js';

/**
 * What the weather looks like: a cloud deck overhead and precipitation around
 * you.
 *
 * The deck is one plane with a noise shader rather than a cloud system — you
 * fly through it at 120 km/h, and a single well-shaded layer at the right height
 * reads far better than a thousand billboards would, at a fraction of the cost.
 * Rain and snow are a recycled box of points that follows the camera, so it only
 * ever draws the few thousand you could actually see.
 */

const DECK_HEIGHT = 2100;
const DECK_SIZE = 60000;
const DROPS = 1800;
const BOX = 34;

// The renderer runs with a logarithmic depth buffer, so a hand-written shader
// has to write and test depth on that scale like everything else does. Without
// these four includes the depth this material produces is on a different scale
// from the one in the buffer, and the comparison is meaningless: the deck was
// hidden by ground four kilometres behind it, so from above the clouds there
// was nothing there at all. Measured with the cover forced to 0.85 and the
// deck confirmed visible — and still no cloud between the camera at 5,000 m
// and the valley floor at 1,000.
const CLOUD_VERT = `
#include <common>
#include <logdepthbuf_pars_vertex>

varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}`;

const CLOUD_FRAG = `
precision highp float;

#include <common>
#include <logdepthbuf_pars_fragment>

varying vec2 vUv;
varying vec3 vWorld;
uniform float uTime;
uniform float uCover;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uCameraPos;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    total += noise(p) * amplitude;
    p *= 2.03;
    amplitude *= 0.5;
  }
  return total;
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vWorld.xz * 0.00042 + vec2(uTime * 0.0035, uTime * 0.0018);
  float n = fbm(p);
  // Cover pushes the threshold down: overcast fills in, clear leaves wisps.
  float density = smoothstep(0.62 - uCover * 0.55, 0.92 - uCover * 0.42, n);
  if (density < 0.01) discard;

  // Thicker cloud is darker underneath, which is most of what sells rain.
  vec3 lit = mix(uSunColor * 1.05, uAmbient * 0.9, clamp(density * 0.9, 0.0, 1.0));
  // Fade out at the rim of the deck so the edge never shows.
  float radial = 1.0 - smoothstep(0.30, 0.5, distance(vUv, vec2(0.5)));
  // And fade as you approach it, so you are never inside a flat sheet.
  float approach = smoothstep(0.0, 320.0, abs(vWorld.y - uCameraPos.y));
  gl_FragColor = vec4(lit, density * radial * approach * 0.92);
  // Same omission the edge wall had: without this the deck is written as linear
  // numbers into an sRGB framebuffer, so a lit cloud comes out as a dark grey
  // smear instead of a cloud. Everything else that draws converts on the way
  // out; this now does too.
  #include <colorspace_fragment>
}`;

export class Weather {
  constructor(scene, shared = null) {
    this.scene = scene;
    /**
     * Shared uniforms, so the ground can be shadowed by the cloud that is
     * actually overhead. The deck writes its own time, cover and height here
     * every frame and the terrain shader reads the same three numbers — one
     * field, sampled twice, rather than two fields that drift apart.
     */
    this.shared = shared;
    this.time = 0;
    this.state = { cloudCover: 0.4, precipitation: 0, kind: 'none' };

    this.cloudMaterial = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uCover: { value: 0.4 },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uAmbient: { value: new THREE.Color(0.4, 0.44, 0.5) },
        uCameraPos: { value: new THREE.Vector3() },
      },
    });
    this.deck = new THREE.Mesh(new THREE.PlaneGeometry(DECK_SIZE, DECK_SIZE), this.cloudMaterial);
    this.deck.rotation.x = -Math.PI / 2;
    this.deck.frustumCulled = false;
    this.deck.renderOrder = -900;
    scene.add(this.deck);

    // Precipitation: a box of points that is always centred on you.
    const positions = new Float32Array(DROPS * 3);
    this.speeds = new Float32Array(DROPS);
    for (let i = 0; i < DROPS; i++) {
      positions[i * 3] = (Math.random() - 0.5) * BOX;
      positions[i * 3 + 1] = Math.random() * BOX;
      positions[i * 3 + 2] = (Math.random() - 0.5) * BOX;
      this.speeds[i] = 0.8 + Math.random() * 0.5;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dropGeometry = geometry;
    this.dropMaterial = new THREE.PointsMaterial({
      color: 0xc8d4e0,
      size: 0.09,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.drops = new THREE.Points(geometry, this.dropMaterial);
    this.drops.frustumCulled = false;
    this.drops.visible = false;
    scene.add(this.drops);
  }

  /** @param {{cloudCover:number, precipitation:number, kind:string}} state */
  setState(state) {
    this.state = state;
  }

  update(camera, dt, sky) {
    const enabled = settings.get('weather');
    this.deck.visible = enabled && this.state.cloudCover > 0.05;
    this.time += dt;

    if (this.shared) {
      this.shared.uCloudTime.value = this.time;
      // No deck drawn, no shadow cast.
      this.shared.uCloudCover.value = this.deck.visible ? this.state.cloudCover : 0;
      this.shared.uCloudHeight.value = DECK_HEIGHT;
    }

    if (this.deck.visible) {
      this.deck.position.set(camera.position.x, DECK_HEIGHT, camera.position.z);
      const u = this.cloudMaterial.uniforms;
      u.uTime.value = this.time;
      u.uCover.value = this.state.cloudCover;
      u.uCameraPos.value.copy(camera.position);
      if (sky) {
        u.uSunColor.value.copy(sky.current.sun);
        u.uAmbient.value.copy(sky.current.ambient);
      }
    }

    const falling = enabled && this.state.kind !== 'none' && this.state.precipitation > 0.04;
    this.drops.visible = falling;
    if (!falling) return;

    const snow = this.state.kind === 'snow';
    this.dropMaterial.size = snow ? 0.16 : 0.075;
    this.dropMaterial.opacity = clamp(0.25 + this.state.precipitation * 0.5, 0.2, 0.8);
    this.dropMaterial.color.setHex(snow ? 0xf2f5f8 : 0xb9c7d6);

    const fall = (snow ? 2.2 : 26) * dt;
    const array = this.dropGeometry.attributes.position.array;
    const drift = snow ? Math.sin(this.time * 1.3) * 0.6 * dt : 0;
    for (let i = 0; i < DROPS; i++) {
      const base = i * 3;
      array[base + 1] -= fall * this.speeds[i];
      array[base] += drift;
      if (array[base + 1] < -BOX * 0.5) {
        array[base] = (Math.random() - 0.5) * BOX;
        array[base + 1] = BOX * 0.5;
        array[base + 2] = (Math.random() - 0.5) * BOX;
      }
    }
    this.dropGeometry.attributes.position.needsUpdate = true;
    this.drops.position.copy(camera.position);
  }
}

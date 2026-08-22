import * as THREE from '../../vendor/three/three.module.js';

/**
 * A sheet of sea, a few metres under the sea.
 *
 * The ocean surface is terrain: a quadtree of tiles clamped to sea level. Where
 * two of those tiles meet at different levels of detail they do not always meet
 * exactly — a stand-in sunk so the finer tiles win the depth test, a curvature
 * bend sampled at two different vertex spacings — and the gap is a pixel or two
 * wide. Through it you see whatever is behind the world, which is the sky dome's
 * below-horizon tint, and that is much paler than deep water. So the cracks read
 * as bright specks strung along the tile edges, and the eye joins them into the
 * grid that has been reported over and over.
 *
 * Chasing the cracks themselves went nowhere useful. Hanging a curtain deep
 * enough to cover them makes the curtain visible instead — swept from nothing to
 * three metres, the bright specks went 20, 1, 0, 0, 0 while the dark ones went
 * 0, 43, 206, 335, 266 — so there is no depth that is right for both, and the
 * best of the five was no curtain at all.
 *
 * This does the other thing: it puts sea behind the sea. A single sheet, a few
 * metres below sea level, following the camera and bent by the same curvature as
 * the ground. It is hidden everywhere the surface is intact, and everywhere the
 * surface has a hole in it, what shows through is water-coloured instead of
 * sky-coloured. Nothing is invented — the sea really does continue underneath
 * its own surface, and this is drawn with the same Fresnel the surface uses, so
 * a crack and its surroundings come out the same colour.
 *
 * It also quietly covers ground that has not streamed in yet: over open ocean a
 * tile that has not arrived was a hole to the sky, and is now sea.
 */

/** How far below sea level the sheet sits. Deeper than any crack, by a lot. */
const DEPTH_M = 12;

const VERT = /* glsl */ `
  precision highp float;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  uniform float uEarthRadius;
  uniform float uCurvature;
  uniform float uReach;
  varying vec3 vWorld;

  void main() {
    vec4 world = modelMatrix * vec4(position.x * uReach, position.y, position.z * uReach, 1.0);
    float d = length(world.xz - cameraPosition.xz);
    // The same bend the ground gets, so the sheet stays under the surface all
    // the way out rather than rising through it at the horizon.
    world.y -= uCurvature * (d * d) / (2.0 * uEarthRadius);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform vec3 uFogColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uNight;
  varying vec3 vWorld;

  void main() {
    #include <logdepthbuf_fragment>
    vec3 view = normalize(cameraPosition - vWorld);
    float facing = clamp(view.y, 0.0, 1.0);
    // The same Schlick term the water surface uses, so a crack in the surface
    // and the surface either side of it come out the same colour.
    float fresnel = 0.08 + 0.92 * pow(1.0 - facing, 5.0);
    // Deep ocean photographed from orbit is very nearly black — measured over
    // the Strait of Gibraltar, the raw Esri pixels there are (3, 12, 19). That
    // is what is under the surface, and the sky it reflects is what lifts it.
    vec3 deep = vec3(0.012, 0.047, 0.075);
    vec3 colour = mix(deep, uFogColor * 1.06, fresnel * 0.85);
    vec3 halfV = normalize(view + uSunDir);
    colour += uSunColor * pow(max(halfV.y, 0.0), 90.0) * 0.5 * (1.0 - uNight);
    colour = mix(colour, colour * vec3(0.46, 0.52, 0.7), uNight);
    gl_FragColor = vec4(colour, 1.0);
    #include <colorspace_fragment>
  }
`;

export class SeaFloor {
  constructor(scene, shared) {
    // A disc rather than a square, so it ends where the ground ends instead of
    // reaching a factor of root two further in the corners.
    const geometry = new THREE.CircleGeometry(1, 96);
    geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uEarthRadius: shared.uEarthRadius,
        uCurvature: shared.uCurvature,
        uFogColor: shared.uFogColor,
        uSunColor: shared.uSunColor,
        uSunDir: shared.uSunDir,
        uNight: shared.uNight,
        uReach: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'sea-floor';
    this.mesh.frustumCulled = false;
    // Behind the ground and behind the edge wall, in front of the sky.
    this.mesh.renderOrder = -2;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  /**
   * @param {THREE.Camera} camera
   * @param {number} reach how far the ground is drawn, in metres
   */
  update(camera, reach) {
    this.material.uniforms.uReach.value = Math.max(1000, reach * 1.05);
    this.mesh.position.set(camera.position.x, -DEPTH_M, camera.position.z);
    this.mesh.updateMatrix();
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

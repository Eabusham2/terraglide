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
 *
 * Which is the whole trouble, because at first it covered *land* that had not
 * streamed in yet as well. Arriving nine hundred metres over the Meseta, the
 * ground fills in from under your feet outwards and takes about a minute to
 * reach the horizon; until it does there is nothing drawn out there, and this
 * sheet — a disc a hundred kilometres across, twelve metres under sea level,
 * far below the Spanish plateau and therefore perfectly entitled to be hidden
 * by it — was what showed through instead. Measured: twelve point eight per
 * cent of the frame slate blue at twenty-five seconds, two point three at
 * seventy, which is the same as no sheet at all. A minute of blue-grey slab
 * where Spain should be.
 *
 * So the sheet now paints only where the elevation field has actually measured
 * sea. Land is left to the ground, and — this is the part that matters —
 * ground that has not been measured yet is left alone too. `hasDataAt` says
 * which is which, and its own comment says why: no data reads back as exactly
 * sea level, so anything that treats sea level as sea will quietly claim
 * everything that has not arrived. The mask is coarse, a kilometre or so a
 * texel, which is plenty: this sheet is only ever seen through cracks a pixel
 * or two wide, and a coastline is not where those cracks are.
 */

/** How far below sea level the sheet sits. Deeper than any crack, by a lot. */
const DEPTH_M = 12;

/**
 * The sea mask: how many texels across, how coarse an elevation to read it
 * from, and how much of it to redo per frame.
 *
 * A hundred and twenty-eight texels over a disc two hundred kilometres wide is
 * about a kilometre and a half a texel. Reading it from zoom nine rather than
 * the finest tile loaded is worth roughly six levels of walking down the tile
 * pyramid per sample, sixteen thousand times, and at a kilometre and a half a
 * texel the finer answer would be thrown away anyway. Eight rows a frame keeps
 * a whole sweep under a fifth of a second without ever costing a frame.
 */
const MASK = 128;
const MASK_ZOOM = 9;
const MASK_ROWS_PER_FRAME = 8;

/**
 * How high the ground may be and still count as sea.
 *
 * Not zero: the elevation is bilinear between posts up to ninety metres apart,
 * so the last sample before a shoreline reads a metre or two above nothing.
 * Half a metre of slack keeps the sheet under the water it belongs to without
 * letting it up onto the beach.
 */
const SEA_MARGIN_M = 0.5;

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
  uniform sampler2D uMask;
  uniform vec2 uMaskOrigin;
  uniform float uMaskSpan;
  uniform float uHasMask;
  varying vec3 vWorld;

  void main() {
    #include <logdepthbuf_fragment>
    // Only where the ground has been measured and measured as sea. Outside the
    // mask, and before the first sweep has filled it, there is nothing to say
    // so nothing is drawn.
    vec2 muv = (vWorld.xz - uMaskOrigin) / uMaskSpan;
    if (uHasMask < 0.5) discard;
    if (muv.x < 0.0 || muv.x > 1.0 || muv.y < 0.0 || muv.y > 1.0) discard;
    if (texture2D(uMask, muv).r < 0.5) discard;
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
        uMask: { value: null },
        uMaskOrigin: { value: new THREE.Vector2() },
        uMaskSpan: { value: 1 },
        uHasMask: { value: 0 },
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

    // Two buffers: one the shader is reading, one the sweep is filling. The
    // sweep takes several frames and moves with the camera, so publishing it a
    // row at a time would mean a texture whose halves belong to two different
    // patches of the world.
    this.maskTexture = new THREE.DataTexture(
      new Uint8Array(MASK * MASK),
      MASK,
      MASK,
      THREE.RedFormat,
    );
    this.maskTexture.minFilter = THREE.LinearFilter;
    this.maskTexture.magFilter = THREE.LinearFilter;
    this.maskTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.maskTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.maskTexture.needsUpdate = true;
    this.material.uniforms.uMask.value = this.maskTexture;

    this.pending = new Uint8Array(MASK * MASK);
    this.sweepRow = MASK; // nothing in flight
    this.sweepOrigin = new THREE.Vector2();
    this.sweepSpan = 1;
    this.norm = { nx: 0, ny: 0 };
  }

  /**
   * Fill a few rows of the mask, and publish it when the last row lands.
   *
   * @param {{ frame: any, elevation: any }} terrain
   * @param {THREE.Camera} camera
   * @param {number} reach
   */
  updateMask(terrain, camera, reach) {
    const span = Math.max(2000, reach * 2.2);
    if (this.sweepRow >= MASK) {
      // Between sweeps: start another one, centred where the camera is now.
      this.sweepSpan = span;
      this.sweepOrigin.set(camera.position.x - span / 2, camera.position.z - span / 2);
      this.sweepRow = 0;
    }

    const step = this.sweepSpan / MASK;
    const end = Math.min(MASK, this.sweepRow + MASK_ROWS_PER_FRAME);
    for (let row = this.sweepRow; row < end; row++) {
      const z = this.sweepOrigin.y + (row + 0.5) * step;
      for (let col = 0; col < MASK; col++) {
        const x = this.sweepOrigin.x + (col + 0.5) * step;
        terrain.frame.worldToNorm(x, z, this.norm);
        const { nx, ny } = this.norm;
        // Unmeasured ground is not sea. It is unmeasured, and the honest thing
        // to do with a hole you cannot see the bottom of is not to paint it.
        const known = terrain.elevation.hasDataAt(nx, ny, MASK_ZOOM);
        const sea =
          known && terrain.elevation.sampleCoarse(nx, ny, MASK_ZOOM) <= SEA_MARGIN_M;
        this.pending[row * MASK + col] = sea ? 255 : 0;
      }
    }
    this.sweepRow = end;

    if (this.sweepRow >= MASK) {
      this.maskTexture.image.data.set(this.pending);
      this.maskTexture.needsUpdate = true;
      this.material.uniforms.uMaskOrigin.value.copy(this.sweepOrigin);
      this.material.uniforms.uMaskSpan.value = this.sweepSpan;
      this.material.uniforms.uHasMask.value = 1;
    }
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
    this.maskTexture.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

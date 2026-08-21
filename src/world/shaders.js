import * as THREE from '../../vendor/three/three.module.js';

/**
 * Terrain shader.
 *
 * Notable bits:
 *  - `uUvOffset/uUvScale` let a tile draw a window into an ancestor's texture,
 *    which is how a tile that has not streamed in yet still shows something.
 *  - the vertex stage bends the ground down by d^2/2R so the horizon curves and
 *    distant terrain sinks away instead of standing up like a wall.
 *  - fog is blended toward the sky's horizon colour, so the render-distance
 *    edge reads as haze rather than as a cliff.
 */
const TERRAIN_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  uniform float uEarthRadius;
  uniform float uCurvature;
  attribute float bed;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying float vDist;
  varying float vHeight;
  varying float vBed;
  varying vec3 vWorld;

  void main() {
    vUv = uv;
    // The unclamped ground height, sea floor included. The surface is clamped
    // to sea level so the ocean is a flat plane; without the real depth
    // underneath it, nothing downstream can tell a beach from a bay.
    vBed = bed;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vHeight = worldPos.y;
    vWorld = worldPos.xyz;
    // "flat" is a reserved interpolation qualifier in GLSL ES 3, hence the name.
    vec2 groundOffset = worldPos.xz - cameraPosition.xz;
    float d = length(groundOffset);
    vDist = d;
    worldPos.y -= uCurvature * (d * d) / (2.0 * uEarthRadius);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
    #include <logdepthbuf_vertex>
  }
`;

const TERRAIN_FRAG = /* glsl */ `
  precision highp float;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform sampler2D uMap;
  uniform vec2 uUvOffset;
  uniform float uUvScale;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uFogEnabled;
  uniform float uSnowLine;
  uniform float uHasTexture;
  uniform float uLatitude;
  uniform float uHasRelief;
  uniform float uNight;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying float vDist;
  varying float vHeight;
  varying float vBed;
  varying vec3 vWorld;

  /**
   * What the ground looks like when there is no photograph of it yet.
   *
   * A single neutral tone, darkened a little on slopes so the relief still
   * reads. Nothing else — no biome guessed from latitude, no sand along a
   * waterline, no rock on anything steep. All of that was invention: it
   * painted an orange desert across ground the imagery had simply not reached
   * yet, and half a hillside would be a plausible-looking lie sitting next to
   * the photograph of the other half.
   *
   * It should also be rare. A tile with no imagery of its own stretches its
   * nearest loaded ancestor, and the streamer asks for those ancestors ahead
   * of the sharp tiles precisely so that this is what you see for a moment
   * rather than what you fly over.
   */
  vec3 groundNotLoaded(float flatness) {
    return mix(vec3(0.24, 0.25, 0.26), vec3(0.34, 0.35, 0.36), flatness);
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vNormalW);
    float flatness = smoothstep(0.30, 0.92, n.y);
    vec2 uv = uUvOffset + clamp(vUv, 0.0, 1.0) * uUvScale;
    vec3 albedo = mix(groundNotLoaded(flatness), texture2D(uMap, uv).rgb, uHasTexture);

    // There used to be two octaves of noise multiplied over the ground here,
    // to give a stretched or flat-white tile something to hold on to. It is
    // gone: it is a pattern nobody surveyed, printed over a photograph of
    // somewhere real, and up close it is the thing that made bare rock look
    // like carpet.

    float lambert = max(dot(n, uSunDir), 0.0);
    // Soft wrap keeps shaded slopes readable instead of crushing them to black.
    float wrapped = lambert * 0.62 + 0.38;
    vec3 lit = albedo * (uAmbient + uSunColor * wrapped);

    // Snow above the seasonal snow line, on ground that is not too steep.
    //
    // Deliberately weak and deliberately gradual. Snow used to arrive as a
    // switch — one flat tile crossed the line and turned into a white
    // rectangle while its neighbour stayed green. It now fades in over a full
    // kilometre of height, drifts about with the ground so the line is never
    // straight, sheds off any real slope, and only ever tints what is already
    // there rather than painting over it.
    float snow = smoothstep(uSnowLine, uSnowLine + 1000.0, vHeight) * flatness;
    vec3 snowColour = vec3(0.86, 0.88, 0.92) * (uAmbient + uSunColor * wrapped);
    lit = mix(lit, snowColour, snow * 0.45);

    lit = mix(lit, lit * vec3(0.46, 0.52, 0.7), uNight);

    if (uFogEnabled > 0.5) {
      float f = 1.0 - exp(-pow(vDist * uFogDensity, 2.0));
      lit = mix(lit, uFogColor, clamp(f, 0.0, 1.0));
    }

    gl_FragColor = vec4(lit, 1.0);
    #include <colorspace_fragment>
  }
`;

const WHITE_PIXEL = (() => {
  const data = new Uint8Array([255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 1, 1);
  tex.needsUpdate = true;
  return tex;
})();

export function createTerrainMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: WHITE_PIXEL },
      uUvOffset: { value: new THREE.Vector2(0, 0) },
      uUvScale: { value: 1 },
      uHasTexture: { value: 0 },
      uLatitude: shared.uLatitude,
      uHasRelief: shared.uHasRelief,
      uEarthRadius: shared.uEarthRadius,
      uCurvature: shared.uCurvature,
      uSunDir: shared.uSunDir,
      uSunColor: shared.uSunColor,
      uAmbient: shared.uAmbient,
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
      uFogEnabled: shared.uFogEnabled,
      uSnowLine: shared.uSnowLine,
      uNight: shared.uNight,
    },
    vertexShader: TERRAIN_VERT,
    fragmentShader: TERRAIN_FRAG,
  });
}

/** Shared uniforms every terrain tile reads from, updated once per frame. */
export function createSharedUniforms() {
  return {
    uEarthRadius: { value: 6378137 },
    uCurvature: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    uSunColor: { value: new THREE.Color(1, 0.97, 0.92) },
    uAmbient: { value: new THREE.Color(0.34, 0.37, 0.44) },
    uFogColor: { value: new THREE.Color(0.68, 0.75, 0.85) },
    uFogDensity: { value: 1 / 26000 },
    uFogEnabled: { value: 1 },
    uSnowLine: { value: 2600 },
    uLatitude: { value: 0 },
    uHasRelief: { value: 0 },
    uNight: { value: 0 },
  };
}

/** Sky dome: a plain three-band gradient plus a sun disc. No lens flare, no glow. */
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunSize;
  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);
    float up = dir.y;
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.55));
    sky = mix(sky, uGround, smoothstep(0.0, -0.12, up));

    float cosAngle = dot(dir, uSunDir);
    float disc = smoothstep(uSunSize, uSunSize + 0.0016, cosAngle);
    float halo = pow(max(cosAngle, 0.0), 90.0) * 0.28;
    sky += uSunColor * (disc + halo);

    gl_FragColor = vec4(sky, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color(0.19, 0.36, 0.66) },
      uHorizon: { value: new THREE.Color(0.72, 0.79, 0.87) },
      uGround: { value: new THREE.Color(0.28, 0.3, 0.32) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uSunSize: { value: 0.9994 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
}

/**
 * Street-level panorama dome. It sits around the player and fades out with
 * distance from where the photo was taken and with height above the ground, so
 * ground photography and satellite terrain meet in a soft band instead of a
 * visible seam.
 */
const PANO_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vDir;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const PANO_FRAG = /* glsl */ `
  precision highp float;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uYaw;
  uniform float uHorizonFade;
  varying vec3 vDir;
  varying vec2 vUv;

  void main() {
    #include <logdepthbuf_fragment>
    vec2 uv = vec2(fract(vUv.x + uYaw), vUv.y);
    vec4 tex = texture2D(uMap, uv);
    // Fade the bottom of the sphere, where a pano is mostly the camera car,
    // and the very top where it is usually stretched sky.
    float lower = smoothstep(-0.62, -0.22, vDir.y);
    float upper = 1.0 - smoothstep(0.55, 0.92, vDir.y) * uHorizonFade;
    gl_FragColor = vec4(tex.rgb, tex.a * uOpacity * lower * upper);
    #include <colorspace_fragment>
  }
`;

export function createPanoramaMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: WHITE_PIXEL },
      uOpacity: { value: 0 },
      uYaw: { value: 0 },
      uHorizonFade: { value: 1 },
    },
    vertexShader: PANO_VERT,
    fragmentShader: PANO_FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
}

export { WHITE_PIXEL };

import * as THREE from '../../vendor/three/three.module.js';

/**
 * The wall at the edge of the loaded world.
 *
 * Ground is only streamed out to the render distance, and past it there was
 * nothing at all — so below the horizon you saw sky, which reads as a hole
 * through the planet rather than as the edge of what has loaded. It is worst
 * on arrival, when the near tiles are in and the far ones are not: the world
 * looks broken rather than merely busy.
 *
 * So the edge is closed with a ring around the camera at exactly the distance
 * the ground stops. Its top sits at eye level and is bent down by the same
 * curvature the terrain shader applies, so the top edge lands on the horizon —
 * no seam above it, no gap below. What you see is a far-off face of ground
 * fading into haze: an edge, not an absence.
 *
 * The radius is not one number. Distant mode keeps drawing over country you
 * have already crossed, so the ground reaches two hundred kilometres down the
 * corridor you flew in along and twenty-four everywhere else. A circle at
 * either distance is wrong — the near one paints over the far ground, the far
 * one leaves the hole it was meant to close — so the ring is measured per
 * sector against what the quadtree actually drew this frame.
 *
 * It is not scenery and does not pretend to be terrain: no texture, no relief,
 * no detail. It is the "not loaded" grey, most of the way into the fog colour,
 * because at the far edge of the view almost everything is haze anyway.
 */

/** How far down the wall reaches. Deeper than any trench, by a lot. */
const WALL_DEPTH_M = 40000;
/** Sectors around the circle. Also the number of sides in the silhouette. */
export const EDGE_SECTORS = 96;

// Same four includes, for the same reason. See the note above CLOUD_VERT in
// weather.js: with a logarithmic depth buffer a hand-written shader that leaves
// these out is depth-testing on a different scale from everything it is drawn
// against, and the wall that closes the world is drawn against the furthest
// ground there is.
const WALL_VERT = /* glsl */ `
  precision highp float;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  uniform float uEarthRadius;
  uniform float uCurvature;
  attribute float aRadius;
  varying float vDepth;
  varying vec3 vDir;

  void main() {
    vec3 local = vec3(position.x * aRadius, position.y, position.z * aRadius);
    vec4 world = modelMatrix * vec4(local, 1.0);
    // The same bend the ground gets, so the top of the wall and the last row
    // of terrain vertices end up on the same line.
    float d = length(world.xz - cameraPosition.xz);
    world.y -= uCurvature * (d * d) / (2.0 * uEarthRadius);
    // 0 at the top edge, 1 a long way down.
    vDepth = 0.5 - position.y;
    // Which way this bit of the rim is, so it can be painted the colour the
    // sky is in that direction rather than one colour all the way round.
    vDir = normalize(world.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const WALL_FRAG = /* glsl */ `
  precision highp float;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform vec3 uFogColor;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uNight;
  varying float vDepth;
  varying vec3 vDir;

  void main() {
    #include <logdepthbuf_fragment>
    // Darkening with depth, the way a cliff face does.
    vec3 base = mix(vec3(0.30, 0.31, 0.33), vec3(0.12, 0.125, 0.135), clamp(vDepth * 4.0, 0.0, 1.0));
    base *= mix(1.0, 0.3, uNight);
    // At the rim, the sky — the same sky, worked out the same way.
    //
    // The wall's top edge sits on the horizon, and anything there that is not
    // the colour of the horizon is a band across the whole view. It was:
    // measured over the Alps at 2 km up, the rim came out (158, 175, 195)
    // against a sky of (214, 225, 237) directly above it, eighty-four levels
    // darker in a strip running from one side of the screen to the other.
    // Hiding the wall put those rows back in line with the sky, which is what
    // pinned it on the wall rather than on the terrain's own fog.
    //
    // Painting it the fog colour was not enough — 84 levels became 41 — because
    // the fog colour is the sky's *base* horizon tint and the sky itself is
    // brighter than that near the sun: the sky shader adds forward scattering,
    // and the whole quarter of the sky around the sun glows with it. So the
    // scattering is worked out here too, from this bit of the rim's own
    // direction, exactly as the sky does it. The rim is at the horizon, where
    // the sky's thickness term has already saturated, so the base is the fog
    // colour and only the scattering has to be added back.
    float toward = max(dot(vDir, uSunDir), 0.0);
    float scatter = pow(toward, 9.0) * 0.34 + pow(toward, 2.0) * 0.11;
    // The sky multiplies its sun colour by 1.6; the shared one is unscaled.
    vec3 haze = mix(uFogColor, uSunColor * 1.6, clamp(scatter, 0.0, 0.62));
    // And below the horizon the sky darkens toward its own ground tint, so the
    // wall follows it there too.
    haze = mix(haze, uFogColor * 0.55, smoothstep(0.0, -0.12, vDir.y));
    // The darkening only comes in well below the rim, where the wall is
    // standing in for a genuine hole in the ground rather than for the horizon
    // and reading as a far-off face is the point.
    float solid = smoothstep(0.02, 0.30, vDepth);
    vec3 colour = mix(haze, mix(base, haze, 0.8), solid);
    // Feather the top few metres so the horizon is a soft line rather than a
    // cut-out, and taper the bottom away instead of ending on a hard rim.
    float alpha = smoothstep(0.0, 0.035, vDepth) * (1.0 - smoothstep(0.75, 1.0, vDepth));
    gl_FragColor = vec4(colour, alpha);
    // Everything else that draws — terrain, sky, clouds — converts to the
    // renderer's output colour space on the way out, and this did not. It was
    // writing linear numbers into an sRGB framebuffer, which is a large,
    // uniform darkening: the fog colour came out (181, 201, 224) where the sky
    // beside it, from the same colour, came out (214, 225, 237). That is the
    // pale band along the horizon, and no amount of adjusting the wall's own
    // shade was ever going to close it.
    #include <colorspace_fragment>
  }
`;

export class EdgeWall {
  constructor(scene, shared) {
    const n = EDGE_SECTORS;
    const positions = new Float32Array((n + 1) * 2 * 3);
    const radii = new Float32Array((n + 1) * 2);
    for (let i = 0; i <= n; i++) {
      // Clockwise from north, matching the bearing the terrain measures with.
      const theta = (i / n) * Math.PI * 2;
      const sx = Math.sin(theta);
      const sz = -Math.cos(theta);
      // Row 0 is the top rim, row 1 the bottom.
      positions.set([sx, 0.5, sz], i * 3);
      positions.set([sx, -0.5, sz], (n + 1 + i) * 3);
    }
    const indices = [];
    for (let i = 0; i < n; i++) {
      const top = i;
      const bottom = n + 1 + i;
      indices.push(top, bottom, top + 1, top + 1, bottom, bottom + 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.radiusAttribute = new THREE.BufferAttribute(radii, 1);
    this.radiusAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aRadius', this.radiusAttribute);
    geometry.setIndex(indices);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uEarthRadius: shared.uEarthRadius,
        uCurvature: shared.uCurvature,
        uFogColor: shared.uFogColor,
        uSunDir: shared.uSunDir,
        uSunColor: shared.uSunColor,
        uNight: shared.uNight,
      },
      vertexShader: WALL_VERT,
      fragmentShader: WALL_FRAG,
      // Both, so the ring reads the same whichever side of it you end up on —
      // a sector that reaches further than its neighbours is seen edge-on from
      // outside as well as inside.
      side: THREE.DoubleSide,
      transparent: true,
      // Never occludes: terrain in front wins on depth, and the wall must not
      // stop the water or the clouds behind it drawing.
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'edge-wall';
    this.mesh.frustumCulled = false;
    // Before every other see-through thing: it is the furthest of them.
    this.mesh.renderOrder = -1;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
    this.smoothed = new Float32Array(EDGE_SECTORS);
  }

  /**
   * @param {THREE.Camera} camera
   * @param {Float32Array} profile metres to the edge of drawn ground, per sector
   */
  update(camera, profile) {
    const n = EDGE_SECTORS;
    // One pass of a three-tap blur around the ring. Neighbouring sectors can
    // differ by a factor of ten where a distant corridor ends, and an
    // unsmoothed step there is a visible notch in the horizon.
    for (let i = 0; i < n; i++) {
      const a = profile[(i - 1 + n) % n];
      const b = profile[i];
      const c = profile[(i + 1) % n];
      this.smoothed[i] = Math.max(500, (a + b * 2 + c) / 4);
    }
    const array = this.radiusAttribute.array;
    for (let i = 0; i <= n; i++) {
      const r = this.smoothed[i % n];
      array[i] = r;
      array[n + 1 + i] = r;
    }
    this.radiusAttribute.needsUpdate = true;

    this.mesh.position.set(camera.position.x, camera.position.y - WALL_DEPTH_M / 2, camera.position.z);
    this.mesh.scale.set(1, WALL_DEPTH_M, 1);
    this.mesh.updateMatrix();
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

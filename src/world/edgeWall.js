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

const WALL_VERT = /* glsl */ `
  precision highp float;
  uniform float uEarthRadius;
  uniform float uCurvature;
  attribute float aRadius;
  varying float vDepth;

  void main() {
    vec3 local = vec3(position.x * aRadius, position.y, position.z * aRadius);
    vec4 world = modelMatrix * vec4(local, 1.0);
    // The same bend the ground gets, so the top of the wall and the last row
    // of terrain vertices end up on the same line.
    float d = length(world.xz - cameraPosition.xz);
    world.y -= uCurvature * (d * d) / (2.0 * uEarthRadius);
    // 0 at the top edge, 1 a long way down.
    vDepth = 0.5 - position.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WALL_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uFogColor;
  uniform float uNight;
  varying float vDepth;

  void main() {
    // Darkening with depth, the way a cliff face does.
    vec3 base = mix(vec3(0.30, 0.31, 0.33), vec3(0.12, 0.125, 0.135), clamp(vDepth * 4.0, 0.0, 1.0));
    base *= mix(1.0, 0.3, uNight);
    // Aerial perspective. Almost all of it, because the wall is at the far
    // edge of the view by definition.
    vec3 colour = mix(base, uFogColor, 0.8);
    // Feather the top few metres so the horizon is a soft line rather than a
    // cut-out, and taper the bottom away instead of ending on a hard rim.
    float alpha = smoothstep(0.0, 0.035, vDepth) * (1.0 - smoothstep(0.75, 1.0, vDepth));
    gl_FragColor = vec4(colour, alpha);
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

import * as THREE from '../../vendor/three/three.module.js';

/**
 * A beam of light standing on every waypoint, and a label saying what it is.
 *
 * A waypoint was a square on two maps. That tells you where a place is when you
 * are looking at a map, and nothing at all when you are looking at the world —
 * which is where you are while you are flying to it. So each one now stands up
 * a coloured beam you can see from a long way off, with its name and how far
 * away it is written beside it.
 *
 * The beam is Minecraft's, in shape and in purpose: a narrow column going
 * straight up, bright at the base and fading out with height, not lighting
 * anything and not blocking anything. Additive, no depth writing, and it is
 * drawn last so it never punches a hole in the ground or the sky.
 *
 * It stands on the *ground*, not on the height the waypoint was dropped at. If
 * you mark a place while gliding a kilometre over it, the beam belongs on the
 * hillside underneath, not hanging in mid-air where you happened to be.
 */

/** How far up the beam goes, in metres. Tall enough to clear most terrain. */
const BEAM_HEIGHT = 2600;
/** How wide, in metres. Narrow, and widened with distance — see update. */
const BEAM_RADIUS = 1.6;
/**
 * How wide a beam is allowed to get on screen, as a fraction of the view.
 *
 * A beam a metre and a half across is invisible from ten kilometres away — it
 * lands inside one pixel and disappears into it. So it is widened with distance
 * until it is about this much of the screen and no more, which keeps it
 * findable from the air without turning into a wall when you walk up to it.
 */
const MIN_SCREEN_SHARE = 0.004;
/** Beyond this there is nothing useful to see. */
export const BEACON_REACH_M = 120000;

const VERTEX = `
  varying float vUp;
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUp = uv.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT = `
  uniform vec3 uColour;
  uniform float uFade;
  varying float vUp;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    // Bright at the foot, gone by the top. Squared, so most of the light is
    // down where the place actually is rather than smeared up the column.
    float up = 1.0 - vUp;
    float strength = up * up * 0.85 + 0.06;
    gl_FragColor = vec4(uColour * strength, strength * uFade);
    #include <colorspace_fragment>
  }
`;

export class Beacons {
  /**
   * @param {THREE.Scene} scene
   * @param {object} store  the waypoint store
   * @param {object} terrain  asked for the ground height under each waypoint
   * @param {object} frame  the local frame, for geo to world
   */
  constructor({ scene, store, terrain, frame }) {
    this.store = store;
    this.terrain = terrain;
    this.frame = frame;
    this.group = new THREE.Group();
    this.group.name = 'beacons';
    // Drawn after the world, so it never writes into the depth the ground
    // needs and never leaves a hole where it crosses a hillside.
    this.group.renderOrder = 20;
    scene.add(this.group);
    /** id -> { mesh, material } */
    this.beams = new Map();
    /** What the HUD should draw: one entry per beacon worth labelling. */
    this.labels = [];
    this._geometry = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    this._world = { x: 0, z: 0 };
    this._screen = new THREE.Vector3();
  }

  makeBeam(waypoint) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColour: { value: new THREE.Color(waypoint.colour ?? '#c8b98f') },
        uFade: { value: 1 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this._geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    this.group.add(mesh);
    return { mesh, material };
  }

  /** Throw everything away — used when the local frame re-anchors. */
  rebase() {
    for (const beam of this.beams.values()) {
      this.group.remove(beam.mesh);
      beam.material.dispose();
    }
    this.beams.clear();
    this.labels.length = 0;
  }

  /**
   * @param {THREE.Camera} camera
   * @param {{lat: number, lon: number}} player  for the distance on each label
   */
  update(camera, player) {
    this.labels.length = 0;
    const list = this.store?.waypoints ?? [];
    const live = new Set();

    for (const waypoint of list) {
      live.add(waypoint.id);
      this.frame.toWorld(waypoint.lat, waypoint.lon, this._world);
      const x = this._world.x;
      const z = this._world.z;
      const dx = x - camera.position.x;
      const dz = z - camera.position.z;
      const flat = Math.hypot(dx, dz);
      if (flat > BEACON_REACH_M) continue;

      let beam = this.beams.get(waypoint.id);
      if (!beam) {
        beam = this.makeBeam(waypoint);
        this.beams.set(waypoint.id, beam);
      }

      // On the ground under it, not at the height it was dropped from.
      const ground = this.terrain.heightAt(x, z);
      // Wide enough to still be a beam at this distance. A fixed width lands
      // inside one pixel from ten kilometres off and vanishes.
      const distance = Math.hypot(flat, camera.position.y - ground);
      const perPixel = (2 * Math.tan((camera.fov * Math.PI) / 360) * distance) / 1;
      const radius = Math.max(BEAM_RADIUS, perPixel * MIN_SCREEN_SHARE);
      beam.mesh.scale.set(radius, BEAM_HEIGHT, radius);
      beam.mesh.position.set(x, ground + BEAM_HEIGHT / 2, z);
      // Fade the last stretch rather than switching it off, so a beam does not
      // blink into existence as you fly toward it.
      beam.material.uniforms.uFade.value = Math.min(1, (BEACON_REACH_M - flat) / 20000);
      beam.mesh.visible = true;

      // Where to write the label: at the foot of the beam, if that is on
      // screen and in front of the camera.
      this._screen.set(x, ground + 6, z).project(camera);
      if (this._screen.z < 1 && Math.abs(this._screen.x) < 1.1 && Math.abs(this._screen.y) < 1.1) {
        this.labels.push({
          id: waypoint.id,
          name: waypoint.name,
          colour: waypoint.colour ?? '#c8b98f',
          metres: flat,
          x: (this._screen.x * 0.5 + 0.5),
          y: (-this._screen.y * 0.5 + 0.5),
        });
      }
    }

    // Anything deleted, or now out of reach, stops being drawn.
    for (const [id, beam] of this.beams) {
      if (live.has(id)) continue;
      this.group.remove(beam.mesh);
      beam.material.dispose();
      this.beams.delete(id);
    }
    for (const [id, beam] of this.beams) {
      if (!list.some((w) => w.id === id)) beam.mesh.visible = false;
    }
    // Nearest last, so the closest label is drawn on top of the others.
    this.labels.sort((a, b) => b.metres - a.metres);
  }
}

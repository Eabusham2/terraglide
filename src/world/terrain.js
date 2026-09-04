import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../core/math.js';
import { EDGE_SECTORS } from './edgeWall.js';
import { settings } from '../core/settings.js';
import { tileKey, wrapTileX } from '../geo/mercator.js';
import { createTerrainMaterial } from './shaders.js';
import { zoomCeiling } from '../tiles/providers.js';

/**
 * Terrain: a mercator quadtree streamed around the camera.
 *
 * Each frame we walk down from a handful of coarse root tiles, subdividing while
 * a tile is closer than `lodFactor` times its own width, and draw the leaves.
 * Leaves carry a grid mesh with a dropped skirt around the edge, which hides the
 * one-pixel cracks where two different LODs meet without needing stitched index
 * buffers.
 *
 * Everything that could stutter is budgeted: mesh building has a millisecond
 * allowance per frame, texture loads are prioritised by distance and cancelled
 * when they stop being wanted, and a tile with no texture yet borrows its
 * parent's rather than popping in as a hole.
 */

/**
 * Ceiling on how many tiles one frame may draw, per graphics preset.
 *
 * It is a safety rail rather than a budget: the walk is ordered by distance, so
 * hitting it drops the farthest ground, and dropping ground leaves a hole. The
 * numbers are high enough that a normal view never reaches them and low enough
 * that a pathological one cannot lock the machine up.
 */
const SEA_LEVEL = 0;
/** Mean Earth radius, for the geometric horizon. */
const EARTH_RADIUS_M = 6371000;
/**
 * How much further than the render distance a built tile is kept before it may
 * be thrown away. Turning round used to mean rebuilding everything behind you
 * from nothing; a half again of margin means the ground you just flew over is
 * still there when you come back to it.
 */
const KEEP_FACTOR = 1.5;
/** How much further distant mode reaches than the render distance proper. */
/**
 * The most tiles one frame will rebuild for being plainly wrong rather than
 * merely out of date. High enough that arriving somewhere new sorts itself out
 * within a second or two, low enough that it cannot stall a frame outright.
 */
const REBUILD_CEILING = 48;
/**
 * The two sides of the split threshold, as fractions of it.
 *
 * Twelve per cent apart, which at any zoom is a comfortable few metres of
 * camera movement — far more than a frame's worth of jitter and far less than
 * a deliberate approach.
 */
/**
 * How many coarse stand-ins may be rebuilt in one frame.
 *
 * Refreshing a stale stand-in is the cheapest rebuild there is *per pixel
 * covered*, and that is exactly why it has to be rationed. A stand-in four
 * levels up is a ten-kilometre mesh; while the elevation under it is still
 * arriving it is marked stale again every frame, and every leaf that falls
 * back to it asks for it to be rebuilt. Left alone, a handful of those ate
 * the entire frame's build allowance, every frame, and the leaves that would
 * have replaced them never got built at all — so a zoom-12 stand-in stayed on
 * screen beside zoom-18 leaves that had managed to squeeze through. Six levels
 * of texel density side by side is the patchwork.
 */
const STANDIN_REFRESHES = 2;
/**
 * How far along an edge to look when deciding how deep that point's skirt has
 * to be, in grid samples. A neighbour one level coarser straightens two of our
 * cells into one, two levels coarser straightens four; four either way covers
 * both with room to spare, and costs nothing where the ground is level because
 * a flat window still measures zero.
 */
const SKIRT_REACH = 4;

/**
 * How small the square under your feet may get before the walk stops refining
 * it for its own sake rather than for its photograph.
 *
 * The mesh you stand on has to be right even where no imagery has arrived, so
 * a square the camera is inside is allowed to split whatever its photograph is
 * doing. Unbounded that is not an exemption, it is the runaway: you are inside
 * a square at every level of the tree, so "near" is true all the way down.
 * Sixty-four metres across is a metre and a half between vertices at the grids
 * used here — finer than standing on it can tell.
 */
const NEAR_GEOMETRY_M = 64;

/**
 * How far over the tile cap the walk may go before it gives up and leaves a
 * hole after all.
 *
 * Past the cap the walk stops splitting, so each square it still has to reach
 * costs one draw rather than a whole subtree — see visit. That overshoot is
 * bounded by the shape of the walk at about two fifths of the cap, so twice it
 * is a ceiling nothing normal reaches. It exists only so that a pathological
 * frame cannot run away, and at that point one frame over budget really is
 * better than a grey wall through the middle of the world.
 */
const HOLE_RATHER_THAN_STALL = 2;
/**
 * How far around you the ground is built regardless of where you are looking.
 *
 * Terminal velocity is 78 m/s and a mesh takes a moment to arrive, so a couple
 * of hundred metres covers anywhere you can reach before it does. It costs one
 * chain of tiles down to the leaf plus its neighbours — a handful — because
 * every level of the quadtree has only a few tiles this close.
 */
/**
 * How long a tile takes to walk to its new height, in seconds, and how far it
 * has to move to be worth walking at all.
 *
 * A third of a second is long enough that nothing snaps and short enough that
 * the ground is never visibly wrong — you are looking at land that is a metre
 * out for a fifth of a second, which is under the threshold at which anyone
 * notices a hill is the wrong height, and well over the one at which they
 * notice it jumped.
 *
 * The floor is there because most rebuilds are for a fresh photograph rather
 * than fresh relief: without it every one of those would start a morph with
 * nothing to morph.
 */
const MORPH_SECONDS = 0.33;
const MORPH_MIN_M = 0.05;

const FLOOR_REACH = 250;
const LOD_HYSTERESIS_IN = 0.88;
const LOD_HYSTERESIS_OUT = 1.12;

export class Terrain {
  constructor({ scene, frame, streamer, elevation, shared }) {
    this.scene = scene;
    this.frame = frame;
    this.streamer = streamer;
    this.elevation = elevation;
    this.shared = shared;

    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);

    this.nodes = new Map();
    /** Tile keys currently drawn as four children rather than as themselves. */
    this.split = new Set();
    this.drawn = [];
    this.frustum = new THREE.Frustum();
    this.projScreenMatrix = new THREE.Matrix4();
    this.stats = { drawn: 0, built: 0, nodes: 0, baseZoom: 0, maxZoom: 0 };
    // Scratch for drawnY, so reading the floor allocates nothing per frame.
    this._triA = new THREE.Vector3();
    this._triB = new THREE.Vector3();
    this._triC = new THREE.Vector3();
    this._bary = new THREE.Vector3();
    this._hitLocal = new THREE.Vector3();
    this.wantedElevationZoom = 6;

    this._box = new THREE.Box3();
    this._ray = new THREE.Raycaster();
    this._rayOrigin = new THREE.Vector3();
    this._rayDown = new THREE.Vector3(0, -1, 0);
    this._vecA = new THREE.Vector3();
    this._norm = { nx: 0, ny: 0 };
    this._world = { x: 0, z: 0 };
    this._cover = { x: 0, z: 0 };
    this._geo = { lat: 0, lon: 0 };
    /**
     * Optional test for "have I been here before", used by distant mode. Set by
     * the game; left null the quadtree simply stops at the render distance.
     */
    this.explored = null;
    /**
     * How far ground actually reaches, by compass sector, in metres. Measured
     * during the walk so the wall that closes the world off can sit on the
     * real edge rather than on the setting. See `EdgeWall`.
     */
    this.edgeProfile = new Float32Array(EDGE_SECTORS);
    /**
     * Optional test for "is this ground already drawn as photogrammetry".
     * Set by the game when the 3D tileset is connected; left null the quadtree
     * draws everything, which is what it should do when there is no 3D at all.
     */
    this.covered3d = null;
  }

  get gridSize() {
    const preset = settings.preset();
    // The detail dial scales the mesh with everything else, so one control
    // does the whole job rather than three that have to be kept in step.
    const detail = clamp(settings.get('detailLimit') / 100, 0.25, 1);
    return clamp(Math.round(preset.tileGridSize * settings.get('meshDetail') * detail), 5, 65);
  }

  /**
   * The mesh grid for one tile, which cannot usefully be finer than the
   * elevation under it.
   *
   * Every tile used to get the same grid whatever its size. A zoom-22 tile is
   * about six and a half metres across and the finest elevation anyone serves
   * is zoom 14, whose samples are about six and a half metres apart — so that
   * tile spans *one* sample, and a 33 by 33 grid on it is 1,089 vertices all
   * interpolating between the same two numbers. It cannot be anything but flat,
   * and it costs a thousand vertices to say so. Standing in Grindelwald the
   * ground within thirty metres is drawn at zooms 20 to 22, which is the ground
   * you are looking at hardest.
   *
   * So the grid follows the data: 256 samples per elevation tile, halving with
   * every zoom past the elevation's own. Taken from the provider's maximum
   * rather than from what happens to be loaded here, so every tile at a given
   * zoom gets the same grid and neighbours cannot crack against each other.
   *
   * This does not make the ground less flat — there is no data at that spacing
   * to be had, and inventing some is the one thing this project will not do.
   * It stops paying a thousand vertices for the flatness.
   */
  gridFor(tile) {
    const grid = this.gridSize;
    const elevMax = this.elevation?.maxZoom;
    if (!Number.isFinite(elevMax)) return grid;
    const across = 256 * Math.pow(2, elevMax - tile.z);
    if (!(across < grid - 1)) return grid;
    return clamp(Math.round(across) + 1, 5, grid);
  }

  /** How aggressively tiles subdivide; derived from the graphics preset. */
  get lodFactor() {
    return 4.6 / settings.preset().sseThreshold;
  }

  /**
   * Ground height (metres, sea clamped) at a normalised mercator point.
   *
   * The clamp is why the Dead Sea shore reads 0 m here and is -430 m in life,
   * and it is a decision rather than an oversight. AWS Terrain Tiles carry
   * bathymetry: without the clamp the ocean stops being a surface and becomes
   * a canyon, kilometres deep, with the sea shading — which keys off ground at
   * or under sea level — draped down the inside of it. Checked against known
   * heights, everything above the waterline is right: Mont Blanc 4,778 against
   * 4,808, Aranjuez 499 against 494, Amsterdam 5 against 2. Only ground below
   * it is flattened.
   *
   * Undoing it properly needs to tell land below sea level from sea, at the
   * resolution the ground is built at. There is no such source here. The water
   * probe classifies imagery on a 32x32 mask per zoom-6 tile — kilometres to a
   * cell, loaded only where something has asked — so a misread over open water
   * would drop that square to its bathymetric depth and put a hole in the sea.
   * A wrong hole in every ocean is a worse trade than a flat floor in the half
   * dozen basins this affects: the Jordan Rift, Death Valley, Turfan, Qattara,
   * the Caspian depression, the Salton Sea.
   */
  heightAtNorm(nx, ny) {
    return Math.max(SEA_LEVEL, this.elevation.sampleNorm(nx, ny));
  }

  /** Ground height at a world-space XZ position. */
  heightAt(x, z) {
    this.frame.worldToNorm(x, z, this._norm);
    return this.heightAtNorm(this._norm.nx, this._norm.ny);
  }

  /** Raw ground height including bathymetry, so water depth can be measured. */
  bedAt(x, z) {
    this.frame.worldToNorm(x, z, this._norm);
    return this.elevation.sampleNorm(this._norm.nx, this._norm.ny);
  }

  /** True when real elevation has arrived for this spot. */
  /**
   * Bumped every time a new elevation tile lands.
   *
   * Anything that stands things *on* the ground watches this. Before the relief
   * for a square has arrived, every height there reads back as exactly sea
   * level and `hasElevationAt` is false — so a wood that OpenStreetMap has
   * mapped is dropped rather than planted, and a building is founded at zero.
   * Neither is retried on its own, because nothing about the wood or the
   * building changed; what changed was the ground under them.
   */
  get elevationVersion() {
    return this.elevation?.version ?? 0;
  }

  hasElevationAt(x, z) {
    this.frame.worldToNorm(x, z, this._norm);
    return this.elevation.hasDataAt(this._norm.nx, this._norm.ny);
  }

  /** Finest elevation zoom with real data at a world position, or -1. */
  elevationZoomAt(x, z) {
    this.frame.worldToNorm(x, z, this._norm);
    return this.elevation.zoomAt(this._norm.nx, this._norm.ny);
  }

  /**
   * The finest elevation available anywhere inside a tile's footprint.
   *
   * Asking only at the centre missed the commonest improvement there is: a DEM
   * tile landing next door sharpens this tile's *edge* and leaves its middle
   * exactly as it was, so the mesh was never marked stale and the seam with
   * its neighbour stayed where it was — a step, at an LOD boundary, in the
   * shape of the tile grid. Five samples cost nothing and catch it.
   */
  elevationZoomFor(x0, z0, size) {
    const inset = size * 0.02;
    let best = this.elevationZoomAt(x0 + size / 2, z0 + size / 2);
    for (const [dx, dz] of [[inset, inset], [size - inset, inset], [inset, size - inset], [size - inset, size - inset]]) {
      const z = this.elevationZoomAt(x0 + dx, z0 + dz);
      if (z > best) best = z;
    }
    return best;
  }

  /** True when this spot is open water (DEM at or below sea level). */
  isWaterAt(x, z) {
    this.frame.worldToNorm(x, z, this._norm);
    // Ground nobody has measured yet reads back as exactly sea level, and
    // exactly sea level is not the same as being *at* sea. Without this guard
    // every arrival is at sea for as long as the DEM takes to land — and
    // since the probe rings around you read zero too, it is not merely at sea
    // but "open ocean", in the middle of Australia, seven hundred metres up.
    if (!this.elevation.hasDataAt(this._norm.nx, this._norm.ny)) return false;
    return this.elevation.sampleNorm(this._norm.nx, this._norm.ny) <= SEA_LEVEL;
  }

  /** Surface normal at a world position, from finite differences. */
  normalAt(x, z, out = new THREE.Vector3()) {
    const d = 2;
    const hl = this.heightAt(x - d, z);
    const hr = this.heightAt(x + d, z);
    const hu = this.heightAt(x, z - d);
    const hd = this.heightAt(x, z + d);
    return out.set(hl - hr, 2 * d, hu - hd).normalize();
  }

  /** Throw everything away — used when the local frame re-anchors. */
  rebase() {
    for (const node of this.nodes.values()) this.disposeNode(node);
    this.nodes.clear();
    this.split.clear();
    this.drawn.length = 0;
  }

  /**
   * Every square is built from the wrong numbers now, but every square is still
   * in the right place.
   *
   * Changing the mesh detail, the graphics tier or the elevation provider used
   * to call `rebase`, which throws the whole world away — and throwing it away
   * is what makes changing a setting cost a second of your life. Nothing is
   * left for `draw` to fall back on: no mesh to keep showing, no ancestor to
   * stand in, no cover tile to grow. So it takes the last branch and builds
   * anyway, over budget, for as many squares as are on screen. Measured over
   * the Black Forest, one step of the graphics setting rebuilt 497 meshes
   * inside one second, which is the hang.
   *
   * A mesh built from the wrong grid is still a mesh: it is at the right
   * height, in the right place, wearing the right photograph, and only its
   * resolution is stale. So they are marked instead of destroyed. `draw`
   * already knows what to do with a square marked dirty — rebuild it when the
   * frame can afford one, and keep drawing the old one until then — so the
   * world stays whole on screen and sharpens over the next few seconds
   * instead of vanishing and coming back.
   *
   * `rebase` proper still destroys, and has to: an origin move changes what
   * the coordinates mean, and a lost WebGL context has already destroyed them.
   */
  resettle() {
    for (const node of this.nodes.values()) node.dirty = true;
  }

  /**
   * @param {THREE.Camera} camera  what the ground is built *for*: distance,
   *   level of detail, which square is asked for first.
   * @param {number} budgetMs
   * @param {THREE.Camera} [viewCamera]  what the ground is *seen* through, if
   *   that is something else. Only the frustum comes from this one.
   */
  update(camera, budgetMs, viewCamera = camera) {
    this.settleHeights();
    const preset = settings.preset();
    // The ground always sharpens as far as the provider will actually serve
    // here. The setting is a ceiling you may lower, not a target — there is no
    // tick to forget to turn on any more — and the detail dial scales it down
    // with everything else when the frame rate is short.
    const detail = clamp(settings.get('detailLimit') / 100, 0.25, 1);
    // The setting's last notch means no ceiling at all, which is where it sits
    // by default: every fixed number here has been wrong in turn — nineteen,
    // then twenty, then the deepest a provider declared — and the two things
    // that can actually answer are the provider refusing and the photographs
    // themselves stopping getting sharper. Both are measured; neither needs
    // updating when somebody flies a city better.
    const ceiling = zoomCeiling(settings.get('maxTileZoom')) - Math.round((1 - detail) * 4);
    const maxZoom = Math.min(ceiling, this.streamer.maxUsefulZoom);
    // Uses eyeAboveGround, which is set from the camera below; on the very
    // first frame it is undefined and the setting stands, which is right.
    this.eyeAboveGround = Math.max(0, camera.position.y - this.heightAt(camera.position.x, camera.position.z));
    const renderDistance = this.renderDistance;
    // Distant mode: keep drawing past the render distance, but only over
    // country you have already flown across. Ground you have never seen stops
    // at the edge as it always did, so the setting cannot quietly double what
    // an unexplored world costs to stream.
    // Two distances, because they cost completely different things. The near
    // one is ground drawn anywhere and every kilometre of it has to be
    // fetched; the far one only applies where the explored map says you have
    // already been, so those tiles are cached and the cost is drawing. That is
    // why one stops at 64 km and the other can run to 1024.
    this.farDistance =
      this.explored && settings.get('distantMode')
        ? Math.max(renderDistance, settings.get('distantDistanceKm') * 1000)
        : renderDistance;
    this.keepDistance = this.farDistance * KEEP_FACTOR;
    // From the preset, which resolves 'auto' to the tier actually chosen. It
    // used to be a table here keyed on the raw setting, and 'auto' — which is
    // what everybody who has not picked by hand reads — was not one of its
    // keys, so every machine silently took the high figure. See
    // GRAPHICS_PRESETS.maxDrawnTiles.
    this.maxDrawn = settings.preset().maxDrawnTiles;
    // Which way you are facing, flattened. Ground in front of you is what you
    // are about to look at, so it is what gets built first and sharpened
    // furthest.
    //
    // Smoothed, because the heading now decides how finely ground subdivides
    // as well as what order it is built in. Read raw, a flick of the mouse
    // re-cuts the quadtree twice — once away and once back — and every re-cut
    // is a rebuild you can see. Two thirds of a second of lag makes a
    // deliberate turn count and a twitch not.
    camera.getWorldDirection(this._vecA);
    const wantLen = Math.hypot(this._vecA.x, this._vecA.z) || 1;
    const wantX = this._vecA.x / wantLen;
    const wantZ = this._vecA.z / wantLen;
    const now = performance.now();
    const viewDt = clamp((now - (this._viewTime ?? now)) / 1000, 0, 0.5);
    this._viewTime = now;
    const follow = this._viewX === undefined ? 1 : 1 - Math.exp(-viewDt / 0.66);
    this._viewX = (this._viewX ?? wantX) + (wantX - (this._viewX ?? wantX)) * follow;
    this._viewZ = (this._viewZ ?? wantZ) + (wantZ - (this._viewZ ?? wantZ)) * follow;
    const flatLen = Math.hypot(this._viewX, this._viewZ) || 1;
    this._viewX /= flatLen;
    this._viewZ /= flatLen;

    this.streamer.beginFrame();
    this.elevation.beginFrame();

    // Culled against the camera the frame is actually drawn through, which is
    // not always the one the ground is built for.
    //
    // In freecam they are different on purpose: streaming stays anchored to the
    // player so flying the camera across a country does not re-cut the whole
    // quadtree. But the frustum came from the same camera, so anything outside
    // the *player's* view was never drawn — and the freecam is usually pointed
    // at exactly that. Ground behind the player was simply not there: no mesh,
    // no hole to see it through, just the sky. Which is "in freecam the ground
    // behind me is invisible", and most of what "the ground is not holding, as
    // seen by freecam" was actually showing.
    this.projScreenMatrix.multiplyMatrices(
      viewCamera.projectionMatrix,
      viewCamera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    const camX = camera.position.x;
    const camZ = camera.position.z;

    // Root zoom: the coarsest level whose tiles still comfortably cover the
    // view distance, so the recursion starts with only a few tiles.
    const worldSpan = 2 * Math.PI * this.frame.scale;
    let baseZoom = Math.floor(Math.log2(worldSpan / Math.max(this.farDistance * 2, 1000)));
    baseZoom = clamp(baseZoom, 1, Math.max(1, maxZoom - 1));

    for (const node of this.drawn) node.mesh.visible = false;
    this.drawn.length = 0;
    // The near circle is drawn everywhere, so it is the floor. Sectors where
    // distant mode reaches further raise it as the walk finds them.
    // The floor for every sector is the squircle, not the circle, so the wall
    // that closes the edge lands on the ground's real boundary rather than
    // inside it on the diagonals.
    for (let i = 0; i < EDGE_SECTORS; i++) {
      const theta = ((i + 0.5) / EDGE_SECTORS) * Math.PI * 2;
      this.edgeProfile[i] = renderDistance * this.squircle(Math.sin(theta), -Math.cos(theta));
    }

    this.budget = { ms: budgetMs, start: performance.now(), built: 0, refreshed: 0 };

    const n = Math.pow(2, baseZoom);
    this.frame.worldToNorm(camX, camZ, this._norm);
    const rootX = Math.floor(this._norm.nx * n);
    const rootY = Math.floor(clamp(this._norm.ny, 0, 0.999999) * n);
    // Enough root tiles to cover the view circle, however big the distance is.
    const rootSize = this.frame.worldTileSize(baseZoom);
    const span = clamp(Math.ceil(this.farDistance / rootSize) + 1, 1, 6);

    // Visit nearest first so the closest ground always gets the frame's build
    // budget. Doing it in fixed quadrant order let distant tiles eat the budget,
    // which is why the ground under your feet could stay coarse while the
    // horizon looked fine.
    const roots = [];
    for (let dy = -span; dy <= span; dy++) {
      const ty = rootY + dy;
      if (ty < 0 || ty >= n) continue;
      for (let dx = -span; dx <= span; dx++) {
        const cx = camX + (dx + 0.5) * rootSize;
        const cz = camZ + (dy + 0.5) * rootSize;
        roots.push({
          z: baseZoom,
          x: wrapTileX(rootX + dx, baseZoom),
          y: ty,
          d: this.viewDistance(cx, cz, camX, camZ, Math.hypot(dx, dy) * rootSize),
        });
      }
    }
    roots.sort((a, b) => a.d - b.d);
    for (const root of roots) {
      this.visit(root, camera, camX, camZ, renderDistance, maxZoom);
    }

    // Elevation follows the camera: coarse when high up, sharpest on foot.
    const altitude = Math.max(1, camera.position.y - this.heightAt(camX, camZ));
    const elevZoom = clamp(Math.round(19 - Math.log2(altitude + 1) * 1.35), 6, this.elevation.maxZoom);
    /**
     * The elevation zoom being asked for right now.
     *
     * Published because "is the ground under me real" cannot be answered
     * against the finest zoom the field could ever hold — high up, nothing
     * finer than this is ever fetched, so waiting for it waits for ever. What
     * can be asked is whether the data here is as fine as what is currently
     * being requested for this altitude. See Game.groundIsReal.
     */
    this.wantedElevationZoom = elevZoom;
    this.elevation.ensureAround(this._norm.nx, this._norm.ny, elevZoom, 1);

    this.streamer.pump();
    this.streamer.evict();
    this.evict(preset.textureCacheSize, camX, camZ);

    this.stats.drawn = this.drawn.length;
    this.stats.nodes = this.nodes.size;
    this.stats.baseZoom = baseZoom;
    this.stats.maxZoom = maxZoom;
  }

  /**
   * Metres of ground drawn around the camera.
   *
   * However far you can actually see, within reason. Standing on the ground
   * the horizon is five kilometres off and the setting governs; two thousand
   * metres up it is a hundred and fifty, and drawing to the setting anyway
   * stops the world at twenty-four — which puts a flat pale band of haze
   * across the view where mountains should be, with clear sky above it. That
   * band is the wall at the edge of the loaded world, standing a sixth of the
   * way to the horizon.
   *
   * Reaching further is much cheaper than it sounds: a quadtree spends about
   * the same on each ring however far out it is, because the rings coarsen
   * with distance. Six times the setting is the ceiling, so the setting still
   * means something.
   */
  get renderDistance() {
    const setting = settings.get('renderDistanceKm') * 1000;
    const horizon = Math.sqrt(2 * EARTH_RADIUS_M * Math.max(1, this.eyeAboveGround ?? 0));
    // With the haze switched off, the ceiling comes off with it.
    //
    // The six-times cap is there because the haze hides the edge of the drawn
    // world: past it the ground is thick enough with air that stopping is not
    // visible, so drawing further is cost for nothing. Turn the haze off and
    // that reasoning goes with it — there is now nothing between you and the
    // edge, and the world simply ends in a line, which is most of "the ground
    // is a different colour far away". So with the tick off it reaches the
    // real horizon instead, which from four hundred metres up is seventy
    // kilometres and from four thousand is two hundred and twenty.
    if (!settings.get('fog')) return Math.max(setting, horizon);
    return clamp(horizon, setting, setting * 6);
  }

  /**
   * How far away a tile *effectively* is for ordering purposes.
   *
   * Straight-line distance alone builds the ground behind you at the same
   * priority as the ground you are looking at, and on a frame where the budget
   * runs out the difference is a hole in the view rather than a hole behind
   * your head. Ground within the view cone keeps its real distance; ground
   * behind you is treated as further off than it is.
   */
  /**
   * How much further the world reaches in this direction than it does along an
   * axis, for a squircle of exponent four.
   *
   * One straight ahead and to the side, 1.19 on the diagonals. `dx` and `dz`
   * are an offset, not a direction, so a tile the camera is standing inside
   * gets one rather than a division by zero.
   */
  squircle(dx, dz) {
    const ax = Math.abs(dx);
    const az = Math.abs(dz);
    const r = Math.hypot(ax, az);
    if (r < 1e-6) return 1;
    const c = ax / r;
    const s = az / r;
    return 1 / Math.pow(c * c * c * c + s * s * s * s, 0.25);
  }

  viewDistance(cx, cz, camX, camZ, flat) {
    const dx = cx - camX;
    const dz = cz - camZ;
    const len = Math.hypot(dx, dz);
    if (len < 1) return flat;
    const facing = (dx * this._viewX + dz * this._viewZ) / len;
    // +1 dead ahead, -1 directly behind: a tile behind you sorts as up to
    // three times its distance, which puts it after everything in front.
    return flat * (1.6 - facing * 0.6);
  }

  /**
   * Record how far the world reaches past a tile, by compass sector.
   *
   * The tile is far away by the time this is called, so it covers only a
   * narrow wedge; its half-angle is taken from its own half-diagonal rather
   * than from its corners, which avoids the wrap-around arithmetic entirely
   * and is accurate to well under a sector at these distances.
   */
  noteEdge(x0, z0, x1, z1, camX, camZ) {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const dx = cx - camX;
    const dz = cz - camZ;
    const centre = Math.hypot(dx, dz);
    if (centre < 1) return;
    const half = Math.hypot(x1 - x0, z1 - z0) / 2;
    // The far corner, which is where the ground genuinely ends.
    const reach = centre + half;
    const spread = Math.asin(Math.min(1, half / centre));
    const step = (Math.PI * 2) / EDGE_SECTORS;
    // Bearing, clockwise from north — the same convention the wall's ring is
    // built in, so sector 0 is north on both sides of the handover.
    const middle = Math.atan2(dx, -dz);
    const from = Math.floor((middle - spread) / step);
    const to = Math.ceil((middle + spread) / step);
    for (let i = from; i <= to; i++) {
      const sector = ((i % EDGE_SECTORS) + EDGE_SECTORS) % EDGE_SECTORS;
      if (reach > this.edgeProfile[sector]) this.edgeProfile[sector] = reach;
    }
  }

  /**
   * How much further a tile may be and still subdivide, given where you look.
   *
   * Detail costs the same wherever it is spent, so spending it evenly means
   * spending most of it on ground nobody is looking at. Tiles inside the view
   * cone get a quarter more reach and tiles behind you a quarter less — a
   * little over half a level either way — so the horizon you are facing
   * reaches full detail sooner and the ground behind your head stays coarse
   * until you turn round.
   *
   * Ground close enough to be underfoot is exempt: it is about to be in view
   * whichever way you turn, and it is what you land on.
   */
  splitScale(cx, cz, camX, camZ, flatDist, size) {
    if (flatDist < size) return 1;
    const dx = cx - camX;
    const dz = cz - camZ;
    const len = Math.hypot(dx, dz);
    if (len < 1) return 1;
    return 1 + ((dx * this._viewX + dz * this._viewZ) / len) * 0.25;
  }

  visit(tile, camera, camX, camZ, renderDistance, maxZoom) {
    /*
      Running out of budget used to `return` here, and that is where the holes
      came from.

      The walk is depth first: a square splits into four, the four are sorted
      nearest first, and each is followed all the way down to its leaves before
      the next one is looked at. So the budget is spent entirely on the first
      branch, and when it runs out every square the walk had not reached yet is
      simply never drawn — not coarsely, not at all. Nothing stands in for it.
      What shows through is the edge wall, which is the "not loaded" grey most
      of the way into the fog colour.

      This is not what produced the missing ground measured over the Black
      Forest at twenty-five metres — that frame drew 388 squares against a cap
      of 520, so the cap was never reached, and it is still being chased. But
      every other path through `draw` goes to some length to make sure a square
      always has *something* to show, down to going over the build budget
      rather than leaving a gap, and this one line quietly undid all of it the
      moment the tile count did run out.

      A quadtree that cannot afford more detail should draw *coarser* ground,
      never *no* ground. So the cap now stops the splitting rather than the
      drawing: past it, every square the walk reaches is drawn as it is and its
      children are never asked for. The overshoot is bounded and small — once
      splitting stops, each unvisited branch costs exactly one square, so it is
      three siblings per level of the stack plus the roots not yet reached,
      about two hundred over a cap of five hundred and twenty, and every one of
      them covers a large piece of ground. A hard ceiling well above that is
      kept below as a last resort, where being over budget for one frame is
      worse than a hole.
    */
    const outOfBudget = this.drawn.length >= this.maxDrawn;
    if (this.drawn.length >= this.maxDrawn * HOLE_RATHER_THAN_STALL) return;

    const size = this.frame.worldTileSize(tile.z);
    const n = Math.pow(2, tile.z);
    this.frame.normToWorld(tile.x / n, tile.y / n, this._world);
    const x0 = this._world.x;
    const z0 = this._world.z;
    const x1 = x0 + size;
    const z1 = z0 + size;

    const dx = Math.max(x0 - camX, 0, camX - x1);
    const dz = Math.max(z0 - camZ, 0, camZ - z1);
    // Distance to the nearest point of the tile, not to its centre and not per
    // axis, so the edge of the world is a smooth curve rather than a square
    // with corners poking a factor of root two further out.
    const flatDist = Math.hypot(dx, dz);
    // And that curve is a squircle: the setting's distance along the axes, a
    // fifth further into the corners. A circle is the honest shape for "how far
    // can I see", but a screen is not round — the corners of the view are the
    // first place a circular edge shows itself, and stretching the boundary
    // there costs a few per cent of the tiles for a horizon that stays put as
    // you turn. Exponent four: |x|^4 + |z|^4 = r^4, which is 1.19 times the
    // radius on the diagonal and exactly the radius on the axes.
    const reach = renderDistance * this.squircle(dx, dz);
    if (flatDist > reach) {
      if (flatDist > this.farDistance * this.squircle(dx, dz)) return;
      if (!this.explored || !this.explored(tile)) return;
    }

    // Cheap vertical bounds for culling; refined once the tile is built.
    //
    // Only trust a node's own bounds if they were measured against the
    // elevation we have now. A tile built before its relief arrived is flat at
    // sea level and says so, and over ground that turns out to be four hundred
    // metres up that box is nowhere near the mesh — so the frustum rejects it,
    // and a rejected node is never in `drawn`, and what is never in `drawn` is
    // never rebuilt. The tile stays a hole in the world for as long as you
    // stand there, with every tile around it loaded and nothing failing. That
    // is where the missing chunks came from, and it is why the fallback here
    // is a generous box rather than a clever one.
    const cached = this.nodes.get(tileKey(tile.z, tile.x, tile.y));
    const measured = cached && cached.builtVersion === (this.elevation.version ?? 0);
    const minY = measured ? cached.minY : -200;
    const maxY = measured ? cached.maxY : 6000;

    /*
      Padded by everything that moves the geometry after this box was measured.

      The box is built from the heights the mesh was made with, and then the
      vertex shader moves all of it: down by the curvature bend, which is
      d²/2R and reaches tens of metres by the time ground is kilometres away;
      down again by a stand-in's sink; down as far as the skirt hangs, which is
      the edge's relief and now also however far a rebuild is walking; and up by
      the canopy lift over a wood. None of that is in `cached.minY/maxY`, so a
      square near the edge of the view can be rejected on bounds it has already
      left — and a rejected square is never drawn, never in `drawn` and never
      rebuilt, which is a tile-shaped hole with the quadtree's own staircase
      along its edge, exactly where the frustum's edge falls.

      Padding can only ever draw more, never less, and it costs a handful of
      squares at the rim of the view.
    */
    const shaderReach = 60 + (flatDist * flatDist) / (2 * EARTH_RADIUS_M);
    this._box.min.set(Math.min(x0, x1), minY - shaderReach, Math.min(z0, z1));
    this._box.max.set(Math.max(x0, x1), maxY + shaderReach, Math.max(z0, z1));
    // The ground you are standing on is not a view. It is the floor, and it
    // has to be right whichever way you happen to be facing.
    //
    // This walk returns outright for anything outside the view cone — never
    // visited, never split, never asked for. Looking at the horizon puts the
    // ground directly beneath you outside that cone, so it stayed coarse; then
    // looking down brought it in, the real relief arrived, and the height under
    // your feet moved by however much the mountain was worth. That is
    // "teleporting again when I look down after a teleport", and it is the
    // same bug as "teleporting when I look down after an RTP".
    //
    // Worse than the jump: a culled tile is never in `drawn`, and meshHeightAt
    // walks `drawn`. So while you were not looking at it, the game did not know
    // where the floor was at all and fell back to carrying the last one it did
    // know. Turning your head lost the ground.
    //
    // The frustum stays for everything else — it is most of what makes this
    // affordable. It just does not get a say about the square you are on.
    if (flatDist > FLOOR_REACH && !this.frustum.intersectsBox(this._box)) return;

    // Splitting, with hysteresis.
    //
    // A tile sitting exactly on the threshold used to flip between itself and
    // its four children every frame the camera twitched — and each flip is a
    // build, a texture swap and a visible pop. Flying along a boundary made
    // whole bands of ground appear and vanish and appear again, which is
    // "things keep going away and coming back" and most of "gaps coming and
    // going" too.
    //
    // So the two thresholds differ: a tile has to come 12% closer than the
    // line to split, and go 12% past it to merge again. Anything in between
    // keeps doing whatever it was already doing.
    // Do not outrun the photographs.
    //
    // Splitting is decided by distance alone, and imagery arrives when it
    // arrives, so a tile could be drawn at zoom 18 while the only photograph
    // it can find is eight levels up — stretched over its whole width — with
    // a neighbour beside it that did get its own. That is the patchwork: sharp
    // forest canopy in irregular patches inside a smeared background, with
    // hard tile-shaped edges between them. It is a pattern on the ground and
    // it is nothing to do with what is growing there.
    //
    // A tile may only split once it has a photograph of its own, or its
    // parent's at worst. Then every tile on screen is within one level of
    // every other, the whole view sharpens together as the imagery lands, and
    // the edges have nothing to mark. Ground close enough to stand on is
    // exempt: geometry there matters more than the texture on it.
    const key = tileKey(tile.z, tile.x, tile.y);
    const photo = this.streamer.resolve(tile);
    // How far the square actually is, not how far it is across the ground.
    //
    // The split test used the horizontal distance, which is nought for the
    // ground directly beneath you however high you are. So at nine thousand
    // metres the quadtree descended to zoom 23 straight down — maximum depth,
    // for a patch you are seeing from nine kilometres — and spent the whole
    // frame's tile budget there. The budget is what runs out, `maxDrawn` cuts
    // the walk short, and what goes missing is the view you were looking at.
    // That is "flying up should not decrease quality": the quality did not
    // decrease, it went somewhere useless.
    //
    //   altitude   deepest split below, horizontal   by true distance
    //      50 m                z23                         z20
    //     300 m                z23                         z17
    //    3000 m                z23                         z14
    //    9000 m                z23                         z12
    //
    // The vertical part is the distance to the tile's own height range, so it
    // is nought when you are level with the square and only grows once you are
    // genuinely above or below it. Culling and reach stay horizontal: those are
    // questions about how much ground is covered, not how big it looks.
    const vertical = Math.max(minY - camera.position.y, 0, camera.position.y - maxY);
    const eyeDist = Math.hypot(flatDist, vertical);
    /*
      A square with no photograph at all must not split.

      This read `!photo || photo.scale >= 0.5 || eyeDist < size`, and the first
      term is the opposite of what the comment above it promises. `photo` is
      null only when nothing is loaded for this square *or any ancestor of it* —
      so on arriving somewhere new, where nothing is loaded by definition, every
      square counted as sharp enough and the walk ran straight to the deepest
      zoom it was allowed. It then asked for every tile it found there.

      Measured over the Black Forest at a hundred and fifty metres, on a clean
      network with nothing dropped: the request queue opened at 3,951 tiles and
      was still 258 deep a hundred seconds later, twelve requests in flight the
      whole time against a cap of twelve, and after all that 1% of the squares
      being drawn had their own photograph. 193 of them were drawn at a quarter
      of their resolution and 13 at a half. That is the blur, and it is why the
      minimap — which asks for the handful of tiles it actually shows — is sharp
      while the ground is not.

      So: no photograph, no split. The walk stops at the level it can actually
      dress, asks for that level, and descends only as the pictures land. The
      world comes in coarse and sharpens, which is what was asked for, and the
      queue is bounded by the number of squares at one level instead of by the
      number at the deepest level in the tree.

      The exemption for ground you are standing on stays, because the mesh under
      your feet has to be right whatever the imagery is doing — but it is
      bounded now too. Unbounded, it was most of the runaway on its own: at a
      hundred and fifty metres up, every square you are inside is "near", and
      you are inside one at every level, so it descended to the bottom anyway.
      Sixty-four metres is about a metre and a half between vertices, which is
      finer than anything you can stand on needs.
    */
    const mayOpen = photo ? photo.scale >= 0.5 : false;
    const nearFloor = eyeDist < size && size > NEAR_GEOMETRY_M;
    const sharpEnough = mayOpen || nearFloor;
    const line = size * this.lodFactor * this.splitScale(
      (x0 + x1) / 2, (z0 + z1) / 2, camX, camZ, eyeDist, size,
    );
    const wasSplit = this.split.has(key);
    // And not past the point where the provider stops having anything finer
    // for *this* square. That is measured from the photographs themselves
    // rather than read off a published maximum zoom, because coverage is
    // patchy: the level that is real over a city is the same level resampled
    // a valley away. See streamer.atFinest.
    const shouldSplit =
      !outOfBudget && tile.z < maxZoom && sharpEnough && !this.streamer.atFinest(tile) &&
      (wasSplit ? eyeDist < line * LOD_HYSTERESIS_OUT : eyeDist < line * LOD_HYSTERESIS_IN);
    if (shouldSplit) this.split.add(key);
    else this.split.delete(key);
    if (shouldSplit) {
      const cz = tile.z + 1;
      const half = size / 2;
      const children = [
        { z: cz, x: tile.x * 2, y: tile.y * 2, cx: x0 + half * 0.5, cz2: z0 + half * 0.5 },
        { z: cz, x: tile.x * 2 + 1, y: tile.y * 2, cx: x0 + half * 1.5, cz2: z0 + half * 0.5 },
        { z: cz, x: tile.x * 2, y: tile.y * 2 + 1, cx: x0 + half * 0.5, cz2: z0 + half * 1.5 },
        { z: cz, x: tile.x * 2 + 1, y: tile.y * 2 + 1, cx: x0 + half * 1.5, cz2: z0 + half * 1.5 },
      ];
      for (const child of children) {
        child.order = this.viewDistance(
          child.cx, child.cz2, camX, camZ,
          Math.hypot(child.cx - camX, child.cz2 - camZ),
        );
      }
      children.sort((a, b) => a.order - b.order);
      for (const child of children) {
        this.visit(child, camera, camX, camZ, renderDistance, maxZoom);
      }
      return;
    }

    // Ground beyond the near circle only exists where you have been, so it is
    // this ground — and only this ground — that decides how far the world
    // reaches in a given direction.
    if (flatDist > renderDistance) this.noteEdge(x0, z0, x1, z1, camX, camZ);

    // Real photogrammetry of this exact square is already drawn, so ours would
    // only fight it for the same depth. Coarse tiles are exempt: a tile a
    // kilometre across is far enough away that no photogrammetry reaches it,
    // and testing its centre would throw away the ground either side of the
    // one point that happened to be covered.
    if (tile.z >= 15 && this.covered3d && this.covered3d((x0 + x1) / 2, (z0 + z1) / 2)) return;

    // Pass the view-weighted distance, not the flat one: it decides both which
    // tiles get the frame's build budget and which textures are asked for
    // first, and both should favour the ground you are looking at.
    this.draw(tile, x0, z0, size, this.viewDistance(
      (x0 + x1) / 2, (z0 + z1) / 2, camX, camZ, flatDist,
    ));
  }

  draw(tile, x0, z0, size, distance) {
    // `distance` here is the view-weighted one from visit(): how far away the
    // tile is *for the purpose of caring about it*, not how far away it is.
    const key = tileKey(tile.z, tile.x, tile.y);
    let node = this.nodes.get(key);

    // A mesh made from coarser elevation than is now available is not merely
    // coarse — it is a plateau. Zoom 6 gives one height per square kilometre,
    // so a tile built from it is a flat plate, and once the finer relief lands
    // that plate stands there cutting through the hillside around it: the pale
    // and black wedges across the mountain, at the wrong height, wearing a
    // stretched texture.
    //
    // The round-robin refresh could not clear them. It marks a few nodes a
    // frame, and on arriving somewhere new every one of four hundred wants
    // rebuilding at once. So the check happens here, on tiles that are
    // actually being drawn, and it compares the zoom the mesh was built from
    // against the zoom the field can offer now — which is a real improvement,
    // unlike "some tile somewhere has landed".
    const bestZoom = this.elevationZoomFor(x0, z0, size);
    const builtFrom = node?.builtElevZoom ?? -1;
    if (node && !node.dirty && bestZoom > builtFrom) node.dirty = true;
    // Two levels coarser is a mesh that is merely soft. Three or more is a
    // plateau standing in for a hillside, and no budget is worth leaving one
    // of those in front of you: it is the wrong shape, at the wrong height,
    // and it cuts through the ground either side of it.
    const wrong = node && node.dirty && bestZoom - builtFrom >= 3;

    if (!node || node.dirty) {
      const spent = performance.now() - this.budget.start;
      // Always afford the first few tiles of a frame: those are the nearest
      // ones now that the walk is ordered by distance.
      const affordable = wrong
        ? this.budget.built < REBUILD_CEILING
        : spent < this.budget.ms || this.budget.built < 8;
      if (!affordable) {
        // Out of build time this frame. A tile that already has a mesh keeps
        // showing it — an out-of-date surface is far better than swapping the
        // ground under your feet for its grandparent every time the budget
        // runs out, which is a pop you can see.
        if (node && node.mesh) {
          this.show(node, tile, distance);
          return;
        }
        // Nothing built here yet. Show the nearest built ancestor — but if the
        // nearest thing we have is far coarser than this tile, spend a build
        // on the level *below* it first.
        //
        // That one rule is what keeps the ground uniform. Without it the only
        // stand-in on offer could be four or six levels up, and a zoom-12
        // mesh ten kilometres across drawn beside zoom-18 leaves that happened
        // to squeeze through the budget is a texel density sixty-four times
        // coarser on one side of an edge than the other. Sampling the drawn
        // zoom across the screen over the Black Forest found exactly that: 12
        // and 18 alternating from one sample to the next. Sharp canopy in
        // islands inside a smear, with hard tile-shaped edges — the pattern on
        // the ground, and nothing to do with what is growing there.
        //
        // Filling in from the top instead means every stand-in on screen sits
        // at about the same depth and the whole view sharpens together.
        let ancestor = this.findBuiltAncestor(tile);
        if (!ancestor || tile.z - ancestor.tile.z > 2) {
          const grown = this.buildCover(tile, ancestor);
          if (grown) ancestor = grown;
        }
        if (ancestor) {
          // And refresh it if it is stale, which nothing else will ever do.
          //
          // `draw` only ever runs for leaves, and a stand-in is by definition
          // not one — so a coarse tile that everything in an area is looking
          // at could be marked dirty for ever and never rebuilt. Over Uluru
          // that was measurable: the two nodes within a kilometre of the
          // camera were flat plates at sea level, built a hundred and sixty
          // elevation tiles ago, still flagged dirty, still on screen. The
          // real ground there is seven hundred metres up, so they hung far
          // below it and you looked straight through the gap between.
          //
          // One mesh, serving hundreds of leaves. It is the cheapest rebuild
          // on the frame and the one that shows the most.
          if (ancestor.dirty && this.budget.refreshed < STANDIN_REFRESHES) {
            this.budget.refreshed++;
            this.refresh(ancestor);
          }
          this.show(ancestor, tile, distance);
          return;
        }
        // Nothing built above it either. Building this leaf anyway is what
        // used to happen, and on the frame after a teleport that is *every*
        // leaf — four or five hundred meshes in one frame, which is the
        // second-long freeze on arriving somewhere. Build one coarse tile
        // instead: it covers this leaf and a couple of hundred of its
        // neighbours, so all of them have something to show on this same
        // frame and the detail arrives underneath it over the next few.
        const cover = this.buildCover(tile);
        if (cover) {
          this.show(cover, tile, distance);
          return;
        }
        // Not even that was possible, so the choice is between going over
        // budget and leaving a gap. A gap in the ground is a window straight
        // through the planet — that is where the random holes came from — and
        // one frame that runs long is cheaper than that.
      }
      node = this.build(tile, x0, z0, size, node);
      this.budget.built++;
      this.stats.built++;
    }

    this.show(node, tile, distance);
  }

  /**
   * Grow the tree one level towards a leaf that has nothing built above it.
   *
   * With nothing at all built — the frame after a teleport — this builds a
   * single root tile, which every one of the four or five hundred leaves in
   * the view then shares. That is the difference between an arrival that takes
   * a frame and one that takes a second: it used to build every leaf.
   *
   * With something built already, it builds one level below it. So each frame
   * the tree deepens by a level and every stand-in on screen sits at the same
   * depth, instead of a few very coarse ones standing next to fully detailed
   * leaves. Coarse ground reads as ground; coarse ground beside sharp ground
   * reads as a fault.
   */
  buildCover(tile, ancestor) {
    if (this.budget.built >= REBUILD_CEILING) return null;
    const z = Math.min(ancestor ? ancestor.tile.z + 1 : this.stats.baseZoom, tile.z - 1);
    if (z < 0 || z >= tile.z) return null;
    const shift = tile.z - z;
    const x = tile.x >> shift;
    const y = tile.y >> shift;
    const existing = this.nodes.get(tileKey(z, x, y));
    if (existing && existing.mesh && !existing.dirty) return existing;
    const size = this.frame.worldTileSize(z);
    const n = Math.pow(2, z);
    this.frame.normToWorld(x / n, y / n, this._cover);
    const node = this.build({ z, x, y }, this._cover.x, this._cover.z, size, existing);
    this.budget.built++;
    this.stats.built++;
    return node;
  }

  /** Rebuild a node in place from the elevation as it stands now. */
  refresh(node) {
    if (this.budget.built >= REBUILD_CEILING) return node;
    const size = node.size ?? this.frame.worldTileSize(node.tile.z);
    const built = this.build(node.tile, node.mesh.position.x, node.mesh.position.z, size, node);
    this.budget.built++;
    this.stats.built++;
    return built;
  }

  findBuiltAncestor(tile) {
    let z = tile.z - 1;
    let x = tile.x >> 1;
    let y = tile.y >> 1;
    while (z >= 0) {
      const node = this.nodes.get(tileKey(z, x, y));
      if (node && node.mesh) return node;
      z--;
      x >>= 1;
      y >>= 1;
    }
    return null;
  }

  show(node, requestedTile, distance) {
    node.used = this.streamer.frame;
    // Stamp rather than reading mesh.visible: a mesh is born visible, and
    // relying on that flag meant a freshly built tile never entered the drawn
    // list and so could never be hidden again.
    if (node.shownFrame !== this.streamer.frame) {
      node.shownFrame = this.streamer.frame;
      node.mesh.visible = true;
      // Draw the ground under your feet before the ground on the horizon: the
      // near tiles fill the depth buffer first and everything behind them is
      // rejected cheaply, and a stutter shows up as a far tile arriving late
      // rather than the one you are standing on.
      node.mesh.renderOrder = Math.round(distance * 0.01);
      this.drawn.push(node);
    }

    // A stand-in covers ground that some of its own descendants may be drawing
    // for themselves, and over flat ground the two are exactly coplanar — so
    // the depth test cannot separate them and they interleave pixel by pixel.
    // On land the relief hides it; over the sea, where every vertex sits at
    // exactly zero, it is a stipple of dotted lines across the water in the
    // shape of the tile grid. Measured over Gibraltar: twenty coarse tiles
    // overlapping finer ones in a single frame.
    //
    // So a stand-in is sunk a little, by a hand's breadth per level of
    // coarseness. Polygon offset would have been the tidy way to do it and
    // does nothing here: the logarithmic depth buffer writes depth from the
    // fragment shader, and offsetting the rasteriser's interpolated depth
    // cannot bias a value the shader computes itself. Moving the geometry
    // works whatever writes the depth.
    node.material.uniforms.uSink.value =
      node.tile.z < requestedTile.z ? 0.25 * (requestedTile.z - node.tile.z) : 0;

    // Texture: exact tile if we have it, otherwise the closest ancestor.
    const priority = distance / Math.pow(2, 20 - requestedTile.z);
    this.streamer.request(requestedTile, priority);
    const resolved = this.streamer.resolve(node.tile);
    const uniforms = node.material.uniforms;
    if (resolved) {
      uniforms.uMap.value = resolved.texture;
      uniforms.uUvOffset.value.set(resolved.offsetX, resolved.offsetY);
      uniforms.uUvScale.value = resolved.scale;
      uniforms.uHasTexture.value = 1;
      // Resolving *something* was being treated as being fine, and it is not.
      //
      // A tile can resolve four, sixteen or sixty-four levels of stretch off a
      // distant ancestor, and once it does, nothing ever asked for the levels
      // in between — the ancestor request only ran when there was nothing at
      // all. So a tile could sit at sixty-four times magnification for as long
      // as its own photograph took to arrive, while the tile beside it, whose
      // own photograph did arrive, was sharp. Two textures from two different
      // zooms meeting along a tile edge is a hard straight line across the
      // sea, brighter on one side, and no amount of geometry work would ever
      // have removed it because it was never geometry.
      //
      // Four times over is the point where the smear starts to read. Past it,
      // ask for the intermediate zooms as well, so neighbours converge on the
      // same level and the seam closes from both sides.
      if (resolved.scale < 0.25) this.streamer.requestAncestors(node.tile, priority);
    } else {
      uniforms.uHasTexture.value = 0;
      this.streamer.request(node.tile, priority);
      // Nothing loaded anywhere above this tile either, so there is no
      // photograph to stretch and the ground is drawn from the relief alone.
      // Ask for the coarse ancestors as well: one tile six levels up covers
      // this one and four thousand of its neighbours, so it is by far the
      // cheapest way to stop a whole hillside being blank while the sharp
      // tiles trickle in one at a time.
      this.streamer.requestAncestors(node.tile, priority);
    }

    // Keep a matching elevation tile alive for this area.
    const elevZ = Math.min(node.tile.z, this.elevation.maxZoom);
    const shift = node.tile.z - elevZ;
    this.elevation.request(
      { z: elevZ, x: node.tile.x >> shift, y: node.tile.y >> shift },
      distance,
    );
  }

  build(tile, x0, z0, size, existing) {
    const key = tileKey(tile.z, tile.x, tile.y);
    const grid = this.gridFor(tile);
    const n = Math.pow(2, tile.z);
    const nx0 = tile.x / n;
    const ny0 = tile.y / n;
    const step = 1 / n / (grid - 1);

    const node = existing ?? {
      key,
      tile,
      mesh: null,
      geometry: null,
      material: null,
      minY: 0,
      maxY: 0,
      used: 0,
      grid: 0,
      shownFrame: -1,
    };

    const verts = grid + 2; // one skirt ring on each side
    const count = verts * verts;
    let positions = node.geometry && node.grid === grid ? node.geometry.attributes.position.array : null;
    let normals = positions ? node.geometry.attributes.normal.array : null;
    let uvs = positions ? node.geometry.attributes.uv.array : null;
    let beds = positions ? node.geometry.attributes.bed.array : null;
    let skirts = positions ? node.geometry.attributes.skirt?.array ?? null : null;
    if (positions && !skirts) skirts = new Float32Array(count);
    const fresh = !positions;
    // Whether this rebuild moved the ground enough to be worth walking. Held
    // here rather than written straight to the material, because the material
    // is not attached until further down.
    let startMorph = false;
    // Where this tile stood before, so it can walk to where it now stands
    // rather than jumping there. Taken before the loop overwrites the array,
    // which is the same array — the rebuild path reuses it. See uMorph.
    let prevY = fresh ? null : node.geometry.attributes.prevY?.array ?? null;
    if (prevY) for (let v = 0; v < prevY.length; v += 1) prevY[v] = positions[v * 3 + 1];
    if (fresh) {
      positions = new Float32Array(count * 3);
      normals = new Float32Array(count * 3);
      uvs = new Float32Array(count * 2);
      beds = new Float32Array(count);
      skirts = new Float32Array(count);
    }

    const heights = new Float32Array(grid * grid);
    // The same points unclamped, sea floor and all. The surface is clamped to
    // sea level so the ocean is flat; the shader needs the real depth beneath
    // it to tell a bay from a beach when there is no photograph to go on.
    const bedHeights = new Float32Array(grid * grid);
    let minY = Infinity;
    let maxY = -Infinity;

    for (let gy = 0; gy < grid; gy++) {
      const ny = ny0 + gy * step;
      for (let gx = 0; gx < grid; gx++) {
        const raw = this.elevation.sampleNorm(nx0 + gx * step, ny);
        const h = Math.max(SEA_LEVEL, raw);
        heights[gy * grid + gx] = h;
        bedHeights[gy * grid + gx] = raw;
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    }

    const cell = size / (grid - 1);
    // The skirt only has to be as deep as the crack it hides, and the crack is
    // bounded by how much this tile's surface can differ from a neighbour at
    // another level of detail *along the edge the two of them share* — which is
    // that edge's own relief, since both sample the same profile and the
    // coarser one only straightens it.
    //
    // Sizing every edge by the whole tile's relief, or giving each one a metre
    // of curtain "just in case", hangs a wall off the flat sea. Seen almost
    // edge-on from a thousand metres up those walls are exactly the dotted grid
    // that used to lie over the water — 211 stray dark pixels in a patch of
    // open sea with them, 15 without. A level edge has no crack to hide, so it
    // gets no curtain. The depth is worked out separately for every point along
    // every edge rather than once per tile, so the seaward half of a coastal
    // tile's edge is bare while the half that runs up the headland keeps its
    // full curtain. Over the Alps every point has relief around it, so the
    // skirt there is the same depth it always was.
    const cap = Math.max(12, size * 0.02);
    // The furthest any edge of this square is about to move. Handed to the
    // shader, which hangs the curtain for the third of a second it is needed.
    let walked = 0;
    /**
     * And as deep as the height this rebuild is about to walk through.
     *
     * A rebuilt square is drawn at its *old* height and walks to the new one
     * over a third of a second — see uMorph. For that third of a second it
     * disagrees with every neighbour that is not walking with it, by however
     * far it is about to move, and the gap between them is a crack you look
     * straight through. Sizing the skirt from the edge's own relief cannot
     * cover that: how far the ground moved when finer elevation landed has
     * nothing to do with how rough the ground is. A flat plateau gaining ten
     * metres gets no curtain at all under the old rule, and ten metres is
     * exactly what you then see through.
     *
     * Measured over the Black Forest at twenty-five metres on the lowest tier:
     * 243 of 273 drawn squares were mid-walk in the same frame with the worst
     * at nought — every one of them drawn at a height its neighbours had
     * already left. That is "some tiles up some down" and "the ground moves up
     * and down in sections", and this is the curtain for it.
     *
     * Taken along the real edge row rather than the skirt row, whose old height
     * already carries the old curtain.
     *
     * It is *not* baked into the skirt's depth, which is what the first attempt
     * did and it was worse than the crack: the walk lasts a third of a second
     * and the geometry lasts until the next rebuild, so a square that moved a
     * hundred metres wore a hundred-metre curtain for as long as it stood
     * there. From above that is a wall of striped green standing out of the
     * hillside — visible in the very screenshot taken to check the fix. The
     * depth goes to the shader as a uniform instead, and hangs only while the
     * walk is actually happening. See uWalk.
     */
    const edgeWalk = (vyOf, vxOf) => {
      const walk = new Float32Array(grid);
      if (!prevY) return walk;
      for (let i = 0; i < grid; i++) {
        const vy = vyOf(i);
        const vx = vxOf(i);
        const gy = clamp(vy - 1, 0, grid - 1);
        const gx = clamp(vx - 1, 0, grid - 1);
        walk[i] = Math.abs(prevY[vy * verts + vx] - heights[gy * grid + gx]);
      }
      return walk;
    };
    const edgeDrop = (at, vyOf, vxOf) => {
      const line = new Float32Array(grid);
      for (let i = 0; i < grid; i++) line[i] = heights[at(i)];
      const walk = edgeWalk(vyOf, vxOf);
      for (let i = 0; i < grid; i++) if (walk[i] > walked) walked = walk[i];
      const drops = new Float32Array(grid);
      for (let i = 0; i < grid; i++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let j = Math.max(0, i - SKIRT_REACH); j <= Math.min(grid - 1, i + SKIRT_REACH); j++) {
          if (line[j] < lo) lo = line[j];
          if (line[j] > hi) hi = line[j];
        }
        drops[i] = clamp((hi - lo) * 0.6, 0, cap);
      }
      return drops;
    };
    const skirtTop = edgeDrop((i) => i, () => 1, (i) => i + 1);
    const skirtBottom = edgeDrop((i) => (grid - 1) * grid + i, () => verts - 2, (i) => i + 1);
    const skirtLeft = edgeDrop((i) => i * grid, (i) => i + 1, () => 1);
    const skirtRight = edgeDrop((i) => i * grid + grid - 1, (i) => i + 1, () => verts - 2);

    for (let vy = 0; vy < verts; vy++) {
      const gy = clamp(vy - 1, 0, grid - 1);
      for (let vx = 0; vx < verts; vx++) {
        const gx = clamp(vx - 1, 0, grid - 1);
        const i = (vy * verts + vx) * 3;
        const h = heights[gy * grid + gx];

        let drop = 0;
        if (vy === 0) drop = Math.max(drop, skirtTop[gx]);
        if (vy === verts - 1) drop = Math.max(drop, skirtBottom[gx]);
        if (vx === 0) drop = Math.max(drop, skirtLeft[gy]);
        if (vx === verts - 1) drop = Math.max(drop, skirtRight[gy]);

        positions[i] = gx * cell;
        positions[i + 1] = h - drop;
        positions[i + 2] = gy * cell;
        skirts[vy * verts + vx] = (vy === 0 || vy === verts - 1 || vx === 0 || vx === verts - 1) ? 1 : 0;
        beds[vy * verts + vx] = bedHeights[gy * grid + gx];

        const hl = heights[gy * grid + Math.max(0, gx - 1)];
        const hr = heights[gy * grid + Math.min(grid - 1, gx + 1)];
        const hu = heights[Math.max(0, gy - 1) * grid + gx];
        const hd = heights[Math.min(grid - 1, gy + 1) * grid + gx];
        const nxv = hl - hr;
        const nzv = hu - hd;
        const inv = 1 / Math.hypot(nxv, 2 * cell, nzv);
        normals[i] = nxv * inv;
        normals[i + 1] = 2 * cell * inv;
        normals[i + 2] = nzv * inv;

        const u = (vy * verts + vx) * 2;
        uvs[u] = gx / (grid - 1);
        uvs[u + 1] = gy / (grid - 1);
      }
    }

    let geometry = node.geometry;
    if (fresh || node.grid !== grid) {
      if (geometry) geometry.dispose();
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setAttribute('bed', new THREE.BufferAttribute(beds, 1));
      geometry.setAttribute('skirt', new THREE.BufferAttribute(skirts, 1));
      // A tile with no history has nowhere to walk from, so it starts where it
      // is: prevY is seeded from the heights it was just built with, and the
      // morph below is left finished. Only a *rebuild* animates.
      prevY = new Float32Array(count);
      for (let v = 0; v < count; v += 1) prevY[v] = positions[v * 3 + 1];
      geometry.setAttribute('prevY', new THREE.BufferAttribute(prevY, 1));
      geometry.setIndex(buildIndices(verts));
    } else {
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.normal.needsUpdate = true;
      geometry.attributes.bed.needsUpdate = true;
      if (geometry.attributes.skirt) geometry.attributes.skirt.needsUpdate = true;
      else geometry.setAttribute('skirt', new THREE.BufferAttribute(skirts, 1));
      geometry.attributes.prevY.needsUpdate = true;
      // Without a history there is nothing to walk from. A geometry that has
      // somehow not got the attribute renders correctly anyway: a missing one
      // reads as nought, and the uniform defaults to finished, so the mix takes
      // the new height whole.
      // Only worth animating if the ground actually moved. Most rebuilds are
      // for a new photograph rather than new relief, and starting a morph that
      // has nothing to morph would put every tile through a needless frame of
      // shader work.
      let moved = 0;
      for (let v = 0; prevY && v < prevY.length; v += 1) {
        const d = Math.abs(prevY[v] - positions[v * 3 + 1]);
        if (d > moved) moved = d;
      }
      startMorph = moved > MORPH_MIN_M;
    }
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(size / 2, (minY + maxY) / 2, size / 2),
      Math.hypot(size, maxY - minY) * 0.75,
    );

    if (!node.material) node.material = createTerrainMaterial(this.shared);
    if (!node.mesh) {
      node.mesh = new THREE.Mesh(geometry, node.material);
      node.mesh.frustumCulled = false;
      node.mesh.matrixAutoUpdate = false;
      node.mesh.visible = false;
      this.group.add(node.mesh);
    } else {
      node.mesh.geometry = geometry;
    }

    node.mesh.position.set(x0, 0, z0);
    node.mesh.updateMatrix();
    node.mesh.updateMatrixWorld(true);
    node.size = size;
    node.material.uniforms.uTileSpan.value = size;
    node.geometry = geometry;
    node.grid = grid;
    node.tile = tile;
    node.minY = minY - 5;
    node.maxY = maxY + 5;
    // The finest elevation this mesh could have been made from. See draw().
    // Measured over the whole footprint, the same way the check that compares
    // against it is, or the two would never agree.
    node.builtElevZoom = this.elevationZoomFor(x0, z0, size);
    // Ground at sea level is only water if somebody measured it. Unmeasured
    // ground reads as sea level too, and shading that as ocean turns a
    // continent into a sea for as long as its relief takes to arrive.
    node.material.uniforms.uMeasured.value = node.builtElevZoom >= 0 ? 1 : 0;
    // How far this rebuild is about to walk, for the curtain that covers the
    // walk. A little over, because the neighbour may be walking the other way.
    node.material.uniforms.uWalk.value = startMorph ? walked * 1.1 : 0;
    // A tile with no history has nowhere to walk from and starts settled; one
    // that just gained relief walks. See settleHeights.
    node.material.uniforms.uMorph.value = startMorph ? 0 : 1;
    // What the photograph of this square says about its own green. See
    // canopy.js: a field is smooth green, a wood is green broken at crown
    // scale, and only the second gets bumps.
    if (node.material.uniforms.uCanopy) {
      node.material.uniforms.uCanopy.value = this.streamer.canopyAt?.(tile) ?? 0;
    }
    node.dirty = false;
    node.builtVersion = this.elevation.version ?? 0;
    node.used = this.streamer.frame;

    this.nodes.set(key, node);
    return node;
  }

  /**
   * Walk every tile that has just gained finer relief from where it was to
   * where it now is.
   *
   * The ground moves under you as elevation streams in, because it has to: a
   * tile is drawn from the finest data that has arrived, and when finer data
   * arrives the answer changes. What it does not have to do is arrive in one
   * frame. A whole tile stepping several metres between two frames is "the
   * ground moves up and down in sections" — the sections are elevation tiles
   * and the moment is the moment their data landed.
   *
   * Real time rather than frame count, so it takes the same third of a second
   * on a slideshow as on a fast machine, and clamped so a long stall does not
   * finish every morph in the frame that follows it.
   */
  settleHeights() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - (this._settledAt ?? now)) / 1000);
    this._settledAt = now;
    if (dt <= 0) return;
    const stepPerFrame = dt / MORPH_SECONDS;
    for (const node of this.nodes.values()) {
      const morph = node.material?.uniforms?.uMorph;
      if (!morph || morph.value >= 1) continue;
      morph.value = Math.min(1, morph.value + stepPerFrame);
    }
  }

  /**
   * Height of the *drawn* surface under a point, or null if nothing is drawn
   * there yet.
   *
   * `heightAt` samples the elevation field, but a tile's mesh only carries a
   * grid of those samples and interpolates between them — so on broken ground
   * the surface you can see sits a little above the field, and standing at the
   * field's height leaves you shin-deep in it. Asking the mesh directly is what
   * keeps your feet on the ground you are actually looking at.
   */
  /** The most detailed drawn tile covering a point, or null. */
  nodeAt(x, z) {
    let best = null;
    let bestSize = Infinity;
    for (const node of this.drawn) {
      // A tile's mesh sits with its corner at the origin, spanning `size`.
      const dx = x - node.mesh.position.x;
      const dz = z - node.mesh.position.z;
      if (dx < 0 || dz < 0 || dx > node.size || dz > node.size) continue;
      // The smallest tile covering the point is the most detailed one.
      if (node.size < bestSize) {
        bestSize = node.size;
        best = node;
      }
    }
    return best;
  }

  meshHeightAt(x, z) {
    const best = this.nodeAt(x, z);
    if (!best) return null;

    this._ray.set(this._rayOrigin.set(x, 60000, z), this._rayDown);
    const hit = this._ray.intersectObject(best.mesh, false);
    if (hit.length === 0) return null;
    return this.drawnY(best, hit[0]);
  }

  /**
   * Where the surface is being *drawn*, not where it is heading.
   *
   * When fresh elevation lands, a tile does not step to the new heights, it
   * walks to them over MORPH_SECONDS — but the walk happens in the vertex
   * shader, `mix(prevY, position.y, uMorph)`, and the geometry on this side
   * holds only the destination. So a raycast lands on ground that is not there
   * yet, and for a third of a second after every correction the floor the
   * player stands on and the floor they can see are different surfaces.
   *
   * Measured over two and a half minutes of flight: the height under a fixed
   * point took 55 steps of more than a metre, 45 of more than five, the biggest
   * 82.8 m — every one of them instant on this side and a third of a second
   * long on the other. That is "a patch below appears, then the player glitches
   * down" and "floating on invisible ground above the imagery", which are the
   * same disagreement in its two signs.
   *
   * So blend the same way the shader does, from the same attribute, at the
   * point the ray actually hit. The delta is identical in local and world
   * space — the tile is axis-aligned and unscaled — so it can be applied
   * straight to the world hit.
   */
  drawnY(node, hit) {
    const y = hit.point.y;
    const morph = node.material?.uniforms?.uMorph?.value ?? 1;
    if (morph >= 1 || !hit.face) return y;
    const geometry = node.mesh.geometry;
    const prev = geometry.getAttribute('prevY');
    const position = geometry.getAttribute('position');
    if (!prev || !position) return y;
    this._triA.fromBufferAttribute(position, hit.face.a);
    this._triB.fromBufferAttribute(position, hit.face.b);
    this._triC.fromBufferAttribute(position, hit.face.c);
    node.mesh.worldToLocal(this._hitLocal.copy(hit.point));
    if (!THREE.Triangle.getBarycoord(this._hitLocal, this._triA, this._triB, this._triC, this._bary)) {
      return y;
    }
    const destY =
      this._triA.y * this._bary.x + this._triB.y * this._bary.y + this._triC.y * this._bary.z;
    const prevAt =
      prev.getX(hit.face.a) * this._bary.x
      + prev.getX(hit.face.b) * this._bary.y
      + prev.getX(hit.face.c) * this._bary.z;
    // Same blend, same direction: where the shader has got to, not where it is
    // going.
    return y + (prevAt - destY) * (1 - morph);
  }

  /**
   * Mark nearby tiles for a rebuild when fresh elevation data lands.
   *
   * Every node, not only the ones being drawn. Walking `drawn` alone meant a
   * tile that had been culled could never be refreshed, which mattered because
   * the commonest reason to be culled was having been built flat before the
   * relief arrived — so the nodes most in need of a rebuild were exactly the
   * ones the loop could not see.
   */
  invalidateStale(camX, camZ, maxPerFrame = 400) {
    const version = this.elevation.version ?? 0;
    const reach = this.keepDistance ?? this.renderDistance;
    let marked = 0;
    for (const node of this.nodes.values()) {
      if (marked >= maxPerFrame) break;
      if (node.builtVersion === version || !node.mesh || node.dirty) continue;
      const size = node.size ?? 0;
      const dx = node.mesh.position.x + size / 2 - camX;
      const dz = node.mesh.position.z + size / 2 - camZ;
      // Out of reach entirely: leave it alone and leave its version alone too.
      //
      // It used to be *stamped* with the current version instead — "too far
      // away to be worth a rebuild" — which does not mean "skip it", it means
      // "declare it up to date". Six kilometres out, that was most of the
      // world: ground is drawn to twenty-four and further, so every tile past
      // six was permanently certified fresh and could never be rebuilt again,
      // however much better the elevation under it got. Those are the terraces
      // — meshes made before the relief landed, marked as finished, standing
      // at the wrong height beside neighbours that were built later.
      if (Math.hypot(dx, dz) > reach) continue;
      // Only if there is actually something better to build it from. Any tile
      // landing anywhere bumps the version, and marking every node on every
      // bump would have the quadtree rebuilding the same mesh from the same
      // numbers for as long as anything at all was streaming.
      if (this.elevationZoomFor(node.mesh.position.x, node.mesh.position.z, size) <= node.builtElevZoom) continue;
      node.dirty = true;
      marked++;
    }
  }

  /**
   * Throw away the least recently used tiles, but never one that is still
   * within reach.
   *
   * Ground you flew over thirty seconds ago used to be evicted the moment the
   * cache filled, so turning round rebuilt it from nothing — a wall of empty
   * ground where you had just been. Anything inside the keep radius survives
   * the cull; only when *that* alone overflows does distance decide.
   */
  evict(limit, camX = 0, camZ = 0) {
    if (this.nodes.size <= limit) return;
    const keep = (this.keepDistance ?? Infinity) ** 2;
    const near = [];
    const far = [];
    for (const node of this.nodes.values()) {
      if (!node.mesh) continue;
      const dx = node.mesh.position.x + (node.size ?? 0) / 2 - camX;
      const dz = node.mesh.position.z + (node.size ?? 0) / 2 - camZ;
      (dx * dx + dz * dz <= keep ? near : far).push(node);
    }
    far.sort((a, b) => a.used - b.used);
    near.sort((a, b) => a.used - b.used);

    let excess = this.nodes.size - limit;
    for (const node of [...far, ...near]) {
      if (excess <= 0) break;
      if (node.mesh && node.mesh.visible) continue;
      this.disposeNode(node);
      this.nodes.delete(node.key);
      excess--;
    }
  }

  disposeNode(node) {
    if (node.mesh) {
      this.group.remove(node.mesh);
      node.mesh.visible = false;
    }
    if (node.geometry) node.geometry.dispose();
    if (node.material) node.material.dispose();
    node.mesh = null;
    node.geometry = null;
    node.material = null;
  }
}

const indexCache = new Map();

function buildIndices(verts) {
  const cached = indexCache.get(verts);
  if (cached) return cached;
  const quads = (verts - 1) * (verts - 1);
  const array = quads * 6 > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  let o = 0;
  for (let y = 0; y < verts - 1; y++) {
    for (let x = 0; x < verts - 1; x++) {
      const a = y * verts + x;
      const b = a + 1;
      const c = a + verts;
      const d = c + 1;
      array[o++] = a;
      array[o++] = c;
      array[o++] = b;
      array[o++] = b;
      array[o++] = c;
      array[o++] = d;
    }
  }
  const attribute = new THREE.BufferAttribute(array, 1);
  indexCache.set(verts, attribute);
  return attribute;
}

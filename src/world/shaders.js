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
/**
 * The cloud deck's own shadow, as a chunk both the ground and the player use.
 *
 * It lives here rather than inside the terrain shader because the player has
 * to be lit by it too. Moving shadow on the land is one of the strongest cues
 * that you are looking at a place in weather rather than at a texture — and a
 * figure that stays bright while the ground under it darkens is the same cue
 * pointing the other way, at a thing pasted on top of a photograph. One copy,
 * so the two can never disagree about where the cloud is.
 *
 * Needs uSunDir, uCloudTime, uCloudCover and uCloudHeight declared by whoever
 * includes it.
 */
const CLOUD_NOISE_GLSL = /* glsl */ `
  float cloudHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float cloudNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), u.x),
               mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

const CLOUD_SHADOW_ONLY_GLSL = /* glsl */ `
  float cloudShadow(vec3 world) {
    if (uCloudCover < 0.02 || uSunDir.y < 0.05) return 1.0;
    // Where the sun's ray from here crosses the cloud deck.
    float rise = uCloudHeight - world.y;
    if (rise < 0.0) return 1.0;
    vec2 hit = world.xz + uSunDir.xz * (rise / uSunDir.y);
    vec2 p = hit * 0.00042 + vec2(uCloudTime * 0.0035, uCloudTime * 0.0018);
    float total = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      total += cloudNoise(p) * amplitude;
      p *= 2.03;
      amplitude *= 0.5;
    }
    float density = smoothstep(0.62 - uCloudCover * 0.55, 0.92 - uCloudCover * 0.42, total);
    // A modulation around one, in the same band as the relief above it — not a
    // relight. This used to take 62% of the light off, and under an overcast
    // sky that is most of the ground most of the time: measured straight down
    // over the Champ de Mars at 124 m, the game drew Esri's own tile at 0.618
    // of its brightness, and the cloud shadow was very nearly all of it.
    //
    // Two reasons that was wrong. The picture was taken in sunshine and has its
    // own light already in it, so multiplying it by a cloud is grading a
    // finished photograph — the thing this file refuses to do everywhere else.
    // And a 62% multiply is a *hard* shadow, which is what scattered cloud
    // gives you; under real overcast the light is diffuse and the ground goes
    // flat and slightly dull rather than dark.
    return 1.0 - density * 0.18;
  }`;

/** The pair together, for anything that has neither yet. */
export const CLOUD_SHADOW_CHUNK = CLOUD_NOISE_GLSL + CLOUD_SHADOW_ONLY_GLSL;

const TERRAIN_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  uniform float uEarthRadius;
  uniform float uCurvature;
  /**
   * How far to sink this tile, in metres. Non-zero only when it is standing in
   * for finer tiles that may also be drawing the same ground; see Terrain.show.
   */
  uniform float uSink;
  /**
   * How far through a height change this tile is: 0 the moment fresh elevation
   * lands, 1 once it has settled.
   *
   * The ground moves under you as real elevation streams in, because it has to
   * — a tile is drawn from the finest data that has arrived, and when finer
   * data arrives the answer changes. What it does not have to do is jump. A
   * jump of a few metres across a whole tile, in one frame, is "the ground
   * moves up and down in sections": the sections are elevation tiles and the
   * moment is the moment their data landed.
   *
   * So the vertex remembers where it was and walks to where it now is. It costs
   * one float a vertex and nothing per frame.
   */
  uniform float uMorph;
  /**
   * The canopy sheet, and how far a wood stands out of the ground.
   *
   * "On areas with big contrast like tan or orange and there is green slightly
   * elevated green" — the green was never actually elevated. Everything the
   * canopy did was shading, and shading a flat surface leaves it flat: fly over
   * a wood beside a field and the two are the same sheet of ground in two
   * colours. A wood is not. It stands fifteen to thirty metres above the field
   * next to it, and that is real, measurable and exactly what the ask was.
   *
   * It has to come from a field in *world* coordinates or it cannot be done at
   * all. Two squares meeting along an edge at different levels of detail wear
   * different photographs — one its own, the other a coarser one stretched —
   * so a lift read from the photograph would differ across the seam and tear
   * the ground open, which is the fault being complained about in the same
   * breath. This sheet is one texture in world coordinates that every square
   * samples at the same point: red is what OpenStreetMap surveyed, green is
   * what the photograph itself scored, blurred so square edges do not print
   * through as steps. Both squares read the same number and the seam holds.
   *
   * The lift yields to the ground under your feet. Standing in a wood you
   * stand on the floor of it, not on the crowns, so within forty-five metres
   * of the camera there is no lift at all and it comes in over the next
   * hundred. At a walking pace that ramp is a tenth of a degree of slope; from
   * the air, which is where the ask was about, it is at full height.
   */
  uniform sampler2D uWoodMask;
  uniform vec2 uWoodOrigin;
  uniform float uWoodSpan;
  uniform float uHasWood;
  uniform float uWoodStrength;
  /**
   * How tall a wood is. A spruce plantation is twenty-five to thirty metres and
   * a broadleaf wood about twenty, so this is a real canopy rather than a
   * flourish — the surface you fly over above a wood *is* the top of it.
   *
   * Ten was tried first and could not be seen: the sheet it is read from is
   * smeared over three hundred and fifty metres to keep coarse and fine squares
   * agreeing, so ten metres of lift across that is a slope of one and a half
   * degrees, which from the air is nothing. Twenty-five is four degrees at a
   * wood's edge, which reads as a shoulder, and the coarse square can still
   * only miss about a metre and a half of it between its own vertices — well
   * inside the skirt's twelve-metre floor.
   */
  const float CANOPY_HEIGHT_M = 25.0;
  attribute float bed;
  attribute float prevY;
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
    vec3 settling = vec3(position.x, mix(prevY, position.y, uMorph), position.z);
    vec4 worldPos = modelMatrix * vec4(settling, 1.0);
    vHeight = worldPos.y;
    vWorld = worldPos.xyz;
    // "flat" is a reserved interpolation qualifier in GLSL ES 3, hence the name.
    vec2 groundOffset = worldPos.xz - cameraPosition.xz;
    float d = length(groundOffset);
    vDist = d;
    // Sink the middle of a stand-in, never its edge.
    //
    // A stand-in has to lose the depth test to the finer tiles drawn over the
    // same ground, and with a logarithmic depth buffer the only way to bias a
    // depth the fragment shader writes is to move the geometry. Sinking the
    // whole tile did that — and put a step of up to half a metre between it and
    // whichever neighbour was not sunk. Seen from three hundred metres up at a
    // grazing angle that step is a gap you look straight through, and the haze
    // behind it is the bright line across the sea: 123 pixels of it over the
    // Strait, gone the moment a deep enough curtain was hung back on the edges.
    //
    // Curtains are the wrong answer here, because a curtain deep enough to hide
    // the step is itself visible from above — sweeping the floor from nothing to
    // two metres took the line to zero and the dark speckle from 23 pixels to
    // 287. The step is what has to go. It goes by tapering the sink to nothing
    // over the outermost few per cent of the tile, so neighbours still meet
    // exactly along their shared edge while the middle — which is all the finer
    // tiles ever cover — is pushed down as far as it ever was.
    float edgeFade = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float sink = uSink * smoothstep(0.0, 0.03, edgeFade);
    // A wood standing out of the ground it grows on.
    float canopy = 0.0;
    if (uHasWood > 0.5) {
      vec2 wuv = (worldPos.xz - uWoodOrigin) / uWoodSpan;
      if (wuv.x > 0.0 && wuv.x < 1.0 && wuv.y > 0.0 && wuv.y < 1.0) {
        vec3 sheet = texture2D(uWoodMask, wuv).rgb;
        canopy = max(sheet.r, sheet.g);
      }
    }
    worldPos.y += canopy * uWoodStrength * CANOPY_HEIGHT_M * smoothstep(45.0, 160.0, d);
    worldPos.y -= sink + uCurvature * (d * d) / (2.0 * uEarthRadius);
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
  uniform float uCloudTime;
  uniform float uCloudCover;
  uniform float uCloudHeight;
  uniform float uMeasured;
  uniform sampler2D uWoodMask;
  uniform vec2 uWoodOrigin;
  uniform float uWoodSpan;
  uniform float uHasWood;
  uniform float uWoodStrength;
  /**
   * How much of this square's green the photograph itself says is canopy.
   *
   * Per tile, measured in the worker — see canopy.js. Where the survey has a
   * wood drawn, the survey wins, because somebody went and looked. Where it has
   * nothing, this is what is left, and it is why there are bumps on trees in
   * the ninety per cent of the world nobody has mapped a forest in.
   */
  uniform float uCanopy;
  /** This tile's width on the ground, in metres. Set per node in Terrain.build. */
  uniform float uTileSpan;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying float vDist;
  varying float vHeight;
  varying float vBed;
  varying vec3 vWorld;

  /**
   * The cloud deck's own shadow.
   *
   * Not a new invention: this is the same field, at the same scale, drifting at
   * the same rate as the cloud sheet already drawn overhead, sampled where the
   * sun's ray from this patch of ground crosses it. If there is cloud between
   * you and the sun, the ground under it is in shade — and moving shadow on
   * the land is one of the strongest cues there is that you are looking at a
   * place in weather rather than at a texture.
   */
${CLOUD_NOISE_GLSL}

  /** Half a crown, in metres. A spruce is six to ten across, an oak more. */
  const float CROWN_HALF_M = 4.5;
  /** How far a crown stands above the gap beside it. */
  const float CROWN_HEIGHT_M = 4.0;
  /** How much of the photograph's own crown contrast to add again on top. */
  const float CROWN_DEPTH = 0.55;

  /**
   * Crown-scale relief for a wood: where the crowns are and which way they
   * slope, read off the photograph.
   *
   * This was two octaves of value noise, and the noise was the whole problem.
   * It is a pattern nobody surveyed, laid over a photograph of a real place, so
   * it could not line up with a single actual tree — which is exactly what it
   * looked like: a texture on the ground rather than a wood. It was also the
   * one thing in this project that was invented rather than measured.
   *
   * The crowns are already in the photograph. From above, a canopy is bright on
   * the tops and dark in the gaps between, and that difference survives at the
   * resolution the imagery is served at: measured on the Esri photograph of the
   * Black Forest at zoom 16 — 1.59 metres a texel there — the luminance of a
   * green texel against the average of its four neighbours nine metres apart
   * runs from -62% at the fifth percentile to +99% at the ninety-fifth, with a
   * standard deviation of 55%. That is a strong signal and it is in the right
   * place by construction, because it *is* the trees.
   *
   * So: four taps half a crown out, in this tile's own texture coordinates. The
   * centre against their average says whether this texel is a crown top or a
   * gap; the two differences across say which way the crown slopes, and the
   * shader turns that into a tilted normal so the sun catches the sunward side.
   *
   * Returns the neighbours' average and the two differences, all in luminance;
   * main divides by the average so the measure has no scale in it.
   *
   * Where the photograph is a stretched ancestor rather than this tile's own,
   * all four taps land inside one source texel, the differences go to zero and
   * no relief appears — which is right. There is nothing there to read.
   */
  vec3 crownRelief(vec2 here, vec2 lo, vec2 hi, float e) {
    vec3 W = vec3(0.299, 0.587, 0.114);
    float xp = dot(texture2D(uMap, clamp(here + vec2(e, 0.0), lo, hi)).rgb, W);
    float xm = dot(texture2D(uMap, clamp(here - vec2(e, 0.0), lo, hi)).rgb, W);
    float zp = dot(texture2D(uMap, clamp(here + vec2(0.0, e), lo, hi)).rgb, W);
    float zm = dot(texture2D(uMap, clamp(here - vec2(0.0, e), lo, hi)).rgb, W);
    return vec3(0.25 * (xp + xm + zp + zm), xp - xm, zp - zm);
  }

${CLOUD_SHADOW_ONLY_GLSL}

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
    vec3 albedo = texture2D(uMap, uv).rgb;

    // There used to be two octaves of noise multiplied over the ground here,
    // to give a stretched or flat-white tile something to hold on to. It is
    // gone: it is a pattern nobody surveyed, printed over a photograph of
    // somewhere real, and up close it is the thing that made bare rock look
    // like carpet.
    //
    // Woodland relief was tried here too — standing the crowns up out of the
    // light and shade the photograph already has over them, so a forest reads
    // as thousands of separate trees rather than a green wash — and it is not
    // here because the photograph cannot say where the woodland is. Measured
    // over six Esri tiles at zoom 16, scoring each pixel for how green it is
    // and how rough it is at crown scale:
    //
    //   Black Forest    green 0.85   roughness 0.63
    //   Amazon          green 0.40   roughness 0.42
    //   Cambridgeshire  green 0.67   roughness 0.82
    //   Hyde Park       green 0.57   roughness 0.75
    //   central Paris   green 0.09   roughness 2.57
    //   Sahara          green 0.01   roughness 0.48
    //
    // Neither separates a forest from a field of wheat — farmland scores
    // *higher* on both than the Amazon does — so anything keyed off them would
    // have lit tramlines in Cambridgeshire as if they were spruce. Where the
    // woodland is is a thing somebody surveyed: OpenStreetMap's natural=wood
    // and landuse=forest, which this project already fetches from Overpass for
    // the buildings.
    //
    // That was then built with the survey as the mask — the polygons fetched,
    // a sheet laid over each one following the terrain, each vertex normal
    // tilted toward the brighter side of its own patch of photograph — and it
    // was thrown away too, for a different reason. The sheet has to be painted
    // to be drawn, and its colour comes from a vertex every fourteen metres,
    // while the ground under it wears a photograph with a texel every half
    // metre. Covering sharp imagery with a coarse Gouraud sheet loses more
    // detail than the tilted normals add: measured over the Black Forest, in
    // the densest patch of canopy on screen, local relief went from 16.42
    // without the sheet to 15.60 with it — 0.95 times, the wrong way.
    //
    // The third way is the one that works, and it is the one written up above:
    // the survey rasterised into a mask, and no geometry at all. The mask says
    // only *where* — OpenStreetMap's own natural=wood and landuse=forest, drawn
    // into a sheet that follows the camera, six metres a texel — and every bit
    // of the shading happens here, at the photograph's resolution. Nothing
    // coarse is laid over anything sharp, and the ground you walk on does not
    // move, because none of this is geometry.
    //
    // The mask's value carries the leaf type as well as the fact of the wood:
    // conifers are narrow and regular and get a shallower bump than the wide
    // lumpy crowns of a broadleaf.
    float wood = 0.0;
    if (uHasWood > 0.5) {
      vec2 wuv = (vWorld.xz - uWoodOrigin) / uWoodSpan;
      if (wuv.x > 0.0 && wuv.x < 1.0 && wuv.y > 0.0 && wuv.y < 1.0) {
        wood = texture2D(uWoodMask, wuv).r;
        // Only where the ground is ground. A cliff face inside a forest
        // polygon is rock, and rock does not have crowns on it.
        wood *= flatness;
      }
    }
    // Where nobody drew a wood, ask the photograph. The survey is the better
    // answer and stays on top of this: the larger of the two, not the sum, so a
    // mapped forest is never made lumpier by the measurement agreeing with it.
    //
    // uCanopy answers "is the green in this square canopy-like", one number for
    // the square. Where to apply it is a different question and has to be asked
    // per pixel, or a square that is a sixth wood and five sixths tan scrub
    // bumps neither: the tan because it is not trees, and the wood because the
    // square's average washed it out. That is exactly the case that was asked
    // for — a small deep-green section against a contrasting colour — and it is
    // why the bumps never turned up on it.
    //
    // So: how green *this* texel is, against its own red and blue. Tan, rock,
    // road and water go to zero and stay flat; the wood inside the same square
    // gets the whole of the square's score.
    //
    // Green as a proportion of this texel's own brightness, not as a raw
    // difference, and that distinction is the whole of it. In linear light a
    // canopy is dark: over the Esri photograph of the Black Forest at zoom 16
    // the median texel's green beats its own red and blue by 0.009 of full
    // scale, so a raw difference scaled by eight scored it 0.073 and the relief
    // under it came out below two per cent — which is why there were no bumps
    // on the trees. By proportion the same texel is unmistakably green. The old
    // form also had it backwards: the darker the wood, the flatter it went,
    // when a dark wood is the denser one.
    //
    // Normalised against green plus its strongest rival, so there is no scale
    // in the measure and it cannot run away — numerator and denominator carry
    // the same terms. Tan, rock and road have red or blue on top and go to zero
    // on the subtraction, as before.
    //
    // What a ratio cannot see is a texel too dark to have a colour. Deep water
    // is nearly black and a hair green, and by proportion alone every texel of
    // Lake Geneva came out a full one. So it is gated on there being light to
    // judge by: over these same photographs open water sits at 0.0056 linear
    // luminance and holds within a thousandth of that, while the Black Forest's
    // median texel is 0.056 and Hyde Park's 0.034.
    //
    // The two knees are where the photographs put them. Measuring greenness on
    // texels bright enough to have a colour, the Black Forest comes out
    // *bimodal* — the shadowed gaps between crowns are not green at all
    // (quarter percentile -0.079) and the crown tops emphatically are (three
    // quarters 0.379, ninth tenth 0.484) — while bare rock in the Alps sits at
    // 0.000 across the whole tile. A foot at 0.05 and a shoulder at 0.35 puts
    // the crown tops at a full one and leaves rock, road and tan at nothing.
    float rival = max(albedo.r, albedo.b);
    float texelLuma = dot(albedo, vec3(0.299, 0.587, 0.114));
    float greenness = (albedo.g - rival) / (albedo.g + rival + 1e-4);
    float greenHere = smoothstep(0.05, 0.35, greenness)
      * smoothstep(0.008, 0.020, texelLuma);
    wood = max(wood, uCanopy * flatness * greenHere * uHasTexture);
    // Branching on the tile's own score rather than on this texel's: it is
    // uniform across the whole draw call, so the taps below keep well-defined
    // derivatives. Every texel of a canopy tile pays for them; a tile with no
    // wood on it anywhere pays for none. The amount is zero off the crowns, so
    // the arithmetic is a no-op there.
    if (uCanopy > 0.01 || uHasWood > 0.5) {
      // Half a crown, in this tile's own texture coordinates: uTileSpan is how
      // wide the tile is on the ground and uUvScale the slice of the texture it
      // wears, so this holds at every zoom and every latitude.
      // Half a crown — or one texel of whatever photograph this square is
      // actually wearing, whichever is wider.
      //
      // A square with no photograph of its own wears an ancestor's, stretched.
      // At sixteen times magnification half a crown is a quarter of a texel, so
      // all four taps land inside the same one, every difference is nought and
      // no relief appears at all. That is why there were no bumps from the air
      // and plenty from seventy metres: at altitude almost every square on
      // screen is stretched. Clamping to a texel and a half reads the same
      // photograph at the scale it actually has — twenty-eight metres rather
      // than four and a half on a sixteen-times square, so it is wood-scale
      // mottling instead of crowns, which is the honest answer for a
      // photograph that no longer holds crowns.
      float texel = 1.5 * uUvScale / 256.0;
      float e = max(CROWN_HALF_M * uUvScale / max(uTileSpan, 1.0), texel);
      vec2 lo = uUvOffset + 0.002 * uUvScale;
      vec2 hi = uUvOffset + 0.998 * uUvScale;
      vec3 crown = crownRelief(uv, lo, hi, e);
      float around = max(crown.x, 0.004);
      float amount = wood * uWoodStrength;
      // Two things, and the second is the one that reads. Tilting the normal
      // along the crown's own slope is what makes the sunward side of a crown
      // brighter than its far side; +u runs east and +v runs south on every
      // tile, so the differences are already the height field's gradient once
      // they are scaled from luminance into metres.
      float slope = CROWN_HEIGHT_M / (2.0 * CROWN_HALF_M * around);
      n = normalize(n + vec3(-crown.y, 0.0, -crown.z) * slope * amount);
      // And deepening the gaps between the crowns, which is what actually makes
      // a canopy read as a canopy from the air. Around one, so a crown top is
      // the photograph a little lifted and a gap is the photograph a little
      // under — the photograph's own crown contrast, added again at just over
      // half strength. Clamped either side so a blown highlight or a black
      // shadow next to one cannot invert it.
      float lift = (texelLuma - crown.x) / around;
      albedo *= clamp(1.0 + lift * amount * CROWN_DEPTH, 0.4, 1.8);
    }

    float lambert = max(dot(n, uSunDir), 0.0);
    float wrapped = lambert * 0.62 + 0.38;
    // How much of the sky dome this face can see. Flat ground sees all of it;
    // a wall sees half. It is the difference between a valley floor and its
    // sides, and it is the only shading here that the photograph does not
    // already contain.
    float sky = 0.5 + 0.5 * n.y;
    // Shadow the sun, not the sky: under cloud the ground is still lit from
    // above, it is just no longer lit from one direction.
    float shade = cloudShadow(vWorld);

    // The photograph is a finished picture and is never re-graded.
    //
    // A camera took it and the provider's own processing tone-mapped it
    // already. Running it through a film curve a second time is a double
    // tone-map, and no amount of exposure undoes that: searching every
    // combination of lighting gain and exposure, the closest any of them gets
    // to returning the source is seventeen levels out, because the curve
    // crushes shadows and compresses highlights by construction. Deep forest
    // at 45 was coming back at 19, which is why the ground looked darker and
    // duller than the tile it was drawn from — and darker than the minimap,
    // which draws the same tile with nothing done to it at all.
    //
    // So it is modulated, not relit. Relief and cloud shadow are multipliers
    // around one: fully sunlit flat ground is the photograph exactly, and a
    // shaded slope is about a tenth darker. The sun that lit this ground is
    // already in the picture.
    float relief = (0.82 + 0.18 * wrapped) * (0.94 + 0.06 * sky);
    vec3 lit = albedo * relief * shade;

    // Ground with no photograph is the one thing here we do compute, so it
    // gets the full relief treatment — there is nothing to double up with.
    vec3 bare = groundNotLoaded(flatness) * (uAmbient * (0.78 + 0.34 * sky) + uSunColor * wrapped * shade);
    lit = mix(bare, lit, uHasTexture);

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

    // Water.
    //
    // The sea here is the ground clamped to sea level, and the photograph over
    // it is a real picture of that sea — so the photograph stays. What a
    // picture taken from orbit looking straight down cannot contain is what
    // the surface does from *where you are*: the sky it reflects at a grazing
    // angle and the sun it throws back at you. Both are physics rather than
    // decoration, and between them they are the whole reason the sea is not
    // black. Measured over the Strait of Gibraltar, the raw Esri pixels there
    // are (3, 12, 19) — deep ocean seen from space really is almost black, and
    // drawing it as a bare photograph is drawing it as almost black.
    //
    // Water used to be recognised by having a surveyed depth under it, and
    // that was the bug: of eighty tiles standing at sea level in that view,
    // five had bathymetry. The other seventy-five were open ocean that the
    // water shading never touched. What actually marks water is that the
    // surface got clamped to sea level — with one guard, because ground whose
    // elevation has not arrived reads as sea level too, and without the guard
    // an unmeasured continent would come up as an ocean.
    float wet = uMeasured * (1.0 - smoothstep(0.0, 2.0, vHeight));
    if (wet > 0.001) {
      vec3 view = normalize(cameraPosition - vWorld);
      float facing = clamp(view.y, 0.0, 1.0);
      // Schlick, with water's 2% reflectance straight down.
      // Plus a little that a flat mirror would not give you: a real surface is
      // never flat, and the wave facets bounce some sky back however you look
      // at it. Without it, water seen from above goes to nearly black.
      float fresnel = 0.08 + 0.92 * pow(1.0 - facing, 5.0);
      vec3 halfV = normalize(view + uSunDir);
      // A broad lobe: wind roughens the surface, so the sun comes back as a
      // path across the water rather than as one point of light.
      float glint = pow(max(halfV.y, 0.0), 90.0);
      vec3 surface = mix(lit, uFogColor * 1.06, fresnel * 0.85);
      surface += uSunColor * glint * 0.5 * (1.0 - uNight);
      // There used to be a depth tint here — deep water darkened and made
      // bluer, shallow water left alone — and it is the grid over the sea.
      //
      // The sea bed comes in as a per-vertex attribute, so the tint is a
      // piecewise-linear field sampled on the terrain mesh, and two tiles at
      // different levels of detail sample it at different resolutions. Along
      // every edge where they meet, the tint steps. That is the dotted grid,
      // the wedges and the long straight lines across the water, all of it:
      // amplified six times, the difference the tint makes is bounded by hard
      // polygon edges with square corners, and it moves 39,104 pixels of open
      // sea by up to 77 levels.
      //
      // Widening its range only spread the facets out; nothing hid them,
      // because the faceting is the sampling, not the curve.
      //
      // It is gone, and nothing replaces it, because nothing needs to: a
      // photograph of the sea taken from orbit already shows deep water dark
      // and a sandbank pale — measured over the Strait, the raw Esri pixels
      // run from (3, 12, 19) in the deep channel to (150, 168, 170) over the
      // Tarifa shallows. The picture had the answer and this was drawing over
      // it with a worse one.
      lit = mix(lit, surface, wet);
    }

    if (uFogEnabled > 0.5) {
      // Aerial perspective, not a distance fade.
      //
      // Haze is air, and air thins with height — about half as dense every
      // kilometre. Fading purely on distance means a peak twenty kilometres
      // off is as milky as the valley floor beside it, when in life the peak
      // stands clear above the haze and the valley is lost in it. Both ends of
      // the ray matter: flying at four thousand metres you are looking through
      // far less air than someone standing on the beach below.
      //
      // This is the mean density along the ray, which is the exact integral of
      // exp(-h/H) between the two heights, and it costs two exponentials.
      const float SCALE_HEIGHT = 1400.0;
      float lowH = max(0.0, min(cameraPosition.y, vHeight));
      float highH = max(0.0, max(cameraPosition.y, vHeight));
      float rise = highH - lowH;
      float density = rise < 1.0
        ? exp(-lowH / SCALE_HEIGHT)
        : (exp(-lowH / SCALE_HEIGHT) - exp(-highH / SCALE_HEIGHT)) * SCALE_HEIGHT / rise;
      float f = 1.0 - exp(-pow(vDist * uFogDensity * density, 2.0));
      // Haze scatters the sun forward, so it is brighter looking towards it
      // and cooler looking away — which is most of why a real horizon reads as
      // distance rather than as a grey wall.
      vec3 toPoint = normalize(vWorld - cameraPosition);
      float towardsSun = max(dot(toPoint, uSunDir), 0.0);
      vec3 haze = mix(uFogColor, uSunColor * 1.08, pow(towardsSun, 5.0) * 0.45 * (1.0 - uNight));
      lit = mix(lit, haze, clamp(f, 0.0, 1.0));
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

/** What the woodland mask reads before any survey has arrived: no woodland. */
const BLACK_PIXEL = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
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
      uCloudTime: shared.uCloudTime,
      uCloudCover: shared.uCloudCover,
      uCloudHeight: shared.uCloudHeight,
      // Whether this tile's relief was actually measured when it was built.
      // Set per node in Terrain.build; see the water block above.
      uMeasured: { value: 0 },
      uSink: { value: 0 },
      uMorph: { value: 1 },
      uWoodMask: shared.uWoodMask,
      uWoodOrigin: shared.uWoodOrigin,
      uWoodSpan: shared.uWoodSpan,
      uHasWood: shared.uHasWood,
      uCanopy: { value: 0 },
      // How wide this tile is on the ground. Set per node in Terrain.build, so
      // the canopy can be sampled at a crown's width whatever zoom it is at.
      uTileSpan: { value: 1 },
      uWoodStrength: shared.uWoodStrength,
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
    /**
     * Where the woods are, written by Woodland from the OpenStreetMap survey.
     * Zero everywhere it has not been told otherwise, which is the same as no
     * woodland: nothing here ever invents one.
     */
    uWoodMask: { value: BLACK_PIXEL },
    uWoodOrigin: { value: new THREE.Vector2() },
    uWoodSpan: { value: 1 },
    uHasWood: { value: 0 },
    /** How pronounced the canopy is. The Ground detail setting scales it. */
    uWoodStrength: { value: 1 },
    /**
     * The cloud deck, shared with the sky so the ground can be shadowed by the
     * clouds that are actually above it. Written by Weather each frame.
     */
    uCloudTime: { value: 0 },
    uCloudCover: { value: 0.4 },
    uCloudHeight: { value: 2100 },
  };
}

/**
 * Sky dome: an air-mass gradient, forward scattering round the sun, and a sun
 * disc. No lens flare, no god rays, nothing the eye would not see.
 */
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

    // How much air you are looking through, relative to straight up. Near the
    // horizon it is many times more, which is the whole reason the horizon is
    // pale and the zenith is deep — and it is a curve, steepening sharply in
    // the last twenty degrees, rather than the even slope this used to be.
    float air = max(0.0, 1.0 / max(0.06, up + 0.12) - 0.893);
    float thickness = clamp(1.0 - exp(-air * 0.38), 0.0, 1.0);
    vec3 sky = mix(uZenith, uHorizon, thickness);

    float cosAngle = dot(dir, uSunDir);
    // Forward scattering. Dust and water droplets throw light along the
    // direction it was already going, so the whole quarter of the sky around
    // the sun is brighter and warmer — and more so through the thicker air
    // low down, which is why the glow pools at the horizon at either end of
    // the day. Two lobes: a tight one and a wide one, which is the cheapest
    // honest stand-in for a Mie phase function.
    float toward = max(cosAngle, 0.0);
    float scatter = pow(toward, 9.0) * 0.34 + pow(toward, 2.0) * 0.11;
    sky = mix(sky, uSunColor, clamp(scatter * (0.35 + 0.65 * thickness), 0.0, 0.62));

    sky = mix(sky, uGround, smoothstep(0.0, -0.12, up));

    float disc = smoothstep(uSunSize, uSunSize + 0.0016, cosAngle);
    // Tighter than the old halo, because the broad glow is now the scattering
    // term above rather than a ring painted round the disc.
    float halo = pow(toward, 260.0) * 0.45;
    sky += uSunColor * (disc + halo);

    gl_FragColor = vec4(clamp(sky, 0.0, 1.0), 1.0);
    #include <colorspace_fragment>
  }
`;

export function createSkyMaterial(shared) {
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

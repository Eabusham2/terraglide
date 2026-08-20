/**
 * Land cover read off the aerial photograph.
 *
 * The scenery's first choice is always OpenStreetMap: a mapped wood is a
 * surveyed fact, with a boundary and often a leaf type. But OSM is reached
 * through Overpass, which is a donated service — rate limited, queued one
 * request at a time, and entitled to refuse. When it is slow, or the ground you
 * are over simply has not been mapped, the result was flat bare terrain with
 * nothing standing on it anywhere.
 *
 * So there is a second source, and it is already on your screen: the satellite
 * image. A photograph of a forest is *evidence of a forest* — it is not an
 * invention, and it is the same trick a flight simulator uses to decide where
 * autogen goes outside its photogrammetry cities. Green means something grows
 * there; grey and rough means rock; bright white means snow and nothing grows.
 *
 * The honesty line is unchanged and worth restating: the *presence* of woodland
 * here is read from real imagery of that exact ground, and the position of each
 * individual trunk within it is generated. What this must never do is put trees
 * somewhere the picture says there are none.
 */

/** What a patch of ground looks like from above. */
export const COVER = {
  none: 0,
  grass: 1,
  forest: 2,
  rock: 3,
};

/**
 * Classify one averaged pixel of aerial imagery.
 *
 * Deliberately conservative: anything ambiguous comes back `none`, because a
 * missing tree is a much smaller error than a tree standing in a car park.
 *
 * @param {number} r 0-255
 * @param {number} g 0-255
 * @param {number} b 0-255
 */
export function classifyPixel(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const saturation = max === 0 ? 0 : (max - min) / max;

  // Snow, ice, cloud and glare: bright and colourless. Nothing grows, and
  // guessing here is how you end up with a forest on a glacier.
  if (luma > 205 && saturation < 0.12) return COVER.none;
  // Deep shadow and open water read almost black; do not plant in either.
  if (luma < 26) return COVER.none;
  // Water: blue ahead of green, and green ahead of red.
  if (b > g && g >= r && saturation > 0.1) return COVER.none;

  const greenLead = g - Math.max(r, b);

  // Vegetation. Aerial green is muddier than screen green, so the margin is
  // small — but it does have to lead, and the patch has to have some colour to
  // it at all, or grey gravel with a green cast qualifies.
  if (greenLead > 4 && saturation > 0.08) {
    // Dark, saturated green is canopy; pale green is grass, scrub or crop.
    return luma < 95 ? COVER.forest : COVER.grass;
  }

  // Bare ground: rock, scree, sand, ploughed earth. Grey to brown, and never
  // very dark — the floor is set above asphalt, because roads and car parks
  // are exactly the flat grey that would otherwise sprout boulders.
  if (saturation < 0.24 && luma > 78 && luma < 190) return COVER.rock;
  if (r > g && g > b && saturation < 0.5 && luma > 78) return COVER.rock;

  return COVER.none;
}

/**
 * How densely to plant a classified patch, as a fraction of the normal spacing
 * for its kind. Grass gets scattered bushes rather than a lawn of them.
 */
export const COVER_DENSITY = {
  [COVER.none]: 0,
  [COVER.grass]: 0.22,
  [COVER.forest]: 1,
  [COVER.rock]: 0.3,
};

/** Which scenery kind a cover class plants. */
export const COVER_KIND = {
  [COVER.grass]: 'bush',
  [COVER.forest]: 'mixed',
  [COVER.rock]: 'rock',
};

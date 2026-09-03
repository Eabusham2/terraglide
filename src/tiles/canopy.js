/**
 * Whether the green in a photograph is a canopy or a field.
 *
 * Canopy relief only ever appeared where OpenStreetMap had a `natural=wood` or
 * `landuse=forest` polygon. That is a real survey and it is the right first
 * answer — but it is missing over most of the world, and where it is missing
 * there were no bumps on the trees at all. "There are no bumps on trees" is
 * usually not a shading bug; it is standing somewhere nobody has drawn a wood.
 *
 * The photograph knows. From the air a wood and a meadow are both green, and
 * they differ in exactly one way you can measure: a meadow is *smooth* — one
 * green, running unbroken across the whole field — while a canopy is green
 * broken up at crown scale, with shadowed gaps of a different colour between
 * the crowns. That is the rule as it was asked for: skip the green that runs
 * the same throughout, keep the green that has holes in it.
 *
 * So the score is two things multiplied:
 *
 *   how much of the square is green at all, and
 *   how broken that green is at the scale of a tree crown.
 *
 * A field scores near nothing however green it is. Bare rock and a city score
 * nothing because they are not green. A wood scores high. Nothing is invented:
 * this measures the photograph and nothing else, and where it is unsure it says
 * so by returning a small number rather than a guess.
 */

/**
 * Below this zoom a pixel is wider than a tree, so "broken at crown scale" is
 * not a question the image can answer. Zoom 15 is about five metres a pixel at
 * the equator and less further north; a crown is five to fifteen.
 */
export const CANOPY_FROM_ZOOM = 15;

/**
 * How far apart to sample when asking whether the green is broken.
 *
 * Four pixels. At the depths this runs at that is somewhere between four and
 * twenty metres on the ground — one crown to a few — which is the scale the
 * gaps between crowns actually live at. One pixel measures sensor noise and
 * JPEG blocks; thirty measures the shape of the field.
 */
const CROWN_STEP = 4;

/** Luminance spread across a crown-sized step that counts as fully broken. */
const BROKEN_FULL = 26;
/**
 * How many green samples are needed before the brokenness ratio means
 * anything. A dozen green pixels in a city square is noise, not a copse.
 */
const MIN_GREEN_SAMPLES = 64;

/** Below this it is one flat green: a field, and not to be bumped. */
const BROKEN_NONE = 7;

/**
 * Is this pixel plant green?
 *
 * Deliberately wide. Late-summer grass, dark conifer and bright deciduous are
 * all here, and so is anything else predominantly green — the *second* half of
 * the measurement is what separates a wood from a lawn, not this half.
 */
function isGreen(r, g, b) {
  if (g <= r || g <= b) return false;
  // Not a black shadow and not a blown highlight, where hue means nothing.
  const luma = (r * 299 + g * 587 + b * 114) / 1000;
  return luma > 24 && luma < 226;
}

/**
 * How much of this square is broken green, 0 to 1.
 *
 * @param {ImageBitmap} bitmap
 * @param {(w: number, h: number) => any} makeCanvas
 * @param {number} zoom  the tile's own zoom; below CANOPY_FROM_ZOOM this
 *   returns 0, which reads as "no opinion" rather than "no trees"
 * @returns {number}
 */
export function measureCanopy(bitmap, makeCanvas, zoom) {
  try {
    if (!(zoom >= CANOPY_FROM_ZOOM)) return 0;
    const w = bitmap.width || 0;
    const h = bitmap.height || 0;
    if (w < 32 || h < 32) return 0;
    // A centred window, as with sharpness: tile edges carry seams and the
    // neighbours' resampling.
    const side = Math.min(128, w, h);
    const sx = Math.floor((w - side) / 2);
    const sy = Math.floor((h - side) / 2);
    const canvas = makeCanvas(side, side);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, side, side);
    const { data } = ctx.getImageData(0, 0, side, side);

    const lumaAt = (x, y) => {
      const i = (y * side + x) * 4;
      return (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    };

    let green = 0;
    let looked = 0;
    let brokenSum = 0;
    for (let y = CROWN_STEP; y < side - CROWN_STEP; y += 2) {
      for (let x = CROWN_STEP; x < side - CROWN_STEP; x += 2) {
        const i = (y * side + x) * 4;
        looked++;
        if (!isGreen(data[i], data[i + 1], data[i + 2])) continue;
        green++;
        // The spread across a crown-sized step, in both directions. A meadow
        // gives nearly nothing here; a canopy gives the gap between crowns.
        const here = lumaAt(x, y);
        const spread = Math.max(
          Math.abs(lumaAt(x + CROWN_STEP, y) - here),
          Math.abs(lumaAt(x - CROWN_STEP, y) - here),
          Math.abs(lumaAt(x, y + CROWN_STEP) - here),
          Math.abs(lumaAt(x, y - CROWN_STEP) - here),
        );
        const broken = (spread - BROKEN_NONE) / (BROKEN_FULL - BROKEN_NONE);
        brokenSum += broken < 0 ? 0 : broken > 1 ? 1 : broken;
      }
    }
    if (looked === 0 || green === 0) return 0;
    /*
      This used to return greenShare * brokenShare, and multiplying by coverage
      is what stopped the bumps ever appearing on the case they were asked for:
      "a small deep-green section against a contrasting colour", a wood in tan
      scrub. That square is perhaps a sixth green, so however unmistakably
      broken the green is the score comes out near a tenth and the relief is
      invisible.

      Coverage is a *where* question and this function answers a *whether*
      question. So it returns only how canopy-like the green is, and the shader
      decides where to apply it — per fragment, on the pixels that are actually
      green, leaving the tan flat. A field of wheat still scores nothing,
      because the field is unbroken, which was always the real test.

      A handful of green pixels is not evidence either way, so below a floor it
      still says nothing rather than trusting a ratio taken over almost no
      samples.
    */
    if (green < MIN_GREEN_SAMPLES) return 0;
    return brokenSum / green;
  } catch {
    return 0;
  }
}

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
export const CANOPY_FROM_ZOOM = 16;

/**
 * How far apart to sample when asking whether the green is broken, in metres.
 *
 * It was four *pixels*, which is a different distance at every zoom — 6.4 m at
 * sixteen and 1.6 m at eighteen — so the measure was asking about crowns at one
 * depth and about JPEG blocks at the next. Six metres is about one crown either
 * way at every depth, which is the scale the gaps between crowns live at.
 */
const CROWN_STEP_M = 6;

/** Luminance spread across a crown-sized step that counts as fully broken. */
const BROKEN_FULL = 26;
/**
 * How much of the square has to be green before the brokenness means anything.
 *
 * A share, not a count. It was sixty-four samples out of about four thousand —
 * a sixtieth — and a sixtieth of a wheat prairie is the hedge along one edge,
 * which is broken green and scored the whole square as woodland. Measured over
 * a Kansas section at zoom eighteen: 4% green, brokenness 0.995. An eighth is
 * enough that the answer is about the square rather than about its border.
 */
const MIN_GREEN_SHARE = 0.12;

/** Below this it is one flat green: a field, and not to be bumped. */
const BROKEN_NONE = 7;

/**
 * Where a field ends and a wood begins, on the brokenness scale.
 *
 * This is the size rule, and it is the half that was never built: "don't make
 * [bumps] if it's bigger than a certain size all throughout so it doesn't mark
 * grass, but still count it if it has holes for a different colour". Raw
 * brokenness does not answer that on its own — it runs high over a desert,
 * because the handful of green pixels in a desert are JPEG noise and noise is
 * broken by definition, and it ran high over farmland too.
 *
 * Measured over Esri photographs at zoom seventeen, with the green test below
 * doing its share of the work:
 *
 *   Black Forest        0.929      Cambridgeshire wheat   0.216
 *   Hyde Park           0.853      Cambridgeshire barley  0.467
 *   Black Forest, 2     0.857      Kansas section         0.422
 *                                  Sahara                 0.632
 *
 * Woods sit at 0.85 and up, fields at 0.47 and down, with nothing in between.
 * So the raw number is put through a curve with its foot above every field and
 * its shoulder below every wood: grass comes out at nothing however green it
 * is, and a wood comes out whole. At zoom sixteen the two overlap more —
 * 0.74 and 0.87 for the woods against 0.46 and 0.54 for the fields — and the
 * same curve still separates them, which is why sixteen is the floor rather
 * than seventeen.
 */
const FIELD_AT = 0.55;
const WOOD_AT = 0.85;

/**
 * Is this pixel plant green?
 *
 * Deliberately wide. Late-summer grass, dark conifer and bright deciduous are
 * all here, and so is anything else predominantly green — the *second* half of
 * the measurement is what separates a wood from a lawn, not this half.
 */
function isGreen(r, g, b) {
  const rival = r > b ? r : b;
  if (g <= rival) return false;
  // Green by a margin, not merely by a hair.
  //
  // This used to be `g > r && g > b` and nothing else, so a pixel at
  // (100, 101, 100) counted. Chroma noise in a JPEG satisfies that constantly,
  // and it is why the Sahara came back 46% green and central Paris 87%. A
  // tenth of the pixel's own scale is a real green: measured on Esri
  // photographs, it takes bare rock in the Alps from 3% green to 0%, the
  // Sahara from 46% to 13% and Paris from 87% to 26%, while the Black Forest
  // holds at 43% and Hyde Park at 54%.
  if ((g - rival) / (g + rival + 1e-4) < 0.10) return false;
  // Not a black shadow and not a blown highlight, where hue means nothing.
  const luma = (r * 299 + g * 587 + b * 114) / 1000;
  return luma > 24 && luma < 226;
}

/** Metres on the ground per pixel of a 256-wide tile at this zoom and row. */
function metresPerPixel(zoom, y) {
  const n = Math.pow(2, zoom);
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)));
  return (156543.03392 * Math.cos(lat)) / n;
}

/** Smoothstep, for putting the raw brokenness on a field-to-wood scale. */
function ramp(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
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
export function measureCanopy(bitmap, makeCanvas, zoom, row = 0) {
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

    // A crown either way, in this square's own pixels. Scaled off the tile
    // rather than fixed, because four pixels is six metres at zoom sixteen and
    // one and a half at eighteen, and only one of those is a crown.
    const perPixel = metresPerPixel(zoom, row) * ((bitmap.width || 256) / 256);
    const CROWN_STEP = Math.min(
      Math.floor(side / 4),
      Math.max(2, Math.round(CROWN_STEP_M / Math.max(perPixel, 1e-3))),
    );

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
    if (green / looked < MIN_GREEN_SHARE) return 0;
    // And through the field-to-wood curve. See FIELD_AT / WOOD_AT: the raw
    // ratio runs high over farmland and over deserts, and this is what makes
    // grass score nothing while a wood scores whole.
    return ramp(FIELD_AT, WOOD_AT, brokenSum / green);
  } catch {
    return 0;
  }
}

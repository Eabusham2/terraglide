/**
 * How much detail a photograph actually carries, so the depth to fetch it at
 * can be measured rather than declared.
 *
 * Every imagery provider publishes one maximum zoom, and one number cannot be
 * right: Esri guarantee nineteen everywhere, serve twenty-one over Vienna and
 * have not flown twenty over the Jungfrau. Taking the published number as the
 * ceiling throws away real detail over cities; taking the deepest number any
 * place supports fetches sixteen tiles of blur per square everywhere else, off
 * a keyless endpoint run on donated hardware.
 *
 * Neither guess is needed. A tile that is a genuine new level of resolution
 * holds most of its parent's per-pixel contrast, because finer detail in a
 * natural image has lower amplitude but is still there. A tile that is the
 * parent resampled bigger has half of it or less, because the resampler put
 * smooth ramps between the samples it had. Measured over three places, whole
 * tile against whole tile:
 *
 *                     z19    z20            z21
 *   Vienna centre     6.96   4.89 (x0.70)   3.65 (x0.75)   real all the way
 *   Jungfrau massif   9.74   5.77 (x0.59)   1.84 (x0.32)   21 is a resample
 *   Meseta farmland   4.84   2.65 (x0.55)   0.56 (x0.21)   21 is a "no data" card
 *
 * A ratio of about a half separates them, and it separates them the same way
 * in all three. So the rule is: keep descending while a child brings back most
 * of what its parent had, and stop when it does not.
 */

/**
 * Mean absolute difference between horizontally adjacent pixels, 0–255.
 *
 * Measured at the tile's own resolution — downsampling first would destroy the
 * high-frequency detail this exists to detect — over a central window, every
 * second pixel. One drawImage and one getImageData per tile, in the worker.
 *
 * @param {ImageBitmap} bitmap
 * @param {(w: number, h: number) => any} makeCanvas
 * @returns {number} 0 when it cannot be measured, which reads as "no opinion"
 */
export function measureSharpness(bitmap, makeCanvas) {
  try {
    const w = bitmap.width || 0;
    const h = bitmap.height || 0;
    if (w < 16 || h < 16) return 0;
    // A centred window: tile edges carry seams and the neighbours' resampling.
    const side = Math.min(128, w, h);
    const sx = Math.floor((w - side) / 2);
    const sy = Math.floor((h - side) / 2);
    const canvas = makeCanvas(side, side);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, side, side);
    const { data } = ctx.getImageData(0, 0, side, side);
    let sum = 0;
    let n = 0;
    for (let y = 0; y < side; y += 2) {
      const row = y * side * 4;
      for (let x = 0; x < side - 1; x += 2) {
        const i = row + x * 4;
        const j = i + 4;
        const a = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const b = (data[j] + data[j + 1] + data[j + 2]) / 3;
        sum += Math.abs(a - b);
        n++;
      }
    }
    return n ? sum / n : 0;
  } catch {
    return 0;
  }
}

/**
 * The zoom below which none of this means anything.
 *
 * A tile at zoom 5 covers a thousand kilometres. Whether it looks flat, or
 * looks flatter than its parent, says nothing whatever about whether there is
 * a photograph of a street inside it — and marking it as the finest there is
 * stops the quadtree subdividing anywhere in it. That is not a hypothetical:
 * without this gate a single verdict at zoom 1 blocked the entire planet, and
 * the Meseta drew zoom 5 and loaded nothing.
 *
 * Coverage only runs out near the bottom of the pyramid, so that is the only
 * place the question is asked.
 */
export const SHARPNESS_FROM_ZOOM = 16;

/**
 * Below this, there is nothing left to resolve.
 *
 * Open ocean, a snowfield and a "no data" card all sit here. Descending over
 * them buys nothing anyone can see and costs four times the requests, so the
 * floor stops it — and it stops it in the safe direction, because a featureless
 * square looks identical however finely it is fetched.
 */
export const SHARPNESS_FLOOR = 1.5;

/**
 * A child holding less than this share of its parent's contrast is a resample.
 *
 * Half, near enough. The three places above land at 0.70, 0.75, 0.59 and 0.55
 * for a real level and 0.32 and 0.21 for a resampled one, so the gap either
 * side of 0.45 is wide and the threshold is not balanced on an edge.
 */
export const SHARPNESS_RATIO = 0.45;

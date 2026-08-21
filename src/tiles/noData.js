/** OffscreenCanvas in a worker, a normal canvas on the main thread. */
function makeCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('no canvas available');
}

/**
 * Is this tile a provider's "nothing here" card rather than a photograph?
 *
 * Esri answers a request for ground it has never imaged with HTTP 200 and a
 * picture of the words "Map data not yet available" on a flat grey field.
 * Every check we have says the tile arrived fine, so it gets drawn, and the
 * result is the pale rectangles with text across the world and the minimap.
 * The availability endpoint does not help — it reports the placeholder as
 * present, because it *is* present.
 *
 * So look at it, and weigh it. Measured against the real thing:
 *
 *   the card        1.8–2.6 kB   mean 205–232   spread 0–19   variance 0.6–34
 *   London          22 kB        mean 76        spread 26     variance 1225
 *   Sahara          13 kB        mean 174       spread 110    variance 176
 *   Greenland       2.6 kB       mean 53        spread 54     variance 2.8
 *
 * Bright, colourless, flat *and* tiny is a corner of that space nothing real
 * sits in. The size test carries most of the weight — a 256-pixel JPEG of
 * anything with texture in it does not compress to two kilobytes — and the
 * pixels stop a genuinely featureless snowfield being thrown away for it.
 */
export function isNoDataCard(bitmap, bytes) {
  if (bytes > 6000) return false;
  try {
    const size = 8;
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(bitmap, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    let sum = 0;
    let sumSq = 0;
    let maxSpread = 0;
    const n = size * size;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = (r + g + b) / 3;
      sum += lum;
      sumSq += lum * lum;
      maxSpread = Math.max(maxSpread, Math.max(r, g, b) - Math.min(r, g, b));
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    return mean > 195 && maxSpread <= 24 && variance < 80;
  } catch {
    return false;
  }
}


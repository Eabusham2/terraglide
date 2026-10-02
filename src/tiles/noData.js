/** OffscreenCanvas in a worker, a normal canvas on the main thread. */
export function makeCanvas(width, height) {
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
 * This used to weigh the picture: bright, colourless, flat and under six
 * kilobytes was taken to mean a card, on the reasoning that nothing real sits
 * in that corner of the space. Something real does. Antarctica sits in it.
 *
 *   Antarctica z6    2,564 bytes   mean 239   spread 17   variance 0.4
 *   Antarctica z8    2,488 bytes   mean 235   spread 17   variance 0.3
 *   Antarctica z10   2,420 bytes   mean 232   spread 17   variance 0
 *   Antarctica z12   1,688 bytes   mean 230   spread 17   variance 0
 *   the card         2,521 bytes   mean 205   spread  0   variance 34
 *
 * Every one of those Antarctic tiles is a real satellite photograph of the
 * polar plateau, and every one was being thrown away. The comment here claimed
 * the pixel test "stops a genuinely featureless snowfield being thrown away",
 * and the snowfield it was checked against was Greenland at mean 53 — coastal
 * rock and water, dark. A bright one had never been tried.
 *
 * What that cost: over the plateau the streamer recorded 561 imagery failures
 * against 8 loads, 291 squares went barren, the depth limit stuck at zoom 5 for
 * over two minutes, and the world drew two tiles. Antarctica was unplayable
 * because every photograph of it was being read as a placeholder.
 *
 * So it is identified instead of guessed at. The card is one fixed image:
 * 2,521 bytes, byte-identical at zooms 14 through 18 and everywhere it was
 * sampled. Matching the bytes cannot reject a photograph, however bland. The
 * length is checked first, so the hash is only ever computed for a candidate —
 * every real tile costs one integer comparison.
 *
 * If Esri ever changes the card, this stops recognising it and the card gets
 * drawn again, which is the fault this was written to fix. That is the right
 * way round: showing a placeholder is a blemish, and discarding real ground is
 * a continent that does not load.
 */

/** Lengths worth hashing. Nothing else can be a known placeholder. */
const CARD_BYTES = new Set([2521]);

/** FNV-1a, 32-bit, as eight hex digits. */
function fingerprint(bytes) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Esri World Imagery, "Map data not yet available". */
const CARDS = new Set(['92d9118f']);

export function isNoDataCard(data) {
  if (!data) return false;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!CARD_BYTES.has(bytes.length)) return false;
  return CARDS.has(fingerprint(bytes));
}

export { fingerprint, CARDS, CARD_BYTES };

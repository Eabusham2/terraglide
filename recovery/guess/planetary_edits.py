# planetary.js: the Oct 5 version (V19, 1894 lines, exact) plus the Oct 5 19:13 review's fixes as reconstructed
# (fillRowRejects, gaps flag, no retries for a gap). Usage: planetary_edits.py V19 OUT
import sys
s = open(sys.argv[1]).read()
def rep(old, new, count=1):
    global s
    assert s.count(old) == count, (s.count(old), old[:80])
    s = s.replace(old, new)
# 1. Layers with gaps (+3)
rep("""            blend: 'luminosity',
            optional: true,
            fromZoom: 9,""", """            blend: 'luminosity',
            optional: true,
            gaps: true,
            fromZoom: 9,""")
rep("""          tileSize: 512,
          maxLevel: 12,
        }],""", """          tileSize: 512,
          maxLevel: 12,
          gaps: true,
        }],""")
rep("""            template: trekTiles('Venus', 'Venus_Magellan_LeftLook_mosaic_global_75m', 'png'),
            tileSize: 256,
            maxLevel: 10,
            optional: true,""", """            template: trekTiles('Venus', 'Venus_Magellan_LeftLook_mosaic_global_75m', 'png'),
            tileSize: 256,
            maxLevel: 10,
            optional: true,
            gaps: true,""")
# 2. eqLayerPlan carries it (+1)
rep("""    optional: layer.optional === true,
    sources,""", """    optional: layer.optional === true,
    gaps: layer.gaps === true,
    sources,""")
# composeEqImage hands each picture its layer (same count)
rep("Promise.allSettled(layer.sources.map((s) => fetchImage(s.url))).then((results) => {",
    "Promise.allSettled(layer.sources.map((s) => fetchImage(s.url, layer))).then((results) => {")
# 3. fillRowRejects after fillInvalid (+26)
rep("""  return filled;
}

function bilinearAt(""", """  return filled;
}

/**
 * Fill the cells that are there but were rejected — out of the body's reach —
 * from the real cells either side on their row, carrying the nearest one at
 * an edge; and the holes, where the file has no data at all, at the datum. A
 * rejected cell with nothing real on its row goes to the datum too.
 */
function fillRowRejects(values, valid, hole, w, h) {
  const src = values.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (valid[i]) continue;
      if (hole[i]) { values[i] = 0; continue; }
      let a = -1;
      let b = -1;
      for (let k = x - 1; k >= 0; k--) if (valid[y * w + k]) { a = k; break; }
      for (let k = x + 1; k < w; k++) if (valid[y * w + k]) { b = k; break; }
      if (a >= 0 && b >= 0) {
        const lo = src[y * w + a];
        values[i] = lo + (src[y * w + b] - lo) * ((x - a) / (b - a));
      } else if (a >= 0 || b >= 0) values[i] = src[y * w + (a >= 0 ? a : b)];
      else values[i] = 0;
    }
  }
}

function bilinearAt(""")
# 4. tiffRowsHeights keeps holes apart from rejects (+7)
rep("""  const valid = new Uint8Array(rowsN * cols);
  for (let r = 0; r < rowsN; r++) {
    const buf = buffers[r];""", """  const valid = new Uint8Array(rowsN * cols);
  const hole = new Uint8Array(rowsN * cols);
  for (let r = 0; r < rowsN; r++) {
    const buf = buffers[r];""")
rep("""      const v = view.getInt16(c * 2, true);
      values[r * cols + c] = v;
      valid[r * cols + c] = v === plan.noData ? 0 : 1;""", """      const v = view.getInt16(c * 2, true);
      const k = r * cols + c;
      values[k] = v;
      hole[k] = v === plan.noData ? 1 : 0;
      valid[k] = 1 - hole[k];""")
rep("""  applyHeightTransform(values, valid, plan);
  // Always to the datum. The rows read here are not neighbours of each other
  // — a coarse tile reads a couple of rows in every dozen — so there is no
  // ground beside a hole to fill it from, and the holes in these two maps are
  // half a world wide anyway.
  fillInvalid(values, valid, cols, rowsN, 'datum');""", """  applyHeightTransform(values, valid, plan);
  // A hole — no data in the file — goes to the datum. The rows read here are
  // not neighbours of each other — a coarse tile reads a couple of rows in
  // every dozen — so there is no ground above or below a hole to fill it
  // from, and the holes in these two maps are half a world wide anyway.
  // A value out of the body's reach is another matter: it stands in real
  // ground, so it takes its height from the real cells beside it on its row.
  // Sent to the datum it was a 0 m needle in a crater, or a pit in a peak —
  // fourteen kilometres of each on Charon.
  fillRowRejects(values, valid, hole, cols, rowsN);""")
# 5. fetchPlanetaryImage: a failed connection on a layer with gaps is a gap (+1 doc, +15 body)
rep(""" * pictures, and the third is a picture of nothing — "no imagery here", which
 * sends the square on to the next source.
 */
export async function fetchPlanetaryImage(url, signal) {
  return withRetries(async () => {
    const res = await request(url, signal);""", """ * pictures, and the third is a picture of nothing — "no imagery here", which
 * sends the square on to the next source; and so, on a layer with `gaps`, does
 * a connection that fails.
 */
export async function fetchPlanetaryImage(url, signal, layer = {}) {
  return withRetries(async () => {
    let res;
    try {
      res = await request(url, signal);
    } catch (err) {
      // A map with gaps answers a missing tile with a 404 and, unlike its
      // pictures, without the CORS header — so a browser is never shown the
      // 404, only a failed connection, the same as a dropped one. On a layer
      // marked as having gaps that is nearly always a gap: asked for again it
      // fails again, two seconds later, with the picture underneath waiting.
      // Once is enough.
      if (layer.gaps === true && err?.transient === true && err.status == null) {
        err.transient = false;
        err.noImageryHere = true;
      }
      throw err;
    }""")
open(sys.argv[2], 'w').write(s)
print(sys.argv[2], s.count('\n'), 'lines')

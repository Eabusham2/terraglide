/**
 * Where the ground comes from away from Earth, and the arithmetic that turns
 * it into the tiles the rest of the game already knows how to draw.
 *
 * Everything off Earth is published the same way: as equirectangular maps,
 * where a pixel is a fixed number of degrees of longitude by the same number of
 * degrees of latitude. The game is a Web Mercator quadtree, where a tile is a
 * fixed number of degrees of longitude by a number of degrees of latitude that
 * shrinks towards the poles. The two agree exactly across a tile and disagree
 * down it, so every planetary picture and every planetary height grid is
 * fetched in its own projection and then has its *rows* moved — the columns
 * never need to be — before anything downstream sees it. That is all this
 * module does, besides naming the sources.
 *
 * Four kinds of source, all measured from this machine against the live
 * services before being written down here (Node fetch, an Origin header
 * standing in for a hosted page):
 *
 *   'eq'          NASA Solar System Treks WMTS tiles, and Esri's astro.arcgis.com
 *                 Mars tiles, which share the layout: level L is 2^(L+1) by 2^L
 *                 tiles, each 180/2^L degrees square, column 0 at -180, row 0 at
 *                 the north pole. 96 tiles in parallel took 900 ms with every
 *                 one answering. Asking one level past a layer's last returns a
 *                 404 (Trek) or a 400 (astro) with no CORS header on it, which a
 *                 browser reports as a CORS failure rather than as "not here",
 *                 so every layer carries its real last level and nothing deeper
 *                 is ever asked for.
 *   'wms'         USGS Astrogeology's map server, GetMap with an EPSG:4326 box.
 *                 Any box, any size up to 4096 pixels, CORS open. A box it cannot
 *                 serve still comes back as HTTP 200 with an XML body, so the
 *                 content type is checked before anything is decoded.
 *   'arcgis-f32'  Trek's ArcGIS ImageServer `exportImage`, asked for raw
 *                 Float32 (`format=bsq&pixelType=F32`): the heights
 *                 little-endian, row 0 north and column 0 west, followed by one
 *                 validity bit per pixel, most significant bit first — 64 by 64
 *                 is exactly 16,384 + 512 bytes, with no header and no padding.
 *                 The box's edges are pixel *edges*, not pixel centres.
 *   'tiff-rows'   USGS's uncompressed GeoTIFFs on S3, for Pluto and Charon,
 *                 which have no tile service of any kind. One strip per row and
 *                 the strips back to back, so any pixel is a byte offset and a
 *                 tile is a few dozen small range reads.
 *
 * The rule the rest of the game keeps applies here unchanged: nothing is made
 * up. Where a mission never measured the relief there is no elevation source
 * at all and the ground is flat; where a measured map has a hole in it, the
 * hole is flat too.
 *
 * Kept free of the DOM and of the body table, because it runs in the tile
 * worker as well as on the page. Everything about a particular world that the
 * worker needs travels in the job message, worked out here on the page side.
 * It imports nothing at all: even geo/mercator.js now reads the body table, to
 * know the world's radius, and a module the worker loads should not be the
 * one that drags in a guess about which world the page is on.
 */

const TREK = 'https://trek.nasa.gov';

/**
 * Normalised mercator Y (0 at the north edge) to latitude in degrees.
 *
 * The same formula as geo/mercator.js's, repeated rather than imported for
 * the reason above. Pure angle arithmetic: it is the same on a sphere of any
 * size, so nothing about the body is in it.
 */
export function normYToLat(ny) {
  return (2 * Math.atan(Math.exp((0.5 - ny) * 2 * Math.PI)) - Math.PI / 2) * (180 / Math.PI);
}

/** A Trek WMTS layer. The extension must match the layer's own format or it 404s. */
function trekTiles(body, layer, ext) {
  return `${TREK}/tiles/${body}/EQ/${layer}/1.0.0/default/default028mm/{level}/{row}/{col}.${ext}`;
}

/** A USGS Astrogeology GetMap request, box and size filled in per tile. */
function usgsMap(system, body, layer) {
  return 'https://planetarymaps.usgs.gov/cgi-bin/mapserv'
    + `?map=/maps/${system}/${body}_simp_cyl.map&service=WMS&version=1.1.1&request=GetMap`
    + `&layers=${layer}&styles=&srs=EPSG:4326&bbox={bbox}&width={width}&height={height}`
    + '&format=image/jpeg';
}

/** A Trek ArcGIS ImageServer, by the path after the host. */
function imageServer(path) {
  return `${TREK}/${path}/ImageServer`;
}

/**
 * The smallest a real tile can be, in bytes. Anything shorter is a blank.
 *
 * Kaguya's mosaic stops short of the poles and answers the last row of tiles
 * with a 206-byte empty PNG and HTTP 200. No photograph of anything compresses
 * that far — the smallest real tile seen across every layer here was over a
 * kilobyte — so a reply this short is treated as "no picture here", which moves
 * the square on to the next source rather than drawing nothing as if it were
 * ground.
 */
export const BLANK_TILE_BYTES = 300;

/**
 * Is this pixel data nothing but one flat black or one flat white?
 *
 * The map server's answer for ground its mosaic does not cover is not an
 * error and not a blank file: it is a perfectly good JPEG of nothing. Measured
 * at 85°S on the Moon, where USGS's WAC layer stops: HTTP 200, image/jpeg, 692
 * bytes, every pixel exactly 0 — while the same box five degrees north was a
 * real picture (mean 72, spread 46). Drawn, it is a black square in the ground.
 * White is the other fill it uses (a box past ±180 comes back white).
 *
 * No photograph of anything is one exact colour from edge to edge, so either
 * means "no picture here", like Kaguya's blank file. Two levels of slack
 * either way for the JPEG round trip.
 */
export function isFillColour(data) {
  if (!data || data.length < 4) return false;
  const first = data[0];
  if (first > 2 && first < 253) return false;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - first) > 2 || Math.abs(data[i + 1] - first) > 2
      || Math.abs(data[i + 2] - first) > 2) {
      return false;
    }
  }
  return true;
}

/**
 * Look at a decoded picture through a 16-pixel peephole for the fill above.
 *
 * Shrunk with smoothing, so a tile that is mostly fill with real ground in a
 * corner averages to something other than the fill and is drawn. Anything
 * that cannot be read back — a canvas that does not support it — counts as a
 * picture, which is what it was before this check existed.
 */
function pictureIsFill(image, makeCanvas) {
  try {
    const probe = makeCanvas(16, 16);
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (typeof ctx?.getImageData !== 'function') return false;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0, 16, 16);
    return isFillColour(ctx.getImageData(0, 0, 16, 16).data);
  } catch {
    return false;
  }
}

/**
 * Every world but Earth, and where its ground comes from.
 *
 *   imagery    the photograph to fly over, then its standbys in the order the
 *              streamer should fall through them
 *   elevation  the measured relief, or null where none exists — flat ground,
 *              because nothing here is invented
 *   credit     the line that has to stay on screen
 *
 * Imagery descriptors carry `maxZoom` in the game's own (mercator) zooms. For
 * a Trek layer that is its last level plus one: a mercator tile at zoom z spans
 * exactly the longitude of a Trek tile at level z-1, so z = last + 1 uses the
 * deepest pixels at their own width and anything deeper would only be the same
 * pixels magnified. For the map server, whose boxes can be any size, it is the
 * first zoom at which a 256-pixel tile is as fine as the mosaic behind it.
 *
 * Elevation descriptors' `maxZoom` is where the 65-sample grid the terrain
 * reads reaches the DEM's own spacing: 2^z = 360 x (pixels per degree) / 64,
 * rounded up, and never below 6 so the coarse blanket under the sharp tiles
 * still has a level to stand on.
 */
export const PLANETARY_SOURCES = {
  moon: {
    credit: 'Imagery: JAXA/SELENE Kaguya TC, NASA/GSFC/ASU LRO WAC — relief: NASA LRO LOLA — via NASA Moon Trek',
    imagery: [
      {
        id: 'moon-kaguya',
        label: 'Kaguya Terrain Camera over LRO WAC',
        kind: 'eq',
        needsKey: null,
        /*
          Kaguya's level 10 is 21 metres a pixel and the sharpest global
          picture of the Moon there is — but it is not whole. Its PNGs are
          transparent wherever the camera has no frame, and the terrain draws
          a transparent pixel as black. Measured at level 4, four longitudes a
          row: 1-4% of every row near the equator is a hole, 9% at 50-70
          degrees, half of everything at 84. Unfilled, that is black flecks
          across the maria and black ground at the poles.

          So the Wide Angle Camera mosaic, which is coarser (83 m) and has no
          holes at all — fully opaque in every row sampled, poles included —
          goes down first, and Kaguya is drawn over it. Where Kaguya has a
          picture it is all you see; where it has none you see WAC rather than
          black. A Kaguya tile that is all hole, or its blank pole-row file,
          leaves WAC on its own. Past level 8 a WAC tile is shared by many
          squares, so it is mostly a cache hit.
        */
        layers: [
          {
            template: trekTiles('Moon', 'LRO_WAC_Mosaic_Global_303ppd_v02', 'jpg'),
            tileSize: 256,
            maxLevel: 8,
          },
          {
            template: trekTiles('Moon', 'Kaguya_TCortho_Mosaic_Global_4096ppd', 'png'),
            tileSize: 256,
            maxLevel: 10,
            optional: true,
          },
        ],
        maxZoom: 11,
        attribution: 'Imagery: JAXA/SELENE Kaguya TC over NASA/GSFC/ASU LRO WAC, via NASA Moon Trek',
        note: 'Greyscale, as the Moon is. 21 m a pixel at its deepest.',
      },
      {
        id: 'moon-wac',
        label: 'LRO Wide Angle Camera mosaic',
        kind: 'eq',
        needsKey: null,
        layers: [{
          template: trekTiles('Moon', 'LRO_WAC_Mosaic_Global_303ppd_v02', 'jpg'),
          tileSize: 256,
          maxLevel: 8,
        }],
        maxZoom: 9,
        attribution: 'Imagery: NASA/GSFC/Arizona State University LRO WAC, via NASA Moon Trek',
        note: 'Coarser than Kaguya but it covers the poles.',
      },
      {
        id: 'moon-wac-usgs',
        label: 'LRO WAC mosaic (USGS)',
        kind: 'wms',
        needsKey: null,
        template: usgsMap('earth', 'moon', 'LROC_WAC'),
        tileSize: 256,
        maxZoom: 9,
        attribution: 'Imagery: NASA/GSFC/ASU LRO WAC, via USGS Astrogeology',
        note: 'The same camera from a different server, for when Trek is down.',
      },
    ],
    elevation: {
      id: 'moon-lola',
      label: 'LRO LOLA altimetry',
      kind: 'arcgis-f32',
      needsKey: null,
      // The 256-pixel-per-degree DEM has no overviews, so the server reads
      // every source pixel under the box: measured at 256 by 256 out, a 0.5°
      // box took 453 ms, 8° took 522, 20° took 1.4 s, 45° took 4.8 s and the
      // whole globe gave up at sixty seconds with a 502. The 128 ppd version
      // has overviews and stayed between 73 and 378 ms at any size. So the
      // sharp one only for boxes it can answer quickly.
      services: [
        { url: imageServer('moon/trekarcgis/rest/services/LRO_LOLA_DEM_Global_256ppd_v06'), maxSpanDeg: 8 },
        { url: imageServer('moon/trekarcgis/rest/services/LRO_LOLA_DEM_Global_128ppd_v04') },
      ],
      // Heights above the 1,737.4 km sphere, which is the body's own radius.
      heights: 'relative',
      maxZoom: 11,
      attribution: 'Relief: NASA LRO LOLA, via NASA Moon Trek',
    },
  },

  mars: {
    credit: 'Imagery: NASA/JPL/USGS Viking MDIM 2.1, NASA/JPL/MSSS/The Murray Lab CTX — relief: NASA MGS MOLA, ESA/DLR/FU Berlin HRSC — via NASA Mars Trek',
    imagery: [
      {
        id: 'mars-ctx-viking',
        label: 'CTX on Viking colour',
        kind: 'eq',
        needsKey: null,
        /*
          Two maps of Mars, one drawn through the other.

          Viking's MDIM 2.1 is the colour, and stops at 326 m a pixel. The
          Context Camera mosaic is 5 m a pixel, nearly global — and grey, and an
          uncontrolled beta whose strips differ in brightness. Drawn on its own
          it is a sharp grey patchwork; Viking alone is a soft orange blur from
          walking height.

          So Viking goes down first and CTX goes over it in the "luminosity"
          blend: the brightness and every edge from CTX, the hue and the
          saturation from Viking underneath. Where CTX has a gap — a 404 for a
          missing tile, or a transparent part of one, both measured: about a
          tenth of zoom-9 tiles sampled across the planet carried some — Viking
          shows through on its own, so a gap is soft rather than a hole.

          The deeper layer sets the depth. CTX's level 12 is its last real one
          (13 answers 400), and astro.arcgis.com tiles are 512 pixels, so the
          output is 512 square.

          Only from zoom 9, where Viking is already a magnified crop. CTX is
          lined up with Viking and MOLA — Jezero's rim and the small craters
          beside it sit on the same pixels in all three — but it is a mosaic of
          strips flattened to one grey, so above that the crater walls and the
          dark and bright ground that Viking shows are washed out of it, and
          laid over Viking it took them away: Jezero at zoom 7 went from a
          crater to a pale smudge. Below zoom 9 the tile is Viking alone.
        */
        layers: [
          {
            template: trekTiles('Mars', 'Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg'),
            tileSize: 256,
            maxLevel: 7,
          },
          {
            template: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{level}/{row}/{col}',
            tileSize: 512,
            maxLevel: 12,
            blend: 'luminosity',
            optional: true,
            gaps: true,
            fromZoom: 9,
          },
        ],
        maxZoom: 13,
        attribution: 'Imagery: NASA/JPL/MSSS/The Murray Lab CTX over NASA/JPL/USGS Viking MDIM 2.1',
        note: 'Five metres a pixel in Viking\'s colours. The CTX mosaic is an uncontrolled beta.',
      },
      {
        id: 'mars-viking-usgs',
        label: 'Viking MDIM 2.1 colour (USGS)',
        kind: 'wms',
        needsKey: null,
        template: usgsMap('mars', 'mars', 'MDIM21_color'),
        tileSize: 256,
        maxZoom: 9,
        attribution: 'Imagery: NASA/JPL/USGS Viking MDIM 2.1, via USGS Astrogeology',
        note: 'The colour layer from a second server.',
      },
      {
        id: 'mars-ctx',
        label: 'CTX mosaic',
        kind: 'eq',
        needsKey: null,
        layers: [{
          template: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{level}/{row}/{col}',
          tileSize: 512,
          maxLevel: 12,
          gaps: true,
        }],
        maxZoom: 13,
        attribution: 'Imagery: NASA/JPL/MSSS/The Murray Lab CTX',
        note: 'Grey, for the deep squares when the colour server is not answering.',
      },
    ],
    elevation: {
      id: 'mars-mola',
      label: 'MOLA and HRSC altimetry',
      kind: 'arcgis-f32',
      needsKey: null,
      // The HRSC blend is 200 m a pixel and has no overviews either: fine at 4°
      // or less (79-82 ms), a 502 for the globe. MOLA at 128 ppd has them.
      // Both are stored as 16-bit integers; asking for F32 has the server
      // convert, so one decoder reads every body.
      services: [
        { url: imageServer('mars/trekarcgis/rest/services/Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw'), maxSpanDeg: 4 },
        { url: imageServer('mars/trekarcgis/rest/services/mola128_mola64_merge_90Nto90S_SimpleC_clon0') },
      ],
      // Heights above the areoid, which is what "height on Mars" means.
      heights: 'relative',
      maxZoom: 11,
      attribution: 'Relief: NASA MGS MOLA and ESA/DLR/FU Berlin HRSC, via NASA Mars Trek',
    },
  },

  mercury: {
    credit: 'Imagery and relief: NASA/JHU APL/Carnegie Institution MESSENGER — via NASA Mercury Trek',
    imagery: [
      {
        id: 'mercury-mdis',
        label: 'MESSENGER MDIS basemap',
        kind: 'eq',
        needsKey: null,
        layers: [{
          template: trekTiles('Mercury', 'Mercury_MESSENGER_MDIS_Basemap_BDR_Mosaic_Global_166m', 'jpg'),
          tileSize: 256,
          maxLevel: 7,
        }],
        maxZoom: 8,
        attribution: 'Imagery: NASA/JHU APL/Carnegie MESSENGER MDIS, via NASA Mercury Trek',
        note: '234 m a pixel at its deepest.',
      },
      {
        id: 'mercury-usgs',
        label: 'MESSENGER global mosaic (USGS)',
        kind: 'wms',
        needsKey: null,
        template: usgsMap('mercury', 'mercury', 'MESSENGER'),
        tileSize: 256,
        maxZoom: 9,
        attribution: 'Imagery: NASA/JHU APL/Carnegie MESSENGER, via USGS Astrogeology',
        note: 'The same mission\'s mosaic from a second server.',
      },
    ],
    elevation: {
      id: 'mercury-dem',
      label: 'MESSENGER global DEM',
      kind: 'arcgis-f32',
      needsKey: null,
      services: [
        { url: imageServer('mercury/arcgis/rest/services/mercury/Mercury_Messenger_USGS_DEM_Global_665m_v2') },
      ],
      heights: 'relative',
      // 64 pixels a degree.
      maxZoom: 9,
      attribution: 'Relief: NASA/JHU APL/Carnegie MESSENGER, USGS, via NASA Mercury Trek',
    },
  },

  venus: {
    credit: 'Imagery and relief: NASA/JPL Magellan — via NASA Venus Trek',
    imagery: [
      {
        id: 'venus-magellan',
        label: 'Magellan radar mosaic',
        kind: 'eq',
        needsKey: null,
        /*
          Radar backscatter, not light: nothing can photograph the ground
          through that cloud. Brightness is roughness, not colour.

          The 75 m left-look mosaic has holes, transparent in its PNGs and so
          black on the ground: a few percent of most rows, a third of the row
          at 73°S, nearly all of 84°S (level 4, four longitudes a row). The
          2 km C3-MDIR mosaic is complete everywhere but the far south, so it
          goes underneath, the way WAC goes under Kaguya on the Moon.
        */
        layers: [
          {
            template: trekTiles('Venus', 'Venus_Magellan_C3-MDIR_Global_Mosaic_2025m', 'png'),
            tileSize: 256,
            maxLevel: 5,
          },
          {
            template: trekTiles('Venus', 'Venus_Magellan_LeftLook_mosaic_global_75m', 'png'),
            tileSize: 256,
            maxLevel: 10,
            optional: true,
            gaps: true,
          },
        ],
        maxZoom: 11,
        attribution: 'Imagery: NASA/JPL Magellan SAR, via NASA Venus Trek',
        note: 'Radar, not a photograph: no camera sees through the cloud.',
      },
      {
        id: 'venus-c3mdir',
        label: 'Magellan C3-MDIR mosaic',
        kind: 'eq',
        needsKey: null,
        layers: [{
          template: trekTiles('Venus', 'Venus_Magellan_C3-MDIR_Global_Mosaic_2025m', 'png'),
          tileSize: 256,
          maxLevel: 5,
        }],
        maxZoom: 6,
        attribution: 'Imagery: NASA/JPL Magellan, via NASA Venus Trek',
        note: 'Coarse, but complete.',
      },
    ],
    elevation: {
      id: 'venus-topography',
      label: 'Magellan altimetry',
      kind: 'arcgis-f32',
      needsKey: null,
      // In metres. Trek's other Venus topography service, `topogrd`, is in
      // kilometres, one pixel a degree, and is not this one.
      services: [
        { url: imageServer('venus/trekarcgis/rest/services/venus/Venus_Magellan_Topography_Global_4641m_gapfilled_v02') },
      ],
      heights: 'relative',
      // 22.76 pixels a degree.
      maxZoom: 7,
      attribution: 'Relief: NASA/JPL Magellan altimetry, via NASA Venus Trek',
    },
  },

  ceres: {
    credit: 'Imagery and relief: NASA/JPL-Caltech/UCLA/MPS/DLR/IDA Dawn — via NASA Ceres Trek',
    imagery: [
      {
        id: 'ceres-lamo',
        label: 'Dawn LAMO colour mosaic',
        kind: 'eq',
        needsKey: null,
        // "180E" in the name notwithstanding, it is not shifted: against the
        // Dawn FC mosaic the best match is at 0° (0.87), not 180.
        layers: [{
          template: trekTiles('Ceres', 'CE_LAMO_G_00N_180E_EQU_CLR_scale.eq', 'jpg'),
          tileSize: 256,
          maxLevel: 7,
        }],
        maxZoom: 8,
        attribution: 'Imagery: NASA/JPL-Caltech/UCLA/MPS/DLR/IDA Dawn, via NASA Ceres Trek',
        note: '45 m a pixel at its deepest.',
      },
      {
        id: 'ceres-usgs',
        label: 'Dawn FC global mosaic (USGS)',
        kind: 'wms',
        needsKey: null,
        template: usgsMap('asteroid_belt', 'ceres', 'Ceres_FC_global'),
        tileSize: 256,
        maxZoom: 7,
        attribution: 'Imagery: NASA/JPL-Caltech/UCLA/MPS/DLR/IDA Dawn, via USGS Astrogeology',
        note: 'From a second server; lines up with Trek\'s at 0° (0.57 correlation).',
      },
    ],
    elevation: {
      id: 'ceres-hamo',
      label: 'Dawn HAMO DTM',
      kind: 'arcgis-f32',
      needsKey: null,
      services: [
        { url: imageServer('ceres/arcgis/rest/services/ceres/Ceres_Dawn_FC_HAMO_DTM_DLR_Global_60ppd_Oct2016') },
      ],
      // Above a 470 km sphere, which Ceres is not: the equator reads twelve
      // kilometres high and the poles over twenty low. Real, and kept.
      heights: 'relative',
      maxZoom: 9,
      attribution: 'Relief: NASA/JPL-Caltech/UCLA/MPS/DLR/IDA Dawn, via NASA Ceres Trek',
    },
  },

  vesta: {
    credit: 'Imagery and relief: NASA/JPL-Caltech/UCLA/MPS/DLR/IDA Dawn — via NASA Vesta Trek',
    imagery: [
      {
        id: 'vesta-blend',
        label: 'Dawn HAMO/LAMO blend',
        kind: 'eq',
        needsKey: null,
        // Only the IAU-frame layers are used on Vesta. Dawn's maps were first
        // published in the "Claudia" frame, which puts every feature about 150°
        // away from where these put it; this layer, the true-colour one below
        // and the DEM share one frame (0.999 correlation against the DEM's own
        // greyscale rendering).
        layers: [{
          template: trekTiles('Vesta', 'VestaHAMOLAMOBlend.eq', 'png'),
          tileSize: 256,
          maxLevel: 7,
        }],
        maxZoom: 8,
        attribution: 'Imagery: NASA/JPL-Caltech/UCLA/MPS/DLR/IDA Dawn, via NASA Vesta Trek',
        note: 'About 24 m a pixel at its deepest.',
      },
      {
        id: 'vesta-trueclr',
        label: 'Dawn HAMO true colour',
        kind: 'eq',
        needsKey: null,
        layers: [{
          template: trekTiles('Vesta', 'Vesta_Dawn_HAMO_TrueClr_DLR_global_74ppd_IAU', 'png'),
          tileSize: 256,
          maxLevel: 6,
        }],
        maxZoom: 7,
        attribution: 'Imagery: NASA/JPL-Caltech/UCLA/MPS/DLR/IDA Dawn, via NASA Vesta Trek',
        note: 'Same frame, one level coarser.',
      },
    ],
    elevation: {
      id: 'vesta-hamo',
      label: 'Dawn HAMO DTM',
      kind: 'arcgis-f32',
      needsKey: null,
      services: [
        { url: imageServer('vesta/trekarcgis/rest/services/vesta/Vesta_Dawn_HAMO_DTM_DLR_Global_48ppd_gcs') },
      ],
      // Not a height at all: the distance from Vesta's centre, 212 to 292 km.
      // The body's radius comes off it.
      heights: 'radius',
      maxZoom: 9,
      attribution: 'Relief: NASA/JPL-Caltech/UCLA/MPS/DLR/IDA Dawn, via NASA Vesta Trek',
    },
  },

  io: {
    credit: 'Imagery: NASA/JPL Galileo SSI and Voyager — relief: USGS Io DEM — via NASA Io Trek',
    imagery: [
      {
        id: 'io-colour',
        label: 'Galileo and Voyager colour mosaic',
        kind: 'eq',
        needsKey: null,
        layers: [{
          template: trekTiles('Io', 'Io_GalileoSSI_Voyager_Global_Mosaic_ClrMerge_1km', 'png'),
          tileSize: 256,
          maxLevel: 4,
        }],
        maxZoom: 5,
        attribution: 'Imagery: NASA/JPL Galileo SSI and Voyager, via NASA Io Trek',
        note: 'About 1.4 km a pixel: Io was never mapped closer than that.',
      },
      {
        id: 'io-usgs',
        label: 'Galileo and Voyager colour mosaic (USGS)',
        kind: 'wms',
        needsKey: null,
        template: usgsMap('jupiter', 'io', 'SSI_VGR_color'),
        tileSize: 256,
        maxZoom: 6,
        attribution: 'Imagery: NASA/JPL Galileo SSI and Voyager, via USGS Astrogeology',
        note: 'From a second server; lines up with Trek\'s at 0° (0.95 correlation).',
      },
    ],
    elevation: {
      id: 'io-dem',
      label: 'Io global DEM',
      kind: 'arcgis-f32',
      needsKey: null,
      services: [{ url: imageServer('io/trekarcgis/rest/services/io/IoDEM') }],
      // Heights above a 1,821.49 km sphere, which is 110 m smaller than the
      // radius the game uses for Io. The difference is put back.
      heights: 'relative',
      sphere: 1821490,
      maxZoom: 8,
      attribution: 'Relief: USGS Io DEM, via NASA Io Trek',
    },
  },

  europa: {
    credit: 'Imagery: NASA/JPL Galileo SSI and Voyager — no global relief has been measured — via NASA Europa Trek',
    imagery: [
      {
        id: 'europa-ssi',
        label: 'Galileo and Voyager mosaic',
        kind: 'eq',
        needsKey: null,
        layers: [{
          template: trekTiles('Europa', 'Europa_Voyager_GalileoSSI_global_mosaic_500m', 'png'),
          tileSize: 256,
          maxLevel: 5,
        }],
        maxZoom: 6,
        attribution: 'Imagery: NASA/JPL Galileo SSI and Voyager, via NASA Europa Trek',
        note: 'About 600 m a pixel.',
      },
      {
        id: 'europa-usgs',
        label: 'Galileo and Voyager mosaic (USGS)',
        kind: 'wms',
        needsKey: null,
        template: usgsMap('jupiter', 'europa', 'GALILEO_VOYAGER'),
        tileSize: 256,
        maxZoom: 6,
        attribution: 'Imagery: NASA/JPL Galileo SSI and Voyager, via USGS Astrogeology',
        note: 'From a second server; lines up with Trek\'s at 0° (0.97 correlation).',
      },
    ],
    // Only regional stereo patches exist, a couple of degrees across. Trek's
    // own configuration points Europa's global DEM at an asteroid's by mistake.
    elevation: null,
  },

  ganymede: {
    credit: 'Imagery: NASA/JPL Galileo SSI and Voyager, USGS — no global relief has been measured — via NASA Ganymede Trek',
    imagery: [
      {
        id: 'ganymede-usgs-trek',
        label: 'Ganymede global mosaic',
        kind: 'eq',
        needsKey: null,
        layers: [{
          template: trekTiles('Ganymede', 'Ganymede_global_equi_000_359m', 'png'),
          tileSize: 256,
          maxLevel: 6,
        }],
        maxZoom: 7,
        attribution: 'Imagery: NASA/JPL Galileo SSI and Voyager, USGS, via NASA Ganymede Trek',
        note: 'About 500 m a pixel.',
      },
      {
        id: 'ganymede-usgs',
        label: 'Galileo and Voyager mosaic (USGS)',
        kind: 'wms',
        needsKey: null,
        template: usgsMap('jupiter', 'ganymede', 'GALILEO_VOYAGER'),
        tileSize: 256,
        maxZoom: 6,
        attribution: 'Imagery: NASA/JPL Galileo SSI and Voyager, via USGS Astrogeology',
        note: 'From a second server; lines up with Trek\'s at 0°.',
      },
    ],
    elevation: null,
  },

  callisto: {
    credit: 'Imagery: NASA/JPL Galileo SSI and Voyager — no global relief has been measured — via NASA Trek',
    imagery: [
      {
        id: 'callisto-ssi',
        label: 'Galileo and Voyager mosaic',
        kind: 'eq',
        needsKey: null,
        // There is no Callisto Trek portal, but the tiles are there.
        layers: [{
          template: trekTiles('Callisto', 'Callisto_Voyager_GalileoSSI_global_mosaic_1km', 'png'),
          tileSize: 256,
          maxLevel: 5,
        }],
        maxZoom: 6,
        attribution: 'Imagery: NASA/JPL Galileo SSI and Voyager, via NASA Trek',
        note: 'About 900 m a pixel.',
      },
      {
        id: 'callisto-usgs',
        label: 'Galileo and Voyager mosaic (USGS)',
        kind: 'wms',
        needsKey: null,
        template: usgsMap('jupiter', 'callisto', 'GALILEO_VOYAGER'),
        tileSize: 256,
        maxZoom: 6,
        attribution: 'Imagery: NASA/JPL Galileo SSI and Voyager, via USGS Astrogeology',
        note: 'From a second server; lines up with Trek\'s at 0° (0.96 correlation).',
      },
    ],
    elevation: null,
  },

  titan: {
    credit: 'Imagery: NASA/JPL-Caltech/SSI Cassini ISS — relief: Cassini radar shape model — via NASA Titan Trek and USGS',
    imagery: [
      {
        id: 'titan-iss',
        label: 'Cassini ISS mosaic',
        kind: 'eq',
        needsKey: null,
        /*
          Every Trek Titan layer, this one and the DEM included, is drawn half a
          turn round from where it says it is. They declare -180 to 180 and
          actually run 0°E to 360°E. Measured: against USGS's own Titan map, which
          has its longitudes right, the best match is at exactly 180° (0.70
          correlation) and the unshifted one is -0.13; and Xanadu, which is at
          about 100°W, sits at +45 to +105 in Trek's tiles. So to show true
          longitude L, Trek is asked for L - 180.
        */
        lonShift: -180,
        layers: [{
          template: trekTiles('Titan', 'TitanISS2018June.proj.scale', 'jpg'),
          tileSize: 256,
          maxLevel: 3,
        }],
        maxZoom: 4,
        attribution: 'Imagery: NASA/JPL-Caltech/SSI Cassini ISS, via NASA Titan Trek',
        note: 'About 4 km a pixel: the haze lets nothing sharper through.',
      },
      {
        id: 'titan-usgs',
        label: 'Cassini global mosaic (USGS)',
        kind: 'wms',
        needsKey: null,
        // Already in true longitudes, so no shift.
        template: usgsMap('saturn', 'titan', 'CASSINI'),
        tileSize: 256,
        maxZoom: 5,
        attribution: 'Imagery: NASA/JPL-Caltech/SSI Cassini ISS, via USGS Astrogeology',
        note: 'From a second server, with its longitudes the right way round.',
      },
    ],
    elevation: {
      id: 'titan-shape',
      label: 'Cassini shape model',
      kind: 'arcgis-f32',
      needsKey: null,
      services: [{ url: imageServer('titan/trekarcgis/rest/services/titan/shape_4PPD_geoid_corrected0') }],
      // Shifted half a turn like the imagery, and stored as the distance from
      // Titan's centre (2,574.0 to 2,575.4 km) rather than as a height. Four
      // pixels a degree, eleven kilometres a pixel, much of it interpolated
      // between radar tracks — the best there is.
      lonShift: -180,
      heights: 'radius',
      maxZoom: 6,
      attribution: 'Relief: NASA/JPL Cassini radar shape model, via NASA Titan Trek',
    },
  },

  enceladus: {
    credit: 'Imagery and relief: NASA/JPL-Caltech/SSI Cassini ISS — via NASA Enceladus Trek',
    imagery: [
      {
        id: 'enceladus-colour',
        label: 'Cassini ISS colour mosaic',
        kind: 'eq',
        needsKey: null,
        // Checked by eye against a hillshade of the DEM below: the crater
        // clusters and the tiger stripes sit at the same longitudes at 0°.
        // USGS's own Enceladus map does not match either of them at any shift,
        // so it is not used as a standby.
        layers: [{
          template: trekTiles('Enceladus', 'Enceladus_cyl_KH', 'jpg'),
          tileSize: 256,
          maxLevel: 5,
        }],
        maxZoom: 6,
        attribution: 'Imagery: NASA/JPL-Caltech/SSI Cassini ISS, via NASA Enceladus Trek',
        note: 'About 100 m a pixel.',
      },
      {
        id: 'enceladus-hpf',
        label: 'Cassini ISS mosaic, high-pass',
        kind: 'eq',
        needsKey: null,
        layers: [{
          template: trekTiles('Enceladus', 'Enceladus_Cassini_ISS_Global_Mosaic_100m_HPF', 'png'),
          tileSize: 256,
          maxLevel: 5,
        }],
        maxZoom: 6,
        attribution: 'Imagery: NASA/JPL-Caltech/SSI Cassini ISS, via NASA Enceladus Trek',
        note: 'Grey and edge-sharpened; a standby.',
      },
    ],
    elevation: {
      id: 'enceladus-dem',
      label: 'Cassini ISS DEM',
      kind: 'arcgis-f32',
      needsKey: null,
      services: [{ url: imageServer('enceladus/trekarcgis/rest/services/enceladus/Cassini_ISS_DEM_375m_Global') }],
      heights: 'relative',
      maxZoom: 7,
      attribution: 'Relief: NASA/JPL-Caltech/SSI Cassini ISS DEM, via NASA Enceladus Trek',
    },
  },

  pluto: {
    credit: 'Imagery and relief: NASA/JHUAPL/SwRI New Horizons — via USGS Astrogeology',
    imagery: [
      {
        id: 'pluto-nh',
        label: 'New Horizons mosaic',
        kind: 'wms',
        needsKey: null,
        // No tile service exists for Pluto; the map server draws any box. The
        // hemisphere New Horizons flew past is 300 m a pixel, and the far side
        // was only ever seen from far away.
        template: usgsMap('pluto', 'pluto', 'NEWHORIZONS_PLUTO_MOSAIC'),
        tileSize: 256,
        maxZoom: 7,
        attribution: 'Imagery: NASA/JHUAPL/SwRI New Horizons, via USGS Astrogeology',
        note: '300 m a pixel where New Horizons passed closest.',
      },
    ],
    elevation: {
      id: 'pluto-dem',
      label: 'New Horizons stereo DEM',
      kind: 'tiff-rows',
      needsKey: null,
      /*
        The 16-bit DEM, read straight out of the GeoTIFF a row at a time.

        S3 rather than planetarymaps.usgs.gov: that address redirects through
        Cloudflare with no CORS header on the redirect, so a browser cannot
        follow it. S3 answers ranges with 206 and CORS open, and its preflight
        allows the Range header.

        The layout was read off the file's own header from here: little-endian,
        uncompressed, signed 16-bit, one row per strip, 12,444 strips the first
        at byte 100,199 and the last at exactly 100,199 + 12,443 x 24,888 x 2 —
        so the rows are back to back and a pixel is an offset. Central meridian
        180, so column 0 is 0°E. A 64-row window took 420-504 ms as 64 parallel
        range reads.

        About 54% of it is -32768, "no data": New Horizons saw one hemisphere in
        stereo. That half is flat.
      */
      url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Pluto_NewHorizons_Global_DEM_300m_Jul2017_16bit.tif',
      width: 24888,
      height: 12444,
      firstRow: 100199,
      // Longitude of the left edge of column 0.
      west: 0,
      noData: -32768,
      heights: 'relative',
      fill: 'datum',
      // 69.1 pixels a degree.
      maxZoom: 9,
      attribution: 'Relief: NASA/JHUAPL/SwRI New Horizons, USGS',
    },
  },

  charon: {
    credit: 'Imagery and relief: NASA/JHUAPL/SwRI New Horizons — via USGS Astrogeology',
    imagery: [
      {
        id: 'charon-nh',
        label: 'New Horizons mosaic',
        kind: 'wms',
        needsKey: null,
        template: usgsMap('pluto', 'charon', 'NEWHORIZONS_CHARON_MOSAIC'),
        tileSize: 256,
        maxZoom: 6,
        attribution: 'Imagery: NASA/JHUAPL/SwRI New Horizons, via USGS Astrogeology',
        note: '300 m a pixel where New Horizons passed closest.',
      },
    ],
    elevation: {
      id: 'charon-dem',
      label: 'New Horizons stereo DEM',
      kind: 'tiff-rows',
      needsKey: null,
      // Same layout as Pluto's, read the same way off its header: 12,693 by
      // 6,347, first row at byte 51,427 — but central meridian 0, unlike
      // Pluto's, so column 0 is 180°W. About 55% no data.
      url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Charon_NewHorizons_Global_DEM_300m_Jul2017_16bit.tif',
      width: 12693,
      height: 6347,
      firstRow: 51427,
      west: -180,
      noData: -32768,
      heights: 'relative',
      fill: 'datum',
      // 35.3 pixels a degree.
      maxZoom: 8,
      attribution: 'Relief: NASA/JHUAPL/SwRI New Horizons, USGS',
    },
  },
};

/** The bodies whose ground has measured relief under it. The rest are flat. */
export const BODIES_WITH_ELEVATION = Object.keys(PLANETARY_SOURCES)
  .filter((id) => PLANETARY_SOURCES[id].elevation);

/**
 * Where the measured relief covers only part of the body, and how much.
 *
 * New Horizons saw one face of each in stereo; the rest is flat at the datum.
 */
export const PARTIAL_ELEVATION = { pluto: 0.46, charon: 0.45 };

/** The line to keep on screen for each world. */
export const BODY_ATTRIBUTION = Object.fromEntries(
  Object.entries(PLANETARY_SOURCES).map(([id, entry]) => [id, entry.credit]),
);

// ---------------------------------------------------------------------------
// Tile geometry

/** A mercator tile's edges in degrees: longitudes exact, latitudes from the projection. */
export function mercatorBounds(tile) {
  const n = 2 ** tile.z;
  return {
    west: (tile.x / n) * 360 - 180,
    east: ((tile.x + 1) / n) * 360 - 180,
    north: normYToLat(tile.y / n),
    south: normYToLat((tile.y + 1) / n),
  };
}

/**
 * The latitude of each output row of a mercator tile.
 *
 * Pictures want row *centres* — pixel j covers the band between two mercator
 * lines and is drawn from the middle of it. Height grids want *corners*: the
 * 65 samples the terrain reads are corner-aligned, the first on the tile's
 * north edge and the last on its south edge, so two neighbouring tiles share
 * their border row exactly and no seam can open between them.
 */
export function rowLatitudes(tile, count, corners = false) {
  const n = 2 ** tile.z;
  const out = new Float64Array(count);
  for (let j = 0; j < count; j++) {
    const f = corners ? j / (count - 1) : (j + 0.5) / count;
    out[j] = normYToLat((tile.y + f) / n);
  }
  return out;
}

/** Wrap a longitude into [-180, 180). */
function wrapLon(lon) {
  let x = (lon + 180) % 360;
  if (x < 0) x += 360;
  return x - 180;
}

/** Fill `{level}`, `{row}` and `{col}` (or `{bbox}`, `{width}`, `{height}`). */
function fill(template, values) {
  let out = template;
  for (const [key, value] of Object.entries(values)) out = out.split(`{${key}}`).join(String(value));
  return out;
}

/** Slack for comparing degrees that came out of a projection. */
const EPS = 1e-9;

/**
 * Which equirectangular tiles one layer needs for a mercator tile, and which
 * part of them is the tile.
 *
 * Level `z - 1` has tiles exactly as wide as the mercator tile, so the
 * columns match one for one and only rows move. A mercator tile never covers
 * more latitude than longitude, so it touches one or two source rows; past the
 * layer's last level the same deepest tile is cropped instead, and at zoom 0
 * the whole world is both level-0 tiles side by side.
 *
 * Source tiles are laid out in a "stack" — consecutive columns left to right,
 * consecutive rows top to bottom, each `tileSize` square — and `sx, sy, sw, sh`
 * is the rectangle of the stack, in its own pixels and not rounded, that the
 * mercator tile's edges enclose: exactly its longitudes across, and exactly
 * its latitudes down, still spaced evenly in latitude.
 */
function eqLayerPlan(layer, tile, bounds, lonShift) {
  const T = layer.tileSize ?? 256;
  const level = Math.max(0, Math.min(tile.z - 1, layer.maxLevel));
  const deg = 180 / 2 ** level;
  const columns = 2 ** (level + 1);
  const rowCount = 2 ** level;
  // The layer's own frame: Titan's tiles are drawn half a turn round.
  const west = bounds.west + lonShift;
  const east = bounds.east + lonShift;
  const c0 = Math.floor((west + 180) / deg + EPS);
  const c1 = Math.max(c0, Math.floor((east + 180) / deg - EPS));
  const r0 = Math.max(0, Math.min(rowCount - 1, Math.floor((90 - bounds.north) / deg + EPS)));
  const r1 = Math.max(r0, Math.min(rowCount - 1, Math.floor((90 - bounds.south) / deg - EPS)));
  const sources = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      // Unwrapped columns lie side by side in the stack; the URL wraps.
      const col = ((c % columns) + columns) % columns;
      sources.push({
        url: fill(layer.template, { level, row: r, col }),
        x: (c - c0) * T,
        y: (r - r0) * T,
        w: T,
        h: T,
      });
    }
  }
  const stackWest = c0 * deg - 180;
  const stackNorth = 90 - r0 * deg;
  return {
    level,
    tileSize: T,
    blend: layer.blend ?? 'source-over',
    optional: layer.optional === true,
    gaps: layer.gaps === true,
    sources,
    stackW: (c1 - c0 + 1) * T,
    stackH: (r1 - r0 + 1) * T,
    sx: ((west - stackWest) / deg) * T,
    sy: ((stackNorth - bounds.north) / deg) * T,
    sw: ((east - west) / deg) * T,
    sh: ((bounds.north - bounds.south) / deg) * T,
  };
}

/**
 * How the rows of a picture spaced evenly in latitude become a mercator
 * tile's rows.
 *
 * The picture is first drawn, smoothed both ways, onto an intermediate canvas
 * that is still evenly spaced in latitude and covers exactly the tile; each
 * output row is then that canvas's row at the output row's own latitude.
 *
 * Not one source row per output row, which is what this did first: across a
 * tile at the equator a source row is about one output row tall and that is
 * fine, but mercator stretches latitude by 1/cos, so at 60 degrees each source
 * row became two identical output rows, at 80 nearly six, and Mars's Viking
 * colour — cropped thirty-two times over under CTX at the deepest zoom — came
 * out as bands, smooth across and stepped down. Smoothed first, the steps go.
 *
 * The intermediate has enough rows that none is taller than the tile's
 * thinnest output row, so picking the nearest one is never more than half an
 * output row out. Deep tiles need barely more than `size`; the whole
 * hemisphere at zoom 1, whose top row is a fifteenth the height of its bottom
 * one, is capped at four times that.
 */
function mercatorRows(tile, bounds, size) {
  const n = 2 ** tile.z;
  const latSpan = bounds.north - bounds.south;
  let thinnest = Infinity;
  let above = bounds.north;
  for (let j = 1; j <= size; j++) {
    const below = normYToLat((tile.y + j / size) / n);
    thinnest = Math.min(thinnest, above - below);
    above = below;
  }
  const midH = Math.max(size, Math.min(size * 4, Math.ceil(latSpan / thinnest - 1e-6)));
  const lats = rowLatitudes(tile, size);
  const rowY = new Array(size);
  for (let j = 0; j < size; j++) {
    const y = Math.floor(((bounds.north - lats[j]) / latSpan) * midH);
    rowY[j] = Math.max(0, Math.min(midH - 1, y));
  }
  return { midH, rowY };
}

/**
 * One map-server box for a mercator tile: its own longitudes, its own
 * latitudes, and as many rows as the intermediate canvas has, so the server
 * draws them rather than the canvas stretching fewer.
 */
function wmsLayerPlan(descriptor, bounds, size, midH) {
  const shift = descriptor.lonShift ?? 0;
  const span = bounds.east - bounds.west;
  let west = bounds.west + shift;
  if (span < 360 - EPS) west = wrapLon(west);
  const east = west + span;
  // A box across the antimeridian comes back half white. The game's tiles
  // never cross it, so only a shifted source could, and none does; refuse
  // rather than draw half a tile of white.
  if (east > 180 + EPS) return null;
  const bbox = [west, bounds.south, east, bounds.north].map((v) => v.toFixed(7)).join(',');
  return {
    level: null,
    tileSize: size,
    blend: 'source-over',
    optional: false,
    sources: [{ url: fill(descriptor.template, { bbox, width: size, height: midH }), x: 0, y: 0, w: size, h: midH }],
    stackW: size,
    stackH: midH,
    sx: 0,
    sy: 0,
    sw: size,
    sh: midH,
  };
}

/**
 * Everything needed to draw one mercator tile of planetary imagery: the
 * source images, where each sits, which part of them is the tile, and which
 * row of the latitude-spaced intermediate feeds each output row. Null when
 * this source cannot serve the tile.
 *
 * Plain data — numbers, strings and arrays — so it can be posted to the tile
 * worker as it is, and checked in Node without a canvas.
 *
 * @returns {null | { size: number, midH: number, rowY: number[], west: number,
 *   east: number, north: number, south: number, layers: Array<object> }}
 */
export function eqImageryPlan(descriptor, tile) {
  if (!descriptor || !tile || tile.z < 0) return null;
  const n = 2 ** tile.z;
  if (tile.y < 0 || tile.y >= n) return null;
  const x = ((tile.x % n) + n) % n;
  const t = { z: tile.z, x, y: tile.y };
  const bounds = mercatorBounds(t);
  if (descriptor.kind === 'wms') {
    const size = descriptor.tileSize ?? 256;
    const rows = mercatorRows(t, bounds, size);
    const layer = wmsLayerPlan(descriptor, bounds, size, rows.midH);
    return layer ? { size, ...rows, ...bounds, layers: [layer] } : null;
  }
  if (descriptor.kind !== 'eq' || !Array.isArray(descriptor.layers) || descriptor.layers.length === 0) {
    return null;
  }
  // A layer can start part-way down (see Mars's CTX).
  const active = descriptor.layers.filter((layer) => !(layer.fromZoom > t.z));
  if (active.length === 0) return null;
  // The output is as wide as the widest layer's tiles, so the sharp layer is
  // never drawn smaller than it arrived.
  const size = Math.max(...active.map((l) => l.tileSize ?? 256));
  const layers = active.map((layer) => eqLayerPlan(layer, t, bounds, descriptor.lonShift ?? 0));
  return { size, ...mercatorRows(t, bounds, size), ...bounds, layers };
}

/**
 * Draw an imagery plan.
 *
 * Shared by the tile worker and the flat maps on the page, which is the reason
 * it takes its two dependencies as arguments: `fetchImage(url)` resolves to an
 * ImageBitmap (or rejects, with whatever error the caller's own classification
 * gives), and `makeCanvas(w, h)` is an OffscreenCanvas in a worker and a canvas
 * element on the page.
 *
 * Every source is asked for at once. A layer marked optional that fails is
 * left out — that is CTX's gaps, with Viking showing through, and Kaguya's
 * blank pole rows with WAC showing through. A layer that is not optional is
 * left out only when its server says it has nothing here (a 404, a blank, a
 * picture of fill) and another layer has: "nothing here" from one map is no
 * reason to throw away another map's picture of the same ground. Any other
 * failure of it — a fault — is the tile's failure, so the tile is asked again
 * rather than settling for less.
 *
 * Each layer's part of its stack is drawn, smoothed, onto one intermediate
 * canvas spaced evenly in latitude, the later layers in their blend; then the
 * rows are moved into mercator in a single pass (see mercatorRows). Moving the
 * rows once, after blending, rather than once per layer, is also what lets a
 * blend be one draw onto the intermediate instead of a canvas of its own.
 *
 * @returns {Promise<object>} the finished canvas
 */
export async function composeEqImage(plan, fetchImage, makeCanvas) {
  const size = plan.size;
  const midH = plan.midH ?? size;
  // Settled one by one rather than with Promise.all, which rejects on the first
  // failure and drops the pictures that did arrive on the floor — bitmaps that
  // nothing then closes.
  const pending = plan.layers.map((layer) =>
    Promise.allSettled(layer.sources.map((s) => fetchImage(s.url, layer))).then((results) => {
      const failed = results.find((r) => r.status === 'rejected');
      const images = failed ? null : results.map((r) => r.value);
      // A picture of the server's fill colour is a picture of nothing, and
      // is treated exactly as a blank file is: no imagery here.
      const fill = images?.some((image) => pictureIsFill(image, makeCanvas));
      if (images && !fill) return { images };
      for (const r of results) if (r.status === 'fulfilled') r.value?.close?.();
      if (failed) return { error: failed.reason };
      const err = new Error('a picture of the map server\'s fill colour, not of the ground');
      err.noImageryHere = true;
      return { error: err };
    }));
  const mid = makeCanvas(size, midH);
  const mctx = mid.getContext('2d');
  mctx.imageSmoothingEnabled = true;
  let drawn = 0;
  try {
    for (let i = 0; i < plan.layers.length; i++) {
      const layer = plan.layers[i];
      const result = await pending[i];
      if (result.error) {
        if (result.error?.name === 'AbortError') throw result.error;
        if (layer.optional || result.error?.noImageryHere === true) continue;
        throw result.error;
      }
      // One picture that is the whole stack at its own size is drawn from
      // directly; anything else is assembled first, so two tiles meeting
      // inside the crop are smoothed across their join rather than each
      // fading out at its own edge, which leaves a hairline between them.
      const only = layer.sources.length === 1 ? result.images[0] : null;
      const direct = only && only.width === layer.stackW && only.height === layer.stackH;
      let stack = only;
      if (!direct) {
        stack = makeCanvas(layer.stackW, layer.stackH);
        const sctx = stack.getContext('2d');
        layer.sources.forEach((s, k) => sctx.drawImage(result.images[k], s.x, s.y, s.w, s.h));
      }
      // The first layer drawn is the ground whatever its blend says: a blend
      // over an empty canvas has nothing to take its colour from.
      mctx.globalCompositeOperation = drawn > 0 && layer.blend ? layer.blend : 'source-over';
      mctx.drawImage(stack, layer.sx, layer.sy, layer.sw, layer.sh, 0, 0, size, midH);
      mctx.globalCompositeOperation = 'source-over';
      for (const image of result.images) image.close?.();
      drawn++;
    }
  } catch (err) {
    // Close whatever else arrived, so a failed tile does not hold bitmaps.
    for (const p of pending) {
      p.then((r) => r.images?.forEach((b) => b.close?.()));
    }
    throw err;
  }
  if (drawn === 0) {
    const err = new Error('no layer of this source has a picture here');
    err.noImageryHere = true;
    throw err;
  }
  const out = makeCanvas(size, size);
  const octx = out.getContext('2d');
  const rowY = plan.rowY;
  for (let j = 0; j < size; j++) {
    octx.drawImage(mid, 0, rowY ? rowY[j] : j, size, 1, 0, j, size, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Elevation: ArcGIS ImageServer, raw Float32

/** Bytes in a `format=bsq&pixelType=F32` answer: the floats, then one bit each. */
export function arcgisExpectedBytes(width, height) {
  const n = width * height;
  return n * 4 + Math.ceil(n / 8);
}

/**
 * The offset that turns a stored value into a height above the body's own
 * sphere, from what the descriptor says the values are.
 *
 *   'relative'  heights above a sphere — the body's radius unless `sphere`
 *               names a different one, and then the difference is added
 *   'radius'    the distance from the centre: the radius comes off
 */
export function heightOffset(descriptor, radius) {
  if (descriptor?.heights === 'radius') return -radius;
  if (Number.isFinite(descriptor?.sphere)) return descriptor.sphere - radius;
  return 0;
}

/**
 * The box to ask for one mercator elevation tile, and how big.
 *
 * Two corrections against asking for the tile's own edges:
 *
 * The box is grown by half a pixel on every side. The server's box edges are
 * pixel edges, so 65 pixels across exactly the tile would put the first sample
 * half a pixel inside its west edge — and the neighbouring tile's last sample
 * half a pixel inside *its* east edge, a pixel apart from it. The terrain
 * expects a corner-aligned grid, the first sample on the edge and the last on
 * the other edge; grown like this, pixel centres land exactly there.
 *
 * And there are more rows than 65. The server's rows are evenly spaced in
 * latitude and the terrain's are evenly spaced in mercator, which crowds them
 * towards the pole; enough source rows are asked for that the source is never
 * coarser than the finest output row, and each output row is then interpolated
 * at its own latitude. At zoom 10 that is 65 or 66 rows; at zoom 3 near 80°
 * it is a couple of hundred.
 *
 * A box never crosses ±180, where the server fills half of it with no data —
 * a box that would is slid back inside. Sampling is by coordinate, so a slid
 * box costs half a pixel of reach at the antimeridian and nothing else.
 */
export function arcgisGridPlan(descriptor, tile, size = 65, transform = {}) {
  const n = 2 ** tile.z;
  if (tile.y < 0 || tile.y >= n) return null;
  const x = ((tile.x % n) + n) % n;
  const t = { z: tile.z, x, y: tile.y };
  const bounds = mercatorBounds(t);
  const lonSpan = bounds.east - bounds.west;
  const services = descriptor.services ?? [];
  if (services.length === 0) return null;
  const service = services.find((s) => !(s.maxSpanDeg < lonSpan)) ?? services[services.length - 1];

  const lats = rowLatitudes(t, size, true);
  let minStep = Infinity;
  for (let j = 0; j < size - 1; j++) minStep = Math.min(minStep, lats[j] - lats[j + 1]);
  const latSpan = bounds.north - bounds.south;
  const height = Math.max(size, Math.min(size * 4, Math.ceil(latSpan / minStep - 1e-6) + 1));
  const width = size;
  const dx = lonSpan / (width - 1);
  const dy = latSpan / (height - 1);

  // The request's own frame: a shifted body's tiles are drawn half a turn round.
  let lonOffset = descriptor.lonShift ?? 0;
  let west = bounds.west + lonOffset - dx / 2;
  let east = bounds.east + lonOffset + dx / 2;
  // Bring the box's middle into [-180, 180] by whole turns.
  const turn = Math.round(((west + east) / 2 - wrapLon((west + east) / 2)) / 360) * 360;
  west -= turn;
  east -= turn;
  lonOffset -= turn;
  // Then slide it off the antimeridian if the half pixel pushed it over.
  if (west < -180) { east += -180 - west; west = -180; }
  if (east > 180) { west -= east - 180; east = 180; }
  let north = bounds.north + dy / 2;
  let south = bounds.south - dy / 2;
  if (north > 90) { south -= north - 90; north = 90; }
  if (south < -90) { north += -90 - south; south = -90; }

  const bbox = [west, south, east, north].map((v) => v.toFixed(9)).join(',');
  const url = `${service.url}/exportImage?bbox=${bbox}&bboxSR=4326&size=${width},${height}`
    + '&format=bsq&pixelType=F32&adjustAspectRatio=false&interpolation=RSP_BilinearInterpolation&f=image';
  return {
    kind: 'arcgis-f32',
    url,
    tile: t,
    width,
    height,
    west,
    east,
    north,
    south,
    lonOffset,
    offset: transform.offset ?? 0,
    reach: transform.reach ?? null,
    fill: descriptor.fill ?? 'neighbours',
  };
}

/**
 * Read an ArcGIS `bsq` F32 answer: heights and which of them are real.
 *
 * The length is checked before anything else, because a transient fault comes
 * back as HTTP 200 with an HTML page saying "Error exporting image" — measured
 * once in a few hundred requests, gone on a retry — and a page of HTML read as
 * floats is a landscape of nonsense. The error is marked transient so the
 * caller retries rather than writing the square off.
 */
export function decodeArcgisF32(buffer, width, height) {
  const n = width * height;
  const expected = arcgisExpectedBytes(width, height);
  if (!buffer || buffer.byteLength !== expected) {
    const err = new Error(`elevation answer was ${buffer?.byteLength ?? 0} bytes, expected ${expected}`);
    err.transient = true;
    throw err;
  }
  const view = new DataView(buffer);
  const values = new Float32Array(n);
  const valid = new Uint8Array(n);
  const maskStart = n * 4;
  for (let i = 0; i < n; i++) {
    const v = view.getFloat32(i * 4, true);
    values[i] = v;
    const bit = (view.getUint8(maskStart + (i >> 3)) >> (7 - (i & 7))) & 1;
    // An unset bit holds -3.4e38 unless a noData value was asked for; either
    // way it is not ground, and neither is anything that is not a number.
    valid[i] = bit && Number.isFinite(v) && v > -1e30 ? 1 : 0;
  }
  return { values, valid };
}

/**
 * Turn stored values into heights above the body, in place, and decide which
 * cells are real: the datum offset, then the body's own range — a value
 * outside what the body's relief can span is a fault in the file, not a cliff.
 *
 * Earth's despike is deliberately not run. Its limits were measured on
 * Terrarium at fourteen metres a cell, and a crater rim at two hundred metres
 * a cell is a genuine step of more than its five hundred.
 */
export function applyHeightTransform(values, valid, { offset = 0, reach = null } = {}) {
  let real = 0;
  for (let i = 0; i < values.length; i++) {
    if (!valid[i]) continue;
    const h = values[i] + offset;
    values[i] = h;
    if (reach && (h < reach[0] || h > reach[1])) valid[i] = 0;
    else real++;
  }
  return real;
}

/**
 * Fill the cells that are not real, in place.
 *
 * 'neighbours' is void filling, the same way `fillImpossible` does it on
 * Earth: along the row between the nearest real cells either side, then down
 * the column, carrying the nearest real value at an edge. 'datum' puts the
 * cell at height zero — flat — which is the right answer for Pluto and Charon,
 * where the hole is half the world: filling half a world from the edge of the
 * other half would be inventing it.
 *
 * A cell with nothing real anywhere on its row or column is set to zero too.
 */
export function fillInvalid(values, valid, w, h, mode = 'neighbours') {
  const src = values.slice();
  let filled = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (valid[i]) continue;
      filled++;
      if (mode === 'datum') { values[i] = 0; continue; }
      let a = -1;
      let b = -1;
      for (let k = x - 1; k >= 0; k--) if (valid[y * w + k]) { a = k; break; }
      for (let k = x + 1; k < w; k++) if (valid[y * w + k]) { b = k; break; }
      if (a >= 0 && b >= 0) {
        const lo = src[y * w + a];
        values[i] = lo + (src[y * w + b] - lo) * ((x - a) / (b - a));
        continue;
      }
      if (a >= 0) { values[i] = src[y * w + a]; continue; }
      if (b >= 0) { values[i] = src[y * w + b]; continue; }
      let up = -1;
      let down = -1;
      for (let k = y - 1; k >= 0; k--) if (valid[k * w + x]) { up = k; break; }
      for (let k = y + 1; k < h; k++) if (valid[k * w + x]) { down = k; break; }
      if (up >= 0 && down >= 0) {
        const lo = src[up * w + x];
        values[i] = lo + (src[down * w + x] - lo) * ((y - up) / (down - up));
      } else if (up >= 0) values[i] = src[up * w + x];
      else if (down >= 0) values[i] = src[down * w + x];
      else values[i] = 0;
    }
  }
  return filled;
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

function bilinearAt(values, w, h, fx, fy) {
  const cx = Math.max(0, Math.min(w - 1, fx));
  const cy = Math.max(0, Math.min(h - 1, fy));
  const x0 = Math.min(w - 1, Math.floor(cx));
  const y0 = Math.min(h - 1, Math.floor(cy));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = cx - x0;
  const ty = cy - y0;
  const top = values[y0 * w + x0] * (1 - tx) + values[y0 * w + x1] * tx;
  const bottom = values[y1 * w + x0] * (1 - tx) + values[y1 * w + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/**
 * Sample a latitude-linear grid at the terrain's corner-aligned mercator
 * points.
 *
 * `grid` names the box the values cover — its edges are pixel edges, as the
 * server's are — and `lonOffset` takes a true longitude into the box's frame.
 */
export function sampleToMercator(values, grid, size = 65) {
  const { tile, width: w, height: h, west, east, north, south } = grid;
  const n = 2 ** tile.z;
  const lonW = (tile.x / n) * 360 - 180;
  const lonE = ((tile.x + 1) / n) * 360 - 180;
  const lats = rowLatitudes(tile, size, true);
  const out = new Float32Array(size * size);
  const pxW = (east - west) / w;
  const pxH = (north - south) / h;
  for (let j = 0; j < size; j++) {
    const fy = (north - lats[j]) / pxH - 0.5;
    for (let i = 0; i < size; i++) {
      const lon = lonW + ((lonE - lonW) * i) / (size - 1) + (grid.lonOffset ?? 0);
      const fx = (lon - west) / pxW - 0.5;
      out[j * size + i] = bilinearAt(values, w, h, fx, fy);
    }
  }
  return out;
}

/** An ArcGIS answer all the way to the terrain's 65-square grid. */
export function arcgisHeights(buffer, grid, size = 65) {
  const { values, valid } = decodeArcgisF32(buffer, grid.width, grid.height);
  applyHeightTransform(values, valid, grid);
  fillInvalid(values, valid, grid.width, grid.height, grid.fill);
  return sampleToMercator(values, grid, size);
}

// ---------------------------------------------------------------------------
// Elevation: rows straight out of a GeoTIFF

/**
 * Which rows of a GeoTIFF one mercator elevation tile needs, as byte ranges,
 * and how to turn them into the terrain's corner-aligned grid.
 *
 * One range per row, each covering the tile's columns. Where the file is finer
 * than the grid's rows — every zoom up to about 8 on Pluto, where one zoom-5
 * sample spans a dozen rows — two rows are read for each sample, a quarter and
 * three quarters of the way through the band of ground it stands for, and
 * averaged; and every sample averages the columns of its band. Where the file
 * is coarser, the two rows either side of the sample are read and
 * interpolated between.
 *
 * Not one row per sample, which is what this did first and is wrong in a way
 * that was measured. New Horizons' stereo is rough from pixel to pixel, so a
 * single pixel is a poor stand-in for the twelve-by-twelve patch of ground a
 * zoom-5 sample covers: against the true average of that patch, read whole
 * (746 rows over Sputnik Planitia), one pixel per sample was off by 134 m RMS
 * and 551 m at worst, which draws as a regular ripple over ground that is flat.
 * Averaging along the row alone halved that to 69 m; two rows as well brought
 * it to 24 m, and three to 11 — two is where the cost stops being worth it, at
 * no more than 130 reads a tile.
 *
 * Both are corner-aligned like every other grid here, and the band of a
 * sample on a tile's edge is the same band its neighbour computes for the same
 * sample, so two tiles agree exactly along the line they share.
 */
export function tiffRowsPlan(descriptor, tile, size = 65, transform = {}) {
  const n = 2 ** tile.z;
  if (tile.y < 0 || tile.y >= n) return null;
  const x = ((tile.x % n) + n) % n;
  const t = { z: tile.z, x, y: tile.y };
  const bounds = mercatorBounds(t);
  const W = descriptor.width;
  const H = descriptor.height;
  const ppdX = W / 360;
  const ppdY = H / 180;
  // Pixel-centre coordinates: column c's centre is at c.
  const colOf = (lon) => {
    let rel = (lon - descriptor.west) % 360;
    if (rel < 0) rel += 360;
    return rel * ppdX - 0.5;
  };
  // The tile's columns are measured from its own west edge, never by wrapping
  // each longitude separately. Both files' seams sit on a mercator tile edge —
  // 0°E for Pluto, ±180 for Charon — so the tile ending exactly at the seam
  // would otherwise have its last column wrap round to the far end of the file
  // and read ground half a world away.
  const fa = colOf(bounds.west);
  const fb = fa + (bounds.east - bounds.west) * ppdX;
  // Half a sample's band either side of the edges, for the edge samples' own.
  const half = (fb - fa) / (2 * (size - 1));
  const c0 = Math.max(0, Math.min(W - 1, Math.floor(fa - half)));
  const c1 = Math.max(c0, Math.min(W - 1, Math.ceil(fb + half)));

  const rows = [];
  const index = new Map();
  const want = (r) => {
    const row = Math.max(0, Math.min(H - 1, r));
    if (!index.has(row)) { index.set(row, rows.length); rows.push(row); }
    return index.get(row);
  };
  // Row-edge coordinates: row r covers [r, r + 1).
  const edgeAt = (f) => (90 - normYToLat((t.y + f) / n)) * ppdY;
  const sampleRows = [];
  for (let j = 0; j < size; j++) {
    const top = edgeAt((j - 0.5) / (size - 1));
    const bottom = edgeAt((j + 0.5) / (size - 1));
    if (bottom - top > 1) {
      // Finer than the grid: two rows from inside the band, averaged.
      sampleRows.push([
        want(Math.floor(top + (bottom - top) * 0.25)),
        want(Math.floor(top + (bottom - top) * 0.75)),
        0.5,
      ]);
    } else {
      // Coarser: the rows either side of the sample's own latitude.
      const fy = edgeAt(j / (size - 1)) - 0.5;
      const r0 = Math.floor(fy);
      sampleRows.push([want(r0), want(r0 + 1), fy - r0]);
    }
  }
  const bytes = 2;
  const ranges = rows.map((r) => {
    const start = descriptor.firstRow + (r * W + c0) * bytes;
    return [start, start + (c1 - c0 + 1) * bytes - 1];
  });
  return {
    kind: 'tiff-rows',
    url: descriptor.url,
    tile: t,
    width: W,
    c0,
    c1,
    // Pixel-centre column of the tile's west edge, and of its east edge.
    fa,
    fb,
    west: descriptor.west,
    rows,
    ranges,
    sampleRows,
    noData: descriptor.noData ?? -32768,
    offset: transform.offset ?? 0,
    reach: transform.reach ?? null,
    fill: descriptor.fill ?? 'datum',
  };
}

/**
 * The row reads back into the terrain's 65-square grid.
 *
 * @param {ArrayBuffer[]} buffers one per `plan.ranges`, in order, each exactly
 *   the length asked for
 */
export function tiffRowsHeights(buffers, plan, size = 65) {
  const cols = plan.c1 - plan.c0 + 1;
  const rowsN = plan.rows.length;
  if (!Array.isArray(buffers) || buffers.length !== rowsN) throw new Error('row reads missing');
  const values = new Float32Array(rowsN * cols);
  const valid = new Uint8Array(rowsN * cols);
  const hole = new Uint8Array(rowsN * cols);
  for (let r = 0; r < rowsN; r++) {
    const buf = buffers[r];
    if (!buf || buf.byteLength !== cols * 2) {
      const err = new Error(`row read was ${buf?.byteLength ?? 0} bytes, expected ${cols * 2}`);
      err.transient = true;
      throw err;
    }
    const view = new DataView(buf);
    for (let c = 0; c < cols; c++) {
      const v = view.getInt16(c * 2, true);
      const k = r * cols + c;
      values[k] = v;
      hole[k] = v === plan.noData ? 1 : 0;
      valid[k] = 1 - hole[k];
    }
  }
  applyHeightTransform(values, valid, plan);
  // A hole — no data in the file — goes to the datum. The rows read here are
  // not neighbours of each other — a coarse tile reads a couple of rows in
  // every dozen — so there is no ground above or below a hole to fill it
  // from, and the holes in these two maps are half a world wide anyway.
  // A value out of the body's reach is another matter: it stands in real
  // ground, so it takes its height from the real cells beside it on its row.
  // Sent to the datum it was a 0 m needle in a crater, or a pit in a peak —
  // fourteen kilometres of each on Charon.
  fillRowRejects(values, valid, hole, cols, rowsN);

  // Each output column's band of source columns, in pixel-centre coordinates.
  const span = plan.fb - plan.fa;
  const step = span / (size - 1);
  const lo = new Int32Array(size);
  const hi = new Int32Array(size);
  const fx = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const at = plan.fa + step * i - plan.c0;
    fx[i] = Math.max(0, Math.min(cols - 1, at));
    if (step > 1) {
      // Every pixel whose centre is inside the band.
      lo[i] = Math.max(0, Math.ceil(at - step / 2));
      hi[i] = Math.min(cols - 1, Math.floor(at + step / 2));
      if (hi[i] < lo[i]) lo[i] = hi[i] = Math.round(fx[i]);
    } else {
      lo[i] = -1;
    }
  }
  const across = (k, i) => {
    const base = k * cols;
    if (lo[i] >= 0) {
      let sum = 0;
      for (let c = lo[i]; c <= hi[i]; c++) sum += values[base + c];
      return sum / (hi[i] - lo[i] + 1);
    }
    const x0 = Math.min(cols - 1, Math.floor(fx[i]));
    const x1 = Math.min(cols - 1, x0 + 1);
    const tx = fx[i] - x0;
    return values[base + x0] * (1 - tx) + values[base + x1] * tx;
  };
  const out = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    const [ka, kb, t] = plan.sampleRows[j];
    for (let i = 0; i < size; i++) {
      const a = across(ka, i);
      const b = ka === kb ? a : across(kb, i);
      out[j * size + i] = a + (b - a) * t;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetching, shared by the tile worker and the flat maps

/**
 * How long to wait before asking again after a fault, and how many times.
 *
 * Measured faults, all of them gone on a second request: an ArcGIS export that
 * came back as HTTP 200 and an HTML page reading "Error exporting image" (one
 * in a few hundred), a 502 from the proxy in front of Trek, and a dropped
 * connection. Two retries, the second a little later than the first, cover
 * every one seen; anything still failing after that is reported as transient
 * and the queue behind this retries the square in its own time.
 */
export const RETRY_DELAYS_MS = [400, 1500];

function abortError() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

/** A pause that ends early, with an AbortError, when the job is cancelled. */
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/**
 * Run `attempt` again after a pause while it fails with a transient fault.
 * A refusal ("not here") or a cancellation is final at once.
 */
export async function withRetries(attempt, signal, delays = RETRY_DELAYS_MS) {
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (err?.name === 'AbortError' || err?.transient !== true || i >= delays.length) throw err;
      await pause(delays[i], signal);
    }
  }
}

/**
 * The same two categories the tile worker uses everywhere: a server saying it
 * has nothing for this square, and a server or network having a moment.
 */
export function refusal(status) {
  const err = new Error(`HTTP ${status}`);
  err.status = status;
  if (status === 404 || status === 204 || status === 410) err.noImageryHere = true;
  else err.transient = status === 408 || status === 429 || status >= 500;
  return err;
}

/** fetch, with a transport failure marked transient and a refusal classified. */
async function request(url, signal, headers) {
  let res;
  try {
    res = await fetch(url, {
      signal,
      mode: 'cors',
      credentials: 'omit',
      ...(headers ? { headers } : {}),
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const wrapped = new Error(String(err?.message ?? err));
    wrapped.transient = true;
    throw wrapped;
  }
  if (!res.ok) throw refusal(res.status);
  return res;
}

/**
 * One source picture for a plan, decoded.
 *
 * Three checks before it is believed, each for something measured: the map
 * server answers a box it cannot draw with HTTP 200 and an XML document; a
 * proxy in front of a server answers with an HTML page; and Kaguya answers the
 * pole rows it never photographed with a 206-byte blank. The first two are not
 * pictures, and the third is a picture of nothing — "no imagery here", which
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
    }
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    const buffer = await res.arrayBuffer();
    if (type && !type.startsWith('image/')) {
      const err = new Error(`answered ${type.split(';')[0]} instead of a picture`);
      // A gateway's error page passes; a service exception for this box does not.
      err.transient = type.includes('html');
      throw err;
    }
    if (buffer.byteLength < BLANK_TILE_BYTES) {
      const err = new Error(`a ${buffer.byteLength}-byte blank, not a picture`);
      err.noImageryHere = true;
      throw err;
    }
    try {
      return await createImageBitmap(new Blob([buffer]));
    } catch (cause) {
      // A picture that will not decode after a 200 and the right content
      // type is nearly always one cut short in transit: seen once in a few
      // hundred CTX tiles, and the same tile decoded on the next request.
      const err = new Error(String(cause?.message ?? cause));
      err.transient = true;
      throw err;
    }
  }, signal);
}

/**
 * Turn a composed canvas into something that can be handed on: an
 * ImageBitmap, without a copy where the canvas can give one up.
 */
export async function canvasToBitmap(canvas) {
  if (typeof canvas.transferToImageBitmap === 'function') return canvas.transferToImageBitmap();
  return createImageBitmap(canvas);
}

/** One ArcGIS export, all the way to the terrain's grid. */
export async function fetchArcgisHeights(grid, size, signal) {
  return withRetries(async () => {
    const res = await request(grid.url, signal);
    // decodeArcgisF32 checks the length first and calls a wrong one
    // transient, which is how an HTML error page gets a second chance.
    return arcgisHeights(await res.arrayBuffer(), grid, size);
  }, signal);
}

/**
 * How many row reads one tile has in the air at once.
 *
 * S3 speaks HTTP/1.1, so the browser opens six connections to it and queues
 * the rest; a tile is up to 65 reads and the elevation queue runs four tiles,
 * and with no cap here one tile's reads would sit in front of every other's.
 */
const ROW_READS_AT_ONCE = 12;

async function fetchRange(url, start, end, signal) {
  return withRetries(async () => {
    const res = await request(url, signal, { Range: `bytes=${start}-${end}` });
    // A server that ignores the range answers 200 with the whole file — six
    // hundred megabytes for Pluto. Never read that body.
    if (res.status !== 206) {
      try { await res.body?.cancel?.(); } catch { /* already closed */ }
      const err = new Error(`range read answered ${res.status}, not 206`);
      err.transient = true;
      throw err;
    }
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength !== end - start + 1) {
      const err = new Error(`range read was ${buffer.byteLength} bytes, expected ${end - start + 1}`);
      err.transient = true;
      throw err;
    }
    return buffer;
  }, signal);
}

/**
 * Every row a tile needs, then the grid.
 *
 * The reads share a controller tied to the job's, so the first one that fails
 * for good stops the rest instead of letting them finish for nothing.
 */
export async function fetchTiffRowsHeights(plan, size, signal) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (signal?.aborted) throw abortError();
  signal?.addEventListener?.('abort', stop, { once: true });
  const buffers = new Array(plan.ranges.length);
  let next = 0;
  const worker = async () => {
    while (next < plan.ranges.length) {
      const k = next++;
      const [start, end] = plan.ranges[k];
      buffers[k] = await fetchRange(plan.url, start, end, controller.signal);
    }
  };
  try {
    const lanes = Math.min(ROW_READS_AT_ONCE, plan.ranges.length);
    await Promise.all(Array.from({ length: lanes }, worker));
  } catch (err) {
    controller.abort();
    // The job's own cancellation is reported as a cancellation, whichever
    // read happened to notice it first.
    if (signal?.aborted) throw abortError();
    throw err;
  } finally {
    signal?.removeEventListener?.('abort', stop);
  }
  return tiffRowsHeights(buffers, plan, size);
}

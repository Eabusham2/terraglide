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
@@MISSING 261@@
@@MISSING 262@@
@@MISSING 263@@
@@MISSING 264@@
@@MISSING 265@@
@@MISSING 266@@
@@MISSING 267@@
@@MISSING 268@@
@@MISSING 269@@
@@MISSING 270@@
@@MISSING 271@@
@@MISSING 272@@
@@MISSING 273@@
@@MISSING 274@@
@@MISSING 275@@
@@MISSING 276@@
@@MISSING 277@@
@@MISSING 278@@
@@MISSING 279@@
@@MISSING 280@@
@@MISSING 281@@
@@MISSING 282@@
@@MISSING 283@@
@@MISSING 284@@
@@MISSING 285@@
@@MISSING 286@@
@@MISSING 287@@
@@MISSING 288@@
@@MISSING 289@@
@@MISSING 290@@
@@MISSING 291@@
@@MISSING 292@@
@@MISSING 293@@
@@MISSING 294@@
@@MISSING 295@@
@@MISSING 296@@
@@MISSING 297@@
@@MISSING 298@@
@@MISSING 299@@
@@MISSING 300@@
@@MISSING 301@@
@@MISSING 302@@
@@MISSING 303@@
@@MISSING 304@@
@@MISSING 305@@
@@MISSING 306@@
@@MISSING 307@@
@@MISSING 308@@
@@MISSING 309@@
@@MISSING 310@@
@@MISSING 311@@
@@MISSING 312@@
@@MISSING 313@@
@@MISSING 314@@
@@MISSING 315@@
@@MISSING 316@@
@@MISSING 317@@
@@MISSING 318@@
@@MISSING 319@@
@@MISSING 320@@
@@MISSING 321@@
@@MISSING 322@@
@@MISSING 323@@
@@MISSING 324@@
@@MISSING 325@@
@@MISSING 326@@
@@MISSING 327@@
@@MISSING 328@@
@@MISSING 329@@
@@MISSING 330@@
@@MISSING 331@@
@@MISSING 332@@
@@MISSING 333@@
@@MISSING 334@@
@@MISSING 335@@
@@MISSING 336@@
@@MISSING 337@@
@@MISSING 338@@
@@MISSING 339@@
@@MISSING 340@@
@@MISSING 341@@
@@MISSING 342@@
@@MISSING 343@@
@@MISSING 344@@
@@MISSING 345@@
@@MISSING 346@@
@@MISSING 347@@
@@MISSING 348@@
@@MISSING 349@@
@@MISSING 350@@
@@MISSING 351@@
@@MISSING 352@@
@@MISSING 353@@
@@MISSING 354@@
@@MISSING 355@@
@@MISSING 356@@
@@MISSING 357@@
@@MISSING 358@@
@@MISSING 359@@
@@MISSING 360@@
@@MISSING 361@@
@@MISSING 362@@
@@MISSING 363@@
@@MISSING 364@@
@@MISSING 365@@
@@MISSING 366@@
@@MISSING 367@@
@@MISSING 368@@
@@MISSING 369@@
@@MISSING 370@@
@@MISSING 371@@
@@MISSING 372@@
@@MISSING 373@@
@@MISSING 374@@
@@MISSING 375@@
@@MISSING 376@@
@@MISSING 377@@
@@MISSING 378@@
@@MISSING 379@@
@@MISSING 380@@
@@MISSING 381@@
@@MISSING 382@@
@@MISSING 383@@
@@MISSING 384@@
@@MISSING 385@@
@@MISSING 386@@
@@MISSING 387@@
@@MISSING 388@@
@@MISSING 389@@
@@MISSING 390@@
@@MISSING 391@@
@@MISSING 392@@
@@MISSING 393@@
@@MISSING 394@@
@@MISSING 395@@
@@MISSING 396@@
@@MISSING 397@@
@@MISSING 398@@
@@MISSING 399@@
@@MISSING 400@@
@@MISSING 401@@
@@MISSING 402@@
@@MISSING 403@@
@@MISSING 404@@
@@MISSING 405@@
@@MISSING 406@@
@@MISSING 407@@
@@MISSING 408@@
@@MISSING 409@@
@@MISSING 410@@
@@MISSING 411@@
@@MISSING 412@@
@@MISSING 413@@
@@MISSING 414@@
@@MISSING 415@@
@@MISSING 416@@
@@MISSING 417@@
@@MISSING 418@@
@@MISSING 419@@
@@MISSING 420@@
@@MISSING 421@@
@@MISSING 422@@
@@MISSING 423@@
@@MISSING 424@@
@@MISSING 425@@
@@MISSING 426@@
@@MISSING 427@@
@@MISSING 428@@
@@MISSING 429@@
@@MISSING 430@@
@@MISSING 431@@
@@MISSING 432@@
@@MISSING 433@@
@@MISSING 434@@
@@MISSING 435@@
@@MISSING 436@@
@@MISSING 437@@
@@MISSING 438@@
@@MISSING 439@@
@@MISSING 440@@
@@MISSING 441@@
@@MISSING 442@@
@@MISSING 443@@
@@MISSING 444@@
@@MISSING 445@@
@@MISSING 446@@
@@MISSING 447@@
@@MISSING 448@@
@@MISSING 449@@
@@MISSING 450@@
@@MISSING 451@@
@@MISSING 452@@
@@MISSING 453@@
@@MISSING 454@@
@@MISSING 455@@
@@MISSING 456@@
@@MISSING 457@@
@@MISSING 458@@
@@MISSING 459@@
@@MISSING 460@@
@@MISSING 461@@
@@MISSING 462@@
@@MISSING 463@@
@@MISSING 464@@
@@MISSING 465@@
@@MISSING 466@@
@@MISSING 467@@
@@MISSING 468@@
@@MISSING 469@@
@@MISSING 470@@
@@MISSING 471@@
@@MISSING 472@@
@@MISSING 473@@
@@MISSING 474@@
@@MISSING 475@@
@@MISSING 476@@
@@MISSING 477@@
@@MISSING 478@@
@@MISSING 479@@
@@MISSING 480@@
@@MISSING 481@@
@@MISSING 482@@
@@MISSING 483@@
@@MISSING 484@@
@@MISSING 485@@
@@MISSING 486@@
@@MISSING 487@@
@@MISSING 488@@
@@MISSING 489@@
@@MISSING 490@@
@@MISSING 491@@
@@MISSING 492@@
@@MISSING 493@@
@@MISSING 494@@
@@MISSING 495@@
@@MISSING 496@@
@@MISSING 497@@
@@MISSING 498@@
@@MISSING 499@@
@@MISSING 500@@
@@MISSING 501@@
@@MISSING 502@@
@@MISSING 503@@
@@MISSING 504@@
@@MISSING 505@@
@@MISSING 506@@
@@MISSING 507@@
@@MISSING 508@@
@@MISSING 509@@
@@MISSING 510@@
@@MISSING 511@@
@@MISSING 512@@
@@MISSING 513@@
@@MISSING 514@@
@@MISSING 515@@
@@MISSING 516@@
@@MISSING 517@@
@@MISSING 518@@
@@MISSING 519@@
@@MISSING 520@@
@@MISSING 521@@
@@MISSING 522@@
@@MISSING 523@@
@@MISSING 524@@
@@MISSING 525@@
@@MISSING 526@@
@@MISSING 527@@
@@MISSING 528@@
@@MISSING 529@@
@@MISSING 530@@
@@MISSING 531@@
@@MISSING 532@@
@@MISSING 533@@
@@MISSING 534@@
@@MISSING 535@@
@@MISSING 536@@
@@MISSING 537@@
@@MISSING 538@@
@@MISSING 539@@
@@MISSING 540@@
@@MISSING 541@@
@@MISSING 542@@
@@MISSING 543@@
@@MISSING 544@@
@@MISSING 545@@
@@MISSING 546@@
@@MISSING 547@@
@@MISSING 548@@
@@MISSING 549@@
@@MISSING 550@@
@@MISSING 551@@
@@MISSING 552@@
@@MISSING 553@@
@@MISSING 554@@
@@MISSING 555@@
@@MISSING 556@@
@@MISSING 557@@
@@MISSING 558@@
@@MISSING 559@@
@@MISSING 560@@
@@MISSING 561@@
@@MISSING 562@@
@@MISSING 563@@
@@MISSING 564@@
@@MISSING 565@@
@@MISSING 566@@
@@MISSING 567@@
@@MISSING 568@@
@@MISSING 569@@
@@MISSING 570@@
@@MISSING 571@@
@@MISSING 572@@
@@MISSING 573@@
@@MISSING 574@@
@@MISSING 575@@
@@MISSING 576@@
@@MISSING 577@@
@@MISSING 578@@
@@MISSING 579@@
@@MISSING 580@@
@@MISSING 581@@
@@MISSING 582@@
@@MISSING 583@@
@@MISSING 584@@
@@MISSING 585@@
@@MISSING 586@@
@@MISSING 587@@
@@MISSING 588@@
@@MISSING 589@@
@@MISSING 590@@
@@MISSING 591@@
@@MISSING 592@@
@@MISSING 593@@
@@MISSING 594@@
@@MISSING 595@@
@@MISSING 596@@
@@MISSING 597@@
@@MISSING 598@@
@@MISSING 599@@
@@MISSING 600@@
@@MISSING 601@@
@@MISSING 602@@
@@MISSING 603@@
@@MISSING 604@@
@@MISSING 605@@
@@MISSING 606@@
@@MISSING 607@@
@@MISSING 608@@
@@MISSING 609@@
@@MISSING 610@@
@@MISSING 611@@
@@MISSING 612@@
@@MISSING 613@@
@@MISSING 614@@
@@MISSING 615@@
@@MISSING 616@@
@@MISSING 617@@
@@MISSING 618@@
@@MISSING 619@@
@@MISSING 620@@
@@MISSING 621@@
@@MISSING 622@@
@@MISSING 623@@
@@MISSING 624@@
@@MISSING 625@@
@@MISSING 626@@
@@MISSING 627@@
@@MISSING 628@@
@@MISSING 629@@
@@MISSING 630@@
@@MISSING 631@@
@@MISSING 632@@
@@MISSING 633@@
@@MISSING 634@@
@@MISSING 635@@
@@MISSING 636@@
@@MISSING 637@@
@@MISSING 638@@
@@MISSING 639@@
@@MISSING 640@@
@@MISSING 641@@
@@MISSING 642@@
@@MISSING 643@@
@@MISSING 644@@
@@MISSING 645@@
@@MISSING 646@@
@@MISSING 647@@
@@MISSING 648@@
@@MISSING 649@@
@@MISSING 650@@
@@MISSING 651@@
@@MISSING 652@@
@@MISSING 653@@
@@MISSING 654@@
@@MISSING 655@@
@@MISSING 656@@
@@MISSING 657@@
@@MISSING 658@@
@@MISSING 659@@
@@MISSING 660@@
@@MISSING 661@@
@@MISSING 662@@
@@MISSING 663@@
@@MISSING 664@@
@@MISSING 665@@
@@MISSING 666@@
@@MISSING 667@@
@@MISSING 668@@
@@MISSING 669@@
@@MISSING 670@@
@@MISSING 671@@
@@MISSING 672@@
@@MISSING 673@@
@@MISSING 674@@
@@MISSING 675@@
@@MISSING 676@@
@@MISSING 677@@
@@MISSING 678@@
@@MISSING 679@@
@@MISSING 680@@
@@MISSING 681@@
@@MISSING 682@@
@@MISSING 683@@
@@MISSING 684@@
@@MISSING 685@@
@@MISSING 686@@
@@MISSING 687@@
@@MISSING 688@@
@@MISSING 689@@
@@MISSING 690@@
@@MISSING 691@@
@@MISSING 692@@
@@MISSING 693@@
@@MISSING 694@@
@@MISSING 695@@
@@MISSING 696@@
@@MISSING 697@@
@@MISSING 698@@
@@MISSING 699@@
@@MISSING 700@@
@@MISSING 701@@
@@MISSING 702@@
@@MISSING 703@@
@@MISSING 704@@
@@MISSING 705@@
@@MISSING 706@@
@@MISSING 707@@
@@MISSING 708@@
@@MISSING 709@@
@@MISSING 710@@
@@MISSING 711@@
@@MISSING 712@@
@@MISSING 713@@
@@MISSING 714@@
@@MISSING 715@@
@@MISSING 716@@
@@MISSING 717@@
@@MISSING 718@@
@@MISSING 719@@
@@MISSING 720@@
@@MISSING 721@@
@@MISSING 722@@
@@MISSING 723@@
@@MISSING 724@@
@@MISSING 725@@
@@MISSING 726@@
@@MISSING 727@@
@@MISSING 728@@
@@MISSING 729@@
@@MISSING 730@@
@@MISSING 731@@
@@MISSING 732@@
@@MISSING 733@@
@@MISSING 734@@
@@MISSING 735@@
@@MISSING 736@@
@@MISSING 737@@
@@MISSING 738@@
@@MISSING 739@@
@@MISSING 740@@
@@MISSING 741@@
@@MISSING 742@@
@@MISSING 743@@
@@MISSING 744@@
@@MISSING 745@@
@@MISSING 746@@
@@MISSING 747@@
@@MISSING 748@@
@@MISSING 749@@
@@MISSING 750@@
@@MISSING 751@@
@@MISSING 752@@
@@MISSING 753@@
@@MISSING 754@@
@@MISSING 755@@
@@MISSING 756@@
@@MISSING 757@@
@@MISSING 758@@
@@MISSING 759@@
@@MISSING 760@@
@@MISSING 761@@
@@MISSING 762@@
@@MISSING 763@@
@@MISSING 764@@
@@MISSING 765@@
@@MISSING 766@@
@@MISSING 767@@
@@MISSING 768@@
@@MISSING 769@@
@@MISSING 770@@
@@MISSING 771@@
@@MISSING 772@@
@@MISSING 773@@
@@MISSING 774@@
@@MISSING 775@@
@@MISSING 776@@
@@MISSING 777@@
@@MISSING 778@@
@@MISSING 779@@
@@MISSING 780@@
@@MISSING 781@@
@@MISSING 782@@
@@MISSING 783@@
@@MISSING 784@@
@@MISSING 785@@
@@MISSING 786@@
@@MISSING 787@@
@@MISSING 788@@
@@MISSING 789@@
@@MISSING 790@@
@@MISSING 791@@
@@MISSING 792@@
@@MISSING 793@@
@@MISSING 794@@
@@MISSING 795@@
@@MISSING 796@@
@@MISSING 797@@
@@MISSING 798@@
@@MISSING 799@@
@@MISSING 800@@
@@MISSING 801@@
@@MISSING 802@@
@@MISSING 803@@
@@MISSING 804@@
@@MISSING 805@@
@@MISSING 806@@
@@MISSING 807@@
@@MISSING 808@@
@@MISSING 809@@
@@MISSING 810@@
@@MISSING 811@@
@@MISSING 812@@
@@MISSING 813@@
@@MISSING 814@@
@@MISSING 815@@
@@MISSING 816@@
@@MISSING 817@@
@@MISSING 818@@
@@MISSING 819@@
@@MISSING 820@@
@@MISSING 821@@
@@MISSING 822@@
@@MISSING 823@@
@@MISSING 824@@
@@MISSING 825@@
@@MISSING 826@@
@@MISSING 827@@
@@MISSING 828@@
@@MISSING 829@@
@@MISSING 830@@
@@MISSING 831@@
@@MISSING 832@@
@@MISSING 833@@
@@MISSING 834@@
@@MISSING 835@@
@@MISSING 836@@
@@MISSING 837@@
@@MISSING 838@@
@@MISSING 839@@
@@MISSING 840@@
@@MISSING 841@@
@@MISSING 842@@
@@MISSING 843@@
@@MISSING 844@@
@@MISSING 845@@
@@MISSING 846@@
@@MISSING 847@@
@@MISSING 848@@
@@MISSING 849@@
@@MISSING 850@@
@@MISSING 851@@
@@MISSING 852@@
@@MISSING 853@@
@@MISSING 854@@
@@MISSING 855@@
@@MISSING 856@@
@@MISSING 857@@
@@MISSING 858@@
@@MISSING 859@@
@@MISSING 860@@
@@MISSING 861@@
@@MISSING 862@@
@@MISSING 863@@
@@MISSING 864@@
@@MISSING 865@@
@@MISSING 866@@
@@MISSING 867@@
@@MISSING 868@@
@@MISSING 869@@
@@MISSING 870@@
@@MISSING 871@@
@@MISSING 872@@
@@MISSING 873@@
@@MISSING 874@@
@@MISSING 875@@
@@MISSING 876@@
@@MISSING 877@@
@@MISSING 878@@
@@MISSING 879@@
@@MISSING 880@@
@@MISSING 881@@
@@MISSING 882@@
@@MISSING 883@@
@@MISSING 884@@
@@MISSING 885@@
@@MISSING 886@@
@@MISSING 887@@
@@MISSING 888@@
@@MISSING 889@@
@@MISSING 890@@
@@MISSING 891@@
@@MISSING 892@@
@@MISSING 893@@
@@MISSING 894@@
@@MISSING 895@@
@@MISSING 896@@
@@MISSING 897@@
@@MISSING 898@@
@@MISSING 899@@
@@MISSING 900@@
@@MISSING 901@@
@@MISSING 902@@
@@MISSING 903@@
@@MISSING 904@@
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
@@MISSING 999@@
@@MISSING 1000@@
@@MISSING 1001@@
@@MISSING 1002@@
@@MISSING 1003@@
@@MISSING 1004@@
@@MISSING 1005@@
@@MISSING 1006@@
@@MISSING 1007@@
@@MISSING 1008@@
@@MISSING 1009@@
@@MISSING 1010@@
@@MISSING 1011@@
@@MISSING 1012@@
@@MISSING 1013@@
@@MISSING 1014@@
@@MISSING 1015@@
@@MISSING 1016@@
@@MISSING 1017@@
@@MISSING 1018@@
@@MISSING 1019@@
@@MISSING 1020@@
@@MISSING 1021@@
@@MISSING 1022@@
@@MISSING 1023@@
@@MISSING 1024@@
@@MISSING 1025@@
@@MISSING 1026@@
@@MISSING 1027@@
@@MISSING 1028@@
@@MISSING 1029@@
@@MISSING 1030@@
@@MISSING 1031@@
@@MISSING 1032@@
@@MISSING 1033@@
@@MISSING 1034@@
@@MISSING 1035@@
@@MISSING 1036@@
@@MISSING 1037@@
@@MISSING 1038@@
@@MISSING 1039@@
@@MISSING 1040@@
@@MISSING 1041@@
@@MISSING 1042@@
@@MISSING 1043@@
@@MISSING 1044@@
@@MISSING 1045@@
@@MISSING 1046@@
@@MISSING 1047@@
@@MISSING 1048@@
@@MISSING 1049@@
@@MISSING 1050@@
@@MISSING 1051@@
@@MISSING 1052@@
@@MISSING 1053@@
@@MISSING 1054@@
@@MISSING 1055@@
@@MISSING 1056@@
@@MISSING 1057@@
@@MISSING 1058@@
@@MISSING 1059@@
@@MISSING 1060@@
@@MISSING 1061@@
@@MISSING 1062@@
@@MISSING 1063@@
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
    Promise.allSettled(layer.sources.map((s) => fetchImage(s.url))).then((results) => {
      const failed = results.find((r) => r.status === 'rejected');
      const images = failed ? null : results.map((r) => r.value);
      // A picture of the server's fill colour is a picture of nothing, and
      // is treated exactly as a blank file is: no imagery here.
      const fill = images?.some((image) => pictureIsFill(image, makeCanvas));
      if (images && !fill) return { images };
      for (const r of results) if (r.status === 'fulfilled') r.value?.close?.();
      if (failed) return { error: failed.reason };
      const err = new Error('a picture of the map server’s fill colour, not of the ground');
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
@@MISSING 1422@@
@@MISSING 1423@@
@@MISSING 1424@@
@@MISSING 1425@@
@@MISSING 1426@@
@@MISSING 1427@@
@@MISSING 1428@@
@@MISSING 1429@@
@@MISSING 1430@@
@@MISSING 1431@@
@@MISSING 1432@@
@@MISSING 1433@@
@@MISSING 1434@@
@@MISSING 1435@@
@@MISSING 1436@@
@@MISSING 1437@@
@@MISSING 1438@@
@@MISSING 1439@@
@@MISSING 1440@@
@@MISSING 1441@@
@@MISSING 1442@@
@@MISSING 1443@@
@@MISSING 1444@@
@@MISSING 1445@@
@@MISSING 1446@@
@@MISSING 1447@@
@@MISSING 1448@@
@@MISSING 1449@@
@@MISSING 1450@@
@@MISSING 1451@@
@@MISSING 1452@@
@@MISSING 1453@@
@@MISSING 1454@@
@@MISSING 1455@@
@@MISSING 1456@@
@@MISSING 1457@@
@@MISSING 1458@@
@@MISSING 1459@@
@@MISSING 1460@@
@@MISSING 1461@@
function fillRowRejects(values, valid, hole, w, h) {
@@MISSING 1463@@
@@MISSING 1464@@
@@MISSING 1465@@
@@MISSING 1466@@
@@MISSING 1467@@
@@MISSING 1468@@
@@MISSING 1469@@
@@MISSING 1470@@
@@MISSING 1471@@
@@MISSING 1472@@
@@MISSING 1473@@
@@MISSING 1474@@
@@MISSING 1475@@
@@MISSING 1476@@
@@MISSING 1477@@
@@MISSING 1478@@
@@MISSING 1479@@
@@MISSING 1480@@
@@MISSING 1481@@
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
@@MISSING 1648@@
@@MISSING 1649@@
@@MISSING 1650@@
@@MISSING 1651@@
@@MISSING 1652@@
@@MISSING 1653@@
@@MISSING 1654@@
@@MISSING 1655@@
@@MISSING 1656@@
@@MISSING 1657@@
@@MISSING 1658@@
@@MISSING 1659@@
@@MISSING 1660@@
@@MISSING 1661@@
@@MISSING 1662@@
@@MISSING 1663@@
@@MISSING 1664@@
@@MISSING 1665@@
@@MISSING 1666@@
@@MISSING 1667@@
@@MISSING 1668@@
@@MISSING 1669@@
@@MISSING 1670@@
@@MISSING 1671@@
@@MISSING 1672@@
@@MISSING 1673@@
@@MISSING 1674@@
@@MISSING 1675@@
@@MISSING 1676@@
@@MISSING 1677@@
@@MISSING 1678@@
@@MISSING 1679@@
@@MISSING 1680@@
@@MISSING 1681@@
@@MISSING 1682@@
@@MISSING 1683@@
@@MISSING 1684@@
@@MISSING 1685@@
@@MISSING 1686@@
@@MISSING 1687@@
@@MISSING 1688@@
@@MISSING 1689@@
@@MISSING 1690@@
@@MISSING 1691@@
@@MISSING 1692@@
@@MISSING 1693@@
@@MISSING 1694@@
@@MISSING 1695@@
@@MISSING 1696@@
@@MISSING 1697@@
@@MISSING 1698@@
@@MISSING 1699@@
@@MISSING 1700@@
@@MISSING 1701@@
@@MISSING 1702@@
@@MISSING 1703@@
@@MISSING 1704@@
@@MISSING 1705@@
@@MISSING 1706@@
@@MISSING 1707@@
@@MISSING 1708@@
@@MISSING 1709@@
@@MISSING 1710@@
@@MISSING 1711@@
@@MISSING 1712@@
@@MISSING 1713@@
@@MISSING 1714@@
@@MISSING 1715@@
@@MISSING 1716@@
@@MISSING 1717@@
@@MISSING 1718@@
@@MISSING 1719@@
@@MISSING 1720@@
@@MISSING 1721@@
@@MISSING 1722@@
@@MISSING 1723@@
@@MISSING 1724@@
@@MISSING 1725@@
@@MISSING 1726@@
@@MISSING 1727@@
@@MISSING 1728@@
@@MISSING 1729@@
@@MISSING 1730@@
@@MISSING 1731@@
@@MISSING 1732@@
@@MISSING 1733@@
@@MISSING 1734@@
@@MISSING 1735@@
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
@@MISSING 1792@@
@@MISSING 1793@@
@@MISSING 1794@@
@@MISSING 1795@@
@@MISSING 1796@@
@@MISSING 1797@@
@@MISSING 1798@@
@@MISSING 1799@@
@@MISSING 1800@@
@@MISSING 1801@@
@@MISSING 1802@@
@@MISSING 1803@@
@@MISSING 1804@@
@@MISSING 1805@@
@@MISSING 1806@@
@@MISSING 1807@@
@@MISSING 1808@@
@@MISSING 1809@@
@@MISSING 1810@@
@@MISSING 1811@@
@@MISSING 1812@@
@@MISSING 1813@@
@@MISSING 1814@@
@@MISSING 1815@@
@@MISSING 1816@@
@@MISSING 1817@@
@@MISSING 1818@@
@@MISSING 1819@@
@@MISSING 1820@@
export async function fetchPlanetaryImage(url, signal, layer = {}) {
@@MISSING 1822@@
@@MISSING 1823@@
@@MISSING 1824@@
@@MISSING 1825@@
@@MISSING 1826@@
@@MISSING 1827@@
@@MISSING 1828@@
@@MISSING 1829@@
@@MISSING 1830@@
@@MISSING 1831@@
@@MISSING 1832@@
@@MISSING 1833@@
@@MISSING 1834@@
@@MISSING 1835@@
@@MISSING 1836@@
@@MISSING 1837@@
@@MISSING 1838@@
@@MISSING 1839@@
@@MISSING 1840@@
@@MISSING 1841@@
@@MISSING 1842@@
@@MISSING 1843@@
@@MISSING 1844@@
@@MISSING 1845@@
@@MISSING 1846@@
@@MISSING 1847@@
@@MISSING 1848@@
@@MISSING 1849@@
@@MISSING 1850@@
@@MISSING 1851@@
@@MISSING 1852@@
@@MISSING 1853@@
@@MISSING 1854@@
@@MISSING 1855@@
@@MISSING 1856@@
@@MISSING 1857@@
@@MISSING 1858@@
@@MISSING 1859@@
@@MISSING 1860@@
@@MISSING 1861@@
@@MISSING 1862@@
@@MISSING 1863@@
@@MISSING 1864@@
@@MISSING 1865@@
@@MISSING 1866@@
@@MISSING 1867@@
@@MISSING 1868@@
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

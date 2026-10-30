import { WORLD_CIRCUMFERENCE, latToNormY, lonToNormX, wrapTileX } from '../geo/mercator.js';
import { LEVELS } from './exploration.js';

/**
 * Shared 2D map painter for the minimap and the world map.
 *
 * Two layers, and which one you see depends on where you have been. Ground you
 * have actually laid eyes on shows the aerial photograph. Ground you have not
 * shows a drawn street map — roads, coastlines and names, no photography. That
 * is the fog: not a grey wash over the world, but the difference between having
 * seen somewhere and only knowing it is there.
 *
 * The boundary is not the square you are standing in. `exploration` records
 * what you could see from where you were — the geometric horizon at your height
 * — so flying high over a coastline uncovers a broad circle and walking a
 * valley uncovers a narrow one. The edge is then softened by a blur about half
 * a cell wide, because the record is on a grid and the thing it is recording is
 * not.
 *
 * An earlier version fetched and drew the street half as vector tiles at
 * whatever zoom the map happened to be at, which put road casings and labels
 * sized for a street across whole counties. It is Esri's raster street basemap
 * first now, drawn through the same cache as the photographs, so both halves are
 * pictures of the world made for the zoom they are shown at.
 *
 * Trails are hairlines, waypoints are small squares, and the whole thing is
 * deliberately flat: no glow, no gradients, nothing that competes with the
 * imagery underneath.
 */

/**
 * What a square of the drawn map looks like before it has arrived.
 *
 * The paper colour of the street map itself, not the near-black the photograph
 * layer uses. A half-loaded map should read as a map still drawing, which is
 * what blank paper looks like; the dark fill made it read as a hole punched
 * through the world.
 */
const STREET_BLANK = '#eceae3';

/**
 * How far the fog edge is feathered, as a fraction of one exploration cell.
 * Half a cell: enough that the grid the record is kept on stops being legible,
 * not so much that the shape you actually flew is lost.
 */
const FOG_FEATHER = 0.45;

/**
 * How many mask cells across one of the record's own squares is, at the
 * middle of the map: one, except towards the poles, where the record keeps
 * coarser squares than the level the mask is read at (ExplorationScheme in
 * exploration.js). The feather is half a square of the record's, as it is on
 * the equator, or the edge up there reads as a staircase.
 */
function cellsPerSquare(record, maskZoom, lat) {
  const kept = record?.scheme?.finestAtLat?.(lat);
  return Number.isFinite(kept) && maskZoom > kept ? 2 ** (maskZoom - kept) : 1;
}

/**
 * Scratch canvases for the fog composite, reused between draws. Both maps paint
 * synchronously on the same thread, so one pair is enough for both.
 */
let scratch = null;

function scratchPair(width, height) {
  if (typeof document === 'undefined') return null;
  if (!scratch) {
    scratch = {
      photo: document.createElement('canvas'),
      mask: document.createElement('canvas'),
    };
  }
  for (const canvas of [scratch.photo, scratch.mask]) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }
  return scratch;
}

const TILE_PX = 256;

export function worldPixelSize(zoom) {
  return TILE_PX * Math.pow(2, zoom);
}

/** Geographic point -> absolute map pixel at a zoom. */
export function project(lat, lon, zoom) {
  const size = worldPixelSize(zoom);
  return { x: lonToNormX(lon) * size, y: latToNormY(lat) * size };
}

export function unproject(px, py, zoom) {
  const size = worldPixelSize(zoom);
  const nx = px / size;
  const ny = py / size;
  return {
    lat: (2 * Math.atan(Math.exp((0.5 - ny) * 2 * Math.PI)) - Math.PI / 2) * (180 / Math.PI),
    lon: (nx - Math.floor(nx)) * 360 - 180,
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} view {centerLat, centerLon, zoom, width, height, rotation}
 * @param {object} layers {tiles, exploration, waypointStore, player, options}
 */
export function drawMap(ctx, view, layers) {
  const { width, height, zoom } = view;
  const options = layers.options ?? {};
  const centre = project(view.centerLat, view.centerLon, zoom);
  const size = worldPixelSize(zoom);
  const rotation = view.rotation ?? 0;

  ctx.save();
  // Both maps hand us a context already scaled by the device pixel ratio, and
  // `width`/`height` are CSS pixels. The scratch canvases the fog composites on
  // have to match the real backing store or the photograph comes back soft.
  const base = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const pixelRatio = base && base.a > 0 ? base.a : 1;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0f1114';
  ctx.fillRect(0, 0, width, height);

  ctx.translate(width / 2, height / 2);
  if (rotation) ctx.rotate(rotation);

  // Tiles exist at whole zooms only.
  //
  // The view zoom moves a half step at a time and it used to be handed
  // straight to the tile lookup — so every other level asked for `6.5/x/y`,
  // which no provider has ever published and no cache could ever hold. Half
  // the zoom steps drew nothing at all. That is the map "not zooming", the
  // blue squares, and the view sliding off to one side: with no tiles to draw
  // there was nothing to anchor it to. The nearest whole zoom is fetched and
  // drawn scaled to fit the fractional one, the way every slippy map does it.
  const tileZoom = Math.max(0, Math.min(22, Math.round(zoom)));
  const tileScale = Math.pow(2, zoom - tileZoom);
  const drawSize = TILE_PX * tileScale;
  const tileCentre = project(view.centerLat, view.centerLon, tileZoom);

  // A rotated map needs a bigger tile sweep to fill the corners.
  const reach = rotation ? Math.hypot(width, height) / 2 : Math.max(width, height) / 2;
  // Counted in tile-zoom pixels, which is what the indices are in.
  const span = reach / tileScale;
  const minX = Math.floor((tileCentre.x - span) / TILE_PX);
  const maxX = Math.floor((tileCentre.x + span) / TILE_PX);
  const minY = Math.floor((tileCentre.y - span) / TILE_PX);
  const maxY = Math.floor((tileCentre.y + span) / TILE_PX);
  const tileCount = Math.pow(2, tileZoom);

  ctx.imageSmoothingEnabled = true;

  /** Paint one tile set across the visible extent. */
  const paint = (target, cache, blank) => {
    for (let ty = minY; ty <= maxY; ty++) {
      if (ty < 0 || ty >= tileCount) continue;
      for (let tx = minX; tx <= maxX; tx++) {
        const wrappedX = wrapTileX(tx, tileZoom);
        const screenX = (tx * TILE_PX - tileCentre.x) * tileScale;
        const screenY = (ty * TILE_PX - tileCentre.y) * tileScale;
        const resolved = cache.resolve(tileZoom, wrappedX, ty);

        if (resolved) {
          const { bitmap, scale, ox, oy } = resolved;
          target.drawImage(
            bitmap,
            ox * bitmap.width,
            oy * bitmap.height,
            bitmap.width * scale,
            bitmap.height * scale,
            screenX,
            screenY,
            drawSize + 0.5,
            drawSize + 0.5,
          );
        } else {
          // Nothing at this level or coarser. Anything finer counts too:
          // zooming out — which is what climbing does to the minimap — leaves
          // the sharp squares in the cache and the coarse one not yet asked
          // for, and painting over them with blank paper is why the map went
          // white.
          const inside = cache.descend(tileZoom, wrappedX, ty, 2);
          if (blank && inside.length < 16) {
            target.fillStyle = blank;
            target.fillRect(screenX, screenY, drawSize, drawSize);
          }
          for (const part of inside) {
            target.drawImage(
              part.bitmap,
              screenX + part.x * drawSize,
              screenY + part.y * drawSize,
              part.size * drawSize + 0.5,
              part.size * drawSize + 0.5,
            );
          }
        }
      }
    }
  };

  // The fog needs three things: somewhere to have been, a drawn map to show
  // where you have not, and a canvas to composite on. Without any one of them
  // the photograph is simply drawn everywhere, which is what the map did before
  // the fog came back and is still the right answer on a canvas that cannot
  // make scratch surfaces.
  // Drawn map only: the street layer everywhere, no photography and no fog,
  // because with no photograph on the map there is nothing left to reveal.
  const drawnOnly = !!options.drawnOnly && !!layers.street;
  const fogged = !drawnOnly && options.fog !== false && !!layers.exploration && !!layers.street;
  // On a server, ground anybody has explored is uncovered for everyone.
  const shared = layers.others?.shared?.() ?? null;
  const pair = fogged
    ? scratchPair(Math.round(width * pixelRatio), Math.round(height * pixelRatio))
    : null;

  if (drawnOnly) {
    paint(ctx, layers.street, STREET_BLANK);
  } else if (!pair) {
    paint(ctx, layers.tiles, '#161a1f');
  } else {
    // Unexplored first, over everything: the drawn map is the ground state.
    paint(ctx, layers.street, STREET_BLANK);

    // Which recorded level the fog is read at.
    //
    // It used to be sixteen subdivisions of a map tile, always, which sounds
    // like a resolution and is not: it made the mask level `tileZoom + 4`, and
    // that is coarser than the record everywhere below map zoom 12 and lands
    // between recorded levels on the odd ones. isExplored resolves a level it
    // does not have by shifting *down* to the nearest one it does, and a
    // coarser cell counts as explored if any part of it is — so the ground you
    // had seen grew as you zoomed out. At map zoom 11 it was read at level 14,
    // four times the area per side it should be; at map zoom 6 at level 10,
    // whose cells are about forty kilometres across. Flying through one point
    // uncovered the lot. That is the whole of "does not show only what I saw,
    // and changes size with zoom".
    //
    // So the level is chosen instead, and it is always one the record actually
    // keeps, which is what stops the shifting and the growth. The finest that
    // is worth drawing is about four pixels a cell — finer than that is a
    // lookup per pixel for an edge that is feathered anyway — and a level-L
    // cell is 256 * 2^(zoom - L) pixels across, so four pixels is L = zoom + 6.
    // Capped at the finest level the record keeps, since there is nothing
    // beyond it to ask for.
    const wanted = Math.min(LEVELS[LEVELS.length - 1], tileZoom + 6);
    let level = LEVELS[0];
    for (const candidate of LEVELS) {
      if (candidate <= wanted) level = candidate;
    }
    // Below map zoom 2 even the coarsest recorded level is finer than a tile,
    // and there is nothing to subdivide; isExplored falls through to its own
    // folded answer there, which is what that fold is for.
    const sub = Math.max(1, Math.pow(2, level - tileZoom));
    const maskZoom = tileZoom + Math.round(Math.log2(sub));
    const cellPx = drawSize / sub;

    const photo = pair.photo.getContext('2d');
    const mask = pair.mask.getContext('2d');
    for (const target of [photo, mask]) {
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.clearRect(0, 0, pair.photo.width, pair.photo.height);
      target.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      target.translate(width / 2, height / 2);
      if (rotation) target.rotate(rotation);
    }
    photo.imageSmoothingEnabled = true;
    paint(photo, layers.tiles, null);

    mask.fillStyle = '#fff';
    for (let ty = minY; ty <= maxY; ty++) {
      if (ty < 0 || ty >= tileCount) continue;
      for (let tx = minX; tx <= maxX; tx++) {
        const wrappedX = wrapTileX(tx, tileZoom);
        const screenX = (tx * TILE_PX - tileCentre.x) * tileScale;
        const screenY = (ty * TILE_PX - tileCentre.y) * tileScale;
        for (let j = 0; j < sub; j++) {
          // Filled as horizontal runs rather than cell by cell.
          //
          // Each cell used to be drawn as its own rectangle grown by half a
          // pixel on every side, so that adjacent cells could not leave a
          // hairline of street map between them. Half a pixel is nothing when
          // a cell is forty pixels across and it is most of the cell when it
          // is four: the grown rectangle is `cellPx + 1` on a side, so the
          // area drawn is (1 + 1/cellPx)^2 times the area explored. At map
          // zoom 4, where a level-10 cell is about four pixels, that is 56 per
          // cent more ground than you have seen, and it gets worse the further
          // out you zoom — which is exactly "the map shows more than I
          // explored when zoomed out".
          //
          // A run has no interior seams to hide, so the overlap is only needed
          // at its two ends, and what is left of it is capped to a twentieth
          // of a cell. At four pixels a cell that is 0.2 of a pixel rather
          // than a whole one, and the mask is feathered afterwards anyway.
          const bleed = Math.min(0.5, cellPx * 0.05);
          let runStart = -1;
          for (let i = 0; i <= sub; i++) {
            const on = i < sub
              && (layers.exploration.isExplored(maskZoom, wrappedX * sub + i, ty * sub + j)
                || !!shared?.isExplored(maskZoom, wrappedX * sub + i, ty * sub + j));
            if (on) {
              if (runStart < 0) runStart = i;
              continue;
            }
            if (runStart < 0) continue;
            mask.fillRect(
              screenX + runStart * cellPx - bleed,
              screenY + j * cellPx - bleed,
              (i - runStart) * cellPx + bleed * 2,
              cellPx + bleed * 2,
            );
            runStart = -1;
          }
        }
      }
    }

    // Feather the edge, then cut the photograph to it. The blur goes on the
    // composite rather than on each cell: blurring them one at a time and
    // compositing each in turn would have every cell erase its neighbour.
    photo.setTransform(1, 0, 0, 1, 0, 0);
    photo.globalCompositeOperation = 'destination-in';
    const squarePx = cellPx * cellsPerSquare(layers.exploration, maskZoom, view.centerLat);
    const feather = Math.min(20, Math.max(1.5, squarePx * FOG_FEATHER * pixelRatio));
    photo.filter = `blur(${feather.toFixed(1)}px)`;
    photo.drawImage(pair.mask, 0, 0);
    photo.filter = 'none';
    photo.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(pair.photo, 0, 0);
    ctx.restore();
  }

  // There used to be a tile grid drawn here — white hairlines on every map-tile
  // boundary from zoom 12 up. It is gone: it is the seams of the fetching
  // machinery drawn over a photograph of somewhere real, which is a thing a
  // developer wants to see and a thing a player never does. It also made the
  // map read as a screenshot of a tool rather than a map.

  const toScreen = (lat, lon) => {
    const p = project(lat, lon, zoom);
    let dx = p.x - centre.x;
    // Take the shorter way around the antimeridian.
    if (dx > size / 2) dx -= size;
    if (dx < -size / 2) dx += size;
    return { x: dx, y: p.y - centre.y };
  };

  // Other players' discoveries and trails, in their colours, under your own.
  if (layers.others) {
    drawOthersBelow(ctx, layers.others, toScreen, {
      zoom,
      tileZoom,
      minX, maxX, minY, maxY,
      tileCentre, tileScale, drawSize, tileCount, pixelRatio, width, height, rotation,
      pathWidth: options.pathWidth ?? 1.4,
      centerLat: view.centerLat,
    });
  }

  if (options.trail && layers.trail) {
    drawTrail(ctx, layers.trail, toScreen, options.pathWidth ?? 1.4);
  }

  if (options.waypoints && layers.waypointStore) {
    drawWaypoints(ctx, layers.waypointStore, toScreen, options.labels !== false);
  }

  // The party's waypoints: diamonds, in the colour of whoever put them down.
  const partyMarks = options.waypoints ? layers.others?.marks?.() ?? [] : [];
  if (partyMarks.length) drawPartyMarks(ctx, partyMarks, toScreen, options.labels !== false);

  // Everyone else, as an arrow in their colour with their name, then you on top.
  //
  // Headings are bearings, and the canvas is already turned by the map's own
  // rotation, so an arrow is drawn at its bearing and nothing more: a map that
  // turns with you then shows your arrow pointing up and everyone else's
  // relative to it. Subtracting the rotation as well turned each arrow twice —
  // invisible with north up, which is the default, and wrong the moment the
  // map rotates.
  //
  // Names first and every arrow after, so in a crowd a name box never hides
  // somebody's arrow.
  if (layers.others) {
    const others = layers.others.list().map((other) => ({ other, p: toScreen(other.lat, other.lon) }));
    if (options.labels !== false) {
      for (const { other, p } of others) drawName(ctx, p.x, p.y, other.name, other.colour, rotation);
    }
    for (const { other, p } of others) {
      drawPlayer(ctx, p.x, p.y, other.heading, (options.playerSize ?? 7) * 0.9, other.colour);
    }
  }

  if (layers.player) {
    const p = toScreen(layers.player.lat, layers.player.lon);
    drawPlayer(ctx, p.x, p.y, layers.player.heading, options.playerSize ?? 7);
  }

  ctx.restore();

  // North, south, east and west, drawn last so nothing covers them and drawn
  // *outside* the rotation so they stay where the compass points rather than
  // where the map happens to be turned. Big, because the whole reason to want
  // them is to know which way you are looking without reading a number.
  if (options.compass) drawCompass(ctx, width, height, rotation, options.compassSize ?? 22);

  return { centre, toScreen };
}

/**
 * The four cardinals, around the edge of the map.
 *
 * `rotation` is the map's own turn, so the letters counter-rotate: on a
 * north-up map N sits at the top, and on a heading-up one it slides round to
 * wherever north actually is.
 */
function drawCompass(ctx, width, height, rotation, size) {
  const cx = width / 2;
  const cy = height / 2;
  // Out at the rim, where a compass mark belongs. At 0.9 of the letter height
  // they sat a whole letter inside the edge, in the middle of the map, over
  // the ground you were trying to read.
  const radius = Math.min(width, height) / 2 - size * 0.62;
  const marks = [
    { label: 'N', angle: 0, colour: '#f4b26a' },
    { label: 'E', angle: Math.PI / 2, colour: '#e2e8f0' },
    { label: 'S', angle: Math.PI, colour: '#e2e8f0' },
    { label: 'W', angle: -Math.PI / 2, colour: '#e2e8f0' },
  ];
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
  for (const mark of marks) {
    const a = mark.angle + rotation - Math.PI / 2;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    // A thinner outline. At 0.28 the halo was as wide as the strokes of the
    // letter and the pair read as one blob at small sizes.
    ctx.lineWidth = size * 0.2;
    ctx.strokeStyle = 'rgba(15, 17, 20, 0.85)';
    ctx.strokeText(mark.label, x, y);
    ctx.fillStyle = mark.colour;
    ctx.fillText(mark.label, x, y);
  }
  ctx.restore();
}

/**
 * The trail: a thin line of where you have actually been, recorded as you
 * travel. No tool to fiddle with — you move, it draws. Each leg begins where
 * you arrived and ends where you teleported away from, and both ends are
 * marked, so the line reads as a journey rather than a scribble.
 */
function drawTrail(ctx, trail, toScreen, width) {
  trail.legs.forEach((leg, legIndex) => {
    if (leg.length === 0) return;
    if (leg.length > 1) {
      ctx.strokeStyle = 'rgba(214, 206, 178, 0.85)';
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      leg.forEach((point, index) => {
        const p = toScreen(point.lat, point.lon);
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }

    const start = toScreen(leg[0].lat, leg[0].lon);
    // A ring where this leg started: the first one is where you began, and
    // every one after it is where a teleport put you down.
    ctx.beginPath();
    ctx.arc(start.x, start.y, width * 2.2, 0, Math.PI * 2);
    ctx.strokeStyle = legIndex === 0 ? 'rgba(216, 196, 138, 0.95)' : 'rgba(214, 206, 178, 0.7)';
    ctx.lineWidth = width;
    ctx.stroke();

    // A cross where you left, on every leg but the one you are still walking.
    if (legIndex < trail.legs.length - 1 && leg.length > 1) {
      const end = toScreen(leg[leg.length - 1].lat, leg[leg.length - 1].lon);
      const r = width * 2;
      ctx.beginPath();
      ctx.moveTo(end.x - r, end.y - r);
      ctx.lineTo(end.x + r, end.y + r);
      ctx.moveTo(end.x + r, end.y - r);
      ctx.lineTo(end.x - r, end.y + r);
      ctx.strokeStyle = 'rgba(214, 206, 178, 0.6)';
      ctx.stroke();
    }
  });
}

function drawWaypoints(ctx, store, toScreen, labels) {
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const waypoint of store.waypoints) {
    const p = toScreen(waypoint.lat, waypoint.lon);
    ctx.fillStyle = waypoint.colour ?? '#c8b98f';
    ctx.fillRect(p.x - 3.5, p.y - 3.5, 7, 7);
    ctx.strokeStyle = 'rgba(10,12,15,0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x - 3.5, p.y - 3.5, 7, 7);
    if (labels && waypoint.name) {
      const text = waypoint.name;
      const w = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(12,14,18,0.72)';
      ctx.fillRect(p.x + 6, p.y - 8, w + 8, 16);
      ctx.fillStyle = '#dfe3e8';
      ctx.fillText(text, p.x + 10, p.y);
    }
  }
}

function drawPartyMarks(ctx, marks, toScreen, labels) {
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const mark of marks) {
    const p = toScreen(mark.lat, mark.lon);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = mark.colour ?? '#9fd3ff';
    ctx.fillRect(-4.5, -4.5, 9, 9);
    ctx.strokeStyle = '#f2f4f6';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(-4.5, -4.5, 9, 9);
    ctx.restore();
    if (labels && mark.name) {
      const text = `${mark.name} · party`;
      const w = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(12,14,18,0.72)';
      ctx.fillRect(p.x + 8, p.y - 8, w + 8, 16);
      ctx.fillStyle = '#dfe3e8';
      ctx.fillText(text, p.x + 12, p.y);
    }
  }
}

function drawPlayer(ctx, x, y, heading, size, colour = '#f2f4f6') {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.66, size * 0.72);
  ctx.lineTo(0, size * 0.34);
  ctx.lineTo(-size * 0.66, size * 0.72);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = 'rgba(15,17,20,0.9)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

/**
 * A name beside another player's arrow, kept upright whatever the map's turn
 * — the canvas is rotated under it, so the label is turned back the other way.
 */
function drawName(ctx, x, y, name, colour, rotation) {
  ctx.save();
  ctx.translate(x, y);
  if (rotation) ctx.rotate(-rotation);
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(name).width;
  ctx.fillStyle = 'rgba(12,14,18,0.72)';
  ctx.fillRect(9, -8, w + 8, 16);
  ctx.fillStyle = colour;
  ctx.fillRect(9, -8, 2, 16);
  ctx.fillStyle = '#eef1f4';
  ctx.fillText(name, 14, 0);
  ctx.restore();
}

/**
 * Other players' discoveries and trails, where you have switched them on.
 *
 * Each one's explored ground is a wash of their colour, feathered at the edge
 * the same way your own fog is, so overlapping explorers mix rather than
 * stack into a solid block; each trail is a line in their colour. Drawn below
 * your own trail and every marker, because they are the background to where
 * you are rather than the subject of the map.
 */
function drawOthersBelow(ctx, others, toScreen, view) {
  const list = others.overlays?.() ?? [];
  if (!list.length) return;
  const {
    tileZoom, minX, maxX, minY, maxY, tileCentre, tileScale, drawSize, tileCount, pixelRatio, width, height, rotation,
  } = view;
  // Discoveries: the same level choice as the fog above, so a stranger's
  // explored ground is drawn at the resolution yours is.
  const wanted = Math.min(LEVELS[LEVELS.length - 1], tileZoom + 6);
  let level = LEVELS[0];
  for (const candidate of LEVELS) if (candidate <= wanted) level = candidate;
  const sub = Math.max(1, Math.pow(2, level - tileZoom));
  const maskZoom = tileZoom + Math.round(Math.log2(sub));
  const cellPx = drawSize / sub;
  const tint = scratchTint(Math.round(width * pixelRatio), Math.round(height * pixelRatio));
  for (const overlay of list) {
    if (!overlay.showExplored || !overlay.explored || !tint) continue;
    const t = tint.getContext('2d');
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.clearRect(0, 0, tint.width, tint.height);
    t.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    t.translate(width / 2, height / 2);
    if (rotation) t.rotate(rotation);
    t.fillStyle = overlay.colour;
    for (let ty = minY; ty <= maxY; ty++) {
      if (ty < 0 || ty >= tileCount) continue;
      for (let tx = minX; tx <= maxX; tx++) {
        const wrappedX = wrapTileX(tx, tileZoom);
        const screenX = (tx * TILE_PX - tileCentre.x) * tileScale;
        const screenY = (ty * TILE_PX - tileCentre.y) * tileScale;
        for (let j = 0; j < sub; j++) {
          let runStart = -1;
          for (let i = 0; i <= sub; i++) {
            const on = i < sub && overlay.explored.isExplored(maskZoom, wrappedX * sub + i, ty * sub + j)
              && !overlay.exclude?.isExplored(maskZoom, wrappedX * sub + i, ty * sub + j);
            if (on) {
              if (runStart < 0) runStart = i;
              continue;
            }
            if (runStart < 0) continue;
            t.fillRect(screenX + runStart * cellPx, screenY + j * cellPx, (i - runStart) * cellPx, cellPx);
            runStart = -1;
          }
        }
      }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = overlay.wash ?? 0.32;
    const squarePx = cellPx * cellsPerSquare(overlay.explored, maskZoom, view.centerLat);
    ctx.filter = `blur(${Math.min(12, Math.max(1, squarePx * 0.35 * pixelRatio)).toFixed(1)}px)`;
    ctx.drawImage(tint, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  for (const overlay of list) {
    if (!overlay.showTrail || !overlay.legs) continue;
    ctx.strokeStyle = overlay.colour;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = view.pathWidth * 1.15;
    ctx.lineJoin = 'round';
    for (const leg of overlay.legs) {
      if (leg.length < 2) continue;
      ctx.beginPath();
      leg.forEach((point, index) => {
        const p = toScreen(point.lat, point.lon);
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

let tintCanvas = null;
function scratchTint(width, height) {
  if (typeof document === 'undefined') return null;
  tintCanvas ??= document.createElement('canvas');
  if (tintCanvas.width !== width || tintCanvas.height !== height) {
    tintCanvas.width = width;
    tintCanvas.height = height;
  }
  return tintCanvas;
}

/** Metres per screen pixel at a latitude and zoom — used for the scale bar. */
export function metresPerPixel(lat, zoom) {
  return (WORLD_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / worldPixelSize(zoom);
}

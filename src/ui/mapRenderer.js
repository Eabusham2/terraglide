import { latToNormY, lonToNormX, wrapTileX } from '../geo/mercator.js';

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
        } else if (blank) {
          // Nothing loaded here yet.
          target.fillStyle = blank;
          target.fillRect(screenX, screenY, drawSize, drawSize);
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

    // One exploration cell per this many map-tile subdivisions. Sixteen is the
    // finest the record goes; below that the cells would be smaller than the
    // record can answer for, and above it they would be coarser than the
    // screen, so it is clamped at both ends.
    const sub = Math.max(1, Math.min(16, Math.pow(2, 16 - tileZoom)));
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
          for (let i = 0; i < sub; i++) {
            if (!layers.exploration.isExplored(maskZoom, wrappedX * sub + i, ty * sub + j)) continue;
            // Half a pixel of overlap: adjacent cells must not leave a hairline
            // of street map between them.
            mask.fillRect(
              screenX + i * cellPx - 0.5,
              screenY + j * cellPx - 0.5,
              cellPx + 1,
              cellPx + 1,
            );
          }
        }
      }
    }

    // Feather the edge, then cut the photograph to it. The blur goes on the
    // composite rather than on each cell: blurring them one at a time and
    // compositing each in turn would have every cell erase its neighbour.
    photo.setTransform(1, 0, 0, 1, 0, 0);
    photo.globalCompositeOperation = 'destination-in';
    const feather = Math.min(20, Math.max(1.5, cellPx * FOG_FEATHER * pixelRatio));
    photo.filter = `blur(${feather.toFixed(1)}px)`;
    photo.drawImage(pair.mask, 0, 0);
    photo.filter = 'none';
    photo.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(pair.photo, 0, 0);
    ctx.restore();
  }

  if (options.grid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let tx = minX; tx <= maxX; tx++) {
      const x = (tx * TILE_PX - tileCentre.x) * tileScale;
      ctx.beginPath();
      ctx.moveTo(x, (minY * TILE_PX - tileCentre.y) * tileScale);
      ctx.lineTo(x, ((maxY + 1) * TILE_PX - tileCentre.y) * tileScale);
      ctx.stroke();
    }
    for (let ty = minY; ty <= maxY; ty++) {
      const y = (ty * TILE_PX - tileCentre.y) * tileScale;
      ctx.beginPath();
      ctx.moveTo((minX * TILE_PX - tileCentre.x) * tileScale, y);
      ctx.lineTo(((maxX + 1) * TILE_PX - tileCentre.x) * tileScale, y);
      ctx.stroke();
    }
  }

  const toScreen = (lat, lon) => {
    const p = project(lat, lon, zoom);
    let dx = p.x - centre.x;
    // Take the shorter way around the antimeridian.
    if (dx > size / 2) dx -= size;
    if (dx < -size / 2) dx += size;
    return { x: dx, y: p.y - centre.y };
  };

  if (options.trail && layers.trail) {
    drawTrail(ctx, layers.trail, toScreen, options.pathWidth ?? 1.4);
  }

  if (options.waypoints && layers.waypointStore) {
    drawWaypoints(ctx, layers.waypointStore, toScreen, options.labels !== false);
  }

  if (layers.player) {
    const p = toScreen(layers.player.lat, layers.player.lon);
    drawPlayer(ctx, p.x, p.y, layers.player.heading - rotation, options.playerSize ?? 7);
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
  const radius = Math.min(width, height) / 2 - size * 0.9;
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
    ctx.lineWidth = size * 0.28;
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

function drawPlayer(ctx, x, y, heading, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.66, size * 0.72);
  ctx.lineTo(0, size * 0.34);
  ctx.lineTo(-size * 0.66, size * 0.72);
  ctx.closePath();
  ctx.fillStyle = '#f2f4f6';
  ctx.fill();
  ctx.strokeStyle = 'rgba(15,17,20,0.9)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

/** Metres per screen pixel at a latitude and zoom — used for the scale bar. */
export function metresPerPixel(lat, zoom) {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / worldPixelSize(zoom);
}

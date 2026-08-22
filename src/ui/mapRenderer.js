import { latToNormY, lonToNormX, wrapTileX } from '../geo/mercator.js';

/**
 * Shared 2D map painter for the minimap and the world map.
 *
 * One layer. The whole world is satellite imagery; ground you have not been to
 * is the same photograph with the colour taken out of it, so the fog is a
 * treatment rather than a different map.
 *
 * It used to be two tile sets side by side — photographs where you had been and
 * separately fetched, separately rendered vector street tiles where you had
 * not. That is the patchwork: two pictures of the world, drawn to different
 * conventions, meeting along the edge of wherever you happened to have flown,
 * and each square waiting on its own download so the seam moved about as they
 * landed. The vector half also had no business being drawn zoomed out, where
 * its road casings and labels are sized for a street and come out as coloured
 * bands and letters the size of counties.
 *
 * One tile set, one look, one thing to wait for.
 *
 * Trails are hairlines, waypoints are small squares, and the whole thing is
 * deliberately flat: no glow, no gradients, nothing that competes with the
 * imagery underneath.
 */

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
  for (let ty = minY; ty <= maxY; ty++) {
    if (ty < 0 || ty >= tileCount) continue;
    for (let tx = minX; tx <= maxX; tx++) {
      const wrappedX = wrapTileX(tx, tileZoom);
      const screenX = (tx * TILE_PX - tileCentre.x) * tileScale;
      const screenY = (ty * TILE_PX - tileCentre.y) * tileScale;
      const explored = !layers.exploration || layers.exploration.isExplored(tileZoom, wrappedX, ty);
      const asMap = !explored && options.fog !== false;
      const resolved = layers.tiles.resolve(tileZoom, wrappedX, ty);

      if (resolved) {
        const { bitmap, scale, ox, oy } = resolved;
        const sw = bitmap.width * scale;
        const sh = bitmap.height * scale;
        ctx.save();
        // Unvisited: the same photograph, drained. Coastlines, rivers, roads
        // and towns all still read — you can find yourself on the planet — but
        // nothing there looks like somewhere you have been.
        if (asMap) ctx.filter = 'grayscale(1) brightness(1.3) contrast(0.62)';
        ctx.drawImage(
          bitmap,
          ox * bitmap.width,
          oy * bitmap.height,
          sw,
          sh,
          screenX,
          screenY,
          drawSize + 0.5,
          drawSize + 0.5,
        );
        ctx.restore();
        if (asMap) {
          // And a wash, so the two halves separate at a glance rather than
          // only on inspection.
          ctx.fillStyle = 'rgba(24, 28, 34, 0.3)';
          ctx.fillRect(screenX, screenY, drawSize + 0.5, drawSize + 0.5);
        }
      } else {
        ctx.fillStyle = explored ? '#1b1f24' : '#141619';
        ctx.fillRect(screenX, screenY, drawSize, drawSize);
      }
    }
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

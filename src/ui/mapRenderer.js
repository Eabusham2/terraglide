import { latToNormY, lonToNormX, wrapTileX } from '../geo/mercator.js';

/**
 * Shared 2D map painter for the minimap and the world map.
 *
 * Ground you have been to is drawn as satellite imagery. Ground you have not is
 * drawn as a *map*: the same tile, flattened to a pale monochrome so coastlines,
 * rivers and towns still read, but obviously not photographic. So the world is
 * always legible — you can zoom out and see where you are on the planet — while
 * only the places you have actually been look real.
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

  // A rotated map needs a bigger tile sweep to fill the corners.
  const reach = rotation ? Math.hypot(width, height) / 2 : Math.max(width, height) / 2;
  const minX = Math.floor((centre.x - reach) / TILE_PX);
  const maxX = Math.floor((centre.x + reach) / TILE_PX);
  const minY = Math.floor((centre.y - reach) / TILE_PX);
  const maxY = Math.floor((centre.y + reach) / TILE_PX);
  const tileCount = Math.pow(2, zoom);

  ctx.imageSmoothingEnabled = true;
  for (let ty = minY; ty <= maxY; ty++) {
    if (ty < 0 || ty >= tileCount) continue;
    for (let tx = minX; tx <= maxX; tx++) {
      const wrappedX = wrapTileX(tx, zoom);
      const screenX = tx * TILE_PX - centre.x;
      const screenY = ty * TILE_PX - centre.y;
      const explored = !layers.exploration || layers.exploration.isExplored(zoom, wrappedX, ty);
      const asMap = !explored && options.fog !== false;
      // Always load the tile: the map has to be readable when you zoom out,
      // whether or not you have been there.
      const resolved = layers.tiles.resolve(zoom, wrappedX, ty);

      if (resolved) {
        const { bitmap, scale, ox, oy } = resolved;
        const sw = bitmap.width * scale;
        const sh = bitmap.height * scale;
        ctx.save();
        // Unvisited ground is drawn as a map rather than a photograph.
        if (asMap) ctx.filter = 'grayscale(1) brightness(1.45) contrast(0.45)';
        ctx.drawImage(
          bitmap,
          ox * bitmap.width,
          oy * bitmap.height,
          sw,
          sh,
          screenX,
          screenY,
          TILE_PX + 0.5,
          TILE_PX + 0.5,
        );
        ctx.restore();
        if (asMap) {
          ctx.fillStyle = 'rgba(24, 28, 34, 0.34)';
          ctx.fillRect(screenX, screenY, TILE_PX + 0.5, TILE_PX + 0.5);
        }
      } else {
        ctx.fillStyle = explored ? '#1b1f24' : '#141619';
        ctx.fillRect(screenX, screenY, TILE_PX, TILE_PX);
      }
    }
  }

  if (options.grid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let tx = minX; tx <= maxX; tx++) {
      const x = tx * TILE_PX - centre.x;
      ctx.beginPath();
      ctx.moveTo(x, minY * TILE_PX - centre.y);
      ctx.lineTo(x, (maxY + 1) * TILE_PX - centre.y);
      ctx.stroke();
    }
    for (let ty = minY; ty <= maxY; ty++) {
      const y = ty * TILE_PX - centre.y;
      ctx.beginPath();
      ctx.moveTo(minX * TILE_PX - centre.x, y);
      ctx.lineTo((maxX + 1) * TILE_PX - centre.x, y);
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
  return { centre, toScreen };
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

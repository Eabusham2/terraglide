import { latToNormY, lonToNormX, wrapTileX } from '../geo/mercator.js';

/**
 * Shared 2D map painter for the minimap and the world map.
 *
 * Explored ground is drawn as-is; ground you have never been to is dimmed and
 * hatched, so the map fills in as you travel. Paths are hairlines, waypoints are
 * small squares, and the whole thing is deliberately flat — no glow, no
 * gradients, nothing that competes with the imagery underneath.
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
      const resolved = layers.tiles.resolve(zoom, wrappedX, ty);

      if (resolved) {
        const { bitmap, scale, ox, oy } = resolved;
        const sw = bitmap.width * scale;
        const sh = bitmap.height * scale;
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
      } else {
        ctx.fillStyle = '#181b1f';
        ctx.fillRect(screenX, screenY, TILE_PX, TILE_PX);
      }

      if (options.fog && layers.exploration && !layers.exploration.isExplored(zoom, wrappedX, ty)) {
        drawUnexplored(ctx, screenX, screenY, TILE_PX, options.fogAlpha ?? 0.62);
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

  if (options.paths && layers.waypointStore) {
    drawPaths(ctx, layers.waypointStore, toScreen, options.pathWidth ?? 1.4);
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

function drawUnexplored(ctx, x, y, size, alpha) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  ctx.fillStyle = `rgba(12,14,18,${alpha})`;
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = 'rgba(190,200,215,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -size; i < size * 2; i += 12) {
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i - size, y + size);
  }
  ctx.stroke();
  ctx.restore();
}

function drawPaths(ctx, store, toScreen, width) {
  const all = store.activePath ? [...store.paths, store.activePath] : store.paths;
  for (const path of all) {
    if (!path.points || path.points.length < 1) continue;
    ctx.strokeStyle = path.colour ?? '#c8b98f';
    ctx.lineWidth = width;
    ctx.setLineDash(path === store.activePath ? [5, 4] : []);
    ctx.beginPath();
    path.points.forEach((point, index) => {
      const p = toScreen(point.lat, point.lon);
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // End caps so a two-point line reads as "start -> end".
    const first = toScreen(path.points[0].lat, path.points[0].lon);
    ctx.fillStyle = path.colour ?? '#c8b98f';
    ctx.fillRect(first.x - 2, first.y - 2, 4, 4);
    if (path.points.length > 1) {
      const last = path.points[path.points.length - 1];
      const end = toScreen(last.lat, last.lon);
      ctx.beginPath();
      ctx.arc(end.x, end.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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

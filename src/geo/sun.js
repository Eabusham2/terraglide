import { DEG, RAD } from '../core/math.js';

/**
 * Solar position (NOAA low-precision algorithm). Good to a fraction of a degree,
 * which is far better than the sky needs.
 *
 * Returns altitude/azimuth in radians; azimuth is clockwise from north.
 */
export function solarPosition(date, lat, lon) {
  const julian = date.getTime() / 86400000 + 2440587.5;
  const n = julian - 2451545.0;

  const meanLongitude = (280.46 + 0.9856474 * n) % 360;
  const meanAnomaly = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG;
  const obliquity = (23.439 - 0.0000004 * n) * DEG;

  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude),
  );
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));

  // Greenwich mean sidereal time -> local hour angle.
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lmst = ((gmst * 15 + lon) % 360) * DEG;
  let hourAngle = lmst - rightAscension;
  hourAngle = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle));

  const phi = lat * DEG;
  const altitude = Math.asin(
    Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle),
  );
  const azimuth = Math.atan2(
    -Math.sin(hourAngle) * Math.cos(declination),
    Math.cos(phi) * Math.sin(declination) - Math.sin(phi) * Math.cos(declination) * Math.cos(hourAngle),
  );

  return { altitude, azimuth, declination, altitudeDeg: altitude * RAD };
}

/** Unit vector toward the sun in world space (+X east, +Y up, -Z north). */
export function sunDirection(altitude, azimuth, out = { x: 0, y: 0, z: 0 }) {
  const cosAlt = Math.cos(altitude);
  out.x = cosAlt * Math.sin(azimuth);
  out.y = Math.sin(altitude);
  out.z = -cosAlt * Math.cos(azimuth);
  return out;
}

/**
 * Local solar time as a Date for a given longitude, so "noon" means noon where
 * the player is standing rather than noon in the browser's timezone.
 */
export function localSolarDate(utc, lon) {
  return new Date(utc.getTime() + (lon / 15) * 3600000);
}

/**
 * Build the UTC instant that the sky should be rendered for.
 * `mode` is one of 'live' | 'noon' | 'golden' | 'night' | 'custom'.
 */
export function skyDate(mode, customHour, lon, now = new Date()) {
  if (mode === 'live') return now;
  const hour = mode === 'noon' ? 12 : mode === 'golden' ? 18.2 : mode === 'night' ? 0.5 : customHour;
  // Convert a desired *local solar* hour back to UTC at this longitude.
  const utcHour = hour - lon / 15;
  const d = new Date(now.getTime());
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + utcHour * 3600000);
}

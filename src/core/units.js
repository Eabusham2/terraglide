/**
 * Which units to start in.
 *
 * Three countries do not use the metric system for everyday distance — the
 * United States, Liberia and Myanmar — and the United Kingdom still measures
 * road distance in miles. Everywhere else is metric. The browser already knows
 * which one you are in, so asking it is better than picking one and making
 * half the world change it.
 *
 * Only ever the starting value: once you set the units yourself, that is what
 * is stored and this is not consulted again.
 */
export function defaultUnits() {
  try {
    const locales = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const tag of locales) {
      if (!tag) continue;
      const region = new Intl.Locale(tag).maximize().region;
      if (region) return IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric';
    }
  } catch {
    /* No Intl.Locale, or a tag it will not parse. Metric is the safer guess. */
  }
  return 'metric';
}

/**
 * The CLDR region the browser is set to, or null.
 *
 * Google's Map Tiles API wants one on every `createSession` call, and the only
 * honest answer is the one the browser already holds. See prepareGoogle.
 */
export function localeRegion() {
  try {
    const locales = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const tag of locales) {
      if (!tag) continue;
      const region = new Intl.Locale(tag).maximize().region;
      if (region) return region;
    }
  } catch {
    /* No Intl.Locale, or a tag it will not parse. */
  }
  return null;
}

/** Regions that measure everyday distance in feet and miles. */
const IMPERIAL_REGIONS = new Set(['US', 'GB', 'LR', 'MM']);

const M_PER_FT = 0.3048;
const M_PER_MI = 1609.344;

export function formatDistance(metres, units, digits = 1) {
  if (!Number.isFinite(metres)) return '—';
  if (units === 'imperial') {
    const feet = metres / M_PER_FT;
    if (Math.abs(feet) < 1000) return `${feet.toFixed(feet < 10 ? 1 : 0)} ft`;
    return `${(metres / M_PER_MI).toFixed(digits)} mi`;
  }
  if (Math.abs(metres) < 1000) return `${metres.toFixed(metres < 10 ? 1 : 0)} m`;
  return `${(metres / 1000).toFixed(digits)} km`;
}

export function formatAltitude(metres, units) {
  if (!Number.isFinite(metres)) return '—';
  return units === 'imperial'
    ? `${Math.round(metres / M_PER_FT).toLocaleString()} ft`
    : `${Math.round(metres).toLocaleString()} m`;
}

export function formatSpeed(metresPerSecond, units) {
  if (!Number.isFinite(metresPerSecond)) return '—';
  return units === 'imperial'
    ? `${Math.round(metresPerSecond * 2.2369363)} mph`
    : `${Math.round(metresPerSecond * 3.6)} km/h`;
}

export function formatHeight(metres, units) {
  if (units === 'metric') return `${metres.toFixed(2)} m`;
  const totalInches = (metres / M_PER_FT) * 12;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);
  if (inches === 12) return `${feet + 1}' 0"`;
  return `${feet}' ${inches}"`;
}

export function formatTemperature(celsius, units) {
  if (!Number.isFinite(celsius)) return '—';
  return units === 'imperial'
    ? `${Math.round((celsius * 9) / 5 + 32)}°F`
    : `${Math.round(celsius)}°C`;
}

export function formatLatLon(lat, lon, digits = 5) {
  return `${lat.toFixed(digits)}, ${lon.toFixed(digits)}`;
}

/** 47°22'08.8"N 122°00'55.4"W */
export function formatDms(lat, lon) {
  return `${dms(lat, 'NS')} ${dms(lon, 'EW')}`;
}

function dms(value, axis) {
  const hemi = value >= 0 ? axis[0] : axis[1];
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = (minFloat - min) * 60;
  return `${deg}°${String(min).padStart(2, '0')}'${sec.toFixed(1).padStart(4, '0')}"${hemi}`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compassPoint(radians) {
  const deg = ((radians * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 22.5) % 16];
}

export function formatBearing(radians) {
  const deg = ((radians * 180) / Math.PI + 360) % 360;
  return `${compassPoint(radians)} ${Math.round(deg)}°`;
}

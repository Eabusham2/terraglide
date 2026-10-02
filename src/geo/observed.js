/**
 * The weather that is actually happening, where you are standing.
 *
 * Everything else in this file's neighbourhood is a climatology: a good model
 * of what a place *tends* to get in a given month, computed from latitude and
 * season with no network at all. That is a fair thing to show when nothing
 * better is available, and it is a poor thing to show when something better
 * is — "Cloudy, light rain" over a place that is in bright sun today is
 * exactly the kind of made-up statistic this project is not supposed to have.
 *
 * Open-Meteo publishes current conditions for anywhere on Earth, keyless,
 * CORS-open and free for non-commercial use. It is one request per place you
 * arrive at, cached, so flying about does not hammer it.
 *
 * If it cannot be reached the caller falls back to the climatology and the
 * readout says "seasonal average", so the two are never confused.
 */

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
/** How long an observation is good for. They publish every quarter of an hour. */
const FRESH_MS = 10 * 60 * 1000;
/**
 * How far you may move before the observation is somebody else's weather.
 * Half a degree is roughly fifty kilometres, which is a weather front's worth.
 */
const NEAR_DEG = 0.5;

/**
 * WMO weather codes, in the words a person would use.
 *
 * The full table is longer than this; these are the groups that matter for
 * something you can see out of a window.
 */
function describeCode(code, cloudPercent) {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return cloudPercent > 70 ? 'Overcast' : cloudPercent > 30 ? 'Partly cloudy' : 'Clear';
}

/** Rain, snow or nothing — what the sky is actually dropping. */
function precipitationKind(code, snowfallCm, rainMm) {
  if (snowfallCm > 0 || (code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (rainMm > 0 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) {
    return 'rain';
  }
  return 'none';
}

export class ObservedWeather {
  constructor() {
    this.current = null;
    this.pending = null;
    this.failed = false;
  }

  /** True when what we hold is recent enough and close enough to be yours. */
  fresh(lat, lon) {
    const w = this.current;
    if (!w) return false;
    if (Date.now() - w.at > FRESH_MS) return false;
    return Math.abs(w.lat - lat) < NEAR_DEG && Math.abs(w.lon - lon) < NEAR_DEG;
  }

  /**
   * Fetch, unless we already hold something good for here.
   *
   * @returns {Promise<object|null>} the observation, or null if unreachable
   */
  async fetch(lat, lon) {
    if (this.fresh(lat, lon)) return this.current;
    if (this.pending) return this.pending;
    const url =
      `${ENDPOINT}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
      '&current=temperature_2m,apparent_temperature,is_day,precipitation,rain,snowfall,' +
      'weather_code,cloud_cover,wind_speed_10m&timezone=UTC';
    this.pending = (async () => {
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const c = body?.current;
        if (!c || typeof c.temperature_2m !== 'number') throw new Error('no current block');
        const cloudPercent = Number(c.cloud_cover ?? 0);
        const kind = precipitationKind(
          Number(c.weather_code ?? 0),
          Number(c.snowfall ?? 0),
          Number(c.rain ?? 0),
        );
        this.current = {
          at: Date.now(),
          lat,
          lon,
          observed: true,
          tempC: Number(c.temperature_2m),
          feelsC: Number(c.apparent_temperature ?? c.temperature_2m),
          isDay: Number(c.is_day ?? 1) === 1,
          cloudCover: cloudPercent / 100,
          // Millimetres in the last quarter of an hour. A tenth of a
          // millimetre is drizzle; two is heavy, and past that the difference
          // is academic for something you are looking at rather than standing in.
          precipitation: Math.min(1, Number(c.precipitation ?? 0) / 2),
          kind,
          windKph: Number(c.wind_speed_10m ?? 0),
          label: describeCode(Number(c.weather_code ?? 0), cloudPercent),
        };
        this.failed = false;
        return this.current;
      } catch {
        this.failed = true;
        return null;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }
}

export const observedWeather = new ObservedWeather();

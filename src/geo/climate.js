import { DEG, clamp } from '../core/math.js';

/**
 * A small analytic climatology. It is *not* a weather feed — it estimates the
 * average temperature for the season you are standing in, from latitude,
 * elevation, time of year and how much land surrounds you (continentality).
 *
 * The zonal mean curve is fitted to the usual annual-mean-by-latitude table
 * (about 27 C at the equator, 20 C at 30 deg, -1 C at 60 deg, -20 C at the
 * poles), the seasonal swing grows with latitude and with land fraction, and
 * elevation applies the standard 6.5 C/km environmental lapse rate.
 */

const SEASONS_NORTH = ['Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer', 'Summer', 'Summer', 'Autumn', 'Autumn', 'Autumn', 'Winter'];
const SEASONS_SOUTH = ['Summer', 'Summer', 'Autumn', 'Autumn', 'Autumn', 'Winter', 'Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer'];

/** Peak-warmth day of year, ~3 weeks after the solstice. */
const PEAK_DAY_NORTH = 202;

export function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / 86400000) + 1;
}

/** Annual mean sea-level temperature for a latitude, in Celsius. */
export function annualMeanC(lat) {
  const s = Math.abs(Math.sin(lat * DEG));
  return 27.5 - 47 * Math.pow(s, 2.6);
}

/** Half of the yearly peak-to-trough swing, in Celsius. */
export function seasonalAmplitudeC(lat, landFraction = 0.6) {
  const s = Math.abs(Math.sin(lat * DEG));
  const oceanic = 1.0 + 12 * s * s;
  return oceanic * (0.55 + 1.05 * clamp(landFraction, 0, 1));
}

/**
 * @param {object} opts
 * @param {number} opts.lat
 * @param {number} [opts.elevationM]
 * @param {Date}   [opts.date]
 * @param {number} [opts.landFraction] 0 = open ocean, 1 = deep continental interior
 */
export function climateAt({ lat, elevationM = 0, date = new Date(), landFraction = 0.6 }) {
  const doy = dayOfYear(date);
  const south = lat < 0;
  const peak = south ? PEAK_DAY_NORTH + 182.6 : PEAK_DAY_NORTH;
  const phase = Math.cos((2 * Math.PI * (doy - peak)) / 365.25);

  const mean = annualMeanC(lat);
  const amplitude = seasonalAmplitudeC(lat, landFraction);
  const lapse = -6.5 * (Math.max(0, elevationM) / 1000);

  const seasonAvg = clamp(mean + amplitude * phase + lapse, -70, 56);
  const month = date.getUTCMonth();
  const season = (south ? SEASONS_SOUTH : SEASONS_NORTH)[month];

  return {
    season,
    month,
    monthName: date.toLocaleString('en', { month: 'short', timeZone: 'UTC' }),
    hemisphere: south ? 'S' : 'N',
    /** Average temperature for this season at this spot, Celsius. */
    avgC: seasonAvg,
    /**
     * The same average with the height taken back out — what this latitude and
     * this time of year come to at sea level.
     *
     * Anything asking "how high does it have to be before it is cold" needs
     * this one, not `avgC`: `avgC` already has the lapse rate applied for
     * wherever you happen to be standing, and feeding it back into a lapse-rate
     * calculation applies it twice. See snowLineM.
     */
    seaLevelAvgC: clamp(mean + amplitude * phase, -70, 56),
    /** Annual mean at this spot, for context. */
    annualC: clamp(mean + lapse, -70, 56),
    amplitudeC: amplitude,
    band: climateBand(lat, mean + lapse),
    estimate: true,
  };
}

function climateBand(lat, meanC) {
  const abs = Math.abs(lat);
  if (meanC < -12) return 'Polar';
  if (meanC < 2) return 'Subpolar';
  if (abs < 15) return 'Tropical';
  if (abs < 30) return 'Subtropical';
  if (abs < 55) return 'Temperate';
  return 'Boreal';
}

/**
 * Snow line for the current conditions — used to tint high terrain white so
 * mountains read correctly even when imagery was captured in another season.
 *
 * This takes the **sea-level** seasonal average, and the 155 is why: it is
 * 1000 / 6.5, the environmental lapse rate turned round. The sum is "how far up
 * do you have to go before this place's air reaches freezing", plus a two
 * degree allowance for snow lying a little below the freezing level.
 *
 * It was being handed `avgC` instead, which already has the lapse rate applied
 * for the ground under your feet — so the rate went in twice and the answer
 * depended on how high *you* were standing rather than on where you were. Up on
 * the Jungfrau massif at 3,970 m that put the snow line at −400 m, the clamp,
 * and the shader duly mixed 45% flat white over every piece of flat ground
 * above 600 m in view: the valley floors, the forests, the villages. Measured
 * from the same spot, sea-level August at 46.5°N gives 3,255 m instead, which
 * is about where the Alpine snow line actually is in August.
 */
export function snowLineM(seaLevelAvgC) {
  return clamp((seaLevelAvgC + 2) * 155, -400, 5200);
}

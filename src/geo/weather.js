import { clamp, smoothstep } from '../core/math.js';

/**
 * Weather, for the place and the time of year you are standing in.
 *
 * Same bargain as the temperature readout: this is a *climatology*, not a
 * forecast. It needs no key, no network and no account, and it gives you the
 * cloud and rain that place tends to get in that month — the doldrums are
 * cloudy, the subtropical deserts are not, the mid-latitude storm belt is
 * cloudier in winter, oceans are cloudier than land, and it snows instead of
 * raining when it is cold enough.
 *
 * The result is stable for a given place and day, so flying from the Sahara
 * into the monsoon actually changes the sky.
 */

/** Long-term mean cloud cover by latitude, 0 to 1. */
export function zonalCloudCover(lat) {
  const a = Math.abs(lat);
  // Rising air at the equator and along the polar front; sinking air between.
  const itcz = 0.34 * Math.exp(-((a / 11) ** 2));
  const subtropicalGap = -0.22 * Math.exp(-(((a - 24) / 13) ** 2));
  const stormBelt = 0.28 * Math.exp(-(((a - 58) / 20) ** 2));
  return clamp(0.42 + itcz + subtropicalGap + stormBelt, 0.05, 0.95);
}

/**
 * @param {object} options
 * @param {number} options.lat
 * @param {number} options.lon
 * @param {Date}   options.date
 * @param {number} options.avgC        seasonal mean temperature from the climate model
 * @param {number} options.landFraction 0 at sea, 1 well inland
 */
export function weatherAt({ lat, lon, date = new Date(), avgC = 12, landFraction = 0.6 }) {
  const dayOfYear = Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
  const seasonPhase = (dayOfYear / 365.25) * Math.PI * 2;
  // North of the equator winter is cloudier in the storm belt; south is flipped.
  const winter = Math.cos(seasonPhase - (lat >= 0 ? 0.35 : Math.PI + 0.35));
  const beltWeight = smoothstep(28, 52, Math.abs(lat));

  // Oceans are cloudier and steadier than land.
  const ocean = (1 - landFraction) * 0.16;
  // A slow spatial wobble so neighbouring regions are not identical.
  const wobble =
    0.12 * Math.sin(lon * 0.031 + lat * 0.017 + dayOfYear * 0.021) +
    0.07 * Math.sin(lon * 0.077 - lat * 0.043);

  const cloudCover = clamp(
    zonalCloudCover(lat) + ocean + wobble + beltWeight * winter * 0.16,
    0.02,
    1,
  );

  // Rain follows cloud, but only the thick part of it, and the tropics wring
  // out far more of it than the poles do.
  const capacity = clamp(smoothstep(-14, 26, avgC), 0.05, 1);
  const precipitation = clamp((cloudCover - 0.55) * 2.1 * capacity, 0, 1);
  const kind = precipitation < 0.04 ? 'none' : avgC <= 1.5 ? 'snow' : 'rain';

  return { cloudCover, precipitation, kind, label: describe(cloudCover, precipitation, kind) };
}

function describe(cloudCover, precipitation, kind) {
  const sky =
    cloudCover < 0.2 ? 'Clear' : cloudCover < 0.45 ? 'Fair' : cloudCover < 0.72 ? 'Cloudy' : 'Overcast';
  if (kind === 'none') return sky;
  const strength = precipitation < 0.25 ? 'light' : precipitation < 0.6 ? 'steady' : 'heavy';
  return `${sky} · ${strength} ${kind}`;
}

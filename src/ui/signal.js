/**
 * How good a connection is, as bars - the way a phone shows signal: four of
 * them, as many lit as the round trip deserves, in green, yellow or red.
 *
 * Shared by the startup screen's main-lobby button and the in-game readout
 * beside the frame rate, so the same ping looks the same in both.
 */

/** Below this a round trip is good (green), below the next fair (yellow); beyond, poor (red). */
export const GOOD_MS = 120;
export const FAIR_MS = 250;

/**
 * Bars and colour for a round trip in milliseconds. Not `up` - nothing
 * answering - is no bars at all, in red; `stale` - it used to answer and has
 * gone quiet - is one red bar, whatever the last figure was.
 */
export function signalLevel(ms, { up = true, stale = false } = {}) {
  if (!up) return { bars: 0, tone: 'down' };
  if (stale) return { bars: 1, tone: 'poor' };
  if (!Number.isFinite(ms)) return { bars: 0, tone: 'unknown' };
  const bars = ms < 60 ? 4 : ms < GOOD_MS ? 3 : ms < FAIR_MS ? 2 : 1;
  const tone = ms < GOOD_MS ? 'good' : ms < FAIR_MS ? 'fair' : 'poor';
  return { bars, tone };
}

/** The bars as markup, for a page drawn with innerHTML. */
export function signalMarkup(level) {
  return `<span class="signal signal-${level.tone}" data-bars="${level.bars}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
}

/** The same bars, set on an element made by signalMarkup, without redrawing it. */
export function setSignal(element, level) {
  if (!element) return;
  const name = `signal signal-${level.tone}`;
  if (element.className !== name) element.className = name;
  if (element.dataset.bars !== String(level.bars)) element.dataset.bars = String(level.bars);
}

export function formatPing(ms) {
  return Number.isFinite(ms) ? `${Math.round(ms)} ms` : '— ms';
}

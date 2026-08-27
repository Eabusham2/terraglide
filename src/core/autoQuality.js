import { settings } from './settings.js';

/**
 * Keep the graphics preset at the heaviest tier this machine actually holds.
 *
 * There was a setting called `autoQuality`, defaulting to true, with a comment
 * pointing at this file. The file did not exist and nothing read the setting,
 * so "auto" has never done anything at all: every machine sat on whatever tier
 * it started at, which was High for everybody. That is most of "it's so
 * laggy", and it is why the first-run guess had to be right first time —
 * nothing was ever going to correct it.
 *
 * This corrects it, by watching the frame clock, which is the only thing that
 * knows. Two rules keep it from being worse than doing nothing:
 *
 *  - It moves one tier at a time and then waits. A dial that drops two tiers on
 *    one bad second, in a game that streams its scenery, will drop them during
 *    the arrival stutter that was always going to end by itself.
 *  - It needs far more headroom to climb than to fall. Equal thresholds give a
 *    machine that sits exactly on the boundary flipping between two tiers for
 *    ever, which looks worse than either of them.
 */

const TIERS = ['low', 'medium', 'high', 'ultra'];
/** Seconds of frames to judge on. Long enough to outlast a tile arriving. */
const WINDOW_S = 4;
/** Wait after a change before judging again, so a step can take effect. */
const COOLDOWN_S = 6;
/** Below this share of the target, drop a tier. */
const DROP_BELOW = 0.85;
/** Above this share, and only then, try the next one up. */
const RAISE_ABOVE = 1.35;

export class AutoQuality {
  constructor() {
    this.window = 0;
    this.frames = 0;
    this.cooldown = 0;
    this.lastChange = null;
  }

  /** True when the player has left this to the game rather than picking. */
  get engaged() {
    return settings.get('graphics') === 'auto';
  }

  /**
   * @param {number} dt seconds of wall clock this frame took
   * @returns {null | { from: string, to: string, fps: number }}
   */
  update(dt) {
    if (!this.engaged || !Number.isFinite(dt) || dt <= 0) return null;
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      // Frames during the cooldown are not evidence about the new tier yet.
      this.window = 0;
      this.frames = 0;
      return null;
    }
    this.window += dt;
    this.frames++;
    if (this.window < WINDOW_S) return null;

    const fps = this.frames / this.window;
    this.window = 0;
    this.frames = 0;

    const target = Math.max(20, Number(settings.get('fpsTarget')) || 60);
    const current = settings.get('autoTier');
    const index = TIERS.indexOf(current);
    if (index < 0) return null;

    let next = index;
    if (fps < target * DROP_BELOW) next = Math.max(0, index - 1);
    else if (fps > target * RAISE_ABOVE) next = Math.min(TIERS.length - 1, index + 1);
    if (next === index) return null;

    settings.set('autoTier', TIERS[next]);
    this.cooldown = COOLDOWN_S;
    this.lastChange = { from: current, to: TIERS[next], fps: Math.round(fps) };
    return this.lastChange;
  }
}

export const TIER_ORDER = TIERS;

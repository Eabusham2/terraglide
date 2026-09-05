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
 *    ever, which looks worse than either of them. That headroom is measured in
 *    *time* rather than in frames per second, because frames per second is
 *    capped by the display and time is not — see RAISE_AT.
 */

const TIERS = ['low', 'medium', 'high', 'ultra'];
/** Seconds of frames to judge on. Long enough to outlast a tile arriving. */
const WINDOW_S = 4;
/** Wait after a change before judging again, so a step can take effect. */
const COOLDOWN_S = 6;
/** Below this share of the target, drop a tier. */
const DROP_BELOW = 0.85;
/**
 * At or above this share of the target, the machine is keeping up.
 *
 * It used to want 1.35 — thirty-five per cent *more* than the target — before
 * it would climb, as headroom against a machine on the boundary flapping
 * between two tiers. With the default target of 60 that asks for 81 fps, and
 * vsync caps a 60 Hz display at 60. So on the ordinary case the raise
 * condition was unreachable and the tier was a one-way ratchet: every dip
 * dropped it, nothing ever brought it back, and it walked down to Low and
 * stayed there. That is "it flickers to super low quality", and it is also why
 * ground that was sharp goes blurry and stays blurry — Low is a smaller
 * texture budget and less anisotropy.
 *
 * The headroom is still there; it is measured in time now rather than in
 * frames per second, which is the axis that is not capped. Hitting the target
 * for one window proves nothing, so it takes several in a row.
 */
const RAISE_AT = 0.97;
/** Consecutive good windows before climbing. Four seconds each. */
const RAISE_WINDOWS = 3;
/**
 * How much longer that run has to be to climb back into a tier this machine
 * has already been dropped out of.
 *
 * This is where the anti-flap lives now. A machine sitting exactly on a
 * boundary will climb, fail, drop, and climb again for ever if every attempt
 * costs the same; remembering the tier that did not hold makes the second
 * attempt expensive and the third one no cheaper. It does not forbid the
 * climb — a machine that has genuinely got faster, because the scenery
 * stopped streaming or a heavy setting went off, still gets there.
 */
const BURNT_FACTOR = 3;

export class AutoQuality {
  constructor() {
    this.window = 0;
    this.frames = 0;
    this.cooldown = 0;
    this.lastChange = null;
    /** Consecutive windows that met the target. See RAISE_WINDOWS. */
    this.good = 0;
    /** The tier this machine was last dropped out of. See BURNT_FACTOR. */
    this.burnt = null;
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
    if (fps < target * DROP_BELOW) {
      next = Math.max(0, index - 1);
      if (next !== index) this.burnt = current;
      this.good = 0;
    } else if (fps >= target * RAISE_AT) {
      this.good++;
      const up = Math.min(TIERS.length - 1, index + 1);
      const needed = TIERS[up] === this.burnt ? RAISE_WINDOWS * BURNT_FACTOR : RAISE_WINDOWS;
      if (this.good >= needed) {
        next = up;
        // Earned its way back in; the mark has done its job. Leaving it set
        // would go on charging for a tier this machine has just held.
        if (TIERS[up] === this.burnt) this.burnt = null;
      }
    } else {
      // Between the two: keeping up well enough to stay, not well enough to
      // count towards climbing. The run has to be unbroken or a machine that
      // meets the target every other window would climb on the strength of
      // half its evidence.
      this.good = 0;
    }
    if (next === index) return null;

    settings.set('autoTier', TIERS[next]);
    this.cooldown = COOLDOWN_S;
    this.good = 0;
    this.lastChange = { from: current, to: TIERS[next], fps: Math.round(fps) };
    return this.lastChange;
  }
}

export const TIER_ORDER = TIERS;

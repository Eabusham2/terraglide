import { settings } from './settings.js';

/**
 * Choosing the graphics preset by measuring instead of guessing.
 *
 * A benchmark you run once at startup measures a menu, an empty sky or
 * whatever happened to be on screen for two seconds — none of which is what
 * the game costs. The honest test is the game itself, so this watches the real
 * frame clock and moves the preset when the machine has been telling you the
 * same thing for long enough to believe it.
 *
 * It sits *above* the resolution governor rather than beside it. That one
 * absorbs the small stuff by rendering fewer pixels, which is the cheapest
 * thing to give up and the first thing to take back; this one only acts once
 * that has run out of room — the scale is on the floor and the frames are
 * still late, or the scale is back at full and there is real headroom spare.
 * Two knobs both reacting to the same overshoot would fight.
 *
 * The rest is hysteresis, because the failure mode of anything adaptive is
 * hunting. Dropping a tier is quick and taking one back is slow; a tier that
 * has proved too heavy becomes a ceiling, so the loop cannot climb straight
 * back into it; and the ceiling forgets after a couple of minutes, because
 * flying into a city is not the same fact about your machine as flying out of
 * one again.
 */

/** Lightest first. The order is the ladder. */
export const TIERS = ['low', 'medium', 'high', 'ultra'];

/** Seconds over budget, with nothing left to give, before dropping a tier. */
const DROP_AFTER_S = 8;
/** Seconds of real headroom before taking one back. Deliberately far longer. */
const RAISE_AFTER_S = 22;
/** Quiet period after any change, so a tier is judged on its own frames. */
const SETTLE_S = 12;
/** How long a tier stays marked too heavy. */
const CEILING_MEMORY_S = 150;
/** Late enough to count as late, and early enough to count as spare. */
const LATE = 1.25;
const SPARE = 0.72;

export class AutoQuality {
  constructor() {
    this.overFor = 0;
    this.underFor = 0;
    this.settle = 0;
    /** Index of the lightest tier known to be too heavy, or null. */
    this.ceiling = null;
    this.ceilingAge = 0;
  }

  /**
   * @param {number} dt seconds
   * @param {{frameMs: number, scale: number}} perf the resolution governor
   * @returns {string|null} the tier just moved to, or null for no change
   */
  update(dt, perf) {
    if (!settings.get('autoQuality')) {
      this.overFor = 0;
      this.underFor = 0;
      return null;
    }

    this.settle = Math.max(0, this.settle - dt);
    if (this.ceiling !== null) {
      this.ceilingAge += dt;
      if (this.ceilingAge > CEILING_MEMORY_S) this.ceiling = null;
    }

    const budget = 1000 / Math.max(30, settings.get('fpsTarget'));
    const ms = perf.frameMs;
    // "Nothing left to give" and "room to spare" are both about the resolution
    // governor, not about the frame time alone.
    const floored = perf.scale <= 0.57;
    const full = perf.scale >= settings.get('resolutionScale') - 0.01;

    if (ms > budget * LATE && floored) {
      this.overFor += dt;
      this.underFor = 0;
    } else if (ms < budget * SPARE && full) {
      this.underFor += dt;
      this.overFor = 0;
    } else {
      // Neither: let both timers bleed off rather than resetting them, so a
      // machine that is marginal still gets there eventually.
      this.overFor = Math.max(0, this.overFor - dt);
      this.underFor = Math.max(0, this.underFor - dt);
    }

    if (this.settle > 0) return null;
    const index = TIERS.indexOf(settings.get('graphics'));
    if (index < 0) return null;

    if (this.overFor >= DROP_AFTER_S && index > 0) {
      this.ceiling = index;
      this.ceilingAge = 0;
      return this.moveTo(index - 1);
    }
    if (this.underFor >= RAISE_AFTER_S && index < TIERS.length - 1) {
      if (this.ceiling !== null && index + 1 >= this.ceiling) return null;
      return this.moveTo(index + 1);
    }
    return null;
  }

  moveTo(index) {
    const tier = TIERS[index];
    settings.set('graphics', tier);
    this.settle = SETTLE_S;
    this.overFor = 0;
    this.underFor = 0;
    return tier;
  }

  /**
   * Treat a hand-picked preset as the new starting point.
   *
   * Choosing one yourself is a statement about what you want, so it clears the
   * ceiling and the timers — otherwise picking Ultra on a machine that dropped
   * to High an hour ago would be undone within seconds and look like the
   * setting had not saved.
   */
  reset() {
    this.overFor = 0;
    this.underFor = 0;
    this.ceiling = null;
    this.settle = SETTLE_S;
  }
}

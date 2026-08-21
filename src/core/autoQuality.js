import { MIN_SCALE } from './perf.js';
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
    // The floor moved when the resolution governor stopped being allowed to
    // render a soft picture, so read it from there rather than repeating the
    // number: a stale copy here meant "nothing left to give" was never true
    // and the preset could not drop at all.
    const floored = perf.scale <= MIN_SCALE + 0.02 && distanceSpent();
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

/**
 * Has the render distance already been given up on?
 *
 * The preset is the last thing to go, because dropping a tier changes how
 * everything looks everywhere. Pulling the horizon in changes how much world
 * there is and nothing about the part of it you are looking at, so it goes
 * first — and the preset should not start dropping tiers while there is still
 * horizon to give back.
 */
function distanceSpent() {
  if (!settings.get('renderDistanceAuto')) return true;
  return settings.get('renderDistanceKm') <= AUTO_DISTANCE_MIN_KM + 0.5;
}

/** The shortest the automatic horizon will pull itself in to, in kilometres. */
export const AUTO_DISTANCE_MIN_KM = 6;
/** And the furthest it will push itself out to on its own. */
export const AUTO_DISTANCE_MAX_KM = 256;
/** Seconds late before the horizon comes in; seconds spare before it goes out. */
const DISTANCE_DROP_AFTER_S = 3;
const DISTANCE_RAISE_AFTER_S = 6;
/** Quiet period after a move, so the new distance is judged on its own frames. */
const DISTANCE_SETTLE_S = 4;

/**
 * Choosing how far you can see by measuring, the same way the preset is chosen.
 *
 * "Auto" for a distance means something different from auto for a preset: there
 * is no ladder of named steps, just a number, and the useful behaviour is to
 * keep pushing the horizon out while the machine can still afford it and pull
 * it back the moment it cannot. So this walks the number by a fifth at a time
 * in both directions, quickly inward and slowly outward, and stops climbing
 * once a distance has proved too expensive.
 *
 * It sits between the resolution governor and the preset: pixels are given up
 * first because they cost the least to lose, then world, then detail.
 */
export class AutoDistance {
  constructor() {
    this.overFor = 0;
    this.underFor = 0;
    this.settle = 0;
    /** The shortest distance known to be too expensive, or null. */
    this.ceilingKm = null;
    this.ceilingAge = 0;
    /** The last distance this governor wrote, so its own writes are known. */
    this.lastSet = null;
  }

  /** Was this value written by the governor rather than by a person? */
  wrote(km) {
    return this.lastSet !== null && km === this.lastSet;
  }

  /**
   * @param {number} dt seconds
   * @param {{frameMs: number, scale: number}} perf the resolution governor
   * @returns {number|null} the distance just moved to, in km, or null
   */
  update(dt, perf) {
    if (!settings.get('renderDistanceAuto')) {
      this.overFor = 0;
      this.underFor = 0;
      return null;
    }
    this.settle = Math.max(0, this.settle - dt);
    if (this.ceilingKm !== null) {
      this.ceilingAge += dt;
      if (this.ceilingAge > CEILING_MEMORY_S) this.ceilingKm = null;
    }

    const budget = 1000 / Math.max(30, settings.get('fpsTarget'));
    const ms = perf.frameMs;
    const floored = perf.scale <= MIN_SCALE + 0.02;
    const full = perf.scale >= settings.get('resolutionScale') - 0.01;

    if (ms > budget * LATE && floored) {
      this.overFor += dt;
      this.underFor = 0;
    } else if (ms < budget * SPARE && full) {
      this.underFor += dt;
      this.overFor = 0;
    } else {
      this.overFor = Math.max(0, this.overFor - dt);
      this.underFor = Math.max(0, this.underFor - dt);
    }

    if (this.settle > 0) return null;
    const km = settings.get('renderDistanceKm');

    if (this.overFor >= DISTANCE_DROP_AFTER_S && km > AUTO_DISTANCE_MIN_KM) {
      this.ceilingKm = km;
      this.ceilingAge = 0;
      return this.moveTo(Math.max(AUTO_DISTANCE_MIN_KM, Math.round(km / 1.2)));
    }
    if (this.underFor >= DISTANCE_RAISE_AFTER_S && km < AUTO_DISTANCE_MAX_KM) {
      const next = Math.min(AUTO_DISTANCE_MAX_KM, Math.max(km + 2, Math.round(km * 1.2)));
      if (this.ceilingKm !== null && next >= this.ceilingKm) return null;
      return this.moveTo(next);
    }
    return null;
  }

  moveTo(km) {
    // Remembered so the settings hook can tell this write apart from a hand
    // on the slider. Without it the governor's own move looked like you had
    // set the distance yourself, which cleared the ceiling it had just learned
    // and let it climb straight back into a distance it knew was too far.
    this.lastSet = km;
    settings.set('renderDistanceKm', km);
    this.settle = DISTANCE_SETTLE_S;
    this.overFor = 0;
    this.underFor = 0;
    return km;
  }

  /** Setting the distance by hand is a statement; take it as the new start. */
  reset() {
    this.overFor = 0;
    this.underFor = 0;
    this.ceilingKm = null;
    this.settle = DISTANCE_SETTLE_S;
  }
}

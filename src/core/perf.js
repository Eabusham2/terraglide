import { clamp } from './math.js';
import { settings } from './settings.js';

/**
 * Frame timing plus an adaptive resolution governor. The governor nudges the
 * render scale so heavy scenes stay smooth instead of dropping frames — the
 * "no lag" requirement is mostly this plus tile budgets.
 *
 * It will not go below MIN_SCALE, and that floor is deliberately high. Pixels
 * are the cheapest thing to give up right up until the point where the picture
 * starts looking like a different, worse game: below about three quarters the
 * stretch back to screen size is plainly visible, edges crawl, and distant
 * ground turns to mush. Past that floor the tile budgets and the graphics
 * preset give things up instead, because a smaller world drawn sharply looks
 * far better than the whole world drawn softly.
 */
export const MIN_SCALE = 0.75;
export class PerfGovernor {
  constructor() {
    this.fps = 60;
    this.frameMs = 16.7;
    this.scale = 1;
    this.samples = [];
    this.cooldown = 0;
    this.smoothedMs = 16.7;
  }

  update(dtSeconds) {
    const ms = dtSeconds * 1000;
    this.smoothedMs = this.smoothedMs * 0.9 + ms * 0.1;
    this.frameMs = this.smoothedMs;
    this.fps = 1000 / Math.max(this.smoothedMs, 0.001);

    this.samples.push(ms);
    if (this.samples.length > 90) this.samples.shift();

    const target = settings.get('resolutionScale');
    if (!settings.get('adaptiveResolution')) {
      this.scale = target;
      return;
    }

    this.cooldown -= dtSeconds;
    if (this.cooldown > 0 || this.samples.length < 45) return;
    this.cooldown = 0.6;

    const budget = 1000 / Math.max(30, settings.get('fpsTarget'));
    const sorted = [...this.samples].sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)] ?? budget;

    if (p80 > budget * 1.25) this.scale = clamp(this.scale - 0.05, MIN_SCALE, target);
    else if (p80 < budget * 0.75) this.scale = clamp(this.scale + 0.05, MIN_SCALE, target);
    else this.scale = clamp(this.scale, MIN_SCALE, target);
  }

  /** Milliseconds of streaming / geometry work this frame can still afford. */
  budgetMs() {
    const target = 1000 / Math.max(30, settings.get('fpsTarget'));
    return clamp(target - this.smoothedMs + 4.5, 1.5, 9);
  }
}

/**
 * Fixed-timestep accumulator so physics stay identical at any frame rate.
 *
 * `maxSteps` is the catch-up ceiling, and it was six — three tenths of a
 * second. That is fine at sixty frames a second and a disaster below about
 * three, because everything past the ceiling is *thrown away*: the game clock
 * simply runs slower than the wall clock, and the whole world moves in slow
 * motion. Falling too slowly, gliding too slowly, a jump that hangs — all one
 * bug, and it only shows up on the machines least able to afford it.
 *
 * Thirty steps is a second and a half of catch-up, which covers a frame rate
 * down to about one. It is still a ceiling rather than no ceiling, because
 * without one a machine that cannot keep up spends longer simulating than
 * drawing and never recovers.
 */
export class FixedStep {
  constructor(step, maxSteps = 30) {
    this.step = step;
    this.maxSteps = maxSteps;
    this.acc = 0;
  }

  run(dt, fn) {
    this.acc += Math.min(dt, this.step * this.maxSteps);
    let steps = 0;
    while (this.acc >= this.step && steps < this.maxSteps) {
      fn(this.step);
      this.acc -= this.step;
      steps++;
    }
    if (steps === this.maxSteps) this.acc = 0;
  }

  get alpha() {
    return this.acc / this.step;
  }
}

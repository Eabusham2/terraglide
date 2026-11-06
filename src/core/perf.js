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

/**
 * The share of a frame streaming and mesh building may take when there is no
 * spare time to take instead. A quarter is visible as a cost and invisible as
 * a stall, and it is the difference between the world arriving and not.
 */
export const STREAM_SHARE = 0.25;
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

  /**
   * Milliseconds of streaming / geometry work this frame can afford.
   *
   * Two rules, and the answer is the larger of them.
   *
   * The first is spare time: whatever this frame came in under the target,
   * plus a little. That was the only rule, and on any machine that misses its
   * target it is negative — so it clamped to the 1.5 ms floor and stayed
   * there. Since the budget is spent per *frame*, a slow machine also gets
   * fewer of them, and the two compound:
   *
   *   144 fps   9.0 ms/frame   1296 ms of terrain work per second of wall clock
   *    60 fps   4.5 ms          270 ms
   *    30 fps   1.5 ms           45 ms
   *    10 fps   1.5 ms           15 ms
   *     2 fps   1.5 ms            3 ms
   *
   * A machine at 30 fps got a twenty-ninth of the loading rate of one at 144,
   * while having strictly more to load — and it is usually slow *because* the
   * world has not arrived yet. So it never arrived: the ground stayed low
   * quality for minutes, and the minimap, which does not go through this
   * budget at all, was sharp immediately. That is "ground loading is super
   * slow but the minimap is already loaded".
   *
   * The second rule is a share of the frame in front of it, which cannot go
   * negative. Work done per second of wall clock then stays roughly constant
   * however slow the machine is, and the cost is bounded: a frame grows by a
   * quarter, not by whatever it takes.
   *
   * Taking the larger means a fast machine keeps every millisecond of spare
   * time it had before — this is not a smaller budget anywhere.
   */
  budgetMs() {
    const target = 1000 / Math.max(30, settings.get('fpsTarget'));
    const spare = target - this.smoothedMs + 4.5;
    const share = this.smoothedMs * STREAM_SHARE;
    return clamp(Math.max(spare, share), 1.5, Math.max(9, share));
  }
}

/**
 * The longest frame the game will simulate, in seconds of wall clock.
 *
 * Everything past this is thrown away: the game clock runs slower than the
 * wall clock and the whole world moves in slow motion. Falling too slowly,
 * gliding too slowly, a jump that hangs, gravity that feels like it is
 * missing — all one bug, and it only shows up on the machines least able to
 * afford it.
 *
 * A second and a half covers a frame rate down to about one. It is a ceiling
 * rather than no ceiling because without one a machine that cannot keep up
 * spends longer simulating than drawing and never recovers.
 *
 * This number is exported because two places need it and they must not
 * disagree. The frame clock clamps to it; the fixed step sizes its catch-up
 * from it. They were separate numbers once — 1.5 s at the clock and 0.25 s at
 * the step — and the smaller one silently won, so the clamp was generous and
 * the physics still ran at half speed below four frames a second.
 */
export const MAX_FRAME_S = 1.5;

/**
 * Catch-up steps a fixed clock of this size needs to cover MAX_FRAME_S.
 *
 * The game-speed cheat stretches the clock, so a frame can carry that many
 * times more game seconds and needs proportionally more steps to swallow
 * them.
 */
export function catchUpSteps(step, timeScale = 1) {
  return Math.ceil((MAX_FRAME_S / step) * Math.max(1, timeScale));
}

/** Fixed-timestep accumulator so physics stay identical at any frame rate. */
export class FixedStep {
  constructor(step, maxSteps = catchUpSteps(step)) {
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

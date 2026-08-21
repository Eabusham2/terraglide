import { GRAPHICS_PRESETS, settings } from './settings.js';

/**
 * Test this machine and pick settings for it.
 *
 * The automatic version of this was worse than useless. It watched the frame
 * clock forever and moved things underneath you — the world got quietly softer
 * while you were flying it, the horizon crept in and out, and there was no way
 * to tell a machine that was struggling from a machine that had just been
 * handed a city. Worse, it made the game look bad by default on exactly the
 * hardware where you would blame the game.
 *
 * So: a button. It runs each preset for a fixed spell, measures the frames
 * that actually arrive, and stops at the heaviest one that holds the target.
 * Nothing moves unless you press it, and what it picks is what you keep.
 *
 * The measurement is the real game — the real terrain, the real shaders, the
 * real tile budget, wherever you happen to be standing. A synthetic loop would
 * measure a synthetic loop.
 */

/** Lightest first; the ladder the benchmark walks up. */
export const TIERS = ['low', 'medium', 'high', 'ultra'];
/** Seconds spent on each tier. Long enough to average out a stutter. */
const SAMPLE_S = 2.2;
/** Frames thrown away after a change, while caches and shaders settle. */
const WARMUP_FRAMES = 12;

export class Benchmark {
  constructor() {
    this.running = false;
    this.results = [];
    this.onProgress = null;
  }

  /**
   * @param {{frameMs: number}} perf the frame clock
   * @param {() => Promise<void>} nextFrame resolves on the next drawn frame
   * @param {number} targetFps frames a second to hold
   */
  async run(perf, nextFrame, targetFps = settings.get('fpsTarget')) {
    if (this.running) return null;
    this.running = true;
    const before = {
      graphics: settings.get('graphics'),
      resolutionScale: settings.get('resolutionScale'),
      detailLimit: settings.get('detailLimit'),
    };
    // Measure at full resolution and full detail, so what is being compared is
    // the preset rather than the preset times whatever else was turned down.
    settings.set('resolutionScale', 1);
    settings.set('detailLimit', 100);
    this.results = [];

    try {
      for (const tier of TIERS) {
        settings.set('graphics', tier);
        this.report(`Testing ${tier}\u2026`);
        for (let i = 0; i < WARMUP_FRAMES; i++) await nextFrame();
        let elapsed = 0;
        let frames = 0;
        let worst = 0;
        while (elapsed < SAMPLE_S) {
          const ms = await nextFrame();
          elapsed += ms / 1000;
          frames++;
          worst = Math.max(worst, ms);
        }
        const fps = frames / Math.max(elapsed, 0.001);
        this.results.push({ tier, fps, worstMs: worst });
      }
    } finally {
      settings.set('resolutionScale', before.resolutionScale);
      settings.set('detailLimit', before.detailLimit);
      this.running = false;
    }

    // The heaviest tier that held the target. If none did, the lightest one,
    // and the detail dial takes over from there.
    const held = this.results.filter((r) => r.fps >= targetFps * 0.92);
    const pick = held.length > 0 ? held[held.length - 1] : this.results[0];
    settings.set('graphics', pick.tier);
    if (held.length === 0) {
      // Nothing held even at Low. Give the detail dial the difference rather
      // than leaving the frame rate on the floor.
      const ratio = pick.fps / Math.max(targetFps, 1);
      settings.set('detailLimit', Math.max(25, Math.round((ratio * 100) / 5) * 5));
    }
    this.report(null);
    return { pick: pick.tier, results: this.results };
  }

  report(status) {
    this.status = status;
    if (this.onProgress) this.onProgress(status, this.results);
  }
}

/** Every preset name, for the settings menu. */
export const PRESET_NAMES = Object.keys(GRAPHICS_PRESETS);

/**
 * Turning a wheel event into whole steps.
 *
 * Two things make a raw `deltaY` a bad thing to zoom with. It arrives in three
 * different units depending on the device and the browser — pixels, lines or
 * pages — so one notch of a mouse wheel is 100 on one machine and 3 on
 * another. And a trackpad sends a stream of small deltas for one flick of two
 * fingers, so anything that steps once per event flies through the whole zoom
 * range before you have finished the gesture.
 *
 * So: normalise to notches, accumulate, and hand back whole steps only when
 * enough has piled up. The remainder stays for next time, which is what makes
 * a slow trackpad drag move by exactly one level rather than by nothing.
 */

/** Roughly one notch of a mouse wheel, in each of the three delta units. */
const PER_UNIT = [100, 3, 1];

export class WheelSteps {
  /** @param {number} perStep notches of wheel per step returned. */
  constructor(perStep = 1) {
    this.perStep = perStep;
    this.accumulated = 0;
    this.lastAt = 0;
  }

  /**
   * @param {WheelEvent} event
   * @returns {number} whole steps to apply — positive is "up", i.e. zoom in.
   */
  read(event) {
    // A gap means a new gesture; a half-spent notch from thirty seconds ago
    // should not add itself to this one.
    const now = event.timeStamp || performance.now();
    if (now - this.lastAt > 400) this.accumulated = 0;
    this.lastAt = now;

    const unit = PER_UNIT[event.deltaMode] ?? PER_UNIT[0];
    // Cap the contribution of any single event: some browsers send one
    // enormous delta for a fast flick, and one flick should not be ten levels.
    const notches = Math.max(-3, Math.min(3, -event.deltaY / unit));
    this.accumulated += notches;

    const steps = Math.trunc(this.accumulated / this.perStep);
    if (steps !== 0) this.accumulated -= steps * this.perStep;
    return steps;
  }
}

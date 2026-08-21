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
 * So: normalise to notches, and then treat the two devices as the two things
 * they are. A wheel arrives in whole clicks and every click acts, however
 * slowly it is turned — however big the browser says a click is, because that
 * is 100 on most machines, 120 on Windows and 53 in a few. A trackpad arrives
 * in fragments and those are added up, so one flick moves a level rather than
 * twenty; the remainder stays for next time, which is what makes a slow
 * two-finger drag move by exactly one level rather than by nothing.
 */

/** Roughly one notch of a mouse wheel, in each of the three delta units. */
const PER_UNIT = [100, 3, 1];
/**
 * A single event this big is a wheel click rather than a fragment of a swipe.
 * Generous, because "one notch" is 100 on most machines, 120 on Windows and
 * 53 in a few browsers, while a trackpad's fragments are a handful of pixels.
 */
const DISCRETE = 0.4;
/** A gap longer than this ends the gesture, so leftovers do not carry over. */
const STALE_MS = 1200;

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
    // A gap means a new gesture; a half-spent notch from a minute ago should
    // not add itself to this one.
    const now = event.timeStamp || performance.now();
    if (now - this.lastAt > STALE_MS) this.accumulated = 0;
    this.lastAt = now;

    const unit = PER_UNIT[event.deltaMode] ?? PER_UNIT[0];
    // Cap the contribution of any single event: some browsers send one
    // enormous delta for a fast flick, and one flick should not be ten levels.
    const notches = Math.max(-3, Math.min(3, -event.deltaY / unit));

    // The size of a single event is what tells the two devices apart. A click
    // is rounded to whole clicks and acts immediately: accumulating those was
    // worse than not accumulating at all, because a deliberate
    // one-click-at-a-time scroll never reached the threshold and the map
    // simply never zoomed. Fragments are added up instead.
    const discrete = Math.abs(notches) >= DISCRETE;
    const threshold = discrete ? 1 : this.perStep;
    this.accumulated += discrete
      ? Math.sign(notches) * Math.max(1, Math.round(Math.abs(notches)))
      : notches;

    const steps = Math.trunc(this.accumulated / threshold);
    if (steps !== 0) this.accumulated -= steps * threshold;
    return steps;
  }
}

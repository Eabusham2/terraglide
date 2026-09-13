/**
 * What this machine can probably manage, for the first run only.
 *
 * The graphics preset defaulted to "high" for everybody, which is a guess that
 * happens to be right on a desktop and wrong on the machines that most need it
 * to be right. A low-end Chromebook would start at high, run at single-figure
 * frame rates, and the auto-quality dial would then spend a minute climbing
 * down from a place it should never have started — with the first minute of
 * play, the one that decides whether the thing is worth using at all, spent
 * stuttering.
 *
 * Nothing here is a benchmark. It reads what the browser already knows: how
 * much memory it will admit to, how many cores, and what the GPU calls itself.
 * Those are coarse and sometimes absent, and that is fine, because the answer
 * only has to be better than assuming a gaming desktop — and auto-quality
 * measures the real frame clock from there.
 *
 * First run only. Once the setting has been chosen, by you or by auto-quality,
 * this is never consulted again.
 */

/** Substrings that mean integrated, mobile or software rendering. */
const MODEST_GPUS = [
  'swiftshader', 'llvmpipe', 'software', 'mesa', 'basic render',
  'mali', 'adreno', 'powervr', 'videocore',
  'intel hd', 'intel(r) hd', 'uhd graphics', 'gma',
];

/** @returns {string} the unmasked renderer string, lowercased, or '' */
export function gpuName(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return String(name ?? '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * @param {{ gpu?: string, memoryGB?: number, cores?: number, touch?: boolean }} probe
 * @returns {'low'|'medium'|'high'|'ultra'}
 */
export function tierFrom({ gpu = '', memoryGB = 0, cores = 0, touch = false } = {}) {
  const modestGpu = MODEST_GPUS.some((needle) => gpu.includes(needle));
  // deviceMemory is capped at 8 by the spec and absent on Safari, so a zero
  // means "did not say" rather than "has none".
  const smallMemory = memoryGB > 0 && memoryGB <= 4;
  const fewCores = cores > 0 && cores <= 4;

  // Software rendering is not a tier, it is a warning. Nothing above low is
  // going to produce a playable frame.
  if (gpu.includes('swiftshader') || gpu.includes('llvmpipe') || gpu.includes('software')) return 'low';
  // Two of the three signals agreeing is enough. One alone is too easy to get
  // wrong: plenty of good laptops report four cores, and plenty of browsers
  // decline to report memory at all.
  const marks = (modestGpu ? 1 : 0) + (smallMemory ? 1 : 0) + (fewCores ? 1 : 0);
  if (marks >= 2) return 'low';
  if (marks === 1) return 'medium';
  // A touch device with nothing else against it is still a phone or a tablet.
  if (touch) return 'medium';
  return 'high';
}

/** Read the probe from this browser. `gl` may be null; the rest still counts. */
export function detectTier(gl) {
  return tierFrom({
    gpu: gl ? gpuName(gl) : '',
    memoryGB: Number(navigator?.deviceMemory ?? 0),
    cores: Number(navigator?.hardwareConcurrency ?? 0),
    touch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  });
}

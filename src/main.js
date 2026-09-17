import { Game } from './game.js';

/**
 * Entry point. Starts the game, and if the browser cannot run it, says exactly
 * why instead of leaving a black rectangle.
 */

const canvas = document.getElementById('viewport');
const ui = document.getElementById('ui');
const boot = document.getElementById('boot');
const bootStatus = document.getElementById('boot-status');

/**
 * The stage is published as well as shown, because the watchdog in index.html
 * is the only thing still running when this file is not, and "how far did it
 * get" is the difference between two completely different faults. A screen
 * frozen with no stage means the module graph never finished and the code
 * never ran; a screen frozen at a named stage means the code arrived, ran, and
 * stopped somewhere specific. Telling a player the network is at fault in the
 * second case is a wrong answer delivered confidently, which is the thing this
 * boot path already got wrong once.
 */
function status(message) {
  window.__terraglideStage = message;
  if (bootStatus) bootStatus.textContent = message;
}

function fail(title, detail) {
  // Said out loud, so the watchdog does not paste a second, vaguer explanation
  // over a specific one that is already on screen.
  window.__terraglideSpoke = true;
  if (!boot) return;
  boot.classList.remove('done');
  boot.innerHTML = `
    <div class="boot-inner">
      <h1>TerraGlide</h1>
      <p id="boot-status">${escape(title)}</p>
      <p style="max-width:46ch;color:#767d87;font-size:12px;line-height:1.5">${escape(detail)}</p>
    </div>`;
}

function escape(value) {
  return String(value).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

function checkSupport() {
  if (!window.WebGL2RenderingContext) return 'This browser has no WebGL 2.';
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2');
  if (!gl) return 'WebGL 2 is present but the browser refused to create a context — check hardware acceleration.';
  if (typeof createImageBitmap !== 'function') return 'createImageBitmap is unavailable.';
  // There used to be a refusal here for any file:// page that was not the
  // bundled build, on the grounds that browsers block ES modules over file://.
  // That is true of modules *beside* the document and false of the online
  // single file, which is one small local page whose modules come over HTTPS
  // from the published site — and this function only runs at all because those
  // modules resolved. The check was refusing to start a page that had already
  // proved it could. What genuinely cannot start on file:// is a same-origin
  // Web Worker, and createTileWorker has handled that for a long time: a
  // same-origin blob that imports the real one, and an in-page host behind it.
  return null;
}

async function main() {
  const problem = checkSupport();
  if (problem) {
    fail('Cannot start', problem);
    return;
  }

  try {
    const game = new Game({ canvas, ui, onStatus: status });
    window.terraglide = game; // handy from the console; not required by anything
    await game.start();
    // The watchdog used to key on `window.terraglide`, which is set on the line
    // above — before start() has done anything. So for the whole of start(),
    // and for ever if anything in it failed to settle, the one thing built to
    // notice a dead boot was disarmed: the screen sat on its last stage with no
    // message and no way out. Proved by hanging start(): at thirty seconds the
    // status still read "Building interface" and the watchdog had not fired.
    // This flag means what the watchdog is actually asking about.
    window.__terraglideStarted = true;
    status('Ready');
    boot?.classList.add('done');
    setTimeout(() => boot?.remove(), 600);
  } catch (err) {
    console.error(err);
    fail('Something went wrong while starting', err && err.message ? err.message : String(err));
  }
}

main();

import { Game } from './game.js';

/**
 * Entry point. Starts the game, and if the browser cannot run it, says exactly
 * why instead of leaving a black rectangle.
 */

const canvas = document.getElementById('viewport');
const ui = document.getElementById('ui');
const boot = document.getElementById('boot');
const bootStatus = document.getElementById('boot-status');

function status(message) {
  if (bootStatus) bootStatus.textContent = message;
}

function fail(title, detail) {
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
  if (typeof Worker === 'undefined') return 'Web Workers are unavailable.';
  if (typeof createImageBitmap !== 'function') return 'createImageBitmap is unavailable.';
  if (location.protocol === 'file:') {
    return 'Opened straight from the file system. Browsers block ES modules and workers over file://, so serve the folder over HTTP instead (see the README).';
  }
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
    status('Ready');
    boot?.classList.add('done');
    setTimeout(() => boot?.remove(), 600);
  } catch (err) {
    console.error(err);
    fail('Something went wrong while starting', err && err.message ? err.message : String(err));
  }
}

main();

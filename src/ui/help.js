import { keybinds } from '../core/keybinds.js';
import { settings } from '../core/settings.js';
import { readJSON, writeJSON } from '../core/storage.js';
import { escapeHtml } from './worldmap.js';

/** The controls card. Shown on a first visit, and any time you press the help key. */

const SEEN_KEY = 'seen-intro';

const ROWS = [
  ['Move', ['forward', 'left', 'back', 'right']],
  ['Sprint / crouch', ['sprint', 'crouch']],
  ['Jump \u2014 press again once airborne to open the wings', ['jump']],
  ['Fire a rocket — opens the wings for you (or use the mouse)', ['rocket']],
  ['Swim — jump to rise, crouch to dive', ['jump', 'crouch']],
  ['Speed mode — 2x for a while, then a cooldown', ['speedMode']],
  ['Open or stow the wings \u2014 works any time you are off the ground', ['wings']],
  ['Random teleport', ['rtp']],
  ['World map', ['worldMap']],
  ['Drop a waypoint', ['waypoint']],
  ['Copy coordinates', ['copyCoords']],
  ['Minimap zoom', ['minimapZoomOut', 'minimapZoomIn']],
  ['Freecam \u2014 the wheel changes its speed', ['freecam']],
  ['Change perspective', ['perspective']],
  ['Grow / shrink', ['scaleDown', 'scaleUp']],
  ['Swap mouse mode', ['mouseMode']],
  ['Rockets I to V', ['hotbar1', 'hotbar5']],
  ['Pause the world where it is', ['pause']],
  ['Settings', ['settings']],
];

export class HelpCard {
  constructor(root) {
    this.element = document.createElement('div');
    this.element.className = 'panel help';
    this.element.hidden = true;
    root.appendChild(this.element);
    this.open = false;

    this.element.addEventListener('click', (event) => {
      if (event.target.closest('[data-close]')) this.close();
    });
    // Rebind a key with the card open and the card should say the new key,
    // not the one it was built with.
    keybinds.on('change', () => {
      if (this.open) this.render();
    });
  }

  get firstRun() {
    return !readJSON(SEEN_KEY, false);
  }

  markSeen() {
    writeJSON(SEEN_KEY, true);
  }

  render() {
    const mouse =
      settings.get('mouseMode') === 'locked'
        ? 'Pointer is locked: move the mouse to look, <strong>either mouse button</strong> fires a rocket.'
        : settings.get('swapMouseButtons')
          ? 'Click and pan: <strong>drag with right</strong> to look, <strong>left click</strong> boosts, a plain right click lands.'
          : 'Click and pan: <strong>drag with left</strong> to look, <strong>right click</strong> boosts, a plain left click lands.';

    this.element.innerHTML = `
      <div class="panel-head">
        <h2>TerraGlide</h2>
        <button type="button" class="panel-close" data-close>Close</button>
      </div>
      <div class="help-body">
        <p class="help-lead">
          Fly the real world. Press <kbd>${escapeHtml(keybinds.labelFor('rtp'))}</kbd> to be dropped somewhere at random,
          open the wings and glide — dive to build speed, flare to trade it back for height, and use a rocket when
          you run out of either. You are ${escapeHtml(heightLabel())} tall and you can grow.
        </p>
        <p class="help-mouse">${mouse}</p>
        <div class="help-grid">
          ${ROWS.map(
            ([label, actions]) => `
              <div class="help-row">
                <span class="help-keys">${actions
                  .map((a) => `<kbd>${escapeHtml(keybinds.labelFor(a))}</kbd>`)
                  .join('')}</span>
                <span>${label}</span>
              </div>`,
          ).join('')}
        </div>
        <p class="help-note">
          Satellite imagery and elevation work with no account at all. <strong>Settings → Providers</strong>
          swaps in Google, Azure or Mapbox if you have a key. With no network there is nothing to fly
          over: the ground stays bare rather than being made up.
        </p>
        <p class="help-note">
          On a touch screen the on-screen stick and buttons appear by themselves. To play with no internet
          at all, download <a href="./terraglide.html" download>terraglide.html</a> — one file, opens by
          double-clicking, no server needed.
        </p>
      </div>`;
  }

  show() {
    this.render();
    this.open = true;
    this.element.hidden = false;
    this.markSeen();
  }

  close() {
    this.open = false;
    this.element.hidden = true;
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }
}

function heightLabel() {
  const metres = settings.get('playerHeightM');
  const inches = Math.round((metres / 0.3048) * 12);
  return `${Math.floor(inches / 12)} ft ${inches % 12} in`;
}

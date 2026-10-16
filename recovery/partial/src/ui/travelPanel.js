import { BOOT, ONLINE, relaunch } from '../core/boot.js';
import { settings } from '../core/settings.js';
import { formatDistance, formatTemperature } from '../core/units.js';
import { BODIES, BODY, aeroFactor, gravityRatio } from '../geo/bodies.js';
import { escapeHtml } from './worldmap.js';
import { BODIES_WITH_ELEVATION, PARTIAL_ELEVATION, PLANETARY_SOURCES } from '../tiles/providers.js';

/**
 * Other worlds.
 *
 * Every body you can stand on, what it is like there — how hard it pulls, how
 * much air there is to fly in, how cold it is — and a button to go. Going is
 * a reload into the new world (see core/boot.js): a second of launch screen,
 * and you arrive at a real landing site with a full tank of oxygen.
 *
 * Online the server decides, because the server keeps where you are; locally
 * you just go, and each world keeps its own save — the Moon's craters never
 * turn up on your map of Earth.
 */
export class TravelPanel {
  constructor(root, { session = null, canLeave = () => true } = {}) {
    this.session = session;
    this.canLeave = canLeave;
    this.open = false;
    this.element = document.createElement('div');
    this.element.className = 'panel travel-panel';
    this.element.hidden = true;
    root.appendChild(this.element);
    this.element.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      button.blur();
      if (button.dataset.action === 'close') this.close();
      if (button.dataset.action === 'go') this.go(button.dataset.world);
    });
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.close();
      }
    });
  }

  show() {
    this.open = true;
    this.element.hidden = false;
    this.render();
  }

  close() {
    this.open = false;
    this.element.hidden = true;
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  go(world) {
    if (!BODIES[world] || world === BOOT.world) return;
    const why = this.canLeave();
    if (why !== true) {
      this.onNotice?.(why);
      return;
    }
    this.close();
    if (ONLINE && this.session) this.session.travel(world);
@@MISSING 69@@
@@MISSING 70@@
@@MISSING 71@@
@@MISSING 72@@
@@MISSING 73@@
@@MISSING 74@@
@@MISSING 75@@
@@MISSING 76@@
@@MISSING 77@@
@@MISSING 78@@
@@MISSING 79@@
@@MISSING 80@@
@@MISSING 81@@
@@MISSING 82@@
@@MISSING 83@@
@@MISSING 84@@
@@MISSING 85@@
@@MISSING 86@@
@@MISSING 87@@
@@MISSING 88@@
@@MISSING 89@@
@@MISSING 90@@
@@MISSING 91@@
@@MISSING 92@@
@@MISSING 93@@
@@MISSING 94@@
@@MISSING 95@@
@@MISSING 96@@
@@MISSING 97@@
@@MISSING 98@@
@@MISSING 99@@
@@MISSING 100@@
@@MISSING 101@@
@@MISSING 102@@
@@MISSING 103@@
@@MISSING 104@@
@@MISSING 105@@
@@MISSING 106@@
@@MISSING 107@@
@@MISSING 108@@
@@MISSING 109@@
@@MISSING 110@@
@@MISSING 111@@
@@MISSING 112@@
@@MISSING 113@@
@@MISSING 114@@
@@MISSING 115@@
@@MISSING 116@@
@@MISSING 117@@
@@MISSING 118@@
@@MISSING 119@@
@@MISSING 120@@
@@MISSING 121@@
@@MISSING 122@@
@@MISSING 123@@
@@MISSING 124@@
@@MISSING 125@@
@@MISSING 126@@
@@MISSING 127@@
@@MISSING 128@@
@@MISSING 129@@
@@MISSING 130@@
@@MISSING 131@@
@@MISSING 132@@
@@MISSING 133@@
@@MISSING 134@@
@@MISSING 135@@
@@MISSING 136@@
@@MISSING 137@@
@@MISSING 138@@
@@MISSING 139@@
@@MISSING 140@@
@@MISSING 141@@
@@MISSING 142@@
@@MISSING 143@@
@@MISSING 144@@
@@MISSING 145@@
@@MISSING 146@@
@@MISSING 147@@
@@MISSING 148@@
@@MISSING 149@@
@@MISSING 150@@
@@MISSING 151@@
@@MISSING 152@@
@@MISSING 153@@
@@MISSING 154@@
@@MISSING 155@@
@@MISSING 156@@
@@MISSING 157@@
@@MISSING 158@@
@@MISSING 159@@
@@MISSING 160@@
@@MISSING 161@@
@@MISSING 162@@
@@MISSING 163@@
@@MISSING 164@@
@@MISSING 165@@
@@MISSING 166@@
@@MISSING 167@@
@@MISSING 168@@
@@MISSING 169@@
@@MISSING 170@@
@@MISSING 171@@
@@MISSING 172@@
@@MISSING 173@@

import { BOOT, ONLINE, relaunch } from '../core/boot.js';
import { settings } from '../core/settings.js';
import { formatTemperature } from '../core/units.js';
import { BODIES, BODY, aeroFactor, gravityRatio } from '../geo/bodies.js';
import { escapeHtml } from './worldmap.js';

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
    else relaunch({ world, reason: `Travelling to ${BODIES[world].name}` });
  }

  render() {
    const units = settings.get('units');
    const cards = Object.values(BODIES).map((body) => {
      const here = body.id === BODY.id;
      const g = gravityRatio(body);
      const air = aeroFactor(body);
      const airText = body.density === 0 ? 'no air — wings useless'
        : air < 0.1 ? `${(body.density / 1.225 * 100).toFixed(1)}% of Earth's air`
          : body.density > 1.225 ? `${(body.density / 1.225).toFixed(0)}x Earth's air`
            : 'breathable air';
      const temp = body.tempC == null ? 'seasons' : formatTemperature(body.tempC, units);
      return `
        <li class="travel-card${here ? ' here' : ''}" data-sky="${body.sky}">
          <div class="travel-name"><strong>${escapeHtml(body.name)}</strong>
            <span>${escapeHtml(body.spawn.label)}</span></div>
          <p>${escapeHtml(body.blurb)}</p>
          <dl>

            <dt>Gravity</dt><dd>${g >= 0.1 ? `${g.toFixed(2)}g` : `${(g * 100).toFixed(1)}% g`}</dd>
            <dt>Air</dt><dd>${airText}</dd>
            <dt>Surface</dt><dd>${escapeHtml(temp)}</dd>
            <dt>Oxygen</dt><dd>${body.breathable ? 'breathe freely' : 'suit tank, refill at your lander'}</dd>
          </dl>
          ${here ? '<em>You are here</em>' : `<button type="button" class="primary" data-action="go" data-world="${body.id}">Travel</button>`}
        </li>`;
    }).join('');
    this.element.innerHTML = `
      <div class="panel-head">
        <h2>Worlds</h2>
        <button type="button" class="panel-close" data-action="close">Close</button>
      </div>
      <div class="travel-body">
        <p class="travel-intro">Real photography and real altimetry from NASA's missions, on the body's own radius,
          at its own gravity. ${ONLINE ? 'Everyone on the server who is on the same world is there with you.' : 'Each world keeps its own explored map and trail.'}</p>
        <ul class="travel-list">${cards}</ul>
      </div>`;
  }
}
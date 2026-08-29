import { CHEAT_DEFAULTS, cheats } from '../core/cheats.js';
import { PLACES } from '../world/places.js';
import { waypoints } from './waypoints.js';

/**
 * The cheat panel.
 *
 * Same flat panel as everything else — this is a set of dials, not a different
 * game. The line at the top is the important one: none of it is written down, so
 * a reload puts it all back, while everywhere you went stays on the map.
 */

const DIALS = [
  {
    key: 'playerSpeed',
    label: 'Player speed',
    min: 0.1,
    max: 12,
    step: 0.1,
    help: 'Multiplies how far you travel — walking, swimming and flying alike.',
  },
  {
    key: 'gameSpeed',
    label: 'Game speed',
    min: 0.1,
    max: 8,
    step: 0.1,
    help: 'Runs the whole clock faster or slower. Everything moves with it.',
  },
  {
    key: 'rocketPower',
    label: 'Rocket strength',
    min: 0.1,
    max: 12,
    step: 0.1,
    help: 'Multiplies firework thrust. Past about 4x a Rocket V leaves the troposphere.',
  },
  {
    key: 'playerScale',
    label: 'Size',
    min: 0.25,
    max: 40,
    step: 0.05,
    help: 'How big you are, as a multiple of your height setting. The size keys move'
      + ' this too; the slider goes the whole range in one drag. Everything follows it'
      + ' \u2014 stride, eye height, reach and the collision capsule \u2014 so a quarter-size'
      + ' player really does fit where a full-size one does not.',
  },
];

const SWITCHES = [
  { key: 'fly', label: 'Fly', help: 'Creative flight: no gravity, and you go wherever you look.' },
  { key: 'noclip', label: 'Noclip', help: 'Through walls, through the ground, through mountains.' },
  { key: 'mapUnlocked', label: 'Unlock the whole map', help: 'Shows every tile without having been there. Your real explored ground is untouched underneath.' },
  { key: 'speedFree', label: 'Unlimited surge', help: 'The boost never runs out and never needs to recharge.' },
];

export class CheatPanel {
  constructor(root) {
    this.open = false;
    this.onTeleport = null;
    this.onTravel = null;
    this.onStopTravel = null;
    this.onNotice = null;

    this.element = document.createElement('div');
    this.element.className = 'panel cheats';
    this.element.hidden = true;
    root.appendChild(this.element);

    this.element.addEventListener('click', (event) => {
      if (event.target.closest('[data-close]')) this.close();
    });

    cheats.on('change', () => {
      if (this.open) this.sync();
    });
    cheats.on('unlock', (unlocked) => {
      if (!unlocked) this.close();
    });
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    if (!cheats.unlocked) return;
    this.open = true;
    this.element.hidden = false;
    this.render();
  }

  close() {
    this.open = false;
    this.element.hidden = true;
  }

  render() {
    this.element.innerHTML = `
      <div class="panel-head">
        <h2>Cheats</h2>
        <button type="button" class="panel-close" data-close>Close</button>
      </div>
      <div class="cheats-body">
        <p class="settings-intro">
          None of this is saved. Reload the page and every dial here is back to normal —
          while explored ground, waypoints and your trail are kept exactly as they were.
        </p>

        ${DIALS.map(
          (dial) => `
          <div class="field field-range">
            <label for="cheat-${dial.key}">${escape(dial.label)}</label>
            <span class="range">
              <input type="range" id="cheat-${dial.key}" data-dial="${dial.key}"
                     min="${dial.min}" max="${dial.max}" step="${dial.step}" value="${cheats[dial.key]}" />
              <output data-out="${dial.key}">${format(cheats[dial.key])}</output>
            </span>
            <small>${escape(dial.help)}</small>
          </div>`,
        ).join('')}

        ${SWITCHES.map(
          (row) => `
          <div class="field field-toggle">
            <label for="cheat-${row.key}">${escape(row.label)}</label>
            <input type="checkbox" id="cheat-${row.key}" data-switch="${row.key}" ${cheats[row.key] ? 'checked' : ''} />
            <small>${escape(row.help)}</small>
          </div>`,
        ).join('')}

        <h3>Go somewhere</h3>
        <p class="settings-intro">
          Coordinates, one of your waypoints, or the name of a city. <strong>Teleport</strong> puts you
          there now; <strong>auto-travel</strong> flies you there on the wings, which fills the map in
          on the way.
        </p>
        <div class="cheat-goto">
          <input type="text" data-destination list="cheat-places" placeholder="48.8566, 2.3522 — or Paris" spellcheck="false" />
          <button type="button" data-go="teleport">Teleport</button>
          <button type="button" data-go="travel">Auto-travel</button>
        </div>
        <datalist id="cheat-places">
          ${[...waypoints.waypoints.map((w) => w.name), ...PLACES.map((p) => p[0])]
            .map((name) => `<option value="${escape(name)}"></option>`)
            .join('')}
        </datalist>
        <div class="cheat-status" data-status hidden></div>

        <div class="settings-actions">
          <button type="button" data-stop>Stop auto-travel</button>
          <button type="button" data-reset>Reset cheats</button>
          <button type="button" data-lock class="danger">Lock cheats</button>
        </div>
      </div>`;

    this.bind();
  }

  bind() {
    this.element.querySelectorAll('[data-dial]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.dial;
        cheats.set(key, Number(input.value));
        const out = this.element.querySelector(`[data-out="${key}"]`);
        if (out) out.textContent = format(cheats[key]);
      });
    });

    this.element.querySelectorAll('[data-switch]').forEach((input) => {
      input.addEventListener('change', () => cheats.set(input.dataset.switch, input.checked));
    });

    const field = this.element.querySelector('[data-destination]');
    field.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') this.go('travel');
    });

    this.element.querySelectorAll('[data-go]').forEach((button) => {
      button.addEventListener('click', () => this.go(button.dataset.go));
    });
    this.element.querySelector('[data-stop]').addEventListener('click', () => {
      if (this.onStopTravel) this.onStopTravel();
    });
    this.element.querySelector('[data-reset]').addEventListener('click', () => {
      cheats.reset();
      this.render();
      this.notify('Cheats reset');
    });
    this.element.querySelector('[data-lock]').addEventListener('click', () => {
      cheats.lock();
      this.notify('Cheats locked');
    });
  }

  go(kind) {
    const field = this.element.querySelector('[data-destination]');
    const place = resolvePlace(field.value);
    if (!place) {
      this.notify('No such place — try coordinates, a waypoint or a city name');
      return;
    }
    if (kind === 'teleport') {
      if (this.onTeleport) this.onTeleport(place.lat, place.lon, place.label);
    } else if (this.onTravel) {
      this.onTravel(place.lat, place.lon, place.label);
    }
  }

  /** Live autopilot readout, pushed from the frame loop. */
  setStatus(text) {
    if (!this.open) return;
    const node = this.element.querySelector('[data-status]');
    if (!node) return;
    node.hidden = !text;
    if (node.textContent !== text) node.textContent = text;
  }

  /** Refresh the controls from state changed elsewhere (a hotkey, say). */
  sync() {
    for (const dial of DIALS) {
      const input = this.element.querySelector(`[data-dial="${dial.key}"]`);
      if (input && Number(input.value) !== cheats[dial.key]) input.value = cheats[dial.key];
      const out = this.element.querySelector(`[data-out="${dial.key}"]`);
      if (out) out.textContent = format(cheats[dial.key]);
    }
    for (const key of Object.keys(CHEAT_DEFAULTS)) {
      const box = this.element.querySelector(`[data-switch="${key}"]`);
      if (box) box.checked = Boolean(cheats[key]);
    }
  }

  notify(message) {
    if (this.onNotice) this.onNotice(message);
  }
}

/** Coordinates, a waypoint name, or one of the built-in cities. */
export function resolvePlace(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const numbers = text.match(/-?\d+(?:\.\d+)?/g);
  if (numbers && numbers.length >= 2 && /^[-\d\s.,;]+$/.test(text)) {
    const lat = Number(numbers[0]);
    const lon = Number(numbers[1]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
    }
  }

  const needle = text.toLowerCase();
  const waypoint = waypoints.waypoints.find((w) => w.name.toLowerCase() === needle);
  if (waypoint) return { lat: waypoint.lat, lon: waypoint.lon, label: waypoint.name };

  const place =
    PLACES.find((p) => p[0].toLowerCase() === needle) ??
    PLACES.find((p) => p[0].toLowerCase().startsWith(needle));
  if (place) return { lat: place[1], lon: place[2], label: place[0] };

  return null;
}

function format(value) {
  return `${Number(value).toFixed(value < 10 ? 2 : 1)}x`;
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

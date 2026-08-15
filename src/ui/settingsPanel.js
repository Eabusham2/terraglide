import { ACTIONS, keyLabel, keybinds } from '../core/keybinds.js';
import { settings } from '../core/settings.js';
import { formatHeight } from '../core/units.js';
import { ELEVATION_PROVIDERS, IMAGERY_PROVIDERS, PANORAMA_PROVIDERS } from '../tiles/providers.js';
import { escapeHtml } from './worldmap.js';

/**
 * Settings.
 *
 * Everything the game can be told to do lives here, grouped the way you would
 * go looking for it, and every control writes straight through to the persisted
 * store — no apply button, no restart.
 */

const SECTIONS = [
  {
    id: 'providers',
    label: 'Providers',
    intro:
      'TerraGlide ships with no map data and no keys. Pick a provider and, where one is needed, paste your own key — the requests go straight from your browser to them, on your quota and under their terms.',
    fields: [
      {
        key: 'imageryProvider',
        label: 'Imagery',
        type: 'select',
        options: () => IMAGERY_PROVIDERS.map((p) => ({ value: p.id, label: p.label })),
        help: (value) => providerNote(IMAGERY_PROVIDERS, value),
      },
      {
        key: 'elevationProvider',
        label: 'Elevation',
        type: 'select',
        options: () => ELEVATION_PROVIDERS.map((p) => ({ value: p.id, label: p.label })),
        help: (value) => providerNote(ELEVATION_PROVIDERS, value),
      },
      {
        key: 'panoramaProvider',
        label: 'Street-level imagery',
        type: 'select',
        options: () => PANORAMA_PROVIDERS.map((p) => ({ value: p.id, label: p.label })),
        help: (value) => providerNote(PANORAMA_PROVIDERS, value),
      },
      { key: 'googleKey', label: 'Google Maps key', type: 'secret', help: 'Map Tiles, Street View Static and Geocoding APIs.' },
      { key: 'bingKey', label: 'Bing Maps key', type: 'secret' },
      { key: 'mapboxKey', label: 'Mapbox token', type: 'secret', help: 'Used for satellite imagery and Terrain-RGB elevation.' },
      { key: 'mapillaryToken', label: 'Mapillary token', type: 'secret' },
      { key: 'addressLookup', label: 'Look up addresses', type: 'toggle', help: 'Reverse geocodes your position for the readout. Rate limited.' },
      { key: 'buildings', label: 'OpenStreetMap buildings', type: 'toggle', help: 'Extrudes real footprints near the ground. Interiors are generated.' },
      { key: 'streetLevel', label: 'Blend street-level photos', type: 'toggle', help: 'Fades ground photography in when you stand still. Needs a key.' },
    ],
  },
  {
    id: 'graphics',
    label: 'Graphics',
    fields: [
      {
        key: 'graphics',
        label: 'Graphics level',
        type: 'select',
        options: () => [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
          { value: 'ultra', label: 'Ultra' },
        ],
        help: 'Sets terrain detail, texture cache and how many tiles load at once.',
      },
      { key: 'renderDistanceKm', label: 'Render distance', type: 'range', min: 4, max: 32, step: 1, unit: ' km' },
      { key: 'maxTileZoom', label: 'Maximum imagery zoom', type: 'range', min: 12, max: 21, step: 1, help: 'How close the ground can get before it stops sharpening. Higher is sharper underfoot and costs more to stream.' },
      { key: 'meshDetail', label: 'Terrain mesh detail', type: 'range', min: 0.5, max: 1.6, step: 0.1, format: (v) => `${v.toFixed(1)}x` },
      { key: 'fov', label: 'Field of view', type: 'range', min: 55, max: 118, step: 1, unit: '°' },
      { key: 'freecamFov', label: 'Freecam field of view', type: 'range', min: 55, max: 118, step: 1, unit: '°' },
      { key: 'speedFovKick', label: 'Widen view with speed', type: 'toggle' },
      { key: 'fog', label: 'Distance haze', type: 'toggle' },
      { key: 'resolutionScale', label: 'Render scale', type: 'range', min: 0.5, max: 2, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
      { key: 'adaptiveResolution', label: 'Adapt render scale to keep the frame rate', type: 'toggle' },
      { key: 'fpsTarget', label: 'Frame rate target', type: 'range', min: 30, max: 144, step: 5, unit: ' fps' },
      { key: 'showFps', label: 'Show performance readout', type: 'toggle' },
    ],
  },
  {
    id: 'controls',
    label: 'Controls',
    fields: [
      {
        key: 'mouseMode',
        label: 'Mouse mode',
        type: 'select',
        options: () => [
          { value: 'locked', label: 'Locked pointer (either button boosts)' },
          { value: 'pan', label: 'Click and pan (drag to look)' },
        ],
        help: 'Locked captures the cursor for flying. Pan keeps it free for the map.',
      },
      { key: 'swapMouseButtons', label: 'Swap mouse buttons in pan mode', type: 'toggle', help: 'Normally: drag with left to look, right click to boost, click to land.' },
      { key: 'sensitivity', label: 'Look sensitivity', type: 'range', min: 0.2, max: 3, step: 0.05, format: (v) => `${v.toFixed(2)}x` },
      { key: 'invertY', label: 'Invert vertical look', type: 'toggle' },
      { key: 'thirdPerson', label: 'Third person', type: 'toggle' },
    ],
    keybinds: true,
  },
  {
    id: 'player',
    label: 'Player',
    fields: [
      {
        key: 'playerHeightM',
        label: 'Standing height',
        type: 'range',
        min: 1.2,
        max: 2.4,
        step: 0.01,
        format: (v) => `${formatHeight(v, settings.get('units'))}`,
        help: 'Default is 6 ft 6 in.',
      },
      { key: 'playerScale', label: 'Size', type: 'range', min: 0.25, max: 40, step: 0.05, format: (v) => `${v.toFixed(2)}x` },
      { key: 'speedModeDurationS', label: 'Speed mode duration', type: 'range', min: 3, max: 60, step: 1, unit: ' s' },
      { key: 'speedModeCooldownS', label: 'Speed mode cooldown', type: 'range', min: 5, max: 300, step: 5, unit: ' s' },
    ],
  },
  {
    id: 'world',
    label: 'World',
    fields: [
      {
        key: 'units',
        label: 'Units',
        type: 'select',
        options: () => [
          { value: 'metric', label: 'Metric (m, km, °C)' },
          { value: 'imperial', label: 'Imperial (ft, mi, °F)' },
        ],
      },
      {
        key: 'rtpTarget',
        label: 'Random teleport lands',
        type: 'select',
        options: () => [
          { value: 'anywhere', label: 'Anywhere on Earth' },
          { value: 'populated', label: 'Somewhere with people' },
        ],
        help: (value) =>
          value === 'populated'
            ? 'Drops you on a city or town, a few kilometres off centre so it is a different spot each time. Works offline.'
            : 'Uniform over the whole planet, so mostly wilderness — which is rather the point.',
      },
      { key: 'exploreSeas', label: 'Anywhere-mode may land at sea', type: 'toggle', help: 'Off keeps you on land. On lets you drop anywhere, oceans included.' },
      {
        key: 'timeMode',
        label: 'Time of day',
        type: 'select',
        options: () => [
          { value: 'day', label: 'Daylight' },
          { value: 'golden', label: 'Golden hour' },
          { value: 'night', label: 'Night' },
          { value: 'live', label: 'Live (real time where you are)' },
          { value: 'custom', label: 'Custom hour' },
        ],
      },
      { key: 'customHour', label: 'Custom hour', type: 'range', min: 0, max: 23.5, step: 0.5, format: (v) => `${String(Math.floor(v)).padStart(2, '0')}:${v % 1 ? '30' : '00'}` },
      { key: 'showTemperature', label: 'Show seasonal temperature', type: 'toggle' },
      { key: 'fogRevealScale', label: 'Exploration reveal radius', type: 'range', min: 0.3, max: 3, step: 0.1, format: (v) => `${v.toFixed(1)}x` },
    ],
  },
  {
    id: 'minimap',
    label: 'Minimap & HUD',
    fields: [
      { key: 'minimapVisible', label: 'Show minimap', type: 'toggle' },
      {
        key: 'minimapCorner',
        label: 'Corner',
        type: 'select',
        options: () => [
          { value: 'top-right', label: 'Top right' },
          { value: 'top-left', label: 'Top left' },
          { value: 'bottom-right', label: 'Bottom right' },
          { value: 'bottom-left', label: 'Bottom left' },
        ],
      },
      { key: 'minimapSize', label: 'Size', type: 'range', min: 140, max: 420, step: 10, unit: ' px' },
      { key: 'minimapZoom', label: 'Zoom', type: 'range', min: 3, max: 19, step: 1, format: (v) => `z${v}` },
      { key: 'minimapRotates', label: 'Rotate with heading', type: 'toggle' },
      { key: 'minimapFog', label: 'Hide ground you have not explored', type: 'toggle', help: 'The map fills in as you travel. Turn off to see the whole world at once.' },
      { key: 'minimapShowTrail', label: 'Show your trail', type: 'toggle' },
      { key: 'minimapShowWaypoints', label: 'Show waypoints', type: 'toggle' },
      { key: 'hudVisible', label: 'Show HUD', type: 'toggle' },
      { key: 'showCompass', label: 'Show compass', type: 'toggle' },
      { key: 'showCrosshair', label: 'Show crosshair', type: 'toggle' },
    ],
  },
];

function providerNote(list, value) {
  const provider = list.find((p) => p.id === value);
  if (!provider) return '';
  const bits = [];
  if (provider.needsKey) bits.push('Needs a key.');
  if (provider.attribution) bits.push(provider.attribution);
  if (provider.note) bits.push(provider.note);
  return bits.join(' ');
}

export class SettingsPanel {
  constructor(root) {
    this.open = false;
    this.activeSection = 'providers';
    this.capturing = null;
    this.onChange = null;
    this.onReset = null;

    this.element = document.createElement('div');
    this.element.className = 'panel settings';
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="panel-head">
        <h2>Settings</h2>
        <button type="button" class="panel-close" data-close>Close</button>
      </div>
      <div class="settings-body">
        <nav class="settings-nav">
          ${SECTIONS.map(
            (section) =>
              `<button type="button" data-section="${section.id}">${escapeHtml(section.label)}</button>`,
          ).join('')}
          <button type="button" data-section="data">Data</button>
        </nav>
        <div class="settings-content"></div>
      </div>
    `;
    root.appendChild(this.element);
    this.content = this.element.querySelector('.settings-content');

    this.element.addEventListener('click', (event) => {
      const close = event.target.closest('[data-close]');
      if (close) {
        this.close();
        return;
      }
      const nav = event.target.closest('[data-section]');
      if (nav) {
        this.activeSection = nav.dataset.section;
        this.render();
      }
    });

    window.addEventListener('keydown', (event) => this.onKeyDown(event), true);
    settings.on('bulk', () => {
      if (this.open) this.render();
    });
  }

  onKeyDown(event) {
    if (!this.capturing) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.code === 'Escape') {
      this.capturing = null;
      this.render();
      return;
    }
    keybinds.rebind(this.capturing, event.code);
    this.capturing = null;
    this.render();
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    this.open = true;
    this.element.hidden = false;
    this.render();
  }

  close() {
    this.open = false;
    this.capturing = null;
    this.element.hidden = true;
  }

  render() {
    this.element.querySelectorAll('[data-section]').forEach((button) => {
      button.classList.toggle('active', button.dataset.section === this.activeSection);
    });

    if (this.activeSection === 'data') {
      this.content.innerHTML = this.renderData();
      this.bindData();
      return;
    }

    const section = SECTIONS.find((s) => s.id === this.activeSection) ?? SECTIONS[0];
    const parts = [];
    if (section.intro) parts.push(`<p class="settings-intro">${escapeHtml(section.intro)}</p>`);
    for (const field of section.fields) parts.push(this.renderField(field));
    if (section.keybinds) parts.push(this.renderKeybinds());
    this.content.innerHTML = parts.join('');
    this.bindFields(section);
  }

  renderField(field) {
    const value = settings.get(field.key);
    const id = `set-${field.key}`;
    let control = '';

    if (field.type === 'toggle') {
      control = `<input type="checkbox" id="${id}" data-key="${field.key}" ${value ? 'checked' : ''} />`;
    } else if (field.type === 'select') {
      const options = field.options();
      control = `<select id="${id}" data-key="${field.key}">${options
        .map(
          (o) =>
            `<option value="${escapeHtml(o.value)}" ${o.value === value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`,
        )
        .join('')}</select>`;
    } else if (field.type === 'range') {
      const display = field.format
        ? field.format(Number(value))
        : `${value}${field.unit ?? ''}`;
      control = `
        <span class="range">
          <input type="range" id="${id}" data-key="${field.key}" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}" />
          <output data-out="${field.key}">${escapeHtml(display)}</output>
        </span>`;
    } else if (field.type === 'secret') {
      control = `<input type="password" id="${id}" data-key="${field.key}" value="${escapeHtml(String(value))}" placeholder="not set" autocomplete="off" spellcheck="false" />`;
    } else {
      control = `<input type="text" id="${id}" data-key="${field.key}" value="${escapeHtml(String(value))}" />`;
    }

    const help = typeof field.help === 'function' ? field.help(value) : field.help;
    return `
      <div class="field field-${field.type}">
        <label for="${id}">${escapeHtml(field.label)}</label>
        ${control}
        ${help ? `<small>${escapeHtml(help)}</small>` : ''}
      </div>`;
  }

  bindFields(section) {
    this.content.querySelectorAll('[data-key]').forEach((input) => {
      const key = input.dataset.key;
      const field = section.fields.find((f) => f.key === key);
      if (!field) return;

      const handler = () => {
        let value;
        if (field.type === 'toggle') value = input.checked;
        else if (field.type === 'range') value = Number(input.value);
        else value = input.value;
        settings.set(key, value);

        const output = this.content.querySelector(`[data-out="${key}"]`);
        if (output) {
          output.textContent = field.format
            ? field.format(Number(value))
            : `${value}${field.unit ?? ''}`;
        }
        const help = input.parentElement?.querySelector('small') ?? input.closest('.field')?.querySelector('small');
        if (help && typeof field.help === 'function') help.textContent = field.help(value);
        if (this.onChange) this.onChange(key, value);
      };

      input.addEventListener(field.type === 'range' ? 'input' : 'change', handler);
      if (field.type === 'secret' || field.type === 'text') input.addEventListener('blur', handler);
    });

    this.content.querySelectorAll('[data-rebind]').forEach((button) => {
      button.addEventListener('click', () => {
        this.capturing = button.dataset.rebind;
        this.render();
      });
    });
    this.content.querySelectorAll('[data-clearbind]').forEach((button) => {
      button.addEventListener('click', () => {
        keybinds.clear(button.dataset.clearbind);
        this.render();
      });
    });
    const resetBinds = this.content.querySelector('[data-reset-binds]');
    if (resetBinds) {
      resetBinds.addEventListener('click', () => {
        keybinds.reset();
        this.render();
      });
    }
  }

  renderKeybinds() {
    const groups = new Map();
    for (const action of ACTIONS) {
      if (!groups.has(action.group)) groups.set(action.group, []);
      groups.get(action.group).push(action);
    }

    const blocks = [...groups.entries()].map(
      ([group, actions]) => `
        <h4>${escapeHtml(group)}</h4>
        <div class="binds">
          ${actions
            .map((action) => {
              const capturing = this.capturing === action.id;
              const label = capturing ? 'press a key…' : keyLabel(keybinds.codeFor(action.id));
              return `
                <div class="bind">
                  <span>${escapeHtml(action.label)}</span>
                  <button type="button" class="bind-key${capturing ? ' capturing' : ''}" data-rebind="${action.id}">${escapeHtml(label)}</button>
                  ${action.required ? '' : `<button type="button" class="mini" data-clearbind="${action.id}">clear</button>`}
                </div>`;
            })
            .join('')}
        </div>`,
    );

    return `
      <h3>Key bindings</h3>
      <p class="settings-intro">Click a key, then press the one you want. Escape cancels.</p>
      ${blocks.join('')}
      <div class="settings-actions"><button type="button" data-reset-binds>Reset key bindings</button></div>`;
  }

  renderData() {
    return `
      <p class="settings-intro">Everything is stored in this browser only — settings, key bindings, explored ground, waypoints and paths. Nothing is uploaded anywhere.</p>
      <div class="settings-actions">
        <button type="button" data-export>Export save file</button>
        <label class="file-button">Import save file<input type="file" accept="application/json" hidden data-import /></label>
        <button type="button" data-reset-settings>Reset all settings</button>
        <button type="button" data-clear-explored class="danger">Clear explored areas</button>
        <button type="button" data-clear-marks class="danger">Delete waypoints and paths</button>
      </div>
      <h3>About</h3>
      <p class="settings-intro">
        TerraGlide renders third-party map data live; it never bulk downloads or re-publishes it.
        Attribution for whatever provider you have selected stays in the corner of the screen.
        See LICENSE and THIRD-PARTY.md in the repository for the terms.
      </p>`;
  }

  bindData() {
    const call = (name, payload) => {
      if (this.onDataAction) this.onDataAction(name, payload);
    };
    this.content.querySelector('[data-export]')?.addEventListener('click', () => call('export'));
    this.content.querySelector('[data-import]')?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) call('import', file);
    });
    this.content.querySelector('[data-reset-settings]')?.addEventListener('click', () => {
      settings.reset();
      this.render();
      call('reset-settings');
    });
    this.content.querySelector('[data-clear-explored]')?.addEventListener('click', () => call('clear-explored'));
    this.content.querySelector('[data-clear-marks]')?.addEventListener('click', () => call('clear-marks'));
  }
}

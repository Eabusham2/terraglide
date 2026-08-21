import { clamp } from '../core/math.js';
import { AIR_SECONDS, SPEED_MODE_COOLDOWN_S, SPEED_MODE_SECONDS } from '../player/player.js';
import { keybinds } from '../core/keybinds.js';
import { settings } from '../core/settings.js';
import {
  compassPoint,
  formatAltitude,
  formatBearing,
  formatDistance,
  formatHeight,
  formatLatLon,
  formatSpeed,
  formatTemperature,
} from '../core/units.js';
import { HOTBAR } from '../player/player.js';
import { escapeHtml } from './worldmap.js';

/**
 * The heads-up display.
 *
 * Flat panels, one-pixel borders, system type. No gradients, no glow, nothing
 * rounded off into a pill — it should read like an instrument label, and it
 * should stay out of the way of the view, which is the actual point of the game.
 */

export class HUD {
  constructor(root) {
    this.root = root;
    this.cache = new Map();

    this.element = document.createElement('div');
    this.element.className = 'hud';
    this.element.innerHTML = `
      <div class="hud-topleft">
        <div class="panel-block climate">
          <div class="climate-main"><strong data-id="temp">—</strong><span data-id="season">—</span></div>
          <div class="climate-sub" data-id="climate-sub">—</div>
        </div>
        <div class="toolbar">
          <button type="button" data-action="rtp" class="primary">Random teleport<kbd data-key="rtp"></kbd></button>
          <button type="button" data-action="map">Map<kbd data-key="worldMap"></kbd></button>
          <button type="button" data-action="waypoint">Waypoint<kbd data-key="waypoint"></kbd></button>
          <button type="button" data-action="copy">Copy coords<kbd data-key="copyCoords"></kbd></button>
          <button type="button" data-action="settings">Settings<kbd data-key="settings"></kbd></button>
          <button type="button" data-action="help">Controls<kbd data-key="help"></kbd></button>
        </div>
      </div>

      <div class="hud-compass" data-id="compass">
        <div class="compass-strip" data-id="compass-strip"></div>
        <div class="compass-needle"></div>
      </div>

      <div class="hud-crosshair" data-id="crosshair"><i></i></div>

      <div class="hud-rail">
        <div class="cheat-flag" data-id="cheat-flag" hidden>
          <label>Modified</label>
          <span data-id="cheat-list">—</span>
          <em data-id="autopilot"></em>
        </div>
        <div class="gauge" data-id="speed-gauge">
          <label>Speed mode<kbd data-key="speedMode"></kbd></label>
          <div class="bar"><i data-id="speed-bar"></i></div>
          <span data-id="speed-text">Ready</span>
        </div>
        <div class="gauge" data-id="air-gauge" hidden>
          <label>Air</label>
          <div class="bar"><i data-id="air-bar"></i></div>
          <span data-id="air-text">—</span>
        </div>
        <div class="gauge" data-id="scale-gauge">
          <label>Height<kbd data-key="scaleDown"></kbd><kbd data-key="scaleUp"></kbd></label>
          <span data-id="scale-text">—</span>
        </div>
      </div>

      <div class="hud-bottomleft">
        <div class="panel-block location">
          <div class="location-address" data-id="address">Locating…</div>
          <div class="location-coords">
            <span data-id="coords">—</span>
            <button type="button" class="mini" data-action="copy" title="Copy coordinates">copy</button>
          </div>
          <div class="location-figures">
            <span data-id="altitude">—</span>
            <span data-id="speed">—</span>
            <span data-id="glide">—</span>
            <span data-id="heading">—</span>
            <span data-id="mode">—</span>
            <span data-id="water"></span>
          </div>
        </div>
      </div>

      <div class="hud-hotbar" data-id="hotbar"></div>

      <div class="hud-bottomright">
        <div class="status-line" data-id="status">—</div>
        <div class="attribution" data-id="attribution">—</div>
      </div>

      <div class="hud-toasts" data-id="toasts"></div>
      <div class="hud-debug" data-id="debug" hidden></div>
    `;
    root.appendChild(this.element);

    this.refs = {};
    this.element.querySelectorAll('[data-id]').forEach((node) => {
      this.refs[node.dataset.id] = node;
    });

    this.onAction = null;
    // Nothing in the HUD keeps the keyboard after you click it. See the note
    // in input.js: a focused button turns the next Space into a press of
    // itself, which is how jumping teleported you.
    this.element.addEventListener('pointerup', (event) => {
      const button = event.target instanceof HTMLElement ? event.target.closest('button') : null;
      if (button) button.blur();
    });
    this.element.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || !this.onAction) return;
      // Hand the keyboard back before doing anything else. A button that keeps
      // focus after a click is a button that Space presses: you would click
      // Random teleport, land, press Space to jump, and get the Controls panel
      // instead of a jump — and every key you pressed afterwards went to the
      // browser's idea of the focused control rather than to the game.
      button.blur();
      this.onAction(button.dataset.action);
    });

    this.buildHotbar();
    this.refreshKeyHints();
    keybinds.on('change', () => this.refreshKeyHints());
    settings.on('change', ({ key }) => {
      if (key === 'hudVisible' || key === 'showCompass' || key === 'showTemperature' || key === 'showCrosshair') {
        this.applyVisibility();
      }
    });
    this.applyVisibility();
  }

  applyVisibility() {
    this.element.classList.toggle('hidden', !settings.get('hudVisible'));
    this.refs.compass.style.display = settings.get('showCompass') ? '' : 'none';
    this.refs.crosshair.style.display = settings.get('showCrosshair') ? '' : 'none';
    this.element.querySelector('.climate').style.display = settings.get('showTemperature') ? '' : 'none';
  }

  refreshKeyHints() {
    this.element.querySelectorAll('kbd[data-key]').forEach((node) => {
      node.textContent = keybinds.labelFor(node.dataset.key);
    });
    this.buildHotbar();
  }

  buildHotbar() {
    const host = this.refs.hotbar;
    if (!host) return;
    host.innerHTML = HOTBAR.map((item, index) => {
      const key = keybinds.labelFor(`hotbar${index + 1}`);
      return `
        <button type="button" class="slot" data-slot="${index}" style="--rocket:${item.colour}">
          ${rocketIcon(item.colour)}
          <span class="slot-text">
            <span class="slot-key">${escapeHtml(key)}</span>
            <span class="slot-label">${escapeHtml(item.label)}</span>
            <span class="slot-meta" data-slot-meta="${index}"></span>
          </span>
        </button>`;
    }).join('');
    host.querySelectorAll('.slot').forEach((slot) => {
      slot.addEventListener('click', () => {
        slot.blur();
        if (this.onAction) this.onAction(`slot:${slot.dataset.slot}`);
      });
    });
  }

  setText(id, value) {
    const node = this.refs[id];
    if (!node) return;
    if (this.cache.get(id) === value) return;
    this.cache.set(id, value);
    node.textContent = value;
  }

  /**
   * @param {object} state everything the HUD needs for one frame
   */
  update(state) {
    const units = settings.get('units');
    const player = state.player;

    // Climate corner.
    if (state.climate) {
      // The observed temperature when there is one, and the seasonal mean only
      // when there is not — and the line underneath says which, every time, so
      // a monthly average is never read as today's weather.
      const observed = state.weather?.observed ? state.weather : null;
      this.setText('temp', formatTemperature(observed ? observed.tempC : state.climate.avgC, units));
      this.setText('season', `${state.climate.monthName} · ${state.climate.season}`);
      const weather = state.weather ? `${state.weather.label} · ` : '';
      this.setText(
        'climate-sub',
        observed
          ? `${weather}now · feels ${formatTemperature(observed.feelsC, units)} · wind ${Math.round(observed.windKph)} km/h`
          : `${weather}${state.climate.band} · seasonal average · annual ${formatTemperature(state.climate.annualC, units)}`,
      );
    }

    // Location block.
    this.setText('address', state.address || 'Unmapped location');
    this.setText('coords', formatLatLon(player.lat, player.lon, 5));
    this.setText('altitude', `${formatAltitude(player.position.y, units)} · ${formatDistance(player.altitudeAboveGround, units, 0)} AGL`);
    this.setText('speed', formatSpeed(player.speed, units));
    // The flight path angle, which is the number a glider pilot actually flies
    // to: how many degrees below the horizon you are travelling, as opposed to
    // where you happen to be looking. Level is 0, a dive is negative.
    const horizontal = player.horizontalSpeed;
    const angle = horizontal > 0.6 || Math.abs(player.velocity.y) > 0.6
      ? (Math.atan2(player.velocity.y, horizontal) * 180) / Math.PI
      : 0;
    this.setText('glide', `${angle >= 0 ? '+' : '\u2212'}${Math.abs(angle).toFixed(1)}\u00b0`);
    this.setText('heading', formatBearing(player.yaw));
    this.setText('mode', modeLabel(player, state));
    // Over water, the useful number is how far the nearest land is.
    this.setText('water', state.landAway || '');

    // Compass strip.
    if (settings.get('showCompass')) this.updateCompass(player.yaw);

    // Air, and only when your head is actually under. A gauge that is always
    // there is a gauge nobody reads.
    const air = this.refs['air-gauge'];
    if (air) {
      air.hidden = !player.submerged;
      if (player.submerged) {
        const left = Math.max(0, player.airSeconds);
        this.refs['air-bar'].style.width = `${clamp(left / AIR_SECONDS, 0, 1) * 100}%`;
        air.dataset.state = player.airSeconds > 0 ? 'active' : 'cooling';
        this.setText(
          'air-text',
          player.airSeconds > 0 ? `${left.toFixed(0)} s` : 'Drowning',
        );
      }
    }

    const speedRatio = player.speedActive
      ? player.speedRemaining / SPEED_MODE_SECONDS
      : 1 - player.speedCooldown / SPEED_MODE_COOLDOWN_S;
    this.refs['speed-bar'].style.width = `${clamp(speedRatio, 0, 1) * 100}%`;
    this.refs['speed-gauge'].dataset.state = player.speedActive
      ? 'active'
      : player.speedBlend > 1.02
        ? 'active'
        : player.speedCooldown > 0
          ? 'cooling'
          : 'ready';
    // Speed mode does not stop, it runs down — so once the burst is over the
    // gauge keeps reading out what the boost is still worth until it is gone,
    // rather than claiming "ready" while you are still coasting on it.
    const coasting = !player.speedActive && player.speedBlend > 1.02;
    this.setText(
      'speed-text',
      player.speedActive
        ? `2x · ${player.speedRemaining.toFixed(1)}s`
        : coasting
          ? `${player.speedBlend.toFixed(2)}x · coasting`
          : player.speedCooldown > 0
            ? `${Math.ceil(player.speedCooldown)}s`
            : 'Ready',
    );

    this.setText(
      'scale-text',
      `${formatHeight(player.height, units)} · ${player.scale.toFixed(2)}x`,
    );

    // If the numbers are not the real ones, the corner says so quietly.
    const cheatText = state.cheats || '';
    this.refs['cheat-flag'].hidden = !cheatText && !state.autopilot;
    this.setText('cheat-list', cheatText || 'auto-travel');
    this.setText('autopilot', state.autopilot || '');

    this.updateHotbar(player);

    this.setText('status', state.status || '');
    this.setText('attribution', state.attribution || '');

    if (state.debug) {
      this.refs.debug.hidden = false;
      this.refs.debug.textContent = state.debug;
    } else {
      this.refs.debug.hidden = true;
    }
  }

  updateCompass(yaw) {
    const strip = this.refs['compass-strip'];
    const degrees = ((yaw * 180) / Math.PI + 360) % 360;
    if (!this._compassBuilt) {
      const marks = [];
      for (let d = -180; d <= 540; d += 15) {
        const label = d % 90 === 0 ? compassPoint((((d % 360) + 360) % 360) * (Math.PI / 180)) : '';
        marks.push(
          `<span class="tick${d % 45 === 0 ? ' major' : ''}" style="left:${(d + 180) * 2}px">${label}</span>`,
        );
      }
      strip.innerHTML = marks.join('');
      this._compassBuilt = true;
    }
    strip.style.transform = `translateX(${-((degrees + 180) * 2) + 150}px)`;
  }

  updateHotbar(player) {
    const host = this.refs.hotbar;
    if (!host) return;
    host.querySelectorAll('.slot').forEach((slot, index) => {
      const selected = index === player.selectedSlot;
      if (slot.classList.contains('selected') !== selected) {
        slot.classList.toggle('selected', selected);
      }
      const meta = host.querySelector(`[data-slot-meta="${index}"]`);
      if (!meta) return;
      const item = HOTBAR[index];
      // No countdown: a rocket has a duration and a power, not a timer.
      if (meta.textContent !== item.hint) meta.textContent = item.hint;
    });
  }

  toast(message, tone = 'info') {
    const host = this.refs.toasts;
    const node = document.createElement('div');
    node.className = `toast toast-${tone}`;
    node.textContent = message;
    host.appendChild(node);
    setTimeout(() => {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 320);
    }, 2600);
    while (host.children.length > 4) host.removeChild(host.firstChild);
  }
}

function modeLabel(player, state) {
  if (state.freecam) return 'Freecam';
  if (player.mode === 'fly') return 'Flying';
  if (player.swimming) return 'Swimming';
  if (player.mode === 'glide') {
    return player.rocketTicksLeft > 0 ? 'Gliding · rocket' : 'Gliding';
  }
  if (player.mode === 'fall') return 'Falling';
  if (player.inBuilding) return 'Indoors';
  if (state.onWater) return 'At sea';
  return player.onGround ? 'On foot' : 'On foot';
}

/**
 * The rocket, drawn rather than modelled.
 *
 * Every 3D route available here either had no credits left or returned a
 * fifty-thousand-triangle blob with no UVs, so the hotbar gets a hand-drawn
 * icon instead — and at twenty-two pixels that is the better answer anyway.
 * Inline SVG rather than a file: it scales, it takes the strength colour as a
 * parameter, and it survives into the single-file build with nothing to fetch.
 */
function rocketIcon(colour) {
  return `
    <svg class="slot-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2.5 L16 9.5 H8 Z" fill="${colour}" />
      <rect x="8" y="9.5" width="8" height="8.5" fill="#c9a97c" />
      <path d="M8 12.4 L16 15.2 M8 14.9 L16 17.7" stroke="#b4553f"
            stroke-width="1.1" fill="none" opacity="0.7" />
      <path d="M8 18 L5.6 21.4 H8 Z M16 18 L18.4 21.4 H16 Z" fill="${colour}" opacity="0.75" />
      <line x1="12" y1="18" x2="12" y2="22.6" stroke="#6b5334" stroke-width="1.2" />
    </svg>`;
}

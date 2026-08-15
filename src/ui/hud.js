import { clamp } from '../core/math.js';
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
        <div class="gauge" data-id="speed-gauge">
          <label>Speed mode</label>
          <div class="bar"><i data-id="speed-bar"></i></div>
          <span data-id="speed-text">Ready</span>
        </div>
        <div class="gauge" data-id="scale-gauge">
          <label>Height</label>
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
    this.element.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || !this.onAction) return;
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
        <button type="button" class="slot" data-slot="${index}" data-kind="${item.kind}">
          <span class="slot-key">${escapeHtml(key)}</span>
          <span class="slot-label">${escapeHtml(item.label)}</span>
          <span class="slot-meta" data-slot-meta="${index}"></span>
        </button>`;
    }).join('');
    host.querySelectorAll('.slot').forEach((slot) => {
      slot.addEventListener('click', () => {
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
      this.setText('temp', formatTemperature(state.climate.avgC, units));
      this.setText('season', `${state.climate.monthName} · ${state.climate.season}`);
      this.setText(
        'climate-sub',
        `${state.climate.band} · seasonal average · annual ${formatTemperature(state.climate.annualC, units)}`,
      );
    }

    // Location block.
    this.setText('address', state.address || 'Unmapped location');
    this.setText('coords', formatLatLon(player.lat, player.lon, 5));
    this.setText('altitude', `${formatAltitude(player.position.y, units)} · ${formatDistance(player.altitudeAboveGround, units, 0)} AGL`);
    this.setText('speed', formatSpeed(player.speed, units));
    this.setText('heading', formatBearing(player.yaw));
    this.setText('mode', modeLabel(player, state));
    // Over water, the useful number is how far the nearest land is.
    this.setText('water', state.landAway || '');

    // Compass strip.
    if (settings.get('showCompass')) this.updateCompass(player.yaw);

    const speedRatio = player.speedActive
      ? player.speedRemaining / Math.max(1, settings.get('speedModeDurationS'))
      : 1 - player.speedCooldown / Math.max(1, settings.get('speedModeCooldownS'));
    this.refs['speed-bar'].style.width = `${clamp(speedRatio, 0, 1) * 100}%`;
    this.refs['speed-gauge'].dataset.state = player.speedActive
      ? 'active'
      : player.speedCooldown > 0
        ? 'cooling'
        : 'ready';
    this.setText(
      'speed-text',
      player.speedActive
        ? `2x · ${player.speedRemaining.toFixed(1)}s`
        : player.speedCooldown > 0
          ? `${Math.ceil(player.speedCooldown)}s`
          : 'Ready',
    );

    this.setText(
      'scale-text',
      `${formatHeight(player.height, units)} · ${player.scale.toFixed(2)}x`,
    );

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
      const text =
        player.rocketCooldown > 0 && selected
          ? `${player.rocketCooldown.toFixed(1)}s`
          : item.hint;
      if (meta.textContent !== text) meta.textContent = text;
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
  if (player.swimming) return 'Swimming';
  if (player.mode === 'glide') {
    return player.rocketTicksLeft > 0 ? 'Gliding · rocket' : 'Gliding';
  }
  if (player.mode === 'fall') return 'Falling';
  if (player.inBuilding) return 'Indoors';
  if (state.onWater) return 'At sea';
  return player.onGround ? 'On foot' : 'On foot';
}

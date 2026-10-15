import { clamp } from '../core/math.js';
import { AIR_SECONDS, SPEED_MODE_COOLDOWN_S, SPEED_MODE_SECONDS } from '../player/player.js';
import { AIR_SECONDS, OXYGEN_SECONDS, SPEED_MODE_COOLDOWN_S, SPEED_MODE_SECONDS } from '../player/player.js';
import { keybinds } from '../core/keybinds.js';
import { settings } from '../core/settings.js';
import {
  formatTemperature,
  formatWind,
} from '../core/units.js';
import { HOTBAR } from '../player/player.js';
import { HOTBAR, SLOTS } from '../player/player.js';
import { escapeHtml } from './worldmap.js';

/**
 */

export class HUD {
  constructor(root) {
  /**
   * @param {HTMLElement} root
   * @param {{online?: boolean}} [options] online adds the players button
   */
  constructor(root, { online = false } = {}) {
    this.root = root;
    this.cache = new Map();

          <button type="button" data-action="map">Map<kbd data-key="worldMap"></kbd></button>
          <button type="button" data-action="waypoint">Waypoint<kbd data-key="waypoint"></kbd></button>
          <button type="button" data-action="copy">Copy coords<kbd data-key="copyCoords"></kbd></button>
          <button type="button" data-action="online"${online ? ' class="online-on"' : ''}>${online ? 'Online' : 'Play online'}<kbd data-key="online"></kbd></button>
          ${online ? '<button type="button" data-action="players">Players<kbd data-key="players"></kbd></button>' : ''}
          <button type="button" data-action="worlds">Worlds<kbd data-key="travel"></kbd></button>
          <button type="button" data-action="settings">Settings<kbd data-key="settings"></kbd></button>
          <button type="button" data-action="help">Controls<kbd data-key="help"></kbd></button>
        </div>
        <div class="compass-heading" data-id="compass-heading">000°</div>
      </div>

      <div class="hud-crosshair" data-id="crosshair"><i></i></div>
      <div class="hud-crosshair" data-id="crosshair"><i></i><b class="hit-marker" data-id="hit-marker"></b>
        <span class="attack-charge" data-id="attack-charge" hidden><em data-id="attack-fill"></em></span></div>
      <div class="hud-hurt" data-id="hurt"></div>

      <div class="hud-beacons" data-id="beacons"></div>

        </div>
      </div>

      <div class="hud-vitals" data-id="vitals">
        <div class="hud-locator" data-id="locator" hidden></div>
        <div class="hud-bars">
          <div class="hearts" data-id="hearts" hidden></div>
          <div class="oxygen" data-id="oxygen" hidden><span class="oxygen-label">O<sub>2</sub></span><span class="oxygen-bar"><i data-id="oxygen-fill"></i></span><span data-id="oxygen-text">—</span></div>
        </div>
      </div>

      <div class="hud-hotbar" data-id="hotbar"></div>

      <div class="hud-bottomright">
  buildHotbar() {
    const host = this.refs.hotbar;
    if (!host) return;
    host.innerHTML = HOTBAR.map((item, index) => {
    host.innerHTML = SLOTS.map((item, index) => {
      const key = keybinds.labelFor(`hotbar${index + 1}`);
      return `
        <button type="button" class="slot" data-slot="${index}" style="--rocket:${item.colour}">
          ${rocketIcon(item.colour)}
        <button type="button" class="slot${item.sword ? ' sword' : ''}" data-slot="${index}" style="--rocket:${item.colour}">
          ${item.sword ? swordIcon() : rocketIcon(item.colour)}
          <span class="slot-text">
            <span class="slot-key">${escapeHtml(key)}</span>
            <span class="slot-label">${escapeHtml(item.label)}</span>
    const player = state.player;

    // Climate corner.
    if (state.climate) {
    if (state.climate?.offworld) {
      // Another world has no weather service and no monthly normals: what it
      // is like to stand on, in one line.
      const c = state.climate;
      this.setText('temp', formatTemperature(c.avgC, units));
      this.setText('season', `${c.monthName} · ${c.season}`);
      this.setText('climate-sub', `${c.band} · gravity ${c.gravity.toFixed(2)} g · typical surface`);
    } else if (state.climate) {
      // The observed temperature when there is one, and the seasonal mean only
      // when there is not — and the line underneath says which, every time, so
      // a monthly average is never read as today's weather.
    this.setText('water', state.landAway || '');

    // Compass strip.
    if (settings.get('showCompass')) this.updateCompass(player.yaw);
    if (settings.get('showCompass')) {
      this.updateCompass(player.yaw);
      this.updateCompassMarks(state.others ?? [], state.marks ?? []);
    }

    // Air, and only when your head is actually under. A gauge that is always
    // there is a gauge nobody reads.
    this.setText('autopilot', state.autopilot || '');

    this.updateHotbar(player);
    this.updateVitals(player, state);
    this.updateLocator(state.others ?? [], player);
    this.updateAttack(player, state);

    this.setText('status', state.status || '');
    this.setText('attribution', state.attribution || '');
  updateCompass(yaw) {
    const strip = this.refs['compass-strip'];
    const degrees = ((yaw * 180) / Math.PI + 360) % 360;
    this._heading = degrees;
    if (!this._compassBuilt) {
      // Letters at the four cardinals, and the bearing in degrees at the four
      // between them. It was letters and blank ticks, which tells you roughly
    this.setText('compass-heading', `${String(Math.round(degrees) % 360).padStart(3, '0')}\u00b0`);
  }

  /**
   * Hearts and oxygen, above the hotbar where Minecraft keeps them.
   *
   * Hearts show whenever they mean something: on a server, where anybody you
   * meet can take them, and anywhere you have lost some. Oxygen shows wherever
   * the air cannot be breathed, all the time, because it is the clock you are
   * flying against.
   */
  updateVitals(player, state) {
    const showHearts = !!state.showHearts || player.health < player.maxHealth;
    this.setHidden('hearts', !showHearts);
    if (showHearts) {
      const key = `${player.health}/${player.maxHealth}`;
      if (this.cache.get('hearts') !== key) {
        this.cache.set('hearts', key);
        const full = Math.floor(player.health / 2);
        const half = player.health % 2 >= 1;
        const total = Math.ceil(player.maxHealth / 2);
        let html = '';
        for (let i = 0; i < total; i++) {
          const kind = i < full ? 'full' : i === full && half ? 'half' : 'empty';
          html += `<i class="heart ${kind}"></i>`;
        }
        this.refs.hearts.innerHTML = html;
        this.refs.hearts.classList.toggle('low', player.health <= 6);
      }
    }
    const suit = !!player.needsSuit;
    this.setHidden('oxygen', !suit);
    if (suit) {
      const left = clamp(player.oxygen / OXYGEN_SECONDS, 0, 1);
      this.refs['oxygen-fill'].style.width = `${(left * 100).toFixed(1)}%`;
      this.refs.oxygen.dataset.state = player.oxygenSource ? 'filling' : left < 0.2 ? 'low' : 'ok';
      const seconds = Math.ceil(player.oxygen);
      this.setText('oxygen-text', player.oxygenSource ? 'refilling'
        : seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'EMPTY');
    }
    // A red edge on the screen when you are hurt, the way a hit feels.
    const since = performance.now() - (this.hurtAt ?? -Infinity);
    const hurt = since < 450 ? 1 - since / 450 : 0;
    if (this.cache.get('hurt') !== hurt.toFixed(2)) {
      this.cache.set('hurt', hurt.toFixed(2));
      this.refs.hurt.style.opacity = hurt.toFixed(2);
    }
  }

  /** Flash the edges red. Called when you take damage. */
  hurtFlash() {
    this.hurtAt = performance.now();
  }

  /** A mark on the crosshair: your swing connected. */
  hitMarker(crit = false) {
    const node = this.refs['hit-marker'];
    if (!node) return;
    node.classList.remove('on', 'crit');
    void node.offsetWidth;
    node.classList.add('on');
    if (crit) node.classList.add('crit');
  }

  /**
   * Minecraft's attack indicator: under the crosshair while the sword is in
   * hand, filling as the blade comes back round. A swing before it is full
   * hits for less.
   */
  updateAttack(player, state) {
    const show = player.holdingSword && state.attackCharge !== undefined;
    this.setHidden('attack-charge', !show);
    if (show) {
      const fill = clamp(state.attackCharge, 0, 1);
      this.refs['attack-fill'].style.width = `${(fill * 100).toFixed(0)}%`;
      this.refs['attack-charge'].classList.toggle('ready', fill >= 1);
    }
  }

  /**
   * The locator bar: everybody else, as a dot in their colour at the
   * bearing they are from you, across a strip above your hearts.
   *
   * Minecraft added one in 1.21.6 and it is the right instrument for a world
   * this size: a friend twenty kilometres away is too far to see and too far
   * to name, and what you want to know is which way to turn. Nearer is bigger;
   * a small arrow says when they are well above or below you; anybody behind
   * you sits at the edge they are nearest, pointing round.
   */
  updateLocator(others, player) {
    const host = this.refs.locator;
    if (!host) return;
    const live = others.filter((o) => o.sameWorld);
    this.setHidden('locator', !settings.get('showLocatorBar') || live.length === 0);
    if (!live.length || !settings.get('showLocatorBar')) return;
    this._dots ??= new Map();
    const seen = new Set();
    const half = 80 * (Math.PI / 180);
    for (const other of live) {
      seen.add(other.key);
      let dot = this._dots.get(other.key);
      if (!dot) {
        dot = document.createElement('i');
        dot.className = 'locator-dot';
        host.appendChild(dot);
        this._dots.set(other.key, dot);
      }
      let rel = other.bearing - player.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const edge = Math.abs(rel) > half;
      const x = clamp(rel / half, -1, 1);
      // Bigger when close: full size inside half a kilometre, smallest past fifty.
      const size = clamp(11 - Math.log10(Math.max(1, other.distance)) * 2.2, 4, 10);
      dot.style.left = `${((x + 1) / 2) * 100}%`;
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.setProperty('--player', other.colour);
      dot.dataset.edge = edge ? (rel > 0 ? 'right' : 'left') : '';
      dot.dataset.vertical = other.elevation > 0.25 ? 'up' : other.elevation < -0.25 ? 'down' : '';
      dot.title = other.name;
    }
    for (const [key, dot] of this._dots) {
      if (seen.has(key)) continue;
      dot.remove();
      this._dots.delete(key);
    }
  }

  /** Ticks on the compass strip for players and for your lander. */
  updateCompassMarks(others, marks) {
    const strip = this.refs['compass-strip'];
    if (!strip) return;
    this._marks ??= new Map();
    const seen = new Set();
    const all = [
      ...others.filter((o) => o.sameWorld).map((o) => ({ key: `p:${o.key}`, bearing: o.bearing, colour: o.colour, label: o.name.slice(0, 1), title: o.name })),
      ...marks.map((m) => ({ key: `m:${m.key}`, bearing: m.bearing, colour: m.colour, label: m.label, title: m.title })),
    ];
    for (const mark of all) {
      seen.add(mark.key);
      let node = this._marks.get(mark.key);
      if (!node) {
        node = document.createElement('span');
        node.className = 'compass-mark';
        strip.appendChild(node);
        this._marks.set(mark.key, node);
      }
      // The strip is 2 px a degree, laid out from -180 to 540 so it can wrap;
      // the mark goes in the copy nearest the middle of the view.
      const degrees = (((mark.bearing * 180) / Math.PI) % 360 + 360) % 360;
      const heading = this._heading ?? 0;
      let at = degrees;
      while (at - heading > 180) at -= 360;
      while (heading - at > 180) at += 360;
      node.style.left = `${(at + 180) * 2}px`;
      node.style.setProperty('--player', mark.colour);
      if (node.textContent !== mark.label) node.textContent = mark.label;
      node.title = mark.title ?? '';
    }
    for (const [key, node] of this._marks) {
      if (seen.has(key)) continue;
      node.remove();
      this._marks.delete(key);
    }
  }

  updateHotbar(player) {
    const host = this.refs.hotbar;
    if (!host) return;
      const meta = host.querySelector(`[data-slot-meta="${index}"]`);
      if (!meta) return;
      const item = HOTBAR[index];
      if (!item) {
        // The sword: what it is for, and how charged the next swing is.
        const hint = 'attack \u00b7 left click';
        if (meta.textContent !== hint) meta.textContent = hint;
        return;
      }
      // No countdown: a rocket has a burn and a speed, not a timer. Both are
      // real numbers now — a bigger rocket pushes harder as well as longer, in
      // the same proportion — and the speed is formatted in whichever units
  }
}

/** A sword, drawn like the rocket: flat, small, and the same at every size. */
function swordIcon() {
  return `
    <svg class="slot-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M19.5 2.5 L21.5 4.5 L10.2 15.8 L8.2 13.8 Z" fill="#dfe6ee" />
      <path d="M19.5 2.5 L21.5 4.5 L20.6 5.4 L18.6 3.4 Z" fill="#ffffff" />
      <path d="M6.4 12.4 L11.6 17.6 L10.4 18.8 L5.2 13.6 Z" fill="#7a6a4f" />
      <path d="M8.7 16.4 L4.6 20.5 L3.5 19.4 L7.6 15.3 Z" fill="#5b4a33" />
      <circle cx="3.6" cy="20.4" r="1.3" fill="#c9a97c" />
    </svg>`;
}

function modeLabel(player, state) {
  if (state.freecam) return 'Freecam';
  if (player.mode === 'fly') return 'Flying';

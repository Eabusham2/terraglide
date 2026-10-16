import { clamp } from '../core/math.js';
import { AIR_SECONDS, OXYGEN_SECONDS, SPEED_MODE_COOLDOWN_S, SPEED_MODE_SECONDS } from '../player/player.js';
import { keybinds } from '../core/keybinds.js';
import { settings } from '../core/settings.js';
import {
  compassPoint,
  formatAltitude,
  formatBearing,
  formatDistance,
  formatHeight,
  formatLatLon,
  formatPitch,
  formatSpeed,
  formatTemperature,
  formatWind,
} from '../core/units.js';
import { HOTBAR, SLOTS } from '../player/player.js';
import { escapeHtml } from './worldmap.js';
import { formatFriends, formatPing, formatPlayers, setSignal, signalLevel, signalMarkup } from './signal.js';

/**
 * The heads-up display.
 *
 * Flat panels, one-pixel borders, system type. No gradients, no glow, nothing
 * rounded off into a pill — it should read like an instrument label, and it
 * should stay out of the way of the view, which is the actual point of the game.
 */

export class HUD {
  /**
   * @param {HTMLElement} root
   * @param {{online?: boolean}} [options] online adds the players button
   */
  constructor(root, { online = false } = {}) {
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
          <button type="button" data-action="online"${online ? ' class="online-on"' : ''}>${online ? 'Online' : 'Play online'}<kbd data-key="online"></kbd></button>
          ${online ? '<button type="button" data-action="players">Players<kbd data-key="players"></kbd></button>' : ''}
          ${online ? '<button type="button" data-action="teleport">Teleport<kbd data-key="teleportMenu"></kbd></button>' : ''}
          ${online ? '<button type="button" data-action="chat">Chat<kbd data-key="chat"></kbd></button>' : ''}
          <button type="button" data-action="worlds">Worlds<kbd data-key="travel"></kbd></button>
          <button type="button" data-action="settings">Settings<kbd data-key="settings"></kbd></button>
          <button type="button" data-action="help">Controls<kbd data-key="help"></kbd></button>
        </div>
      </div>

      <div class="hud-compass" data-id="compass">
        <div class="compass-strip" data-id="compass-strip"></div>
        <div class="compass-needle"></div>
        <div class="compass-heading" data-id="compass-heading">000°</div>
      </div>

      <div class="hud-crosshair" data-id="crosshair"><i></i><b class="hit-marker" data-id="hit-marker"></b>
        <span class="attack-charge" data-id="attack-charge" hidden><em data-id="attack-fill"></em></span></div>
      <div class="hud-hurt" data-id="hurt"></div>

      <div class="hud-beacons" data-id="beacons"></div>

      <div class="hud-rail">
        <div class="cheat-flag" data-id="cheat-flag" hidden>
          <label>Modified</label>
          <span data-id="cheat-list">—</span>
          <em data-id="autopilot"></em>
        </div>
        <div class="gauge" data-id="speed-gauge">
          <label>Surge<kbd data-key="speedMode"></kbd></label>
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
            <span data-id="pitch">—</span>
            <span data-id="mode">—</span>
            <span data-id="water"></span>
          </div>
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
        <div class="hud-voice" data-id="voice" hidden><i class="hud-voice-dot"></i><span data-id="voice-text"></span></div>
        <div class="hud-statusrow">
          <div class="status-line" data-id="status">—</div>
          <div class="hud-net" data-id="net" hidden>${signalMarkup(signalLevel(NaN))}<span data-id="net-text" title="Ping to the server">${formatPing(NaN)}</span><span data-id="net-players" title="Players on the server" hidden></span><span data-id="net-friends" title="Your friends on the server, of all your friends" hidden></span></div>
        </div>
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
    // As many slots as there are, for the touch layout's widths (main.css).
    host.style.setProperty('--slots', String(SLOTS.length));
    host.innerHTML = SLOTS.map((item, index) => {
      const key = keybinds.labelFor(`hotbar${index + 1}`);
      return `
        <button type="button" class="slot${item.sword ? ' sword' : ''}" data-slot="${index}" style="--rocket:${item.colour}">
          ${item.sword ? swordIcon() : rocketIcon(item.colour)}
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

  /**
   * The ping to the server, after the frame rate, with its bars, then how
   * many are playing and how many of your friends are on: online only.
   * A connection that is down says so in red; one that has stopped answering
   * its pings for three of them in a row turns red before it is noticed gone.
   */
  updateNet(net) {
    const node = this.refs.net;
    if (!node) return;
    node.hidden = !net;
    if (!net) return;
    const up = net.status === 'open' || net.status === 'signedIn';
    const heard = up && net.lastPong > 0;
    const stale = heard && Date.now() - net.lastPong > 7000;
    setSignal(node.querySelector('.signal'), signalLevel(heard ? net.rtt : NaN, { up, stale }));
    this.setText('net-text', !up ? 'offline' : heard ? formatPing(net.rtt) : formatPing(NaN));
    // Beside the ping: how many are on, then how many of your friends.
    const players = up && Number.isFinite(net.players) ? formatPlayers(net.players) : '';
    const friends = up && net.friends ? formatFriends(net.friends) : '';
    this.refs['net-players'].hidden = !players;
    this.refs['net-friends'].hidden = !friends;
    this.setText('net-players', players);
    this.setText('net-friends', friends);
  }

  setText(id, value) {
    const node = this.refs[id];
    if (!node) return;
    if (this.cache.get(id) === value) return;
    this.cache.set(id, value);
    node.textContent = value;
  }

  /**
   * Show or hide one readout, cached like the text is.
   *
   * Written through `hidden` rather than a display style so it obeys whatever
   * the stylesheet says the element is when it is shown, and so a row that is
   * hidden takes no space instead of leaving a gap where it used to be.
   */
  setHidden(id, hide) {
    const node = this.refs[id];
    if (!node) return;
    const key = `${id}:hidden`;
    if (this.cache.get(key) === hide) return;
    this.cache.set(key, hide);
    node.hidden = hide;
  }

  /**
   * @param {object} state everything the HUD needs for one frame
   */
  update(state) {
    const units = settings.get('units');
    const player = state.player;

    // Climate corner.
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
      const observed = state.weather?.observed ? state.weather : null;
      this.setText('temp', formatTemperature(observed ? observed.tempC : state.climate.avgC, units));
      this.setText('season', `${state.climate.monthName} · ${state.climate.season}`);
      const weather = state.weather ? `${state.weather.label} · ` : '';
      this.setText(
        'climate-sub',
        observed
          ? `${weather}now · feels ${formatTemperature(observed.feelsC, units)} · wind ${formatWind(observed.windKph, units)}`
          : `${weather}${state.climate.band} · seasonal average · annual ${formatTemperature(state.climate.annualC, units)}`,
      );
    }

    // Location block.
    this.setText('address', state.address || 'Unmapped location');
    this.setText('coords', formatLatLon(player.lat, player.lon, 5));
    // Height above the ground is a height, not a distance travelled.
    //
    // It went through formatDistance, which switches to miles past a thousand
    // feet and was asked for nought decimal places — so at three hundred metres
    // above the ground the game told you "0 mi AGL". A thousand feet up,
    // reported as zero. At nine hundred metres it said "1 mi", and at three
    // thousand "2 mi" for something that is 1.86.
    this.setText(
      'altitude',
      `${formatAltitude(player.position.y, units)} · ${formatAltitude(player.altitudeAboveGround, units)} AGL`,
    );
    this.setText('speed', formatSpeed(player.speed, units, settings.get('speedPer')));
    // The flight path angle, which is the number a glider pilot actually flies
    // to: how many degrees below the horizon you are travelling, as opposed to
    // where you happen to be looking. Level is 0, a dive is negative.
    const horizontal = player.horizontalSpeed;
    const angle = horizontal > 0.6 || Math.abs(player.velocity.y) > 0.6
      ? (Math.atan2(player.velocity.y, horizontal) * 180) / Math.PI
      : 0;
    // The flight-path angle and the pitch are numbers you fly by, and numbers
    // you are not flying are clutter: on the ground they read +0.0 degrees and
    // whatever you last looked at. Shown while you are in the air, gone while
    // you are walking.
    const flying = player.mode === 'glide' || player.mode === 'fall' || player.mode === 'fly';
    this.setHidden('glide', !flying);
    this.setHidden('pitch', !flying);
    this.setText('glide', `${angle >= 0 ? '+' : '-'}${Math.abs(angle).toFixed(1)}\u00b0`);
    this.setText('heading', formatBearing(player.yaw));
    // The compass says where you are pointed on the ground and said nothing
    // about the other axis, which is half of flying.
    this.setText('pitch', formatPitch(player.pitch));
    this.setText('mode', modeLabel(player, state));
    // Over water, the useful number is how far the nearest land is.
    this.setText('water', state.landAway || '');

    // Compass strip.
    if (settings.get('showCompass')) {
      this.updateCompass(player.yaw);
      this.updateCompassMarks(state.others ?? [], state.marks ?? []);
    }

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
    // Only on screen when it is doing something.
    //
    // It used to sit there permanently reading "Ready", which is a box, a
    // title, a keycap and a bar spent saying that nothing is happening. Now it
    // is there while the burst is running, while you are still coasting on it,
    // and while it recharges — all three of which are a number counting down —
    // and gone the rest of the time. The key still works when it is not shown;
    // the help card is where you learn it exists.
    const surgeBusy = player.speedActive || coasting || player.speedCooldown > 0;
    this.setHidden('speed-gauge', !surgeBusy);
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
    this.updateVitals(player, state);
    this.updateLocator(state.others ?? [], player);
    this.updateAttack(player, state);

    this.setText('status', state.status || '');
    this.updateNet(state.net);
    this.setText('attribution', state.attribution || '');

    if (state.debug) {
      this.refs.debug.hidden = false;
      this.refs.debug.textContent = state.debug;
    } else {
      this.refs.debug.hidden = true;
    }
  }

  /**
   * Name and distance beside every beacon on screen.
   *
   * The elements are reused between frames and only their text and position
   * change: rebuilding the markup every frame at sixty hertz is how a handful
   * of waypoints turns into a stutter, and the label would flicker as the
   * browser reparsed it.
   *
   * @param {Array<{id:number,name:string,colour:string,metres:number,x:number,y:number}>} list
   * @param {string} units
   */
  setBeacons(list, units) {
    const host = this.refs.beacons;
    if (!host) return;
    this._beaconNodes ??= new Map();
    const live = new Set();
    for (const beacon of list) {
      live.add(beacon.id);
      let node = this._beaconNodes.get(beacon.id);
      if (!node) {
        node = document.createElement('div');
        node.className = 'beacon-label';
        node.innerHTML = '<b></b><span></span>';
        host.appendChild(node);
        this._beaconNodes.set(beacon.id, node);
      }
      node.style.left = `${(beacon.x * 100).toFixed(2)}%`;
      node.style.top = `${(beacon.y * 100).toFixed(2)}%`;
      node.style.setProperty('--beacon', beacon.colour);
      const name = node.firstChild;
      if (name.textContent !== beacon.name) name.textContent = beacon.name;
      const away = formatDistance(beacon.metres, units);
      const distance = node.lastChild;
      if (distance.textContent !== away) distance.textContent = away;
      node.hidden = false;
    }
    for (const [id, node] of this._beaconNodes) {
      if (live.has(id)) continue;
      node.remove();
      this._beaconNodes.delete(id);
    }
  }

  updateCompass(yaw) {
    const strip = this.refs['compass-strip'];
    const degrees = ((yaw * 180) / Math.PI + 360) % 360;
    this._heading = degrees;
    if (!this._compassBuilt) {
      // Letters at the four cardinals, and the bearing in degrees at the four
      // between them. It was letters and blank ticks, which tells you roughly
      // which way you are pointed and never says a number anywhere.
      const marks = [];
      for (let d = -180; d <= 540; d += 15) {
        const wrapped = (((d % 360) + 360) % 360);
        const label =
          d % 90 === 0
            ? compassPoint(wrapped * (Math.PI / 180))
            : d % 45 === 0
              ? String(wrapped)
              : '';
        marks.push(
          `<span class="tick${d % 45 === 0 ? ' major' : ''}" style="left:${(d + 180) * 2}px">${label}</span>`,
        );
      }
      strip.innerHTML = marks.join('');
      this._compassBuilt = true;
    }
    strip.style.transform = `translateX(${-((degrees + 180) * 2) + 150}px)`;
    // The exact bearing, under the needle, padded so it does not jitter in
    // width as it counts through 9 to 10 to 100.
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
    // The crosshair is what a swing aims by. A touch screen hides it - a
    // finger is not a pointer - except while the sword is out, when there is
    // nothing else to aim with: main.css shows it again for body.sword-out.
    const out = !!player.holdingSword;
    if (this.cache.get('sword-out') !== out) {
      this.cache.set('sword-out', out);
      document.body.classList.toggle('sword-out', out);
    }
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
      // Bigger when close, over the distances that matter: full size inside
      // fifty metres, smallest past fifty kilometres, a step every factor of
      // ten between. It used to bottom out by a kilometre and a half, so
      // somebody two kilometres off and somebody fifty looked the same.
      const size = clamp(10 - 2 * Math.log10(Math.max(1, other.distance) / 50), 4, 10);
      dot.style.left = `${((x + 1) / 2) * 100}%`;
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.setProperty('--player', other.colour);
      dot.dataset.edge = edge ? (rel > 0 ? 'right' : 'left') : '';
      dot.dataset.vertical = other.elevation > 0.25 ? 'up' : other.elevation < -0.25 ? 'down' : '';
      dot.dataset.tie = other.tie ?? '';
      dot.title = other.tie ? `${other.name} (${other.tie})` : other.name;
    }
    for (const [key, dot] of this._dots) {
      if (seen.has(key)) continue;
      dot.remove();
      this._dots.delete(key);
    }
  }

  /** Proximity voice: what it is doing, lit while you talk, and who is talking. */
  setVoice(info) {
    const box = this.refs.voice;
    if (!box) return;
    box.hidden = !info.running;
    box.classList.toggle('talking', !!info.talking);
    box.classList.toggle('live', !!info.transmitting);
    box.classList.toggle('blocked', ['blocked', 'missing', 'insecure'].includes(info.mic));
    const who = (info.peers ?? []).filter((p) => p.talking && !p.muted).map((p) => p.name);
    const text = who.length ? `${info.status} — ${who.join(', ')}` : info.status;
    if (this.refs['voice-text'].textContent !== text) this.refs['voice-text'].textContent = text;
  }

  /** Ticks on the compass strip for players and for your lander. */
  updateCompassMarks(others, marks) {
    const strip = this.refs['compass-strip'];
    if (!strip) return;
    this._marks ??= new Map();
    const seen = new Set();
    const all = [
      ...others.filter((o) => o.sameWorld).map((o) => ({
        key: `p:${o.key}`, bearing: o.bearing, colour: o.colour, label: o.name.slice(0, 1),
        title: o.tie ? `${o.name} (${o.tie})` : o.name, tie: o.tie ?? '',
      })),
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
      node.dataset.tie = mark.tie ?? '';
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
    host.querySelectorAll('.slot').forEach((slot, index) => {
      const selected = index === player.selectedSlot;
      if (slot.classList.contains('selected') !== selected) {
        slot.classList.toggle('selected', selected);
      }
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
      // the player is using.
      // How many you are carrying, then what one of them does. The count goes
      // first because it is the thing that changes while you fly, and a slot
      // you have run dry has to be readable at a glance from the hotbar rather
      // than discovered by pressing the key.
      const left = player.stock ? player.stock[index] : Infinity;
      const endless = !Number.isFinite(player.rocketsLeft) || !player.stock;
      // Written out rather than an infinity sign: a minimal font set draws
      // U+221E as an empty box, and the hotbar is not the place to find that
      // out. Same rule that caught the arrow in the map's zoom buttons.
      const what = `${item.burnSeconds.toFixed(1)}s · ${formatSpeed(item.topSpeed, settings.get('units'))}`;
      const hint = endless ? what : `${left} · ${what}`;
      if (meta.textContent !== hint) meta.textContent = hint;
      const empty = !endless && left <= 0;
      if (slot.classList.contains('empty') !== empty) slot.classList.toggle('empty', empty);
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

/** A sword, drawn like the rocket: flat, small, and the same at every size. */
function swordIcon() {
  return `
    <svg class="slot-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 1.6 L13.6 4.2 V15 H10.4 V4.2 Z" fill="#d9dee4" />
      <path d="M12 3.4 V14.4" stroke="#9aa4ae" stroke-width="0.9" />
      <rect x="6.8" y="15" width="10.4" height="2" rx="0.6" fill="#c8a24a" />
      <rect x="10.9" y="17" width="2.2" height="3.6" fill="#4a3424" />
      <circle cx="12" cy="21.5" r="1.4" fill="#c8a24a" />
    </svg>`;
}

function modeLabel(player, state) {
  if (state.freecam) return 'Freecam';
  if (player.mode === 'fly') return 'Flying';
  if (player.swimming) return 'Swimming';
  if (player.mode === 'glide') {
    return player.rocketTicksLeft > 0 ? 'Gliding · rocket' : 'Gliding';
  }
  if (player.mode === 'fall') return 'Falling';
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

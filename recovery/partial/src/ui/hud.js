@@MISSING 1@@
import { AIR_SECONDS, OXYGEN_SECONDS, SPEED_MODE_COOLDOWN_S, SPEED_MODE_SECONDS } from '../player/player.js';
@@MISSING 3@@
@@MISSING 4@@
@@MISSING 5@@
  compassPoint,
@@MISSING 7@@
@@MISSING 8@@
@@MISSING 9@@
@@MISSING 10@@
@@MISSING 11@@
@@MISSING 12@@
@@MISSING 13@@
@@MISSING 14@@
@@MISSING 15@@
@@MISSING 16@@
import { HOTBAR, SLOTS } from '../player/player.js';
@@MISSING 18@@
@@MISSING 19@@
@@MISSING 20@@
@@MISSING 21@@
@@MISSING 22@@
@@MISSING 23@@
@@MISSING 24@@
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
@@MISSING 53@@
@@MISSING 54@@
@@MISSING 55@@
@@MISSING 56@@
@@MISSING 57@@
@@MISSING 58@@
@@MISSING 59@@
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
        <div class="status-line" data-id="status">—</div>
        <div class="attribution" data-id="attribution">—</div>
      </div>

      <div class="hud-toasts" data-id="toasts"></div>
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
@@MISSING 174@@
@@MISSING 175@@
@@MISSING 176@@
@@MISSING 177@@
@@MISSING 178@@
@@MISSING 179@@
@@MISSING 180@@
@@MISSING 181@@
@@MISSING 182@@
@@MISSING 183@@
@@MISSING 184@@
@@MISSING 185@@
@@MISSING 186@@
@@MISSING 187@@
@@MISSING 188@@
@@MISSING 189@@
@@MISSING 190@@
@@MISSING 191@@
@@MISSING 192@@
@@MISSING 193@@
@@MISSING 194@@
@@MISSING 195@@
@@MISSING 196@@
@@MISSING 197@@
@@MISSING 198@@
@@MISSING 199@@
@@MISSING 200@@
@@MISSING 201@@
@@MISSING 202@@
@@MISSING 203@@
@@MISSING 204@@
@@MISSING 205@@
@@MISSING 206@@
@@MISSING 207@@
@@MISSING 208@@
@@MISSING 209@@
@@MISSING 210@@
@@MISSING 211@@
@@MISSING 212@@
@@MISSING 213@@
@@MISSING 214@@
@@MISSING 215@@
@@MISSING 216@@
@@MISSING 217@@
@@MISSING 218@@
@@MISSING 219@@
@@MISSING 220@@
@@MISSING 221@@
@@MISSING 222@@
@@MISSING 223@@
@@MISSING 224@@
@@MISSING 225@@
@@MISSING 226@@
@@MISSING 227@@
@@MISSING 228@@
@@MISSING 229@@
@@MISSING 230@@
@@MISSING 231@@
@@MISSING 232@@
@@MISSING 233@@
@@MISSING 234@@
@@MISSING 235@@
@@MISSING 236@@
@@MISSING 237@@
@@MISSING 238@@
@@MISSING 239@@
@@MISSING 240@@
@@MISSING 241@@
@@MISSING 242@@
@@MISSING 243@@
@@MISSING 244@@
@@MISSING 245@@
@@MISSING 246@@
@@MISSING 247@@
@@MISSING 248@@
@@MISSING 249@@
@@MISSING 250@@
@@MISSING 251@@
@@MISSING 252@@
@@MISSING 253@@
@@MISSING 254@@
@@MISSING 255@@
@@MISSING 256@@
@@MISSING 257@@
@@MISSING 258@@
@@MISSING 259@@
@@MISSING 260@@
@@MISSING 261@@
@@MISSING 262@@
@@MISSING 263@@
@@MISSING 264@@
@@MISSING 265@@
@@MISSING 266@@
@@MISSING 267@@
@@MISSING 268@@
@@MISSING 269@@
@@MISSING 270@@
@@MISSING 271@@
@@MISSING 272@@
@@MISSING 273@@
@@MISSING 274@@
@@MISSING 275@@
@@MISSING 276@@
@@MISSING 277@@
@@MISSING 278@@
@@MISSING 279@@
@@MISSING 280@@
@@MISSING 281@@
@@MISSING 282@@
@@MISSING 283@@
@@MISSING 284@@
@@MISSING 285@@
@@MISSING 286@@
@@MISSING 287@@
@@MISSING 288@@
@@MISSING 289@@
@@MISSING 290@@
@@MISSING 291@@
@@MISSING 292@@
@@MISSING 293@@
@@MISSING 294@@
@@MISSING 295@@
@@MISSING 296@@
@@MISSING 297@@
@@MISSING 298@@
@@MISSING 299@@
@@MISSING 300@@
@@MISSING 301@@
@@MISSING 302@@
@@MISSING 303@@
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
@@MISSING 374@@
@@MISSING 375@@
@@MISSING 376@@
@@MISSING 377@@
@@MISSING 378@@
@@MISSING 379@@
@@MISSING 380@@
@@MISSING 381@@
@@MISSING 382@@
@@MISSING 383@@
@@MISSING 384@@
@@MISSING 385@@
@@MISSING 386@@
@@MISSING 387@@
@@MISSING 388@@
@@MISSING 389@@
@@MISSING 390@@
@@MISSING 391@@
@@MISSING 392@@
@@MISSING 393@@
@@MISSING 394@@
@@MISSING 395@@
@@MISSING 396@@
@@MISSING 397@@
@@MISSING 398@@
@@MISSING 399@@
@@MISSING 400@@
@@MISSING 401@@
@@MISSING 402@@
@@MISSING 403@@
@@MISSING 404@@
@@MISSING 405@@
@@MISSING 406@@
@@MISSING 407@@
@@MISSING 408@@
@@MISSING 409@@
@@MISSING 410@@
@@MISSING 411@@
@@MISSING 412@@
@@MISSING 413@@
@@MISSING 414@@
@@MISSING 415@@
@@MISSING 416@@
@@MISSING 417@@
@@MISSING 418@@
@@MISSING 419@@
@@MISSING 420@@
@@MISSING 421@@
@@MISSING 422@@
@@MISSING 423@@
@@MISSING 424@@
@@MISSING 425@@
@@MISSING 426@@
@@MISSING 427@@
@@MISSING 428@@
@@MISSING 429@@
  updateCompass(yaw) {
@@MISSING 431@@
@@MISSING 432@@
@@MISSING 433@@
@@MISSING 434@@
@@MISSING 435@@
@@MISSING 436@@
@@MISSING 437@@
@@MISSING 438@@
@@MISSING 439@@
@@MISSING 440@@
@@MISSING 441@@
@@MISSING 442@@
@@MISSING 443@@
@@MISSING 444@@
@@MISSING 445@@
@@MISSING 446@@
@@MISSING 447@@
@@MISSING 448@@
@@MISSING 449@@
@@MISSING 450@@
@@MISSING 451@@
@@MISSING 452@@
@@MISSING 453@@
@@MISSING 454@@
@@MISSING 455@@
@@MISSING 456@@
@@MISSING 457@@
@@MISSING 458@@
@@MISSING 459@@
@@MISSING 460@@
@@MISSING 461@@
@@MISSING 462@@
@@MISSING 463@@
@@MISSING 464@@
@@MISSING 465@@
@@MISSING 466@@
@@MISSING 467@@
@@MISSING 468@@
@@MISSING 469@@
@@MISSING 470@@
@@MISSING 471@@
@@MISSING 472@@
@@MISSING 473@@
@@MISSING 474@@
@@MISSING 475@@
@@MISSING 476@@
@@MISSING 477@@
@@MISSING 478@@
@@MISSING 479@@
@@MISSING 480@@
@@MISSING 481@@
@@MISSING 482@@
@@MISSING 483@@
@@MISSING 484@@
@@MISSING 485@@
@@MISSING 486@@
@@MISSING 487@@
@@MISSING 488@@
@@MISSING 489@@
@@MISSING 490@@
@@MISSING 491@@
@@MISSING 492@@
@@MISSING 493@@
@@MISSING 494@@
@@MISSING 495@@
@@MISSING 496@@
@@MISSING 497@@
@@MISSING 498@@
@@MISSING 499@@
@@MISSING 500@@
@@MISSING 501@@
@@MISSING 502@@
@@MISSING 503@@
@@MISSING 504@@
@@MISSING 505@@
@@MISSING 506@@
@@MISSING 507@@
@@MISSING 508@@
@@MISSING 509@@
@@MISSING 510@@
@@MISSING 511@@
@@MISSING 512@@
@@MISSING 513@@
@@MISSING 514@@
@@MISSING 515@@
@@MISSING 516@@
@@MISSING 517@@
@@MISSING 518@@
@@MISSING 519@@
@@MISSING 520@@
@@MISSING 521@@
@@MISSING 522@@
@@MISSING 523@@
@@MISSING 524@@
@@MISSING 525@@
@@MISSING 526@@
@@MISSING 527@@
@@MISSING 528@@
@@MISSING 529@@
@@MISSING 530@@
@@MISSING 531@@
@@MISSING 532@@
@@MISSING 533@@
@@MISSING 534@@
@@MISSING 535@@
@@MISSING 536@@
@@MISSING 537@@
@@MISSING 538@@
@@MISSING 539@@
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
@@MISSING 612@@
@@MISSING 613@@
@@MISSING 614@@
@@MISSING 615@@
@@MISSING 616@@
@@MISSING 617@@
@@MISSING 618@@
@@MISSING 619@@
@@MISSING 620@@
@@MISSING 621@@
@@MISSING 622@@
@@MISSING 623@@
@@MISSING 624@@
@@MISSING 625@@
@@MISSING 626@@
@@MISSING 627@@
        node.className = 'compass-mark';
@@MISSING 629@@
@@MISSING 630@@
@@MISSING 631@@
@@MISSING 632@@
@@MISSING 633@@
@@MISSING 634@@
@@MISSING 635@@
@@MISSING 636@@
@@MISSING 637@@
@@MISSING 638@@
@@MISSING 639@@
@@MISSING 640@@
@@MISSING 641@@
@@MISSING 642@@
@@MISSING 643@@
@@MISSING 644@@
@@MISSING 645@@
@@MISSING 646@@
@@MISSING 647@@
@@MISSING 648@@
@@MISSING 649@@
@@MISSING 650@@
@@MISSING 651@@
@@MISSING 652@@
@@MISSING 653@@
@@MISSING 654@@
@@MISSING 655@@
@@MISSING 656@@
@@MISSING 657@@
@@MISSING 658@@
@@MISSING 659@@
@@MISSING 660@@
@@MISSING 661@@
@@MISSING 662@@
@@MISSING 663@@
@@MISSING 664@@
@@MISSING 665@@
@@MISSING 666@@
@@MISSING 667@@
@@MISSING 668@@
@@MISSING 669@@
@@MISSING 670@@
@@MISSING 671@@
@@MISSING 672@@
@@MISSING 673@@
@@MISSING 674@@
@@MISSING 675@@
@@MISSING 676@@
@@MISSING 677@@
@@MISSING 678@@
@@MISSING 679@@
@@MISSING 680@@
@@MISSING 681@@
@@MISSING 682@@
@@MISSING 683@@
@@MISSING 684@@
@@MISSING 685@@
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
@@MISSING 706@@
@@MISSING 707@@
@@MISSING 708@@
@@MISSING 709@@
@@MISSING 710@@
@@MISSING 711@@
@@MISSING 712@@
@@MISSING 713@@
@@MISSING 714@@
@@MISSING 715@@
@@MISSING 716@@
@@MISSING 717@@
@@MISSING 718@@
@@MISSING 719@@
@@MISSING 720@@
@@MISSING 721@@
@@MISSING 722@@
@@MISSING 723@@
@@MISSING 724@@
@@MISSING 725@@
@@MISSING 726@@
@@MISSING 727@@
@@MISSING 728@@
@@MISSING 729@@
@@MISSING 730@@
@@MISSING 731@@
@@MISSING 732@@
@@MISSING 733@@
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

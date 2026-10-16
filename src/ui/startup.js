import { BOOT, hostedServer, normaliseServer, relaunch, relaunched, serverId } from '../core/boot.js';
import { keybinds } from '../core/keybinds.js';
import { readJSON, writeJSON } from '../core/storage.js';
import { BODY } from '../geo/bodies.js';
import { PUBLIC_SERVER } from '../net/publicServer.js';
import { ServerProbe } from '../net/serverStatus.js';
import { rememberServer } from './onlinePanel.js';
import { formatPing, setSignal, signalLevel, signalMarkup } from './signal.js';
import { escapeHtml } from './worldmap.js';

/**
 * Before the game is built: alone or with everybody.
 *
 * Every time the game is opened it asks which: played locally, everything is
 * yours and kept in this browser; played online, you join the main lobby -
 * the one server everybody plays on, where whatever anybody explores is
 * uncovered on everybody's map and kept for good. The very first time, a few
 * cards come before it on what this is and how to fly.
 *
 * It asks before anything is built because the answer decides which save every
 * store reads (see core/boot.js), and changing it is a reload. So a choice that
 * matches how the page already is starts the game straight away, and a
 * different one relaunches into it - and the page that comes back does not ask
 * again. Nor does a page opened from an invite link or with ?local, which has
 * chosen already, or one a test drives (navigator.webdriver) - unless its
 * address says ?welcome. The cards are there again from "How it works".
 */

const SEEN_KEY = 'onboarded';
/** The controls card's own first-visit flag (ui/help.js): the cards below cover it. */
const HELP_SEEN_KEY = 'seen-intro';

/**
 * Where "Play online" goes: the server whose own page this is, or the one the
 * published game is pointed at (net/publicServer.js). Null when neither is set
 * up yet.
 */
export function mainLobby() {
  return hostedServer() ?? normaliseServer(PUBLIC_SERVER) ?? null;
}

function forced() {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').has('welcome');
  } catch {
    return false;
  }
}

/** Whether to ask at all, on this page. */
export function shouldAsk() {
  if (BOOT.linked || relaunched()) return false;
  if (forced()) return true;
  return !globalThis.navigator?.webdriver;
}

function touchFirst() {
  return !!globalThis.matchMedia?.('(pointer: coarse)').matches;
}

function key(action) {
  return `<kbd>${escapeHtml(keybinds.labelFor(action))}</kbd>`;
}

/** The first-time cards, in order. */
function introCards() {
  const touch = touchFirst();
  return [
    {
      title: 'Welcome to TerraGlide',
      body: `
        <p>The real planet, from satellite imagery and real terrain, to walk, glide and fly over.
          Jump off anything high, open your wings and go anywhere on Earth, or the Moon, Mars and further.</p>
        <p class="startup-dim">A few quick cards, then you choose how to play.</p>`,
    },
    {
      title: 'Flying',
      body: touch
        ? `<ul class="startup-keys startup-touch">
            <li><span>Move and look</span><span>the stick on the left, drag on the right</span></li>
            <li><span>Jump, then jump again in the air</span><span>opens the wings</span></li>
            <li><span>Rocket</span><span>a boost forward, and it opens the wings for you</span></li>
            <li><span>Dive to build speed</span><span>pull up to trade it for height</span></li>
          </ul>`
        : `<ul class="startup-keys">
            <li><span>${key('forward')}${key('left')}${key('back')}${key('right')}</span><span>Move</span></li>
            <li><span>${key('jump')}</span><span>Jump, and again in the air to open the wings</span></li>
            <li><span>${key('rocket')}</span><span>Fire a rocket: a boost, and it opens the wings for you</span></li>
            <li><span>${key('rtp')}</span><span>Drop somewhere at random</span></li>
            <li><span>${key('help')}</span><span>Every control, any time</span></li>
          </ul>
          <p class="startup-dim">Dive to build speed, pull up to trade it back for height.</p>`,
    },
    {
      title: 'Exploring',
      body: `
        <p>Everywhere you go is uncovered on your map. Open the world map${touch ? '' : ` with ${key('worldMap')}`}
          and the top of it says how much of the whole Earth, and of its land, has been explored,
          to seven decimal places, so you can watch them climb as you fly.</p>`,
    },
    {
      title: 'Alone or together',
      body: `
        <ul class="startup-modes">
          <li><strong>Local</strong> Just you. Everything you explore is saved in this browser.</li>
          <li><strong>Online</strong> One main lobby with everybody else. Whatever anybody explores goes on
            one map for everyone, saved for good, and the count on the world map is everybody's together.</li>
        </ul>
        <p class="startup-dim">You choose every time you start, so you can switch whenever you like.</p>`,
    },
  ];
}

/**
 * Ask, if this page should. Resolves true when the game should start as the
 * page is; false when the page is relaunching into the other choice.
 *
 * @param {HTMLElement} root where the screen goes, above the boot screen
 */
export function askHowToPlay(root) {
  if (!shouldAsk()) return Promise.resolve(true);
  return new Promise((done) => {
    const screen = new StartupScreen(root, done);
    screen.show(readJSON(SEEN_KEY, false) ? 'choose' : 'intro');
  });
}

class StartupScreen {
  constructor(root, done) {
    this.done = done;
    this.cards = introCards();
    this.card = 0;
    this.lobby = mainLobby();
    this.element = document.createElement('div');
    this.element.className = 'startup';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'TerraGlide');
    root.appendChild(this.element);

    this.element.addEventListener('click', (event) => {
      const button = event.target.closest('[data-do]');
      if (button && !button.disabled) this.act(button.dataset.do, button);
    });
    this.onKey = (event) => this.key(event);
    window.addEventListener('keydown', this.onKey);
    // The boot watchdog in index.html gives a page twenty seconds to start, and
    // a question on screen is not a page failing to start: it waits, and has
    // its twenty seconds again once there is an answer.
    window.__terraglideAsking = true;
  }

  show(step) {
    this.step = step;
    this.render();
  }

  render() {
    if (this.step === 'intro') {
      const card = this.cards[this.card];
      const last = this.card === this.cards.length - 1;
      this.element.innerHTML = `
        <div class="startup-card">
          <div class="startup-head">
            <h1>${escapeHtml(card.title)}</h1>
            <button type="button" class="startup-skip" data-do="skip">Skip</button>
          </div>
          <div class="startup-body">${card.body}</div>
          <div class="startup-foot">
            <span class="startup-dots" aria-label="Card ${this.card + 1} of ${this.cards.length}">${this.cards
              .map((_, i) => `<i class="${i === this.card ? 'on' : ''}"></i>`)
              .join('')}</span>
            <span class="startup-nav">
              ${this.card ? '<button type="button" data-do="back">Back</button>' : ''}
              <button type="button" class="primary" data-do="next">${last ? 'Choose how to play' : 'Next'}</button>
            </span>
          </div>
        </div>`;
      this.element.querySelector('[data-do="next"]')?.focus();
      return;
    }

    const lobby = this.lobby;
    const other = BOOT.mode === 'online' && BOOT.server && BOOT.server !== lobby ? BOOT.server : null;
    const online = BOOT.mode === 'online' && !!lobby && BOOT.server === lobby;
    this.element.innerHTML = `
      <div class="startup-card">
        <div class="startup-head"><h1>How do you want to play?</h1></div>
        <div class="startup-choices">
          <button type="button" class="startup-choice${online ? '' : ' last'}" data-do="local">
            <strong>Play locally</strong>
            <span>Just you. Everything you explore is saved in this browser.</span>
          </button>
          <button type="button" class="startup-choice${online ? ' last' : ''}" data-do="online" ${lobby ? '' : 'disabled'}>
            <strong>Play online with everyone</strong>
            <span>${lobby
              ? `The main lobby: everybody's exploring on one map, saved for good. ${escapeHtml(serverId(lobby))}`
              : 'The main lobby is not open yet. Its host points the game at it (HOSTING.md, "The public server").'}</span>
            ${lobby ? `<span class="startup-server" data-state="checking">
              <i class="startup-dot"></i>
              <b data-server="text">Checking the main lobby\u2026</b>
              <span class="startup-ping">${signalMarkup(signalLevel(NaN))}<em data-server="ping">${formatPing(NaN)}</em></span>
            </span>` : ''}
          </button>
        </div>
        ${other ? `<p class="startup-other">or <button type="button" class="link" data-do="other">go back to ${escapeHtml(serverId(other))}</button></p>` : ''}
        <div class="startup-foot">
          <span class="startup-dim">${escapeHtml(BODY.name)} · asked every time you start</span>
          <button type="button" class="link" data-do="intro">How it works</button>
        </div>
      </div>`;
    // The way you played last time is the one Enter takes.
    (this.element.querySelector('.startup-choice.last:not([disabled])') ?? this.element.querySelector('.startup-choice'))?.focus();
    this.watchLobby();
  }

  /**
   * Whether the main lobby is up, how many are on it and how quick it is,
   * on its button and kept current while the question is on screen. A lobby
   * that does not answer greys the button out, with a red light, until it
   * does again.
   */
  watchLobby() {
    if (!this.lobby) return;
    if (!this.probe) {
      this.probe = new ServerProbe(this.lobby);
      this.probe.on('change', () => this.showLobby());
      this.probe.start();
    }
    this.showLobby();
  }

  showLobby() {
    const probe = this.probe;
    const box = this.element.querySelector('.startup-server');
    const button = this.element.querySelector('[data-do="online"]');
    if (!probe || !box || !button) return;
    const state = probe.state;
    let text = 'Checking the main lobby\u2026';
    if (state === 'down') text = 'Down: the main lobby is not answering';
    else if (state === 'up') {
      const { online, max } = probe.info ?? {};
      const full = max > 0 && online >= max;
      text = full ? `Up, but full: ${online} of ${max} playing` : `Up \u00b7 ${online} playing`;
    }
    if (box.dataset.state !== state) box.dataset.state = state;
    const label = box.querySelector('[data-server="text"]');
    if (label.textContent !== text) label.textContent = text;
    setSignal(box.querySelector('.signal'), signalLevel(probe.ping, { up: state !== 'down' }));
    const ping = state === 'up' ? formatPing(probe.ping) : state === 'down' ? 'no answer' : formatPing(NaN);
    const pingText = box.querySelector('[data-server="ping"]');
    if (pingText.textContent !== ping) pingText.textContent = ping;
    const down = state === 'down';
    if (button.disabled !== down) {
      const hadFocus = document.activeElement === button;
      button.disabled = down;
      if (hadFocus && down) this.element.querySelector('[data-do="local"]')?.focus();
    }
  }

  key(event) {
    if (event.key === 'Escape' && this.step === 'intro') {
      event.preventDefault();
      this.act('skip');
      return;
    }
    if (this.step === 'intro') {
      if (event.key === 'ArrowRight') this.act('next');
      else if (event.key === 'ArrowLeft' && this.card) this.act('back');
      return;
    }
    // Arrow keys move between the two choices; Enter and Space press the
    // focused one, as buttons do.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const buttons = [...this.element.querySelectorAll('.startup-choice:not([disabled])')];
      const at = buttons.indexOf(document.activeElement);
      const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      buttons[(at + step + buttons.length) % buttons.length]?.focus();
      event.preventDefault();
    }
  }

  act(what) {
    switch (what) {
      case 'next':
        if (this.card < this.cards.length - 1) {
          this.card += 1;
          this.render();
        } else this.finishIntro();
        break;
      case 'back':
        this.card = Math.max(0, this.card - 1);
        this.render();
        break;
      case 'skip':
        this.finishIntro();
        break;
      case 'intro':
        this.card = 0;
        this.show('intro');
        break;
      case 'local':
        this.choose('local', null);
        break;
      case 'online':
        if (this.lobby && this.probe?.state !== 'down') this.choose('online', this.lobby);
        break;
      case 'other':
        if (BOOT.server) this.choose('online', BOOT.server);
        break;
      default:
        break;
    }
  }

  finishIntro() {
    writeJSON(SEEN_KEY, true);
    writeJSON(HELP_SEEN_KEY, true);
    this.show('choose');
  }

  choose(mode, server) {
    const same = mode === BOOT.mode && (mode === 'local' || server === BOOT.server);
    this.probe?.stop();
    window.removeEventListener('keydown', this.onKey);
    this.element.remove();
    window.__terraglideAsking = false;
    if (same) {
      globalThis.__terraglideWatch?.();
      this.done(true);
      return;
    }
    if (server) rememberServer(server);
    const status = document.getElementById('boot-status');
    const reason = mode === 'local' ? 'Playing locally' : server === this.lobby ? 'Joining the main lobby' : `Joining ${serverId(server)}`;
    if (status) status.textContent = `${reason}…`;
    // Said on the page that comes back too, and that page does not ask again.
    relaunch({ mode, server: mode === 'online' ? server : undefined, reason });
    this.done(false);
  }
}

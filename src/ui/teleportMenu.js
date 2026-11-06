import { keybinds } from '../core/keybinds.js';
import { settings } from '../core/settings.js';
import { formatDistance } from '../core/units.js';
import { BOOT } from '../core/boot.js';
import { BODIES } from '../geo/bodies.js';
import { bearing, haversine } from '../geo/mercator.js';
import { MAX_HEALTH, TPA_TIMEOUT_S } from '../net/protocol.js';
import { escapeHtml } from './worldmap.js';

/**
 * The teleport picker: one key, pick what kind of teleport, type a few letters
 * of a name, done.
 *
 * Typing `/tpa SomeLongName_42` in chat is fine when you know the name and
 * awkward when you only half remember it. This is the same thing as a click
 * menu: the two kinds of request side by side at the top — go to them, or
 * bring them here — and below, everyone online, narrowed to the ones whose
 * names contain what you have typed so far, best match first. Enter sends to
 * the highlighted one, a click sends to the one you clicked. Admins get the
 * two instant versions as well.
 *
 * What it sends is the command you would have typed, through the same chat
 * path, so the menu and the chat can never disagree about what a request is —
 * and the server's answer ("Asked Alex. They have 40 s to answer") lands in
 * the chat like any other.
 */

const MODES = [
  { id: 'tpa', label: 'TPA', hint: 'Ask to go to them', command: (name) => `/tpa ${name}` },
  { id: 'tpahere', label: 'TPA here', hint: 'Ask them to come to you', command: (name) => `/tpahere ${name}` },
];
/** The two that do not ask. Only a server admin sees them. */
const ADMIN_MODES = [
  { id: 'tp', label: 'TP', hint: 'Go there now', admin: true, command: (name) => `/tp ${name}` },
  { id: 'tphere', label: 'TP here', hint: 'Bring them now', admin: true, command: (name, me) => `/tp ${name} ${me}` },
];

/**
 * How well `name` answers `query`: a lower number is a better match, and
 * Infinity is no match at all. A name that starts with what you typed beats
 * one that merely contains it, and an exact name beats both, so "al" puts Alex
 * above Sal and "sal" puts Sal first.
 */
export function matchRank(name, query) {
  const q = query.trim().toLowerCase();
  if (!q) return 2;
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  const at = n.indexOf(q);
  return at < 0 ? Infinity : 2 + at / 100;
}

/** The name with the matched part wrapped in <mark>, already escaped. */
function highlight(name, query) {
  const q = query.trim().toLowerCase();
  const at = q ? name.toLowerCase().indexOf(q) : -1;
  if (at < 0) return escapeHtml(name);
  return `${escapeHtml(name.slice(0, at))}<mark>${escapeHtml(name.slice(at, at + q.length))}</mark>${escapeHtml(name.slice(at + q.length))}`;
}

export class TeleportMenu {
  /**
   * @param {HTMLElement} root
   * @param {import('../net/session.js').OnlineSession} session
   * @param {() => {lat:number, lon:number}} where
   */
  constructor(root, session, where) {
    this.session = session;
    this.where = where;
    this.open = false;
    // A request sent from here and not answered yet: the notice waits for the
    // server, which may say no (see below).
    this.waiting = null;
    this.mode = 'tpa';
    this.query = '';
    this.highlighted = 0;
    this.shown = [];
    /** Called with a short line for a toast once a request has gone. */
    this.onSent = null;
    // The notice is the server's answer, not the menu's hope. It said "asked"
    // the moment Enter went down, so a request the server turned down -
    // asked again too soon, somebody dead, nobody by that name - was announced
    // as sent all the same. What comes back is either the request itself or
    // an error line, and the notice is whichever arrives.
    session.on('requestSent', (m) => {
      const w = this.waiting;
      if (!w) return;
      // A request to somebody else, from the chat box, is not this one.
      if (m.to.name.toLowerCase() !== w.name.toLowerCase()) return;
      this.waiting = null;
      // In the server's spelling of the name, which is how the other player
      // will see it.
      this.onSent?.(`${w.mode === 'tpa' ? 'Asked to go to' : 'Asked to bring'} ${m.to.name} — they have ${TPA_TIMEOUT_S} s`);
    });
    session.on('chat', (m) => {
      const w = this.waiting;
      if (!w || m.kind !== 'error') return;
      this.waiting = null;
      // An error this soon after is the answer to it; later, something else.
      if (performance.now() - w.at < 5000) this.onSent?.(m.text, 'warn');
    });
    // A new connection has no answers coming for the old one.
    session.on('auth', () => {
      this.waiting = null;
    });

    this.element = document.createElement('div');
    this.element.className = 'panel tp-menu';
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="panel-head">
        <h2>Teleport</h2>
        <button type="button" class="panel-close" data-close>Close <kbd>Esc</kbd></button>
      </div>
      <div class="tp-modes" role="radiogroup" aria-label="Kind of teleport"></div>
      <input class="tp-search" type="text" spellcheck="false" autocomplete="off"
        placeholder="Type a name…" aria-label="Player name" maxlength="16" />
      <ul class="tp-list" role="listbox"></ul>
      <ul class="tp-outgoing"></ul>
      <p class="tp-help"></p>`;
    root.appendChild(this.element);
    this.modesEl = this.element.querySelector('.tp-modes');
    this.input = this.element.querySelector('.tp-search');
    this.listEl = this.element.querySelector('.tp-list');
    this.outgoingEl = this.element.querySelector('.tp-outgoing');
    this.helpEl = this.element.querySelector('.tp-help');

    this.element.addEventListener('click', (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;
      if (target.closest('[data-close]')) {
        this.close();
        return;
      }
      const mode = target.closest('[data-mode]');
      if (mode) {
        this.setMode(mode.dataset.mode);
        this.input.focus();
        return;
      }
      const row = target.closest('[data-player]');
      if (row) {
        this.send(Number(row.dataset.player));
        return;
      }
      const cancel = target.closest('[data-cancel]');
      if (cancel) {
        this.session.chat(`/tpacancel ${cancel.dataset.cancel}`);
        this.input.focus();
      }
    });
    this.element.addEventListener('pointermove', (event) => {
      const row = event.target instanceof HTMLElement ? event.target.closest('[data-index]') : null;
      if (row && Number(row.dataset.index) !== this.highlighted) {
        this.highlighted = Number(row.dataset.index);
        this.paintHighlight();
      }
    });
    this.input.addEventListener('input', () => {
      this.query = this.input.value;
      this.highlighted = 0;
      this.render();
    });
    this.input.addEventListener('keydown', (event) => this.onKey(event));
    // Clicks on the panel's own empty space keep the typing where it was.
    this.element.addEventListener('pointerup', () => {
      if (this.open && document.activeElement !== this.input) this.input.focus();
    });

    for (const name of ['roster', 'requestSent', 'requestEnd', 'auth']) {
      session.on(name, () => this.open && this.render());
    }
    // Distances change as everyone flies about; the rows are only rebuilt
    // when who is on the list changes, so this never moves a row under the
    // pointer.
    this.timer = setInterval(() => this.open && this.render(), 1000);
  }

  get modes() {
    return this.session.you?.admin ? [...MODES, ...ADMIN_MODES] : MODES;
  }

  show(mode) {
    if (mode) this.mode = mode;
    if (!this.modes.some((m) => m.id === this.mode)) this.mode = 'tpa';
    this.open = true;
    this.element.hidden = false;
    this.query = '';
    this.input.value = '';
    this.highlighted = 0;
    this.built = null;
    this.render();
    // After the key that opened this has finished, or its letter lands in the
    // box.
    setTimeout(() => {
      if (this.open) this.input.focus();
    }, 0);
  }

  close() {
    this.open = false;
    this.element.hidden = true;
    this.input.blur();
  }

  toggle(mode) {
    if (this.open && (!mode || mode === this.mode)) this.close();
    else this.show(mode);
  }

  setMode(id) {
    if (!this.modes.some((m) => m.id === id)) return;
    this.mode = id;
    this.renderModes();
    this.renderHelp();
  }

  onKey(event) {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      case 'Tab': {
        // Tab is the one key that switches the kind of teleport, so your
        // hands never leave the keyboard: type, Tab, Enter.
        event.preventDefault();
        const list = this.modes;
        const at = list.findIndex((m) => m.id === this.mode);
        const next = (at + (event.shiftKey ? list.length - 1 : 1)) % list.length;
        this.setMode(list[next].id);
        return;
      }
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!this.shown.length) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.highlighted = (this.highlighted + step + this.shown.length) % this.shown.length;
        this.paintHighlight();
        return;
      }
      case 'Enter': {
        event.preventDefault();
        const p = this.shown[this.highlighted];
        if (p) this.send(p.id);
        return;
      }
      default:
    }
  }

  /** Everyone you could teleport with, filtered by the query, best first. */
  candidates() {
    const me = this.where();
    const query = this.query;
    return this.session
      .players()
      .map((p) => {
        const here = p.world === BOOT.world;
        const distance = here && p.now ? haversine(me, p.now) : Infinity;
        return { p, rank: matchRank(p.name, query), here, distance };
      })
      .filter((c) => c.rank !== Infinity)
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          Number(b.here) - Number(a.here) ||
          a.distance - b.distance ||
          a.p.name.localeCompare(b.p.name),
      );
  }

  send(id) {
    const p = this.session.remote.get(id);
    const mode = this.modes.find((m) => m.id === this.mode) ?? MODES[0];
    if (!p) return;
    this.waiting = mode.admin ? null : { name: p.name, mode: mode.id, at: performance.now() };
    this.session.chat(mode.command(p.name, this.session.you?.name ?? ''));
    this.close();
    if (mode.admin) this.onSent?.(`${mode.label} — ${p.name}`);
  }

  render() {
    if (!this.open) return;
    this.renderModes();
    const list = this.candidates();
    this.shown = list.map((c) => c.p);
    if (this.highlighted >= this.shown.length) this.highlighted = Math.max(0, this.shown.length - 1);

    const key = `${this.query}|${this.shown.map((p) => p.id).join(',')}`;
    if (key !== this.built) {
      this.built = key;
      const total = this.session.players().length;
      this.listEl.innerHTML = list.length
        ? list.map(({ p }, i) => `
          <li data-player="${p.id}" data-index="${i}" role="option" style="--player:${escapeHtml(p.colour)}">
            <i class="players-dot"></i>
            <span class="tp-name">${highlight(p.name, this.query)}${p.admin ? ' <em>admin</em>' : ''}</span>
            <span class="tp-where" data-where></span>
            <span class="tp-hearts" data-hearts></span>
          </li>`).join('')
        : `<li class="tp-empty">${total ? `Nobody online has "${escapeHtml(this.query.trim())}" in their name`
          : 'Nobody else is online yet'}</li>`;
    }
    // The parts that change while you look: where they are and how they are.
    const me = this.where();
    const units = settings.get('units');
    for (const { p, here } of list) {
      const row = this.listEl.querySelector(`[data-player="${p.id}"]`);
      if (!row) continue;
      let where;
      if (!here) where = `on ${escapeHtml(BODIES[p.world]?.name ?? p.world)}`;
      else if (p.now) {
        const d = haversine(me, p.now);
        const deg = ((bearing(me, p.now) * 180) / Math.PI + 360) % 360;
        where = `${formatDistance(d, units)} <i class="players-arrow" style="transform:rotate(${deg.toFixed(0)}deg)"></i>`;
      } else where = 'landing…';
      const whereEl = row.querySelector('[data-where]');
      if (whereEl.innerHTML !== where) whereEl.innerHTML = where;
      const hearts = p.dead ? 'dead' : `<i class="heart-icon"></i>${Math.ceil((p.health ?? MAX_HEALTH) / 2)}`;
      const heartsEl = row.querySelector('[data-hearts]');
      if (heartsEl.innerHTML !== hearts) heartsEl.innerHTML = hearts;
    }
    this.paintHighlight();
    this.renderOutgoing();
    this.renderHelp();
  }

  renderModes() {
    const key = `${this.mode}|${this.modes.length}`;
    if (key === this.modesBuilt) return;
    this.modesBuilt = key;
    this.modesEl.innerHTML = this.modes.map((m) => `
      <button type="button" data-mode="${m.id}" role="radio" aria-checked="${m.id === this.mode}"
        class="tp-mode${m.id === this.mode ? ' on' : ''}${m.admin ? ' admin' : ''}">
        <b>${escapeHtml(m.label)}</b><span>${escapeHtml(m.hint)}</span>
      </button>`).join('');
  }

  paintHighlight() {
    this.listEl.querySelectorAll('[data-index]').forEach((row) => {
      const on = Number(row.dataset.index) === this.highlighted;
      row.classList.toggle('on', on);
      row.setAttribute('aria-selected', String(on));
    });
  }

  /** Requests you have sent and can still take back. */
  renderOutgoing() {
    const sent = [...this.session.sent.values()];
    const key = sent.map((r) => r.id).join(',');
    if (key !== this.outgoingBuilt) {
      this.outgoingBuilt = key;
      this.outgoingEl.innerHTML = sent.map((r) => `
        <li data-sent="${r.id}">${r.kind === 'tpa' ? 'Asked to go to' : 'Asked to bring'} <b>${escapeHtml(r.to?.name ?? '')}</b>
          <span class="tp-left"></span>
          <button type="button" class="mini" data-cancel="${escapeHtml(r.to?.name ?? '')}">Take back</button></li>`).join('');
    }
    for (const r of sent) {
      const label = this.outgoingEl.querySelector(`[data-sent="${r.id}"] .tp-left`);
      if (!label) continue;
      const left = Math.max(0, Math.ceil((r.expiresIn ?? TPA_TIMEOUT_S) - (performance.now() - r.at) / 1000));
      const text = `${left}s`;
      if (label.textContent !== text) label.textContent = text;
    }
  }

  renderHelp() {
    const mode = this.modes.find((m) => m.id === this.mode) ?? MODES[0];
    const text = `<kbd>Tab</kbd> switches kind · <kbd>Up</kbd> <kbd>Down</kbd> pick · <kbd>Enter</kbd> sends
      <code>${escapeHtml(mode.command('name', 'you'))}</code> · opens with <kbd>${escapeHtml(keybinds.labelFor('teleportMenu'))}</kbd>`;
    if (this.helpEl.innerHTML !== text) this.helpEl.innerHTML = text;
  }
}

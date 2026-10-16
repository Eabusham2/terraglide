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
@@MISSING 61@@
@@MISSING 62@@
@@MISSING 63@@
@@MISSING 64@@
@@MISSING 65@@
@@MISSING 66@@
@@MISSING 67@@
@@MISSING 68@@
@@MISSING 69@@
@@MISSING 70@@
@@MISSING 71@@
@@MISSING 72@@
@@MISSING 73@@
@@MISSING 74@@
    this.mode = 'tpa';
@@MISSING 76@@
@@MISSING 77@@
@@MISSING 78@@
@@MISSING 79@@
@@MISSING 80@@
@@MISSING 81@@
@@MISSING 82@@
@@MISSING 83@@
@@MISSING 84@@
@@MISSING 85@@
@@MISSING 86@@
@@MISSING 87@@
@@MISSING 88@@
@@MISSING 89@@
@@MISSING 90@@
@@MISSING 91@@
@@MISSING 92@@
@@MISSING 93@@
      this.onSent?.(`${w.mode === 'tpa' ? 'Asked to go to' : 'Asked to bring'} ${m.to.name} — they have ${TPA_TIMEOUT_S} s`);
@@MISSING 95@@
@@MISSING 96@@
@@MISSING 97@@
@@MISSING 98@@
@@MISSING 99@@
@@MISSING 100@@
@@MISSING 101@@
@@MISSING 102@@
@@MISSING 103@@
@@MISSING 104@@
@@MISSING 105@@
@@MISSING 106@@
@@MISSING 107@@
@@MISSING 108@@
@@MISSING 109@@
@@MISSING 110@@
@@MISSING 111@@
@@MISSING 112@@
@@MISSING 113@@
@@MISSING 114@@
@@MISSING 115@@
@@MISSING 116@@
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
@@MISSING 304@@
@@MISSING 305@@
@@MISSING 306@@
@@MISSING 307@@
@@MISSING 308@@
@@MISSING 309@@
@@MISSING 310@@
@@MISSING 311@@
@@MISSING 312@@
@@MISSING 313@@
@@MISSING 314@@
@@MISSING 315@@
@@MISSING 316@@
@@MISSING 317@@
@@MISSING 318@@
@@MISSING 319@@
@@MISSING 320@@
@@MISSING 321@@
@@MISSING 322@@
@@MISSING 323@@
@@MISSING 324@@
@@MISSING 325@@
@@MISSING 326@@
@@MISSING 327@@
@@MISSING 328@@
@@MISSING 329@@
@@MISSING 330@@
@@MISSING 331@@
@@MISSING 332@@
@@MISSING 333@@
@@MISSING 334@@
@@MISSING 335@@
@@MISSING 336@@
@@MISSING 337@@
@@MISSING 338@@
@@MISSING 339@@
@@MISSING 340@@
@@MISSING 341@@
@@MISSING 342@@
@@MISSING 343@@
@@MISSING 344@@
@@MISSING 345@@
@@MISSING 346@@
@@MISSING 347@@
@@MISSING 348@@
@@MISSING 349@@
@@MISSING 350@@
@@MISSING 351@@
@@MISSING 352@@
@@MISSING 353@@
@@MISSING 354@@
@@MISSING 355@@
@@MISSING 356@@
@@MISSING 357@@
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

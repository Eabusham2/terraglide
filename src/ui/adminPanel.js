import { BODIES } from '../geo/bodies.js';
import { MAX_HEALTH } from '../net/protocol.js';
import { escapeHtml } from './worldmap.js';

/**
 * The admin panel: the server, from inside the game.
 *
 * Only an admin's account has it (the Online panel offers it them). On a
 * server with an admin access code (server/config.mjs, adminCode) it opens on
 * a box for the code, and once that is right it stays open for this browser
 * until it signs out or the server restarts; a wrong code costs a try, a few
 * a quarter of an hour.
 *
 * Then: who is on, where, their hearts and what the anti-cheat holds against
 * them, with go to, bring here, heal, kick and ban; the bans, to lift; what
 * the anti-cheat saw lately; PvP, new accounts and the welcome message; an
 * announcement to everyone; and the spawn moved to where you stand.
 *
 * What it does to players is the admin commands, sent as typed - the same
 * path as the chat, so the panel and /kick never disagree - and their
 * answers come back in the chat and here.
 */

/** How often the lists are asked for again while the panel is open. */
const REFRESH_MS = 2000;
/** How long a second click has to confirm a ban. */
const CONFIRM_MS = 4000;

function ago(seconds) {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} days`;
}

export class AdminPanel {
  /**
   * @param {HTMLElement} root
   * @param {import('../net/session.js').OnlineSession} session
   */
  constructor(root, session) {
    this.session = session;
    this.open = false;
    /** The server's last word on what the panel shows: see the server's adminState. */
    this.state = null;
    this.error = '';
    this.note = '';
    this.busy = false;
    /** The ban waiting for its second click: { name, until }. */
    this.confirming = null;
    /** Until when a line in the chat is the answer to something done here. */
    this.listening = 0;
    this.element = document.createElement('div');
    this.element.className = 'panel admin-panel';
    this.element.hidden = true;
    this.element.tabIndex = -1;
    this.element.innerHTML = `
      <div class="panel-head">
        <h2>Admin panel</h2>
        <button type="button" class="panel-close" data-action="close">Close</button>
      </div>
      <div class="admin-body">
        <form class="admin-lock online-form" data-form="unlock" autocomplete="off">
          <p class="online-intro">Your admin powers on this server are locked. Type the admin access code to open them —
            this browser keeps them open until you sign out or the server restarts.</p>
          <label>Access code
            <input name="code" type="password" inputmode="numeric" autocomplete="off" maxlength="64" />
          </label>
          <button type="submit" class="primary">Unlock</button>
          <p class="online-error admin-lock-error" hidden></p>
        </form>
        <div class="admin-main" hidden>
          <div class="admin-summary"></div>
          <p class="admin-note" hidden></p>
          <h3>Server</h3>
          <form class="admin-settings" data-form="settings" autocomplete="off">
            <label class="admin-check"><input type="checkbox" name="pvp" /> PvP — players can hurt each other</label>
            <label class="admin-check"><input type="checkbox" name="signups" /> New accounts can be made</label>
            <label class="admin-line">Welcome message
              <span><input name="motd" type="text" maxlength="200" /><button type="submit" class="mini">Save</button></span>
            </label>
          </form>
          <form class="admin-say" data-form="say" autocomplete="off">
            <label class="admin-line">Announce to everyone
              <span><input name="text" type="text" maxlength="240" placeholder="Server restarting in five minutes" />
              <button type="submit" class="mini">Send</button></span>
            </label>
          </form>
          <div class="admin-tools">
            <button type="button" class="mini" data-action="setspawn" title="Make where you stand this world's spawn">Set spawn here</button>
            <button type="button" class="mini" data-action="lock" title="Lock your admin powers again until the code is typed">Lock panel</button>
          </div>
          <h3>Players online</h3>
          <label class="admin-line">Reason for a kick or ban
            <span><input class="admin-reason" type="text" maxlength="120" placeholder="optional" /></span>
          </label>
          <div class="admin-players"></div>
          <h3>Bans</h3>
          <div class="admin-bans"></div>
          <h3>Anti-cheat, newest first</h3>
          <div class="admin-cheats"></div>
        </div>
      </div>`;
    this.lockForm = this.element.querySelector('.admin-lock');
    this.main = this.element.querySelector('.admin-main');
    this.settingsForm = this.element.querySelector('.admin-settings');
    root.appendChild(this.element);

    this.element.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit(event.target);
    });
    this.element.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      button.blur();
      this.element.focus({ preventScroll: true });
      this.act(button.dataset.action, button.dataset.name ?? '');
    });
    this.element.addEventListener('change', (event) => {
      const box = event.target.closest('.admin-settings input[type=checkbox]');
      if (!box) return;
      this.session.admin('settings', { [box.name]: box.checked });
    });
    // Typing in here is not flying, and Escape closes it.
    this.element.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') this.close();
    });

    session.on('admin', (m) => this.receive(m));
    session.on('chat', (m) => {
      // The answer to a button here, said here too.
      if (!this.open || performance.now() > this.listening) return;
      if (m.kind !== 'system' && m.kind !== 'error' && m.kind !== 'help') return;
      this.note = { text: String(m.text ?? '').slice(0, 600), bad: m.kind === 'error' };
      this.listening = 0;
      this.renderNote();
      this.ask();
    });
    session.on('auth', () => {
      this.state = null;
      if (this.open && !this.isAdmin) this.close();
      else if (this.open) this.ask();
    });
    this.timer = setInterval(() => {
      if (this.open && this.unlocked && !this.element.matches(':hover')) this.ask();
    }, REFRESH_MS);
  }

  /** Is the signed-in account an admin at all? */
  get isAdmin() {
    return !!this.session.you?.adminRole;
  }

  /** Are its powers open: no code on this server, or the code typed? */
  get unlocked() {
    return !!this.session.you?.admin;
  }

  show() {
    if (!this.isAdmin) return;
    this.open = true;
    this.element.hidden = false;
    this.error = '';
    this.render();
    this.ask();
    setTimeout(() => {
      if (!this.unlocked) this.lockForm.querySelector('input')?.focus();
      else this.element.focus({ preventScroll: true });
    }, 30);
  }

  close() {
    this.open = false;
    this.element.hidden = true;
    this.confirming = null;
    document.activeElement?.blur?.();
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  ask() {
    if (this.unlocked) this.session.admin('state');
  }

  receive(m) {
    switch (m.op) {
      case 'unlock':
        this.busy = false;
        if (m.ok === true) {
          this.error = '';
          this.lockForm.querySelector('input').value = '';
        } else this.error = String(m.error ?? 'That did not work').slice(0, 200);
        break;
      case 'locked':
        this.state = null;
        break;
      case 'state':
        this.state = m;
        break;
      default:
    }
    if (this.open) this.render();
  }

  submit(form) {
    const data = new FormData(form);
    switch (form.dataset.form) {
      case 'unlock': {
        const code = String(data.get('code') ?? '').trim();
        if (!code) return;
        this.busy = true;
        this.error = '';
        this.session.admin('unlock', { code });
        this.render();
        return;
      }
      case 'settings':
        this.session.admin('settings', { motd: String(data.get('motd') ?? '') });
        this.say('Saved');
        return;
      case 'say': {
        const text = String(data.get('text') ?? '').trim();
        if (!text) return;
        this.run(`/say ${text}`);
        form.reset();
        return;
      }
      default:
    }
  }

  /** An admin command, as typed, with its answer shown here when it comes. */
  run(text) {
    this.listening = performance.now() + 3000;
    this.session.chat(text);
  }

  act(action, name) {
    const reason = this.element.querySelector('.admin-reason')?.value.trim() ?? '';
    const me = this.session.you?.name ?? '';
    switch (action) {
      case 'close':
        this.close();
        return;
      case 'lock':
        this.session.admin('lock');
        return;
      case 'setspawn':
        this.run('/setspawn');
        return;
      case 'goto':
        this.run(`/tp ${name}`);
        return;
      case 'bring':
        this.run(`/tp ${name} ${me}`);
        return;
      case 'heal':
        this.run(`/heal ${name}`);
        return;
      case 'kick':
        this.run(`/kick ${name}${reason ? ` ${reason}` : ''}`);
        return;
      case 'ban':
        // Twice: a ban signs them out everywhere and keeps them out.
        if (this.confirming?.name !== name || performance.now() > this.confirming.until) {
          this.confirming = { name, until: performance.now() + CONFIRM_MS };
          this.renderLists();
          return;
        }
        this.confirming = null;
        this.run(`/ban ${name}${reason ? ` ${reason}` : ''}`);
        return;
      case 'unban':
        this.run(`/unban ${name}`);
        return;
      case 'pardon':
        this.run(`/pardon ${name}`);
        return;
      case 'record':
        this.run(`/cheats ${name}`);
        return;
      default:
    }
  }

  say(text) {
    this.note = { text, bad: false };
    this.renderNote();
  }

  render() {
    const unlocked = this.unlocked;
    this.lockForm.hidden = unlocked;
    this.main.hidden = !unlocked;
    if (!unlocked) {
      const error = this.lockForm.querySelector('.admin-lock-error');
      error.hidden = !this.error;
      error.textContent = this.error;
      this.lockForm.querySelector('button[type=submit]').disabled = this.busy;
      return;
    }
    const lockButton = this.element.querySelector('[data-action=lock]');
    lockButton.hidden = !this.session.you?.adminCode;
    const server = this.state?.server;
    const summary = this.element.querySelector('.admin-summary');
    summary.innerHTML = server
      ? `<div class="online-server">
          <strong>${escapeHtml(server.name)}</strong>
          <em>${server.online} of ${server.max} online · ${server.accounts} accounts · up ${ago(server.upS)}</em>
          ${Object.keys(server.explored ?? {}).length ? `<em>Explored squares: ${Object.entries(server.explored)
            .map(([world, n]) => `${escapeHtml(BODIES[world]?.name ?? world)} ${Number(n).toLocaleString()}`).join(' · ')}</em>` : ''}
        </div>`
      : '<p class="online-status">Asking the server…</p>';
    // The settings as the server has them - unless you are typing in them.
    if (server && !this.settingsForm.contains(document.activeElement)) {
      this.settingsForm.elements.pvp.checked = !!server.pvp;
      this.settingsForm.elements.signups.checked = !!server.signups;
      this.settingsForm.elements.motd.value = server.motd ?? '';
    }
    this.renderNote();
    this.renderLists();
  }

  renderNote() {
    const note = this.element.querySelector('.admin-note');
    note.hidden = !this.note;
    note.textContent = this.note?.text ?? '';
    note.classList.toggle('bad', !!this.note?.bad);
  }

  renderLists() {
    const state = this.state;
    const players = this.element.querySelector('.admin-players');
    const bans = this.element.querySelector('.admin-bans');
    const seen = this.element.querySelector('.admin-cheats');
    if (!state) {
      players.innerHTML = bans.innerHTML = seen.innerHTML = '';
      return;
    }
    const me = this.session.you?.name ?? '';
    const confirming = this.confirming && performance.now() < this.confirming.until ? this.confirming.name : null;
    players.innerHTML = state.players.length ? `<ul class="players-list admin-list">${state.players.map((p) => {
      const name = escapeHtml(p.name);
      const self = p.name === me;
      const score = p.score > 0
        ? `<span class="admin-score${p.score >= state.kickAt / 2 ? ' high' : ''}" title="Anti-cheat score; a kick at ${state.kickAt}">AC ${p.score}</span>`
        : '';
      return `<li>
        <span class="players-name">${name}${p.admin ? ' <em>admin</em>' : ''}${self ? ' <em>you</em>' : ''}</span>
        <span class="players-where">${escapeHtml(BODIES[p.world]?.name ?? p.world)} · ${p.dead ? 'dead' : `${p.health}/${MAX_HEALTH}`}</span>
        ${score}
        <span class="admin-actions">
          ${self ? '' : `<button type="button" class="mini" data-action="goto" data-name="${name}">Go to</button>
          <button type="button" class="mini" data-action="bring" data-name="${name}">Bring here</button>`}
          <button type="button" class="mini" data-action="heal" data-name="${name}">Heal</button>
          ${p.score > 0 ? `<button type="button" class="mini" data-action="record" data-name="${name}">Record</button>
          <button type="button" class="mini" data-action="pardon" data-name="${name}">Pardon</button>` : ''}
          ${self ? '' : `<button type="button" class="mini" data-action="kick" data-name="${name}">Kick</button>
          <button type="button" class="mini danger" data-action="ban" data-name="${name}">${confirming === p.name ? 'Confirm ban' : 'Ban'}</button>`}
        </span>
      </li>`;
    }).join('')}</ul>` : '<p class="online-hint">Nobody else is on.</p>';
    bans.innerHTML = state.bans.length ? `<ul class="players-list admin-list">${state.bans.map((b) => `<li>
        <span class="players-name">${escapeHtml(b.name)}</span>
        <span class="players-where">${b.kind === 'anticheat'
          ? `anti-cheat · ${ago(b.leftS)} left`
          : `by ${escapeHtml(b.by || 'an admin')}`}${b.reason ? ` · ${escapeHtml(b.reason)}` : ''}</span>
        <span class="admin-actions"><button type="button" class="mini" data-action="unban" data-name="${escapeHtml(b.name)}">Unban</button></span>
      </li>`).join('')}</ul>` : '<p class="online-hint">Nobody is banned.</p>';
    seen.innerHTML = state.log.length
      ? `<pre class="admin-log">${state.log.map((line) => escapeHtml(line)).join('\n')}</pre>`
      : '<p class="online-hint">The anti-cheat has seen nothing.</p>';
  }
}

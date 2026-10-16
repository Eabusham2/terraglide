import { BOOT, hostedServer, normaliseServer, relaunch, serverId } from '../core/boot.js';
import { PUBLIC_SERVER } from '../net/publicServer.js';
import { BODY } from '../geo/bodies.js';
import { NAME_PATTERN, PASSWORD_MAX, PASSWORD_MIN, nameProblem, passwordProblem } from '../net/protocol.js';
import { escapeHtml } from './worldmap.js';

/**
 * Playing online: where to connect, and who you are when you get there.
 *
 * Three states, one panel:
 *
 *   playing locally   a server address and a Join button. Joining reloads
 *                     the page as an online game — nothing local is carried
 *                     across, and nothing online will ever be written back.
 *   joining           connecting, then a sign-in / sign-up form. The server
 *                     keeps the session, so this is a once-per-browser form.
 *   signed in         who you are, where you are, and the ways out: sign out,
 *                     or go back to playing locally.
 *
 * The world keeps running behind it either way — you are standing somewhere
 * real while you type — but it takes the keyboard, so typing a password does
 * not fly you into a hill.
 */

const RECENT_KEY = 'terraglide.servers';

function recentServers() {
  try {
    const list = JSON.parse(globalThis.localStorage?.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((s) => typeof s === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function rememberServer(server) {
  try {
    const list = [server, ...recentServers().filter((s) => s !== server)].slice(0, 6);
    globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* fine */
  }
}

export class OnlinePanel {
  /**
   * @param {HTMLElement} root
   * @param {import('../net/session.js').OnlineSession|null} session
   */
  constructor(root, session) {
    this.session = session;
    this.open = false;
    this.mode = 'login';
    this.element = document.createElement('div');
    this.element.className = 'panel online-panel';
    this.element.hidden = true;
    root.appendChild(this.element);
    this.element.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit(event.target);
    });
    this.element.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      button.blur();
      this.act(button.dataset.action, button);
    });
    // Typing in here must not reach the game. The game checks for inputs
    // itself, but Escape is ours: it closes the panel rather than opening the
    // settings behind it.
    this.element.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape' && !this.mustStay) this.close();
    });
    if (session) {
      session.on('status', () => this.render());
      session.on('needsAuth', () => {
        this.show();
        this.render();
      });
      // The answer to Change password, said in the panel where it was asked.
      session.on('password', (m) => {
        this.passwordNote = m.ok ? { ok: true, text: 'Password changed' } : { ok: false, text: m.error };
        this.render();
      });
      session.on('authFailed', (m) => {
        this.error = m.error;
        this.busy = false;
        this.show();
        this.render();
      });
      session.on('auth', () => {
        this.busy = false;
        this.error = '';
        rememberServer(BOOT.server);
        this.close();
      });
      session.on('kicked', (m) => {
        this.error = m.restart ? `${m.reason} — reconnecting when it is back` : m.reason;
        this.show();
        this.render();
      });
    }
    this.render();
  }

  /** While online and not signed in, the panel cannot be closed. */
  get mustStay() {
    return !!this.session && !this.session.signedIn;
  }

  show() {
    this.open = true;
    this.element.hidden = false;
    this.render();
    // Focus the first empty field, so you can start typing.
    setTimeout(() => {
      const field = [...this.element.querySelectorAll('input')].find((i) => !i.value) ?? this.element.querySelector('input');
      field?.focus();
    }, 30);
  }

  close() {
    if (this.mustStay) return;
    this.open = false;
    this.element.hidden = true;
    document.activeElement?.blur?.();
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  render() {
    const s = this.session;
    let body;
    if (!s) body = this.renderLocal();
    else if (!s.signedIn) body = this.renderJoin();
    else body = this.renderSignedIn();
    this.element.innerHTML = `
      <div class="panel-head">
        <h2>${s ? 'Online' : 'Play online'}</h2>
        ${this.mustStay ? '' : '<button type="button" class="panel-close" data-action="close">Close</button>'}
      </div>
      <div class="online-body">${body}</div>`;
  }

  renderLocal() {
    const recent = recentServers();
    const publicServer = normaliseServer(PUBLIC_SERVER);
    return `
      <p class="online-intro">You are playing locally: everything you explore is kept in this browser.
        Join a server to fly with other people — your local save stays exactly as it is,
        and nothing you do online is written into it.</p>
      ${publicServer ? `<div class="online-public">
        <button type="button" class="primary" data-action="public">Play on the public server</button>
        <span>Everybody's discoveries on one map, parties and friends, voice. ${escapeHtml(serverId(publicServer))}</span>
      </div>
      <p class="online-or">or join another server</p>` : ''}
      <form data-form="join" class="online-form">
        <label>Server address
          <input name="server" type="text" placeholder="wss://my-server.example.com or 192.168.1.20:8080"
            autocomplete="url" spellcheck="false" value="${escapeHtml(recent[0] ?? '')}" />
        </label>
        <button type="submit" class="primary">Join server</button>
      </form>
      ${recent.length ? `<div class="online-recent"><span>Recent</span>${recent.map((r) => `
        <button type="button" class="mini" data-action="pick" data-server="${escapeHtml(r)}">${escapeHtml(serverId(r))}</button>`).join('')}</div>` : ''}
      ${this.error ? `<p class="online-error">${escapeHtml(this.error)}</p>` : ''}
      <p class="online-note">No server? Anyone can run one: <code>node server/server.mjs</code> in a copy of
        TerraGlide, then share its address. HOSTING.md walks through putting one on the internet.</p>`;
  }

  renderJoin() {
    const s = this.session;
    const status = s.net.status;
    const info = s.net.info;
    const where = escapeHtml(info?.name ?? serverId(s.server));
    const connecting = status === 'connecting' || status === 'idle' || ((status === 'closed' || status === 'failed') && !info);
    const signup = this.mode === 'signup';
    const head = `
      <div class="online-server">
        <strong>${where}</strong>
        <span>${escapeHtml(info?.motd ?? serverId(s.server))}</span>
        ${info ? `<em>${info.online} online · ${info.pvp ? 'PvP on' : 'PvP off'}</em>` : ''}
      </div>`;
    if (connecting && !info) {
      const detail = s.net.statusDetail ? `<p class="online-error">${escapeHtml(s.net.statusDetail)}</p>` : '';
      return `${head}
        <p class="online-status">${status === 'closed' || status === 'failed' ? 'Not connected — trying again…' : 'Connecting…'}</p>
        ${detail}
        <div class="online-actions"><button type="button" data-action="local">Play locally instead</button></div>`;
    }
    return `${head}
      <div class="online-tabs">
        <button type="button" data-action="tab-login" class="${signup ? '' : 'active'}">Sign in</button>
        <button type="button" data-action="tab-signup" class="${signup ? 'active' : ''}"
          ${info && !info.signups ? 'disabled title="This server is not taking new accounts"' : ''}>Make an account</button>
      </div>
      <form data-form="${signup ? 'signup' : 'login'}" class="online-form">
        <label>Username
          <input name="name" type="text" maxlength="16" autocomplete="username" spellcheck="false"
            pattern="${NAME_PATTERN.source.slice(1, -1)}" value="${escapeHtml(this.name ?? '')}" />
        </label>
        <label>Password
          <input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="${PASSWORD_MIN}" />
        </label>
        ${signup && info?.joinCode ? `<label>Join code <input name="code" type="text" autocomplete="off" /></label>` : ''}
        ${signup ? '<p class="online-hint">3–16 letters, numbers or _. Other players use it to /tpa you. You get a colour of your own.</p>' : ''}
        <button type="submit" class="primary" ${this.busy ? 'disabled' : ''}>${this.busy ? 'One moment…' : signup ? 'Make account and play' : 'Sign in'}</button>
      </form>
      ${this.error ? `<p class="online-error">${escapeHtml(this.error)}</p>` : ''}
      <div class="online-actions"><button type="button" data-action="local">Play locally instead</button></div>`;
  }

  renderSignedIn() {
    const s = this.session;
    const you = s.you;
    const others = s.players().length;
    return `
      <div class="online-server">
        <strong>${escapeHtml(s.serverName)}</strong>
        <span>${escapeHtml(s.net.info?.motd ?? '')}</span>
        <em>${others + 1} online · you are on ${escapeHtml(BODY.name)}</em>
      </div>
      <p class="online-you"><i style="--player:${escapeHtml(you.colour)}"></i>
        Signed in as <strong>${escapeHtml(you.name)}</strong>${you.admin ? ' (admin)' : ''}</p>
      <p class="online-hint">Invite someone: <code>${escapeHtml(inviteLink(s.net.info))}</code>
        <button type="button" class="mini" data-action="copy-invite">copy</button></p>
      ${onlyHere(inviteLink(s.net.info)) ? `<p class="online-note">That address only works on this computer. Friends on your
        network need this machine's own address, and friends elsewhere a tunnel or a host — HOSTING.md shows both.</p>` : ''}
      <details class="online-password"${this.passwordNote ? ' open' : ''}>
        <summary>Change password</summary>
        <form data-form="password" class="online-form">
          <input name="username" type="text" autocomplete="username" value="${escapeHtml(you.name)}" hidden />
          <label>Current password
            <input name="old" type="password" autocomplete="current-password" maxlength="${PASSWORD_MAX}" />
          </label>
          <label>New password
            <input name="new" type="password" autocomplete="new-password" maxlength="${PASSWORD_MAX}" />
          </label>
          <button type="submit">Change password</button>
        </form>
        ${this.passwordNote ? `<p class="${this.passwordNote.ok ? 'online-note' : 'online-error'}">${escapeHtml(this.passwordNote.text)}</p>` : ''}
      </details>
      <div class="online-actions">
        <button type="button" data-action="signout">Sign out</button>
        <button type="button" data-action="local">Back to playing locally</button>
      </div>`;
  }

  act(action, button) {
    switch (action) {
      case 'close':
        this.close();
        break;
      case 'pick':
        this.element.querySelector('input[name=server]').value = button.dataset.server;
        break;
      case 'public': {
        const server = normaliseServer(PUBLIC_SERVER);
        if (!server) break;
        rememberServer(server);
        relaunch({ mode: 'online', server, reason: 'Joining the public server' });
        break;
      }
      case 'tab-login':
        this.mode = 'login';
        this.error = '';
        this.render();
        break;
      case 'tab-signup':
        this.mode = 'signup';
        this.error = '';
        this.render();
        break;
      case 'local':
        if (this.session) this.session.leaveServer();
        break;
      case 'signout':
        this.session?.leaveServer({ forget: true });
        break;
      case 'copy-invite':
        navigator.clipboard?.writeText(inviteLink(this.session?.net.info)).then(() => { button.textContent = 'copied'; }, () => {});
        break;
      default:
    }
  }

  submit(form) {
    const kind = form.dataset.form;
    const data = new FormData(form);
    if (kind === 'password') {
      // Sent whole - spaces and all - not as /password, which splits on them.
      const problem = passwordProblem(String(data.get('new') ?? ''));
      if (problem) {
        this.passwordNote = { ok: false, text: problem };
        this.render();
        return;
      }
      this.session.changePassword(data.get('old'), data.get('new'));
      return;
    }
    if (kind === 'join') {
      const server = normaliseServer(data.get('server'));
      if (!server) {
        this.error = 'That does not look like a server address';
        this.render();
        return;
      }
      // A secure page cannot open a plain ws:// connection — the browser
      // refuses it before it leaves — so say so now, and where to go instead.
      if (globalThis.location?.protocol === 'https:' && server.startsWith('ws:')) {
        this.error = `This page is https, and that server is not, so the browser will not let them talk. Open the server's own page instead: ${ownPage(server)}`;
        this.render();
        return;
      }
      rememberServer(server);
      relaunch({ mode: 'online', server, reason: `Joining ${serverId(server)}` });
      return;
    }
    const name = String(data.get('name') ?? '').trim();
    const password = String(data.get('password') ?? '');
    this.name = name;
    const problem = nameProblem(name) ?? (kind === 'signup' ? passwordProblem(password) : null);
    if (problem) {
      this.error = problem;
      this.render();
      return;
    }
    this.busy = true;
    this.error = '';
    this.render();
    if (kind === 'signup') this.session.net.signup(name, password, data.get('code') ?? '');
    else this.session.net.login(name, password);
  }
}

/**
 * A link that opens the game on this server. The published game, with the
 * server in the address — or the server's own page when that is where you
 * are and it is that server you are playing on.
 */
export function inviteLink(info = null) {
  const here = globalThis.location;
  let server = BOOT.server ?? '';
  // "localhost" is the host's own machine to everybody who opens it: put the
  // machine's network address in instead, when the server said what it is.
  try {
    const url = new URL(server);
    if (/^(localhost|127\.|\[::1\])/i.test(url.hostname) && info?.lan?.[0]) {
      url.hostname = info.lan[0];
      server = url.href;
    }
  } catch {
    /* not an address; handled below */
  }
  // A plain ws:// server can only be reached from a plain http page, and every
  // TerraGlide server is one: its own.
  if (server.startsWith('ws:')) return ownPage(server);
  if (server && server === hostedServer() && here?.protocol?.startsWith('http')) return `${here.origin}/`;
  const page = here?.protocol?.startsWith('http') ? `${here.origin}${here.pathname}` : 'https://eabusham2.github.io/terraglide/';
  return `${page}?server=${encodeURIComponent(server)}`;
}

/** The game as a server serves it: its socket address, as a web page. */
export function ownPage(server) {
  try {
    const url = new URL(server);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '/';
    url.search = '';
    return url.href;
  } catch {
    return '';
  }
}

/** True for an address only the machine itself can open. */
function onlyHere(link) {
  try {
    return /^(localhost|127\.|\[::1\])/i.test(new URL(link).hostname);
  } catch {
    return false;
  }
}

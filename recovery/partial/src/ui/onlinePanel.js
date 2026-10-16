import { BOOT, hostedServer, normaliseServer, relaunch, serverId } from '../core/boot.js';
import { PUBLIC_SERVER } from '../net/publicServer.js';
@@MISSING 3@@
@@MISSING 4@@
@@MISSING 5@@
@@MISSING 6@@
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
@@MISSING 17@@
@@MISSING 18@@
@@MISSING 19@@
@@MISSING 20@@
@@MISSING 21@@
@@MISSING 22@@
@@MISSING 23@@
@@MISSING 24@@
@@MISSING 25@@
@@MISSING 26@@
@@MISSING 27@@
@@MISSING 28@@
@@MISSING 29@@
@@MISSING 30@@
@@MISSING 31@@
@@MISSING 32@@
@@MISSING 33@@
@@MISSING 34@@
@@MISSING 35@@
@@MISSING 36@@
@@MISSING 37@@
@@MISSING 38@@
@@MISSING 39@@
@@MISSING 40@@
@@MISSING 41@@
@@MISSING 42@@
@@MISSING 43@@
@@MISSING 44@@
@@MISSING 45@@
@@MISSING 46@@
@@MISSING 47@@
@@MISSING 48@@
@@MISSING 49@@
@@MISSING 50@@
@@MISSING 51@@
@@MISSING 52@@
@@MISSING 53@@
@@MISSING 54@@
@@MISSING 55@@
@@MISSING 56@@
@@MISSING 57@@
@@MISSING 58@@
@@MISSING 59@@
@@MISSING 60@@
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
@@MISSING 75@@
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
          <input name="username" type="text" autocomplete="username" value="${escapeHtml(you.name)}" hidden />
@@MISSING 237@@
            <input name="old" type="password" autocomplete="current-password" maxlength="${PASSWORD_MAX}" />
@@MISSING 239@@
@@MISSING 240@@
            <input name="new" type="password" autocomplete="new-password" maxlength="${PASSWORD_MAX}" />
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
@@MISSING 358@@
@@MISSING 359@@
@@MISSING 360@@
@@MISSING 361@@
@@MISSING 362@@
@@MISSING 363@@
@@MISSING 364@@
@@MISSING 365@@
@@MISSING 366@@
@@MISSING 367@@
@@MISSING 368@@
@@MISSING 369@@
@@MISSING 370@@
@@MISSING 371@@
@@MISSING 372@@
@@MISSING 373@@
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

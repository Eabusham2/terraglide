import { keybinds } from '../core/keybinds.js';
import { settings } from '../core/settings.js';
import { formatDistance } from '../core/units.js';
import { BOOT } from '../core/boot.js';
import { BODIES } from '../geo/bodies.js';
import { bearing, haversine } from '../geo/mercator.js';
import { MAX_HEALTH, TPA_TIMEOUT_S } from '../net/protocol.js';
import { escapeHtml } from './worldmap.js';

/**
 * Who else is here, and what you can do about them.
 *
 * Every player online, in their colour, with where they are from you — how
 * far and which way, or which world if not this one — and their hearts. Next
 * to each: ask to go to them, ask them to come to you, whisper, and show their
 * trail or what they have discovered on your map. Below them, everyone who has
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
      <form class="players-add" autocomplete="off">
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
      const together = event.target.closest('input[data-together]');
      if (together) {
        this.session.partyCommand('together', together.checked ? 'on' : 'off');
        return;
      }
      const box = event.target.closest('input[data-watch]');
      if (!box) return;
      const key = box.dataset.key;
      // "Everyone" is a setting, remembered between visits; the session
      // follows the setting.
      if (key === '*') settings.set(box.dataset.watch === 'explored' ? 'othersDiscoveries' : 'othersTrails', box.checked);
      else this.session.watch(key, { [box.dataset.watch]: box.checked });
      this.render();
    });
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.close();
      }
    });
    for (const event of ['roster', 'atlas', 'auth', 'friends', 'party', 'partyInvite', 'partyInviteEnd']) {
      session.on(event, () => this.open && this.render());
    }
    // The distances and countdowns tick over once a second — but not under
    // the pointer: rebuilding the list replaces its buttons, and a click that
    // lands on one being replaced does nothing.
    this.timer = setInterval(() => {
      if (this.open && !this.element.matches(':hover')) this.render();
    }, 1000);
  }

  show() {
    this.open = true;
    this.element.hidden = false;
    this.session.requestAtlas();
    this.render();
  }

  close() {
    this.open = false;
    this.element.hidden = true;
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  act(action, id, button) {
    const p = this.session.remote.get(Number(id));
    switch (action) {
      case 'close':
        return this.close();
      case 'tpa':
        if (p) this.session.chat(`/tpa ${p.name}`);
        return;
      case 'tpahere':
        if (p) this.session.chat(`/tpahere ${p.name}`);
        return;
      case 'msg':
        if (p) this.onWhisper?.(p.name);
        return;
      case 'mute':
        if (p && this.voice) this.voice.mute(p.id, !this.voice.isMuted(p.id));
        this.render();
        return;
      case 'accept':
      case 'deny':
        return this.session.answer(Number(id), action === 'accept');
      case 'friend-add':
        return this.session.friend('add', button.dataset.name);
      case 'friend-accept':
        return this.session.friend('accept', button.dataset.name);
      case 'friend-deny':
        return this.session.friend('deny', button.dataset.name);
      case 'friend-remove':
        return this.session.friend('remove', button.dataset.name);
      case 'friend-tpa':
        return this.session.chat(`/tpa ${button.dataset.name}`);
      case 'party-invite':
        return this.session.partyCommand('invite', button.dataset.name);
      case 'party-accept':
      case 'party-deny':
        return this.session.answerParty(Number(id), action === 'party-accept');
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
        settings.set('voiceMode', 'push');
        if (!settings.get('partyVoice')) settings.set('partyVoice', true);
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
    const units = settings.get('units');
    const list = session.players().slice().sort((a, b) => {
      const sameA = a.world === BOOT.world ? 0 : 1;
      const sameB = b.world === BOOT.world ? 0 : 1;
      return sameA - sameB || (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.name.localeCompare(b.name);
    });
    // Somebody online on another world may still have been here: what they
    // found on this world can be shown like anyone else's.
    const mapped = new Set(session.atlas.map((a) => a.key));
    const rows = list.map((p) => {
      const here = p.world === BOOT.world;
      let where;
      if (!here) where = `on ${escapeHtml(BODIES[p.world]?.name ?? p.world)}`;
      else if (p.now) {
        const d = haversine(me, p.now);
        const deg = ((bearing(me, p.now) * 180) / Math.PI + 360) % 360;
        where = `${formatDistance(d, units)} <i class="players-arrow" style="transform:rotate(${deg.toFixed(0)}deg)"></i>`;
      } else where = 'landing…';
      const hearts = p.dead ? 'dead' : `<i class="heart-icon"></i>${Math.ceil((p.health ?? MAX_HEALTH) / 2)}`;
      const overlay = session.overlays.get(p.name.toLowerCase());
      return `
        <li style="--player:${escapeHtml(p.colour)}">
          <i class="players-dot"></i>
          <span class="players-name">${escapeHtml(p.name)}${p.admin ? ' <em>admin</em>' : ''}${p.talking && !p.dead ? ' <em class="players-talking">talking</em>' : ''}</span>
          <span class="players-where">${where}</span>
          <span class="players-hearts">${hearts}</span>
          <span class="players-buttons">
            <button type="button" class="mini" data-action="tpa" data-id="${p.id}" title="Ask to teleport to ${escapeHtml(p.name)}">TPA</button>
            <button type="button" class="mini" data-action="tpahere" data-id="${p.id}" title="Ask ${escapeHtml(p.name)} to teleport to you">Bring</button>
            <button type="button" class="mini" data-action="msg" data-id="${p.id}" title="Whisper">Msg</button>
            ${session.isFriend(p.name) || session.friends.outgoing.some((f) => f.key === p.name.toLowerCase()) ? '' : `<button type="button" class="mini" data-action="friend-add" data-name="${escapeHtml(p.name)}" title="Ask ${escapeHtml(p.name)} to be friends">Friend</button>`}
            ${session.inParty(p.name) || (session.party && !session.partyLeader) ? '' : `<button type="button" class="mini" data-action="party-invite" data-name="${escapeHtml(p.name)}" title="Invite ${escapeHtml(p.name)} to your party">Party</button>`}
            ${this.voice && here ? `<button type="button" class="mini${this.voice.isMuted(p.id) ? ' on' : ''}" data-action="mute" data-id="${p.id}" title="Stop hearing ${escapeHtml(p.name)} on voice">${this.voice.isMuted(p.id) ? 'Unmute' : 'Mute'}</button>` : ''}
          </span>
          ${here || mapped.has(p.name.toLowerCase()) ? `<label class="players-tick"><input type="checkbox" data-watch="trail" data-key="${escapeHtml(p.name.toLowerCase())}" ${overlay?.showTrail ? 'checked' : ''}/> trail</label>
          <label class="players-tick"><input type="checkbox" data-watch="explored" data-key="${escapeHtml(p.name.toLowerCase())}" ${overlay?.showExplored ? 'checked' : ''}/> discovered</label>` : ''}
        </li>`;
    }).join('');
    const online = new Set(list.map((p) => p.name.toLowerCase()));
    const offline = session.atlas.filter((a) => !online.has(a.key));
    const requests = [...session.requests.values()].map((r) => {
      const left = Math.max(0, Math.ceil((r.expiresIn ?? TPA_TIMEOUT_S) - (performance.now() - r.at) / 1000));
      return `<li class="players-request">
        <b style="--player:${escapeHtml(r.from.colour)}">${escapeHtml(r.from.name)}</b>
        ${r.kind === 'tpa' ? 'wants to come to you' : 'wants you to come to them'} · ${left}s
        <button type="button" class="mini primary" data-action="accept" data-id="${r.id}">Accept</button>
        <button type="button" class="mini" data-action="deny" data-id="${r.id}">Deny</button>
      </li>`;
    }).join('');
    const names = this.element.querySelector('#players-names');
    const nameList = list.map((p) => `<option value="${escapeHtml(p.name)}"></option>`).join('');
    if (names.innerHTML !== nameList) names.innerHTML = nameList;
    const html = `
      <div class="panel-head">
        <h2>Players</h2>
        <span class="players-count">${list.length + 1} online</span>
        <button type="button" class="panel-close" data-action="close">Close <kbd>${escapeHtml(keybinds.labelFor('players'))}</kbd></button>
      </div>
      <div class="players-body">
        ${requests ? `<ul class="players-list">${requests}</ul>` : ''}
        ${this.renderParty(me, units)}
        ${this.renderFriends()}
        <h3>Online</h3>
        <p class="players-you" style="--player:${escapeHtml(session.you?.colour ?? '#ccc')}">
          <i class="players-dot"></i> ${escapeHtml(session.you?.name ?? '')} (you) · ${escapeHtml(BODIES[BOOT.world].name)}</p>
        ${rows ? `<ul class="players-list">${rows}</ul>` : '<p class="players-empty">Nobody else is online yet. Send them an invite from the Online panel.</p>'}
        <h3>Discoveries on ${escapeHtml(BODIES[BOOT.world].name)}</h3>
        <label class="players-tick everyone"><input type="checkbox" data-watch="explored" data-key="*" ${session.watchingAll.explored ? 'checked' : ''}/>
          Show everyone's discoveries on the map</label>
        <label class="players-tick everyone"><input type="checkbox" data-watch="trail" data-key="*" ${session.watchingAll.trail ? 'checked' : ''}/>
          Show everyone's paths, in their colours</label>
        ${offline.length ? `<ul class="players-list offline">${offline.map((a) => {
          const overlay = session.overlays.get(a.key);
          return `<li style="--player:${escapeHtml(a.colour)}"><i class="players-dot"></i>
            <span class="players-name">${escapeHtml(a.name)}</span><span class="players-where">offline</span>
            <label class="players-tick"><input type="checkbox" data-watch="trail" data-key="${escapeHtml(a.key)}" ${overlay?.showTrail ? 'checked' : ''}/> trail</label>
            <label class="players-tick"><input type="checkbox" data-watch="explored" data-key="${escapeHtml(a.key)}" ${overlay?.showExplored ? 'checked' : ''}/> discovered</label></li>`;
        }).join('')}</ul>` : ''}
        <p class="players-help">Type <code>/tpa name</code>, <code>/tpahere name</code>, <code>/tpaccept</code>, <code>/tpdeny</code> in chat
          (<kbd>${escapeHtml(keybinds.labelFor('chat'))}</kbd>) — or use the buttons. Requests last ${TPA_TIMEOUT_S} seconds.
          Friends: <code>/friend add name</code>. Parties: <code>/party invite name</code>, <code>/pc message</code> to talk to the party.</p>
      </div>`;
    // Only when something changed, and keeping the scroll where it was.
    if (html === this.lastHtml) return;
    this.lastHtml = html;
    const body = this.dynamic.querySelector('.players-body');
    const scroll = body?.scrollTop ?? 0;
    this.dynamic.innerHTML = html;
    const next = this.dynamic.querySelector('.players-body');
    if (next) next.scrollTop = scroll;
  }

  /** Your party: who, where, the tick for teleporting together, its waypoints. */
  renderParty(me, units) {
    const session = this.session;
    const invites = [...session.partyInvites.values()].map((invite) => `
      <li class="players-request">
        <b style="--player:${escapeHtml(invite.from.colour)}">${escapeHtml(invite.from.name)}</b> invites you to their party
        <button type="button" class="mini primary" data-action="party-accept" data-id="${invite.id}">Join</button>
        <button type="button" class="mini" data-action="party-deny" data-id="${invite.id}">No thanks</button>
      </li>`).join('');
    const party = session.party;
    if (!party) {
      return `<h3>Party</h3>
        ${invites ? `<ul class="players-list">${invites}</ul>` : ''}
        <p class="players-empty">Not in a party. Press <b>Party</b> next to someone — or type a name below — to start one:
          voice that reaches your party anywhere, waypoints of your own, and teleporting together.</p>`;
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
        ? leading ? '' : `<label class="players-tick"><input type="checkbox" data-together ${m.together ? 'checked' : ''}/> teleport with the party</label>`
@@MISSING 303@@
@@MISSING 304@@
@@MISSING 305@@
@@MISSING 306@@
@@MISSING 307@@
@@MISSING 308@@
        <span class="players-name">${escapeHtml(m.name)}${m.leader ? ' <em>leader</em>' : ''}${m.together && m.key !== mine ? ' <em>comes along</em>' : ''}</span>
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
      ${settings.get('voiceMode') === 'off' || !settings.get('partyVoice')
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
        <button type="button" class="mini primary" data-action="friend-accept" data-name="${escapeHtml(w.name)}">Accept</button>
        <button type="button" class="mini" data-action="friend-deny" data-name="${escapeHtml(w.name)}">Deny</button>
      </li>`).join('');
    const rows = friends.slice().sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)).map((w) => `
      <li style="--player:${escapeHtml(w.colour)}" class="${w.online ? '' : 'offline'}">
        <i class="players-dot"></i>
        <span class="players-name">${escapeHtml(w.name)}</span>
        <span class="players-where">${w.online ? `on ${escapeHtml(BODIES[w.world]?.name ?? w.world)}` : 'offline'}</span>
        <span class="players-buttons">
          ${w.online ? `<button type="button" class="mini" data-action="friend-tpa" data-name="${escapeHtml(w.name)}">TPA</button>` : ''}
          ${w.online && !this.session.inParty(w.name) ? `<button type="button" class="mini" data-action="party-invite" data-name="${escapeHtml(w.name)}">Party</button>` : ''}
          <button type="button" class="mini" data-action="friend-remove" data-name="${escapeHtml(w.name)}">Remove</button>
        </span>
      </li>`).join('');
    const pending = outgoing.map((w) => `
      <li class="offline"><span class="players-name">${escapeHtml(w.name)}</span><span class="players-where">asked</span>
        <span class="players-buttons"><button type="button" class="mini" data-action="friend-remove" data-name="${escapeHtml(w.name)}">Take back</button></span></li>`).join('');
    const online = friends.filter((f) => f.online).length;
    return `<h3>Friends <span class="players-count">${online} of ${friends.length} online</span></h3>
      ${asking ? `<ul class="players-list">${asking}</ul>` : ''}
      ${rows || pending ? `<ul class="players-list friends">${rows}${pending}</ul>` : '<p class="players-empty">No friends yet: press <b>Friend</b> next to someone, or type a name below.</p>'}`;
  }
}

/**
 * The prompt for a teleport request: who, which way, a countdown, and the two
 * answers, with their keys — because with the pointer captured you cannot
 * click anything without letting go of the flight first.
 */
export class RequestPrompts {
  constructor(root, session) {
    this.session = session;
    this.element = document.createElement('div');
    this.element.className = 'tp-prompts';
    root.appendChild(this.element);
    this.element.addEventListener('click', (event) => {
      const button = event.target.closest('[data-answer]');
      if (!button) return;
      button.blur();
      this.answer({ kind: button.dataset.kind, id: Number(button.dataset.id) }, button.dataset.answer === 'yes');
    });
    for (const event of ['request', 'requestEnd', 'partyInvite', 'partyInviteEnd']) session.on(event, () => this.render());
    setInterval(() => this.render(), 250);
  }

  /** Teleport requests and party invitations, newest first. */
  pending() {
    const requests = [...this.session.requests.values()].map((r) => ({ kind: 'tp', ...r }));
    const invites = [...this.session.partyInvites.values()].map((r) => ({ kind: 'party', ...r }));
    return [...requests, ...invites].sort((a, b) => b.at - a.at);
  }

  answer(item, accept) {
    if (item.kind === 'party') this.session.answerParty(item.id, accept);
    else this.session.answer(item.id, accept);
  }

  /** Answer the newest request or invitation from the keyboard. */
  answerNewest(accept) {
    const newest = this.pending()[0];
    if (!newest) return false;
    this.answer(newest, accept);
    return true;
  }

  /**
   * Built when the set of requests changes, and only the countdown touched in
   * between: rebuilding four times a second replaced the buttons under the
   * pointer, so a click could land on one that no longer existed.
   */
  render() {
    const items = this.pending().slice(0, 3);
    const key = items.map((r) => `${r.kind}:${r.id}`).join(',');
    if (key !== this.built) {
      this.built = key;
      const yes = escapeHtml(keybinds.labelFor('acceptRequest'));
      const no = escapeHtml(keybinds.labelFor('denyRequest'));
      this.element.innerHTML = items.map((r, i) => {
        const text = r.kind === 'party'
          ? 'invites you to their party'
          : r.kind === 'tpa' ? 'wants to teleport to you' : 'wants you to teleport to them';
        const elsewhere = r.from.world && r.from.world !== BOOT.world
          ? `<em>from ${escapeHtml(BODIES[r.from.world]?.name ?? r.from.world)}</em>` : '';
        return `
        <div class="tp-prompt${r.kind === 'party' ? ' party' : ''}" data-prompt="${r.kind}:${r.id}" style="--player:${escapeHtml(r.from.colour)}">
          <div class="tp-text"><b>${escapeHtml(r.from.name)}</b> ${text} ${elsewhere}</div>
          <div class="tp-bar"><i></i></div>
          <div class="tp-buttons">
            <button type="button" class="primary" data-answer="yes" data-kind="${r.kind}" data-id="${r.id}">${r.kind === 'party' ? 'Join' : 'Accept'}${i === 0 ? ` <kbd>${yes}</kbd>` : ''}</button>
            <button type="button" data-answer="no" data-kind="${r.kind}" data-id="${r.id}">${r.kind === 'party' ? 'No thanks' : 'Deny'}${i === 0 ? ` <kbd>${no}</kbd>` : ''}</button>
            <span class="tp-left"></span>
          </div>
        </div>`;
      }).join('');
    }
    for (const r of items) {
      const node = this.element.querySelector(`[data-prompt="${r.kind}:${r.id}"]`);
      if (!node) continue;
      const total = (r.expiresIn ?? TPA_TIMEOUT_S) * 1000;
      const left = Math.max(0, total - (performance.now() - r.at));
      node.querySelector('.tp-bar i').style.width = `${((left / total) * 100).toFixed(1)}%`;
      const seconds = `${Math.ceil(left / 1000)}s`;
      const label = node.querySelector('.tp-left');
      if (label.textContent !== seconds) label.textContent = seconds;
    }
  }
}

/**
 * A name for a party waypoint, asked for - every one marked from the panel or
 * the map was "<you>'s mark". Empty, or cancelled, it is still that.
 */
export function askMarkName() {
  try {
    const name = globalThis.prompt?.('Name this party waypoint (or leave it blank):', '');
    return typeof name === 'string' ? name.trim().slice(0, 40) : '';
  } catch {
    return '';
  }
}

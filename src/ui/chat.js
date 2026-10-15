import { keybinds } from '../core/keybinds.js';
import { settings } from '../core/settings.js';
import { formatDistance } from '../core/units.js';
import { COMMANDS, NEAR_CHAT_M, findCommand } from '../net/protocol.js';
import { BODIES } from '../geo/bodies.js';
import { escapeHtml } from './worldmap.js';

/**
 * Chat, the way Minecraft does it.
 *
 * Bottom left. Lines fade a few seconds after they arrive, so a quiet server
 * leaves the view clear; opening the box brings the whole recent history back.
 * T opens it, / opens it with the slash already typed, Enter sends, Escape
 * closes, the arrows walk back through what you have sent, and Tab finishes a
 * command or a player's name.
 *
 * Everything that starts with a slash goes to the server as a command — the
 * same commands the players panel's buttons send, so typing /tpa Alex and
 * pressing the button next to Alex are one thing.
 */

const FADE_MS = 10000;
const KEEP = 120;

export class ChatBox {
  /**
   * @param {HTMLElement} root
   * @param {import('../net/session.js').OnlineSession} session
   */
  constructor(root, session) {
    this.session = session;
    this.open = false;
    this.history = [];
    this.historyIndex = -1;
    this.element = document.createElement('div');
    this.element.className = 'chat';
    this.element.innerHTML = `
      <div class="chat-log" aria-live="polite"></div>
      <form class="chat-form" hidden>
        <input type="text" maxlength="256" autocomplete="off" spellcheck="false" placeholder="Say something, or /help" />
        <span class="chat-hint"></span>
      </form>`;
    root.appendChild(this.element);
    this.log = this.element.querySelector('.chat-log');
    this.form = this.element.querySelector('.chat-form');
    this.input = this.element.querySelector('input');
    this.hint = this.element.querySelector('.chat-hint');

    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.send();
    });
    this.input.addEventListener('keydown', (event) => this.onKey(event));
    this.input.addEventListener('input', () => this.updateHint());
    this.input.addEventListener('blur', () => {
      // Clicking away closes it, unless what was clicked is inside the chat.
      setTimeout(() => {
        if (this.open && !this.element.contains(document.activeElement)) this.close();
      }, 0);
    });

    // On a touch screen there is no T to press: a tap on the lines opens the
    // box, and the whole recent history with it.
    this.log.addEventListener('pointerup', (event) => {
      if (event.pointerType === 'touch' && !this.open) this.show();
    });
    session.on('chat', (m) => this.receive(m));
    // /password is answered on its own rather than with a chat line.
    session.on('password', (m) => this.receive({ kind: m.ok ? 'system' : 'error', text: m.ok ? 'Password changed' : m.error }));
    setInterval(() => this.fade(), 1000);
  }

  show(prefill = '') {
    this.open = true;
    this.form.hidden = false;
    this.element.classList.add('open');
    this.input.value = prefill;
    this.historyIndex = -1;
    this.updateHint();
    // After the key that opened it has finished, or the T lands in the box.
    setTimeout(() => {
      this.input.focus();
      this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    }, 0);
  }

  close() {
    this.open = false;
    this.form.hidden = true;
    this.element.classList.remove('open');
    this.input.blur();
    this.fade();
  }

  send() {
    const text = this.input.value.trim();
    if (text) {
      // Never a password: the arrows would hand it to whoever sits down at
      // the keyboard next.
      if (!/^\/password(\s|$)/i.test(text)) {
        this.history.unshift(text);
        if (this.history.length > 50) this.history.pop();
      }
      this.session.chat(text);
    }
    this.close();
  }

  onKey(event) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.historyIndex < this.history.length - 1) this.historyIndex += 1;
      this.input.value = this.history[this.historyIndex] ?? this.input.value;
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (this.historyIndex > 0) this.historyIndex -= 1;
      else this.historyIndex = -1;
      this.input.value = this.historyIndex >= 0 ? this.history[this.historyIndex] : '';
    } else if (event.key === 'Tab') {
      event.preventDefault();
      this.complete();
    }
  }

  /**
   * Finish the word under the cursor: a command after a slash, otherwise a
   * name. Another Tab with nothing typed in between puts the next match in
   * place of the last, round and round — it used to take the space after the
   * finished word for a new, empty word and add a second name after it.
   */
  complete() {
    const value = this.input.value;
    const again = this.completing?.value === value;
    const words = again ? [...this.completing.words] : value.split(' ');
    const last = words[words.length - 1];
    let options;
    if (again) {
      options = this.completing.options;
    } else if (words.length === 1 && last.startsWith('/')) {
      const typed = last.slice(1).toLowerCase();
      options = COMMANDS.filter((c) => !c.admin || this.session.you?.admin)
        .map((c) => `/${c.name}`).filter((c) => c.slice(1).startsWith(typed));
    } else {
      const command = words[0].startsWith('/') ? findCommand(words[0].slice(1)) : null;
      if (command?.name === 'travel') {
        options = Object.keys(BODIES).filter((w) => w.startsWith(last.toLowerCase()));
      } else {
        options = this.session.players().map((p) => p.name)
          .filter((n) => n.toLowerCase().startsWith(last.toLowerCase()));
      }
    }
    if (!options.length) return;
    const index = again ? (this.completing.index + 1) % options.length : 0;
    const line = [...words];
    line[line.length - 1] = options[index];
    this.input.value = `${line.join(' ')} `;
    this.updateHint();
    // After the hint, which forgets it for a line that is not a command.
    this.completing = { words, options, index, value: this.input.value };
  }

  updateHint() {
    const value = this.input.value;
    // Nor is it shown while it is typed.
    this.input.type = /^\/password\s/i.test(value) ? 'password' : 'text';
    if (!value.startsWith('/')) {
      this.completing = null;
      this.hint.textContent = '';
      return;
    }
    const word = value.slice(1).split(' ')[0];
    const command = findCommand(word);
    const reach = command?.name === 'near' ? ` (within ${formatDistance(NEAR_CHAT_M, settings.get('units'), 0)})` : '';
    this.hint.textContent = command ? `/${command.name} ${command.args} — ${command.help}${reach}` : '';
  }

  receive(m) {
    const line = document.createElement('div');
    line.className = `chat-line chat-${m.kind ?? 'chat'}`;
    line.dataset.at = String(performance.now());
    const name = (who) => `<b style="--player:${escapeHtml(who.colour ?? '#ccc')}">${escapeHtml(who.name)}</b>`;
    const text = escapeHtml(m.text ?? '').replace(/\n/g, '<br>');
    switch (m.kind) {
      case 'chat':
        line.innerHTML = `${name(m.from)} ${worldTag(m.from)}${text}`;
        break;
      case 'near':
        line.innerHTML = `<em>nearby</em> ${name(m.from)} ${text}`;
        break;
      case 'whisper':
        line.innerHTML = `<em>${escapeHtml(m.from.name)} whispers</em> ${text}`;
        break;
      case 'whisperSent':
        line.innerHTML = `<em>to ${escapeHtml(m.to.name)}</em> ${text}`;
        break;
      case 'me':
        line.innerHTML = `* ${name(m.from)} ${text}`;
        break;
      case 'party':
        // Party chat has a speaker; the party's own notices do not.
        line.innerHTML = m.from ? `<em>party</em> ${name(m.from)} ${text}` : `<em>party</em> ${text}`;
        break;
      case 'friend':
        line.innerHTML = `<em>friends</em> ${text}`;
        break;
      default:
        line.innerHTML = text;
    }
    this.log.appendChild(line);
    while (this.log.children.length > KEEP) this.log.removeChild(this.log.firstChild);
    this.log.scrollTop = this.log.scrollHeight;
    this.fade();
  }

  /** Lines older than a few seconds go quiet unless the box is open. */
  fade() {
    const now = performance.now();
    for (const line of this.log.children) {
      const old = now - Number(line.dataset.at) > FADE_MS;
      line.classList.toggle('faded', old && !this.open);
    }
  }

  /** The keys that open it, for the hint on the HUD. */
  static keys() {
    return `${keybinds.labelFor('chat')} chat · ${keybinds.labelFor('command')} command`;
  }
}

function worldTag(from) {
  if (!from?.world || from.world === 'earth') return '';
  return `<em class="chat-world">${escapeHtml(BODIES[from.world]?.name ?? from.world)}</em> `;
}

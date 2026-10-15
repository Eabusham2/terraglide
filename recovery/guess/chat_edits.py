# chat.js: the Oct 6 version (V1, 215 lines, exact) plus the Oct 7-9 ledger fixes F2 (Tab cycles), F9 (/password kept
# out of the history; its answer shown), P4 (the range of /near in the hint), P8 (a tap on the log opens it on touch).
# Usage: chat_edits.py V1 OUT
import sys
s = open(sys.argv[1]).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:70]
    s = s.replace(old, new)
rep("""import { keybinds } from '../core/keybinds.js';
import { COMMANDS, findCommand } from '../net/protocol.js';""", """import { keybinds } from '../core/keybinds.js';
import { settings } from '../core/settings.js';
import { formatDistance } from '../core/units.js';
import { COMMANDS, NEAR_CHAT_M, findCommand } from '../net/protocol.js';""")
rep("""    session.on('chat', (m) => this.receive(m));
    setInterval(() => this.fade(), 1000);""", """    // On a touch screen there is no T to press: a tap on the lines opens the
    // box, and the whole recent history with it.
    this.log.addEventListener('pointerup', (event) => {
      if (event.pointerType === 'touch' && !this.open) this.show();
    });
    session.on('chat', (m) => this.receive(m));
    // /password is answered on its own rather than with a chat line.
    session.on('password', (m) => this.receive({ kind: m.ok ? 'system' : 'error', text: m.ok ? 'Password changed' : m.error }));
    setInterval(() => this.fade(), 1000);""")
rep("""    if (text) {
      this.history.unshift(text);
      if (this.history.length > 50) this.history.pop();
      this.session.chat(text);""", """    if (text) {
      // Never a password: the arrows would hand it to whoever sits down at
      // the keyboard next.
      if (!/^\\/password(\\s|$)/i.test(text)) {
        this.history.unshift(text);
        if (this.history.length > 50) this.history.pop();
      }
      this.session.chat(text);""")
rep("""  /** Finish the word under the cursor: a command after a slash, otherwise a name. */
  complete() {
    const value = this.input.value;
    const words = value.split(' ');
    const last = words[words.length - 1];
    let options;
    if (words.length === 1 && last.startsWith('/')) {""", """  /**
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
    } else if (words.length === 1 && last.startsWith('/')) {""")
rep("""    if (!options.length) return;
    // Cycle through matches on repeated Tabs.
    if (this.completing && this.completing.stem === words.slice(0, -1).join(' ')) {
      this.completing.index = (this.completing.index + 1) % this.completing.options.length;
    } else {
      this.completing = { stem: words.slice(0, -1).join(' '), options, index: 0 };
    }
    words[words.length - 1] = this.completing.options[this.completing.index];
    this.input.value = `${words.join(' ')} `;
    this.updateHint();
  }""", """    if (!options.length) return;
    const index = again ? (this.completing.index + 1) % options.length : 0;
    const line = [...words];
    line[line.length - 1] = options[index];
    this.input.value = `${line.join(' ')} `;
    this.updateHint();
    // After the hint, which forgets it for a line that is not a command.
    this.completing = { words, options, index, value: this.input.value };
  }""")
rep("""  updateHint() {
    const value = this.input.value;
    if (!value.startsWith('/')) {""", """  updateHint() {
    const value = this.input.value;
    // Nor is it shown while it is typed.
    this.input.type = /^\\/password\\s/i.test(value) ? 'password' : 'text';
    if (!value.startsWith('/')) {""")
rep("""    const command = findCommand(word);
    this.hint.textContent = command ? `/${command.name} ${command.args} — ${command.help}` : '';""", """    const command = findCommand(word);
    const reach = command?.name === 'near' ? ` (within ${formatDistance(NEAR_CHAT_M, settings.get('units'), 0)})` : '';
    this.hint.textContent = command ? `/${command.name} ${command.args} — ${command.help}${reach}` : '';""")
open(sys.argv[2], 'w').write(s)
print(sys.argv[2], s.count('\n'), 'lines')

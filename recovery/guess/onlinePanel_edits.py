# onlinePanel.js: the Oct 6 version (357 lines, exact) plus F9's Change password form (ledger: "dedicated 'password'
# message + form"), placed so the final's known lines (90-209, 236, 238, 241, 260-295) land where they were seen.
import sys
s = open(sys.argv[1]).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:70]
    s = s.replace(old, new)
rep("import { NAME_PATTERN, PASSWORD_MIN, nameProblem, passwordProblem } from '../net/protocol.js';",
    "import { NAME_PATTERN, PASSWORD_MAX, PASSWORD_MIN, nameProblem, passwordProblem } from '../net/protocol.js';")
rep("""      session.on('needsAuth', () => {
        this.show();
        this.render();
      });
""", """      session.on('needsAuth', () => {
        this.show();
        this.render();
      });
      // The answer to Change password, said in the panel where it was asked.
      session.on('password', (m) => {
        this.passwordNote = m.ok ? { ok: true, text: 'Password changed' } : { ok: false, text: m.error };
        this.render();
      });
""")
rep("""        network need this machine's own address, and friends elsewhere a tunnel or a host — HOSTING.md shows both.</p>` : ''}
      <div class="online-actions">""", """        network need this machine's own address, and friends elsewhere a tunnel or a host — HOSTING.md shows both.</p>` : ''}
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
      <div class="online-actions">""")
rep("""    const data = new FormData(form);
    if (kind === 'join') {""", """    const data = new FormData(form);
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
    if (kind === 'join') {""")
open(sys.argv[2], 'w').write(s)

# teleportMenu.js: the Oct 7 version (352 lines, exact) plus ledger F7 (the notice is the server's answer), placed by
# the final's known lines (75, 94, 117-120, 255-266, 358-377). 377 lines.
import sys
s = open(sys.argv[1]).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:70]
    s = s.replace(old, new)
rep("""    this.where = where;
    this.open = false;
    this.mode = 'tpa';""", """    this.where = where;
    this.open = false;
    // A request sent from here and not answered yet: the notice waits for the
    // server, which may say no (see below).
    this.waiting = null;
    this.mode = 'tpa';""")
rep("""    /** Called with a short line for a toast once a request has gone. */
    this.onSent = null;
""", """    /** Called with a short line for a toast once a request has gone. */
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
""")
rep("""    if (!p) return;
    this.session.chat(mode.command(p.name, this.session.you?.name ?? ''));
    this.close();
    this.onSent?.(
      mode.admin
        ? `${mode.label} — ${p.name}`
        : `${mode.id === 'tpa' ? 'Asked to go to' : 'Asked to bring'} ${p.name} — they have ${TPA_TIMEOUT_S} s`,
    );
  }""", """    if (!p) return;
    this.waiting = mode.admin ? null : { name: p.name, mode: mode.id, at: performance.now() };
    this.session.chat(mode.command(p.name, this.session.you?.name ?? ''));
    this.close();
    if (mode.admin) this.onSent?.(`${mode.label} — ${p.name}`);
  }""")
rep("""        : `<li class="tp-empty">${total
          ? `Nobody online has "${escapeHtml(this.query.trim())}" in their name`
          : 'Nobody else is online yet'}</li>`;""", """        : `<li class="tp-empty">${total ? `Nobody online has "${escapeHtml(this.query.trim())}" in their name`
          : 'Nobody else is online yet'}</li>`;""")
open(sys.argv[2], 'w').write(s)

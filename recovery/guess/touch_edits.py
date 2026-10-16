# touch.js: the Oct 7 version (331 lines, 10913 bytes, exact) plus the Oct 9 ledger items F5 and P1, written to fit
# the Oct 9 15:06 grep (lines 68, 69, 120, 124) and the Oct 9 16:16 diff stat (48 lines changed from the commit).
import sys
s = open(sys.argv[1]).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:70]
    s = s.replace(old, new)
rep("""  { id: 'rtp', label: 'Teleport' },""", """  // "Random", not "Teleport": on a server the toolbar's Teleport opens the
  // teleport menu, and two buttons of one name did two different things.
  { id: 'rtp', label: 'Random' },""")
rep("""    if (button.hidden === !visible) return;
    button.hidden = !visible;
""", """    if (button.hidden === !visible) return;
    button.hidden = !visible;
    this.layout();
""")
rep("""      button.hidden = !visible;
    });
  }
""", """      button.hidden = !visible;
    });
    this.layout();
  }

  /**
   * How many rows of buttons there are, as --touch-rows on the page. Talk
   * comes and goes with voice and the cheat button with the cheats, and
   * either can start a row of its own: the hotbar, your hearts and the chat
   * sit above the band however tall it is, not under your thumb.
   */
  layout() {
    const shown = this.element.querySelectorAll('.touch-buttons button:not([hidden])').length;
    document.documentElement.style.setProperty('--touch-rows', String(Math.max(1, Math.ceil(shown / 2))));
  }
""")
rep("""      if (event.type === 'keydown') {
        if (event.metaKey || event.ctrlKey || event.altKey) return;""", """      if (event.type === 'keydown') {
        // Typing into a box - a name in the teleport menu, a line of chat - is
        // the on-screen keyboard at work, not a return to the real one: the
        // controls stay where they are.
        if (event.target?.closest?.('input, textarea, [contenteditable="true"]')) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;""")
rep("""    this.element.hidden = !enabled;
    document.body.classList.toggle('touch-active', enabled);""", """    this.element.hidden = !enabled;
    document.body.classList.toggle('touch-active', enabled);
    if (enabled) this.layout();""")
open(sys.argv[2], 'w').write(s)

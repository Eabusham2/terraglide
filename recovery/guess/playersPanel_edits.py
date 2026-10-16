# playersPanel.js: the Oct 6 version (433 lines, exact) plus 30 lines placed by the final's known lines: F6b (the panel
# keeps the keyboard), the leader's own row without the together tick (known 302), a party-voice note and its button (data-action="voice-on": the Oct 11 selftest tests that name)
# (known 172-173, 325), askMarkName (known, appended) used by "Mark here for the party".
import sys
s = open(sys.argv[1]).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:70]
    s = s.replace(old, new)
rep("""    this.element.className = 'panel players-panel';
    this.element.hidden = true;
""", """    this.element.className = 'panel players-panel';
    this.element.hidden = true;
    // Focusable, so the keyboard can stay here after one of its buttons.
    this.element.tabIndex = -1;
""")
rep("""      const button = event.target.closest('[data-action]');
      if (!button) return;
      button.blur();
      this.act(button.dataset.action, button.dataset.id, button);""", """      const button = event.target.closest('[data-action]');
      if (!button) return;
      button.blur();
      // The panel keeps the keyboard, not the page: blurred to the body, B and
      // R went to the game and Escape opened the settings behind the list.
      this.element.focus({ preventScroll: true });
      this.act(button.dataset.action, button.dataset.id, button);""")
rep("""        return this.session.partyMark('', here.lat, here.lon);
      }
""", """        return this.session.partyMark(askMarkName(), here.lat, here.lon);
      }
      case 'voice-on':
        // Push to talk, and the party's own channel: whichever of the two the
        // note under the party said was off.
        settings.set('voiceMode', 'push');
        if (!settings.get('partyVoice')) settings.set('partyVoice', true);
        return this.render();
""")
rep("""      const buttons = m.key === mine
        ? `<label class="players-tick"><input type="checkbox" data-together ${m.together ? 'checked' : ''}/> teleport with the party</label>`""", """      // The leader is the one who goes: nobody's teleport brings them along.
      const buttons = m.key === mine
        ? leading ? '' : `<label class="players-tick"><input type="checkbox" data-together ${m.together ? 'checked' : ''}/> teleport with the party</label>`""")
rep("""      <ul class="players-list party">${members}${invited}</ul>
""", """      <ul class="players-list party">${members}${invited}</ul>
      ${settings.get('voiceMode') === 'off' || !settings.get('partyVoice')
        ? `<p class="players-note">A party talks over the radio: you hear each other anywhere, on any world.
          ${settings.get('voiceMode') === 'off' ? 'Your voice is off.' : 'Party voice is off.'}
          <button type="button" class="mini" data-action="voice-on">Turn it on</button></p>`
        : ''}
""")
s = s.rstrip('\n') + '''

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
'''
open(sys.argv[2], 'w').write(s)

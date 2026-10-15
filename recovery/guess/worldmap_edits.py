# worldmap.js: the Oct 7 version (566 lines, exact) plus the Oct 9 red-team fixes: no directed teleport on a server
# (the double-click, the travel and Go buttons) and the fog forced on online (the Oct 9 15:21 donecheck puts it at
# 512). 567 lines and 30 changed from the commit, as the Oct 9 stat says.
import sys
s = open(sys.argv[1]).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:70]
    s = s.replace(old, new)
rep("""    canvas.addEventListener('dblclick', (event) => {
      if (!cheats.unlocked) return;""", """    canvas.addEventListener('dblclick', (event) => {
      // Never on a server, cheats or no cheats: the server decides where you are.
      if (ONLINE || !cheats.unlocked) return;""")
rep("""      case 'teleport':
        if (this.onTeleport) this.onTeleport(this.centre.lat, this.centre.lon);""", """      case 'teleport':
        if (this.onTeleport && !ONLINE) this.onTeleport(this.centre.lat, this.centre.lon);""")
rep("""    this.element.querySelectorAll('[data-directed]').forEach((node) => {
      node.hidden = !cheats.unlocked;
    });
    this.element.querySelectorAll('[data-action="travel"]').forEach((node) => {
      node.hidden = !cheats.unlocked;
    });""", """    this.element.querySelectorAll('[data-directed]').forEach((node) => {
      node.hidden = ONLINE || !cheats.unlocked;
    });
    this.element.querySelectorAll('[data-action="travel"]').forEach((node) => {
      node.hidden = ONLINE || !cheats.unlocked;
    });""")
rep("""          fog: settings.get('minimapFog'),""", """          fog: ONLINE || settings.get('minimapFog'),""")
open(sys.argv[2], 'w').write(s)

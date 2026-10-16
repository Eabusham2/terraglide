# minimap.js: the Oct 5 version (191 lines, exact) plus 7 lines: fog forced on online (the Oct 9 15:21 donecheck puts
# the fog line at 172) and P9's --minimap-top-right; 9 lines changed by Oct 9 16:16, as the stat says.
import sys
s = open(sys.argv[1]).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:70]
    s = s.replace(old, new)
rep("""import { WheelSteps } from './wheel.js';
""", """import { WheelSteps } from './wheel.js';
import { ONLINE } from '../core/boot.js';
""")
rep("""    this.element.style.display = settings.get('minimapVisible') ? '' : 'none';
    this.timer = REDRAW_INTERVAL;""", """    this.element.style.display = settings.get('minimapVisible') ? '' : 'none';
    // A narrow screen has no room for the compass beside a minimap in the top
    // right corner, so the compass moves down past it (main.css).
    const topRight = settings.get('minimapVisible') && settings.get('minimapCorner') === 'top-right';
    document.documentElement.style.setProperty('--minimap-top-right', topRight ? `${size}px` : '0px');
    this.timer = REDRAW_INTERVAL;""")
rep("""          fog: settings.get('minimapFog'),""", """          // On a server the ground you have not explored stays hidden: the
          // setting is a preference for your own world, not a way to see theirs.
          fog: ONLINE || settings.get('minimapFog'),""")
open(sys.argv[2], 'w').write(s)

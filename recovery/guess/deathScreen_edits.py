# deathScreen.js: the paste (69 lines, before Oct 7) plus ledger P2 ("DeathScreen.update fills message+score from
# 'died'"; session.js calls deathScreen.update(how) with {cause, by, message, stats}) and the server's 'kill' and
# 'fled' causes (game.mjs deathMessage). 87 lines, the Oct 11 count. All of it is mine; no log shows the file.
import sys
s = open(sys.argv[1]).read().replace('\r', '')
if not s.endswith('\n'): s += '\n'
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:70]
    s = s.replace(old, new)
rep(""" * world's spawn — or at your lander, off Earth, where the air is.
 */""", """ * world's spawn — or at your lander, off Earth, where the air is. Online the
 * server has the last word on what happened, and says how you are doing.
 */""")
rep("""  show({ message, cause, by } = {}) {
    this.open = true;
    this.element.hidden = false;
    this.cause.textContent = message || describe(cause, by);
    this.score.textContent = '';""", """  show({ message, cause, by, stats } = {}) {
    this.open = true;
    this.element.hidden = false;
    this.cause.textContent = message || describe(cause, by);
    this.score.textContent = scoreLine(stats);""")
rep("""  get ready() {""", """  /**
   * The server's word on a death this screen already shows: the hit that did
   * it opened the screen a moment before the server said who and how, and what
   * your kills and deaths now stand at.
   */
  update({ message, cause, by, stats } = {}) {
    if (!this.open) return;
    this.cause.textContent = message || describe(cause, by);
    this.score.textContent = scoreLine(stats);
  }

  get ready() {""")
rep("""    case 'suffocated': return 'Your oxygen ran out';""", """    case 'suffocated': return 'Your oxygen ran out';
    case 'kill': return by ? `You gave up fighting ${by}` : 'You gave up';
    case 'fled': return by ? `You fled from ${by}, and that counts` : 'You fled a fight, and that counts';""")
s = s.rstrip('\n') + """

function scoreLine(stats) {
  return stats ? `${stats.kills} ${stats.kills === 1 ? 'kill' : 'kills'} · ${stats.deaths} ${stats.deaths === 1 ? 'death' : 'deaths'}` : '';
}
"""
open(sys.argv[2], 'w').write(s)

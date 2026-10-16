# server/social.mjs 866 -> 876: the Oct 9 party fixes in the three stretches filled from the Oct 9 02:14 text.
# The Oct 10-11 greps of the final (876 lines) place them: +8 before the autoParty line (final 492), +2 by the
# deny call (final 535) with PA4's `together.add` gone (no line between 443 and 594 has "together"), +1 by the
# teleporting-together banner (final 672). WRITTEN BY ME: the PA1 cooldown, the PA4 comment, F1's
# nobodyCalled and the invite's world (same count), PA7's save.
import sys
p = sys.argv[1]
s = open(p).read()
def sub(old, new):
    global s
    assert s.count(old) == 1, old
    s = s.replace(old, new)
sub("""    if (!to) return this.game.tell(player, `Nobody called ${String(name ?? '').slice(0, 32)} is online`, 'error');
    if (to === player) return this.game.tell(player, 'You are always in your own party', 'error');""",
"""    if (!to) return this.game.tell(player, this.game.nobodyCalled(name), 'error');
    if (to === player) return this.game.tell(player, 'You are always in your own party', 'error');""")
sub("""    if (!party) party = this.create(player);
    party.invites.set(to.key, { by: player.key, expires: this.game.now() + PARTY_INVITE_S * 1000 });""",
"""    if (!party) party = this.create(player);
    // Once a minute per person: an invitation sent as fast as the button could
    // be pressed was a box on somebody's screen they could not get rid of.
    const now = this.game.now();
    const last = party.invitedAt?.get(to.key) ?? -Infinity;
    if (now - last < PARTY_INVITE_S * 1000) {
      return this.game.tell(player, `${to.name} was asked a moment ago — wait for their answer`, 'error');
    }
    (party.invitedAt ??= new Map()).set(to.key, now);
    party.invites.set(to.key, { by: player.key, expires: now + PARTY_INVITE_S * 1000 });""")
sub("""      from: { id: player.id, key: player.key, name: player.name, colour: player.colour },
      expiresIn: PARTY_INVITE_S,""",
"""      from: { id: player.id, key: player.key, name: player.name, colour: player.colour, world: player.world },
      expiresIn: PARTY_INVITE_S,""")
sub("""    party.members.push(player.key);
    party.together.add(player.key);
""", """    party.members.push(player.key);
    // Not ticked to come along when the leader teleports: joining a party is
    // not agreeing to be pulled across the world. The tick is theirs to set.
""")
sub("""      : 'You will stay put when the party leader teleports', 'party');
    this.sendParty(party);
  }""", """      : 'You will stay put when the party leader teleports', 'party');
    this.sendParty(party);
    this.game.saveServer();
  }""")
open(p, 'w').write(s)

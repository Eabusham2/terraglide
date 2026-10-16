p='server/game.mjs'
s=open(p).read()
old="""    if (fell > 0) player.reserve += 2 * flightGravity(body) * fell;
    return player.reserve + player.surgeKept;"""
new="""    if (fell > 0) player.reserve += 2 * flightGravity(body) * fell;
    // Through air a fall gathers speed only up to what the air lets a faller
    // reach - the glide maxSpeed allows for already. Thick air takes the rest
    // away within seconds anyway (fadeReserve); Mars's is so thin that its
    // fade takes minutes, and a fall from Olympus Mons into Hellas was good
    // for 1,100 m/s for minutes where the game's own air holds a faller under
    // 400.
    const glide = body.id !== 'earth' && aeroFactor(body) > 0 ? terminalSpeed(body) * GLIDE_ROOM : Infinity;
    if (Number.isFinite(glide)) player.reserve = Math.min(player.reserve, glide * glide);
    return player.reserve + player.surgeKept;"""
assert s.count(old)==1; s=s.replace(old,new,1)
# reuse the 1.3 in maxSpeed through a named constant
old_max="""    return Number.isFinite(glide) ? Math.max(base, glide * 1.3) : base;"""
assert s.count(old_max)==1, s.count(old_max)
s=s.replace(old_max,"""    return Number.isFinite(glide) ? Math.max(base, glide * GLIDE_ROOM) : base;""",1)
old_c="""const RESERVE_FADE_S = 5;"""
s=s.replace(old_c, old_c+"""
/** Room over a thin-air world's terminal glide, for the limit and for what a fall there can give. */
const GLIDE_ROOM = 1.3;""",1)
open(p,'w').write(s); print('ok')

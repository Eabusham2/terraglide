# Build tools/servertest.mjs (the final, 1749 lines) from the pooled final (V16) with what the copies and
# older views supply (out/t/st.v16c.js: the Oct 11 21:19-21:23 views of final7/copy, which was V12 exactly,
# and older views placed by content), and the sections nobody showed after Oct 9, rebuilt here.
#
# For each section the older text is the base, and the checks the Oct 11 05:44 run printed - every label, in
# order - say what was added since. Sections:
#   1-14      the header: the early paste (upload/33.txt), which fits exactly.
#   223-319   teleport requests: the Oct 6 text + F1 (ambiguous name), F3 (/tphere), F4 (dead target, a
#             death ends a request) - WRITTEN BY ME.
#   338-387   moves: the Oct 9 text, the surge checks rewritten for SURGE_ALLOWANCE and the grace - mine.
#   389-438   a sword fight: the Oct 5-9 text exactly, with `alex.strike(blake.id)` where the final's known
#             lines (404, 409, 418, 434) have it.
#   440-489   discoveries: the Oct 11 04:56 view (440-470) + the toggle check and Dora's big map - mine.
#   740-745   join code: the rightful sign-up and stopping the gated server - mine.
#   747-777   bans - mine.  779-854 friends: the Oct 7 text + F4 auto-accept in a fight - mine.
#   856-921   parties: the Oct 7 text + PA4 (nobody joins ticked) - mine.  923-954 passwords - mine.
#
# usage: python3 -I servertest_build.py DRAFT PASTE OUT
import sys
draft, paste, out = sys.argv[1:4]
L = open(draft).read().split('\n')
if L[-1] == '':
    L.pop()
assert len(L) == 1749, len(L)
P = open(paste).read().replace('\r\n', '\n').split('\n')


def block(text):
    if text.startswith('\n'):
        text = text[1:]
    if text.endswith('\n'):
        text = text[:-1]
    return text.split('\n')


def put(a, b, lines):
    if isinstance(lines, str):
        lines = block(lines)
    assert len(lines) == b - a + 1, (a, b, len(lines))
    for k, s in enumerate(lines):
        cur = L[a - 1 + k]
        if cur.startswith('@@MISSING'):
            L[a - 1 + k] = s
        else:
            assert cur == s, (a + k, cur, s)


put(1, 14, P[0:14])

put(223, 319, r'''
  {
    alex.send({ t: 'chat', text: '/tpa blake' });
    const req = await blake.next('tpreq');
    ok('Blake is asked', req.kind === 'tpa' && req.from.name === 'Alex' && req.expiresIn === TPA_TIMEOUT_S);
    blake.send({ t: 'chat', text: '/tpaccept' });
    const tp = await alex.next('teleport');
    ok('accepting sends Alex to Blake', Math.abs(tp.lat - (alex.auth.pos.lat + metresNorth(2))) < 0.001 && tp.reason === 'tpa');
    ok('at Blake\'s height', Math.abs(tp.alt - 900) < 0.01);
    alex.lastTid = tp.tid;
    // A state before arriving is ignored; after arriving it is accepted.
    alex.send({ t: 'arrived', tid: tp.tid });
    alex.state({ lat: tp.lat, lon: tp.lon, alt: tp.alt });

    blake.send({ t: 'chat', text: '/tpahere Alex' });
    const here = await alex.next('tpreq');
    ok('/tpahere asks the other way', here.kind === 'tpahere');
    alex.send({ t: 'chat', text: '/tpdeny Blake' });
    const end = await blake.next('tpreq-end', (m) => m.reason === 'denied');
    ok('and /tpdeny ends it for both', end.reason === 'denied');

    // The forty-second timeout. The clock is not moved for this — a clock
    // moved forward forty seconds also makes every socket look silent — the
    // request's own deadline is read and then stood on either side of.
    blake.send({ t: 'chat', text: '/tpa Alex' });
    const cooling = await blake.next('chat', (m) => m.kind === 'error');
    ok('asking the same person again at once has to wait', /before asking Alex again/.test(cooling.text));
    server.game.players.get(blake.id).lastRequestAt.clear();
    blake.send({ t: 'chat', text: '/tpa Alex' });
    await alex.next('tpreq');
    const request = [...server.game.requests.values()].find((r) => r.from.key === 'blake');
    const lifetime = (request.expires - Date.now()) / 1000;
    ok(`the request is given forty seconds  (${lifetime.toFixed(1)} s)`, Math.abs(lifetime - TPA_TIMEOUT_S) < 1);
    request.expires = Date.now() + 1000;
    server.game.tick();
    ok('it is still open just before its deadline', !blake.has('tpreq-end', (m) => m.reason === 'expired'));
    request.expires = Date.now() - 1;
    server.game.tick();
    const expired = await blake.next('tpreq-end', (m) => m.reason === 'expired');
    ok('and runs out after it, for both of them', expired.reason === 'expired'
      && (await alex.next('tpreq-end', (m) => m.reason === 'expired').then(() => true, () => alex.has('tpreq-end'))));

    // Asking again replaces the old request — and says so, or a prompt for
    // the old one could still be answered and do the opposite.
    const blakeP = server.game.players.get(blake.id);
    // Past the chat limit by now, which commands count against too.
    server.game.chatTimes.delete('blake');
    blakeP.lastRequestAt.clear();
    blake.send({ t: 'chat', text: '/tpa Alex' });
    const first = await alex.next('tpreq');
    blakeP.lastRequestAt.clear();
    blake.send({ t: 'chat', text: '/tpahere Alex' });
    const replaced = await alex.next('tpreq-end', (m) => m.id === first.id);
    const second = await alex.next('tpreq', (m) => m.id !== first.id);
    ok('a second request replaces the first, and the first is closed', replaced.reason === 'replaced' && second.kind === 'tpahere');
    // Names can be shortened, as with /tpa.
    alex.send({ t: 'chat', text: '/tpdeny bla' });
    const denied = await blake.next('tpreq-end', (m) => m.id === second.id);
    ok('/tpdeny takes a shortened name', denied.reason === 'denied');
    // /tphere is the same command as /tpahere.
    blakeP.lastRequestAt.clear();
    blake.send({ t: 'chat', text: '/tphere Alex' });
    const alias = await alex.next('tpreq', (m) => m.id !== second.id && m.id !== first.id);
    ok('/tphere is /tpahere', alias.kind === 'tpahere');
    server.game.chatTimes.delete('alex');
    alex.send({ t: 'chat', text: '/tpdeny Blake' });
    await blake.next('tpreq-end', (m) => m.id === alias.id);
    // A shortened name that fits more than one person names them all, rather
    // than claiming there is nobody called that.
    const blakely = await new Bot('Blakely').open();
    await blakely.signup();
    await blakely.land();
    alex.clear();
    alex.send({ t: 'chat', text: '/tpa bla' });
    const which = await alex.next('chat', (m) => m.kind === 'error');
    ok('a shortened name that fits two people names them both', /could be Blake, Blakely/.test(which.text), which.text);

    // Nobody dead can be asked: dying ends every request a player has, so
    // one sent to somebody dead would only end the moment they answered.
    const blakelyP = server.game.players.get(blakely.id);
    server.game.kill(blakelyP, 'fall');
    alex.send({ t: 'chat', text: '/tpa Blakely' });
    const dead = await alex.next('chat', (m) => m.kind === 'error' && /dead/.test(m.text));
    ok('asking somebody dead is refused, and says why', /Blakely is dead — ask again when they respawn/.test(dead.text), dead.text);
    server.game.respawn(blakelyP);

    // And a request the other one dies in ends saying so, not silently.
    const alexP = server.game.players.get(alex.id);
    server.game.chatTimes.delete('alex');
    alexP.lastRequestAt.clear();
    alex.send({ t: 'chat', text: '/tpa Blakely' });
    await blakely.next('tpreq');
    server.game.kill(blakelyP, 'fall');
    const told = await alex.next('chat', (m) => /died — the teleport request is off/.test(m.text));
    ok('a request that ends with a death says so to the other side', !!told && alex.has('tpreq-end', (m) => m.reason === 'died'));
    await blakely.close();
  }

''')

put(338, 387, r'''
  {
    alex.clear();
    // Three hundred kilometres in a tenth of a second is not a rocket.
    alex.state({ lat: alex.pos.lat + 3, lon: alex.pos.lon, alt: 900 });
    const fix = await alex.next('correct');
    ok('a teleport nobody granted is put back', Math.abs(fix.lat - alex.pos.lat + 3) < 0.01);
    alex.pos = { lat: fix.lat, lon: fix.lon, alt: 900 };
    await sleep(120);
    alex.clear();
    alex.state({ lat: alex.pos.lat + metresNorth(20), lon: alex.pos.lon, alt: 900 });
    await sleep(150);
    ok('an ordinary step is not', !alex.has('correct'));

    // A surge covers ground several times as fast, and honestly — but only for
    // as long as a surge lasts, not for as long as a page says it is surging.
    const p = server.game.players.get(alex.id);
    const dash = async (flags) => {
      alex.clear();
      const before = alex.pos;
      p.budget = 0;
      p.lastStateAt = Date.now() - 1000;
      p.correctedAt = -Infinity;
      alex.state({ lat: alex.pos.lat + metresNorth(800), lon: alex.pos.lon, alt: 900, flags });
      await sleep(150);
      if (alex.has('correct')) {
        alex.pos = before;
        return false;
      }
      return true;
    };
    // Flying: on foot the limit is a runner's (see 'held to what the game can do').
    ok('800 m in a second is too fast outside a surge', !(await dash(FLAG.elytra)));
    ok('and not inside one', await dash(FLAG.elytra | FLAG.surge));
    p.violations = 0;
    // The surge's own timeline, on a player of its own: the twelve seconds,
    // the grace after them, the fade, and the thirty to recharge.
    const g = server.game;
    const t0 = 1e9;
    const fake = { surge: { on: false, since: 0, endedAt: -Infinity, readyAt: 0 }, lastStateAt: t0, burst: null };
    ok('a surge is worth its allowance of the limit', g.surgeFactor(fake, FLAG.surge, t0) === SURGE_ALLOWANCE);
    fake.lastStateAt = t0 + 13000;
    ok('for its twelve seconds', g.surgeFactor(fake, FLAG.surge, t0 + 13000) === SURGE_ALLOWANCE);
    g.surgeFactor(fake, FLAG.surge, t0 + 14500);
    ok('and not for ever, however long the flag stays on', g.surgeFactor(fake, FLAG.surge, t0 + 16000) < SURGE_ALLOWANCE);
    const fade = 1 + (SURGE_ALLOWANCE - 1) * Math.exp(-0.25 * 4.5);
    ok('it fades as slowly as the game lets it', Math.abs(g.surgeFactor(fake, FLAG.surge, t0 + 18500) - fade) < 0.01);
    ok('and cannot start again while it recharges', g.surgeFactor(fake, FLAG.surge, t0 + 30000) < 1.1);
    ok('but can once it has', g.surgeFactor(fake, FLAG.surge, t0 + 43000) === SURGE_ALLOWANCE);
  }

''')

put(389, 438, r'''
  {
    // Face to face, two metres apart, away from spawn.
    const where = { lat: FIELD.lat + 0.01, lon: FIELD.lon + 0.01 };
    // Put both in the field through an admin teleport so the server agrees.
    const game = server.game;
    for (const [bot, dLat] of [[alex, 0], [blake, metresNorth(2)]]) {
      const p = game.players.get(bot.id);
      p.lastSpawnAt = -Infinity;
      game.teleport(p, { lat: where.lat + dLat, lon: where.lon, alt: 500, flying: false }, 'test');
      const tp = await bot.next('teleport', (m) => m.reason === 'test');
      bot.send({ t: 'arrived', tid: tp.tid });
      bot.state({ lat: tp.lat, lon: tp.lon, alt: 500, item: bot === alex ? SWORD_SLOT : 0 });
    }
    await sleep(150);
    blake.clear();
    alex.strike(blake.id);
    const hit = await blake.next('hit');
    ok('a hit lands', hit.amount > 0 && hit.by.name === 'Alex' && hit.health < MAX_HEALTH, `took ${hit.amount}`);
    ok('and knocks Blake back, away from Alex', Array.isArray(hit.kb) && hit.kb[2] > 0 && hit.kb[1] > 0);
    const first = hit.amount;
    alex.strike(blake.id);
    await sleep(120);
    ok('a second swing inside the immunity does nothing', blake.inbox.filter((m) => m.t === 'hit').length === 1);
    ok('the first hit was a fresh swing\'s worth', first >= 5);

    // A fight to the death, with the cooldown respected.
    let died = null;
    for (let i = 0; i < 12 && !died; i++) {
      await sleep(650);
      alex.strike(blake.id);
      died = await blake.next('died', () => true, 700).catch(() => null);
    }
    ok('enough hits kill', !!died && died.by?.name === 'Alex', died?.message);
    const notice = await alex.next('chat', (m) => m.kind === 'death');
    ok('and everybody hears about it', /Blake was slain by Alex/.test(notice.text));
    blake.send({ t: 'respawn' });
    const back = await blake.next('teleport', (m) => m.reason === 'respawn');
    const health = blake.inbox.find((m) => m.t === 'health');
    ok('respawning sends Blake back to spawn with full hearts', Math.abs(back.lat - 46.5606) < 1e-4 && health?.health === MAX_HEALTH);

    // Out of reach.
    blake.send({ t: 'arrived', tid: back.tid });
    blake.state({ lat: back.lat, lon: back.lon, alt: 600 });
    await sleep(700);
    blake.clear();
    alex.strike(blake.id);
    await sleep(200);
    ok('a swing at somebody kilometres away does nothing', !blake.has('hit'));
  }

''')

put(440, 489, r'''
  {
    alex.send({ t: 'watch', name: 'blake', explored: true, trail: true });
    const explored = await alex.next('explored');
    ok('switching on Blake\'s discoveries sends them', explored.name === 'blake' && explored.cells?.v === 2);
    const trail = await alex.next('trail');
    ok('and the trail', Array.isArray(trail.legs) && trail.legs.length >= 1);
    alex.send({ t: 'atlas' });
    const atlas = await alex.next('atlas');
    ok('the atlas lists who has been here', atlas.players.some((p) => p.key === 'blake' && p.explored > 0));

    // Everyone's discoveries are one shared map: sent whole when asked for,
    // and new ground from anybody — a newcomer too — as it is found.
    const g = server.game;
    const viewer = g.players.get(alex.id);
    alex.send({ t: 'watch', name: '*', explored: true, trail: false });
    const whole = await alex.next('shared');
    ok('asking for everyone\'s discoveries sends the shared map of this world',
      viewer.watchAll.explored === true && whole.world === 'earth' && whole.cells?.v === 2);
    server.accounts.signups.hits.clear();
    const cara = await new Bot('Cara').open();
    await cara.signup();
    await cara.land();
    // Somewhere nobody has been: sent there the way the server sends anyone.
    g.teleport(g.byKey.get('cara'), { lat: 12.5, lon: 15.5, alt: 900, flying: true }, 'test');
    const sent = await cara.next('teleport', (m) => m.reason === 'test');
    cara.send({ t: 'arrived', tid: sent.tid });
    cara.state({ lat: sent.lat, lon: sent.lon, alt: 900 });
    const added = await alex.next('shared+', (m) => m.keys?.length > 0, 4000).catch(() => null);
    ok('and a newcomer\'s new ground arrives on it without asking for anybody by name', !!added);
    ok('the shared map holds everybody\'s ground', g.sharedMap('earth').map.cells.size >= g.record('cara').on('earth').explored.cells.size);
    cara.close();
    // Off and on again is not a way to be sent the whole map again: it goes
    // once per connection and world (a toggle in a loop sent it every time).
    alex.send({ t: 'watch', name: '*', explored: true, off: true });
    await sleep(100);
    alex.clear();
    alex.send({ t: 'watch', name: '*', explored: true });
    await sleep(300);
    ok('switching everyone\'s discoveries off and on again does not send the whole map again', !alex.has('shared'));
    // A busy server's map is big: it goes in parts, paced, and nobody is cut
    // off. Every other cell of a block, so it is kept as runs, not one run.
    const big = g.sharedMap('earth').map;
    for (let i = 0; i < 150000; i++) big.cells.add(`16/${30000 + 2 * (i % 400)}/${20000 + Math.floor(i / 400)}`);
    const dora = await new Bot('Dora').open();
    await dora.signup();
    await dora.land();
    // Somebody not yet sent it is sent the whole of it, in parts that wait
    // for the page to have read the one before.
    dora.clear();
    dora.send({ t: 'watch', name: '*', explored: true });
''')

put(740, 745, r'''
    const rightful = await gated.accounts.signup('Rightful', 'hunter22', '198.51.100.9', 'river-otter-42');
    ok('while somebody else with the right code still gets in', !!rightful.account && !rightful.error);
    await gated.stop();
    void gatedAt;
  }

''')

put(747, 777, r'''
  {
    const g = server.game;
    const { readFileSync: readDisk, existsSync } = await import('node:fs');
    server.accounts.signups.hits.clear();
    // Alex's own connection was replaced in 'sign-in': the admin is back by token.
    const asAlex = async (bot = new Bot('Alex')) => {
      (await bot.open()).send({ t: 'resume', token: alex.auth.token, remember: false });
      return [bot, await bot.next('auth')];
    };
    const [admin] = await asAlex();
    const eli = await new Bot('Eli').open();
    await eli.signup();
    await eli.land();
    const onDisk = JSON.parse(readDisk(join(dir, 'accounts.json'), 'utf8'));
    ok('a new account is on disk at once, not at the next save', JSON.stringify(onDisk).includes('"eli"'));
    // Everybody here is 127.0.0.1: the address is shared, so only the account goes.
    admin.send({ t: 'chat', text: '/ban Eli testing' });
    const said = await admin.next('chat', (m) => /Eli is banned/.test(m.text));
    ok('banning someone whose address others share bans the account only', /only the account/.test(said.text) && g.bans.eli?.address === null);
    await eli.closed;
    ok('and what they had is on disk the moment they leave', existsSync(join(dir, 'players', 'eli.json')));
    const fay = await new Bot('Fay').open();
    ok('somebody else from the same address can still sign up', (await fay.signup()).ok === true);
    await fay.close();
    g.bans.eli.address = '127.0.0.1'; // as if Eli had had an address of their own
    const gusAuth = await (await new Bot('Gus').open()).signup();
    ok('an address ban refuses a new account from it', gusAuth.ok === false && /address is banned/.test(gusAuth.error));
    ok('but never an admin', (await asAlex())[1].ok === true);
    delete g.bans.eli;
  }

''')

put(779, 854, r'''
  {
    // Every bot signs up from 127.0.0.1; the hourly limit is not under test here.
    server.accounts.signups.hits.clear();
    const gina = await new Bot('Gina').open();
    await gina.signup();
    await gina.land();
    const hugo = await new Bot('Hugo').open();
    await hugo.signup();
    await hugo.land();
    gina.send({ t: 'chat', text: '/friend add Hugo' });
    const asked = await hugo.next('chat', (m) => m.kind === 'friend' && /wants to be friends/.test(m.text));
    const lists = await hugo.next('friends', (m) => m.incoming.some((f) => f.key === 'gina'));
    ok('a friend request reaches them, with a notice', !!asked && !!lists);
    hugo.send({ t: 'chat', text: '/friend accept' });
    const both = await gina.next('friends', (m) => m.friends.some((f) => f.key === 'hugo' && f.online));
    ok('accepting makes you friends, both ways', !!both && server.game.social.areFriends('hugo', 'gina'));
    // Two people online in near enough the same colour: the one joining gets
    // another, for good.
    const { colourDistance, TWIN_DISTANCE } = await import('../src/net/protocol.js');
    server.accounts.get('hugo').colour = server.accounts.get('gina').colour;
    await hugo.close();
    const gone = await gina.next('chat', (m) => m.kind === 'friend' && /Hugo went offline/.test(m.text));
    ok('friends hear when you go offline', !!gone);
    // Back with the token, as a reload does.
    const back = await new Bot('Hugo').open();
    back.send({ t: 'resume', token: hugo.auth.token });
    back.auth = await back.next('auth');
    back.id = back.auth.you.id;
    const online = await gina.next('chat', (m) => m.kind === 'friend' && /Hugo is online/.test(m.text));
    ok('and when you come back', !!online);
    const hugoNow = server.accounts.get('hugo').colour;
    ok('somebody joining in another player\'s colour is given a different one',
      colourDistance(hugoNow, server.accounts.get('gina').colour) >= TWIN_DISTANCE);
    await back.land(hugo.pos.lat, hugo.pos.lon, hugo.pos.alt);
    // A request to somebody offline waits for them.
    const ivy = await new Bot('Ivy').open();
    await ivy.signup();
    await ivy.close();
    gina.send({ t: 'chat', text: '/friend add Ivy' });
    await gina.next('chat', (m) => /Friend request sent to Ivy/.test(m.text));
    const ivyBack = await new Bot('Ivy').open();
    ivyBack.send({ t: 'login', name: 'Ivy', password: 'hunter22' });
    await ivyBack.next('auth');
    const waiting = await ivyBack.next('chat', (m) => m.kind === 'friend' && /1 friend request waiting/.test(m.text));
    ok('a request made while you were away is waiting when you sign in', !!waiting);
    ivyBack.close();
    // Auto-accept teleport requests from friends.
    back.send({ t: 'socialPrefs', autoTpa: true, autoParty: true, notify: true });
    await sleep(100);
    gina.send({ t: 'chat', text: '/tpa Hugo' });
    const went = await gina.next('teleport', (m) => m.reason === 'tpa');
    ok('a friend who accepts automatically sends you straight there', !!went);
    gina.send({ t: 'arrived', tid: went.tid });
    gina.state({ lat: went.lat, lon: went.lon, alt: went.alt });
    // Not into the middle of a fight: the request waits while the one who
    // would move is in one, and goes through by itself once it is over.
    gina.clear();
    const hugoP = server.game.byKey.get('hugo');
    server.game.byKey.get('gina').lastRequestAt.clear();
    server.game.chatTimes.delete('gina');
    hugoP.combatUntil = server.game.now() + 60000;
    back.clear();
    gina.send({ t: 'chat', text: '/tpahere Hugo' });
    await sleep(400);
    server.game.tick();
    ok('auto-accept waits while the one who would move is in a fight', !back.has('teleport') && server.game.requests.size > 0);
    // Held, not refused: the next tick after the fight carries it out.
    hugoP.combatUntil = 0;
    server.game.tick();
    const later = await back.next('teleport', (m) => m.reason === 'tpa', 3000).catch(() => null);
    ok('and goes through by itself when the fight is over', !!later);
    if (later) {
      back.send({ t: 'arrived', tid: later.tid });
      back.state({ lat: later.lat, lon: later.lon, alt: later.alt });
    }

''')

put(856, 921, r'''
    // Hugo accepts party invites from friends too.
    gina.send({ t: 'chat', text: '/party invite Hugo' });
    const joined = await gina.next('party', (m) => m.party?.members.length === 2);
    ok('a friend who accepts party invites automatically is in the party at once', !!joined && joined.party.leader === 'gina');
    back.send({ t: 'socialPrefs', autoTpa: false, autoParty: false, notify: true });
    // /pc talks to the party, wherever its members are.
    gina.send({ t: 'chat', text: '/pc over here' });
    const said = await back.next('chat', (m) => m.kind === 'party' && m.text === 'over here');
    ok('party chat reaches the party', !!said && said.from.name === 'Gina');
    back.send({ t: 'partyMark', name: 'Camp', lat: 46.61, lon: 7.95 });
    const marked = await gina.next('party', (m) => m.party?.waypoints.some((w) => w.name === 'Camp'));
    ok('a party waypoint is everyone\'s', !!marked && marked.party.waypoints[0].by === 'Hugo');
    // On disk as it is now, which is what a restart would find.
    server.game.saveServer();
    server.game.store.flush();
    const { readFileSync: readSaved } = await import('node:fs');
    const kept = JSON.parse(readSaved(join(dir, 'server.json'), 'utf8')).parties ?? [];
    ok('the party and its waypoints are kept across a restart',
      kept.length === 1 && kept[0].members.join() === 'gina,hugo' && kept[0].waypoints[0]?.name === 'Camp');
    // Voice reaches the party however far apart: the radio, heard from
    // anywhere on any world.
    const hp = server.game.byKey.get('hugo');
    hp.state = { ...hp.state, lat: hp.state.lat + 5 };
    gina.send({ t: 'voice', to: back.id ?? hp.id, kind: 'offer', data: { cid: 'p1', sdp: 'v=0 party' } });
    const far = await back.next('voice', (m) => m.data?.cid === 'p1', 2000).catch(() => null);
    ok('party voice reaches a member 500 km away', !!far);
    hp.state = { ...hp.state, lat: hp.state.lat - 5 };
    // Joining is not agreeing to be pulled about: the tick starts off.
    const party = server.game.social.partyFor('hugo');
    ok('nobody joins a party already ticked to teleport with it', !!party && !party.together.has('hugo'));
    back.send({ t: 'chat', text: '/party together on' });
    await back.next('party', (m) => m.party && m.party.members.find((x) => x.key === 'hugo')?.together);
    // The leader teleports, and the party comes along.
    server.game.byKey.get('gina').lastRtpAt = -Infinity;
    gina.send({ t: 'rtp' });
    const leaderTo = await gina.next('teleport', (m) => m.reason === 'rtp');
    const along = await back.next('teleport', (m) => m.reason === 'party');
    const apart = Math.hypot(along.lat - leaderTo.lat, along.lon - leaderTo.lon) * 111320;
    ok(`teleporting together: the party lands beside its leader  (${apart.toFixed(1)} m)`, apart < 20);
    // Unticked, the leader's next teleport leaves Hugo behind.
    back.send({ t: 'chat', text: '/party together off' });
    await back.next('party', (m) => m.party && !m.party.members.find((x) => x.key === 'hugo').together);
    server.game.byKey.get('gina').lastRtpAt = -Infinity;
    back.clear();
    gina.send({ t: 'arrived', tid: leaderTo.tid });
    gina.send({ t: 'rtp' });
    await gina.next('teleport', (m) => m.reason === 'rtp');
    await sleep(200);
    ok('and untick it to stay put', !back.has('teleport'));
    // Leaving a party of two ends it: a party of one is nobody's party.
    // The waypoints go to the members' own (see social.keepWaypoints).
    back.send({ t: 'chat', text: '/party leave' });
    const over = await gina.next('party', (m) => m.party === null);
    ok(`the last but one leaving ends the party  (${JSON.stringify([...server.game.social.parties.keys()])})`, !!over && server.game.social.parties.size === 0);
    // Invitations run out: a minute, then gone for both sides.
    gina.send({ t: 'chat', text: '/party invite Hugo' });
    const invite = await back.next('partyInvite');
    const invited = server.game.social.parties.get(invite.party);
    invited.invites.get('hugo').expires = Date.now() - 1;
    server.game.tick();
    const ran = await back.next('partyInviteEnd', (m) => m.reason === 'expired');
    ok(`a party invite lasts ${invite.expiresIn} s and then runs out`, !!ran && invite.expiresIn === 60);
    gina.close();
    back.close();
  }

''')

put(923, 954, r'''
  {
    server.accounts.signups.hits.clear();
    const pia = await new Bot('Pia').open();
    await pia.signup('first one');
    // The Online panel's form sends both whole; /password in chat splits on
    // spaces, so it takes two words exactly.
    const change = async (old, next) => {
      pia.send({ t: 'password', old, new: next });
      const reply = await pia.next('password');
      server.game.byKey.get('pia').client.passwordAt = -Infinity;
      return reply;
    };
    const spaced = await change('first one', 'a long one with spaces');
    ok('a new password with spaces in it is changed whole', spaced.ok === true);
    ok('and is the whole of what was typed', !!(await server.accounts.login('Pia', 'a long one with spaces', '127.0.0.1')).account);
    pia.send({ t: 'chat', text: '/password a long one with spaces and more' });
    const pointed = await pia.next('chat', (m) => m.kind === 'error');
    ok('/password with spaces is refused and points to the form', /Change password/.test(pointed.text));
    pia.send({ t: 'chat', text: `/password x ${'y'.repeat(400)}` });
    const cut = await pia.next('chat', (m) => m.kind === 'error');
    ok('and one cut short by the chat\'s length is refused rather than half set', /Change password/.test(cut.text));
    const wrong = await change('not it', 'whatever-else');
    ok('the wrong current password changes nothing', wrong.ok === false && !!(await server.accounts.login('Pia', 'a long one with spaces', '127.0.0.1')).account);
    // One past the longest allowed is read, so a longer one is refused, not
    // cut down to a password nobody typed.
    const long = await change('a long one with spaces', 'z'.repeat(200));
    ok('a new password over the limit is refused, not cut', long.ok === false && /at most/.test(long.error));
    // Signing out closes the session the token stood for.
    const token = pia.auth.token;
    pia.send({ t: 'logout' });
    await pia.next('loggedOut');
    await pia.closed;
''')

left = [i + 1 for i, l in enumerate(L) if l.startswith('@@MISSING')]
assert not left, left[:10]
open(out, 'w').write('\n'.join(L) + '\n')
print('ok', len(L))

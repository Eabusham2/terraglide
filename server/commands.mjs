/**
 * Slash commands, typed into chat or sent by the buttons in the game's
 * players panel — the buttons send exactly what you would have typed, so
 * there is one path through here for both.
 */

import { BODIES, findBody } from '../src/geo/bodies.js';
import { COMMANDS, NEAR_CHAT_M, findCommand, separation } from '../src/net/protocol.js';
import { radiusOf } from './records.mjs';

/**
 * @param {import('./game.mjs').Game} game
 * @param {object} player
 * @param {{name: string, args: string[], rest: string}} command
 */
export function runCommand(game, player, command) {
  const spec = findCommand(command.name);
  if (!spec) return game.tell(player, `Unknown command /${command.name} — /help lists them`, 'error');
  if (spec.admin && !player.admin) return game.tell(player, `/${spec.name} is for admins`, 'error');
  const [first] = command.args;
  const target = () => {
    if (!first) {
      game.tell(player, `Usage: /${spec.name} ${spec.args}`, 'error');
      return null;
    }
    const found = game.findPlayer(first);
    if (!found) game.tell(player, game.nobodyCalled(first), 'error');
    return found;
  };

  switch (spec.name) {
    case 'help': {
      const lines = COMMANDS.filter((c) => !c.admin || player.admin)
        .map((c) => `/${c.name}${c.args ? ` ${c.args}` : ''} — ${c.help}`);
      return game.send(player.client, { t: 'chat', kind: 'help', text: lines.join('\n') });
    }
    case 'tpa':
    case 'tpahere': {
      const to = target();
      if (to) game.request(player, to, spec.name);
      return;
    }
    case 'tp': {
      const to = target();
      if (!to) return;
      if (!player.admin) return game.request(player, to, 'tpa');
      // Admins go straight there, or send one player to another.
      const second = command.args[1] ? game.findPlayer(command.args[1]) : null;
      // A second name that matches nobody is a mistake, not "just me then".
      if (command.args[1] && !second) return game.tell(player, game.nobodyCalled(command.args[1]), 'error');
      const mover = second ? to : player;
      const host = second ?? to;
      // Nor to somebody still arriving, as with /tpa: their height is the one
      // they were sent to, not yet one the server has seen them at, and a dive
      // from beside them could count from nowhere near it. See whyNot.
      if (!host.state || host.pending) {
        return game.tell(player, `${host === player ? 'You have' : `${host.name} has`} not landed yet — try again in a moment`, 'error');
      }
      // With what a fall may count from beside them, as a /tpa sends it: an
      // honest dive from beside somebody flying high was put back without it.
      game.teleport(mover, {
        world: host.world, lat: host.state.lat, lon: host.state.lon, alt: host.state.alt, flying: true,
        ceiling: game.spendableCeiling(host),
      }, 'tp');
      return game.tell(player, `Sent ${mover === player ? 'you' : mover.name} to ${host.name}`);
    }
    case 'tpaccept':
      return game.acceptRequest(player, first);
    case 'tpdeny':
      return game.denyRequest(player, first);
    case 'tpacancel':
      return game.cancelRequest(player, first);
    case 'msg': {
      const to = target();
      if (!to) return;
      const text = command.rest.slice(first.length).trim();
      if (!text) return game.tell(player, `Usage: /msg ${to.name} <message>`, 'error');
      return whisper(game, player, to, text);
    }
    case 'r': {
      const to = player.replyTo ? game.players.get(player.replyTo) : null;
      if (!to) return game.tell(player, 'Nobody to reply to', 'error');
      if (!command.rest) return game.tell(player, 'Usage: /r <message>', 'error');
      return whisper(game, player, to, command.rest);
    }
    case 'near': {
      if (!command.rest) return game.tell(player, 'Usage: /near <message>', 'error');
      const radius = radiusOf(player.world);
      let heard = 0;
      for (const other of game.players.values()) {
        if (other.world !== player.world || !other.state || !player.state) continue;
        if (other !== player && separation(other.state, player.state, radius) > NEAR_CHAT_M) continue;
        if (other !== player) heard += 1;
        game.send(other.client, { t: 'chat', kind: 'near', from: game.speaker(player), text: command.rest });
      }
      if (!heard) game.tell(player, 'Nobody is near enough to hear that');
      return;
    }
    case 'me':
      if (!command.rest) return;
      return game.broadcast({ t: 'chat', kind: 'me', from: game.speaker(player), text: command.rest });
    case 'list': {
      const byWorld = new Map();
      for (const p of game.players.values()) {
        if (!byWorld.has(p.world)) byWorld.set(p.world, []);
        byWorld.get(p.world).push(p.name);
      }
      const parts = [...byWorld].map(([world, names]) => `${BODIES[world].name}: ${names.join(', ')}`);
      return game.tell(player, `${game.players.size} online — ${parts.join(' · ')}`);
    }
    case 'spawn': {
      if (player.dead) return;
      if (game.inCombat(player)) return game.tell(player, 'Not in the middle of a fight', 'error');
      const wait = game.config.spawnCooldownS - (game.now() - player.lastSpawnAt) / 1000;
      if (wait > 0) return game.tell(player, `Wait ${Math.ceil(wait)} s`, 'error');
      player.lastSpawnAt = game.now();
      const spawn = game.spawnOf(player.world);
      return game.teleport(player, { lat: spawn.lat, lon: spawn.lon, flying: false }, 'spawn');
    }
    case 'rtp':
      return game.randomTeleport(player);
    case 'travel': {
      if (!first) {
        const names = Object.values(BODIES).map((b) => b.id).join(', ');
        return game.tell(player, `Usage: /travel <world> — ${names}`, 'error');
      }
      return game.travel(player, command.rest);
    }
    case 'kill':
      if (player.dead) return;
      // Giving up a fight is losing it: the kill goes to whoever you were fighting.
      return game.hurt(player, player.health, { cause: 'kill', by: game.lastAttacker(player) });
    case 'password': {
      // Two words exactly. A password with a space in it - which sign-up
      // takes - cannot be told apart from the next one here, and a guess
      // would set a password nobody typed. The Online panel's form sends
      // them whole.
      if (command.args.length !== 2 || command.cut) {
        return game.tell(player, command.args.length > 2 || command.cut
          ? 'A password with spaces in it, or a long one, is changed in the Online panel (K) — Change password'
          : 'Usage: /password <old> <new> — or Change password in the Online panel (K)', 'error');
      }
      const [oldPassword, newPassword] = command.args;
      game.onPassword(player, { old: oldPassword, new: newPassword });
      return;
    }
    case 'friend': {
      const social = game.social;
      const [sub = 'list', name] = command.args;
      switch (sub.toLowerCase()) {
        case 'add': return name ? social.addFriend(player, name) : game.tell(player, 'Usage: /friend add <player>', 'error');
        case 'accept': return social.acceptFriend(player, name);
        case 'deny': return social.denyFriend(player, name);
        case 'remove': return name ? social.removeFriend(player, name) : game.tell(player, 'Usage: /friend remove <player>', 'error');
        case 'list': return social.listFriends(player);
        // "/friend Alex" is the commonest thing to type.
        default: return social.addFriend(player, sub);
      }
    }
    case 'party': {
      const social = game.social;
      const [sub = 'list', name] = command.args;
      switch (sub.toLowerCase()) {
        case 'invite': return name ? social.invite(player, name) : game.tell(player, 'Usage: /party invite <player>', 'error');
        case 'accept': return social.accept(player, name);
        case 'deny': return social.deny(player, name);
        case 'leave': return social.leave(player);
        case 'kick': return name ? social.kick(player, name) : game.tell(player, 'Usage: /party kick <player>', 'error');
        case 'leader': return name ? social.promote(player, name) : game.tell(player, 'Usage: /party leader <player>', 'error');
        case 'list': return social.listParty(player);
        case 'gather': return social.gather(player);
        case 'together': return social.setTogether(player, !/^(off|no|0|false)$/i.test(name ?? ''));
        case 'mark': return social.mark(player, { name: command.rest.slice(sub.length).trim() });
        case 'unmark': return social.unmark(player, { name: command.rest.slice(sub.length).trim() });
        // "/party Alex" invites, as it does everywhere else.
        default: return social.invite(player, sub);
      }
    }
    case 'pc':
      if (!command.rest) return game.tell(player, 'Usage: /pc <message>', 'error');
      return game.social.say(player, command.rest);
    case 'kick': {
      const to = target();
      if (!to) return;
      return game.kick(to, command.rest.slice(first.length).trim() || 'Kicked by an admin');
    }
    case 'ban': {
      if (!first) return game.tell(player, `Usage: /ban ${spec.args}`, 'error');
      const account = game.accounts.get(first);
      if (!account) return game.tell(player, `No account called ${first}`, 'error');
      const online = game.byKey.get(account.key);
      const reason = command.rest.slice(first.length).trim();
      // Their address too, so a new account from the same place is refused —
      // unless somebody else online is on it: then it is a shared network, or
      // a proxy the server cannot see past, and banning it would ban them all.
      const address = online?.client.address ?? null;
      const shared = address && [...game.players.values()].some((p) => p !== online && p.client.address === address);
      game.bans[account.key] = { name: account.name, reason, by: player.name, at: game.now(), address: shared ? null : address };
      game.accounts.closeAllSessions(account);
      game.saveServer();
      if (online) game.kick(online, `Banned${reason ? `: ${reason}` : ''}`);
      return game.tell(player, shared
        ? `${account.name} is banned — their address is shared with other players, so only the account`
        : `${account.name} is banned`);
    }
    case 'unban': {
      if (!first) return game.tell(player, `Usage: /unban ${spec.args}`, 'error');
      const key = first.toLowerCase();
      if (!game.bans[key]) return game.tell(player, `${first} is not banned`, 'error');
      delete game.bans[key];
      game.saveServer();
      return game.tell(player, `${first} can come back`);
    }
    case 'heal': {
      const who = first ? game.findPlayer(first) : player;
      if (!who) return game.tell(player, `Nobody called ${first} is online`, 'error');
      if (who.dead) return game.tell(player, `${who.name} needs to respawn first`, 'error');
      who.health = 20;
      game.send(who.client, { t: 'health', health: who.health });
      return game.tell(player, `Healed ${who === player ? 'you' : who.name}`);
    }
    case 'setspawn': {
      if (!player.state) return;
      game.spawns[player.world] = { lat: player.state.lat, lon: player.state.lon, label: `${BODIES[player.world].name} spawn` };
      game.saveServer();
      return game.tell(player, `Spawn on ${BODIES[player.world].name} moved here`);
    }
    case 'say':
      if (!command.rest) return;
      return game.announce(`[${player.name}] ${command.rest}`, { kind: 'announce' });
    default:
      return game.tell(player, `/${spec.name} is not available`, 'error');
  }
}

function whisper(game, from, to, text) {
  if (to === from) return game.tell(from, 'Talking to yourself?', 'error');
  to.replyTo = from.id;
  from.replyTo = to.id;
  game.send(to.client, { t: 'chat', kind: 'whisper', from: game.speaker(from), text });
  game.send(from.client, { t: 'chat', kind: 'whisperSent', to: game.speaker(to), text });
}

export { findBody };

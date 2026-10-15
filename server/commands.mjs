/**
 * Slash commands, typed into chat or sent by the buttons in the game's
 * players panel — the buttons send exactly what you would have typed, so
 * there is one path through here for both.
 */

import { BODIES, findBody } from '../src/geo/bodies.js';
import { COMMANDS, findCommand, separation } from '../src/net/protocol.js';
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
    if (!found) game.tell(player, `Nobody called ${first} is online`, 'error');
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
      const mover = second ? to : player;
      const host = second ?? to;
      if (!host.state) return game.tell(player, `${host.name} has not landed yet`, 'error');
      game.teleport(mover, { world: host.world, lat: host.state.lat, lon: host.state.lon, alt: host.state.alt, flying: true }, 'tp');
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
        if (other !== player && separation(other.state, player.state, radius) > 3000) continue;
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
      return game.hurt(player, player.health, { cause: 'kill' });
    case 'password': {
      const [oldPassword, newPassword] = command.args;
      if (!oldPassword || !newPassword) return game.tell(player, 'Usage: /password <old> <new>', 'error');
      game.accounts.changePassword(player.account, oldPassword, newPassword, player.client.token).then((result) => {
        game.tell(player, result.error ?? 'Password changed — other devices have been signed out', result.error ? 'error' : 'system');
      });
      return;
    }
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
      game.bans[account.key] = { name: account.name, reason, by: player.name, at: game.now(), address: online?.client.address ?? null };
      game.accounts.closeAllSessions(account);
      game.saveServer();
      if (online) game.kick(online, `Banned${reason ? `: ${reason}` : ''}`);
      return game.tell(player, `${account.name} is banned`);
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

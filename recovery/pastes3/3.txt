/**
 * Friends and parties.
 *
 * Friends are for keeps: a request, an answer, and from then on you hear when
 * they come and go, and — if you say so — their teleport requests and party
 * invites are accepted for you. They live in each player's record, both sides.
 *
 * A party is a few people playing together for an evening: up to eight, one
 * leader, a voice channel that reaches every member however far apart they
 * are, their own waypoints, a chat of their own, and a tick each for "bring me
 * along when the leader teleports". Parties outlast a dropped connection and
 * a server restart, and end when the last member leaves or nobody has been
 * online in one for half an hour.
 *
 * Everything here is decided by the server, from names the server knows: a
 * page cannot put itself in a party, see another party's waypoints, or be
 * teleported anywhere a leader was not actually sent.
 */

import { BODIES } from '../src/geo/bodies.js';
import { nameKey } from '../src/net/protocol.js';
import { radiusOf } from './records.mjs';

export const MAX_FRIENDS = 100;
const MAX_PENDING = 50;
export const MAX_PARTY = 8;
export const PARTY_INVITE_S = 60;
export const MAX_PARTY_WAYPOINTS = 50;
/** A party nobody has been online in for this long is wound up. */
const PARTY_IDLE_MS = 30 * 60 * 1000;
/** How far apart members land when they arrive together, metres. */
const RING_M = 4;

const DEFAULT_PREFS = Object.freeze({ autoTpa: false, autoParty: false, notify: true });

export class Social {
  /** @param {import('./game.mjs').Game} game */
  constructor(game, saved = {}) {
    this.game = game;
    /** id -> { id, leader, members: [key], together: Set<key>, invites: Map<key, {expires, by}>, waypoints, nextMark, idleSince } */
    this.parties = new Map();
    /** key -> party id */
    this.partyOf = new Map();
    this.nextParty = 1;
    for (const p of Array.isArray(saved.parties) ? saved.parties : []) this.restore(p);
  }

  /* ---------------------------------------------------------- the record */

  /** One player's friends and preferences, made whole if missing. */
  social(key) {
    const record = this.game.record(key);
    const s = record.social && typeof record.social === 'object' ? record.social : {};
    const list = (v) => (Array.isArray(v) ? v.filter((k) => typeof k === 'string').slice(0, MAX_FRIENDS) : []);
    record.social = {
      friends: list(s.friends),
      incoming: list(s.incoming).slice(-MAX_PENDING),
      outgoing: list(s.outgoing).slice(-MAX_PENDING),
      prefs: { ...DEFAULT_PREFS, ...(s.prefs && typeof s.prefs === 'object' ? s.prefs : {}) },
    };
    return record.social;
  }

  save(key) {
    this.game.saveRecord(this.game.record(key));
  }

  areFriends(a, b) {
    return this.social(a).friends.includes(b);
  }

  /** Name and colour for a key, online or not. */
  who(key) {
    const online = this.game.byKey.get(key);
    const account = this.game.accounts.get(key);
    return {
      key,
      name: online?.name ?? account?.name ?? key,
      colour: online?.colour ?? account?.colour ?? '#9aa4b2',
      online: !!online,
      world: online?.world ?? this.game.record(key).world,
      id: online?.id ?? null,
    };
  }

  /** An account by name, online or off, for friend requests. */
  account(name) {
    const key = nameKey(String(name ?? ''));
    if (!key) return null;
    const online = this.game.findPlayer(name);
    if (online) return online.key;
    return this.game.accounts.get(key) ? key : null;
  }

  /* ------------------------------------------------------------- friends */

  /** Everything the page shows about your friends, sent whole when it changes. */
  sendFriends(key) {
    const player = this.game.byKey.get(key);
    if (!player) return;
    const s = this.social(key);
    this.game.send(player.client, {
      t: 'friends',
      friends: s.friends.map((k) => this.who(k)),
      incoming: s.incoming.map((k) => this.who(k)),
      outgoing: s.outgoing.map((k) => this.who(k)),
      prefs: s.prefs,
    });
  }

  addFriend(player, name) {
    const key = this.account(name);
    if (!key) return this.game.tell(player, `No account called ${String(name ?? '').slice(0, 32)}`, 'error');
    if (key === player.key) return this.game.tell(player, 'You are already your own friend', 'error');
    const mine = this.social(player.key);
    const theirs = this.social(key);
    const them = this.who(key);
    if (mine.friends.includes(key)) return this.game.tell(player, `${them.name} is already your friend`, 'error');
    // They asked first: this is the answer.
    if (mine.incoming.includes(key)) return this.acceptFriend(player, them.name);
    if (mine.friends.length >= MAX_FRIENDS) return this.game.tell(player, `That is ${MAX_FRIENDS} friends — remove one first`, 'error');
    if (!mine.outgoing.includes(key)) mine.outgoing.push(key);
    if (!theirs.incoming.includes(key) && !theirs.incoming.includes(player.key)) theirs.incoming.push(player.key);
    mine.outgoing = mine.outgoing.slice(-MAX_PENDING);
    theirs.incoming = theirs.incoming.slice(-MAX_PENDING);
    this.save(player.key);
    this.save(key);
    this.game.tell(player, `Friend request sent to ${them.name}${them.online ? '' : ' — they will see it when they are next on'}`);
    const online = this.game.byKey.get(key);
    if (online) this.game.tell(online, `${player.name} wants to be friends — /friend accept ${player.name} or /friend deny ${player.name}`, 'friend');
    this.sendFriends(player.key);
    this.sendFriends(key);
  }

  acceptFriend(player, name) {
    const mine = this.social(player.key);
    const key = name ? this.account(name) : mine.incoming[mine.incoming.length - 1];
    if (!key || !mine.incoming.includes(key)) {
      return this.game.tell(player, name ? `No friend request from ${String(name).slice(0, 32)}` : 'No friend requests', 'error');
    }
    const theirs = this.social(key);
    mine.incoming = mine.incoming.filter((k) => k !== key);
    theirs.outgoing = theirs.outgoing.filter((k) => k !== player.key);
    if (mine.friends.length >= MAX_FRIENDS || theirs.friends.length >= MAX_FRIENDS) {
      this.save(player.key);
      this.save(key);
      this.sendFriends(player.key);
      return this.game.tell(player, 'One of you already has as many friends as there is room for', 'error');
    }
    if (!mine.friends.includes(key)) mine.friends.push(key);
    if (!theirs.friends.includes(player.key)) theirs.friends.push(player.key);
    this.save(player.key);
    this.save(key);
    const them = this.who(key);
    this.game.tell(player, `You and ${them.name} are friends`, 'friend');
    const online = this.game.byKey.get(key);
    if (online) this.game.tell(online, `${player.name} accepted — you are friends`, 'friend');
    this.sendFriends(player.key);
    this.sendFriends(key);
  }

  denyFriend(player, name) {
    const mine = this.social(player.key);
    const key = name ? this.account(name) : mine.incoming[mine.incoming.length - 1];
    if (!key || !mine.incoming.includes(key)) {
      return this.game.tell(player, name ? `No friend request from ${String(name).slice(0, 32)}` : 'No friend requests', 'error');
    }
    mine.incoming = mine.incoming.filter((k) => k !== key);
    const theirs = this.social(key);
    theirs.outgoing = theirs.outgoing.filter((k) => k !== player.key);
    this.save(player.key);
    this.save(key);
    this.game.tell(player, `Turned down ${this.who(key).name}`);
    this.sendFriends(player.key);
    this.sendFriends(key);
  }

  removeFriend(player, name) {
    const key = this.account(name);
    const mine = this.social(player.key);
    if (!key || !(mine.friends.includes(key) || mine.outgoing.includes(key))) {
      return this.game.tell(player, `${String(name ?? '').slice(0, 32)} is not on your friends list`, 'error');
    }
    const theirs = this.social(key);
    mine.friends = mine.friends.filter((k) => k !== key);
    mine.outgoing = mine.outgoing.filter((k) => k !== key);
    theirs.friends = theirs.friends.filter((k) => k !== player.key);
    theirs.incoming = theirs.incoming.filter((k) => k !== player.key);
    this.save(player.key);
    this.save(key);
    this.game.tell(player, `${this.who(key).name} is off your friends list`);
    this.sendFriends(player.key);
    this.sendFriends(key);
  }

  listFriends(player) {
    const s = this.social(player.key);
    if (!s.friends.length && !s.incoming.length) return this.game.tell(player, 'No friends yet — /friend add <name>');
    const parts = s.friends.map((k) => {
      const w = this.who(k);
      return w.online ? `${w.name} (on ${BODIES[w.world]?.name ?? w.world})` : `${w.name} (offline)`;
    });
    const asking = s.incoming.map((k) => this.who(k).name);
    this.game.tell(player, `Friends: ${parts.join(', ') || 'none yet'}${asking.length ? ` · asking: ${asking.join(', ')}` : ''}`);
  }

  setPrefs(player, m) {
    const s = this.social(player.key);
    s.prefs = {
      autoTpa: !!m.autoTpa,
      autoParty: !!m.autoParty,
      notify: m.notify !== false,
    };
    this.save(player.key);
  }

  /** Whether `to` takes a teleport request from `from` without being asked. */
  autoAcceptsTpa(to, from) {
    return this.social(to.key).prefs.autoTpa && this.areFriends(to.key, from.key);
  }

  /* ----------------------------------------------------- coming and going */

  /** Somebody signed in: their lists, their party, and a word to their friends. */
  onJoin(player, { quiet = false } = {}) {
    this.sendFriends(player.key);
    const s = this.social(player.key);
    if (s.incoming.length && !quiet) {
      this.game.tell(player, `${s.incoming.length} friend request${s.incoming.length === 1 ? '' : 's'} waiting — Players (Tab) or /friend list`, 'friend');
    }
    const party = this.partyFor(player.key);
    if (party) {
      party.idleSince = null;
      this.sendParty(party);
    }
    if (quiet) return;
    for (const key of s.friends) {
      const friend = this.game.byKey.get(key);
      if (!friend) continue;
      this.sendFriends(key);
      if (this.social(key).prefs.notify) {
        this.game.tell(friend, `${player.name} is online${player.world !== 'earth' ? ` — on ${BODIES[player.world].name}` : ''}`, 'friend');
      }
    }
  }

  onLeave(player, { quiet = false } = {}) {
    for (const [key] of this.invitesTo(player.key)) this.endInvite(key, player.key, 'left');
    const party = this.partyFor(player.key);
    if (party) {
      if (!party.members.some((k) => k !== player.key && this.game.byKey.has(k))) party.idleSince = this.game.now();
      this.sendParty(party, { except: player.key });
    }
    if (quiet) return;
    for (const key of this.social(player.key).friends) {
      const friend = this.game.byKey.get(key);
      if (!friend) continue;
      this.sendFriends(key);
      if (this.social(key).prefs.notify) this.game.tell(friend, `${player.name} went offline`, 'friend');
    }
  }

  /* ------------------------------------------------------------- parties */

  partyFor(key) {
    const id = this.partyOf.get(key);
    return id ? this.parties.get(id) ?? null : null;
  }

  sameParty(a, b) {
    const id = this.partyOf.get(a);
    return !!id && id === this.partyOf.get(b);
  }

  /** The party as its members see it. */
  view(party) {
    return {
      id: party.id,
      leader: party.leader,
      members: party.members.map((k) => ({ ...this.who(k), together: party.together.has(k), leader: k === party.leader })),
      invited: [...party.invites.keys()].map((k) => this.who(k)),
      waypoints: party.waypoints,
    };
  }

  sendParty(party, { except = null } = {}) {
    const view = this.view(party);
    for (const key of party.members) {
      if (key === except) continue;
      const member = this.game.byKey.get(key);
      if (member) this.game.send(member.client, { t: 'party', party: view });
    }
  }

  tellParty(party, text, { except = null } = {}) {
    for (const key of party.members) {
      const member = this.game.byKey.get(key);
      if (member && key !== except) this.game.tell(member, text, 'party');
    }
  }

  create(leader) {
    const party = {
      id: this.nextParty++,
      leader: leader.key,
      members: [leader.key],
      together: new Set([leader.key]),
      invites: new Map(),
      waypoints: [],
      nextMark: 1,
      idleSince: null,
    };
    this.parties.set(party.id, party);
    this.partyOf.set(leader.key, party.id);
    return party;
  }

  /** Invitations waiting for `key`, as [inviter key, party] pairs. */
  invitesTo(key) {
    const out = [];
    for (const party of this.parties.values()) {
      if (party.invites.has(key)) out.push([party.invites.get(key).by, party]);
    }
    return out;
  }

  invite(player, name) {
    const to = this.game.findPlayer(name);
    if (!to) return this.game.tell(player, `Nobody called ${String(name ?? '').slice(0, 32)} is online`, 'error');
    if (to === player) return this.game.tell(player, 'You are always in your own party', 'error');
    let party = this.partyFor(player.key);
    if (party && party.leader !== player.key) return this.game.tell(player, 'Only the party leader can invite', 'error');
    if (party?.members.includes(to.key)) return this.game.tell(player, `${to.name} is already in your party`, 'error');
    if (party && party.members.length + party.invites.size >= MAX_PARTY) {
      return this.game.tell(player, `A party is ${MAX_PARTY} at most`, 'error');
    }
    if (!party) party = this.create(player);
    party.invites.set(to.key, { by: player.key, expires: this.game.now() + PARTY_INVITE_S * 1000 });
    this.game.send(to.client, {
      t: 'partyInvite',
      party: party.id,
      from: { id: player.id, key: player.key, name: player.name, colour: player.colour },
      expiresIn: PARTY_INVITE_S,
    });
    this.sendParty(party);
    // A friend who said yes in advance.
    const theirs = this.social(to.key);
    if (theirs.prefs.autoParty && theirs.friends.includes(player.key)) {
      this.game.tell(to, `Joined ${player.name}'s party (you accept party invites from friends)`, 'party');
      return this.accept(to, player.name);
    }
    this.game.tell(to, `${player.name} invited you to their party — /party accept or /party deny — ${PARTY_INVITE_S} s`, 'party');
    this.game.tell(player, `Invited ${to.name}. They have ${PARTY_INVITE_S} s to answer`, 'party');
  }

  /** The invitation to `key` from `name`'s party, or the newest. */
  findInvite(key, name) {
    const invites = this.invitesTo(key);
    if (!name) return invites.sort((a, b) => b[1].invites.get(key).expires - a[1].invites.get(key).expires)[0] ?? null;
    const wanted = nameKey(name);
    return invites.find(([by]) => by === wanted) ?? invites.find(([by]) => by.startsWith(wanted)) ?? null;
  }

  accept(player, name) {
    const found = this.findInvite(player.key, name);
    if (!found) return this.game.tell(player, name ? `No party invite from ${String(name).slice(0, 32)}` : 'No party invites', 'error');
    const [, party] = found;
    party.invites.delete(player.key);
    if (party.members.length >= MAX_PARTY) {
      this.sendParty(party);
      return this.game.tell(player, 'That party is full now', 'error');
    }
    const old = this.partyFor(player.key);
    if (old && old !== party) this.leave(player, { quiet: true });
    party.members.push(player.key);
    party.together.add(player.key);
    party.idleSince = null;
    this.partyOf.set(player.key, party.id);
    this.game.send(player.client, { t: 'partyInviteEnd', party: party.id, reason: 'accepted' });
    this.tellParty(party, `${player.name} joined the party`);
    this.sendParty(party);
    this.game.saveServer();
  }

  deny(player, name) {
    const found = this.findInvite(player.key, name);
    if (!found) return this.game.tell(player, name ? `No party invite from ${String(name).slice(0, 32)}` : 'No party invites', 'error');
    const [by, party] = found;
    this.endInvite(by, player.key, 'denied', party);
  }

  endInvite(by, key, reason, party = this.invitesTo(key).find(([b]) => b === by)?.[1]) {
    if (!party || !party.invites.has(key)) return;
    party.invites.delete(key);
    const invitee = this.game.byKey.get(key);
    if (invitee) this.game.send(invitee.client, { t: 'partyInviteEnd', party: party.id, reason });
    const inviter = this.game.byKey.get(by);
    if (inviter && reason === 'denied') this.game.tell(inviter, `${this.who(key).name} said no to the party`, 'party');
    if (inviter && reason === 'expired') this.game.tell(inviter, `${this.who(key).name} did not answer the party invite`, 'party');
    // A party of one that was only ever an invitation goes away again.
    if (party.members.length === 1 && party.invites.size === 0) this.disband(party);
    else this.sendParty(party);
  }

  leave(player, { quiet = false } = {}) {
    const party = this.partyFor(player.key);
    if (!party) return quiet ? null : this.game.tell(player, 'You are not in a party', 'error');
    this.removeMember(party, player.key);
    this.game.send(player.client, { t: 'party', party: null });
    if (!quiet) this.game.tell(player, 'You left the party', 'party');
    if (this.parties.has(party.id)) this.tellParty(party, `${player.name} left the party`);
    this.game.saveServer();
  }

  kick(player, name) {
    const party = this.partyFor(player.key);
    if (!party) return this.game.tell(player, 'You are not in a party', 'error');
    if (party.leader !== player.key) return this.game.tell(player, 'Only the party leader can remove people', 'error');
    const wanted = nameKey(String(name ?? ''));
    const key = party.members.find((k) => k === wanted) ?? party.members.find((k) => k.startsWith(wanted) && wanted);
    if (!key || key === player.key) return this.game.tell(player, `${String(name ?? '').slice(0, 32)} is not in your party`, 'error');
    this.removeMember(party, key);
    const gone = this.game.byKey.get(key);
    if (gone) {
      this.game.send(gone.client, { t: 'party', party: null });
      this.game.tell(gone, `${player.name} removed you from the party`, 'party');
    }
    if (this.parties.has(party.id)) this.tellParty(party, `${this.who(key).name} was removed from the party`);
    this.game.saveServer();
  }

  promote(player, name) {
    const party = this.partyFor(player.key);
    if (!party) return this.game.tell(player, 'You are not in a party', 'error');
    if (party.leader !== player.key) return this.game.tell(player, 'Only the party leader can hand it over', 'error');
    const wanted = nameKey(String(name ?? ''));
    const key = party.members.find((k) => k === wanted) ?? party.members.find((k) => k.startsWith(wanted) && wanted);
    if (!key || key === player.key) return this.game.tell(player, `${String(name ?? '').slice(0, 32)} is not in your party`, 'error');
    party.leader = key;
    this.tellParty(party, `${this.who(key).name} leads the party now`);
    this.sendParty(party);
    this.game.saveServer();
  }

  removeMember(party, key) {
    party.members = party.members.filter((k) => k !== key);
    party.together.delete(key);
    this.partyOf.delete(key);
    if (party.members.length <= 1 && party.invites.size === 0) return this.disband(party);
    if (party.members.length === 0) return this.disband(party);
    if (party.leader === key) {
      // The longest-standing member who is online, or simply the next.
      party.leader = party.members.find((k) => this.game.byKey.has(k)) ?? party.members[0];
      this.tellParty(party, `${this.who(party.leader).name} leads the party now`);
    }
    this.sendParty(party);
  }

  disband(party) {
    for (const key of party.members) {
      this.partyOf.delete(key);
      const member = this.game.byKey.get(key);
      if (member) {
        this.game.send(member.client, { t: 'party', party: null });
        if (party.members.length > 1 || party.waypoints.length) this.game.tell(member, 'The party is over', 'party');
      }
    }
    for (const key of party.invites.keys()) {
      const invitee = this.game.byKey.get(key);
      if (invitee) this.game.send(invitee.client, { t: 'partyInviteEnd', party: party.id, reason: 'over' });
    }
    this.parties.delete(party.id);
    this.game.saveServer();
  }

  setTogether(player, on) {
    const party = this.partyFor(player.key);
    if (!party) return this.game.tell(player, 'You are not in a party', 'error');
    if (on) party.together.add(player.key);
    else party.together.delete(player.key);
    this.game.tell(player, on
      ? 'You will teleport with the party leader'
      : 'You will stay put when the party leader teleports', 'party');
    this.sendParty(party);
  }

  /** Party chat. */
  say(player, text) {
    const party = this.partyFor(player.key);
    if (!party) return this.game.tell(player, 'You are not in a party — /party invite <name>', 'error');
    for (const key of party.members) {
      const member = this.game.byKey.get(key);
      if (member) this.game.send(member.client, { t: 'chat', kind: 'party', from: this.game.speaker(player), text });
    }
  }

  listParty(player) {
    const party = this.partyFor(player.key);
    if (!party) return this.game.tell(player, 'You are not in a party — /party invite <name>');
    const names = party.members.map((k) => {
      const w = this.who(k);
      return `${w.name}${k === party.leader ? ' (leader)' : ''}${w.online ? '' : ' (offline)'}`;
    });
    this.game.tell(player, `Party: ${names.join(', ')}`, 'party');
  }

  /* ------------------------------------------------- teleporting together */

  /**
   * The leader was sent somewhere: everyone in the party who ticked "teleport
   * with the party" comes along, in a ring round where the leader lands. Not
   * for a respawn, and not for somebody in a fight or dead — they are told.
   */
  follow(leader, to, reason) {
    if (reason === 'party' || reason === 'respawn' || reason === 'correct') return;
    const party = this.partyFor(leader.key);
    if (!party || party.leader !== leader.key) return;
    const world = to.world ?? leader.world;
    const radius = radiusOf(world);
    let n = 0;
    for (const key of party.members) {
      if (key === leader.key || !party.together.has(key)) continue;
      const member = this.game.byKey.get(key);
      if (!member) continue;
      if (member.dead) continue;
      if (this.game.inCombat(member)) {
        this.game.tell(member, `${leader.name} teleported, but you are in a fight — you stayed`, 'party');
        continue;
      }
      n += 1;
      const angle = (n / MAX_PARTY) * Math.PI * 2;
      const DEG = Math.PI / 180;
      const lat = to.lat + (Math.cos(angle) * RING_M) / radius / DEG;
      const lon = to.lon + (Math.sin(angle) * RING_M) / (radius * Math.max(0.05, Math.cos(to.lat * DEG))) / DEG;
      this.game.teleport(member, { world, lat, lon, alt: to.alt ?? null, yaw: to.yaw, flying: !!to.flying }, 'party');
      this.game.tell(member, `Teleported with ${leader.name}`, 'party');
    }
  }

  /** The leader brings everyone who ticked "teleport with the party" to them. */
  gather(player) {
    const party = this.partyFor(player.key);
    if (!party) return this.game.tell(player, 'You are not in a party', 'error');
    if (party.leader !== player.key) return this.game.tell(player, 'Only the party leader can gather the party', 'error');
    const s = player.state;
    if (!s || player.pending) return this.game.tell(player, 'Land first', 'error');
    if (player.dead) return this.game.tell(player, 'Respawn first', 'error');
    this.follow(player, { world: player.world, lat: s.lat, lon: s.lon, alt: s.alt, yaw: s.yaw, flying: !(s.flags & 1) }, 'gather');
    this.game.tell(player, 'Gathering the party', 'party');
  }

  /* ---------------------------------------------------- party waypoints */

  mark(player, m) {
    const party = this.partyFor(player.key);
    if (!party) return this.game.tell(player, 'You are not in a party', 'error');
    const lat = Number(m.lat ?? player.state?.lat);
    const lon = Number(m.lon ?? player.state?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 360) return;
    if (party.waypoints.length >= MAX_PARTY_WAYPOINTS) {
      return this.game.tell(player, `A party keeps ${MAX_PARTY_WAYPOINTS} waypoints at most — remove one`, 'error');
    }
    const name = String(m.name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || `${player.name}'s mark`;
    const point = {
      id: party.nextMark++,
      name,
      world: BODIES[m.world] ? m.world : player.world,
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round((((lon + 540) % 360) - 180) * 1e6) / 1e6,
      by: player.name,
      colour: player.colour,
      at: this.game.now(),
    };
    party.waypoints.push(point);
    this.tellParty(party, `${player.name} marked "${point.name}" for the party`);
    this.sendParty(party);
    this.game.saveServer();
  }

  unmark(player, m) {
    const party = this.partyFor(player.key);
    if (!party) return this.game.tell(player, 'You are not in a party', 'error');
    const id = Number(m.id);
    const wanted = String(m.name ?? '').trim().toLowerCase();
    const index = party.waypoints.findIndex((w) => w.id === id || (wanted && w.name.toLowerCase() === wanted));
    if (index < 0) return this.game.tell(player, 'No party waypoint like that', 'error');
    const [gone] = party.waypoints.splice(index, 1);
    this.tellParty(party, `${player.name} removed "${gone.name}"`);
    this.sendParty(party);
    this.game.saveServer();
  }

  /* ------------------------------------------------------------- upkeep */

  tick(now) {
    for (const party of [...this.parties.values()]) {
      for (const [key, invite] of [...party.invites]) {
        if (now >= invite.expires) this.endInvite(invite.by, key, 'expired', party);
      }
      if (!this.parties.has(party.id)) continue;
      const anyone = party.members.some((k) => this.game.byKey.has(k));
      if (anyone) party.idleSince = null;
      else if (party.idleSince == null) party.idleSince = now;
      else if (now - party.idleSince > PARTY_IDLE_MS) this.disband(party);
    }
  }

  /** What is kept in server.json. Invitations are not: they last a minute. */
  toJSON() {
    return [...this.parties.values()].map((p) => ({
      id: p.id,
      leader: p.leader,
      members: p.members,
      together: [...p.together],
      waypoints: p.waypoints,
      nextMark: p.nextMark,
    }));
  }

  restore(saved) {
    const members = Array.isArray(saved?.members) ? saved.members.filter((k) => typeof k === 'string').slice(0, MAX_PARTY) : [];
    if (members.length < 2 && !(saved?.waypoints?.length)) return;
    const id = Number(saved.id) || this.nextParty;
    const party = {
      id,
      leader: members.includes(saved.leader) ? saved.leader : members[0],
      members,
      together: new Set((saved.together ?? []).filter((k) => members.includes(k))),
      invites: new Map(),
      waypoints: Array.isArray(saved.waypoints) ? saved.waypoints.slice(0, MAX_PARTY_WAYPOINTS) : [],
      nextMark: Number(saved.nextMark) || 1,
      idleSince: Date.now(),
    };
    this.parties.set(id, party);
    for (const key of members) this.partyOf.set(key, id);
    this.nextParty = Math.max(this.nextParty, id + 1);
  }
}

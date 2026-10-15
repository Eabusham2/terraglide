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
import { FLAG, TPA_COOLDOWN_S, nameKey } from '../src/net/protocol.js';
import { MAX_WAYPOINTS, radiusOf } from './records.mjs';

export const MAX_FRIENDS = 100;
const MAX_PENDING = 50;
export const MAX_PARTY = 8;
export const PARTY_INVITE_S = 60;
export const MAX_PARTY_WAYPOINTS = 50;
/** A party nobody has been online in for this long is wound up. */
const PARTY_IDLE_MS = 30 * 60 * 1000;
/** How far apart members land when they arrive together, metres. */
const RING_M = 4;
/** A leader offline this long hands the party to a member who is on. */
const LEADER_AWAY_MS = 90 * 1000;
/** Notes kept for somebody who was away when they were removed from a party. */
const MAX_NOTICES = 10;
/** The kinds of line a notice may be told as. */
const NOTICE_KINDS = ['friend', 'party', 'system'];
/** Seconds between one gather and the next. */
const GATHER_COOLDOWN_S = 10;
/** After a no, how long before the same person may ask to be friends again. */
const DENIED_MS = 10 * 60 * 1000;

const DEFAULT_PREFS = Object.freeze({ autoTpa: false, autoParty: false, autoFriends: false, notify: true });

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
      // Said when they next sign in: what happened to them while they were away.
      // Each with the kind of line it is told as, so a friend's is a friend's
      // notice and follows Friend notifications. A plain string is an older
      // record's: a friend's when it reads like one, otherwise a party's.
      notices: (Array.isArray(s.notices) ? s.notices : [])
        .map((n) => (typeof n === 'string' ? { text: n, kind: /friend request|became your friend/.test(n) ? 'friend' : 'party' }
          : n && typeof n.text === 'string' ? { text: n.text.slice(0, 300), kind: NOTICE_KINDS.includes(n.kind) ? n.kind : 'party' } : null))
        .filter(Boolean).slice(-MAX_NOTICES),
      // Who this player said no to, and when: they wait a while to ask again.
      denied: Object.fromEntries(Object.entries(s.denied && typeof s.denied === 'object' ? s.denied : {})
        .filter(([k, at]) => typeof k === 'string' && Number.isFinite(at) && Date.now() - at < DENIED_MS)
        .slice(-MAX_PENDING)),
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
      world: online?.world ?? this.game.worldOf(key),
      id: online?.id ?? null,
    };
  }

  /** An account by name, online or off, for friend requests. */
  account(name) {
    const key = nameKey(String(name ?? ''));
    if (!key) return null;
    // The account of exactly that name first. Asking who is online first
    // took "Ben" to mean Benji whenever Benji was on and Ben was not - so
    // removing Ben removed Benji.
    if (this.game.accounts.get(key)) return key;
    return this.game.findPlayer(name)?.key ?? null;
  }

  /** Somebody in one of your lists by name: the exact one, else the only one it begins. */
  inList(list, name) {
    const key = nameKey(String(name ?? ''));
    if (!key) return null;
    if (list.includes(key)) return key;
    const starts = list.filter((k) => k.startsWith(key));
    return starts.length === 1 ? starts[0] : null;
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
    if (Date.now() - (theirs.denied[player.key] ?? -Infinity) < DENIED_MS) {
      return this.game.tell(player, `${them.name} said no not long ago — ask again later`, 'error');
    }
    if (mine.friends.length >= MAX_FRIENDS) return this.game.tell(player, `That is ${MAX_FRIENDS} friends — remove one first`, 'error');
    // Said here rather than as a request they could never accept.
    if (theirs.friends.length >= MAX_FRIENDS) {
      return this.game.tell(player, `${them.name} has as many friends as there is room for`, 'error');
    }
    // They take every request without being asked (Settings → Online): friends
    // at once, and both told - them when they are next on, if they are not.
    // Before "already asked", so asking again after they switched it on works.
    if (theirs.prefs.autoFriends) {
      this.befriend(player.key, key);
      return;
    }
    // Asked already: once is a request, the twelfth is spam.
    if (mine.outgoing.includes(key) && theirs.incoming.includes(player.key)) {
      return this.game.tell(player, `Already asked — waiting for ${them.name} to answer`, 'error');
    }
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
    const key = name ? this.inList(mine.incoming, name) : mine.incoming[mine.incoming.length - 1];
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
    else {
      // Away: told when they are back, not never.
      theirs.notices.push({ text: `${player.name} accepted your friend request — you are friends`, kind: 'friend' });
      this.save(key);
    }
    this.sendFriends(player.key);
    this.sendFriends(key);
  }

  denyFriend(player, name) {
    const mine = this.social(player.key);
    const key = name ? this.inList(mine.incoming, name) : mine.incoming[mine.incoming.length - 1];
    if (!key || !mine.incoming.includes(key)) {
      return this.game.tell(player, name ? `No friend request from ${String(name).slice(0, 32)}` : 'No friend requests', 'error');
    }
    mine.incoming = mine.incoming.filter((k) => k !== key);
    mine.denied[key] = Date.now();
    const theirs = this.social(key);
    theirs.outgoing = theirs.outgoing.filter((k) => k !== player.key);
    this.save(player.key);
    this.save(key);
    this.game.tell(player, `Turned down ${this.who(key).name}`);
    this.sendFriends(player.key);
    this.sendFriends(key);
  }

  removeFriend(player, name) {
    const mine = this.social(player.key);
    const key = this.inList([...mine.friends, ...mine.outgoing], name);
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
    const was = s.prefs.autoFriends;
    // Only the choices the page sends: it sends the ones changed on it, and
    // the rest stay as the account has them.
    const pick = (name) => (typeof m[name] === 'boolean' ? m[name] : s.prefs[name]);
    s.prefs = {
      autoTpa: !!pick('autoTpa'),
      autoParty: !!pick('autoParty'),
      autoFriends: !!pick('autoFriends'),
      notify: pick('notify') !== false,
    };
    this.save(player.key);
    // Switching it on answers whoever is already waiting, as it would have
    // had it been on when they asked - and says so for one it cannot.
    if (s.prefs.autoFriends && !was) {
      for (const key of [...s.incoming]) {
        if (this.befriend(key, player.key)) continue;
        // Whichever of the two is full, said as it is.
        const name = this.who(key).name;
        this.game.tell(player, s.friends.length >= MAX_FRIENDS
          ? `Your friends list is full — ${name}'s request is still waiting`
          : `${name} has as many friends as there is room for — their request is still waiting`, 'friend');
      }
    }
    // And the page is told what was kept. The lists it was sent on signing in
    // carry the old choices and can arrive after it sent its new ones, and it
    // took those as the account's word - switching itself back.
    this.sendFriends(player.key);
  }

  /**
   * Friends at once, because `toKey` takes requests without being asked
   * (Settings → Online). Both are told - whoever is away, when they are next
   * on. False if either has no room.
   */
  befriend(fromKey, toKey) {
    const mine = this.social(fromKey);
    const theirs = this.social(toKey);
    if (mine.friends.length >= MAX_FRIENDS || theirs.friends.length >= MAX_FRIENDS) return false;
    mine.outgoing = mine.outgoing.filter((k) => k !== toKey);
    mine.incoming = mine.incoming.filter((k) => k !== toKey);
    theirs.incoming = theirs.incoming.filter((k) => k !== fromKey);
    theirs.outgoing = theirs.outgoing.filter((k) => k !== fromKey);
    if (!mine.friends.includes(toKey)) mine.friends.push(toKey);
    if (!theirs.friends.includes(fromKey)) theirs.friends.push(fromKey);
    const asker = this.who(fromKey);
    const taker = this.who(toKey);
    const takerOnline = this.game.byKey.get(toKey);
    if (takerOnline) this.game.tell(takerOnline, `${asker.name} is your friend now — you accept friend requests automatically`, 'friend');
    else theirs.notices.push({ text: `${asker.name} became your friend while you were away — you accept friend requests automatically`, kind: 'friend' });
    const askerOnline = this.game.byKey.get(fromKey);
    if (askerOnline) this.game.tell(askerOnline, `You and ${taker.name} are friends — they accept requests automatically`, 'friend');
    else mine.notices.push({ text: `${taker.name} accepted your friend request — you are friends`, kind: 'friend' });
    this.save(fromKey);
    this.save(toKey);
    this.sendFriends(fromKey);
    this.sendFriends(toKey);
    return true;
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
    if (s.notices.length) {
      for (const notice of s.notices) this.game.tell(player, notice.text, notice.kind);
      s.notices = [];
      this.save(player.key);
    }
    const party = this.partyFor(player.key);
    if (party) {
      party.idleSince = null;
      if (party.leader === player.key) party.leaderAwaySince = null;
      this.sendParty(party);
    } else {
      // Always said, so a page that kept a party through a dropped connection
      // - one that ended while it was away - lets go of it.
      this.game.send(player.client, { t: 'party', party: null });
    }
    // Invitations still waiting, again: they outlive a reload or a trip to
    // another world, which they used to end.
    const now = this.game.now();
    for (const [by, party] of this.invitesTo(player.key)) {
      const invite = party.invites.get(player.key);
      const from = this.game.byKey.get(by) ?? null;
      this.game.send(player.client, {
        t: 'partyInvite',
        party: party.id,
        from: { id: from?.id ?? null, key: by, name: this.who(by).name, colour: this.who(by).colour, world: this.game.worldOf(by) },
        expiresIn: Math.max(1, Math.round((invite.expires - now) / 1000)),
      });
    }
    for (const key of s.friends) {
      const friend = this.game.byKey.get(key);
      if (!friend) continue;
      // Their list says where you are now - after a trip to another world
      // too, which is a quiet join; only the "is online" line waits on that.
      this.sendFriends(key);
      if (quiet) continue;
      if (this.social(key).prefs.notify) {
        this.game.tell(friend, `${player.name} is online${player.world !== 'earth' ? ` — on ${BODIES[player.world].name}` : ''}`, 'friend');
      }
    }
  }

  onLeave(player, { quiet = false } = {}) {
    // Invitations to them are left to run out, not ended: a reload, or a trip
    // to another world, is not saying no. See onJoin.
    const party = this.partyFor(player.key);
    if (party) {
      if (party.leader === player.key) party.leaderAwaySince = this.game.now();
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
@@MISSING 443@@
@@MISSING 444@@
@@MISSING 445@@
@@MISSING 446@@
@@MISSING 447@@
@@MISSING 448@@
@@MISSING 449@@
@@MISSING 450@@
@@MISSING 451@@
@@MISSING 452@@
@@MISSING 453@@
@@MISSING 454@@
@@MISSING 455@@
@@MISSING 456@@
@@MISSING 457@@
@@MISSING 458@@
@@MISSING 459@@
@@MISSING 460@@
@@MISSING 461@@
@@MISSING 462@@
@@MISSING 463@@
@@MISSING 464@@
@@MISSING 465@@
@@MISSING 466@@
@@MISSING 467@@
@@MISSING 468@@
@@MISSING 469@@
@@MISSING 470@@
@@MISSING 471@@
@@MISSING 472@@
@@MISSING 473@@
@@MISSING 474@@
@@MISSING 475@@
@@MISSING 476@@
@@MISSING 477@@
@@MISSING 478@@
@@MISSING 479@@
@@MISSING 480@@
@@MISSING 481@@
@@MISSING 482@@
@@MISSING 483@@
@@MISSING 484@@
@@MISSING 485@@
@@MISSING 486@@
@@MISSING 487@@
@@MISSING 488@@
@@MISSING 489@@
@@MISSING 490@@
@@MISSING 491@@
    if (theirs.prefs.autoParty && theirs.friends.includes(player.key)) {
@@MISSING 493@@
@@MISSING 494@@
@@MISSING 495@@
@@MISSING 496@@
@@MISSING 497@@
@@MISSING 498@@
@@MISSING 499@@
@@MISSING 500@@
@@MISSING 501@@
@@MISSING 502@@
@@MISSING 503@@
@@MISSING 504@@
@@MISSING 505@@
@@MISSING 506@@
@@MISSING 507@@
@@MISSING 508@@
@@MISSING 509@@
@@MISSING 510@@
@@MISSING 511@@
@@MISSING 512@@
@@MISSING 513@@
@@MISSING 514@@
@@MISSING 515@@
@@MISSING 516@@
@@MISSING 517@@
@@MISSING 518@@
@@MISSING 519@@
@@MISSING 520@@
@@MISSING 521@@
@@MISSING 522@@
@@MISSING 523@@
@@MISSING 524@@
@@MISSING 525@@
@@MISSING 526@@
@@MISSING 527@@
@@MISSING 528@@
@@MISSING 529@@
@@MISSING 530@@
@@MISSING 531@@
@@MISSING 532@@
@@MISSING 533@@
@@MISSING 534@@
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
@@MISSING 547@@
      case 'social': return this.onSocial(player, m);
@@MISSING 549@@
@@MISSING 550@@
@@MISSING 551@@
@@MISSING 552@@
@@MISSING 553@@
@@MISSING 554@@
      // away lets go of it when its Leave button is pressed.
@@MISSING 556@@
@@MISSING 557@@
@@MISSING 558@@
@@MISSING 559@@
@@MISSING 560@@
@@MISSING 561@@
@@MISSING 562@@
@@MISSING 563@@
@@MISSING 564@@
@@MISSING 565@@
@@MISSING 566@@
@@MISSING 567@@
@@MISSING 568@@
@@MISSING 569@@
@@MISSING 570@@
@@MISSING 571@@
@@MISSING 572@@
@@MISSING 573@@
@@MISSING 574@@
@@MISSING 575@@
@@MISSING 576@@
@@MISSING 577@@
@@MISSING 578@@
@@MISSING 579@@
      this.social(key).notices.push(`${player.name} removed you from the party while you were away`);
@@MISSING 581@@
@@MISSING 582@@
@@MISSING 583@@
@@MISSING 584@@
@@MISSING 585@@
@@MISSING 586@@
@@MISSING 587@@
@@MISSING 588@@
@@MISSING 589@@
@@MISSING 590@@
@@MISSING 591@@
@@MISSING 592@@
@@MISSING 593@@
@@MISSING 594@@
    // gather or remove anybody until they came back.
@@MISSING 596@@
@@MISSING 597@@
@@MISSING 598@@
@@MISSING 599@@
@@MISSING 600@@
@@MISSING 601@@
@@MISSING 602@@
@@MISSING 603@@
@@MISSING 604@@
@@MISSING 605@@
    party.together.delete(key);
@@MISSING 607@@
@@MISSING 608@@
@@MISSING 609@@
@@MISSING 610@@
@@MISSING 611@@
@@MISSING 612@@
@@MISSING 613@@
@@MISSING 614@@
@@MISSING 615@@
@@MISSING 616@@
@@MISSING 617@@
@@MISSING 618@@
    // The party's waypoints are not thrown away with it: everybody who was in
@@MISSING 620@@
@@MISSING 621@@
@@MISSING 622@@
@@MISSING 623@@
@@MISSING 624@@
@@MISSING 625@@
@@MISSING 626@@
@@MISSING 627@@
@@MISSING 628@@
@@MISSING 629@@
@@MISSING 630@@
@@MISSING 631@@
@@MISSING 632@@
@@MISSING 633@@
@@MISSING 634@@
@@MISSING 635@@
@@MISSING 636@@
@@MISSING 637@@
@@MISSING 638@@
@@MISSING 639@@
@@MISSING 640@@
@@MISSING 641@@
@@MISSING 642@@
    if (on) party.together.add(player.key);
    else party.together.delete(player.key);
@@MISSING 645@@
@@MISSING 646@@
@@MISSING 647@@
@@MISSING 648@@
@@MISSING 649@@
@@MISSING 650@@
@@MISSING 651@@
@@MISSING 652@@
@@MISSING 653@@
@@MISSING 654@@
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
    // Visiting somebody is visiting them, not bringing a war band: they said
    // yes to one player. Only when the one visited is in the party too.
    if (reason === 'tpa' && !(to.host && party.members.includes(to.host))) return;
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
      this.game.teleport(member, { world, lat, lon, alt: to.alt ?? null, ceiling: to.ceiling, yaw: to.yaw, flying: !!to.flying }, 'party');
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
    // Not out of a fight: no teleport is, and this one brings seven.
    if (this.game.inCombat(player)) return this.game.tell(player, 'Not in the middle of a fight', 'error');
    // Nor over and over: each one is a teleport for everybody, and nobody can
    // be hit on the way, so a gather a second kept a whole party untouchable.
    const now = this.game.now();
    const wait = GATHER_COOLDOWN_S - (now - (party.gatheredAt ?? -Infinity)) / 1000;
    if (wait > 0) return this.game.tell(player, `Gathered just now — again in ${Math.ceil(wait)} s`, 'error');
    party.gatheredAt = now;
    this.follow(player, { world: player.world, lat: s.lat, lon: s.lon, alt: s.alt, ceiling: Math.min(player.ceiling, s.alt), yaw: s.yaw, flying: !(s.flags & FLAG.ground) }, 'gather');
    this.game.tell(player, 'Gathering the party', 'party');
  }

  /* ---------------------------------------------------- party waypoints */

  /**
   * Party waypoint changes, a few a second at most: each one is a notice and
   * a whole party view to every member, and two hundred of them in a second
   * buried a party in both.
   */
  marking(player) {
    const now = this.game.now();
    player.markTimes = (player.markTimes ?? []).filter((t) => now - t < 4000);
    if (player.markTimes.length >= 6) {
      this.game.tell(player, 'Slow down a little', 'error');
      return false;
    }
    player.markTimes.push(now);
    return true;
  }

  mark(player, m) {
    const party = this.partyFor(player.key);
    if (!party) return this.game.tell(player, 'You are not in a party', 'error');
    if (!this.marking(player)) return;
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
      world: typeof m.world === 'string' && Object.hasOwn(BODIES, m.world) ? m.world : player.world,
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
    if (!this.marking(player)) return;
    const id = Number(m.id);
    const wanted = String(m.name ?? '').trim().toLowerCase();
    const index = party.waypoints.findIndex((w) => w.id === id || (wanted && w.name.toLowerCase() === wanted));
    if (index < 0) return this.game.tell(player, 'No party waypoint like that', 'error');
    const [gone] = party.waypoints.splice(index, 1);
    this.tellParty(party, `${player.name} removed "${gone.name}"`);
    this.sendParty(party);
    this.game.saveServer();
  }

  /**
   * A party's waypoints, into each member's own: the ones online get them
   * on their page now (which then keeps them like any other), the ones
   * away find them there when they next sign in on that world.
@@MISSING 791@@
@@MISSING 792@@
@@MISSING 793@@
@@MISSING 794@@
@@MISSING 795@@
@@MISSING 796@@
@@MISSING 797@@
@@MISSING 798@@
@@MISSING 799@@
@@MISSING 800@@
@@MISSING 801@@
@@MISSING 802@@
@@MISSING 803@@
@@MISSING 804@@
@@MISSING 805@@
@@MISSING 806@@
@@MISSING 807@@
@@MISSING 808@@
@@MISSING 809@@
@@MISSING 810@@
@@MISSING 811@@
@@MISSING 812@@
        this.social(key).notices.push(said);
@@MISSING 814@@
@@MISSING 815@@
@@MISSING 816@@
@@MISSING 817@@
@@MISSING 818@@
@@MISSING 819@@
@@MISSING 820@@
@@MISSING 821@@
@@MISSING 822@@
@@MISSING 823@@
@@MISSING 824@@
@@MISSING 825@@
@@MISSING 826@@
@@MISSING 827@@
      // is on, so the rest can still invite, gather and remove.
@@MISSING 829@@
@@MISSING 830@@
@@MISSING 831@@
@@MISSING 832@@
@@MISSING 833@@
          this.tellParty(party, `${this.who(party.leader).name} leads the party now — the leader has been away a while`);
@@MISSING 835@@
@@MISSING 836@@
@@MISSING 837@@
@@MISSING 838@@
@@MISSING 839@@
@@MISSING 840@@
@@MISSING 841@@
@@MISSING 842@@
@@MISSING 843@@
@@MISSING 844@@
@@MISSING 845@@
@@MISSING 846@@
@@MISSING 847@@
@@MISSING 848@@
@@MISSING 849@@
@@MISSING 850@@
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
      joined: true,
      idleSince: this.game.now(),
    };
    this.parties.set(id, party);
    for (const key of members) this.partyOf.set(key, id);
    this.nextParty = Math.max(this.nextParty, id + 1);
  }
}

/**
 * The anti-cheat's book: what each account has done that no page can do,
 * how much of it is still held against them, the kicks it has cost them and
 * the bans that came of those - and a log of it all for whoever runs the
 * server.
 *
 * What counts is decided in game.mjs (detect), one rule at a time, and only
 * for things the game's own page never sends: a modified page or a script
 * is the only thing that can. What an honest page under a bad connection
 * can be refused for - a stall, a burst, a double click, a tab switch, a
 * reconnect - is refused there as it always was and counts for nothing here,
 * with one exception kept as it was before: a move refused as too fast, which
 * a page put back counts once for (and pays off with every move it makes
 * after), exactly as the per-connection count of them did.
 *
 * The score is the account's, not the connection's. A connection's count of
 * refused moves started again at nought with every reconnect, so a page
 * could reconnect once every thirty-nine of them and never be let go; now
 * it survives a reconnect, a second tab, a trip to another world and a
 * restart (cheats.json, beside the bans in server.json). It also fades with
 * time, by half every half hour, so a rare put-back from a bad evening is
 * gone by the next: nothing an honest player does piles up over days.
 *
 *   data/cheats.json      per account: what is held against it, by kind;
 *                         the kicks of the last week; a timed ban. Per
 *                         address: the kicks from it in the last week, which
 *                         a new account made there starts with
 *   data/anticheat.log    one JSON line per kick, ban, pardon and (at most
 *                         once in ten seconds per account and kind) each
 *                         kind of impossible thing, with how many and the
 *                         numbers; past a megabyte it is moved to
 *                         anticheat.log.1, so it never takes more than two
 */

import { closeSync, existsSync, openSync, readSync, renameSync, statSync, appendFileSync } from 'node:fs';

/**
 * Every kind of impossible thing, what one costs, and how the kick says it.
 * The words finish "Kicked for ...", so they say what was impossible.
 *
 * A move refused as too fast is one, as it always was - forty of them in a
 * row, with good moves paying them off a twentieth at a time, are what
 * disconnected a page before. Everything else no page sends at all, so it
 * costs more: a few of any of them and the page is let go. See game.mjs,
 * detect, for where each is found and why an honest page never does it.
 */
export const CHEATS = {
  speed: { weight: 1, says: 'moving impossibly fast' },
  arrival: { weight: 5, says: 'arriving somewhere it was not sent' },
  state: { weight: 2, says: 'sending positions no page sends' },
  flags: { weight: 2, says: 'claiming to be dead or hurt' },
  target: { weight: 2, says: 'hitting somebody who is not there' },
  swingless: { weight: 3, says: 'hitting without swinging' },
  swordless: { weight: 3, says: 'hitting without a sword in hand' },
  reach: { weight: 4, says: 'hitting from out of reach' },
  selfDamage: { weight: 2, says: 'hurting itself in ways the game does not' },
  rockets: { weight: 2, says: 'claiming rockets nobody can carry' },
  message: { weight: 1, says: 'sending messages no page sends' },
};

/** The score at which a page is let go: what forty refused moves always came to. */
export const KICK_AT = 40;
/** What is held against an account halves this often. */
export const HALF_LIFE_MS = 30 * 60 * 1000;
/** How long a kick is remembered, for the bans repeated ones bring. */
export const STRIKE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * The ban each kick in a week brings: none for the first, then a quarter of
 * an hour, an hour, and a day for every one after.
 *
 * The first costs nothing but signing in again, which a page someone has
 * modified does by itself and the game's own does not (a kick stops it
 * reconnecting): if one ever came of a mistake in a rule, nobody is hurt by
 * it. The second is at least eighty impossible things in a week, which is
 * nobody's bad connection. And none is longer than a day. An automatic ban
 * has no person behind it to ask, so it is short; anything longer is a
 * decision for an admin, who is told of every kick and ban it makes and has
 * /ban for good.
 */
export const BAN_STEPS_MS = [0, 15 * 60 * 1000, 60 * 60 * 1000, 24 * 60 * 60 * 1000];
/** One line per account and kind this often at most; the ones between are counted into the next. */
const LOG_EVERY_MS = 10000;
/** Lines a minute at most, whoever they are about; the rest are counted in one line. */
const LOG_PER_MINUTE = 120;
/**
 * Of those, floods at most. They are never counted against anybody - a
 * person can make every one of them - so any number of accounts can make
 * them for as long as they like, and forty-five of them flooding chat, the
 * players panel, map overlays and voice were two hundred lines a minute:
 * every line the log had, the kicks among them. Kicks, bans and pardons are
 * never the lines left out (see log).
 */
const FLOODS_PER_MINUTE = 20;
/** Written whatever else the minute has had: what an admin looks in the log for. There are only as many as there are kicks. */
const ALWAYS_LOGGED = new Set(['kick', 'pardon', 'unban']);
/** Past this the log is moved aside, once, so the two together never pass twice it. */
const LOG_MAX_BYTES = 1024 * 1024;
/** Lines kept in memory for /cheats. */
const RECENT = 200;
/** A flood is logged this often at most per account and kind. */
const FLOOD_EVERY_MS = 60000;

export class AntiCheat {
  /**
   * @param {object} deps
   * @param {import('./store.mjs').Store} deps.store
   * @param {() => number} deps.now
   */
  constructor({ store, now }) {
    this.store = store;
    this.now = now;
    /**
     * key -> { name, kinds: {kind: score}, at, strikes: [time], carried: [time],
     * ban: {until, reason, address, at} | null }. `carried` are the kicks from
     * the address the account was made on, in the week before it was (inherit).
     */
    this.book = new Map();
    /** address -> [{ at, key }]: the anti-cheat's kicks from it in the last week. See kickedFrom. */
    this.addresses = new Map();
    const saved = store.read('cheats.json', {});
    for (const [key, raw] of Object.entries(saved?.accounts && typeof saved.accounts === 'object' ? saved.accounts : {})) {
      const entry = clean(raw);
      if (entry) this.book.set(key, entry);
    }
    for (const [address, raw] of Object.entries(saved?.addresses && typeof saved.addresses === 'object' ? saved.addresses : {})) {
      const kicks = (Array.isArray(raw) ? raw : [])
        .filter((k) => k && Number.isFinite(k.at) && typeof k.key === 'string').map((k) => ({ at: k.at, key: k.key })).slice(-100);
      if (kicks.length) this.addresses.set(address, kicks);
    }
    this.logFile = store.path('anticheat.log');
    this.logBytes = existsSync(this.logFile) ? statSync(this.logFile).size : 0;
    /** account|kind -> what is waiting to be logged: see note. */
    this.waiting = new Map();
    this.minute = { at: 0, lines: 0, floods: 0, dropped: 0 };
    this.recent = readTail(this.logFile, RECENT);
  }

  /** One account's entry, faded to now. Made if `make`. */
  entry(key, make = false) {
    let entry = this.book.get(key);
    if (!entry) {
      if (!make) return null;
      entry = { name: key, kinds: {}, at: this.now(), strikes: [], carried: [], ban: null };
      this.book.set(key, entry);
    }
    const now = this.now();
    if (now > entry.at) {
      const kept = 0.5 ** ((now - entry.at) / HALF_LIFE_MS);
      for (const kind of Object.keys(entry.kinds)) {
        entry.kinds[kind] *= kept;
        if (entry.kinds[kind] < 0.001) delete entry.kinds[kind];
      }
      entry.at = now;
    }
    entry.strikes = entry.strikes.filter((t) => now - t < STRIKE_MS);
    entry.carried = (entry.carried ?? []).filter((t) => now - t < STRIKE_MS);
    if (entry.ban && !(entry.ban.until > now)) entry.ban = null;
    return entry;
  }

  /** What is held against an account now, all kinds together. */
  score(key) {
    const entry = this.entry(key);
    return entry ? total(entry) : 0;
  }

  /** Something impossible, `weight` of it. The account's score after it. */
  add(key, name, kind, weight) {
    const entry = this.entry(key, true);
    entry.name = name;
    entry.kinds[kind] = (entry.kinds[kind] ?? 0) + weight;
    this.save();
    return total(entry);
  }

  /** Paid off: a move accepted takes a twentieth of a refused one away, as it always did. */
  relieve(key, kind, amount) {
    if (!(this.book.get(key)?.kinds[kind] > 0)) return;
    const entry = this.entry(key);
    if (!(entry.kinds[kind] > 0)) return;
    entry.kinds[kind] = Math.max(0, entry.kinds[kind] - amount);
    if (entry.kinds[kind] === 0) delete entry.kinds[kind];
    this.save();
  }

  /**
   * A kick: the score starts again from nothing, and the kick is remembered
   * for a week. How many there have been in that week, this one included -
   * and the ones the account started with from its address (inherit).
   */
  strike(key) {
    const entry = this.entry(key, true);
    entry.kinds = {};
    entry.strikes.push(this.now());
    this.save();
    return entry.strikes.length + entry.carried.length;
  }

  /**
   * A kick from an address, remembered for a week for the next new account
   * made there. Only an address that is the kicked page's own - see
   * cheatKick in game.mjs: not one somebody else online is on, nor the
   * machine's.
   */
  kickedFrom(address, key) {
    if (!address) return;
    const now = this.now();
    const kicks = (this.addresses.get(address) ?? []).filter((k) => now - k.at < STRIKE_MS);
    kicks.push({ at: now, key });
    this.addresses.set(address, kicks.slice(-100));
    this.save();
  }

  /**
   * A new account, made from `address`: it starts with the kicks from there
   * in the last week. A new account is free, and the first kick of one only
   * a kick - so a script that signed up anew after every kick was never
   * banned, and its address never held, however often it was let go. Only
   * new accounts: nobody who already plays from there carries anything.
   */
  inherit(key, address) {
    const now = this.now();
    const kicks = (this.addresses.get(address) ?? []).filter((k) => now - k.at < STRIKE_MS && k.key !== key);
    if (!kicks.length) return 0;
    const entry = this.entry(key, true);
    entry.carried = kicks.map((k) => k.at);
    this.save();
    return kicks.length;
  }

  ban(key, { until, reason, address }) {
    const entry = this.entry(key, true);
    entry.ban = { until, reason, address: address ?? null, at: this.now() };
    this.save();
  }

  /** The account's ban, if it has one still running. */
  banOf(key) {
    return this.entry(key)?.ban ?? null;
  }

  /** A ban still running that holds new accounts from this address. */
  heldAddress(address) {
    if (!address) return null;
    let held = null;
    for (const key of this.book.keys()) {
      const ban = this.entry(key)?.ban;
      if (ban?.address === address && (!held || ban.until > held.until)) held = ban;
    }
    return held;
  }

  /** Lift a timed ban, keeping the rest. Whether there was one. */
  unban(key) {
    const entry = this.entry(key);
    if (!entry?.ban) return false;
    entry.ban = null;
    this.save();
    return true;
  }

  /**
   * Everything held against an account, gone - its kicks on its address too,
   * which the next new account there would otherwise start with. Whether
   * there was anything.
   */
  pardon(key) {
    const entry = this.entry(key);
    const had = !!entry && (total(entry) > 0.01 || entry.strikes.length > 0 || entry.carried.length > 0 || !!entry.ban);
    this.book.delete(key);
    for (const [address, kicks] of this.addresses) {
      const left = kicks.filter((k) => k.key !== key);
      if (left.length) this.addresses.set(address, left);
      else this.addresses.delete(address);
    }
    this.save();
    return had;
  }

  /** Accounts with nothing left against them leave the book, and addresses with no kick this week. */
  prune() {
    let gone = 0;
    for (const key of [...this.book.keys()]) {
      const entry = this.entry(key);
      if (total(entry) < 0.01 && !entry.strikes.length && !entry.carried.length && !entry.ban) {
        this.book.delete(key);
        gone += 1;
      }
    }
    const now = this.now();
    for (const [address, kicks] of this.addresses) {
      const left = kicks.filter((k) => now - k.at < STRIKE_MS);
      if (left.length === kicks.length) continue;
      if (left.length) this.addresses.set(address, left);
      else this.addresses.delete(address);
      gone += 1;
    }
    if (gone) this.save();
  }

  save() {
    this.store.mark('cheats.json', () => this.toJSON());
  }

  toJSON() {
    return { version: 1, accounts: Object.fromEntries(this.book), addresses: Object.fromEntries(this.addresses) };
  }

  /* ---------------------------------------------------------------- log */

  /**
   * One impossible thing, for the log: written now if it is the first of its
   * kind from that account for ten seconds, otherwise counted into the line
   * that goes out when they are up (flushNotes), with how many there were and
   * what they came to. A page sending one in every state is a line every ten
   * seconds, not ten a second.
   */
  note(kind, { key, name, weight, score, ...detail }) {
    const id = `${key}|${kind}`;
    const now = this.now();
    let waiting = this.waiting.get(id);
    if (!waiting) {
      this.waiting.set(id, (waiting = { at: -Infinity, n: 0, weight: 0, kind, key, name, score, detail }));
    }
    waiting.n += 1;
    waiting.weight += weight;
    waiting.score = score;
    waiting.detail = detail;
    if (now - waiting.at >= LOG_EVERY_MS) this.flushNote(id, waiting, now);
  }

  /** Floods are not counted against anybody - honest pages make them too - only logged, once a minute. */
  flood(kind, { key, name, ...detail }) {
    const id = `${key}|flood:${kind}`;
    const now = this.now();
    const waiting = this.waiting.get(id) ?? { at: -Infinity, n: 0, weight: 0, kind: 'flood', what: kind, key, name, detail, every: FLOOD_EVERY_MS };
    waiting.n += 1;
    waiting.detail = detail;
    this.waiting.set(id, waiting);
    if (now - waiting.at >= FLOOD_EVERY_MS) this.flushNote(id, waiting, now);
  }

  flushNote(id, waiting, now) {
    if (waiting.n > 0) {
      const line = { kind: waiting.kind, name: waiting.name, key: waiting.key };
      if (waiting.what) line.what = waiting.what;
      line.n = waiting.n;
      if (waiting.kind !== 'flood') {
        line.weight = round(waiting.weight);
        line.score = round(waiting.score);
      }
      if (waiting.detail && Object.keys(waiting.detail).length) line.detail = waiting.detail;
      this.log(line);
    }
    waiting.at = now;
    waiting.n = 0;
    waiting.weight = 0;
  }

  /**
   * What has been waiting its ten seconds goes out - everything, `all`, as
   * the server stops - and what has been quiet a while is forgotten.
   */
  flushNotes(all = false) {
    const now = this.now();
    for (const [id, waiting] of this.waiting) {
      const every = waiting.every ?? LOG_EVERY_MS;
      if (waiting.n > 0 && (all || now - waiting.at >= every)) this.flushNote(id, waiting, now);
      else if (waiting.n === 0 && now - waiting.at >= every) this.waiting.delete(id);
    }
  }

  /**
   * A line in the log, and in what /cheats shows. At most LOG_PER_MINUTE a
   * minute however many accounts there are, floods no more than
   * FLOODS_PER_MINUTE of them - the rest are counted, and the count is the
   * next line - and the file is moved aside past LOG_MAX_BYTES, so a stream
   * of new accounts doing impossible things cannot fill the disk. Except a
   * kick, a ban or a pardon, which is always written: otherwise accounts
   * doing nothing counted against them could keep the one that mattered out
   * of the log. Floods are in the file only, not in what /cheats keeps: they
   * pushed everything else out of it.
   */
  log(line) {
    const now = this.now();
    const entry = { at: new Date(now).toISOString(), ...line };
    const flood = line.kind === 'flood';
    if (!flood) {
      this.recent.push(entry);
      if (this.recent.length > RECENT) this.recent.splice(0, this.recent.length - RECENT);
    }
    if (now - this.minute.at >= 60000) {
      const dropped = this.minute.dropped;
      this.minute = { at: now, lines: 0, floods: 0, dropped: 0 };
      if (dropped) this.write({ at: entry.at, kind: 'dropped', n: dropped });
    }
    if (!ALWAYS_LOGGED.has(line.kind)) {
      if (this.minute.lines >= LOG_PER_MINUTE || (flood && this.minute.floods >= FLOODS_PER_MINUTE)) {
        this.minute.dropped += 1;
        return;
      }
      this.minute.lines += 1;
      if (flood) this.minute.floods += 1;
    }
    this.write(entry);
  }

  write(entry) {
    const text = `${JSON.stringify(entry)}\n`;
    try {
      if (this.logBytes + text.length > LOG_MAX_BYTES) {
        if (existsSync(this.logFile)) renameSync(this.logFile, `${this.logFile}.1`);
        this.logBytes = 0;
      }
      appendFileSync(this.logFile, text);
      this.logBytes += text.length;
    } catch (error) {
      // A full or read-only disk is no reason to stop the game; the line is
      // still in memory for /cheats.
      if (!this.logFailed) console.error(`[anti-cheat] could not write the log: ${error.message}`);
      this.logFailed = true;
    }
  }

  /* --------------------------------------------------- for the commands */

  /** The latest lines, newest first, as /cheats shows them. */
  recentLines(count = 10) {
    return this.recent.slice(-count).reverse().map(describeLine);
  }

  /** One account's standing, as /cheats <player> says it. */
  standing(key, name) {
    const entry = this.entry(key);
    if (!entry) return `${name}: nothing held against them`;
    const kinds = Object.entries(entry.kinds).sort((a, b) => b[1] - a[1]);
    const parts = [`${name}: score ${round(total(entry))} of ${KICK_AT}`];
    if (kinds.length) parts[0] += ` (${kinds.map(([kind, value]) => `${kind} ${round(value)}`).join(', ')})`;
    parts.push(`${entry.strikes.length} kick${entry.strikes.length === 1 ? '' : 's'} in the last week`
      + `${entry.carried.length ? ` (and ${entry.carried.length} on its address before it was made)` : ''}`);
    if (entry.ban) {
      parts.push(`banned for ${entry.ban.reason}, ${duration(entry.ban.until - this.now())} left`
        + `${entry.ban.address ? ' (new accounts from their address held too)' : ''}`);
    } else parts.push('not banned');
    return parts.join(' · ');
  }
}

/** Everything held against an entry, together. */
function total(entry) {
  let sum = 0;
  for (const value of Object.values(entry.kinds)) sum += value;
  return sum;
}

/** An entry from the file, in the shape it should have, or null. */
function clean(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kinds = {};
  for (const [kind, value] of Object.entries(raw.kinds && typeof raw.kinds === 'object' ? raw.kinds : {})) {
    if (Object.hasOwn(CHEATS, kind) && Number.isFinite(value) && value > 0) kinds[kind] = value;
  }
  const strikes = (Array.isArray(raw.strikes) ? raw.strikes : []).filter(Number.isFinite).slice(-100);
  const carried = (Array.isArray(raw.carried) ? raw.carried : []).filter(Number.isFinite).slice(-100);
  const ban = raw.ban && Number.isFinite(raw.ban.until)
    ? { until: raw.ban.until, reason: String(raw.ban.reason ?? ''), address: typeof raw.ban.address === 'string' ? raw.ban.address : null, at: Number(raw.ban.at) || 0 }
    : null;
  return { name: String(raw.name ?? ''), kinds, at: Number.isFinite(raw.at) ? raw.at : 0, strikes, carried, ban };
}

/** The last `count` lines of the log, read from its end: what /cheats had before a restart. */
function readTail(file, count) {
  if (!existsSync(file)) return [];
  try {
    const size = statSync(file).size;
    const length = Math.min(size, 64 * 1024);
    const buffer = Buffer.alloc(length);
    const fd = openSync(file, 'r');
    try {
      readSync(fd, buffer, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    const lines = buffer.toString('utf8').split('\n');
    // The first may be cut in half, by where the read began.
    if (length < size) lines.shift();
    const out = [];
    for (const line of lines.slice(-count - 1)) {
      try {
        const entry = JSON.parse(line);
        // Floods stay in the file (see log).
        if (entry && typeof entry === 'object' && entry.kind !== 'flood') out.push(entry);
      } catch {
        /* a line that will not parse is skipped */
      }
    }
    return out.slice(-count);
  } catch {
    return [];
  }
}

/** One line of the log as a line of chat. */
function describeLine(entry) {
  const at = String(entry.at ?? '').slice(11, 16);
  const who = entry.name ?? entry.key ?? '?';
  switch (entry.kind) {
    case 'kick':
      return `${at} ${who} kicked for ${entry.reason}${entry.ban ? `, banned ${entry.ban}` : ''} (kick ${entry.strikes} this week)`;
    case 'pardon':
      return `${at} ${who} pardoned by ${entry.by}`;
    case 'unban':
      return `${at} ${who}'s anti-cheat ban lifted by ${entry.by}`;
    case 'dropped':
      return `${at} ${entry.n} more lines not logged (too many at once)`;
    default:
      return `${at} ${who} ${entry.kind} ×${entry.n} (+${entry.weight}, score ${entry.score})`;
  }
}

function round(value) {
  return Math.round(value * 10) / 10;
}

/** A length of time as a person says it: "14 min", "1 h 5 min", "23 h". */
export function duration(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest && hours < 10 ? `${hours} h ${rest} min` : `${Math.round(minutes / 60)} h`;
}

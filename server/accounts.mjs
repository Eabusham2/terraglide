/**
 * Accounts: a name, a password, a colour, and the sessions that let a browser
 * come back without typing the password again.
 *
 * Passwords are never stored. What is kept is a scrypt hash with its own salt,
 * which is the standard library's memory-hard password hash: guessing it back
 * costs the same few dozen milliseconds and sixteen megabytes per try that
 * checking it does, which is what makes a stolen accounts file slow to
 * attack. Sessions are random tokens; only a hash of each is kept too, so the
 * file never holds anything a reader could sign in with.
 *
 * Signing in is rate limited per address and per account, so a password can
 * not be guessed at line speed through the socket either.
 */

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { distinctColour, nameKey, nameProblem, passwordProblem } from '../src/net/protocol.js';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_BYTES = 64;
/** How long "keep me signed in" lasts without being used, days. */
const SESSION_DAYS = 30;
/** A browser can be signed in on this many devices at once per account. */
const MAX_SESSIONS = 8;

function hashPassword(password, salt = randomBytes(16)) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, SCRYPT, (error, key) => {
      if (error) reject(error);
      else resolve(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`);
    });
  });
}

async function checkPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await new Promise((resolve, reject) => {
    scrypt(password, Buffer.from(saltB64, 'base64'), expected.length,
      { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem },
      (error, out) => (error ? reject(error) : resolve(out)));
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('base64url');
}

/**
 * A sliding window of attempts per key, for the rate limits below.
 */
class Limiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  /** True if this key may try again now. Counts the try. */
  allow(key, now = Date.now()) {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }

  /** Seconds until the next try would be allowed. */
  wait(key, now = Date.now()) {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length < this.max) return 0;
    return Math.ceil((list[0] + this.windowMs - now) / 1000);
  }

  /** Tries in the window so far. */
  count(key, now = Date.now()) {
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs).length;
  }

  clear(key) {
    this.hits.delete(key);
  }
}

export class Accounts {
  /**
   * @param {import('./store.mjs').Store} store
   * @param {object} config
   */
  constructor(store, config) {
    this.store = store;
    this.config = config;
    const saved = store.read('accounts.json', { version: 1, accounts: {}, sessions: {} });
    this.accounts = saved.accounts ?? {};
    this.sessions = saved.sessions ?? {};
    // Nought means no limit, the way maxAccounts does — not "nobody".
    const perHour = Number(config.signupsPerHour ?? 5);
    this.signups = new Limiter(perHour > 0 ? perHour : Infinity, 3600 * 1000);
    this.failures = new Limiter(8, 5 * 60 * 1000);
    // Wrong passwords for one account from one address, and for one account
    // from anywhere. The second used to be the only one, at six: anybody
    // could lock anybody out of their own account by guessing wrong six
    // times. Now it only stops addresses that have been guessing.
    this.pairFailures = new Limiter(5, 15 * 60 * 1000);
    this.accountFailures = new Limiter(30, 60 * 60 * 1000);
    // Wrong current passwords when changing it, per account: a session left
    // signed in is not a way to guess the password at a try every two seconds.
    this.changeFailures = new Limiter(5, 15 * 60 * 1000);
    this.pruneSessions();
  }

  save() {
    this.store.mark('accounts.json', () => ({ version: 1, accounts: this.accounts, sessions: this.sessions }));
  }

  get(name) {
    return this.accounts[nameKey(name)] ?? null;
  }

  all() {
    return Object.values(this.accounts);
  }

  /**
   * Make an account. Resolves to { account } or { error }.
   *
   * @param {string} name
   * @param {string} password
   * @param {string} address who is asking, for the rate limit
   * @param {string} [code] the server's join code, when it has one
   */
  async signup(name, password, address, code) {
    const nameError = nameProblem(name);
    if (nameError) return { error: nameError };
    const passwordError = passwordProblem(password);
    if (passwordError) return { error: passwordError };
    if (this.config.joinCode) {
      // A wrong code costs a try, the way a wrong password does — or the code
      // could be guessed at line speed, and on a fresh server the first
      // account through is the admin.
      if (this.failures.wait(address) > 0) {
        return { error: `Too many tries — wait ${this.failures.wait(address)} s` };
      }
      if (String(code ?? '') !== String(this.config.joinCode)) {
        this.failures.allow(address);
        return { error: 'This server needs a join code to make an account — ask whoever runs it' };
      }
    }
    if (!this.config.openSignups) return { error: 'This server is not taking new accounts' };
    const key = nameKey(name);
    if (this.accounts[key]) return { error: 'That name is taken' };
    if (this.config.maxAccounts && this.all().length >= this.config.maxAccounts) {
      return { error: 'This server is full up on accounts' };
    }
    if (!this.signups.allow(address)) {
      return { error: `Too many new accounts from here — try again in ${this.signups.wait(address)} s` };
    }
    const hash = await hashPassword(password);
    // Checked again after the await: two sign-ups for one name can both pass
    // the test above while the first is still hashing.
    if (this.accounts[key]) return { error: 'That name is taken' };
    const account = {
      name,
      key,
      // Kept apart from the people who actually play, not from every account
      // ever made: on a public server those crowd out every hue.
      colour: distinctColour(this.all().filter((a) => Date.now() - (a.lastSeen ?? 0) < 30 * 86400 * 1000).map((a) => a.colour)),
      hash,
      created: Date.now(),
      lastSeen: Date.now(),
      admin: this.isConfiguredAdmin(name) || this.all().length === 0 && this.config.firstAccountIsAdmin !== false,
    };
    this.accounts[key] = account;
    this.save();
    return { account };
  }

  isConfiguredAdmin(name) {
    return (this.config.admins ?? []).map(nameKey).includes(nameKey(name));
  }

  /** Resolves to { account } or { error }. */
  async login(name, password, address) {
    if (!this.failures.allow(address, Date.now()) && this.failures.wait(address) > 0) {
      return { error: `Too many tries — wait ${this.failures.wait(address)} s` };
    }
    const account = this.get(name);
    const key = nameKey(name);
    const pair = `${key}\n${address}`;
    if (account) {
      if (this.pairFailures.wait(pair) > 0) {
        return { error: `Too many tries for that account — wait ${this.pairFailures.wait(pair)} s` };
      }
      // Guessed at from all over: only an address that has not got it wrong
      // lately may still try, which is its owner signing in from home.
      if (this.accountFailures.wait(key) > 0 && this.pairFailures.count(pair) > 0) {
        return { error: `Too many tries for that account — wait ${this.accountFailures.wait(key)} s` };
      }
    }
    // A missing account costs a hash too, so how long the answer takes says
    // nothing about whether the name exists.
    const ok = account
      ? await checkPassword(String(password ?? ''), account.hash)
      : (await hashPassword(String(password ?? '')), false);
    if (!ok) {
      if (account) {
        this.pairFailures.allow(pair);
        this.accountFailures.allow(key);
      }
      return { error: 'Wrong name or password' };
    }
    this.failures.clear(address);
    this.pairFailures.clear(pair);
    return { account };
  }

  /** Make a session for an account; returns the token to hand the browser. */
  openSession(account) {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    this.sessions[tokenHash(token)] = { key: account.key, created: now, used: now };
    // Oldest go first when one account has too many.
    const mine = Object.entries(this.sessions)
      .filter(([, s]) => s.key === account.key)
      .sort((a, b) => a[1].used - b[1].used);
    while (mine.length > MAX_SESSIONS) delete this.sessions[mine.shift()[0]];
    this.save();
    return token;
  }

  /** The account a token belongs to, or null. Refreshes the session. */
  resume(token) {
    const id = tokenHash(token);
    const session = this.sessions[id];
    if (!session) return null;
    const now = Date.now();
    if (now - session.used > SESSION_DAYS * 86400 * 1000) {
      delete this.sessions[id];
      this.save();
      return null;
    }
    const account = this.accounts[session.key];
    if (!account) {
      delete this.sessions[id];
      this.save();
      return null;
    }
    session.used = now;
    this.save();
    return account;
  }

  closeSession(token) {
    delete this.sessions[tokenHash(token)];
    this.save();
  }

  /** Sign every browser out of an account — after a password change, a ban. */
  closeAllSessions(account, except = null) {
    const keep = except ? tokenHash(except) : null;
    for (const [id, session] of Object.entries(this.sessions)) {
      if (session.key === account.key && id !== keep) delete this.sessions[id];
    }
    this.save();
  }

  async changePassword(account, oldPassword, newPassword, keepToken) {
    const problem = passwordProblem(newPassword);
    if (problem) return { error: problem };
    const wait = this.changeFailures.wait(account.key);
    if (wait > 0) return { error: `Too many wrong passwords — wait ${wait} s` };
    if (!(await checkPassword(String(oldPassword ?? ''), account.hash))) {
      this.changeFailures.allow(account.key);
      return { error: 'That is not your current password' };
    }
    this.changeFailures.clear(account.key);
    account.hash = await hashPassword(newPassword);
    this.closeAllSessions(account, keepToken);
    this.save();
    return { ok: true };
  }

  /** Set a password without the old one: the server owner's reset, from the command line. */
  async resetPassword(name, newPassword) {
    const account = this.get(name);
    if (!account) return { error: `No account called ${name}` };
    const problem = passwordProblem(newPassword);
    if (problem) return { error: problem };
    account.hash = await hashPassword(newPassword);
    this.closeAllSessions(account);
    this.save();
    return { ok: true };
  }

  touch(account) {
    account.lastSeen = Date.now();
    this.save();
  }

  pruneSessions() {
    const now = Date.now();
    let changed = false;
    for (const [id, session] of Object.entries(this.sessions)) {
      if (now - session.used > SESSION_DAYS * 86400 * 1000 || !this.accounts[session.key]) {
        delete this.sessions[id];
        changed = true;
      }
    }
    if (changed) this.save();
  }
}

export { hashPassword, checkPassword };

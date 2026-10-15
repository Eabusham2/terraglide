
/**
 * Where the server keeps what it knows, between restarts.
 *
 * Plain JSON files in one folder, written atomically: a write goes to a
 * temporary file beside the real one and is renamed over it, so a crash or a
 * pulled plug mid-write leaves the last good copy rather than half of a new
 * one. A hobby server for friends does not need a database, and a folder of
 * JSON is something its owner can open, read, back up by copying, and fix by
 * hand — which matters more here than anything a database would buy.
 *
 *   data/
 *     accounts.json         every account: name, colour, password hash, sessions
 *     server.json           bans, spawn points moved with /setspawn
 *     players/<name>.json   one player's world: where they are, what they
 *                           explored and flew, on every world they have visited
 *
 * Saves are coalesced: things are marked dirty as they change and written on
 * a timer, on disconnect and on shutdown, never once per position update.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export class Store {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(join(dir, 'players'), { recursive: true });
    this.dirty = new Map(); // file -> () => value
  }

  path(name) {
    return join(this.dir, name);
  }

  read(name, fallback) {
    const file = this.path(name);
    if (!existsSync(file)) return fallback;
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      // A file that will not parse is kept, renamed, rather than overwritten
      // by the next save — it is somebody's data, and it may be fixable.
      const aside = `${file}.broken-${Date.now()}`;
      try {
        renameSync(file, aside);
      } catch {
        /* nothing more to do */
      }
      console.error(`[store] ${name} could not be read (${error.message}); kept as ${aside}`);
      return fallback;
    }
  }

  /** Write now, atomically. */
  write(name, value) {
    const file = this.path(name);
    const temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(value));
    renameSync(temp, file);
  }

  /** Write later, with whatever the value is by then. */
  mark(name, get) {
    this.dirty.set(name, get);
  }

  flush() {
    const pending = [...this.dirty];
    this.dirty.clear();
    for (const [name, get] of pending) {
      try {
        this.write(name, get());
      } catch (error) {
        console.error(`[store] could not save ${name}: ${error.message}`);
        // Try again next time rather than lose it.
        this.dirty.set(name, get);
      }
    }
    return pending.length;
  }

  /** Names of every saved player, by file. */
  playerFiles() {
    try {
      return readdirSync(join(this.dir, 'players')).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
  }
}

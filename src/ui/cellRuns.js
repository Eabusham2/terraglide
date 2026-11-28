/**
 * A set of explored cells kept as runs: per zoom level, per row, the columns
 * as [start, length] pairs, sorted.
 *
 * The shared map held every cell as a string in a Set — about fifty bytes a
 * cell — and a public server's shared map only ever grows: a million cells,
 * about a hundred hours of people gliding about, was a couple of hundred
 * megabytes on a machine the guide sizes at 256. Explored ground is mostly
 * one piece — a path is a band, a stay is a disc — so it is mostly long runs,
 * which cost a few bytes a cell instead.
 *
 * It is also already the shape the cells travel in (see encodeCells in
 * src/ui/exploration.js: per level, row, start and length), so sending or
 * saving the map is a walk over it rather than a sort of every cell.
 *
 * It lives beside the page's code because the page keeps them too: everybody's
 * map (session.shared) and other players' are this, and so is every player's
 * record on the server (server/records.mjs). Only your own record on the page
 * is still a Set, for its save (see Exploration.save).
 */

export class CellRuns {
  constructor() {
    /** level -> Map(row -> [start, length, start, length, …]) */
    this.levels = new Map();
    /** How many cells, in all and per level. */
    this.size = 0;
    this.counts = new Map();
  }

  /** The runs for a row, and where in them the column falls. */
  locate(level, row, column) {
    const rows = this.levels.get(level);
    const runs = rows?.get(row);
    if (!runs) return { runs: null, index: -1, inside: false };
    // The last run that starts at or before the column.
    let lo = 0;
    let hi = runs.length / 2 - 1;
    let index = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (runs[mid * 2] <= column) {
        index = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const inside = index >= 0 && column < runs[index * 2] + runs[index * 2 + 1];
    return { runs, index, inside };
  }

  has(key) {
    const cell = parse(key);
    return !!cell && this.locate(cell.level, cell.row, cell.column).inside;
  }

  /** The same by number, which is what the maps ask a few thousand times a frame. */
  hasCell(level, column, row) {
    const runs = this.levels.get(level)?.get(row);
    if (!runs) return false;
    let lo = 0;
    let hi = runs.length / 2 - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const start = runs[mid * 2];
      if (column < start) hi = mid - 1;
      else if (column >= start + runs[mid * 2 + 1]) lo = mid + 1;
      else return true;
    }
    return false;
  }

  /** Add a cell by its key, "level/x/y". True if it was not there before. */
  add(key) {
    const cell = parse(key);
    return !!cell && this.addRun(cell.level, cell.row, cell.column, 1) === 1;
  }

  /** Add a cell by number. True if it was not there before. */
  addCell(level, column, row) {
    return this.addRun(level, row, column, 1) === 1;
  }

  /**
   * Add `length` cells of one row from `start` on, joining the runs they
   * touch. Returns how many were not there before, and tells `fresh(start,
   * length)` where they are, if it is given.
   */
  addRun(level, row, start, length, fresh = null) {
    if (!(length > 0)) return 0;
    let rows = this.levels.get(level);
    if (!rows) this.levels.set(level, (rows = new Map()));
    const runs = rows.get(row);
    const end = start + length;
    let added = 0;
    if (!runs) {
      rows.set(row, [start, length]);
      added = length;
      fresh?.(start, length);
    } else {
      const count = runs.length / 2;
      const lastEnd = runs[(count - 1) * 2] + runs[(count - 1) * 2 + 1];
      if (start > lastEnd) {
        // Past the end of the row: what a map arriving in order always is.
        runs.push(start, length);
        added = length;
        fresh?.(start, length);
      } else {
        // The first run that ends at or after the start (touching counts), and
        // the last that starts at or before the end: everything from one to the
        // other becomes one run.
        let lo = 0;
        let hi = count - 1;
        let first = count;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (runs[mid * 2] + runs[mid * 2 + 1] >= start) {
            first = mid;
            hi = mid - 1;
          } else lo = mid + 1;
        }
        lo = 0;
        hi = count - 1;
        let last = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (runs[mid * 2] <= end) {
            last = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        if (first > last) {
          // Touches nothing: a run of its own, in order.
          runs.splice(first * 2, 0, start, length);
          added = length;
          fresh?.(start, length);
        } else {
          const from = Math.min(start, runs[first * 2]);
          const to = Math.max(end, runs[last * 2] + runs[last * 2 + 1]);
          // The gaps between the runs being joined, inside the new cells, are
          // what is new.
          let at = start;
          for (let i = first; i <= last; i++) {
            const runStart = runs[i * 2];
            const runEnd = runStart + runs[i * 2 + 1];
            if (runStart > at) {
              const gap = Math.min(runStart, end) - at;
              if (gap > 0) {
                added += gap;
                fresh?.(at, gap);
              }
            }
            at = Math.max(at, runEnd);
          }
          if (end > at) {
            added += end - at;
            fresh?.(at, end - at);
          }
          runs.splice(first * 2, (last - first + 1) * 2, from, to - from);
        }
      }
    }
    if (added > 0) {
      this.size += added;
      this.counts.set(level, (this.counts.get(level) ?? 0) + added);
    }
    return added;
  }

  countAt(level) {
    return this.counts.get(level) ?? 0;
  }

  clear() {
    this.levels.clear();
    this.counts.clear();
    this.size = 0;
  }

  /** Every run, as fn(level, row, start, length), in no particular order. */
  forEachRun(fn) {
    for (const [level, rows] of this.levels) {
      for (const [row, runs] of rows) {
        for (let i = 0; i < runs.length; i += 2) fn(level, row, runs[i], runs[i + 1]);
      }
    }
  }

  /**
   * The cells encoded the way encodeCells does it, cut into parts of at most
   * `maxRuns` runs each — for sending a big map a piece at a time.
   */
  parts(maxRuns = 20000) {
    const parts = [];
    let current = { v: 2, runs: {} };
    let inCurrent = 0;
    const levels = [...this.levels.keys()].sort((a, b) => a - b);
    for (const level of levels) {
      const rows = this.levels.get(level);
      const order = [...rows.keys()].sort((a, b) => a - b);
      for (const row of order) {
        const runs = rows.get(row);
        for (let i = 0; i < runs.length; i += 2) {
          if (inCurrent >= maxRuns) {
            parts.push(current);
            current = { v: 2, runs: {} };
            inCurrent = 0;
          }
          (current.runs[level] ??= []).push(row, runs[i], runs[i + 1]);
          inCurrent += 1;
        }
      }
    }
    parts.push(current);
    return parts;
  }

  /** All of it in one piece, as encodeCells writes it: for a record's save. */
  encode() {
    return this.parts(Infinity)[0];
  }

  /** How many runs there are, in all. */
  runCount() {
    let n = 0;
    for (const rows of this.levels.values()) for (const runs of rows.values()) n += runs.length / 2;
    return n;
  }

  /**
   * The same parts as parts(), made one at a time as they are asked for and
   * from the cells as they are then - for sending a big map down a slow
   * connection without holding all of it as text meanwhile. A part ends at
   * the end of a row once it has `maxRuns`, so a row goes whole, as it is at
   * that moment. Cells added to rows already passed are not in it: whoever
   * is being sent it is sent those as they are added (server/game.mjs,
   * flushShared).
   */
  *streamParts(maxRuns = 20000) {
    let current = { v: 2, runs: {} };
    let inCurrent = 0;
    for (const level of [...this.levels.keys()].sort((a, b) => a - b)) {
      const rows = this.levels.get(level);
      for (const row of [...rows.keys()].sort((a, b) => a - b)) {
        if (inCurrent >= maxRuns) {
          yield current;
          current = { v: 2, runs: {} };
          inCurrent = 0;
        }
        const runs = rows.get(row);
        const out = (current.runs[level] ??= []);
        for (let i = 0; i < runs.length; i += 2) out.push(row, runs[i], runs[i + 1]);
        inCurrent += runs.length / 2;
      }
    }
    yield current;
  }

  /** Every key, for the rare caller that wants them one by one. */
  *keys() {
    for (const [level, rows] of this.levels) {
      for (const [row, runs] of rows) {
        for (let i = 0; i < runs.length; i += 2) {
          for (let x = runs[i]; x < runs[i] + runs[i + 1]; x++) yield `${level}/${x}/${row}`;
        }
      }
    }
  }

  [Symbol.iterator]() {
    return this.keys();
  }
}

function parse(key) {
  if (typeof key !== 'string') return null;
  const slash = key.indexOf('/');
  const second = key.indexOf('/', slash + 1);
  if (slash < 0 || second < 0) return null;
  const level = Number(key.slice(0, slash));
  const column = Number(key.slice(slash + 1, second));
  const row = Number(key.slice(second + 1));
  if (!Number.isInteger(level) || !Number.isInteger(column) || !Number.isInteger(row)) return null;
  if (level < 0 || level > 24 || column < 0 || row < 0 || column >= 2 ** level || row >= 2 ** level) return null;
  return { level, column, row };
}

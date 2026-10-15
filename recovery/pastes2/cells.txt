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

  /** Add a cell by its key, "level/x/y". True if it was not there before. */
  add(key) {
    const cell = parse(key);
    if (!cell) return false;
    const { level, row, column } = cell;
    let rows = this.levels.get(level);
    if (!rows) this.levels.set(level, (rows = new Map()));
    const found = this.locate(level, row, column);
    if (found.inside) return false;
    let runs = found.runs;
    if (!runs) {
      rows.set(row, [column, 1]);
    } else {
      const i = found.index;
      const joinsBefore = i >= 0 && runs[i * 2] + runs[i * 2 + 1] === column;
      const next = i + 1;
      const joinsAfter = next * 2 < runs.length && runs[next * 2] === column + 1;
      if (joinsBefore && joinsAfter) {
        // Fills the gap between two runs: one run now.
        runs[i * 2 + 1] += 1 + runs[next * 2 + 1];
        runs.splice(next * 2, 2);
      } else if (joinsBefore) {
        runs[i * 2 + 1] += 1;
      } else if (joinsAfter) {
        runs[next * 2] = column;
        runs[next * 2 + 1] += 1;
      } else {
        runs.splice(next * 2, 0, column, 1);
      }
    }
    this.size += 1;
    this.counts.set(level, (this.counts.get(level) ?? 0) + 1);
    return true;
  }

  countAt(level) {
    return this.counts.get(level) ?? 0;
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

/** localStorage wrapper that never throws (private mode, quota, disabled storage). */

const PREFIX = 'terraglide.';

function backing() {
  try {
    const s = window.localStorage;
    const probe = PREFIX + '__probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const store = backing();
const memory = new Map();

export function readJSON(key, fallback) {
  const raw = store ? store.getItem(PREFIX + key) : memory.get(PREFIX + key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  let raw;
  try {
    raw = JSON.stringify(value);
  } catch {
    return;
  }
  if (store) {
    try {
      store.setItem(PREFIX + key, raw);
      return;
    } catch {
      /* quota exceeded — fall through to memory */
    }
  }
  memory.set(PREFIX + key, raw);
}

export function removeKey(key) {
  if (store) {
    try {
      store.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  }
  memory.delete(PREFIX + key);
}

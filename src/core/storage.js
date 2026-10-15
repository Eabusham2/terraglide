import { BOOT, serverId } from './boot.js';

/** localStorage wrapper that never throws (private mode, quota, disabled storage). */

const PREFIX = 'terraglide.';

/**
 * The saves that belong to one world and one way of playing, rather than to
 * the person at the keyboard.
 *
 * Settings and key bindings are yours wherever you play, so they stay where
 * they always were. What you explored, the line you flew and the places you
 * marked are facts about one world in one game: Moon craters do not belong on
 * the Earth map, and a server's record of you is the server's.
 *
 * Playing locally on Earth these keys are exactly what they always were, so
 * nobody's existing save moves. Locally on another world they gain the
 * world's name. Online they are never written to this browser at all — the
 * server holds them and hands them back when you sign in, which is the whole
 * of "nothing local updates the server and nothing online touches local".
 */
const WORLD_KEYS = new Set(['explored', 'trail', 'waypoints', 'last-position', 'lander']);

function scopeFor() {
  if (BOOT.mode === 'online') return { memory: true, prefix: `net.${serverId(BOOT.server)}.${BOOT.world}.` };
  return { memory: false, prefix: BOOT.world === 'earth' ? '' : `${BOOT.world}.` };
}

const SCOPE = scopeFor();

function resolveKey(key) {
  if (!WORLD_KEYS.has(key)) return { name: PREFIX + key, memory: false };
  return { name: PREFIX + SCOPE.prefix + key, memory: SCOPE.memory };
}

function backing() {
  try {
    const s = window.localStorage;
const memory = new Map();

export function readJSON(key, fallback) {
  const raw = store ? store.getItem(PREFIX + key) : memory.get(PREFIX + key);
  const { name, memory: inMemory } = resolveKey(key);
  const raw = store && !inMemory ? store.getItem(name) : memory.get(name);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
}

export function writeJSON(key, value) {
  const { name, memory: inMemory } = resolveKey(key);
  let raw;
  try {
    raw = JSON.stringify(value);
  } catch {
    return;
  }
  if (store) {
  if (store && !inMemory) {
    try {
      store.setItem(PREFIX + key, raw);
      store.setItem(name, raw);
      return;
    } catch {
      /* quota exceeded — fall through to memory */
    }
  }
  memory.set(PREFIX + key, raw);
  memory.set(name, raw);
}

export function removeKey(key) {
  const { name } = resolveKey(key);
  if (store) {
    try {
      store.removeItem(PREFIX + key);
      store.removeItem(name);
    } catch {
      /* ignore */
    }
  }
  memory.delete(PREFIX + key);
  memory.delete(name);
}

/** Is this key one of the per-world saves above? For the tests and the export. */
export function isWorldKey(key) {
  return WORLD_KEYS.has(key);
}
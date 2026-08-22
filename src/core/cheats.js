import { Emitter } from './events.js';
import { clamp } from './math.js';

/**
 * Cheats.
 *
 * Deliberately the one part of the game that is *not* saved. Nothing here ever
 * touches local storage, so a refresh puts every dial back to normal — while the
 * ground you explored, the waypoints you dropped and the trail you left behind
 * are stored as they always were and survive untouched. Cheat your way to the
 * far side of the planet and the map still remembers you went.
 *
 * Getting in is a code rather than a button, because it should be something you
 * choose to do:
 *
 *   press ` and then type `terraglide`, or press Ctrl+Shift+`
 *   on a touch screen, hold three fingers on the view for a second and a half
 *
 * After that the backtick key opens the panel.
 *
 * The backtick arms the code and the letters after it are swallowed rather than
 * passed on — otherwise typing it would fire half the keyboard on the way past,
 * and `r` alone would teleport you somewhere else mid-word.
 */

/** The typed unlock code. */
export const UNLOCK_CODE = 'terraglide';
/** Letters have to arrive within this many milliseconds of each other. */
const CODE_GAP_MS = 2000;
/** How long three fingers have to rest on the screen. */
export const TOUCH_HOLD_MS = 1500;

/** Every dial, and the value it has when cheats are off. */
export const CHEAT_DEFAULTS = {
  /** Multiplies how far you travel per second, on foot and in the air. */
  playerSpeed: 1,
  /** Multiplies the clock: the whole world runs faster or slower. */
  gameSpeed: 1,
  /** Multiplies firework thrust. */
  rocketPower: 1,
  /** Creative flight: no gravity, look where you want to go. */
  fly: false,
  /** Walk through walls and terrain. */
  noclip: false,
  /** Show the whole map without having been there. */
  mapUnlocked: false,
  /** Speed mode never runs out and never needs to recharge. */
  speedFree: false,
  /**
   * How big you are, as a multiple of your real height.
   *
   * This lived in Settings, next to the field of view and the units, which
   * made growing to forty times human size an ordinary preference rather than
   * what it is. It is a cheat, so it is in here with the other cheats, and it
   * goes back to one on a refresh like everything else on this list.
   */
  playerScale: 1,
};

const LIMITS = {
  playerSpeed: [0.1, 12],
  gameSpeed: [0.1, 8],
  rocketPower: [0.1, 12],
  playerScale: [0.25, 40],
};

class Cheats extends Emitter {
  constructor() {
    super();
    this.unlocked = false;
    this.armed = false;
    this.typed = '';
    this.typedAt = 0;
    Object.assign(this, CHEAT_DEFAULTS);
  }

  /** Is anything actually turned on? Drives the HUD flag. */
  get active() {
    return Object.keys(CHEAT_DEFAULTS).some((key) => this[key] !== CHEAT_DEFAULTS[key]);
  }

  /** Short labels for whatever is currently on. */
  get labels() {
    const list = [];
    if (this.fly) list.push('fly');
    if (this.noclip) list.push('noclip');
    if (this.mapUnlocked) list.push('map');
    if (this.speedFree) list.push('2x free');
    if (this.playerSpeed !== 1) list.push(`speed ${trim(this.playerSpeed)}x`);
    if (this.gameSpeed !== 1) list.push(`time ${trim(this.gameSpeed)}x`);
    if (this.rocketPower !== 1) list.push(`rocket ${trim(this.rocketPower)}x`);
    return list;
  }

  set(key, value) {
    if (!(key in CHEAT_DEFAULTS)) return;
    let next = value;
    if (typeof CHEAT_DEFAULTS[key] === 'number') {
      const [min, max] = LIMITS[key] ?? [0, 1000];
      next = clamp(Number(value), min, max);
      if (!Number.isFinite(next)) return;
    } else {
      next = Boolean(value);
    }
    if (this[key] === next) return;
    this[key] = next;
    this.emit('change', { key, value: next });
  }

  toggle(key) {
    this.set(key, !this[key]);
    return this[key];
  }

  /** Back to a clean game, without locking the panel again. */
  reset() {
    let changed = false;
    for (const key of Object.keys(CHEAT_DEFAULTS)) {
      if (this[key] === CHEAT_DEFAULTS[key]) continue;
      this[key] = CHEAT_DEFAULTS[key];
      changed = true;
    }
    if (changed) this.emit('change', { key: '*', value: null });
    return changed;
  }

  unlock() {
    if (this.unlocked) return false;
    this.unlocked = true;
    this.emit('unlock', true);
    return true;
  }

  /** Lock up again — and put everything back, so locked always means honest. */
  lock() {
    this.reset();
    if (!this.unlocked) return;
    this.unlocked = false;
    this.emit('unlock', false);
  }

  /**
   * Feed a keydown. Returns 'unlock' when the code has just been completed,
   * 'panel' for the panel key, 'consume' for a key the code has eaten, or ''
   * for anything the game should handle as usual.
   */
  offerKey(event) {
    const code = event.code;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    const now = event.timeStamp ?? Date.now();

    if (code === 'Backquote' && event.ctrlKey && event.shiftKey) {
      return this.unlock() ? 'unlock' : 'panel';
    }
    if (this.unlocked) {
      return code === 'Backquote' && plain ? 'panel' : '';
    }

    // Backquote arms the code; the letters after it are ours until it breaks.
    if (code === 'Backquote' && plain) {
      this.armed = true;
      this.typed = '';
      this.typedAt = now;
      return 'consume';
    }
    if (!this.armed) return '';
    if (now - this.typedAt > CODE_GAP_MS) {
      this.armed = false;
      return '';
    }

    const letter = plain ? /^Key([A-Z])$/.exec(code) : null;
    const next = letter ? this.typed + letter[1].toLowerCase() : '';
    if (!next || !UNLOCK_CODE.startsWith(next)) {
      this.armed = false;
      this.typed = '';
      return '';
    }

    this.typed = next;
    this.typedAt = now;
    if (next !== UNLOCK_CODE) return 'consume';

    this.armed = false;
    this.typed = '';
    return this.unlock() ? 'unlock' : 'consume';
  }
}

function trim(value) {
  return Number(value.toFixed(2)).toString();
}

export const cheats = new Cheats();

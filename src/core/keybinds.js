import { Emitter } from './events.js';
import { readJSON, removeKey, writeJSON } from './storage.js';

/**
 * Bindings are stored as `KeyboardEvent.code`, so the physical key matters and
 * not the character it produces (AZERTY/QWERTZ keep the same WASD triangle).
 */
export const ACTIONS = [
  { id: 'forward', label: 'Walk forward', group: 'Movement', required: true },
  { id: 'back', label: 'Walk back', group: 'Movement', required: true },
  { id: 'left', label: 'Strafe left', group: 'Movement', required: true },
  { id: 'right', label: 'Strafe right', group: 'Movement', required: true },
  { id: 'jump', label: 'Jump / ascend', group: 'Movement', required: true },
  { id: 'sprint', label: 'Sprint / descend', group: 'Movement' },
  { id: 'crouch', label: 'Crouch / dive / descend', group: 'Movement' },
  { id: 'rocket', label: 'Fire rocket (keyboard)', group: 'Flight' },
  { id: 'speedMode', label: 'Speed mode (2x)', group: 'Flight' },
  { id: 'rtp', label: 'Random teleport', group: 'Map' },
  { id: 'freecam', label: 'Freecam', group: 'View' },
  { id: 'perspective', label: 'Change perspective', group: 'View' },
  { id: 'barrelRoll', label: 'Barrel roll', group: 'Flight' },
  { id: 'stowWings', label: 'Stow wings — drop out of a glide', group: 'Flight' },
  { id: 'worldMap', label: 'Open world map', group: 'Map' },
  { id: 'waypoint', label: 'Place waypoint here', group: 'Map' },
  { id: 'copyCoords', label: 'Copy coordinates', group: 'Map' },
  { id: 'minimapZoomIn', label: 'Minimap zoom in', group: 'Map' },
  { id: 'minimapZoomOut', label: 'Minimap zoom out', group: 'Map' },
  { id: 'minimapToggle', label: 'Toggle minimap', group: 'Map' },
  { id: 'scaleUp', label: 'Grow', group: 'View' },
  { id: 'scaleDown', label: 'Shrink', group: 'View' },
  { id: 'mouseMode', label: 'Swap mouse mode', group: 'View' },
  { id: 'toggleHud', label: 'Toggle HUD', group: 'System' },
  { id: 'settings', label: 'Settings', group: 'System' },
  { id: 'help', label: 'Controls help', group: 'System' },
  { id: 'debug', label: 'Debug overlay', group: 'System' },
  { id: 'hotbar1', label: 'Hotbar 1', group: 'Hotbar' },
  { id: 'hotbar2', label: 'Hotbar 2', group: 'Hotbar' },
  { id: 'hotbar3', label: 'Hotbar 3', group: 'Hotbar' },
  { id: 'hotbar4', label: 'Hotbar 4', group: 'Hotbar' },
  { id: 'hotbar5', label: 'Hotbar 5', group: 'Hotbar' },
];

export const DEFAULT_BINDS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sprint: 'ShiftLeft',
  crouch: 'KeyC',
  rocket: 'KeyE',
  speedMode: 'KeyV',
  rtp: 'KeyR',
  freecam: 'KeyQ',
  perspective: 'F5',
  barrelRoll: 'KeyX',
  stowWings: 'KeyF',
  worldMap: 'KeyG',
  waypoint: 'KeyB',
  copyCoords: 'KeyP',
  minimapZoomIn: 'Equal',
  minimapZoomOut: 'Minus',
  minimapToggle: 'KeyM',
  scaleUp: 'BracketRight',
  scaleDown: 'BracketLeft',
  mouseMode: 'KeyL',
  toggleHud: 'F1',
  settings: 'Escape',
  help: 'F2',
  debug: 'F3',
  hotbar1: 'Digit1',
  hotbar2: 'Digit2',
  hotbar3: 'Digit3',
  hotbar4: 'Digit4',
  hotbar5: 'Digit5',
};

const NAMED_KEYS = {
  Space: 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift',
  ControlLeft: 'L Ctrl',
  ControlRight: 'R Ctrl',
  AltLeft: 'L Alt',
  AltRight: 'R Alt',
  CapsLock: 'Caps',
};

/** Human readable name for a KeyboardEvent.code. */
export function keyLabel(code) {
  if (!code) return 'Unbound';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  if (code.startsWith('Arrow')) return code.slice(5) + ' Arrow';
  return NAMED_KEYS[code] ?? code;
}

const STORAGE_KEY = 'keybinds';

class KeybindStore extends Emitter {
  constructor() {
    super();
    const saved = readJSON(STORAGE_KEY, {});
    this.binds = { ...DEFAULT_BINDS };
    for (const action of ACTIONS) {
      if (typeof saved[action.id] === 'string') this.binds[action.id] = saved[action.id];
    }
    this.byCode = new Map();
    this.reindex();
  }

  /** Actions bound to a physical key. */
  actionsFor(code) {
    return this.byCode.get(code) ?? [];
  }

  codeFor(action) {
    return this.binds[action] ?? '';
  }

  labelFor(action) {
    return keyLabel(this.binds[action] ?? '');
  }

  rebind(action, code) {
    // A physical key drives one action at a time; steal it from its old owner.
    for (const other of ACTIONS) {
      if (other.id !== action && this.binds[other.id] === code && !other.required) {
        this.binds[other.id] = '';
      }
    }
    this.binds[action] = code;
    this.save();
  }

  clear(action) {
    const meta = ACTIONS.find((a) => a.id === action);
    if (meta && meta.required) return;
    this.binds[action] = '';
    this.save();
  }

  reset() {
    Object.assign(this.binds, DEFAULT_BINDS);
    removeKey(STORAGE_KEY);
    this.reindex();
    this.emit('change', this.binds);
  }

  save() {
    writeJSON(STORAGE_KEY, this.binds);
    this.reindex();
    this.emit('change', this.binds);
  }

  reindex() {
    this.byCode.clear();
    for (const action of ACTIONS) {
      const code = this.binds[action.id];
      if (!code) continue;
      const list = this.byCode.get(code);
      if (list) list.push(action.id);
      else this.byCode.set(code, [action.id]);
    }
  }
}

export const keybinds = new KeybindStore();

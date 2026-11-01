import { Emitter } from '../core/events.js';
import { clamp } from '../core/math.js';
import { settings } from '../core/settings.js';

/**
 * Game controllers.
 *
 * Any pad the browser reports with the standard mapping — Xbox, PlayStation,
 * Switch Pro and most others — and the hand controllers of a VR headset, read
 * into the same snapshot the keyboard and the touch stick fill (see
 * InputManager.movement), so walking, gliding, banking and the double jump
 * that opens the wings all work the way they do on the keys.
 *
 * Pads are polled, not listened to: the Gamepad API has no button events, so
 * the game asks once a frame what every button and stick is doing and turns
 * the changes into the same 'action', 'look', 'boost' and 'wheel' events the
 * keyboard and mouse send.
 *
 * With a panel open the pad drives the panel instead (MenuNavigator): the
 * d-pad moves between its buttons and fields, A presses, B and Start back out.
 */

/** The standard mapping's buttons, by name. */
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};
const BUTTON_COUNT = 16;

/**
 * What each button does. `action` is a keyboard action (core/keybinds.js),
 * sent as if its key were pressed — held for as long as the button is, where
 * that matters; `boost` is the mouse's button ('use' is the primary: the
 * sword's swing with the sword in hand, a rocket otherwise); `wheel` steps
 * the hotbar. `xr` is the same thing on a VR hand controller, where there is
 * one. The help card is drawn from this list.
 */
export const PAD_BINDS = [
  { button: PAD.A, label: 'A', action: 'jump', what: 'Jump — twice to open the wings', xr: 'Right A' },
  { button: PAD.B, label: 'B', action: 'crouch', what: 'Crouch, dive in water, sink in flight', xr: 'Left grip' },
  { button: PAD.X, label: 'X', action: 'wings', what: 'Open or stow the wings', xr: 'Right B' },
  { button: PAD.Y, label: 'Y', action: 'speedMode', what: 'Surge', xr: 'Left X' },
  { button: PAD.RT, label: 'RT', boost: 'use', what: 'Fire a rocket — or swing the sword in hand', xr: 'Right trigger' },
  { button: PAD.LT, label: 'LT', boost: 'rocket', what: 'Fire a rocket, sword in hand or not', xr: 'Left trigger' },
  { button: PAD.LB, label: 'LB', wheel: -1, what: 'Previous hotbar slot', xr: 'Right stick press' },
  { button: PAD.RB, label: 'RB', wheel: 1, what: 'Next hotbar slot', xr: 'Right grip' },
  { button: PAD.LS, label: 'Left stick press', action: 'sprint', latch: true, what: 'Sprint, until you stop', xr: 'Left stick press' },
  { button: PAD.RS, label: 'Right stick press', action: 'perspective', what: 'Change perspective' },
  { button: PAD.UP, label: 'D-pad up', action: 'worldMap', what: 'World map' },
  { button: PAD.DOWN, label: 'D-pad down', action: 'waypoint', what: 'Drop a waypoint', xr: 'Left Y' },
  { button: PAD.LEFT, label: 'D-pad left', action: 'minimapZoomOut', what: 'Minimap zoom out' },
  { button: PAD.RIGHT, label: 'D-pad right', action: 'minimapZoomIn', what: 'Minimap zoom in' },
  { button: PAD.START, label: 'Start / Menu', action: 'settings', what: 'Settings — and back out of anything open' },
  { button: PAD.BACK, label: 'Back / View', action: 'help', what: 'This card' },
];

/** The sticks, for the help card. */
export const PAD_STICKS = [
  { label: 'Left stick', what: 'Walk — or bank the wings left and right while gliding', xr: 'Left stick' },
  { label: 'Right stick', what: 'Look around', xr: 'Right stick: turn' },
];

/** Below this a stick is resting, whatever it reports. Sticks drift. */
export const DEADZONE = 0.16;
/** A trigger counts as pulled past this. */
const TRIGGER_DOWN = 0.45;
/** Radians a second at full tilt, at a look speed of 1. */
const LOOK_RATE = 2.8;
/** How long the left stick has to rest before a latched sprint lets go. */
const SPRINT_RELEASE_S = 0.35;

/**
 * A stick's two axes with a round dead zone, rescaled so the edge of the dead
 * zone is zero rather than a jump to sixteen per cent. Returns [x, y].
 */
export function stick(x, y, dead = DEADZONE) {
  const ax = Number.isFinite(x) ? x : 0;
  const ay = Number.isFinite(y) ? y : 0;
  const length = Math.hypot(ax, ay);
  if (length <= dead) return [0, 0];
  const scaled = Math.min(1, (length - dead) / (1 - dead));
  return [(ax / length) * scaled, (ay / length) * scaled];
}

/** Look speed from a stick: gentle near the middle for aiming, quick at the edge for turning round. */
export function lookCurve(value) {
  return Math.sign(value) * Math.abs(value) ** 1.7;
}

/** A button from 0 to 1: its own value, analog or not - and a pressed one that reports none is all the way. */
function value(button) {
  if (!button) return 0;
  if (typeof button === 'number') return button;
  const amount = button.value || 0;
  return button.pressed && amount < 0.5 ? 1 : amount;
}

/**
 * One standard-mapping pad as a plain state: four stick axes and sixteen
 * button values from 0 to 1. Null for a pad with some other mapping, whose
 * buttons could be anything.
 */
export function readStandardPad(pad) {
  if (!pad || !pad.connected || pad.mapping !== 'standard') return null;
  const buttons = new Float32Array(BUTTON_COUNT);
  for (let i = 0; i < BUTTON_COUNT; i++) buttons[i] = value(pad.buttons[i]);
  const axes = pad.axes ?? [];
  return { lx: axes[0] ?? 0, ly: axes[1] ?? 0, rx: axes[2] ?? 0, ry: axes[3] ?? 0, buttons, xr: false };
}

/**
 * A VR headset's two hand controllers as one pad laid out like a standard
 * one (see PAD_BINDS, `xr`). Their buttons are the xr-standard mapping:
 * trigger, grip, touchpad, stick press, then A/X and B/Y; the stick is the
 * third and fourth axes.
 */
export function readXRSources(sources) {
  let left = null;
  let right = null;
  for (const source of sources ?? []) {
    const pad = source?.gamepad;
    if (!pad) continue;
    if (source.handedness === 'left') left = pad;
    else if (source.handedness === 'right') right = pad;
  }
  if (!left && !right) return null;
  const buttons = new Float32Array(BUTTON_COUNT);
  const b = (pad, i) => value(pad?.buttons?.[i]);
  const axis = (pad, i) => pad?.axes?.[i] ?? 0;
  buttons[PAD.A] = b(right, 4);
  buttons[PAD.X] = b(right, 5);
  buttons[PAD.Y] = b(left, 4);
  buttons[PAD.DOWN] = b(left, 5);
  buttons[PAD.B] = b(left, 1);
  buttons[PAD.RB] = b(right, 1);
  buttons[PAD.RT] = b(right, 0);
  buttons[PAD.LT] = b(left, 0);
  buttons[PAD.LS] = b(left, 3);
  buttons[PAD.LB] = b(right, 3);
  return { lx: axis(left, 2), ly: axis(left, 3), rx: axis(right, 2), ry: axis(right, 3), buttons, xr: true };
}

/** Several pads as one: any button held on any of them, the furthest stick. */
export function mergePads(states) {
  const list = states.filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const buttons = new Float32Array(BUTTON_COUNT);
  const out = { lx: 0, ly: 0, rx: 0, ry: 0, buttons, xr: list.some((s) => s.xr) };
  for (const s of list) {
    for (let i = 0; i < BUTTON_COUNT; i++) buttons[i] = Math.max(buttons[i], s.buttons[i]);
    if (Math.hypot(s.lx, s.ly) > Math.hypot(out.lx, out.ly)) {
      out.lx = s.lx;
      out.ly = s.ly;
    }
    if (Math.hypot(s.rx, s.ry) > Math.hypot(out.rx, out.ry)) {
      out.rx = s.rx;
      out.ry = s.ry;
    }
  }
  return out;
}

export class GamepadInput extends Emitter {
  /**
   * @param {object} [options]
   * @param {() => Gamepad[]} [options.pads] where pads come from: navigator.getGamepads
   * @param {() => XRInputSource[]|null} [options.xrSources] a VR session's hand controllers, while there is one
   */
  constructor({ pads = () => globalThis.navigator?.getGamepads?.() ?? [], xrSources = () => null } = {}) {
    super();
    this.pads = pads;
    this.xrSources = xrSources;
    /** The last state read, merged across every pad. */
    this.state = null;
    this.prev = new Float32Array(BUTTON_COUNT);
    this.move = { x: 0, y: 0 };
    /** Presses of A since movement() last asked, for the double jump. */
    this.jumpPresses = 0;
    this.sprint = false;
    this.restingFor = 0;
    /** Whether a pad has been touched lately, rather than only plugged in. */
    this.active = false;
    this.connectedIds = new Set();
    this.menu = new MenuNavigator();
  }

  /** Every pad the browser knows of, standard mapping or not, for "connected". */
  connected() {
    try {
      return [...(this.pads() ?? [])].filter((p) => p && p.connected);
    } catch {
      return [];
    }
  }

  /**
   * Read every pad and say what changed.
   *
   * @param {number} dt seconds since the last poll
   * @param {object} [options]
   * @param {boolean} [options.menu] a panel is open: the pad drives it, not the game
   * @param {boolean} [options.vr] in a VR session: the right stick turns rather than looks
   */
  poll(dt, { menu = false, vr = false } = {}) {
    const pads = this.connected();
    // Plugged in or out: said once each, by the game.
    const ids = new Set(pads.map((p) => `${p.index}:${p.id}`));
    for (const id of ids) if (!this.connectedIds.has(id)) this.emit('connected', { id: id.slice(id.indexOf(':') + 1), standard: pads.find((p) => `${p.index}:${p.id}` === id)?.mapping === 'standard' });
    for (const id of this.connectedIds) if (!ids.has(id)) this.emit('disconnected', { id: id.slice(id.indexOf(':') + 1) });
    this.connectedIds = ids;

    let xr = null;
    try {
      xr = readXRSources(this.xrSources());
    } catch {
      xr = null;
    }
    const state = mergePads([...pads.map(readStandardPad), xr]);
    this.state = state;
    if (!state) {
      this.move.x = 0;
      this.move.y = 0;
      this.releaseAll();
      return;
    }
    const buttons = state.buttons;
    const down = (i) => buttons[i] > (i === PAD.LT || i === PAD.RT ? TRIGGER_DOWN : 0.5);
    const wasDown = (i) => this.prev[i] > (i === PAD.LT || i === PAD.RT ? TRIGGER_DOWN : 0.5);
    const [mx, my] = stick(state.lx, state.ly);
    const [lx, ly] = stick(state.rx, state.ry);
    const now = globalThis.performance?.now?.() ?? Date.now();
    if (buttons.some((b, i) => b > (i === PAD.LT || i === PAD.RT ? TRIGGER_DOWN : 0.5)) || Math.hypot(mx, my) > 0 || Math.hypot(lx, ly) > 0) {
      if (!this.active) this.emit('active', true);
      this.active = true;
      this.usedAt = now;
    }

    // A panel that has just opened, with the pad in hand: its first button
    // has the focus, so the death screen's Respawn is one press of A. Tried
    // for a few seconds, not once: that button is held off for most of one.
    if (menu && !this.inMenu) this.menuSince = now;
    if (menu && now - (this.usedAt ?? -Infinity) < 10000 && now - this.menuSince < 3000 && !this.menu.current()) this.menu.step(1);
    this.inMenu = menu;
    if (menu) {
      // Movement stops while a panel has the pad; what it is pressing goes to the panel.
      this.move.x = 0;
      this.move.y = 0;
      this.sprint = false;
      for (let i = 0; i < BUTTON_COUNT; i++) {
        if (down(i) && !wasDown(i)) this.menuPress(i);
      }
      // A stick works the panel too, one step a flick.
      this.menuStick(my, mx, dt);
      this.prev.set(buttons);
      return;
    }
    this.menuStickHeld = 0;

    // Up on a stick is negative; forward is positive here.
    this.move.x = mx;
    this.move.y = -my;
    if (Math.hypot(mx, my) < 0.2) {
      this.restingFor += dt;
      if (this.restingFor > SPRINT_RELEASE_S) this.sprint = false;
    } else this.restingFor = 0;

    // In VR the head looks; the stick turns, a step at a time (the VR mode
    // reads `state.rx` itself). Elsewhere it looks, faster towards the edge.
    if (!vr && (lx || ly)) {
      const rate = LOOK_RATE * settings.get('controllerLookSpeed') * dt;
      const invert = settings.get('invertY') ? -1 : 1;
      this.emit('look', { dx: lookCurve(lx) * rate, dy: lookCurve(ly) * rate * 0.75 * invert });
    }

    for (const bind of PAD_BINDS) {
      const i = bind.button;
      const now = down(i);
      const was = wasDown(i);
      if (now === was) continue;
      if (now) {
        if (bind.action === 'jump') this.jumpPresses += 1;
        if (bind.latch) this.sprint = true;
        if (bind.boost) this.emit('boost', { kind: bind.boost });
        else if (bind.wheel) this.emit('wheel', { delta: bind.wheel });
        else if (bind.action && !bind.latch) this.emit('action', { id: bind.action, repeat: false });
      } else if (bind.action && !bind.latch) {
        this.emit('actionUp', { id: bind.action });
      }
    }
    this.prev.set(buttons);
  }

  /** Let go of everything held: a pad unplugged mid-press is not a press held for ever. */
  releaseAll() {
    for (const bind of PAD_BINDS) {
      if (this.prev[bind.button] > 0.5 && bind.action && !bind.latch) this.emit('actionUp', { id: bind.action });
    }
    this.prev.fill(0);
    this.sprint = false;
  }

  menuPress(i) {
    switch (i) {
      case PAD.A: return this.menu.press();
      case PAD.B:
      case PAD.START: return this.emit('action', { id: 'settings', repeat: false });
      case PAD.UP: return this.menu.step(-1, 'vertical');
      case PAD.DOWN: return this.menu.step(1, 'vertical');
      case PAD.LEFT: return this.menu.adjust(-1) || this.menu.step(-1, 'horizontal');
      case PAD.RIGHT: return this.menu.adjust(1) || this.menu.step(1, 'horizontal');
      case PAD.LB: return this.menu.step(-1, 'vertical');
      case PAD.RB: return this.menu.step(1, 'vertical');
      default:
    }
  }

  /** The left stick in a panel: a step when pushed, then a step every fifth of a second while it stays pushed. */
  menuStick(y, x, dt) {
    const dir = Math.abs(y) > 0.6 ? Math.sign(y) : 0;
    const side = Math.abs(x) > 0.6 ? Math.sign(x) : 0;
    if (!dir && !side) {
      this.menuStickHeld = 0;
      return;
    }
    const first = !this.menuStickHeld;
    this.menuStickHeld = (this.menuStickHeld ?? 0) + dt;
    if (!first && this.menuStickHeld < 0.4) return;
    if (!first) this.menuStickHeld = 0.2;
    if (dir) this.menu.step(dir, 'vertical');
    else if (!this.menu.adjust(side)) this.menu.step(side, 'horizontal');
  }

  /**
   * What the sticks and held buttons add to the movement snapshot (see
   * InputManager.movement), or null with no pad. `axisX`/`axisY` are the left
   * stick itself, so a half push walks at half pace and banks half as hard.
   */
  movement() {
    const state = this.state;
    if (!state) return null;
    const held = (i) => state.buttons[i] > 0.5;
    const dead = 0.3;
    const presses = this.jumpPresses;
    this.jumpPresses = 0;
    return {
      forward: this.move.y > dead,
      back: this.move.y < -dead,
      left: this.move.x < -dead,
      right: this.move.x > dead,
      jump: held(PAD.A),
      crouch: held(PAD.B),
      sprint: this.sprint,
      jumpPresses: presses,
      axisX: this.move.x,
      axisY: this.move.y,
    };
  }

  /**
   * A shake of the pad in the hand: a hit taken, a rocket lit. `strength`
   * from 0 to 1. Does nothing on a pad that cannot, or with it turned off.
   */
  rumble(strength, ms = 120) {
    if (!settings.get('controllerVibration') || !this.active) return;
    const amount = clamp(strength, 0, 1);
    for (const pad of this.connected()) {
      try {
        pad.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: amount, weakMagnitude: amount * 0.6 })?.catch?.(() => {});
      } catch {
        /* a pad that says it can and cannot */
      }
    }
    try {
      for (const source of this.xrSources() ?? []) {
        const actuator = source?.gamepad?.hapticActuators?.[0];
        actuator?.pulse?.(amount, ms)?.catch?.(() => {});
      }
    } catch {
      /* fine */
    }
  }
}

/**
 * The pad, working whatever panel is open: the settings, the map's buttons,
 * the death screen's Respawn.
 *
 * Every panel is built of ordinary buttons, fields and links, so this needs
 * to know nothing about any of them: it finds the panel on top, moves the
 * focus through what can be focused in it, in the order it is read, and
 * presses what has it. A slider or a list takes left and right as a change of
 * value rather than a step away.
 */
export class MenuNavigator {
  constructor(root = globalThis.document) {
    this.root = root;
  }

  /** The panel on top: the last one shown that is on screen. */
  panel() {
    const doc = this.root;
    if (!doc?.querySelectorAll) return null;
    const open = [...doc.querySelectorAll('.panel:not([hidden]), .death-screen:not([hidden]), .startup:not([hidden])')]
      .filter((el) => el.getClientRects().length > 0);
    if (!open.length) return null;
    // The highest stacked; among equals the one later in the page.
    let best = open[0];
    let bestZ = -Infinity;
    for (const el of open) {
      const z = Number(globalThis.getComputedStyle?.(el).zIndex) || 0;
      if (z >= bestZ) {
        best = el;
        bestZ = z;
      }
    }
    return best;
  }

  focusables(panel = this.panel()) {
    if (!panel) return [];
    return [...panel.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && !el.hidden && el.getClientRects().length > 0 && !el.closest('[hidden]'));
  }

  current(panel = this.panel()) {
    const active = this.root?.activeElement;
    return panel && active && panel.contains(active) && active !== panel ? active : null;
  }

  /** Move the focus a step through the panel. */
  step(direction) {
    const panel = this.panel();
    const list = this.focusables(panel);
    if (!list.length) return false;
    const at = list.indexOf(this.current(panel));
    const next = at < 0 ? (direction > 0 ? 0 : list.length - 1) : (at + direction + list.length) % list.length;
    list[next].focus({ preventScroll: false });
    list[next].scrollIntoView?.({ block: 'nearest' });
    list[next].classList?.add('pad-focus');
    if (at >= 0 && list[at] !== list[next]) list[at].classList?.remove('pad-focus');
    return true;
  }

  /** Left or right on a slider or a list: its value, not the focus. True if it took it. */
  adjust(direction) {
    const el = this.current();
    if (!el) return false;
    if (el.tagName === 'INPUT' && el.type === 'range') {
      const step = Number(el.step) || 1;
      const min = Number(el.min);
      const max = Number(el.max);
      const next = clamp(Number(el.value) + step * direction, Number.isFinite(min) ? min : -Infinity, Number.isFinite(max) ? max : Infinity);
      el.value = String(next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el.tagName === 'SELECT') {
      const next = clamp(el.selectedIndex + direction, 0, el.options.length - 1);
      if (next !== el.selectedIndex) {
        el.selectedIndex = next;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }
    return false;
  }

  /** A: press what has the focus — or, with nothing yet, give it to the first thing. */
  press() {
    const panel = this.panel();
    const el = this.current(panel);
    if (!el) {
      // A panel of one button - the death screen's Respawn - is that button.
      const list = this.focusables(panel);
      if (list.length === 1) {
        list[0].click();
        return true;
      }
      return this.step(1);
    }
    if (el.tagName === 'SELECT') return this.adjust(1);
    if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'button' && el.type !== 'submit') {
      // A text field: A takes it, so a keyboard on screen can come up.
      el.focus();
      return true;
    }
    el.click();
    return true;
  }
}

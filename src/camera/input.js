import { Emitter } from '../core/events.js';
import { keybinds } from '../core/keybinds.js';
import { settings } from '../core/settings.js';

/**
 * Keyboard and mouse.
 *
 * Two mouse modes, switchable live:
 *
 *  locked — pointer is captured, the mouse only looks around, and *either*
 *           button fires a rocket. This is the flying mode.
 *  pan    — the cursor stays free for the map and panels. Hold left to drag the
 *           view around, right click boosts, a plain left click lands. The two
 *           buttons can be swapped in Settings.
 */

const DRAG_THRESHOLD = 4; // pixels before a click becomes a drag

export class InputManager extends Emitter {
  constructor(canvas) {
    super();
    this.canvas = canvas;
    this.keys = new Set();
    this.pointerLocked = false;
    this.dragging = false;
    this.dragMoved = 0;
    this.dragButton = -1;
    this.suspended = false;
    this.lastPointer = { x: 0, y: 0 };

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onPointerLockChange = this.onPointerLockChange.bind(this);
    this.onBlur = this.onBlur.bind(this);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    window.addEventListener('blur', this.onBlur);

    settings.on('change', ({ key }) => {
      if (key === 'mouseMode' && settings.get('mouseMode') === 'pan') this.exitPointerLock();
    });
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Suspend gameplay input while a panel or the world map has focus. */
  setSuspended(suspended) {
    this.suspended = suspended;
    if (suspended) {
      this.keys.clear();
      this.exitPointerLock();
    }
  }

  isDown(action) {
    if (this.suspended) return false;
    const code = keybinds.codeFor(action);
    return code ? this.keys.has(code) : false;
  }

  /** Movement snapshot the controller consumes each frame. */
  movement() {
    return {
      forward: this.isDown('forward'),
      back: this.isDown('back'),
      left: this.isDown('left'),
      right: this.isDown('right'),
      jump: this.isDown('jump'),
      sprint: this.isDown('sprint'),
      crouch: this.isDown('crouch'),
    };
  }

  requestPointerLock() {
    if (settings.get('mouseMode') !== 'locked' || this.pointerLocked || this.suspended) return;
    const promise = this.canvas.requestPointerLock();
    if (promise && typeof promise.catch === 'function') promise.catch(() => {});
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  onPointerLockChange() {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    this.emit('pointerlock', this.pointerLocked);
  }

  onBlur() {
    this.keys.clear();
    this.dragging = false;
  }

  onKeyDown(event) {
    const target = event.target;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
    }

    // Let the browser keep its own shortcuts when a modifier is held.
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const actions = keybinds.actionsFor(event.code);
    if (actions.length === 0) return;

    // F-keys and space would otherwise scroll or open browser help.
    if (event.code.startsWith('F') || event.code === 'Space' || event.code === 'Tab') {
      event.preventDefault();
    }

    const first = !this.keys.has(event.code);
    this.keys.add(event.code);
    for (const action of actions) {
      this.emit('action', { id: action, repeat: !first, event });
    }
  }

  onKeyUp(event) {
    this.keys.delete(event.code);
    for (const action of keybinds.actionsFor(event.code)) {
      this.emit('actionUp', { id: action, event });
    }
  }

  onMouseDown(event) {
    if (this.suspended) return;
    const mode = settings.get('mouseMode');
    const swap = settings.get('swapMouseButtons');

    if (mode === 'locked') {
      if (!this.pointerLocked) {
        this.requestPointerLock();
        return;
      }
      // Either button boosts while the pointer is captured.
      if (event.button === 0 || event.button === 2) {
        event.preventDefault();
        this.emit('boost', { button: event.button });
      }
      return;
    }

    // Pan mode.
    const lookButton = swap ? 2 : 0;
    const boostButton = swap ? 0 : 2;
    if (event.button === lookButton) {
      this.dragging = true;
      this.dragMoved = 0;
      this.dragButton = event.button;
      this.lastPointer.x = event.clientX;
      this.lastPointer.y = event.clientY;
      this.canvas.classList.add('dragging');
    } else if (event.button === boostButton) {
      event.preventDefault();
      this.emit('boost', { button: event.button });
    }
  }

  onMouseUp(event) {
    if (!this.dragging || event.button !== this.dragButton) return;
    this.dragging = false;
    this.canvas.classList.remove('dragging');
    if (this.dragMoved < DRAG_THRESHOLD && !this.suspended) {
      // A click rather than a drag: that is the "land" action in pan mode.
      this.emit('land', {});
    }
  }

  onMouseMove(event) {
    if (this.suspended) return;
    const sensitivity = settings.get('sensitivity') * 0.0022;
    const invert = settings.get('invertY') ? -1 : 1;

    if (this.pointerLocked) {
      this.emit('look', {
        dx: event.movementX * sensitivity,
        dy: event.movementY * sensitivity * invert,
      });
      return;
    }

    if (this.dragging) {
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer.x = event.clientX;
      this.lastPointer.y = event.clientY;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      this.emit('look', { dx: dx * sensitivity * 1.4, dy: dy * sensitivity * 1.4 * invert });
    }
  }

  onWheel(event) {
    if (this.suspended) return;
    event.preventDefault();
    this.emit('wheel', { delta: Math.sign(event.deltaY), shift: event.shiftKey });
  }
}

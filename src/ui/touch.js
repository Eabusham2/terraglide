import { TOUCH_HOLD_MS, cheats } from '../core/cheats.js';
import { clamp } from '../core/math.js';

/**
 * Touch controls, for Chromebooks, tablets and phones.
 *
 * Left thumb drives a stick that moves you; anywhere on the right half of the
 * screen drags the view. Buttons cover the things you would otherwise need a
 * keyboard for. It appears on its own the first time the screen is touched, so
 * a laptop with a touchscreen still behaves like a laptop until you use it as a
 * touchscreen.
 */

const BUTTONS = [
  { id: 'boost', label: 'Boost', hint: 'rocket' },
  { id: 'jump', label: 'Jump', hold: true },
  // Held, because it is also how you dive when you are in the water.
  { id: 'dive', label: 'Dive', hold: true },
  // Named, not just numbered. It was "2x", which is a value rather than a
  // thing, and "where is speed mode on the touchscreen" was the result — it was
  // right there and did not say so.
  { id: 'speedMode', label: 'Surge' },
  // "Random", not "Teleport": on a server the toolbar's Teleport opens the
  // teleport menu, and two buttons of one name did two different things.
  { id: 'rtp', label: 'Random' },
  { id: 'worldMap', label: 'Map' },
  // Push-to-talk, on a server with voice set to push: held while you speak.
  { id: 'talk', label: 'Talk', hold: true, voice: true },
  { id: 'cheats', label: '···', cheat: true },
];

export class TouchControls {
  constructor(root) {
    this.enabled = false;
    this.onAction = null;
    this.onLook = null;
    /** (id, down) for held buttons, as they go down and come up. */
    this.onHold = null;
    this.move = { x: 0, y: 0 };
    this.held = new Set();
    this.stickTouch = null;
    this.lookTouch = null;

    this.element = document.createElement('div');
    this.element.className = 'touch';
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="touch-stick"><i></i></div>
      <div class="touch-buttons">
        ${BUTTONS.map(
          (b) =>
            `<button type="button" data-touch="${b.id}"${b.hold ? ' data-hold="1"' : ''}${
              b.cheat ? ' data-cheat="1" hidden' : ''
            }${b.voice ? ' data-voice="1" hidden' : ''}>${b.label}</button>`,
        ).join('')}
      </div>
    `;
    root.appendChild(this.element);

    this.stick = this.element.querySelector('.touch-stick');
    this.knob = this.stick.querySelector('i');

    this.bindStick();
    this.bindButtons();
    this.bindLook();
    this.bindCheatGesture();

    cheats.on('unlock', (unlocked) => this.showCheatButton(unlocked));
    this.showCheatButton(cheats.unlocked);
  }

  showTalkButton(visible) {
    const button = this.element.querySelector('[data-voice]');
    if (button.hidden === !visible) return;
    button.hidden = !visible;
    this.layout();
    // Hidden while held — voice switched off mid-sentence — lets go too.
    if (!visible && this.held.has('talk')) {
      this.held.delete('talk');
      button.classList.remove('down');
      this.onHold?.('talk', false);
    }
  }

  showCheatButton(visible) {
    this.element.querySelectorAll('[data-cheat]').forEach((button) => {
      button.hidden = !visible;
    });
    this.layout();
  }

  /**
   * How many rows of buttons there are, as --touch-rows on the page. Talk
   * comes and goes with voice and the cheat button with the cheats, and
   * either can start a row of its own: the hotbar, your hearts and the chat
   * sit above the band however tall it is, not under your thumb.
   */
  layout() {
    const shown = this.element.querySelectorAll('.touch-buttons button:not([hidden])').length;
    document.documentElement.style.setProperty('--touch-rows', String(Math.max(1, Math.ceil(shown / 2))));
  }

  /**
   * The cheat code, for a screen with no keyboard: three fingers held still on
   * the view for a moment and a half. Long enough that nothing else does it.
   */
  bindCheatGesture() {
    let timer = null;
    let origin = null;
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      origin = null;
    };

    window.addEventListener(
      'touchstart',
      (event) => {
        cancel();
        if (cheats.unlocked || event.touches.length !== 3) return;
        origin = [...event.touches].map((t) => ({ x: t.clientX, y: t.clientY }));
        timer = setTimeout(() => {
          timer = null;
          if (cheats.unlock() && this.onAction) this.onAction('cheatsUnlocked');
        }, TOUCH_HOLD_MS);
      },
      { passive: true },
    );

    // Fingers resting on glass wander a few pixels; only a real drag cancels.
    window.addEventListener(
      'touchmove',
      (event) => {
        if (!timer || !origin) return;
        for (let i = 0; i < event.touches.length && i < origin.length; i++) {
          const touch = event.touches[i];
          if (Math.hypot(touch.clientX - origin[i].x, touch.clientY - origin[i].y) > 36) {
            cancel();
            return;
          }
        }
      },
      { passive: true },
    );
    for (const type of ['touchend', 'touchcancel']) {
      window.addEventListener(type, cancel, { passive: true });
    }
  }

  /**
   * Follow whichever way the player is actually playing.
   *
   * A finger brings the controls up; a key or a mouse click puts them away
   * again. It only ever did the first half, so on anything with both — a
   * Chromebook, a touchscreen laptop, a tablet with a keyboard — one stray tap
   * pinned the sticks and buttons over the game for the rest of the session
   * with no way back. That is "the touchscreen controls do not go away when I
   * return to the keyboard".
   *
   * A coarse pointer still turns them on at startup, which is what a phone
   * wants; a phone has no keyboard to turn them off with.
   *
   * Only a real mouse press and a real key count. Pointer *movement* is not a
   * signal — plenty of touch devices synthesise mouse moves, and the controls
   * would vanish under the finger using them.
   */
  watchForTouch() {
    const enable = (event) => {
      if (event.pointerType === 'touch' || event.type === 'touchstart') this.setEnabled(true);
    };
    window.addEventListener('pointerdown', enable, { passive: true });
    window.addEventListener('touchstart', enable, { passive: true });

    const disable = (event) => {
      // A key the game uses, not any key at all: a tablet's on-screen keyboard
      // sends Enter and Backspace while you type into the map's search box.
      if (event.type === 'keydown') {
        // Typing into a box - a name in the teleport menu, a line of chat - is
        // the on-screen keyboard at work, not a return to the real one: the
        // controls stay where they are.
        if (event.target?.closest?.('input, textarea, [contenteditable="true"]')) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key.length > 1 && !/^Arrow|^Shift$|^Control$/.test(event.key)) return;
      } else if (event.pointerType !== 'mouse') {
        return;
      }
      this.setEnabled(false);
    };
    window.addEventListener('keydown', disable, { passive: true });
    window.addEventListener('pointerdown', disable, { passive: true });

    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) this.setEnabled(true);
  }

  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.element.hidden = !enabled;
    document.body.classList.toggle('touch-active', enabled);
    if (enabled) this.layout();
  }

  bindStick() {
    const rectOf = () => this.stick.getBoundingClientRect();

    const update = (touch) => {
      const rect = rectOf();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const radius = rect.width / 2;
      let dx = (touch.clientX - cx) / radius;
      let dy = (touch.clientY - cy) / radius;
      const length = Math.hypot(dx, dy);
      if (length > 1) {
        dx /= length;
        dy /= length;
      }
      this.move.x = dx;
      this.move.y = dy;
      this.knob.style.transform = `translate(${dx * radius * 0.55}px, ${dy * radius * 0.55}px)`;
    };

    const release = () => {
      this.stickTouch = null;
      this.move.x = 0;
      this.move.y = 0;
      this.knob.style.transform = '';
    };

    this.stick.addEventListener(
      'touchstart',
      (event) => {
        event.preventDefault();
        this.stickTouch = event.changedTouches[0].identifier;
        update(event.changedTouches[0]);
      },
      { passive: false },
    );
    window.addEventListener(
      'touchmove',
      (event) => {
        if (this.stickTouch === null) return;
        for (const touch of event.changedTouches) {
          if (touch.identifier === this.stickTouch) {
            event.preventDefault();
            update(touch);
          }
        }
      },
      { passive: false },
    );
    for (const type of ['touchend', 'touchcancel']) {
      window.addEventListener(type, (event) => {
        for (const touch of event.changedTouches) {
          if (touch.identifier === this.stickTouch) release();
        }
      });
    }
  }

  bindButtons() {
    this.element.querySelectorAll('[data-touch]').forEach((button) => {
      const id = button.dataset.touch;
      const hold = button.dataset.hold === '1';
      button.addEventListener(
        'touchstart',
        (event) => {
          event.preventDefault();
          button.classList.add('down');
          if (hold) {
            this.held.add(id);
            this.onHold?.(id, true);
          } else if (this.onAction) this.onAction(id);
        },
        { passive: false },
      );
      const up = () => {
        button.classList.remove('down');
        if (this.held.delete(id)) this.onHold?.(id, false);
      };
      button.addEventListener('touchend', up);
      button.addEventListener('touchcancel', up);
    });
  }

  bindLook() {
    const canvas = document.getElementById('viewport');
    if (!canvas) return;
    let last = null;

    canvas.addEventListener(
      'touchstart',
      (event) => {
        if (!this.enabled) return;
        const touch = event.changedTouches[0];
        // The left third belongs to the stick; the rest looks around.
        if (touch.clientX < window.innerWidth * 0.33) return;
        this.lookTouch = touch.identifier;
        last = { x: touch.clientX, y: touch.clientY };
      },
      { passive: true },
    );

    canvas.addEventListener(
      'touchmove',
      (event) => {
        if (!this.enabled || this.lookTouch === null || !last) return;
        for (const touch of event.changedTouches) {
          if (touch.identifier !== this.lookTouch) continue;
          event.preventDefault();
          const dx = touch.clientX - last.x;
          const dy = touch.clientY - last.y;
          last = { x: touch.clientX, y: touch.clientY };
          if (this.onLook) this.onLook(dx * 0.0045, dy * 0.0045);
        }
      },
      { passive: false },
    );

    for (const type of ['touchend', 'touchcancel']) {
      canvas.addEventListener(type, (event) => {
        for (const touch of event.changedTouches) {
          if (touch.identifier === this.lookTouch) {
            this.lookTouch = null;
            last = null;
          }
        }
      });
    }
  }

  /** Movement contribution, merged with the keyboard by the input manager. */
  movement() {
    if (!this.enabled) return null;
    const dead = 0.18;
    return {
      forward: this.move.y < -dead,
      back: this.move.y > dead,
      left: this.move.x < -dead,
      right: this.move.x > dead,
      jump: this.held.has('jump'),
      sprint: Math.hypot(this.move.x, this.move.y) > 0.85,
      // Dive is crouch: it sinks you in water and drops the nose in the air.
      crouch: this.held.has('dive'),
    };
  }

  get magnitude() {
    return clamp(Math.hypot(this.move.x, this.move.y), 0, 1);
  }
}

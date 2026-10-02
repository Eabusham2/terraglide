/** Minimal event emitter. */
export class Emitter {
  constructor() {
    this.handlers = new Map();
  }

  /** Returns an unsubscribe function. */
  on(event, fn) {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  emit(event, payload) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[terraglide] handler for "${String(event)}" threw`, err);
      }
    }
  }

  clear() {
    this.handlers.clear();
  }
}

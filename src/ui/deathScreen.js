import { keybinds } from '../core/keybinds.js';
import { escapeHtml } from './worldmap.js';

/**
 * You died.
 *
 * Minecraft's screen, near enough: the world tinted red behind it, what
 * happened in one line, and one button. Respawning puts you back at the
 * world's spawn — or at your lander, off Earth, where the air is. Online the
 * server has the last word on what happened, and says how you are doing.
 */
export class DeathScreen {
  constructor(root) {
    this.open = false;
    this.element = document.createElement('div');
    this.element.className = 'death-screen';
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="death-inner">
        <h1>You died!</h1>
        <p class="death-cause"></p>
        <p class="death-score"></p>
        <button type="button" class="primary" data-action="respawn">Respawn</button>
        <p class="death-hint"></p>
      </div>`;
    root.appendChild(this.element);
    this.cause = this.element.querySelector('.death-cause');
    this.score = this.element.querySelector('.death-score');
    this.hint = this.element.querySelector('.death-hint');
    this.button = this.element.querySelector('button');
    this.button.addEventListener('click', () => {
      this.button.blur();
      this.onRespawn?.();
    });
    this.onRespawn = null;
  }

  show({ message, cause, by, stats } = {}) {
    this.open = true;
    this.element.hidden = false;
    this.cause.textContent = message || describe(cause, by);
    this.score.textContent = scoreLine(stats);
    this.hint.innerHTML = `or press <kbd>${escapeHtml(keybinds.labelFor('jump'))}</kbd>`;
    // Not straight away: a hit that kills you usually arrives mid-keypress,
    // and that key should not also be the one that respawns you.
    this.button.disabled = true;
    this.readyAt = performance.now() + 900;
    setTimeout(() => {
      this.button.disabled = false;
    }, 900);
  }

  /**
   * The server's word on a death this screen already shows: the hit that did
   * it opened the screen a moment before the server said who and how, and what
   * your kills and deaths now stand at.
   */
  update({ message, cause, by, stats } = {}) {
    if (!this.open) return;
    this.cause.textContent = message || describe(cause, by);
    this.score.textContent = scoreLine(stats);
  }

  get ready() {
    return this.open && performance.now() >= (this.readyAt ?? 0);
  }

  close() {
    this.open = false;
    this.element.hidden = true;
  }
}

function describe(cause, by) {
  switch (cause) {
    case 'slain': return by ? `Slain by ${by}` : 'Slain';
    case 'drowned': return 'You drowned';
    case 'suffocated': return 'Your oxygen ran out';
    case 'kill': return by ? `You gave up fighting ${by}` : 'You gave up';
    case 'fled': return by ? `You fled from ${by}, and that counts` : 'You fled a fight, and that counts';
    default: return 'You died';
  }
}

function scoreLine(stats) {
  return stats ? `${stats.kills} ${stats.kills === 1 ? 'kill' : 'kills'} · ${stats.deaths} ${stats.deaths === 1 ? 'death' : 'deaths'}` : '';
}

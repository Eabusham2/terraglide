import { BOOT, ONLINE, relaunch } from '../core/boot.js';
import { settings } from '../core/settings.js';
import { formatDistance, formatTemperature } from '../core/units.js';
import { BODIES, BODY, aeroFactor, gravityRatio } from '../geo/bodies.js';
import { escapeHtml } from './worldmap.js';
import { BODIES_WITH_ELEVATION, PARTIAL_ELEVATION, PLANETARY_SOURCES } from '../tiles/providers.js';

/**
 * Other worlds.
 *
 * Every body you can stand on, what it is like there — how hard it pulls, how
 * much air there is to fly in, how cold it is — and a button to go. Going is
 * a reload into the new world (see core/boot.js): a second of launch screen,
 * and you arrive at a real landing site with a full tank of oxygen.
 *
 * Online the server decides, because the server keeps where you are; locally
 * you just go, and each world keeps its own save — the Moon's craters never
 * turn up on your map of Earth.
 */
export class TravelPanel {
  constructor(root, { session = null, canLeave = () => true } = {}) {
    this.session = session;
    this.canLeave = canLeave;
    this.open = false;
    this.element = document.createElement('div');
    this.element.className = 'panel travel-panel';
    this.element.hidden = true;
    root.appendChild(this.element);
    this.element.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      button.blur();
      if (button.dataset.action === 'close') this.close();
      if (button.dataset.action === 'go') this.go(button.dataset.world);
    });
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.close();
      }
    });
  }

  show() {
    this.open = true;
    this.element.hidden = false;
    this.render();
  }

  close() {
    this.open = false;
    this.element.hidden = true;
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  go(world) {
    if (!BODIES[world] || world === BOOT.world) return;
    const why = this.canLeave();
    if (why !== true) {
      this.onNotice?.(why);
      return;
    }
    this.close();
    if (ONLINE && this.session) this.session.travel(world);
    else relaunch({ world, reason: `Travelling to ${BODIES[world].name}` });
  }

  /**
   * Who is on each world: how many are online there, and by name your party
   * and then your friends, whose own lists say which world each of them is on.
   */
  whoIsWhere() {
    const out = new Map();
    const s = this.session;
    if (!ONLINE || !s) return out;
    const entry = (world) => {
      if (!out.has(world)) out.set(world, { count: 0, party: [], friends: [] });
      return out.get(world);
    };
    const me = s.you?.name?.toLowerCase();
    for (const p of s.players()) if (p.world) entry(p.world).count += 1;
    if (me) entry(BODY.id).count += 1;
    for (const m of s.party?.members ?? []) {
      if (m.key !== me && m.online && m.world) entry(m.world).party.push(m);
    }
    for (const f of s.friends?.friends ?? []) {
      if (f.online && f.world && !s.inParty(f.name)) entry(f.world).friends.push(f);
    }
    return out;
  }

  /** Who goes with you: the leader brings everyone who ticked "teleport with the party". */
  partyLine() {
    const party = ONLINE ? this.session?.party : null;
    if (!party) return '';
    const me = this.session.you?.name?.toLowerCase();
    const others = party.members.filter((m) => m.key !== me);
    if (!others.length) return '';
    if (this.session.partyLeader) {
      const coming = others.filter((m) => m.together && m.online).map((m) => escapeHtml(m.name));
      return coming.length
        ? `<p class="travel-party">Your party travels with you: ${coming.join(', ')}.</p>`
        : '<p class="travel-party">Nobody in your party has ticked "teleport with the party": you go alone.</p>';
    }
    const leader = party.members.find((m) => m.leader);
    return `<p class="travel-party">You go on your own. ${escapeHtml(leader?.name ?? 'Your leader')} leads the party, and brings whoever ticked "teleport with the party" wherever they go.</p>`;
  }

  render() {
    const units = settings.get('units');
    const where = this.whoIsWhere();
    const cards = Object.values(BODIES).map((body) => {
      const here = body.id === BODY.id;
      const g = gravityRatio(body);
      const air = aeroFactor(body);
      const airText = body.density === 0 ? 'no air — wings useless'
        : air < 0.1 ? `${(body.density / 1.225 * 100).toFixed(1)}% of Earth's air`
          : body.density > 1.225 ? `${(body.density / 1.225).toFixed(0)}x Earth's air`
            : 'breathable air';
      const temp = body.tempC == null ? 'seasons' : formatTemperature(body.tempC, units);
      // Whether the hills are real: on three moons no mission measured them,
      // and on Pluto and Charon only the side New Horizons saw.
      // How sharp its best global map is, said plainly: on Io a pixel is more
      // than a kilometre, so standing on the ground there you are standing on
      // a couple of pixels, and that is the whole of what anyone has seen.
      const deepest = PLANETARY_SOURCES[body.id]?.imagery?.[0]?.maxZoom;
      const detail = body.id === 'earth' ? 'down to street level'
        : Number.isFinite(deepest)
          ? `about ${formatDistance((2 * Math.PI * body.radius) / (256 * 2 ** deepest), units, 0)} a pixel`
          : 'coarse';
      const part = PARTIAL_ELEVATION[body.id];
      const relief = body.id === 'earth' || (BODIES_WITH_ELEVATION.includes(body.id) && !part) ? 'measured'
        : part ? `measured over ${Math.round(part * 100)}%, flat elsewhere`
          : 'never measured, so flat';
      // Who is there, online: a count, and the names you know.
      const who = where.get(body.id);
      const known = who ? [...who.party.map((m) => ['party', m]), ...who.friends.map((f) => ['friend', f])]
        .map(([tie, p]) => `<b class="tie-${tie}" style="--player:${escapeHtml(p.colour)}">${escapeHtml(p.name)}</b>`) : [];
      const people = who?.count ? `<p class="travel-people">${who.count} online here${known.length ? ` — ${known.join(', ')}` : ''}</p>` : '';
      return `
        <li class="travel-card${here ? ' here' : ''}" data-sky="${body.sky}">
          <div class="travel-name"><strong>${escapeHtml(body.name)}</strong>
            <span>${escapeHtml(body.spawn.label)}</span></div>
          <p>${escapeHtml(body.blurb)}</p>
          ${people}
          <dl>
            <dt>Gravity</dt><dd>${g >= 0.1 ? `${g.toFixed(2)}g` : `${(g * 100).toFixed(1)}% g`}</dd>
            <dt>Air</dt><dd>${airText}</dd>
            <dt>Surface</dt><dd>${escapeHtml(temp)}</dd>
            <dt>Map</dt><dd>${detail}</dd>
            <dt>Relief</dt><dd>${relief}</dd>
            <dt>Oxygen</dt><dd>${body.breathable ? 'breathe freely' : 'suit tank — refills at the base and your lander'}</dd>
          </dl>
          ${here ? '<em>You are here</em>' : `<button type="button" class="primary" data-action="go" data-world="${body.id}">Travel</button>`}
        </li>`;
    }).join('');
    this.element.innerHTML = `
      <div class="panel-head">
        <h2>Worlds</h2>
        <button type="button" class="panel-close" data-action="close">Close</button>
      </div>
      <div class="travel-body">
        <p class="travel-intro">Real photography and real altimetry from NASA's missions, on the body's own radius,
          at its own gravity. ${ONLINE ? 'Everyone on the server who is on the same world is there with you.' : 'Each world keeps its own explored map and trail.'}</p>
        ${this.partyLine()}
        <ul class="travel-list">${cards}</ul>
      </div>`;
  }
}

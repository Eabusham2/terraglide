import * as THREE from '../../vendor/three/three.module.js';
import { cheats } from '../core/cheats.js';
import { Emitter } from '../core/events.js';
import { clamp, damp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { rocketHoldPush, rocketPowerFor, rocketTicks, rocketTopSpeed } from './elytra.js';
@@MISSING 7@@
@@MISSING 8@@
@@MISSING 9@@
@@MISSING 10@@
@@MISSING 11@@
@@MISSING 12@@
@@MISSING 13@@
@@MISSING 14@@
@@MISSING 15@@
  SPEED_MODE_COOLDOWN_S,
  SPEED_MODE_SECONDS,
@@MISSING 18@@
  SURGE_BLEED_PER_S,
  SURGE_FACTOR,
  SWORD_SLOT,
@@MISSING 22@@
@@MISSING 23@@
@@MISSING 24@@
@@MISSING 25@@
@@MISSING 26@@
@@MISSING 27@@
@@MISSING 28@@
@@MISSING 29@@
 */

/**
 * The hotbar is five rockets and nothing else, and they are Minecraft's five.
 *
 * The Roman numeral is the *flight duration* tag, exactly as it is in the
 * game: Minecraft's own `10N + 6` ticks decides how long the push lasts, and
 * here it decides how hard it pushes as well, in the same proportion. Crafting
 * caps the tag at three; four and five are command-block rockets, and the
 * formula runs straight on through them.
 *
 * The label prints both, because both are now real: the burn in seconds and
 * the speed it will hold you at. Rocket I is vanilla's — a shade over thirty
 * metres a second — and Rocket V is three and a half times its push.
 */
/**
 * One colour per strength, cool to hot, so a glance tells you what you are
 * holding. The same five are used by the rocket in your hand, the hotbar icon
 * and the icon's glow, which is the point: the thing in the world and the
 * thing in the HUD have to be recognisably the same object.
 */
/** How many fireworks may burn at once. See fireRocket. */
const MAX_LIT = 12;

/**
 * How many of each rocket you carry, and how fast they come back.
 *
 * They were infinite, which is not how you fly one in Minecraft: you carry a
 * stack, each launch spends one, and running out is the thing that makes a
 * long crossing a decision rather than a held key. A stack is 64 there, so it
 * is 64 here.
 *
 * They refill because there is nothing to craft them from in a game made of
 * satellite photographs — no gunpowder, no paper, no chest to go back to. A
 * slot recovers one rocket every few seconds, per slot, so a spent Rocket V is
 * a real cost paid over minutes while a Rocket I you barely touched is always
 * there. Turn it off in Settings and they are endless again. The numbers —
 * how many, and seconds to earn one back in the slot it was spent from — live
 * with the wire protocol, since a server keeps your stock: net/protocol.js.
 */
export { ROCKET_REFILL_S, ROCKET_STACK };

export const ROCKET_COLOURS = ['#8fb8d8', '#74c47a', '#e8c54a', '#e08a35', '#d23f2f'];

export const HOTBAR = [1, 2, 3, 4, 5].map((duration) => ({
  duration,
  power: rocketPowerFor(duration),
  colour: ROCKET_COLOURS[duration - 1],
  label: `Rocket ${'I II III IV V'.split(' ')[duration - 1]}`,
  // Both halves of what this rocket is: how long it burns and how fast it
  // holds you. Measured from the flight model rather than quoted, so the label
  // cannot drift away from the physics — see rocketTopSpeed. The HUD does the
  // formatting, because whether that speed reads in km/h or mph is the
  // player's setting and this list is built once at load.
  burnSeconds: rocketTicks(duration) / 20,
  topSpeed: rocketTopSpeed(duration),
}));

/**
 * The sword, in the slot after the rockets.
 *
 * Not a rocket, so it carries no burn and no speed: what it has is what the
 * HUD prints for it and what the attack uses. See net/protocol.js for the
 * numbers it hits with — they live there because the server applies them.
 */
export const SWORD = {
  sword: true,
  label: 'Sword',
  colour: '#d7dde4',
  slot: SWORD_SLOT,
};

/** Every slot on the bar: the five rockets, then the sword. */
export const SLOTS = [...HOTBAR, SWORD];

/** The fastest any firework holds you, level: the biggest one's cruise. */
const FASTEST_CRUISE = Math.max(...HOTBAR.map((item) => item.topSpeed));

/**
 * How long speed mode runs, and how long it takes to recharge.
 *
 * Constants rather than sliders. They were both in Settings, which meant the
 * game shipped with "make the boost last a minute and recharge in five
 * seconds" sitting next to the choice of units — a cheat wearing a preference's
 * clothes. The cheat panel can still turn the cost off entirely.
 */
/**
 * Seconds of breath underwater, and how long you last after it runs out.
 *
 * Minecraft's own numbers: fifteen seconds of air, then a heart of damage
 * every second. Ten hearts at one heart a second is the ten seconds the second
 * constant has always stood for — and now that there are hearts, that is
 * literally what it is: drowning hurts, once a second, until you surface or
 * the hearts run out.
 */
export const AIR_SECONDS = 15;
export const DROWNING_SECONDS = 10;
/**
 * Suffocation and the suit's tank: the numbers live with the wire protocol,
 * because on a server the server counts the tank; see net/protocol.js.
 */
export { OXYGEN_REFILL_PER_S, OXYGEN_SECONDS, SUFFOCATION_PER_S };

@@MISSING 133@@
@@MISSING 134@@
@@MISSING 135@@
@@MISSING 136@@
@@MISSING 137@@
export { SPEED_MODE_COOLDOWN_S, SPEED_MODE_SECONDS, SURGE_FACTOR };
@@MISSING 139@@
@@MISSING 140@@
@@MISSING 141@@
@@MISSING 142@@
@@MISSING 143@@
@@MISSING 144@@
@@MISSING 145@@
@@MISSING 146@@
@@MISSING 147@@
@@MISSING 148@@
@@MISSING 149@@
@@MISSING 150@@
@@MISSING 151@@
@@MISSING 152@@
@@MISSING 153@@
@@MISSING 154@@
@@MISSING 155@@
@@MISSING 156@@
@@MISSING 157@@
@@MISSING 158@@
@@MISSING 159@@
@@MISSING 160@@
@@MISSING 161@@
@@MISSING 162@@
@@MISSING 163@@
@@MISSING 164@@
@@MISSING 165@@
@@MISSING 166@@
@@MISSING 167@@
@@MISSING 168@@
@@MISSING 169@@
@@MISSING 170@@
@@MISSING 171@@
@@MISSING 172@@
@@MISSING 173@@
@@MISSING 174@@
@@MISSING 175@@
@@MISSING 176@@
@@MISSING 177@@
@@MISSING 178@@
@@MISSING 179@@
    this.lon = 0;

    this.elytraDeployed = false;
    this.swimming = false;
    /**
     * Air left, in seconds. Minecraft gives you fifteen seconds of held
     * breath and then hurts you twice a second; this holds the fifteen and
     * spends the drowning on getting you out of the water rather than on a
     * health bar the game does not otherwise have.
     */
    this.airSeconds = AIR_SECONDS;
    this.drowned = false;
    /**
     * The suit's tank, seconds. Only spent where the air cannot be breathed —
     * see OXYGEN_SECONDS. `oxygenSource` is set while you stand at your
     * lander, which is where it fills back up.
     */
    this.oxygen = OXYGEN_SECONDS;
    this.oxygenSource = false;
    this.needsSuit = !BODY.breathable;

    /**
     * Hearts, Minecraft's twenty half-hearts.
     *
     * There was no health here at all: drowning ended in a teleport, and
     * nothing else could hurt you. Fighting is what changed that — on a server
     * people can now hit each other — and an empty tank on the Moon has to
     * cost something real. Locally your own machine keeps the count; online
     * the server does (`authority`), and this only mirrors what it says, so a
     * modified page cannot heal itself.
     */
    this.health = MAX_HEALTH;
    this.maxHealth = MAX_HEALTH;
    this.dead = false;
    /** 'local' counts its own damage; 'server' asks for it and waits to be told. */
    this.authority = 'local';
    this.clock = 0;
    this.lastHurtAt = -Infinity;
    this.regenTimer = 0;
    this.suffocateTimer = 0;
    /** Swings of the sword since the start, so a remote copy can see every one. */
    this.swings = 0;
    this.lastSwingAt = -Infinity;

    /**
     * Every firework still burning, not just the last one lit.
     *
     * A firework in Minecraft is an entity, and every one of them applies its
     * own push on every tick it is alive for. Light a second while the first is
     * still going and both push — which is why spamming them makes you faster
     * there and did nothing here, where lighting one simply restarted a single
     * timer. Each entry keeps the power it was lit with, too, so a rocket in
     * flight is the rocket you lit rather than whichever slot you have since
     * scrolled to.
     */
    this.rockets = [];
    /**
     * What the burning fireworks can do against the air this tick: how hard
     * they push (m/s a tick) and up to what speed. See burnRockets.
     */
    this.rocketHold = 0;
    this.rocketHoldSpeed = 0;
    /** How many of each hotbar rocket you are carrying. See ROCKET_STACK. */
    this.stock = HOTBAR.map(() => ROCKET_STACK);
    /** Fractional progress towards the next one in each slot. */
    this.refill = HOTBAR.map(() => 0);
    this.rocketDuration = 0;
    this.rocketsFired = 0;

    this.speedActive = false;
    this.speedRemaining = 0;
    this.speedCooldown = 0;
    /**
     * What speed mode is actually worth right now, eased rather than switched.
     * See tickTimers.
     */
    this.speedBlend = 1;

    this.selectedSlot = 0;
    this.distanceTravelled = 0;
    this.airborneSeconds = 0;
  }

  get scale() {
    // A cheat now rather than a setting — see CHEAT_DEFAULTS.
    return clamp(cheats.playerScale, 0.25, 60);
  }

  /** Standing height in metres (6 ft at scale 1). */
  get height() {
    return settings.get('playerHeightM') * this.scale;
  }

  get eyeHeight() {
    return this.height * 0.94;
  }

  get radius() {
    // A person, not a barrel. 0.21 of standing height is an 0.83 m wide capsule
    // on a six-foot-six frame — you could not walk between two bollards, and
    // pressed against a wall your shoulder was half a metre inside it. Real
    // shoulder breadth is about 0.23 of height, so half of that is the honest
    // radius. That is "the player width does not feel real", and it is the same
    // complaint as feeling too big.
    return Math.max(0.2, this.height * 0.12);
  }

  /**
   * How fast you are actually travelling, metres a second.
   *
   * The velocity times the speed multiplier, because that is what the
   * controller moves you by: `position += velocity * step * multiplier`. This
   * returned the bare velocity, so with speed mode running — the whole point
   * of which is to cover twice the ground — the readout showed half of what
   * you were doing, and `distanceTravelled` a few lines away in the controller
   * already used the multiplied figure. Two answers to one question, in one
   * file.
   */
  get speed() {
    return this.velocity.length() * this.speedMultiplier;
  }

  /** The same, flattened. */
  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z) * this.speedMultiplier;
  }

  /** Velocity as the flight model sees it, before speed mode stretches it. */
  get modelSpeed() {
    return this.velocity.length();
  }

  get altitudeAboveGround() {
    return this.position.y - this.groundHeight;
  }

  get selectedItem() {
    return HOTBAR[this.selectedSlot];
  }

  /** Is the sword in your hand rather than a rocket? */
  get holdingSword() {
    return this.selectedSlot === SWORD_SLOT;
  }

  /**
   * Take damage. Returns how much was actually taken.
   *
   * @param {number} amount half-hearts
   * @param {{cause?: string, by?: string}} [how]
   */
  damage(amount, how = {}) {
    if (this.dead || !(amount > 0)) return 0;
    if (this.authority === 'server') {
      // Asked for, not taken: the server keeps the count online, and says
      // what it came to. Drowning and an empty tank still happen here — the
      // server cannot see water or know where your lander is — so this is how
      // it hears about them.
      this.emit('damageRequest', { amount, ...how });
      return 0;
    }
    const taken = Math.min(this.health, amount);
    this.health -= taken;
    this.lastHurtAt = this.clock;
    this.regenTimer = 0;
    this.emit('hurt', { amount: taken, health: this.health, ...how });
    if (this.health <= 0) this.die(how);
    return taken;
  }

  /** Mirror the server's count. Online only. */
  setHealth(health, how = {}) {
    const next = clamp(Number(health) || 0, 0, this.maxHealth);
    const lost = this.health - next;
    this.health = next;
    if (lost > 0) {
      this.lastHurtAt = this.clock;
      this.emit('hurt', { amount: lost, health: next, ...how });
    }
    if (next <= 0 && !this.dead) this.die(how);
  }

  die(how = {}) {
    if (this.dead) return;
    this.health = 0;
    this.dead = true;
    this.stopRockets();
    this.emit('died', how);
  }

  /** Back on your feet with full hearts and a full tank. */
  revive() {
    this.dead = false;
    this.health = this.maxHealth;
    this.airSeconds = AIR_SECONDS;
    this.oxygen = OXYGEN_SECONDS;
    this.drowned = false;
    this.lastHurtAt = -Infinity;
    this.suffocateTimer = 0;
    this.stock = HOTBAR.map(() => ROCKET_STACK);
    this.emit('revived', {});
  }

  /** A knock, metres a second, added straight onto how you are moving. */
  knock(x, y, z) {
    this.velocity.x += x;
    this.velocity.y += y;
    this.velocity.z += z;
    if (y > 0) this.onGround = false;
  }

  /**
   * How far a second of movement carries you. Speed mode, then any cheat.
   *
   * This is the *only* place speed mode multiplies anything. It used to also
   * double the firework's thrust, and since thrust feeds velocity and velocity
   * feeds this, the two compounded: a rocket lit in speed mode went four times
   * as fast as one lit without it, over four times the ground, which is where
   * the stutter came from — the terrain was being asked to stream in at four
   * times the rate the budget was written for. Two is two.
   */
  get speedMultiplier() {
    return this.speedBlend * cheats.playerSpeed;
  }

  /**
   * Firework thrust: the slot's powder, speed mode, and any cheat on top.
   *
   * Speed mode doubles the rocket as well as the running, which is the whole
   * reason to save one for it — light a Rocket V inside the burst and you get
   * the two multiplied rather than the better of the two. It reads the same
   * blend the movement does, not a hard two, so a rocket lit while the boost
   * is bleeding away gets whatever is left of it. That is also what lets a
   * firework hold the boost up past the end of the burst: the burn slows the
   * bleed, and the bleed is what the rocket is multiplied by.
   */
  get rocketPower() {
    const slot = HOTBAR[this.rocketSlot];
    return (slot ? slot.power : 1) * this.speedBlend * cheats.rocketPower;
  }

  /**
   * How long the longest burn still running has left, in ticks.
   *
   * Kept as a plain reading because that is all anyone outside wanted of it —
   * the HUD asks whether a rocket is lit, the autopilot asks whether it may
   * light another. Neither wants to know there are three.
   */
  get rocketTicksLeft() {
    let most = 0;
    for (const rocket of this.rockets) most = Math.max(most, rocket.left);
    return most;
  }

  /** Put every burning firework out. */
  stopRockets() {
    this.rockets.length = 0;
    this.rocketHold = 0;
    this.rocketHoldSpeed = 0;
  }

  /**
   * Advance every burning firework by a tick, pushing once for each.
   *
   * @param {(power:number, spent:number, steer:boolean) => void} push
   */
  burnRockets(push) {
    // What the burning fireworks can do against the air this tick: the most
    // any of them can push, up to the fastest you lit one at. Not summed - a
    // second firework is not a second engine. See rocketHoldPush, and
    // PlayerController.tickGlide, which applies it.
    this.rocketHold = 0;
    this.rocketHoldSpeed = 0;
    if (this.rockets.length === 0) return;
    const bleed = this.speedBlend * cheats.rocketPower;
    let first = true;
    for (const rocket of this.rockets) {
      this.rocketHold = Math.max(this.rocketHold, rocket.holdPush ?? 0);
      this.rocketHoldSpeed = Math.max(this.rocketHoldSpeed, rocket.holdSpeed ?? 0);
      // Only the first one in a tick steers; see stepRocket. Pressing the key
      // again should push harder, not turn you further.
      push(rocket.power * bleed, 1 - rocket.left / rocket.total, first);
      first = false;
      rocket.left -= 1;
    }
    this.rockets = this.rockets.filter((rocket) => rocket.left > 0);
  }

  /** Unit vector the player is looking along. */
  lookVector(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(cp * Math.sin(this.yaw), Math.sin(this.pitch), -cp * Math.cos(this.yaw));
  }

  selectSlot(index) {
    const next = clamp(index, 0, SLOTS.length - 1);
    if (next === this.selectedSlot) return;
    if (this.selectedSlot < HOTBAR.length) this.lastRocketSlot = this.selectedSlot;
    this.selectedSlot = next;
    this.emit('hotbar', next);
  }

  cycleSlot(delta) {
    const count = SLOTS.length;
    this.selectSlot((((this.selectedSlot + delta) % count) + count) % count);
  }

  /** Move the player to a geodetic position, snapping to the given ground height. */
  teleport(lat, lon, groundHeight, clearance = 2) {
    this.frame.setAnchor(lat, lon);
    this.position.set(0, groundHeight + clearance, 0);
    this.snapRender();
    this.velocity.set(0, 0, 0);
    this.lat = lat;
    this.lon = lon;
    this.groundHeight = groundHeight;
    this.elytraDeployed = false;
    this.stopRockets();
    this.onGround = true;
    this.emit('teleport', { lat, lon });
  }

  /** Draw where you actually are — after a teleport, a rebase, or a hold. */
  snapRender() {
    this.renderPosition.copy(this.position);
  }

  /**
   * Where you are, in degrees — from where you are *drawn*, not from where the
   * physics has got to.
   *
   * They are not the same place. Physics runs on a fixed twentieth of a second
   * and the world is drawn somewhere between the last two ticks, so the drawn
   * position trails the physics one by up to a whole tick. Reading the physics
   * position and handing it to the minimap put the marker ahead of the ground
   * under it by exactly that much: nothing at walking pace, but 5.35 m on a
   * Rocket V, which at the minimap's own scale is six or seven pixels of the
   * map sliding out from under you the faster you go.
   *
   * renderPosition is set before this is called, and a teleport snaps them
   * together, so this is the drawn answer at every moment there is one.
   */
  syncGeo() {
    const geo = this.frame.toGeo(this.renderPosition.x, this.renderPosition.z);
    this.lat = geo.lat;
    this.lon = geo.lon;
    return geo;
  }

  /** Deploy or stow the wings. Returns the resulting state. */
  toggleElytra(force) {
    const next = force !== undefined ? force : !this.elytraDeployed;
    this.elytraDeployed = next;
    this.emit('elytra', next);
    return next;
  }

  /**
   * Fire the selected rocket. No cooldown and no timer: like the real thing,
   * you can light another one whenever you want, and lighting one mid-burn
   * simply restarts the burn.
   */
  /** How many of the selected rocket are left, or Infinity when endless. */
  get rocketsLeft() {
    // On a server every rocket counts: endless ones there are an advantage
    // over everybody else in the air, which makes them a cheat, not a taste.
    if ((settings.get('rocketSupply') === 'unlimited' && this.authority !== 'server') || cheats.rocketFree) {
      return Infinity;
    }
    return this.stock[this.rocketSlot] ?? 0;
  }

  /**
   * Which rocket fires when you light one.
   *
   * The one in your hand, or — with the sword in your hand — the last rocket
   * you held, so you can boost out of a fight without putting the blade away.
   */
  get rocketSlot() {
    return this.holdingSword ? (this.lastRocketSlot ?? 0) : this.selectedSlot;
  }

  fireRocket() {
    const item = HOTBAR[this.rocketSlot];
    const duration = item ? item.duration : 2;
    if (!this.elytraDeployed) return false;
    // You have to have one. Spending the last of a slot is allowed; spending
    // one you do not have is not, and it says so rather than failing silently.
    if (this.rocketsLeft <= 0) {
      this.emit('outOfRockets', { slot: this.rocketSlot });
      return false;
    }
    if (Number.isFinite(this.rocketsLeft)) this.stock[this.rocketSlot] -= 1;
    const total = rocketTicks(duration);
    // Its own power, taken now: a firework in flight is the one you lit, not
    // whichever slot you have scrolled to since.
    // And how fast you were when it was lit, which it can hold you to for its
    // burn, and how hard it can push to. See rocketHoldPush. Held only up to
    // what a firework could have got you to - the fastest cruise there is, as
    // strong as fireworks are right now - because speed past that came from a
    // dive, and a dive's speed is the air's to take back. Holding it as well
    // let a dive-and-climb with the key held sustain 260 m/s.
    const ceiling = FASTEST_CRUISE * this.speedBlend * cheats.rocketPower;
    this.rockets.push({
      left: total, total, power: item ? item.power : 1,
      holdSpeed: Math.min(this.velocity.length(), ceiling),
      holdPush: rocketHoldPush(item ? item.topSpeed : rocketTopSpeed(1)),
    });
    // Enough that no human can reach it and small enough to bound the work.
    // Minecraft has no limit because a player cannot light them fast enough to
    // need one; a held key and a cheat can.
    if (this.rockets.length > MAX_LIT) this.rockets.shift();
    this.rocketDuration = duration;
    this.rocketsFired++;
    this.emit('rocket', duration);
    return true;
  }

  /** Start the 2x burst, if it is off cooldown. */
  startSpeedMode() {
    if (this.speedActive) return false;
    if (this.speedCooldown > 0 && !cheats.speedFree) return false;
    this.speedActive = true;
    this.speedRemaining = SPEED_MODE_SECONDS;
    this.emit('speed', true);
    return true;
  }

  /** End the burst early. Only reachable with unlimited speed mode on. */
  stopSpeedMode() {
    if (!this.speedActive) return false;
    this.speedActive = false;
    this.speedRemaining = 0;
    if (!cheats.speedFree) this.speedCooldown = SPEED_MODE_COOLDOWN_S;
    this.emit('speed', false);
    return true;
  }

  /**
   * Earn spent rockets back, one slot at a time.
   *
   * Per slot rather than from a pool, so emptying the Rocket V does not cost
   * you the Rocket I you never touched. Nothing accumulates past a stack.
   */
  tickRefill(dt) {
    if (!Number.isFinite(this.rocketsLeft) && this.stock.every((n) => n >= ROCKET_STACK)) return;
    for (let i = 0; i < this.stock.length; i++) {
      if (this.stock[i] >= ROCKET_STACK) {
        this.refill[i] = 0;
        continue;
      }
      this.refill[i] += dt;
      while (this.refill[i] >= ROCKET_REFILL_S && this.stock[i] < ROCKET_STACK) {
        this.refill[i] -= ROCKET_REFILL_S;
        this.stock[i] += 1;
      }
    }
  }

  tickTimers(dt) {
    this.clock += dt;
    this.tickRefill(dt);
    // Speed mode comes on like a switch and goes off like momentum. Dropping
    // it used to halve your ground speed between one frame and the next, which
    // is not what running out of anything feels like; now it bleeds away over
    // a few seconds, and a firework still burning holds it up while it does —
    // so a well-timed rocket carries some of the boost past the end of it.
    const target = this.speedActive ? SURGE_FACTOR : 1;
    const rate = target > this.speedBlend ? 8 : this.rocketTicksLeft > 0 ? SURGE_BLEED_PER_S : 0.8;
    this.speedBlend = damp(this.speedBlend, target, rate, dt);
    // An exponential never quite arrives; a per cent is under the noise floor.
    if (Math.abs(this.speedBlend - target) < 0.01) this.speedBlend = target;

    if (this.speedActive && cheats.speedFree) {
      // Unlimited: hold the gauge full rather than counting down.
      this.speedRemaining = SPEED_MODE_SECONDS;
    } else if (this.speedActive) {
      this.speedRemaining -= dt;
      if (this.speedRemaining <= 0) {
        this.speedActive = false;
        this.speedRemaining = 0;
        this.speedCooldown = SPEED_MODE_COOLDOWN_S;
        this.emit('speed', false);
      }
    } else if (this.speedCooldown > 0) {
      this.speedCooldown = Math.max(0, this.speedCooldown - dt);
    }

    this.tickBreath(dt);
    this.tickOxygen(dt);
    this.tickRegen(dt);
  }

  /**
   * Hearts come back once you have been out of trouble for a while.
   *
   * Minecraft heals from a full hunger bar; there is no food here, so it is
   * simply time — half a heart every few seconds after a quiet spell. Only on
   * your own machine's count: online the server heals you and says so.
   */
  tickRegen(dt) {
    if (this.dead || this.authority !== 'local' || this.health >= this.maxHealth) {
      this.regenTimer = 0;
      return;
    }
    if (this.clock - this.lastHurtAt < REGEN_DELAY_S) return;
    this.regenTimer += dt;
    while (this.regenTimer >= REGEN_EVERY_S && this.health < this.maxHealth) {
      this.regenTimer -= REGEN_EVERY_S;
      this.health = Math.min(this.maxHealth, this.health + 1);
      this.emit('healed', { health: this.health });
    }
  }

  /**
   * The suit's tank, wherever there is nothing to breathe.
   *
   * Drains a second a second, twice that in a surge; fills at the lander.
   * Empty, it hurts exactly as drowning does, because it is the same thing.
   */
  tickOxygen(dt) {
    if (!this.needsSuit || this.dead) return;
    if (this.oxygenSource) {
      this.oxygen = Math.min(OXYGEN_SECONDS, this.oxygen + dt * OXYGEN_REFILL_PER_S);
      this.suffocateTimer = 0;
      return;
    }
    this.oxygen = Math.max(0, this.oxygen - dt * (this.speedActive ? 2 : 1));
    // On a server the tank is the server's: it counts it, corrects this one
    // every second, and does the suffocating itself.
    if (this.oxygen > 0 || this.authority === 'server') {
      this.suffocateTimer = 0;
      return;
    }
    this.suffocate(dt, 'suffocated');
  }

  /** A heart a second while there is nothing to breathe. */
  suffocate(dt, cause) {
    this.suffocateTimer += dt;
    while (this.suffocateTimer >= 1 && !this.dead) {
      this.suffocateTimer -= 1;
      this.damage(SUFFOCATION_PER_S, { cause });
    }
  }

  /**
   * Air, while your head is under.
   *
   * Fifteen seconds of it, Minecraft's number, and then you are in trouble.
   * Speed mode spends it four times as fast — you are covering four times the
   * water in the same lungful, so the same lungful has to be worth a quarter
   * of the distance or the boost would make diving *easier*.
   */
  tickBreath(dt) {
    const under = this.submerged;
    if (!under) {
      // Out of the water: a full breath back in a couple of seconds.
      this.airSeconds = Math.min(AIR_SECONDS, this.airSeconds + dt * (AIR_SECONDS / 2));
      this.drowned = false;
      return;
    }
    const burn = this.speedActive ? 4 : 1;
    this.airSeconds = Math.max(-DROWNING_SECONDS, this.airSeconds - dt * burn);
    if (this.airSeconds > 0) return;
    // Out of air: a heart a second until you surface or run out of hearts,
    // which from full is the ten seconds DROWNING_SECONDS always said.
    this.drowned = true;
    this.suffocate(dt, 'drowned');
  }

  /** Is your head under the water, rather than merely your feet? */
  get submerged() {
    return this.swimming && this.position.y + this.eyeHeight < 0;
  }
}

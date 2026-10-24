/**
 * What the game and its server say to each other, and the rules both ends
 * hold the other to.
 *
 * Shared, deliberately: the browser imports this through the game's module
 * graph and the Node server imports the very same file from server/. A limit
 * written down twice is a limit that drifts — the client lets you type a
 * seventeen-letter name, the server refuses it, and the message you get is
 * the server's rather than the form's. One file, one answer.
 *
 * Nothing in here touches the DOM, three.js or storage, so it loads unchanged
 * on both sides.
 *
 * The wire format is JSON text, one object per WebSocket message, with a short
 * `t` naming the type. JSON rather than a packed binary layout because every
 * message here is small, the busiest one is ten a second, and being able to
 * read a capture by eye is worth far more on a hobby server than the bytes.
 */

/** Bumped whenever a change would confuse an older client. */
export const PROTOCOL_VERSION = 1;

/* ------------------------------------------------------------------ names */

/**
 * Minecraft's rule, because it is the one everybody already knows: three to
 * sixteen letters, digits and underscores. It is also what keeps a name safe
 * to put in a command line — `/tpa Some One` would be ambiguous — and on a
 * name tag without a font that has every script in it.
 */
export const NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

/** Names nobody may take, because the game itself speaks under them. */
const RESERVED = new Set(['server', 'console', 'system', 'admin', 'terraglide', 'everyone', 'here']);

/** Why a name is not allowed, or null when it is. */
export function nameProblem(name) {
  if (typeof name !== 'string' || name.length === 0) return 'Pick a username';
  if (name.length < 3) return 'Usernames are at least 3 characters';
  if (name.length > 16) return 'Usernames are at most 16 characters';
  if (!NAME_PATTERN.test(name)) return 'Letters, numbers and _ only';
  if (RESERVED.has(name.toLowerCase())) return 'That name is reserved';
  return null;
}

/** Names are unique without regard to case: Alex and alex are one account. */
export function nameKey(name) {
  return String(name).toLowerCase();
}

/**
 * Passwords: long enough not to be a PIN, short enough that nobody is
 * hashing a novel. They are hashed with scrypt server-side and never stored.
 */
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;

export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    return `Passwords are at least ${PASSWORD_MIN} characters`;
  }
  if (password.length > PASSWORD_MAX) return `Passwords are at most ${PASSWORD_MAX} characters`;
  return null;
}

/* ------------------------------------------------------------------- chat */

/** Minecraft's own chat limit, near enough. */
export const CHAT_MAX = 256;

/**
 * How far "nearby" text chat reaches, metres.
 *
 * Text is global by default, the way a Minecraft server's chat is. The nearby
 * channel is for the people actually flying with you, and at elytra speeds
 * "with you" is a few kilometres, not the sixteen blocks a sign can be read at.
 */
export const NEAR_CHAT_M = 3000;

/* ------------------------------------------------------------------ voice */

/**
 * Proximity voice: full volume inside the first figure, silent past the
 * second, and connected a little beyond that so somebody flying into range is
 * already connected when they become audible.
 *
 * Longer than any Minecraft voice mod's default, on purpose. Those are tuned
 * for walking pace in a world of blocks; here you cross a kilometre in ten
 * seconds and the person you are talking to is a dot over the next valley.
 */
export const VOICE_FULL_M = 40;
export const VOICE_RANGE_M = 800;
export const VOICE_CONNECT_M = 1000;

/* ------------------------------------------------------------- teleports */

/** How long a /tpa or /tpahere request waits for an answer, seconds. */
export const TPA_TIMEOUT_S = 40;
/** How soon you may ask the same thing again, seconds. */
export const TPA_COOLDOWN_S = 5;

/* ----------------------------------------------------------------- combat */

/** Minecraft's twenty half-hearts. */
export const MAX_HEALTH = 20;

/**
 * The sword.
 *
 * Seven is a diamond sword's damage in Minecraft: three hits and a bit to
 * kill somebody at full health, four if one of them lands early. The cooldown
 * is Minecraft's sword cooldown (attack speed 1.6 a second), and swinging
 * before it has recharged hits for less — down to a fifth — exactly as there.
 */
export const SWORD_DAMAGE = 7;
export const ATTACK_COOLDOWN_S = 0.625;
/** Minecraft's survival reach for hitting another player, metres. */
export const REACH_M = 3;
/**
 * What the server allows on top of REACH_M before it calls a hit impossible.
 *
 * The two players were measured at different moments — each by their own
 * machine, a round trip apart — and at glide speeds a round trip is metres.
 * The server rewinds the target to when the attacker saw them (see
 * server/game.mjs), and this is the error that is left after that.
 */
export const REACH_SLACK_M = 2.5;
/** A falling hit lands half again as hard. */
export const CRIT_MULTIPLIER = 1.5;
/** After a hit you cannot be hit again for this long, seconds. Minecraft's ten ticks. */
export const HURT_IMMUNE_S = 0.5;
/**
 * Knockback, metres a second: Minecraft's 0.4 blocks a tick sideways and up.
 * A sprinting or diving hit adds the second figure on top.
 */
export const KNOCKBACK_MPS = 8;
export const KNOCKBACK_SPRINT_MPS = 6;
/** Seconds after dealing or taking damage that you count as in a fight. */
export const COMBAT_TAG_S = 10;
/**
 * Health comes back on its own once you have been out of a fight for a while:
 * half a heart every few seconds. There is no food here to regenerate from.
 */
export const REGEN_DELAY_S = 8;
export const REGEN_EVERY_S = 3;

/* ------------------------------------------------------------------ items */

/** Hotbar slots 0–4 are the five rockets; this one is the sword. */
export const SWORD_SLOT = 5;

/* ------------------------------------------------------------------ state */

/**
 * What a player is doing, as bits, so a snapshot carries it in one number.
 */
/**
 * Surge: what it is worth, how long it runs, and how long it takes back.
 *
 * It was called "speed mode", which is a label for a checkbox rather than a
 * name for a thing you spend. Surge is what it does — you get it, it runs out,
 * you wait.
 *
 * All three numbers moved together, because they only make sense together: a
 * fifth again on the boost and a fifth again on the burn, and a third off the
 * wait so it is something you use rather than something you hoard.
 *
 *   worth      2.0x  ->  2.4x
 *   runs for   10 s  ->  12 s
 *   recharges  45 s  ->  30 s
 */
export const SURGE_FACTOR = 2.4;
export const SPEED_MODE_SECONDS = 12;
export const SPEED_MODE_COOLDOWN_S = 30;
/**
 * How fast a surge's extra fades once it is over, per second, at the slowest:
 * with a firework still burning. See Player.tickTimers.
 */
export const SURGE_BLEED_PER_S = 0.25;

/** What drowning or an empty oxygen tank costs, half-hearts a second. */
export const SUFFOCATION_PER_S = 2;

/**
 * The suit's oxygen, seconds, everywhere you cannot breathe.
 *
 * Five minutes: long enough to fly somewhere worth seeing and back, short
 * enough that the lander is a place you have to keep in mind. It refills at
 * the lander or the base — within REFILL_M of either, on the ground — far
 * faster than it drains, so stopping by is a few seconds rather than a wait.
 * On a server the server counts it. A surge burns it twice as fast, for the same
 * reason it burns your breath faster underwater: four times the ground on the
 * same tank has to cost something.
 */
export const OXYGEN_SECONDS = 300;
export const OXYGEN_REFILL_PER_S = 40;
/** Rockets carried of each kind, and seconds for one to come back. See Player. */
export const ROCKET_STACK = 64;
export const ROCKET_REFILL_S = 4;
/** How often a lander can be moved, seconds. */
export const LANDER_EVERY_S = 30;
/** How close to your lander or the base the suit refills, metres, on the ground. */
export const REFILL_M = 40;
/** "On the ground" for refilling: within this many metres of it. */
export const REFILL_AGL_M = 30;

export const FLAG = {
  ground: 1,
  elytra: 2,
  swim: 4,
  rocket: 8,
  surge: 16,
  crouch: 32,
  sprint: 64,
  dead: 128,
  talking: 256,
  /** Flips on every swing, so a swing between two snapshots is never lost. */
  swing: 512,
  hurt: 1024,
  /**
   * The first state from a tab back from the background, which flies none of
   * the time it was hidden (src/game.js). See fadeReserve in server/game.mjs.
   */
  woke: 2048,
};

/**
 * Turn a player's own state into the message that carries it.
 *
 * @param {object} s
 * @param {number} s.lat
 * @param {number} s.lon
 * @param {number} s.alt   metres above the datum (the y of the local frame)
 * @param {number} s.agl   metres above the ground under them
 * @param {number[]} s.vel [east, up, north] metres a second
 * @param {number} s.yaw
 * @param {number} s.pitch
 * @param {number} s.roll
 * @param {number} s.flags
 * @param {number} s.item
 * @param {number} s.seq
 */
export function encodeState(s) {
  return {
    t: 's',
    q: s.seq | 0,
    p: [round(s.lat, 7), round(s.lon, 7), round(s.alt, 2)],
    g: round(s.agl, 1),
    v: [round(s.vel[0], 2), round(s.vel[1], 2), round(s.vel[2], 2)],
    o: [round(s.yaw, 3), round(s.pitch, 3), round(s.roll, 3)],
    f: s.flags | 0,
    i: s.item | 0,
  };
}

/**
 * Read one back, refusing anything that is not a well-formed state.
 *
 * Returns null rather than a half-filled object: a position with a NaN in it
 * would sail through every distance check there is, because NaN compares
 * false with everything, and come out the other side as a player standing
 * everywhere at once.
 */
export function decodeState(m) {
  if (!m || !Array.isArray(m.p) || !Array.isArray(m.v) || !Array.isArray(m.o)) return null;
  const [lat, lon, alt] = m.p.map(Number);
  const [ve, vu, vn] = m.v.map(Number);
  const [yaw, pitch, roll] = m.o.map(Number);
  const agl = Number(m.g);
  const numbers = [lat, lon, alt, ve, vu, vn, yaw, pitch, roll, agl];
  if (!numbers.every(Number.isFinite)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 540) return null;
  if (Math.abs(alt) > 200000 || Math.abs(agl) > 200000) return null;
  if (Math.abs(ve) > 5000 || Math.abs(vu) > 5000 || Math.abs(vn) > 5000) return null;
  return {
    seq: Number(m.q) | 0,
    lat,
    lon: wrapLon(lon),
    alt,
    agl,
    vel: [ve, vu, vn],
    yaw,
    pitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch)),
    roll,
    flags: Number(m.f) | 0,
    item: Math.max(0, Math.min(SWORD_SLOT, Number(m.i) | 0)),
  };
}

/** One row of a snapshot: [id, lat, lon, alt, yaw, pitch, roll, ve, vu, vn, flags, item, health]. */
export function snapshotRow(id, s, health) {
  return [
    id,
    round(s.lat, 7),
    round(s.lon, 7),
    round(s.alt, 2),
    round(s.yaw, 3),
    round(s.pitch, 3),
    round(s.roll, 3),
    round(s.vel[0], 2),
    round(s.vel[1], 2),
    round(s.vel[2], 2),
    s.flags | 0,
    s.item | 0,
    health,
  ];
}

export function readSnapshotRow(row) {
  if (!Array.isArray(row) || row.length < 13) return null;
  const n = row.map(Number);
  if (!n.slice(1, 10).every(Number.isFinite)) return null;
  return {
    id: n[0],
    lat: n[1],
    lon: n[2],
    alt: n[3],
    yaw: n[4],
    pitch: n[5],
    roll: n[6],
    vel: [n[7], n[8], n[9]],
    flags: n[10] | 0,
    item: n[11] | 0,
    health: n[12],
  };
}

/* ---------------------------------------------------------------- colours */

/**
 * A colour for somebody new, as far from everybody else's as it can be.
 *
 * Random was asked for, and random on its own is how two of the five people
 * on a server end up the same green. So the hue is random within whichever
 * gap between the colours already taken is widest — still a surprise, never
 * a twin. Saturation and lightness are fixed where a dot on a satellite photo,
 * a line across the sea and a name over somebody's head all stay readable.
 *
 * @param {string[]} taken '#rrggbb' colours already in use
 * @param {() => number} rng
 */
export function pickColour(taken = [], rng = Math.random) {
  const hues = taken.map(hexToHue).filter(Number.isFinite).sort((a, b) => a - b);
  let hue;
  if (hues.length === 0) {
    hue = rng() * 360;
  } else {
    let bestStart = hues[hues.length - 1];
    let bestGap = hues[0] + 360 - bestStart;
    for (let i = 1; i < hues.length; i++) {
      const gap = hues[i] - hues[i - 1];
      if (gap > bestGap) {
        bestGap = gap;
        bestStart = hues[i - 1];
      }
    }
    // Somewhere in the middle half of the widest gap.
    hue = (bestStart + bestGap * (0.25 + rng() * 0.5)) % 360;
  }
  return hslToHex(hue, 0.78, 0.6);
}

/**
 * How different two colours look, as a person sees them: red-weighted RGB
 * distance ("redmean"), 0 for the same colour and about 765 for black and
 * white. Plain RGB distance calls two greens far apart that nobody can tell.
 */
export function colourDistance(a, b) {
  const p = hexToRgb(a);
  const q = hexToRgb(b);
  if (!p || !q) return Infinity;
  const r = (p[0] + q[0]) / 2;
  const dr = p[0] - q[0];
  const dg = p[1] - q[1];
  const db = p[2] - q[2];
  return Math.sqrt((2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db);
}

/** Closer than this, two players' colours are twins: one dot looks like the other. */
export const TWIN_DISTANCE = 70;

/**
 * A colour as unlike every colour in `taken` as any on offer: hues every five
 * degrees at three lightnesses, the one whose nearest neighbour is farthest,
 * with a little randomness so two people joining at once differ. Where there
 * are few colours yet, the plain random pick is just as good.
 */
export function distinctColour(taken = [], rng = Math.random) {
  if (taken.length === 0) return pickColour([], rng);
  let best = null;
  let bestScore = -Infinity;
  const offset = rng() * 5;
  for (let i = 0; i < 72; i++) {
    for (const l of [0.6, 0.72, 0.5]) {
      const hex = hslToHex((i * 5 + offset) % 360, l === 0.72 ? 0.7 : 0.78, l);
      let near = Infinity;
      for (const c of taken) near = Math.min(near, colourDistance(hex, c));
      const score = near + rng() * 4;
      if (score > bestScore) {
        bestScore = score;
        best = hex;
      }
    }
  }
  return best;
}

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

export function hexToHue(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  if (!m) return NaN;
  const v = parseInt(m[1], 16);
  const r = ((v >> 16) & 255) / 255;
  const g = ((v >> 8) & 255) / 255;
  const b = (v & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

export function isColour(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value));
}

/* --------------------------------------------------------------- commands */

/**
 * Every slash command, for /help, for tab completion in the chat box and for
 * the server's own dispatcher, so the three cannot disagree about what exists.
 * `args` is how the usage line reads; `player` marks which commands complete
 * a player name in their first argument.
 */
export const COMMANDS = [
  { name: 'help', args: '', help: 'List the commands' },
  { name: 'tpa', args: '<player>', help: 'Ask to teleport to a player', player: true },
  { name: 'tpahere', args: '<player>', help: 'Ask a player to teleport to you', player: true, aliases: ['tphere'] },
  { name: 'tpaccept', args: '[player]', help: 'Accept a teleport request', player: true },
  { name: 'tpdeny', args: '[player]', help: 'Refuse a teleport request', player: true },
  { name: 'tpacancel', args: '[player]', help: 'Take back a request you sent', player: true },
  { name: 'tp', args: '<player>', help: 'Same as /tpa (admins: go straight there)', player: true },
  { name: 'msg', args: '<player> <message>', help: 'Whisper to one player', player: true, aliases: ['w', 'tell'] },
  { name: 'r', args: '<message>', help: 'Reply to the last whisper' },
  { name: 'near', args: '<message>', help: 'Say something only to the players near you, not the whole server', aliases: ['l', 'local'] },
  { name: 'me', args: '<action>', help: 'Describe what you are doing' },
  { name: 'list', args: '', help: 'Who is online, and where' },
  { name: 'spawn', args: '', help: "Go back to this world's spawn" },
  { name: 'rtp', args: '', help: 'Random teleport (has a cooldown)' },
  { name: 'travel', args: '<world>', help: 'Travel to another world — /travel moon', aliases: ['planet', 'world'] },
  { name: 'kill', args: '', help: 'Give up and respawn' },
  { name: 'password', args: '<old> <new>', help: 'Change your password' },
  { name: 'friend', args: 'add|accept|deny|remove|list [player]', help: 'Friends: /friend add Alex, /friend accept, /friend list', aliases: ['friends', 'f'] },
  { name: 'party', args: 'invite|accept|deny|leave|kick|leader|list|gather|together|mark|unmark [player]', help: 'Parties: /party invite Alex, /party accept, /party leave', aliases: ['p'] },
  { name: 'pc', args: '<message>', help: 'Say something to your party', aliases: ['partychat'] },
  { name: 'kick', args: '<player> [reason]', help: 'Admin: disconnect a player', player: true, admin: true },
  { name: 'ban', args: '<player> [reason]', help: 'Admin: ban a player', player: true, admin: true },
  { name: 'unban', args: '<player>', help: 'Admin: lift a ban', admin: true },
  { name: 'heal', args: '[player]', help: 'Admin: restore health', player: true, admin: true },
  { name: 'setspawn', args: '', help: "Admin: make where you stand this world's spawn", admin: true },
  { name: 'say', args: '<message>', help: 'Admin: announce to everyone', admin: true },
];

/** Find a command by its name or one of its aliases. */
export function findCommand(word) {
  const name = String(word).toLowerCase();
  return COMMANDS.find((c) => c.name === name || (c.aliases ?? []).includes(name)) ?? null;
}

/** Split "/tpa  Alex " into { name: 'tpa', args: ['Alex'] }; null if not a command. */
export function parseCommand(text) {
  const trimmed = String(text).trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return { name: parts[0].toLowerCase(), args: parts.slice(1), rest: trimmed.slice(1 + parts[0].length).trim() };
}

/* ------------------------------------------------------------------ maths */

function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(Number(value) * f) / f;
}

function wrapLon(lon) {
  let x = (lon + 180) % 360;
  if (x < 0) x += 360;
  return x - 180;
}

/**
 * Distance between two points on a sphere of the given radius, metres —
 * along the ground, then combined with the difference in height.
 */
export function separation(a, b, radius) {
  const DEG = Math.PI / 180;
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  const ground = 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
  const dy = (b.alt ?? 0) - (a.alt ?? 0);
  return Math.hypot(ground, dy);
}

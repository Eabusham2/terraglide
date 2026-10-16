# The tail block of tools/selftest.mjs, Oct 7 lines 11118-11357 (final 11353-11592): the lines the views show
# (Oct 6 16:27 / 21:59 / 22:13, Oct 7 16:59, Oct 11 05:48) and, in each gap, lines WRITTEN BY ME to the labels and
# numbers the Oct 11 05:44 run printed. A gap's lines may not contain what the complete Oct 7 16:59 grep -i would
# have shown (oxygen|lander|gravity|aeroFactor|terminalSpeed|BODIES|planetary). Keyed by the Oct 7 line number.
FILLS = {
11118: r"""console.log('\nother worlds: the sun where the orbit puts it, and the stars');
{
  // The sun is where the world's own orbit puts it and the sky turns the way
  // the world does (src/geo/ephemeris.js: JPL's elements, the IAU's poles and
  // spins). Checked against what anyone can look up: the Moon's phases are the
  // time of day on its near side, Earth stands still in its sky, and the two
  // stars everybody knows are where they belong.
  const { skyFrame } = await import('../src/geo/ephemeris.js');
  const { STARS_BASE64, STAR_COUNT, MAG_MIN, MAG_STEP } = await import('../src/world/starCatalogue.js');
  const starsSrc = readFileSync(new URL('../src/world/stars.js', import.meta.url), 'utf8');
  const deg = 180 / Math.PI;""",
11130: r"""  // The phases of January 2024, from the almanac. The middle of the near side
  // faces Earth, so a full moon is noon there and a new moon midnight, and the
  // first quarter is sunrise.""",
11134: r"""  ok(`full moon is noon in the middle of the near side  (${full.hour.toFixed(2)} h)`, Math.abs(full.hour - 12) < 0.5);""",
11136: r"""  ok(`and new moon is midnight there  (${fresh.hour.toFixed(2)} h)`, Math.min(fresh.hour, 24 - fresh.hour) < 0.5);""",
11138: r"""  ok(`first quarter is sunrise  (${quarter.hour.toFixed(2)} h)`, Math.abs(quarter.hour - 6) < 0.5);
  // Earth does not move in the Moon's sky. From Tranquility Base, 23.5 degrees
  // east of the middle of the near side and barely north of it, it stands
  // 90 - 23.5 = 66.5 degrees up, over to the west.""",
11143: r"""  const up = Math.asin(base.parent.y) * deg;
  ok('Earth hangs 66.5 degrees up over Tranquility Base, in the west',
    Math.abs(up - 66.5) < 1 && base.parent.x < 0);
  // A star from its right ascension and declination, through the frame, to
  // altitude and azimuth in degrees (azimuth clockwise from north).
  const place = ([ra, dec], frame) => {
    const r = ra / deg, d = dec / deg;
    const v = [Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)];
    const m = frame.toScene;
    const x = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
    const y = m[3] * v[0] + m[4] * v[1] + m[5] * v[2];
    const z = m[6] * v[0] + m[7] * v[1] + m[8] * v[2];
    return [Math.asin(y) * deg, (Math.atan2(x, -z) * deg + 360) % 360];
  };
  // J2000 places from the Yale catalogue the stars are drawn from.
  const polaris = [37.95, 89.264];
  const sirius = [101.287, -16.716];""",
11161: r"""  ok(`Polaris from London stands at its latitude, due north  (${p[0].toFixed(1)}, ${p[1].toFixed(1)})`,
    Math.abs(p[0] - 51.5) < 1 && Math.min(p[1], 360 - p[1]) < 2);""",
11164: r"""  ok(`Sirius culminates in the south at midnight on New Year  (${s[0].toFixed(1)}, ${s[1].toFixed(1)})`,
    Math.abs(s[0] - (90 - 51.5 - 16.7)) < 1.5 && Math.abs(s[1] - 180) < 5);
  // The time-of-day setting turns the world under the sun rather than the sun
  // round the sky: it is that hour where you stand, on any world.""",
11169: r"""  ok('the time-of-day setting means the local hour on Mars', Math.abs(mars.hour - 10.5) < 1e-6);""",
11172: r"""  ok('on Venus the morning sun is in the west, on the Moon in the east', venus.sun.x < 0 && moon.sun.x > 0);
  ok('and every world but Earth has a pole, a spin and an orbit to be worked out from',""",
11175: r"""  // The catalogue: six bytes a star, brightest first.
  const text = atob(STARS_BASE64);
  ok(`the catalogue ships every star to magnitude 5.5  (${STAR_COUNT})`, text.length === STAR_COUNT * 6 && STAR_COUNT > 2800);
  const firstRa = (((text.charCodeAt(0) << 8) | text.charCodeAt(1)) / 65535) * 360;
  const firstMag = MAG_MIN + text.charCodeAt(4) * MAG_STEP;
  ok(`brightest first, and the brightest is Sirius  (RA ${firstRa.toFixed(1)}, mag ${firstMag.toFixed(2)})`,
    Math.abs(firstRa - 101.3) < 0.2 && Math.abs(firstMag + 1.46) < 0.05);
  // Added over the dome, not marked transparent: three draws those last of all.
  ok('the stars stay out of the transparent pass, so the ground covers them',
    /transparent: false,/.test(starsSrc) && /renderOrder = -999/.test(starsSrc));
}
""",
11188: "{",
11191: r"""  ok('Earth is one and one, so the flight model is untouched there',""",
11193: r"""  // A level glide for twenty seconds, from 30 m/s.
  const level = (e, ticks = 400) => {
    const v = { x: 0, y: 0, z: -30 };
    const look = { x: 0, y: 0, z: -1 };
    for (let t = 0; t < ticks; t++) stepGlide(v, look, 0, e);
    return { speed: Math.hypot(v.x, v.z), sink: -v.y, v };
  };
  const earth = level(env('earth'));
  ok(`Earth's glide is still Minecraft's: 30 m/s for 3 m/s of sink  (${earth.speed.toFixed(1)}, ${earth.sink.toFixed(2)})`,
    Math.abs(earth.speed - 30) < 1 && Math.abs(earth.sink - 3) < 0.1);
  const moon = level(env('moon')).v;
  ok(`on the Moon the wings do nothing: speed is kept exactly and the fall never slows  (${(-moon.z).toFixed(2)}, ${(-moon.y).toFixed(1)})`,
    Math.abs(moon.z + 30) < 1e-9 && moon.x === 0);""",
11208: r"""  const titan = level(env('titan'));
  ok(`Titan glides as flat as Earth and sinks a tenth as fast  (${(titan.speed / titan.sink).toFixed(1)} : 1 at ${titan.sink.toFixed(2)} m/s)`,
    Math.abs(titan.speed / titan.sink - earth.speed / earth.sink) < 1 && titan.sink < earth.sink / 5);
  // The controller walks and falls by the same numbers the glide uses, so a
  // fall off a cliff on the Moon is the Moon's fall too.
  const controller = readFileSync(new URL('../src/player/controller.js', import.meta.url), 'utf8');""",
11216: r"""    && /Math\.pow\(1 - \(1 - FALL_DRAG_PER_TICK\) \* this\.env\.air, step \/ TICK\)/.test(controller));
}

console.log('\nother worlds: nothing of Earth’s comes along');
{
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  const terrain = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');
  const shaders = readFileSync(new URL('../src/world/shaders.js', import.meta.url), 'utf8');
  ok('only Earth has a sea level to clamp the ground to', /const ground = ON_EARTH \? Math\.max\(0, sampled\) : sampled;/.test(game));
  ok('and nowhere else is deep enough to swim in', /if \(!BODY\.water\) return Infinity;/.test(terrain));
  ok('the ground is only ever shaded as water on Earth', /wet \*= \$\{ON_EARTH \? '1\.0' : '0\.0'\};/.test(shaders));
  // Every service that only knows about Earth is only asked on Earth.
  for (const [what, guard] of [
    ['the weather service', /if \(ON_EARTH\) \{\s*observedWeather\.fetch\(/],
    ['photogrammetry', /if \(ON_EARTH && settings\.get\('world3d'\) !== 'off'/],
    ['buildings, woods and street photographs', /const surveyed = ON_EARTH;/],
    ['the sea floor', /this\.seaFloor\.mesh\.visible = ON_EARTH;/],
    ['street addresses', /this\.address = ON_EARTH\s*\? geocoder\.lookup\(/],
  ]) ok(`${what} stay on Earth`, guard.test(game));
}

console.log('\nother worlds: the names on them');
{
  const { describePlace, featuresOn, randomFeature, searchFeatures } = await import('../src/geo/gazetteer.js');""",
11241: r"""  ok('Tranquility Base is Statio Tranquillitatis', describePlace('moon', 0.67416, 23.47232)?.label === 'Statio Tranquillitatis');
  ok('Perseverance landed in Jezero crater', describePlace('mars', 18.4447, 77.4508)?.label === 'Jezero crater');
  ok('a crater on a mare is the crater, not the mare', describePlace('moon', 25.77, -20.99)?.label === 'Lambert crater');
  ok('the map search finds Olympus Mons', searchFeatures('mars', 'olympus mons')[0]?.label === 'Olympus Mons');""",
11291: r"""  // Titan's air holds a fall to 23.5 m/s. A rocket aimed down goes past that
  // while it burns, and the air takes the extra back after, over a second or so.
  const { PlayerController } = await import('../src/player/controller.js');
  const hold = PlayerController.prototype.holdTerminal;
  const titan = { terminal: 23.5 };
  const diving = { velocity: { y: -71.5 }, rocketTicksLeft: 12 };
  hold.call(titan, diving);
  ok('a rocket aimed down through Titan\'s air goes where it is aimed', diving.velocity.y === -71.5);
  const burnt = [diving.velocity.y];
  diving.rocketTicksLeft = 0;
  for (let t = 0; t < 60; t++) { hold.call(titan, diving); burnt.push(diving.velocity.y); }
  ok(`and the air takes the extra back over a second or two  (${burnt[0].toFixed(1)} m/s, then ${burnt[60].toFixed(1)})`,
    burnt[1] < -60 && burnt[20] < -24 && Math.abs(burnt[60] + 23.5) < 0.01);
  const falling = { velocity: { y: -60 }, rocketTicksLeft: 0 };""",
}
FORBIDDEN = r'oxygen|lander|gravity|aeroFactor|terminalSpeed|BODIES|planetary'

def build(seen):
    """seen: {oct7 line number: text}. Returns the 240 lines 11118-11357, asserting every fill fits its gap."""
    import re
    out = {}
    for n, t in seen.items():
        if 11118 <= n <= 11357: out[n] = t
    for start, text in FILLS.items():
        lines = text.split('\n')
        for k, l in enumerate(lines):
            n = start + k
            assert n not in out, ('fill overlaps a seen line', n, out.get(n), l)
            assert not re.search(FORBIDDEN, l, re.I), ('a fill line the Oct 7 grep would have shown', n, l)
            out[n] = l
    missing = [n for n in range(11118, 11358) if n not in out]
    assert not missing, ('gaps left', missing)
    return [out[n] for n in range(11118, 11358)]

# TerraGlide

**Play it: <https://eabusham2.github.io/terraglide/>**

A first-person world exploration game that runs in a browser. Press one key and
you are dropped somewhere random on Earth. Open a pair of elytra, dive to build
speed, flare to trade it back for height, fire a rocket when you run out of
both — and go and look at what is down there.

It is a plain webpage: HTML, CSS and JavaScript modules. No build step, no
install, no framework. The only dependency is three.js, which is vendored into
`vendor/`.

---

## Run it

The published build is at <https://eabusham2.github.io/terraglide/> — nothing to
install, it runs in the tab.

**No internet at all?** Download
[terraglide.html](https://eabusham2.github.io/terraglide/terraglide.html) — the
whole game in one file. Save it anywhere and double-click it; no server, no
install, works on a Chromebook. It still needs a network for the map data, because
the map data is the world — there is no offline stand-in for it.

**One file, always current?** Download
[terraglide-online.html](https://eabusham2.github.io/terraglide/terraglide-online.html)
instead. It is about a kilobyte and holds no game: it loads everything from the
published site, so it never goes stale and never needs rebuilding. The two are
opposites — one carries the game and needs no network, the other needs a
network and is always the current version. The online one also gets the
photorealistic 3D route, which the offline bundle cannot carry because that
needs a module loader.

Both are build outputs rather than sources, so they are not in the source tree.
`npm run build` writes them, and every push to `main` publishes them to the
site and to the [`singlefiles`](https://github.com/eabusham2/terraglide/tree/singlefiles)
branch, where the two sit side by side with a note on which to pick.

To run the source copy: browsers refuse to load ES modules from `file://`, so
the folder has to be served over HTTP. Any static server works; one is
included:

```sh
node serve.mjs          # http://127.0.0.1:8080
node serve.mjs 3000     # or pick a port
```

or, without Node:

```sh
python3 -m http.server 8080
```

Then open the address it prints. Needs a browser with WebGL 2 (anything current).

There is nothing to install — `npm install` does nothing, because there are no
runtime dependencies. `node tools/bundle.mjs` rebuilds the single-file version.

**Touch screens** — on a phone, tablet or a Chromebook used as a tablet, an
on-screen stick and buttons appear by themselves: left thumb moves, drag the
right side to look, buttons for wings, boost, jump, dive, 2x, teleport and the
map. Dive is held: it drops the nose in the air and takes you under in water.

---

## First flight

| | |
| --- | --- |
| `W A S D` | walk |
| `Shift` / `C` | sprint / crouch — `C` also dives when you are swimming |
| `Space` | jump — **hold it while falling** to snap the wings open |
| mouse buttons / `E` | fire a rocket, which opens the wings for you (see mouse modes below) |
| `1`–`5` | rockets — the number is the burn in seconds, and the power |
| `V` | speed mode — everything at 2x for a while, then a cooldown |
| `R` | random teleport |
| `G` | world map · `M` minimap on/off · `=` / `-` minimap zoom |
| `B` | drop a waypoint · `P` copy coordinates |
| `F` | fold the wings away and fall |
| `Q` | freecam · `F5` perspective (first / third / second) · `[` / `]` shrink / grow |
| `L` | swap mouse mode · `F1` hide HUD · `F2` controls · `F3` debug · `F4` copy diagnostics · `Esc` settings |
| `O` | pause — stop the world without opening anything |

Every one of those is rebindable in **Settings → Controls**.

You are 6 ft (1.83 m) by default and can grow to about 40x, which changes
your stride, your jump and how the world reads underfoot. Deep water holds you
up — jump to rise, crouch to dive, and the sea floor is where the bottom
actually is, so you can swim down to it.

### Flying

There is one set of wings, and it is Minecraft's, transcribed from
`LivingEntity.updateFallFlyingMovement` rather than approximated:

- **Gravity** is discounted by up to three quarters while you are level, by
  `cos(pitch)²`, so pointing anywhere but flat costs you.
- **Sinking pushes you forward.** A tenth of your sink is credited back as
  speed along the way you are looking, best when level and nothing at all when
  pointed straight down.
- **A pull-up trades speed for height** at several times the rate it costs.
- **Drag** multiplies the velocity by 0.99 / 0.98 / 0.99 every tick, which is
  what sets both terminal velocities.

Every number a Minecraft player can measure comes out at Minecraft's own
figure. Level flight sinks **2.99 m/s** while making **30.2 m/s** — a
**10.1 : 1** glide. A vertical dive terminates at **78.4 m/s**. A rocket
accelerates you toward 1.5 blocks a tick along your look.

Exactly one constant differs from vanilla, and it is the one the famous
manoeuvre lives on: the climb trade, 3.2 in Minecraft and **4.5** here.

That is not a preference, it is a measurement. Sweeping this model over every
two-phase dive-and-climb cycle — every angle from one degree to eighty-five,
every cadence from a tenth of a second to twelve seconds — the best 3.2 can
manage is a **sink of 1.4 m/s**. Better than the 3.0 m/s of holding level, and
a glide stretched to twice its length, but still a glide: it ends. The reason
is structural. Diving buys *vertical* speed, only a tenth of that leaks into
forward speed each tick, and a pull-up spends *forward* speed — so the loop
leaks faster than 3.2 refills it, and the 45/45 does not close.

4.5 is where it closes, with room to fly it badly. What it changes and what it
deliberately does not:

- **unchanged** — level glide, because the term only pays with the nose up.
  Still 2.99 m/s of sink and still 10.1 : 1.
- **unchanged** — every dive, and so both terminal velocities.
- **unchanged** — holding *any* fixed angle, which still sinks: 1.1 m/s at
  ten degrees up, 2.6 m/s at forty. There is no nose-up-and-wait exploit;
  pointing at the sky is still the slowest way down.
- **changed** — a dive-and-pull cycle flown with a rhythm. Forty degrees
  down and forty up, six seconds each way, climbs at about **5 m/s**. Three
  seconds each way barely holds. A second and a half each way still loses
  2.6 m/s.

So the cadence is the skill in it, which is what makes a manoeuvre worth having
a name. All of that is checked on every build.

Rockets add energy on top. **The slot number is the burn in seconds** — a
Rocket V pushes for five of them — and it is also the powder behind it,
compounding a fifth at a time, so the step from IV to V is bigger than the step
from I to II and a Rocket V is a shade over twice a Rocket I. The push itself
accelerates you toward 1.5 blocks per tick, which is 30 m/s, and then drag
takes it back once the burn is spent. There is no cooldown; light another
whenever you like.

**Opening the wings** is Minecraft's gesture: press jump to leave the ground,
press it again while you are off it. Two presses in total — that is what a
double jump is. Pressing it once more in a glide stows them. `F` does the same
with no timing window at all, which matters on a machine slow enough that the
gap between two frames is longer than the half second you spend in the air.

Walking, jumping and falling are Minecraft's numbers: 4.32 m/s walking, 5.61
sprinting, 1.30 sneaking, a jump that clears exactly a block and a quarter, and
a fall that reaches terminal velocity instead of accelerating forever.

Speed mode multiplies *displacement*, not forces — you cover twice the ground
without the aircraft handling like a different machine. It comes on like a
switch and goes off like momentum: it bleeds away over a few seconds, and a
firework burning while it does holds it up longer.

### The two mouse modes

- **Locked pointer** (default) — the cursor is captured, the mouse only looks
  around, and *either* mouse button fires a rocket. Click the view to capture.
- **Click and pan** — the cursor stays free for the map and panels. Drag with
  left to look, right click boosts, a plain left click lands. The two buttons can
  be swapped in **Settings → Controls**.

`L` switches between them at any time.

---

## What is on screen

- **Address and coordinates**, bottom left, with a copy button, plus altitude,
  height above ground, speed, heading and what you are currently doing.
- **Seasonal temperature**, top left: the average temperature for the season you
  are standing in, from latitude, elevation, time of year and how much land
  surrounds you. It is a climate model, not a weather feed, and says so.
- **Minimap**, top right: satellite imagery for ground you have seen, and a
  drawn street map for ground you have not — so the whole world is legible,
  with named roads and coastlines where you have not been, and photography
  where you have. The boundary is what you could actually see from where you
  were, worked out from the geometric horizon at your height rather than from
  the square you were standing in, and it is feathered so it reads as a shape
  you flew rather than a staircase of tiles. It fills in behind you as you
  travel. Zoom with `=`/`-` or the wheel, click it to open the big map.
- **World map** (`G`): the same thing at any zoom, plus search, your waypoints,
  your drawn paths, and how much of the world you have covered. Drag to pan,
  wheel to zoom.
- **Your trail**: a thin line of everywhere you have been, recorded as you go
  and drawn on both maps. A teleport starts a new leg, so it never draws a line
  across an ocean you did not cross.

---

## Map data

**TerraGlide ships with no map data and no API keys.** It fetches the real thing
at run time, keyless by default: Esri World Imagery for photography, AWS Terrain
Tiles for relief, OpenStreetMap for what is standing on the ground. No account
needed to fly.

Everything you fly over is measured. There is no generated world behind it and
no fallback planet, because a fractal continent is a convincing-looking lie
about somewhere that exists.

Open **Settings → Providers** to change any of it:

| Slot | Options |
| --- | --- |
| Photorealistic 3D | Google Photorealistic 3D Tiles (needs a key), the same via Cesium ion (needs a token), or off — with a four-step detail dial |
| Imagery | Keyless: Esri World Imagery (the default), Sentinel-2 cloudless, USGS imagery (United States), NASA GIBS (this week's Earth). On a key: Google Maps, Bing Maps, Azure Maps, Maxar SecureWatch, Cesium ion imagery, Mapbox Satellite |
| Elevation | AWS Terrain Tiles (Terrarium — keyless, the default), Mapbox Terrain-RGB, Bing Maps elevation |
| Street level | Google Street View, Mapillary, or off |
| Reference map | Esri World Street Map or OpenFreeMap (OpenMapTiles vector schema), both keyless |
| Buildings | OpenStreetMap footprints, infrastructure and bridge decks via Overpass, on by default |
| Addresses | Apple Maps if a token is set, Google Geocoding if a key is set, otherwise Nominatim |

Apple is addresses only, and that is not an omission. Apple publishes no map
tiles for third-party use: MapKit JS draws its own map into its own view and
cannot be draped over terrain, and the Server API is geocoding and search. There
is no Apple satellite imagery, elevation or 3D to fetch, from any endpoint, at
any price — so the token slot buys place search and nothing else.

Requests go straight from your browser to that provider, on your quota and under
their terms — see `THIRD-PARTY.md` for the links, and read them before you switch
a provider on. Nothing is cached to disk, nothing is re-published, and the
keyless endpoints are rate limited in code because they are community services.
Attribution for whatever you have selected stays in the corner of the screen and
must not be removed.

If a provider cannot be reached, the status line says so rather than leaving you
guessing — and nothing is invented to cover for it. Missing *photography* over
measured ground is coloured from the elevation instead: height, depth below sea
level, slope and latitude, which cannot fail to line up with the land it is
painting. Missing *elevation* is left flat rather than given invented relief;
the code can tell "no data" from "sea level" and does not confuse the two.
Ground that has not arrived yet is a hole you can see the sky through, and it
stays that way until the real thing lands.

A provider you have selected but not given a key to falls back to the keyless
one in the same list rather than leaving the ground bare, and the status line
names both.

### Three tiers, most real first

1. **With a Google key or a Cesium ion token** — switch on **Settings →
   Providers → Photorealistic 3D** and you get the actual scanned world, built
   from oblique aerial photogrammetry. The buildings, the trees and the bridges
   are *in the mesh*. Nothing is placed, filled in or invented, and the game's
   own terrain, scenery and footprints step aside wherever those tiles are
   drawn. The copyright that comes back with the tiles is shown in the corner,
   because the terms require it.

   Two routes to the same dataset, so the game does not depend on one account:
   Google's own **Photorealistic 3D Tiles** on a Maps Platform key, or the same
   tiles through **Cesium ion** on an ion access token — a different provider
   with a different quota. Swapping between them drops the old session and
   reconnects.

   Microsoft is the obvious third and is not available to anyone: Flight
   Simulator gets its Bing photogrammetry through an internal agreement, Bing
   Maps never published a 3D tile API, and the platform is being retired into
   Azure Maps, which does not serve photogrammetry either. Cesium ion is the
   real equivalent, carrying the same scanned data. Azure *is* wired up for
   satellite imagery, which is the part of it that does exist — see the
   providers table above.

   Photogrammetry is far heavier than the ordinary world, so **3D detail** has
   four steps. It sets how deep the tile tree is walked, and so how many
   triangles arrive and how much is held in memory: drop it before giving up
   on 3D altogether.
2. **With no key** — everything below: real satellite imagery, real elevation,
   real OpenStreetMap buildings and land cover. None of it needs an account.
3. **With no network at all** — nothing. There is no offline world any more.
   The game boots, the sky and the flying model work, and the ground stays
   empty until it can reach a provider, because the alternative was a fictional
   planet wearing a real place's coordinates.

The 3D loaders are fetched only when you turn the option on, so a player who
never touches it never downloads them. The single-file build carries them
inlined instead — a file:// document has no module loader to resolve an
on-demand import with — and asks the published site for the Draco decoder,
which is a megabyte of WebAssembly and does not belong in a download. So the
one-file copy flies the scanned world too, given a key and a network.

### What is standing on the ground

Satellite imagery draped over elevation is flat, so the world also grows real
geometry — and every bit of it traces back to OpenStreetMap. Buildings are
extruded from surveyed footprints to surveyed heights, with the roof shape the
survey recorded; masts, chimneys, gasometers, water towers and wind turbines
stand up where they are mapped; bridge decks are lifted to their `layer` so a
viaduct is not painted onto the valley floor. **Where OSM has nothing mapped,
nothing is drawn.**

Woods are the one thing on the ground that is *not* geometry, and that is a
deliberate choice made twice over. No public dataset anywhere records where
each trunk stands, so a forest of individual trees would be a forest of
invented trees — and both attempts at standing a wood up as geometry measured
*worse* than leaving it alone, because a sheet coarse enough to be affordable
loses more of the photograph than its shading adds.

What a wood gets instead is relief in the shading. OpenStreetMap's
`natural=wood` and `landuse=forest` are rasterised into a mask that says only
*where*, and the ground shader does the rest at the photograph's own
resolution: crown-scale light and shade, shallower for the narrow regular
crowns of a conifer than for the wide lumpy ones of a broadleaf, so a forest
reads as a canopy rather than as a green wash. Nothing is built, nothing is
placed, and the ground you walk on does not move. Measured over the Black
Forest at seventy metres, contrast at crown scale went from 11.34 to 11.95
while the photograph's own pixel-scale detail held — up on both counts, where
the two geometry attempts went down. Where no wood is mapped the mask is zero
and the ground is exactly what it was, to the pixel.

Individually mapped trees are the exception — those stand exactly where the
survey put them.

Land cover comes down the same Overpass queue as the buildings, one request at
a time with a gap and a backoff, because it is a donated service.
**Settings → Graphics** turns the scenery off and sets how far it fills in —
420 m to 1.9 km depending on the preset. Beyond about 400 m the trunks thin
out with distance, so the far edge costs a fraction of the near field while
the wood still reads as a wood. Alongside them stand the things OSM maps that
are not buildings: bridges, piers, towers, masts, chimneys, water towers,
silos, gasometers, cooling towers, pylons and wind turbines, each at its
mapped height where the data records one. That layer is most of what makes a
skyline read correctly from the air, and none of it needs a key.

#### What is real, and what is not

One rule, applied in one order, everywhere:

1. **Photogrammetry**, if you have a key for it. The buildings and the trees
   are in the mesh because somebody flew over them. Everything below stands
   aside where it draws.
2. **Surveyed data**, but only for things that *have height*. OpenStreetMap
   for buildings, infrastructure and land cover; real elevation for the
   ground. A mapped wood has a real boundary; a chimney tagged 180 m is 180 m
   tall.

   Where OSM records a `height` or a storey count, that is what gets built.
   Where it does not — most buildings, globally — the height is *estimated*,
   and the estimate comes from the measured buildings **in the same square
   kilometre**: their median storey count. So a village of bungalows comes out
   as bungalows and a street of tenements as tenements, and the number is a
   statement about the neighbourhood rather than one constant applied to a
   Neapolitan alley and a Kansas warehouse alike. Where the square has nothing
   measured at all it falls back to the running median of everywhere measured
   so far; a bare two storeys is only reached where OSM has recorded nothing
   measurable for miles.

   That is a different thing from inventing a road: the survey says a building
   stands here and a building has height whether or not anyone tagged it, so
   only the measurement is estimated, never the existence.
   **Settings → World → Only build what the data measures** refuses the
   estimate and raises only what is measured; expect sparse cities. The status
   readout says what share was measured either way.

   Colour is never invented either. A roof reads the aerial photograph at
   every corner of its own footprint, so what you see on it is the picture of
   that roof stretched over that roof — half slate and half moss comes out
   half slate and half moss, and a terrace is not one flat swatch. Walls take
   the roof's hue desaturated, because nothing photographs a wall from above.
   No random tint: every colour on a building comes off the photograph of that
   building.

   Roads at ground level are deliberately **not** drawn. They are already in
   the satellite image draped over the terrain, so a ribbon on top would only
   re-draw what is there — and OSM's centreline never lines up exactly with the
   road in the photograph, so you would get two roads slightly apart. Grass,
   car parks and fields are the same: surface, not structure. Bridges are the
   exception and the reason the distinction matters: the imagery is projected
   flat, so a viaduct appears painted onto the valley floor it is meant to be
   spanning. That deck is real height the picture cannot express, so it gets
   real geometry — lifted by its OSM `layer`, with an underside.
3. **The aerial photograph**, where the survey is silent. Green is vegetation,
   grey and rough is rock — and roofs take their actual colour from the picture
   of that exact roof, so terracotta in Tuscany is terracotta. A photograph of
   a forest is evidence of a forest; this is a coarser source than a survey and
   it is used only where there is no survey.
4. **Generated**, and only then. This list is nearly empty now, and that is
   the point of keeping it: building interiors were on it and were removed —
   an invented staircase inside a real address is exactly what this list exists
   to prevent — and so was the whole-world generator. What is left is the
   crown-scale noise inside a wood the survey really put there, which decides
   how the light falls across a canopy and nothing else. It moves no ground and
   places no object.

What never happens is something invented standing in for something real: no
tree where the picture says bare rock, no relief invented under real imagery,
no made-up texture over a real photograph, and no invented coastline painted
across measured ground.

#### Where generated art is allowed

There are AI-generated textures in `assets/`, and exactly one rule governs
them: **nothing generated may stand in for real map data.**

Trees take their colour from the satellite image over the ground they stand on.
What is there is the jacket, trousers, wings and rocket, which dress *you* — no
provider on Earth publishes a photograph of your character, so there is nothing
for them to displace, and they are drawn in every mode. The
manifest keeps the two groups in separate blocks and `selftest.mjs` checks that
the gate on one and the absence of a gate on the other both survive.

The single-file build ships no assets folder at all. It asks the published site
for one at startup and falls back to flat colour when there is no network or the
host is blocked, so it is a little plainer offline and weighs a lot less either
way.

Above that there is weather — cloud cover and rain or snow for the place and
month you are in, from the same climate model as the temperature readout. It is
a climatology, not a forecast: the doldrums are cloudy, the subtropics are not,
and Antarctica is overcast and bone dry.

### How the world is put together

- **Terrain** is a mercator quadtree streamed around the camera. Tiles subdivide
  by distance, carry a dropped skirt to hide LOD seams, and bend down by
  `d²/2R` in the vertex shader so the horizon actually curves.
- **Elevation** is a separate, shallower pyramid (real DEM tiles stop around zoom
  15), sampled as a field rather than per-tile, so ground collision and the mesh
  always agree even mid-stream.
- **Street-level photography** fades in when you are near a capture point, near
  the ground and moving slowly, and fades out when you take off — which is
  exactly when a static photo would start to look wrong. Google's flat 90°
  faces are re-projected into an equirectangular strip in the worker first.
- **Buildings** are real OpenStreetMap footprints, extruded to their tagged
  height and capped with a roof the colour the aerial photograph says it is.
  They are solid: nobody publishes interior geometry for the whole planet, so
  there is nothing real to put inside them.

### Keeping it smooth

Every fetch, image decode and elevation unpack happens in a web worker. Mesh
building has a millisecond budget per frame. Texture requests are re-prioritised
every frame from what the camera wants *now*, so flying fast cancels the tiles
you flew past. A tile with no texture yet borrows its parent's with a UV window
instead of popping in as a hole. And the render scale adapts between 55% and
100% to hold your frame-rate target, which you can turn off in
**Settings → Graphics** along with render distance, maximum zoom, mesh detail,
field of view and the rest.

---

## Settings

Providers · Graphics · Controls (including full key rebinding) · Player ·
World · Minimap & HUD · Data.

Notable ones: metric or imperial units, whether random teleport may drop you at
sea, whether it goes anywhere on Earth or stays within a distance of you, time of
day (live, noon, golden hour, night, or a custom hour), and how far exploring
reveals the map.

**Providers → Test providers** knocks on every door. It fetches one real tile
from each provider, where you are standing, using whatever keys you have saved,
and reports what came back — a size and a time for the ones that answer, the
exact credential that is missing for the ones that need an account, and "does
not cover where you are standing" for a single-country product asked about the
wrong country. Each is asked at a zoom it actually publishes. It exists because
"this provider is broken" and "this provider needs an account you have not
given it" look identical from inside the game, and one tile each is a rounding
error against anybody's quota.

Three settings decide things for you rather than asking, and all three are on
by default. **Ground detail** is set to whatever the provider actually serves
rather than to a number — the streamer works that out by watching which zoom
levels answer and which only ever 404, so "as sharp as possible" means what it
says whichever provider you are on. **Render distance** finds its own: it
pushes the horizon out while there is headroom and pulls it in the moment there
is not, up to 2048 km. And the **graphics preset** is chosen by measuring.

The three sit in a fixed order, cheapest thing to give up first: pixels, then
how much world there is, then how good all of it looks. The render scale never
goes below three quarters, because a world drawn small and stretched back up is
a different, worse-looking game; past that floor the horizon comes in, and only
when there is no horizon left to give does the preset move a step — quickly
downwards, slowly back up. It says so when it does, and picking one by hand
takes it from there.

**Escape pauses.** Any menu stops the world — movement, timers and the burn on
a firework all freeze — while the frame is still drawn and tiles keep arriving,
so the ground has finished loading by the time you close it.

Everything lives in this browser's local storage — settings, key bindings,
explored ground, waypoints, paths and your last position. **Settings → Data**
exports and imports all of it as a JSON file, and clears any of it.

---

## Checking it works

```sh
node tools/check.mjs      # parse every module, verify every import resolves
node tools/selftest.mjs   # 173 checks: projection, frame, flight, the avatar, climate, water, providers
```

`tools/selftest.mjs` runs the pure maths headlessly — mercator round-trips, the
local frame's tile geometry, the glide and rocket integrators, the seasonal
temperature curve, the water classifier, the cheat code and the auto-travel
steering laws.

---

## Layout

```
index.html          the page
styles/main.css     the whole interface
serve.mjs           dependency-free static server
src/
  main.js           entry point and browser capability check
  game.js           wiring, frame loop, teleports, re-anchoring
  core/             settings, key bindings, units, storage, maths, perf, cheats
  geo/              mercator, the local world frame, sun, climate, geocoding, water
  tiles/            provider registry, worker, imagery streamer, elevation field
  world/            terrain quadtree, shaders, sky, weather, scenery, buildings,
                    panorama, teleport
  player/           state, walking and collision, elytra physics, autopilot, avatar
  camera/           camera rig, freecam, input and mouse modes
  ui/               HUD, minimap, world map, settings, cheats, help, waypoints,
                    exploration, touch controls
assets/             optional generated textures — player kit only (+ manifest)
tools/              check.mjs, selftest.mjs
vendor/three/       three.js (MIT), vendored so there is nothing to install
```

---

## Licence

**Not open source**, but you may publish it. TerraGlide is under the TerraGlide
Restricted Source Licence: source-available for reading and private use, and you
are free to host it, put it on a game site or mirror the repository **as long as
the credit "TerraGlide by Eabusham2" is visible with it**. If the publication
makes money in any way — ads, sponsorship, donations, a paywall — a clickable
link to <https://github.com/Eabusham2/terraglide> has to sit next to that credit.

Selling it, licensing it on, or bundling it into another product still needs
written permission, and none of it grants you any rights to anybody's map data.
Read `LICENSE` in full.

three.js keeps its own MIT licence (`vendor/three/LICENSE`), and every map
provider keeps theirs (`THIRD-PARTY.md`).

## Not for navigation

The world here is an approximation stitched from third-party imagery and a
simplified earth model. Do not use it to navigate anything.

# TerraGlide

A first-person world exploration game that runs in a browser. Press one key and
you are dropped somewhere random on Earth. Open a pair of elytra, dive to build
speed, flare to trade it back for height, fire a rocket when you run out of
both — and go and look at what is down there.

It is a plain webpage: HTML, CSS and JavaScript modules. No build step, no
install, no framework. The only dependency is three.js, which is vendored into
`vendor/`.

---

## Run it

Browsers refuse to load ES modules and web workers from `file://`, so the folder
has to be served over HTTP. Any static server works; one is included:

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
runtime dependencies.

---

## First flight

| | |
| --- | --- |
| `W A S D` | walk |
| `Shift` / `Ctrl` | sprint / crouch |
| `Space` | jump — **hold it while falling** to snap the wings open |
| `F` | deploy or stow the elytra |
| mouse buttons | fire a rocket (see mouse modes below) |
| `1`–`5` | rockets, flight duration I to V |
| `6` | elytra · `7` waypoint · `8` path pen · `9` tape measure |
| `V` | speed mode — everything at 2x for a while, then a cooldown |
| `R` | random teleport |
| `G` | world map · `M` minimap on/off · `=` / `-` minimap zoom |
| `B` | drop a waypoint · `N` path tool · `P` copy coordinates |
| `C` | freecam · `T` third person · `[` / `]` shrink / grow |
| `L` | swap mouse mode · `F1` hide HUD · `F2` controls · `F3` debug · `Esc` settings |

Every one of those is rebindable in **Settings → Controls**.

You are 6 ft 6 in (1.98 m) by default and can grow to about 40x, which changes
your stride, your jump and how the world reads underfoot.

### Flying

The glide model is a re-derivation of Minecraft's, at real-world scale where one
block is one metre. Gravity is scaled by the square of the cosine of your pitch,
a dive converts fall speed into forward speed, pulling up trades airspeed for
climb at a little over 3x, and your horizontal velocity is continuously steered
toward wherever you are looking. In practice: point the nose down to build to
about 120 km/h, then flare and you will climb most of it back. Rockets add thrust
along your look vector for 10·duration + 6 ticks, so a Rocket V burns for nearly
three seconds.

The elytra wears out at one point a second out of 432, like the real item. Turn
that off in **Settings → Player** if you would rather not think about it.

Speed mode multiplies *displacement*, not forces — you cover twice the ground
without the aircraft handling like a different machine.

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
- **Minimap**, top right: satellite imagery for ground you have explored, dimmed
  and hatched for ground you have not. It fills in behind you as you travel.
  Zoom with `=`/`-` or the wheel, click it to open the big map.
- **World map** (`G`): the same thing at any zoom, plus search, your waypoints,
  your drawn paths, and how much of the world you have covered. Drag to pan,
  wheel to zoom, double-click to travel there.
- **Paths**: tap `N` to drop a point, tap it twice quickly to finish the line.
  Thin lines from start to end, drawn on both maps, saved between sessions.

---

## Map data

**TerraGlide ships with no map data and no API keys.** Out of the box it renders
a generated world — a seamless fractal planet with coastlines, mountain ranges
and a snow line — so it runs with no account and no network at all.

Open **Settings → Providers** to point it at the real thing:

| Slot | Options |
| --- | --- |
| Imagery | Esri World Imagery (keyless), Google Maps, Bing Maps, Mapbox Satellite, OpenStreetMap, or the generated world |
| Elevation | AWS Terrain Tiles (keyless, the default), Mapbox Terrain-RGB, or generated relief |
| Street level | Google Street View, Mapillary, or off |
| Buildings | OpenStreetMap footprints via Overpass, on by default |
| Addresses | Google Geocoding if a key is set, otherwise Nominatim |

Requests go straight from your browser to that provider, on your quota and under
their terms — see `THIRD-PARTY.md` for the links, and read them before you switch
a provider on. Nothing is cached to disk, nothing is re-published, and the
keyless endpoints are rate limited in code because they are community services.
Attribution for whatever you have selected stays in the corner of the screen and
must not be removed.

If a provider cannot be reached, the world falls back to generated terrain and
the status line says so rather than leaving you on blank ground.

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
  height, hollow, with a door cut into the longest wall, a floor slab per storey
  and a climbable stair shaft. To be straight about it: the *outside* is real
  data and the *inside* is generated to match the footprint, because nobody
  publishes interior geometry for the whole planet. The alternative was a sealed
  box you bounce off.

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

Everything lives in this browser's local storage — settings, key bindings,
explored ground, waypoints, paths and your last position. **Settings → Data**
exports and imports all of it as a JSON file, and clears any of it.

---

## Checking it works

```sh
node tools/check.mjs      # parse every module, verify every import resolves
node tools/selftest.mjs   # 45 checks: projection, frame, flight model, climate, water
```

`tools/selftest.mjs` runs the pure maths headlessly — mercator round-trips, the
local frame's tile geometry, the glide and rocket integrators, the seasonal
temperature curve, the water classifier and the world generator.

---

## Layout

```
index.html          the page
styles/main.css     the whole interface
serve.mjs           dependency-free static server
src/
  main.js           entry point and browser capability check
  game.js           wiring, frame loop, teleports, re-anchoring
  core/             settings, key bindings, units, storage, maths, perf governor
  geo/              mercator, the local world frame, sun, climate, geocoding, water
  tiles/            provider registry, worker, imagery streamer, elevation field,
                    the offline world generator
  world/            terrain quadtree, shaders, sky, buildings, panorama, teleport
  player/           state, walking and collision, elytra physics, avatar
  camera/           camera rig, freecam, input and mouse modes
  ui/               HUD, minimap, world map, settings, help, waypoints, exploration
tools/              check.mjs, selftest.mjs
vendor/three/       three.js (MIT), vendored so there is nothing to install
```

---

## Licence

**Not open source.** TerraGlide is under the TerraGlide Restricted Source
Licence — source-available for reading and private use only, no redistribution,
no commercial use, no hosting where anyone else can reach it, and no using it to
scrape or re-publish anybody's map data. Read `LICENSE` in full; ask first if you
want anything beyond it.

three.js keeps its own MIT licence (`vendor/three/LICENSE`), and every map
provider keeps theirs (`THIRD-PARTY.md`).

## Not for navigation

The world here is an approximation stitched from third-party imagery, a
simplified earth model and, where data is missing, invented terrain. Do not use
it to navigate anything.

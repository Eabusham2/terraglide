# TerraGlide backlog

Everything asked for, in the words it was asked in, so nothing depends on
anyone remembering it. Nothing is removed from this file when it is done — it
is ticked, so the record of what was asked survives alongside the record of
what was built.

Status: `[ ]` open · `[x]` done, with the evidence · `[~]` partly done, with
what is left · `[?]` needs a decision from you.

---

## A. Stops you playing

- [~] A0. Stuck on "Starting engine" — game never boots
      — could not reproduce: the deployed index, the single file and the online
      single file all boot here, and every Pages deploy has succeeded. Two
      causes removed anyway. Booting no longer waits on the network (picking a
      spot reads imagery to check for dry land; if that never came back, the
      frame loop never started and the boot screen sat there for ever saying
      nothing). And a module that fails to download now says so and offers the
      single file, instead of leaving that first message on screen. Still open
      until you can confirm on the machine it fails on.
- [~] A9. Does not work on Chromebook
      — two causes found and fixed. There was no handling for the graphics
      context being lost, which on a low-memory machine is not an edge case:
      Chrome kills the GPU process, every texture goes with it, and the loop
      carries on drawing into nothing — a frozen canvas with no error. It now
      catches that, calls preventDefault (without which the browser never
      offers a context back), stops, rebuilds and resumes; verified by taking
      the context away and giving it back. And the graphics preset defaulted to
      High for everybody, so a Chromebook started at a quality it could never
      hold; the first run now reads the GPU name, memory and core count and
      starts Low on a modest machine. Open until you confirm on yours.
- [x] A10. Online single file broken; single file missing things
      Two causes. The zip's index.html runs from file://, where browsers refuse
      ES modules, so main.js never ran and the watchdog blamed the network after
      20 s of blank screen — no network was involved, and terraglide.html was in
      the same folder. It now goes straight there. And tools/online.mjs stripped
      every <script> from index.html, which threw away the watchdog with the
      module tag, so the page most likely to fail was the only one that could
      not say so — that is the silent 'Starting engine…'. The online edition is
      now index.html itself with three URLs made absolute, so it cannot drift.
- [x] A11. Freecam shows the ground not holding; breaks in freecam
      Cause: in freecam the terrain is built for the player's camera on purpose —
      so flying the camera across a country does not re-cut the quadtree — but
      the frustum came from that same camera, so anything outside the player's
      view was never drawn. The freecam is usually pointed at exactly that. The
      frustum now comes from the camera the frame is drawn through; priority and
      level of detail still come from the player.

- [x] A1. Cannot move or jump on launch — it keeps restarting when I do
      — input did nothing because the arrival hold froze the player and then
      threw them: on a launch into Antarctica the ground went 0 m, 945 m,
      3,656 m and carried them up each time. Hold now waits for the ground to
      stop moving, and pressing a key gives you the controls without giving up
      the floor. Measured after: walking and jumping respond, 0 upward throws
      once you have control.
- [x] A2. Clicking out and back in, or Esc then jumping, breaks it
      — jump was a toggle for the wings. Measured gliding at 1.4 m/s down: one
      press and the wings shut and the fall went to 16 m/s. Space opens them
      now and never shuts them, as in Minecraft; the wings key stows. Verified
      through Esc, blur and focus — glide holds at ~3 m/s throughout.
- [x] A3. Teleporting again when I look down after a teleport
      The walk returns outright on a frustum miss, so the square under you was
      never visited while you looked at the horizon: never split, never built,
      never in `drawn` — and meshHeightAt reads `drawn`, so the game did not
      know where the floor was. Looking down brought the real relief in all at
      once. Ground within 250 m is now built whichever way you face.
- [x] A4. Hang when changing providers on terrain
      Cause: setSource() called clear(), disposing every texture at once — so the
      instant you picked a different provider the whole world went flat grey and
      came back a square at a time. Hundreds blinking out and back is the
      flashing; the seconds of blank world while it happened is the hang. The
      old picture of a place is a good picture of that place until the new one
      lands, so each square now swaps as its replacement arrives.
- [x] A5. Seizure/flashing when changing provider
      Cause: setSource() called clear(), disposing every texture at once — so the
      instant you picked a different provider the whole world went flat grey and
      came back a square at a time. Hundreds blinking out and back is the
      flashing; the seconds of blank world while it happened is the hang. The
      old picture of a place is a good picture of that place until the new one
      lands, so each square now swaps as its replacement arrives.
- [~] A6. Pressing a button within 3 s of RTP reverts to old spots and removes the new discovery
      — the half of this I could reproduce is fixed: a keypress no longer
      abandons the hold onto unmeasured ground. The "reverts to old spots"
      part I have not reproduced yet and it stays open.
- [~] A7. It randomly refreshes
      Nothing in the game reloads itself — no location.reload anywhere — so this is
      the browser killing the tab, and the likeliest reason is memory. The
      texture cache was counted in *tiles*, which is a proxy for memory that is
      wrong by four when a provider serves 512 px instead of 256: "high" was
      1.2 GB of texture rather than 300 MB, on top of the meshes. It is a byte
      budget now, and halved again where the browser reports 4 GB or less.
      Context loss was already handled (preventDefault plus a rebuild).
- [x] A8. Why is it forcing to fly — why can't it remember position on relog
      The position was always remembered. What you were *doing* was not, so the
      spawn had nothing to go on and took "arrive in the sky" at its word every
      time — hence being thrown into the air with the wings out on every reload.
      Leaving mid-glide brings you back gliding; leaving on your feet brings you
      back on your feet.

## B. The ground falls apart

- [~] B1. When flying, the ground glitches / blurs briefly / gets holes / moves up and down in sections — it needs to lock
      The moving up and down is fixed, and it was not LOD popping. Every tile
      samples the same height field whatever level it is drawn at, so a split
      does not change a vertex's height. What changes it is *fresh elevation
      landing*: a tile is drawn from the finest data that has arrived, so when
      finer data arrives the answer changes and the tile is rebuilt with it —
      in one frame, several metres, across the whole square. The sections are
      elevation tiles and the moment is the moment their data landed.

      A tile now remembers where it stood and walks to where it now stands over
      a third of a second: one float a vertex, a uniform, and a mix in the
      vertex shader. Verified in the running game rather than by the shader
      compiling, which proves nothing — a morph left finished renders exactly
      like one that never started. tools/morphcheck.mjs teleports somewhere
      empty and watches every tile: 21 of 40 half-second samples caught tiles
      mid-walk, 116 walking at once at the peak, and all 320 settled at the end.

      Holes: measured at 0.00 to 0.10 per cent across every view once the
      character is excluded from the measurement — see the note under M7. The
      brief blur is still open (B10, B12).
- [~] B2. Random times a patch below appears, then the player glitches down
      — same cause as A1 and improved by the same change, but only measured on
      arrival. A correction arriving mid-flight is still unhandled.
- [ ] B3. Sometimes most of the ground below me is missing and I stand on an invisible platform with patches
- [~] B4. Floating on invisible ground above the imagery
      — you are no longer *set down* on ground the game has not measured.
      Whether it still happens after a mid-flight correction is untested.
- [~] B5. Ground becomes griddy and comes back — moves up or down and shows a grid
      The moving up and down is fixed — see B1, it is fresh elevation landing
      and the tile now walks rather than steps. The grid itself is still open.
- [ ] B6. Randomly starts disappearing, getting patchy, falling apart, coming back in chunks
- [ ] B7. Random refresh of textures
- [x] B8. High res unloads from behind me
      Cause: the texture cache held a tile for 240 *frames*, commented as "about
      four seconds at 60 fps" — true only at exactly sixty. 144 fps got 1.7 s,
      30 fps got 8, 10 fps got 24. The better the machine, the sooner the ground
      behind you was thrown away. Now 20 seconds of wall clock, the same on
      every machine.
- [x] B9. Unloading and reloading and breaking
      Cause: the texture cache held a tile for 240 *frames*, commented as "about
      four seconds at 60 fps" — true only at exactly sixty. 144 fps got 1.7 s,
      30 fps got 8, 10 fps got 24. The better the machine, the sooner the ground
      behind you was thrown away. Now 20 seconds of wall clock, the same on
      every machine.
- [~] B10. Sometimes everything becomes super blurry when I do something, comes back after 1 s
      Measured rather than guessed, and it is not auto-quality — that averages
      over four seconds and will not move more often than every six, so it
      cannot produce a one-second blur. It is stretching: a tile with no
      photograph of its own is drawn from a coarser one stretched over it, and
      every step up halves the detail. tools/blurcheck.mjs counts it.

      In settled flight at 55 m/s, 58 per cent of the ground is stretched, 1.42
      levels on average. Just after a 180 it is 73 per cent. Standing still it
      converges to 8 per cent in about ten seconds and stays there with an
      empty queue — and that 8 is ground the provider has nothing deeper for,
      which is honest rather than broken.

      So the flying blur is throughput: at 55 m/s you cross six of the deepest
      tiles in the time one comes back. Asking ahead was the obvious answer and
      it was tried — a lead point two seconds along the velocity, three levels,
      a ring of nine — and it measured *worse*: 58.1 per cent became 61.7, and
      gating it to an empty queue still gave 61.5. The pipeline is limited by
      how fast tiles return rather than by knowing which to ask for, and a
      dispatched request cannot be recalled, so a speculative tile holds one of
      the dozen-odd slots for its whole round trip while a tile you are looking
      at waits behind it. Reverted rather than shipped.

      Caveat worth keeping: these measurements come through a proxy that
      serialises every tile, so the sandbox is more throughput-bound than a real
      browser with HTTP/2 to Esri. Asking ahead is unproven here rather than
      disproven — it wants measuring on a real connection before being tried
      again.
- [?] B11. Random times when looking, everything becomes a solid colour
      A solid colour is a tile with no texture at all — not even a coarser one
      stretched over it — because the shader then has only the relief to colour
      by. It is counted now, per frame, alongside the stretching, and over
      settled flight, a 180 and standing still it came back 0.0 per cent every
      time. So it does not reproduce here.

      Where it can still happen: a provider that refuses a square outright
      (which is drawn bare deliberately and honestly, rather than invented),
      and the first moments after a teleport before any cover tile has landed.
      If it is still being seen, the thing worth knowing is where and with
      which provider — the counter will say whether it is that or something
      else.
- [ ] B12. Randomly blurring depending on where I look
- [x] B13. In freecam I see the ground behind me as invisible
      Cause: in freecam the terrain is built for the player's camera on purpose —
      so flying the camera across a country does not re-cut the quadtree — but
      the frustum came from that same camera, so anything outside the player's
      view was never drawn. The freecam is usually pointed at exactly that. The
      frustum now comes from the camera the frame is drawn through; priority and
      level of detail still come from the player.
- [ ] B14. Debug and remove glitches generally

## C. Loading order and speed

- [?] C1. Load high res where I am and where I am looking, more chunks in parallel
      Half of it is already so and the other half measured worse. Requests are
      priority-ordered by distance over 2^(20-z), so the nearest and deepest go
      first — "where I am and where I am looking" is what the queue already
      does. Parallelism is 12 to 34 by preset.

      Asking ahead of where you are going was tried and reverted; see B10 for
      the numbers and the caveat about the sandbox's proxy.
- [ ] C2. Load high res more, long-range low res less
- [x] C3. Ground loading is super slow but the minimap is already loaded
      Cause found: the per-frame streaming budget was spare time only, so any
      machine missing its target pinned to the 1.5 ms floor — 45 ms of terrain
      work a second at 30 fps against 1296 at 144. It now also gets a share of
      the frame, so the rate holds at any frame rate. The minimap was sharp
      first because it never went through this budget at all.
- [x] C4. Make it load HQ ground fast
      Cause found: the per-frame streaming budget was spare time only, so any
      machine missing its target pinned to the 1.5 ms floor — 45 ms of terrain
      work a second at 30 fps against 1296 at 144. It now also gets a share of
      the frame, so the rate holds at any frame rate. The minimap was sharp
      first because it never went through this budget at all.
- [ ] C5. Map zooms in faster and more detailed than the terrain — ground should be faster and higher quality
- [ ] C6. Takes too long for max res to arrive — maybe fewer modes
- [ ] C7. Preload/load everything when close, so approaching does not trigger a high-res render unless it is a LOD
- [x] C8. Flying up should not decrease quality
      Cause: the split test used the *horizontal* distance, which is nought for
      ground directly beneath you however high you are — so at 9 km the quadtree
      descended to zoom 23 straight down (true distance says z12) and spent the
      frame's whole tile budget there. maxDrawn then cuts the walk short and the
      view is what goes missing. The quality did not decrease; it went somewhere
      useless. Split now uses the real distance, including the square's own
      height range; culling and reach stay horizontal, because those are about
      ground covered rather than apparent size. On foot, nothing changes.
- [x] C9. Minimap often does not load satellite when high up — four rescues by a
      standby latched the map onto it for the session with no way back, and two
      of the ways to earn one (no imagery here, provider not ready) are not the
      server's fault. Now a rate, over ten seconds, transport failures only,
      and it expires.
- [ ] C10. Distant view should be fixed low-res LODs, getting less detailed further out
- [ ] C11. LODs for distance render only
- [x] C12. Why is the distance horizon forced
      Because the setting is a floor, not a ceiling: renderDistance is
      clamp(horizon, setting, setting * 6). From 400 m up the real horizon is
      71 km, and stopping the world at a 24 km setting anyway puts a flat band of
      haze across the view where the mountains should be. That was true and
      unexplained; the setting now says it.
- [x] C13. "Draw twice as far over country you have seen" — what is this, and it reads badly
      It read badly because it was wrong: the distance is a separate slider from
      64 to 1024 km, so there is no "twice" anywhere in it. The toggle is now
      "Keep drawing past the horizon where you have been" with the distance as its
      own control underneath.

## D. Physics

- [?] D1. Physics do not match Minecraft — barely fall when standing still; looking down then forward quickly gives far too much forward speed
      The glide is Minecraft exactly, and that is measured rather than asserted:
      a second transcription of LivingEntity.updateFallFlyingMovement, written
      from the Java in its own units and sign convention, diverges from ours by
      1.8e-14 blocks a tick over 200 ticks across 66 manoeuvres. Which is float
      noise. The fall when not gliding is Minecraft's too — 0.08 a tick with a
      0.98 drag, terminal 3.92 b/t — and the fixed clock always hands the glide
      whole ticks, so it cannot be running at the wrong rate.

      The flight numbers come out where a player would expect them: level glide
      1.49 b/t at 7.6:1, nose down 30 degrees 2.48 b/t, straight down 3.92 b/t.
      "Barely fall when standing still" is what a 7.6:1 glide ratio is, and it
      is vanilla's.

      So the difference being felt is not in the glide. The two candidates left
      are scale — 30 m/s crosses a Minecraft village in a second and a real
      valley in a minute — and the rocket, which deliberately departs from
      vanilla so a weak slot cannot brake you (D7, D5). Worth asking which.
- [ ] D2. Looking down to gain speed should work as it does in MC
- [ ] D3. Should I jolt to a stop when flight duration ends and I am looking down?
- [ ] D4. Going faster by rocketing more downward makes no sense — fix the physics engine
- [x] D5. Flight duration and deceleration should match MC — spamming should make you a bit faster (check this)
      Checked, and it did nothing: a firework was a single timer, so "lighting
      one mid-burn simply restarts the burn" — the second rocket bought you
      nothing at all. In Minecraft a firework is an entity and every one alive
      applies its own push every tick, so two overlapping push twice. They are
      a list now, each keeping the power it was lit with, so a rocket in flight
      is the one you lit rather than whichever slot you have since scrolled to.

      And the push itself was capping too early. Minecraft's line is
      0.1 + (thrust - along) * 0.5 with no floor, and it settles where that
      reaches nought — two tenths of a block a tick past the rocket's own
      target. D7 had dropped the nudge along with the pull, which capped the
      cruise at the target exactly (30 m/s for a Rocket I against vanilla's
      33.5), put a step in the curve where you reach it, and left a second
      firework with nothing to contribute. Clamping the line at nought instead
      of cutting it keeps all three properties: no brake, the governor intact,
      and every firework pushing.

      Measured: a Rocket I now settles at 33.5 m/s where vanilla settles at
      33.5, and spamming reaches 33 m/s in 4 ticks against 6 and holds 33.7.
- [x] D6. Rocket times do not match Minecraft — fix, and use the same scale for speed; the light-duration one has MC default speed
      They do. Minecraft's firework lifetime is 10 * duration + rand(6) +
      rand(7), so 10 to 21 ticks for a duration of one, mean 15.5. Ours is
      10 * duration + 6, which is inside that range and half a tick off its
      mean — a deterministic stand-in for a die roll rather than a different
      number. And the scale holds: rocketPowerFor(1) is exactly 1, so a Rocket I
      is vanilla's own push, and every heavier slot's power is its burn length
      over Rocket I's. Both checked in the self-test.

      What was wrong was the cruise those times produced, not the times. See
      D5: the push was capping at the rocket's target instead of vanilla's
      target-plus-two-tenths, so a Rocket I settled at 30 m/s against
      vanilla's 33.5. Fixed there.
- [x] D7. Using the slot of a slower rocket slows you down
      Measured: cruising at 106 m/s on a Rocket V, firing a Rocket I took you to
      33.5 — 69% of your speed for pressing the wrong hotbar key. Minecraft's
      line pulls toward the rocket's target from either direction, which barely
      shows in vanilla because every firework aims at the same 1.5 b/t; here a
      bigger rocket pushes harder, so the small slots brake. It now pushes
      toward its target, never past it, never back from beyond it. The brake is
      60.7 m/s -> 0, and each rocket still settles at its own cruise.
- [x] D8. More speed/movement initially when going from slow to rocket speed
      The speed was already there — lit from 8 m/s a Rocket I puts you at 20.8 by
      the first tick and 30.4 by the third. What was missing was the view: the
      field of view eased in on one rate for both directions, about six tenths of
      a second, so the acceleration was over before the camera acknowledged it.
      It opens fast now and closes slowly — 88% of the way in 0.15 s instead of
      53% — which is also just how it should feel: arriving speed is a shove,
      leaving speed is a drift.
- [x] D9. Speed accuracy breaks over time — the player slows down
      Same frame-clock cause: as the world loaded and the frame rate fell, the
      catch-up ceiling threw the difference away and you really did slow down
      while the readout did not. See MAX_FRAME_S.
- [x] D10. Speed readout says faster than reality
      Two causes, both fixed. The big one was the frame clock: below 4 fps the
      world ran in slow motion, so the model said 30 m/s while you covered 15 —
      the readout was right and the world was slow. The second: `speed` returned
      the bare velocity while the controller moves you by velocity x multiplier,
      so with speed mode on it read half, not double. Both now agree.
- [ ] D11. Improve walking speed and being flat on the ground

## E. Speed mode

- [x] E1. Charges faster
      Cooldown 45 s -> 30 s. You are in it 29% of the time now, was 18%.
- [x] E2. 1.2x speed and duration, and rename it — "rapid mode" or something better
      A fifth again on both: 2.0x -> 2.4x, 10 s -> 12 s. Renamed Surge, everywhere
      it is shown — gauge, help card, key list, cheat panel, toasts.
- [x] E3. Should affect everything, not just rockets — base, walk, glide
      Already does: speedMultiplier scales the displacement the controller applies,
      so walking, gliding and falling all carry it. Rockets get it on top.
- [x] E4. Countdown should not run down while in settings or paused
      Already so, and now checked: a paused frame is update(0), so every timer is
      stepped by nothing. Ten seconds of paused frames spend no surge and no
      cooldown; a second of real time spends one second.
- [ ] E5. Streamline the speed mode panel
- [x] E6. Where is speed mode on touchscreen
      It was there all along, labelled "2x" — a value rather than a thing. It says
      Surge now, like everywhere else.

## F. Map and minimap

- [x] F1. NWSE on the minimap preview is too big
      Was 8% of the minimap — a 19 px letter on a 240 px map, bigger than the
      place names under it. Now 5.5%, floored at 10 px for phones.
- [x] F2. Improve the position of NWSE on the map
      They sat a whole letter's height inside the rim, over the ground you were
      reading. Moved out to 0.62 of the letter height, and the outline halo
      thinned from 0.28 to 0.2 so the pair stops reading as one blob when small.
- [x] F3. Map is white, especially when going up
      Cause: resolve() only ever walks up. Zooming out — which is what climbing
      does to the minimap — leaves the sharp squares cached and the coarse one
      not yet asked for, so it found nothing and the renderer painted
      STREET_BLANK over everything. That colour is #eceae3, near-white. It now
      draws the finer squares it already has, and paints paper only where
      nothing at all is known.
- [x] F4. Map is white for a moment when zooming in
      Cause: resolve() only ever walks up. Zooming out — which is what climbing
      does to the minimap — leaves the sharp squares cached and the coarse one
      not yet asked for, so it found nothing and the renderer painted
      STREET_BLANK over everything. That colour is #eceae3, near-white. It now
      draws the finer squares it already has, and paints paper only where
      nothing at all is known.
- [ ] F5. Stretched map
- [x] F6. Explored area must look the same and stay visible at every zoom
      Cause: save() threw away 45% of the level-16 squares at random whenever the
      record passed 160,000 — permanently, since what it wrote is what came
      back, so every reload thinned the survivors again (55%, 30%, 17%).
      Random scattered holes through ground you had actually flown, different
      every time. The cap was real at ~3 MB of key strings; explored ground is
      discs along a path, so rows compress 14x and 2.7M squares now fit. Over
      the ceiling the oldest fine detail goes, in order, never at random.
- [x] F7. Map should show exactly where I explored, especially zoomed out
      Cause: save() threw away 45% of the level-16 squares at random whenever the
      record passed 160,000 — permanently, since what it wrote is what came
      back, so every reload thinned the survivors again (55%, 30%, 17%).
      Random scattered holes through ground you had actually flown, different
      every time. The cap was real at ~3 MB of key strings; explored ground is
      discs along a path, so rows compress 14x and 2.7M squares now fit. Over
      the ceiling the oldest fine detail goes, in order, never at random.
- [ ] F8. Map does not show only what I saw, and changes size with zoom
- [ ] F9. Remove grids from places like the example map
- [x] F10. Improve the starting map zoom
      It opened at zoom 6 every time — 1,473 km across at a middling latitude,
      most of a continent — so the first thing anybody did was zoom in. It opens
      at 11 now (46 km, a city and the country round it) and after that wherever
      you left it.
- [x] F11. Opening the map should not stop the game
      The map was in the pause list because stopping the world was the only way
      to stop W flying you into a mountain while you typed a place name. Those
      are two questions: `paused` stops the clock, `takingKeys` stops the
      keyboard. The map now does only the second.
- [ ] F12. Waypoint dragger in the map
- [x] F13. Waypoints appear on the map
      Already so on both maps — minimap behind the minimapShowWaypoints setting,
      world map always.
- [x] F14. Waypoint and distance as a box of text plus a coloured beam beacon
      Built: a coloured beam standing on the ground under every waypoint, bright at
      the foot and fading with height, additive and depth-write off so it never
      punches a hole in the ground. Widened with distance so it does not vanish
      inside a pixel from ten kilometres. Beside each one, a box with the name and
      the distance in the colour of its beam.
- [x] F15. Circular, square or squircle option for the minimap
      Four: rounded (as it was), circle, squircle, square. One border-radius each
      — the canvas is square and overflow:hidden on the frame is what cuts it, so
      the compass and scale bar inside carry on unchanged.

## G. Providers and 3D

- [ ] G1. Google session failed (403) — maps_api.tas.BootstrapService.Bootstrap blocked
- [ ] G2. Fix broken Google generally
- [ ] G3. Photorealistic Cesium ion key broken — "failed to fetch"
- [x] G4. 3D not working at all, including OSM buildings
      Not a bug in the buildings. A fallback that never engaged.

      Overpass is asked for buildings over a list of public mirrors, and the
      client moved to the next one on a 429 or a 504 and nothing else. A 500 or
      a 503 — which is what an instance actually returns when it is unwell —
      threw without advancing, so every retry went back to the same dead
      endpoint and the second mirror in the list was never reached. Measured
      from here: the main instance answers 503 and kumi answers 500, both at
      once. With a list of two and no rotation, that is every building in the
      world gone, for ever, with nine of nine tile requests failing.

      It moves on for any 429 or 5xx now, and for a request that never arrives
      at all — DNS, a reset, a blocked host — while leaving a 4xx alone, since
      that is the query being wrong and no other mirror will like it better.
      The list is four mirrors rather than two.

      Measured after: nine tiles, zero failed, six buildings measured from the
      survey and 182 estimated, twelve bridge segments, four meshes.

      Worth knowing for the rest of the G group: this sandbox's egress blocks
      or fails several hosts outright, so a provider that "does not work" here
      may work perfectly for you. That is what made this one look environmental
      until the rotation was read.
- [ ] G5. No 3D terrain for buildings, infrastructure or vegetation
- [ ] G6. Why can I see 3D houses in MSFS (Azure) but not here
- [ ] G7. Mapbox supports 3D buildings + terrain — why is there none here
- [ ] G8. Bing has satellite and a 3D mode — add the 3D
- [ ] G9. Add Azure aerial
- [ ] G10. Add more Cesium; Bing via Cesium
- [ ] G11. Explain the "Cesium ion imagery asset / 2" setting properly
- [ ] G12. Ensure the latest Cesium data is used
- [ ] G13. Auto-change provider via an auto option in the dropdown
- [x] G14. Fallbacks
      Already: providerChain builds a standby list (keyed providers first, then
      free ones), a refused tile walks down it, and the flat maps fall back to the
      keyless mosaic. The refusal-latch bug in that path was fixed earlier.
- [x] G15. Retry when failed
      Already: a failed tile retries after 20 s, and every standby provider is
      tried before it counts as a failure at all. What was missing was the case
      above — the permanent write-off that no retry could reach.
- [x] G16. Stop ignoring failures and marking them normal
      The real one: "nobody has this square" was kept in a Set, which means for
      ever. One dropped connection wrote off whatever you were flying over — and
      the four squares beneath it and the sixteen beneath those — for the rest of
      the session, and it read as ground that simply had no imagery. It carries a
      time now and expires after 90 s.
- [x] G17. Remember tokens
      Measured rather than assumed: localStorage works from file:// in Chromium
      (all file URLs share one origin), the store writes every token, and a fresh
      store built from the same storage reads them back. The store class is
      exported now so that reload path can actually be exercised.
- [ ] G18. Why is it lower res than, e.g., the Mapbox website
- [x] G19. Show the imagery year
      Esri publish it per square — capture date, ground resolution, the satellite
      that took it, and the deepest zoom that square is served at. It sits on the
      attribution line: Black Forest "Sep 2018 · 0.5 m · WV02", Vienna "Apr 2025 ·
      0.075 m · Stadt Wien". One request per 80 km square, cached, background.
- [x] G20. Why cap zoom at 22 or 23 — force it to infinity and future-proof it (1–25, then Infinity)
      — the slider runs 1 to 25 and then to "No limit", which is the default.
      Every fixed number here was wrong in turn: 19, then 20, then the deepest
      a provider declared. What stops it now is the provider refusing and the
      photographs themselves stopping getting sharper, both measured.

## H. World and atmosphere

- [x] H1. There are no bumps on trees
      Cause: the relief was gated entirely on an OpenStreetMap wood polygon, so
      anywhere nobody has drawn one — most of the world — there were no bumps at
      all. The photograph is asked now where the survey is silent.
- [x] H2. When bumping green parts, skip it where the green runs bigger than a size throughout, so grass is not marked — but still count areas with holes of a different colour
      Implemented as the rule was stated, measured per tile from the photograph:
      green share x how broken that green is at crown scale. On real Esri tiles —
      rainforest 0.765, conifer 0.842, broadleaf 0.803, scrub with trees 0.403,
      uniform green fields 0.129, ploughed field 0.000, desert 0.000.
- [~] H3. Improve Antarctica
      — the launch-into-Antarctica throw is fixed. The coarse elevation there
      is genuinely 2.7 km wrong (zoom 6/8/10 all read ~944 m for 3,656 m of
      ice), which is the provider's data, not ours. Nothing done yet about how
      it *looks*.
- [ ] H4. Improve above the clouds
- [ ] H5. Weather should follow the imagery's own weather state
- [ ] H6. Match the sun angle to the imagery's time, maybe

## I. Player, HUD and controls

- [x] I1. Player size should match up properly
      Measured against real anthropometry the figure was 1.68x too wide across
      the chest, 1.80x across the shoulders and 2.09x across the hips — it was
      Minecraft-shaped, not person-shaped. Now within 1.00-1.17x. The collision
      capsule went with it: 0.21 of height is an 0.83 m barrel on a 6'6" frame,
      now 0.12 (0.24 across). This is also why looking down in first person
      filled the screen with a wall of cloth — your own chest, half a metre wide,
      a quarter of a metre from your eye.
- [x] I2. Default height 6 ft, and matching
      1.98 m (6'6") -> 1.8288 m (6'0"). Everything scales off it — stride, eye
      height, reach, the collision capsule — so they all follow. The settings help
      and the README say six feet; the help card reads the setting rather than
      quoting a number, so it cannot fall out of step.
- [x] I3. Why do I feel so big
      Measured against real anthropometry the figure was 1.68x too wide across
      the chest, 1.80x across the shoulders and 2.09x across the hips — it was
      Minecraft-shaped, not person-shaped. Now within 1.00-1.17x. The collision
      capsule went with it: 0.21 of height is an 0.83 m barrel on a 6'6" frame,
      now 0.12 (0.24 across). This is also why looking down in first person
      filled the screen with a wall of cloth — your own chest, half a metre wide,
      a quarter of a metre from your eye.
- [x] I4. Make altitude accurate
      Height above ground went through formatDistance, which switches to miles past
      a thousand feet and was asked for no decimals — so 305 m AGL printed "0 mi".
      A thousand feet up, reported as zero. It reads 1,001 ft now, and stays in
      feet all the way to 29,528.
- [ ] I5. Make speed accurate, and size
- [x] I6. Number on the compass
      The strip had letters at the four cardinals and blank ticks everywhere else,
      so it never said a number at all. Degrees on the intercardinals now, and a
      live three-figure bearing under the needle in tabular figures so it does
      not jitter as it counts.
- [x] I7. Vertical look angle in degrees, maybe either side of the compass
      Added next to the compass in the location card: 'level', '+45°', '−20°'.
- [x] I8. Centre dot / plus
      Already there — .hud-crosshair, behind the showCrosshair setting. Confirmed
      visible in a screenshot of the running game.
- [x] I9. Per second and per minute, not only per hour
      Added as a setting: per hour (km/h, mph), per minute (km/min, mi/min),
      per second (m/s, ft/s). Per hour stays the default.
- [x] I10. Imperial/metric everywhere, not only in some places
      Two readouts printed one system whatever the setting said: the explored area
      on the world map (always km²) and the wind on the weather line (always
      km/h — beside a temperature on the same line that did convert). Both go
      through formatters now, and a check refuses a hard-coded unit in either
      file.
- [x] I11. Seeing hand, rocket and body while gliding
      Looked at first person in the running game. The body was there but
      unreadable — the chest was Minecraft-wide and the cloth texture had its
      wrapping set to repeat and its repeat never set, so one photograph of the
      weave was stretched over the whole chest at about fifty times life size.
      Both fixed. Then a shot of a first-person glide in the running game, and
      there was nothing of you in it — no arms, no hands, no rocket, landscape
      and nothing else. Two causes, and neither was visible without measuring
      against the frame. The arms had been swung back to -1.85 to keep the
      firework off the lens, which left the hand four centimetres in front of
      the eye against a near plane of fifteen. And the spread was 0.62, which
      put the hands 66 degrees off the view axis: even clear of the near plane
      they were outside a frame that is 55 degrees to the side at the default
      FOV, so widening the arms to "frame the view" pushed them out of it.
      And a third: the too-close backstop was 0.34 of height, a 62 cm bubble on
      a 1.83 m player, so the rule meant to catch a limb through the lens was
      deleting the firework at every distance a hand actually holds one at.

      Swept the arm rather than guessed it — your shoulder is a quarter of a
      metre behind your eye when you are face down, so the hand can only get
      about 0.36 m in front of the camera whatever the arm does. Which turned
      out to be the answer to a question that should not have been asked: at
      that range the world arm is a 0.7 m box starting at the lens, and it
      draws as a flat slab across a fifth of the screen however it is posed.
      The cause is the shoulder being at the camera, not the arm being wrong.

      So the glide draws the view model instead, which is what a view model is
      for, and the world arms come off with it. That machinery had been here
      all along — hands in view space at fractions of the frustum, blended
      between the carried pose and the flying one, with sway, bob and the kick
      a firework gives — and had lost its call: updateHand was defined and
      invoked from nowhere, so the group sat at the camera's own origin and
      drew nothing. Standing keeps the world arms, where the shoulder is a
      quarter of a metre *below* the eye and looking down finds the arm side-on.

      Measured in the running game at four look angles: the hand lands 0.85 m
      ahead at (0.81, 0.81) and the firework at (0.76, 0.74), the same every
      time — the pose turns about your eye, so your hands stay where they are
      in the frame however you pitch. tools/handcheck.mjs is that measurement
      kept as a check, and it exits non-zero if any angle shows you nothing.

      There are hands on the ends of the arms now as well — the sleeve used to
      stop in mid-air, so the firework was held by nothing — and the rocket was
      on the wrong side of the body, because the glide pose crossed both arms
      over the chest. See M2. The self-test checks the hand and the firework
      against the near plane and both frame half-angles.
- [ ] I12. Improve the freecam model
- [x] I13. Freecam that does not pause the game
      Already so: the freecam is deliberately not in the pause list, and there is a
      comment saying why. Confirmed by a check that the word does not appear in the
      expression `paused` returns.
- [x] I14. Keybinds — "wtf is f"
      F was in fact on the help card — "open or stow the wings". Four other keys
      were not: M for the minimap, F1 for the display, F2 for the card itself
      and F3 for the engine readout. Which is the same problem for four keys,
      and the same problem waiting for the next one added.

      So they are listed, and the list is now checked against the bindings
      themselves. A binding with no line on the card fails the build rather
      than reaching somebody's keyboard undocumented, and a line naming an
      action the game does not bind fails it too — the card cannot promise a
      key that does nothing. Thirty-two bindings, all of them written down.
- [x] I15. Touchscreen controls do not go away when returning to keyboard
      watchForTouch only ever called setEnabled(true) — nothing turned them off.
      On anything with both a finger and a keyboard, one tap pinned the sticks
      over the game for the session. A game key or a real mouse press now puts
      them away; a coarse pointer still starts them on, for a phone.
- [ ] I16. Broken letters on certain devices
- [x] I17. Favicon as an elytra
      A pair of folded wings with the spine between them, five paths, inline SVG.
      Rendered at 16, 32 and 128 px and looked at, not just written.
- [x] I18. Barrel roll as in the MC mod, not a keybind
      Was a key: X ran a canned 360 over 0.8 s whatever you were doing. Now it is
      the strafe keys held while gliding — you keep rolling for as long as you
      hold, all the way round if you want, and the wings come back level when
      you let go. And a bank turns you, scaled by airspeed, which is the reason
      to roll one: a 30-degree bank is a 46-degree arc over two seconds, upside
      down turns nothing. The keybind is gone.
- [x] I19. FOV increase should depend on speed
      Already there — clamp(horizontalSpeed/90) * 16 degrees, behind the
      speedFovKick setting. But it also added a flat 6 degrees while speed mode
      ran, and since horizontalSpeed now includes the multiplier that counted the
      same boost twice: 22 degrees where 16 was meant. One input now.
      0 standing, 0.8 walking, 5.3 gliding, 16 at a rocket, and it stops there.
- [ ] I20. Seed hacks, custom rockets, custom size and more in the cheat panel
- [ ] I21. Remember the trail

## J. How the work is done

- [ ] J1. Completely remove the code of the fake generator
- [ ] J2. A test on every mode
- [ ] J3. Fix causes, not symptoms — no papering over
- [x] J4. Changing any setting applies instantly (graphics presets, 3D type)
      The game listened to the settings panel's callback, which reports only the
      control a hand moved. Picking Low writes nine settings; eight were stored
      and never applied — and auto quality, which everyone now starts on, moved
      the tier without ever moving the picture. It listens to the store now,
      coalesced to one pass a frame, and a preset change rebuilds the meshes
      because the mesh grid is read from the preset.
- [x] J5. Ensure graphics presets update
      The game listened to the settings panel's callback, which reports only the
      control a hand moved. Picking Low writes nine settings; eight were stored
      and never applied — and auto quality, which everyone now starts on, moved
      the tier without ever moving the picture. It listens to the store now,
      coalesced to one pass a frame, and a preset change rebuilds the meshes
      because the mesh grid is read from the preset.

## L. Standing instructions

- [ ] L1. Improve it all
- [ ] L2. Bug-test properly before saying something is fixed

## K. Needs a decision

- [?] K1. "Why is it number …" — the sentence stops there; which number?

## M. From the third message

- [x] M1. Player model still floating or underground, feet separate — I said look, and I did not
      Looked. It is arithmetic: hip 0.51, legs 0.36, so the trousers stopped at
      0.15 — twenty-seven centimetres above the sole — and the boots were placed
      by a hand-written -0.34 that put them at -0.035 to 0.015, below the origin
      entirely. Buried boots, floating trousers, a hand's span of nothing
      between. Legs are 0.46 now and the boot offset is derived from the leg and
      boot heights rather than typed, so 0.51 - 0.46 - 0.05 = 0 puts the sole on
      the ground and the boot top against the leg.
- [x] M2. Flying model broken
      A screenshot from the chase camera, and six separate faults in it.

      The wings spanned 1.60 of standing height — 2.9 metres on a 1.83 metre
      player, nine times his own width. A hang glider, and from behind it was
      the whole frame with a person hanging under it as a detail. An elytron
      spans about as wide as its wearer is tall, so the outline runs to 0.505 a
      side now, with the chord set to the 1.5:1 aspect an elytron has rather
      than the 2:1 of a paper aeroplane.

      The wing was also a prism — one polygon extruded 14 mm, so every point on
      the top surface shared a normal and the whole thing shaded as one flat
      colour. It is bent into a shell, every vertex pushed down and back by the
      square of how far out it is, and the leading edge is built from the bent
      outline so it follows the curve instead of cutting across it.

      The arms crossed. An arm hangs along -Y from its shoulder, so a positive
      Z rotation swings it toward +X, which for the left arm is over the chest
      and out the other side. Both signs were that way round, so in a glide the
      hands finished on each other's sides and the firework held in the right
      hand appeared on the left of the body with nothing near it.

      The legs crossed too: the tuck swung each foot 50 mm inward across hips
      44 mm apart, so the ankles overlapped and the legs — the largest thing on
      a figure seen from directly behind — drew as one blank rectangle.

      And nothing on the body had any fill. The scene's sun and hemisphere are
      right for a landscape and wrong for the one object that has to stay
      readable in it: glide with the sun ahead and every surface facing the
      chase camera is lit by 0x4a4a44 alone. The character carries its own fill
      now, emissive on its own materials so it lands nowhere else in the world.
      The trousers were lightened and the wing membrane darkened besides — they
      were 87 against 142, so the figure read as a dark slab under pale sails.

      Measured, not guessed: tools/model.mjs draws the character alone under the
      game's own lights from six angles and reports the mean brightness of each
      part, because judging a forty-pixel figure against a hillside is how a
      model with one leg and no arms survived several passes.
- [x] M2b. The elytra look backwards or upside down
      Four faults, and the one that mattered was not about the wing at all.

      The tips hung 30 cm below the shoulders — 40 degrees of sweep and minus
      22 of dihedral, a wing hanging off a body rather than one holding it up.
      Fixing that gave a wing 0.99 flat to the airflow, 28 degrees of sweep,
      correct in every way a wing can be measured against the air.

      And 0.06 square to the chase camera, at every pitch. The camera sits 16
      degrees above the flight line in level flight and climbs to 55 in a dive,
      so a horizontal surface seen from there is a blade — and a blade has no
      shape in it to read, which is exactly why it looked like it was on
      backwards or inside out. Every check passed because every check measured
      the wing against the air, and the complaint was about the wing against
      the camera. It is canted to meet it now: 28 degrees of sweep, 5 of
      dihedral so the tips sit above the shoulders, 0.83 to 0.88 square to the
      camera from a climb through a steep dive.

      The planform was wrong too. The bend displaced along Y as well as Z, and
      Y is in the plane the outline is drawn in — so it was a square-law shear,
      not the droop it was named as, and a square-law shear turns two straight
      edges into two arcs. Any outline came out a rounded lobe. And the aspect
      ratio had been reasoned from what an elytron is, about 1.5:1, which
      renders as two fat leaves: it is 2.1 now, with a tip chord of 0.028
      instead of 0.154 — a point rather than a paddle.

      Then the colour, which was the deepest one. Every colour set on this
      character was dead code in the served build: the loader set the material
      to white when a kit texture arrived and let the photograph decide. The
      four photographs were not balanced — mean luminance 183 for the wing, 41
      for the trousers — so the wings were near-white cloth and the legs
      near-black, which is the whole of "pale sails over a dark blob" and is
      why the model harness and the running game kept disagreeing. Each texture
      is reduced to luminance and normalised now, so it is a weave rather than
      a colour, and the two builds finally match. In the game the wing went
      from 169-192 to 114-123 against legs at 89 and grass at 80.

      tools/wingpose.mjs solves and reports the attitude; the self-test checks
      the angle to the camera and the dihedral, not just the shape.
- [?] M2c. Steep slopes look streaked and smeared
      Raised by me from my own screenshots, and the measurement does not
      support what I called it. Sampling the streaked patch with woodland
      relief off, and again with anisotropy forced to 1, gives readings
      identical to three significant figures — so it is neither the un-mipmapped
      woodland mask nor the texture filtering. Pixel-to-pixel step is 2.02 over
      a mean of 27.8: smooth, not sparkling, so it is not aliasing either.

      What is left is a shadowed slope seen at a grazing angle, showing the
      source photograph's own chroma noise stretched along the surface — the
      colour spread is 11.8 against a mean of 27.8, which is high in relative
      terms and is what reads as rainbow in near-black. That is real imagery
      displayed honestly. It could be made to look better by lifting or
      desaturating deep shadow, which is a display choice rather than an
      invention, but it is a choice worth asking about rather than making.

- [ ] M3. It is so laggy
- [ ] M4. The quality is bad; zooming in on the map looks better than the ground
- [x] M5. Explored area on the map is still nowhere near what was actually explored
      Cause: save() threw away 45% of the level-16 squares at random whenever the
      record passed 160,000 — permanently, since what it wrote is what came
      back, so every reload thinned the survivors again (55%, 30%, 17%).
      Random scattered holes through ground you had actually flown, different
      every time. The cap was real at ~3 MB of key strings; explored ground is
      discs along a path, so rows compress 14x and 2.7M squares now fit. Over
      the ceiling the oldest fine detail goes, in order, never at random.
- [ ] M6. Player position is still off on the minimap
- [ ] M7. Ground still has holes, still reloads, still moves up and down
- [x] M8. Unloading while the player is still inside the render distance
      Cause: the texture cache held a tile for 240 *frames*, commented as "about
      four seconds at 60 fps" — true only at exactly sixty. 144 fps got 1.7 s,
      30 fps got 8, 10 fps got 24. The better the machine, the sooner the ground
      behind you was thrown away. Now 20 seconds of wall clock, the same on
      every machine.
- [ ] M9. Ground becomes blurry
- [x] M10. Player width and speed on the ground do not feel real
      Measured against real anthropometry the figure was 1.68x too wide across
      the chest, 1.80x across the shoulders and 2.09x across the hips — it was
      Minecraft-shaped, not person-shaped. Now within 1.00-1.17x. The collision
      capsule went with it: 0.21 of height is an 0.83 m barrel on a 6'6" frame,
      now 0.12 (0.24 across). This is also why looking down in first person
      filled the screen with a wall of cloth — your own chest, half a metre wide,
      a quarter of a metre from your eye.
- [x] M11. Still teleporting when I look down after an RTP
      The walk returns outright on a frustum miss, so the square under you was
      never visited while you looked at the horizon: never split, never built,
      never in `drawn` — and meshHeightAt reads `drawn`, so the game did not
      know where the floor was. Looking down brought the real relief in all at
      once. Ground within 250 m is now built whichever way you face.
- [ ] M12. Photorealistic 3D "failed to fetch"
- [ ] M13. Not everything fake has been removed
- [x] M14. The README reads as a contextless changelog of what I asked you to change
      — rewritten to describe the game rather than narrate edits. Every "there
      used to be" is gone.
- [x] M15. "with gaps left as gaps" — I said NO GAPS
      — line removed.
- [~] M16. One branch, with gh-pages as the only other
      Two dead branches remain: online-singlefile, which holds nothing main
      does not (136 files changed, 231,358 deletions against 70 insertions —
      it is a strict subset), and claude/world-exploration-game-962wpo, which
      is an old snapshot and the only place the deleted terrain generator still
      exists. Deleting a remote branch is refused by the permission gate here,
      and the second one is also the branch this session was told to develop
      on, so neither is something to delete unilaterally. Both want a word.
- [ ] M17. Stop patching with bandaids — fix the system
- [x] M18. Barrel roll, implemented like the mod, not as a keybind
      Was a key: X ran a canned 360 over 0.8 s whatever you were doing. Now it is
      the strafe keys held while gliding — you keep rolling for as long as you
      hold, all the way round if you want, and the wings come back level when
      you let go. And a bank turns you, scaled by airspeed, which is the reason
      to roll one: a 30-degree bank is a 46-degree arc over two seconds, upside
      down turns nothing. The keybind is gone.

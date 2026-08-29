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
- [~] B7. Random refresh of textures
      Not random — it is ground you looked away from for more than twenty
      seconds, and the trigger is exactly that.

      Measured. Standing still, settled facing north at 100% of the drawn ground
      at its own resolution rather than stretched. Turn right round, wait ninety
      seconds until south is settled too, turn back: north comes home at 70% and
      takes about sixteen seconds to recover. Do the same round trip inside
      twenty seconds and it comes home at 100%. Twenty seconds is KEEP_SECONDS,
      which protects a tile from eviction after it was last drawn — so what you
      are seeing is the protection expiring, not a cache too small to hold it.

      Half of it is fixed already and this is the other half. B8/B9 was the
      timer being counted in frames, so a fast machine threw the ground away
      after 1.7 seconds; that is gone. What is left is that there is no history
      *behind* the twenty seconds at all, and there is a reason: the texture
      cache is smaller than the number of squares the same tier will draw, on
      every tier — Low caches 320 against 520 drawn, Medium 560 against 760,
      High 900 against 1100, Ultra 1400 against 1500. A cache smaller than the
      view is not a smaller cache, it is no history, because drawn tiles are
      stamped every frame and may never be evicted whatever the cap says.

      Raising the cap to the drawn cap was tried and is not the answer: the
      same ninety-second round trip came home at 73% instead of 70% and reached
      100% one sample sooner, which is inside the noise, while costing about
      forty megabytes on the tier a Chromebook runs. It also quietly broke the
      tile-size scaling — the cap is divided by (size/256)^2 so that 512-pixel
      tiles cost the same memory as 256-pixel ones, and a floor that ignores
      size quadruples it. Reverted.

      What the measurement actually says is that the recovery is throughput-
      bound, not cache-bound: sixteen seconds to re-fetch a view is the wire,
      not the eviction. So the fix worth having is fewer round trips, which is
      the same open question as C7. Left partly done, with the cause named and
      the wrong fix recorded so it is not tried twice.
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
- [x] B12. Randomly blurring depending on where I look
      Real, not random, and proportional to how far you turn. The ground behind
      you is outside the frustum, so it is never drawn and never asked for;
      turning is the first time it is wanted.

      Measured from settled, as the share of drawn ground at its own resolution
      rather than stretched from a coarser tile:

        turn 45 degrees    100% -> 88%, back to 100% within five seconds
        turn 90 degrees    100% -> 80%, back to 100% within five seconds
        turn 180 degrees   100% -> 63%, then 77, 92, and 100 after fifteen

      So a glance costs nothing you would notice and an about-face costs a
      third of the frame for a few seconds. Nothing goes *bare* — the coarse
      cover is already there and gets stretched over it, which is why this is
      blur and not holes.

      It is not fixable by fetching more: asking for ground you cannot see is
      the prefetch that measured worse twice, under C1/B10 and again under C2,
      and it loses for the same reason both times — throughput is the
      constraint, and a speculative request is one a certain request did not
      get. What is fixable is how long the recovery takes, and that is B7.
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
- [~] C2. Load high res more, long-range low res less
      Measured first, and the picture is not what it looks like from the code.

      Flying at 400 m, the share of drawn ground at its own resolution rather
      than stretched from a coarser tile: within a kilometre 64%, one to sixteen
      kilometres 69%, past sixteen 71%, and all three reach 100% and stay there
      once you stop covering new ground. So the far field is not being served
      *instead* of the near one — the whole pyramid converges together.

      The request priority does look wrong. It is distance / 2^(20-z), which
      reads as "biggest on screen first", and sampling the live queue in flight
      the next twelve to be served were z12@132 z14@132 z12@132 z15@134 z14@134
      z16@134 z16@135 z17@135 — a z12 square thirty kilometres off and a z21
      square underfoot inside a band of a quarter. It carries almost no
      information, because the split rule already equalises apparent size:
      that is what a screen-space-error quadtree *is*.

      Two principled replacements were built and both measured worse, on the
      same steady glide, sampled every twelve seconds for two minutes:

                                    within 1 km   1-16 km   past 16 km
        as it is                        64%         69%        71%
        holes first, then by distance   72%         34%         0%
        holes first, then by pixels
          put right (area x stretch)    15%         12%        26%

      The distance rule does what C2 asks for and the horizon never recovers:
      near ground churns continuously in flight, so under a strict near-first
      order there is always near work outstanding and the far field is never
      reached. Eight points nearer for a permanently soft horizon is not the
      trade — see B10 and M9, blur is the complaint on the other side of this.
      Ranking by visible error thrashes: it promotes whatever is most stretched,
      which is always the newest coarse square, and nothing finishes.

      So the near-uniform ordering is left alone. It looks degenerate and it is
      what makes the pyramid converge together. Left partly done rather than
      done because the ask is not satisfied — near is not favoured — and the
      honest reason is that the two ways of favouring it both cost more than
      they bought. Both are recorded here so the next attempt starts past them.
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
- [x] C5. Map zooms in faster and more detailed than the terrain — ground should be faster and higher quality
      Same finding as M4, which has the detail: a depth limit that latched two
      levels below the provider and could never recover, plus the map being a
      flat view at native scale against ground seen at an angle and stretched
      58 per cent of the time while moving.
- [x] C6. Takes too long for max res to arrive — maybe fewer modes
      The waiting was real and had two causes, both already fixed elsewhere: the
      streaming budget was spare time only, so a machine missing its target got
      45 ms of terrain work a second instead of 1296 (C3/C4), and the depth
      limit latched two levels below the provider with no way back (M4/C5).

      Measured after both, over a two and a half minute repeated dive from 900 m
      down to 120 m: in the final frame, 320 of the 326 squares on screen are
      drawn at their own resolution and six are stretched, none bare. That is
      the max res arriving.

      "Maybe fewer modes" is the one thing not worth doing. Of the 1,238 tiles
      fetched across that approach, 363 — 29% — later had a finer tile of the
      same ground fetched as well, which is the ladder the complaint is about.
      But those are not waste: at 900 m you are looking at z14 and at 120 m you
      are looking at z20, and both are on the screen at the time. Taking rungs
      out does not make the sharp one arrive sooner; it makes you look at a
      coarser picture for longer on the way down. The depth by count over that
      approach was z11:22 z12:30 z13:33 z14:53 z15:77 z16:115 z17:139 z18:142
      z19:125 z20:157 z21:307 — a pyramid, with most of the spend at the bottom
      where you end up.
- [?] C7. Preload/load everything when close, so approaching does not trigger a high-res render unless it is a LOD
      The first half was built and measured worse. Asking ahead of where you are
      going — the tiles you will need in a second, fetched now — took the share
      of the frame drawn from stretched imagery from 58.1% to 61.7%, and 61.5%
      with the look-ahead gated on speed. It was reverted; see B10 for the
      caveat about the sandbox proxy, which serialises tiles and so punishes any
      extra request harder than a real browser would.

      The reason it loses is the same one that sank C2's reordering: throughput
      is the constraint, not ordering, and a speculative request is one a
      certain request did not get. It only pays if the guess is nearly always
      right, and steering is not.

      The second half — "unless it is a LOD" — is already so. Approaching does
      not trigger a fresh high-res render of ground you have: the finer tile is
      requested while the coarser one you already have keeps being drawn,
      stretched, until it lands. That is what the 29% ladder in C6 is.

      Left as a question rather than closed, because the thing that would make
      the first half work is not more prefetching, it is more throughput —
      several tiles in flight per round trip — and whether that is worth doing
      depends on which provider you actually fly on.
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
- [x] C10. Distant view should be fixed low-res LODs, getting less detailed further out
      It already is, and here it is measured rather than asserted. Standing on
      the ground looking at the horizon, and again from 400 m with the nose 15
      degrees down, every square actually drawn, bucketed by how far off it is
      and reported as the shallowest / middle / deepest zoom in the bucket:

        under 250 m      18 / 20 / 21
        250 m to 1 km    17 / 18 / 19
        1 to 4 km        15 / 16 / 17
        4 to 16 km       13 / 14 / 15
        16 to 64 km      11 / 12 / 13
        past 64 km       11 / 11 / 11

      Which is a fixed pyramid getting two levels coarser for every four times
      the distance, and it stops at z11 rather than running on. It is not a
      constant anyone typed: it falls out of the screen-space-error rule, which
      splits a square only while it still looks bigger than a threshold. At
      30 km a z12 square is 9.8 km across and subtends about 250 screen pixels
      on a 960-wide view, so its 256-pixel texture is landing at roughly 1:1 —
      exactly the level it should be, and one coarser would visibly blur the
      horizon.
- [x] C11. LODs for distance render only
      Same answer as C10, from the same measurement: the distant view is drawn
      from coarse levels only and never descends. Past 16 km nothing finer than
      z13 is ever built, and past 64 km nothing finer than z11 — the quadtree
      stops splitting there because the square already looks small enough, so
      the deep levels are never requested, never fetched and never meshed for
      ground at that range.

      The one place this was not true was straight up and down, and it is fixed:
      the split test used horizontal distance, which is nought for the ground
      directly beneath you however high you are, so at 9 km the tree descended
      to z23 under your feet — maximum depth for a patch seen from nine
      kilometres — and spent the frame's whole budget there. See C8.
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

- [x] D1. Physics do not match Minecraft — barely fall when standing still; looking down then forward quickly gives far too much forward speed
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
      were scale — 30 m/s crosses a Minecraft village in a second and a real
      valley in a minute — and the rocket, which deliberately departs from
      vanilla so a weak slot cannot brake you (D7, D5).

      It was the rocket, and it was worse than a mismatch. See D4: the fix that
      stopped a weak slot braking you clamped only the forward half of vanilla's
      push and left the steering half running for ever, which at a shallow dive
      is an engine. "Looking down then forward quickly gives far too much
      forward speed" is that exactly — ten to thirty-five degrees down was the
      band it compounded in, and looking down is what put you there. Fixed at
      the cause. Held twenty degrees down on continuous rockets, the game now
      settles at 40 m/s and stays there; it used to pass 5,700 m/s in a minute.
- [x] D2. Looking down to gain speed should work as it does in MC
      It does, and the trade is the interesting part. Dive for three seconds
      from a 30 m/s cruise, then level out, and the horizontal speed you keep
      against the height you spent:

        10 deg    30 m/s     18 m of height     0.6 m/s per 100 m
        20 deg    33         21                14.4
        30 deg    38         27                27.4
        40 deg    43         37                33.3
        50 deg    47         53                32.2
        60 deg    50         73                27.2
        75 deg    51        110                19.4
        90 deg    51        129                16.4

      So there is a best angle and it is about forty degrees, a vertical drop is
      the *worst* trade on the board — nearly twice the height for the same
      speed as sixty — and none of that is tuned here, it falls out of
      Minecraft's own tick. It is also why the dive-and-climb rhythm does not
      close (see CLIMB_TRADE): the speed bleeds back off. After a 60 degree
      dive, levelled, it goes 47.5 -> 41.9 -> 38.0 -> 35.4 -> 33.7 m/s over ten
      seconds, on its way back to the 30.2 m/s a level glide holds. About eight
      seconds of being fast for seventy metres of height.
- [x] D3. Should I jolt to a stop when flight duration ends and I am looking down?
      No, and you do not. Measured at the burnout tick itself, which is where a
      jolt would have to be:

        aimed level, Rocket I     33.5 -> 33.2 m/s    -0.7% in one tick
        aimed level, Rocket V    107.0 -> 106.0       -0.9%
        45 down, Rocket I         36.8 -> 37.2        +0.8%
        45 down, Rocket V        107.1 -> 106.5       -0.6%
        straight down, Rocket I   43.4 -> 44.1        +1.6%
        straight down, Rocket V  107.8 -> 107.2       -0.5%

      Under one per cent in a twentieth of a second, and pointed down it is
      often positive — gravity takes over the moment the rocket stops. The
      largest single-tick change anywhere in a rocket flight is ignition, at
      +120%, not burnout. What you actually feel afterwards is drag, which is
      slow and directional: a Rocket V burning out level is down to 91.6 m/s a
      second later, but nosed 45 degrees down it is still doing 106.5.

      This was asked as a design question rather than a bug report, so: it
      should not jolt, because Minecraft does not — the firework stops pushing
      and the drag and the gravity are already what they were. Nothing was
      changed for it.
- [x] D4. Going faster by rocketing more downward makes no sense — fix the physics engine
      Right, and it was a real bug rather than a matter of degree — the engine
      had a runaway in it, and pointing down is what triggered it.

      D7 stopped a weak rocket braking you by clamping the forward half of
      Minecraft's push at nought. But that push is one vector doing two jobs:
      driving your speed along your look toward the rocket's target, and halving
      whatever part of your velocity points elsewhere, which is the half that
      makes a rocket steer. Clamping only the forward half left the steering
      half at full strength for ever after the rocket was spent — and that half
      alone is an engine. It pins your velocity to your look axis, so a shallow
      dive sinks at |v| * sin(dive) instead of the glide's own few metres a
      second, and the elytra hands a tenth of the sink straight back as forward
      speed. A gain proportional to your speed against a drag that is one per
      cent of it, so it compounds.

      Isolated rather than guessed: the glide alone held at twenty degrees down
      settles at 40 m/s; the steering half alone, with the forward push removed
      entirely, reaches 2,512.

      Held thrust — which is what a hotbar full of rockets buys — used to do
      this, against vanilla sitting at 35 m/s for ever:

        aim       vanilla    was        now
        level      33.5      33.5      33.5
        10 down    34.3      93.8      34.1
        20 down    34.7     248.0      40.1
        30 down    34.6     102.4      50.2
        45 down    34.3      40.7      65.3
        90 down    35.7      78.4      78.4

      and at twenty degrees down it did not settle at 248 either, it was still
      climbing: 353 m/s at twenty seconds, 81,837 at two minutes.

      Fixed at the cause. The push is gated whole instead of clamped in half — a
      rocket with nothing left to give at this speed gives nothing, steering
      included. Everything the clamp existed for survives: a Rocket I fired
      while cruising on a V is now bit-identical to coasting (107.0 -> 94.2
      either way), so it is inert rather than a brake (D7); the governor is
      vanilla's own, two tenths of a block a tick past the target; the slots
      still read 33/52/70/89/107; three alight still reach cruise in 2 ticks
      against 7 for one (D5); and the kick off a standstill is unchanged (D8).

      What is left is the honest answer to the question as asked. Across a whole
      burn, aim barely matters: 70.2 m/s level, 74.5 straight down, and nothing
      outside that. Six per cent from level to vertical — which is what vanilla
      does too, 33.5 to 35.7, also six per cent. Pointing down is worth a little
      because gravity pulls the way you are pointed, and that is all it is worth.

      Guarded in the self-test by a sweep of every angle and three slots under
      twenty seconds of unbroken thrust. It fails at 458 m/s on the old clamp
      and passes at 112 on this. Verified in the running game as well, not only
      in the module: holding the rocket key at twenty degrees down, the speed
      reads 39 -> 40 m/s and stays there for a minute, where the old code read
      53 -> 5,759.
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

      Measured: a Rocket I settles at 33.5 m/s where vanilla settles at 33.5,
      and three alight reach 33 m/s in 2 ticks against 7 for one, holding 33.7.

      The clamp itself did not survive — see D4. Clamping the forward half of
      the push left the steering half running after the rocket was spent, which
      at a shallow dive compounds without bound. The push is gated whole now:
      spent means spent, steering included. Every number above is unchanged by
      that, because below the governor nothing about the arithmetic differs.
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
      bigger rocket pushes harder, so the small slots brake. A spent rocket is
      inert instead: the brake is 60.7 m/s -> 0, and each rocket still settles
      at its own cruise.

      How it is made inert changed once. Clamping the forward half of the push
      at nought did it, but left the steering half pushing for ever — see D4,
      which is the runaway that came out of exactly that. The whole push is
      gated now, so a Rocket I fired while cruising on a V is bit-identical to
      coasting: 107.0 -> 94.2 either way, which is drag and nothing else.
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
- [x] D11. Improve walking speed and being flat on the ground
      The speed was already right: 4.32 m/s walking and 5.61 sprinting are
      Minecraft's own 4.317 and 5.612, and the fixed clock hands them out
      whole. Nothing to improve there.

      Standing on the ground was half done. The grade was measured *along* the
      way you face and the body leant with it — but not the grade *across* you,
      so walking a contour read as flat ground and the figure stood bolt
      upright out of the hillside with one boot in the air and the other
      buried. Which is the case that matters, because walking along a contour
      is what anyone does on a steep slope: it is the only way up one.

      Both grades are measured now, over a couple of metres either side rather
      than from a polygon normal — what a walker feels, not the tilt under one
      boot — and the body banks with the cross-slope as it already leant with
      the grade. The same 0.45 of it either way, because a walker takes up some
      of a hill in their ankles rather than all of it in their spine.

      Checked on a synthetic hillside: facing up it reads 0.46 rad of slope and
      no bank, facing along the contour reads 0.46 of bank and no slope,
      turning about puts the hill on the other shoulder, and in the air both
      fade to nothing.

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
- [x] G11. Explain the "Cesium ion imagery asset / 2" setting properly
      It said "which raster asset in your ion account to fly over", which tells
      you what the number is for and nothing about where to get it or what
      happens when it is wrong. It now says where to find it — My Assets on the
      ion dashboard, the ID column — that it must be an *imagery* asset, since
      terrain and 3D Tiles have IDs too and pasting one of those refuses every
      tile and looks like a broken key rather than a wrong number, why 2 is the
      default, and that getting it wrong invents nothing: the ground falls back
      through the other providers and says so.
- [ ] G12. Ensure the latest Cesium data is used
- [x] G13. Auto-change provider via an auto option in the dropdown
      There was a "find the best one here" button that ran once and wrote its
      answer into the setting. Now there is a standing choice: "Auto — the best
      one you can use", first in the dropdown, resolved fresh every time the
      panel changes anything. Paste a Mapbox key and the ground is Mapbox on the
      next frame without reopening the dropdown; remove it and it falls back
      rather than leaving a blank world.

      The order is the same one the standby chain already falls through —
      anything you hold a key for first, then the free ones deepest first — so
      auto is exactly the top of the list the game would use anyway rather than
      a second opinion that could disagree with it.

      It is deliberately not a member of the provider list. It is a choice
      *about* providers, and putting it in the list would have it turning up in
      fallback chains, in the standby order, and in "which square does this one
      serve", none of which mean anything for something that is not a map
      server. It is resolved to a real id once, where the sources are built, and
      everything downstream sees an ordinary provider.

      The help text says which one it has landed on, so it is never a mystery
      what you are actually flying over.
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
- [x] G18. Why is it lower res than, e.g., the Mapbox website
      Two reasons, one of which was a bug and is fixed.

      The bug: the ground was capped below what the provider serves and could
      never recover — see M4. A depth written off in one place stayed written
      off everywhere for the rest of the session, because the cap stopped
      anything asking above it, so nothing could arrive to lift it.

      The rest is presentation, and the Mapbox setting now says so where it is
      asked: it is the same tiles at the same 512-pixel size their own site
      draws. A flat map puts about one texel on one screen pixel; here the
      photograph is draped over terrain and usually seen at an angle, so the
      same picture covers fewer pixels. Fly straight down at it and the two
      match.
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

- [x] J1. Completely remove the code of the fake generator
      Gone, and not by deleting the file and leaving the callers. There is no
      src/tiles/procedural.js, nothing imports one, no provider list carries an
      'offline' or 'procedural' id, and core/math.js has lost hash3, rand3 and
      makeRng — the three functions that were the whole ability to invent a
      square. A tile that does not arrive is drawn as a neutral grey (see
      groundNotLoaded) or not drawn at all; elevation with no reading is sea
      level rather than invented relief; a coastline with no imagery answers
      "land" rather than guessing; and the two octaves of noise that used to be
      multiplied over the photograph are gone, which is what used to make bare
      rock look like carpet.

      The self-test holds all of that shut rather than trusting the deletion:
      the file must not exist, nothing may match /procedural/i, the provider
      list may not carry those ids, elevation may not expose an `invented`
      getter, and the map may not invent a tile.

      What is left that is not measured, in full, because "no fake data" should
      mean an enumerable claim rather than a slogan. Every remaining call to
      Math.random or a noise hash in the whole of src/:

        world/weather.js   the cloud sheet, and where raindrops and snowflakes
                           sit in the box around you. Sky, not ground.
        world/shaders.js   the same cloud field again, for the shadow the deck
                           casts and for crown-scale relief inside a wood.
        world/places.js    picking one of a list of real settlements.
        world/rtp.js       picking a bearing for a random teleport.
        geo/mercator.js    picking a point for the same.

      The last three choose rather than invent — a real place, chosen at random.
      The first two are weather and are the sky. The crown relief is the one
      that touches the ground, and its *placement* is data both ways: an
      OpenStreetMap woodland polygon, or a canopy score measured off the
      photograph's own greenness and roughness. Nothing there decides that a
      wood exists.
- [x] J2. A test on every mode
      The individual behaviours were already tested — a fall reaches 78.4, a
      walk is 4.32, a glide is Minecraft's tick — but nothing went through the
      thing being asked about: the selector that *chooses* the mode. Those are
      different failures. A mode that is never selected passes every test of
      what it does, because none of them go through the selector.

      There is one now, driving the real controller with one state per mode
      rather than setting player.mode and reading it back: on the ground is
      walk and it moves you 8.4 m; airborne with the wings shut is fall and it
      drops you; airborne with them open is glide and it makes 57 m across for
      5 m down rather than falling; the fly cheat is fly and it holds altitude
      and climbs; standing in a lake sets swimming and the water holds you at
      -0.9 m/s instead of 78; and both perspectives are reachable.

      It found one straight away. Jump was the ascend key while flying *and*
      still the wings key, because the airborne branch of readJumpEdges only
      asks whether you are off the ground and flying always is. One press of
      ascend deployed the elytra behind your back — invisible, because the fly
      tick moves you the same either way — made rockets lightable in a mode
      with no use for them, and dropped you into a glide the moment you turned
      the cheat off, from wherever you were. Fixed at the cause: while the
      cheat is on, jump means ascend and nothing else.
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

      Third elimination: the tile skirts. A skirt is a curtain hung off a tile
      edge with the edge row of texels stretched down it, which is exactly the
      shape of smear being complained about — so they were zeroed and the same
      view re-shot. The band is pixel-for-pixel unchanged. Not the skirts.

      What is left is a shadowed slope seen at a grazing angle, showing the
      source photograph's own chroma noise stretched along the surface — the
      colour spread is 11.8 against a mean of 27.8, which is high in relative
      terms and is what reads as rainbow in near-black. That is real imagery
      displayed honestly. It could be made to look better by lifting or
      desaturating deep shadow, which is a display choice rather than an
      invention, but it is a choice worth asking about rather than making.

      One thing that helped and is not a display choice: the chase camera used
      to be pushed straight up out of any ground it landed in, so standing on a
      steep slope it ended up about sixty centimetres above the hillside
      looking straight along it. It walks the line out to where it wants to be
      now and stops short of whatever is in the way — closer, not higher, which
      is what a chase camera in anything else does. Measured at Lauterbrunnen:
      facing the west wall it comes in to 1.51 m from 4.44, and every other
      direction is unchanged. tools/chasecheck.mjs is that measurement kept.

      It does not fix the band in the obvious screenshot, because there the
      cliff is beside the player rather than under the camera — which is why a
      screenshot could not settle it either way and the probe could.

- [ ] M3. It is so laggy
- [x] M4. The quality is bad; zooming in on the map looks better than the ground
      Two answers, and the second was a real bug.

      The plain one: it is the same imagery. The map is flat and drawn at about
      one texel to the pixel; the ground is that photograph draped over terrain
      and usually seen at an angle, so the same data is spread over fewer
      pixels. On top of that the map is static and always shows exact tiles,
      while 58 per cent of the moving ground is a coarser tile stretched over
      it — see B10. Presentation, not data.

      The real one: the ground was capped two levels below what the provider
      serves, and could never recover. `reviewDepth` writes a provider off at a
      level once it has refused enough tiles there, and it says of itself that
      "one tile arriving at a written-off level puts it back" — which is true
      and could never happen, because the limit caps how deep anything is asked
      for, so no tile could arrive to lift it. A one-way latch.

      And the limit is one number for the whole provider rather than one per
      place. Esri stops at zoom 21 over an alpine valley and serves 23 over a
      city, so flying the valley first capped the city at 21 for the rest of the
      session with nothing able to discover otherwise. Measured at
      Lauterbrunnen: provider declares 23, ground drew at 21.

      It asks again now — one tile, every half minute, one level above the
      limit, over the ground being looked at, last in the queue. If it lands the
      limit lifts; if not the failure count grows and nothing changes.
- [x] M5. Explored area on the map is still nowhere near what was actually explored
      Cause: save() threw away 45% of the level-16 squares at random whenever the
      record passed 160,000 — permanently, since what it wrote is what came
      back, so every reload thinned the survivors again (55%, 30%, 17%).
      Random scattered holes through ground you had actually flown, different
      every time. The cap was real at ~3 MB of key strings; explored ground is
      discs along a path, so rows compress 14x and 2.7M squares now fit. Over
      the ceiling the oldest fine detail goes, in order, never at random.
- [x] M6. Player position is still off on the minimap
      The marker is dead centre by construction and the tile maths is right —
      the player's own point lands at exactly the canvas centre. What was off
      was the number being handed in.

      Physics runs on a fixed twentieth of a second and the world is drawn
      somewhere between the last two ticks, so the drawn position trails the
      physics one by up to a whole tick. The coordinates were read from the
      physics position, so the marker sat ahead of the ground under it by
      exactly that: nothing at walking pace, 1.5 m gliding, and 5.35 m on a
      Rocket V — six or seven pixels of map sliding out from under you, and
      more the faster you go, which is what makes it look like the map rather
      than the clock.

      They come from the drawn position now. It is settled before they are
      read, and a teleport snaps the two together, so there is no moment where
      the answer is from before the jump.
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
- [x] M13. Not everything fake has been removed
      Right at the time, and swept again now rather than assumed. See J1 for the
      full enumeration: every remaining source of an unmeasured number in the
      whole of src/ is listed there, and none of them decides where anything on
      the ground is. What went since the complaint: the noise printed over the
      imagery, the biome guessed from latitude, the sand along a waterline, the
      rock on anything steep, the invented interiors of buildings, the invented
      relief under a tile with no elevation reading, the invented coastline, and
      hash3/rand3/makeRng themselves.
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

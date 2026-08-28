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
- [ ] A4. Hang when changing providers on terrain
- [ ] A5. Seizure/flashing when changing provider
- [~] A6. Pressing a button within 3 s of RTP reverts to old spots and removes the new discovery
      — the half of this I could reproduce is fixed: a keypress no longer
      abandons the hold onto unmeasured ground. The "reverts to old spots"
      part I have not reproduced yet and it stays open.
- [ ] A7. It randomly refreshes
- [ ] A8. Why is it forcing to fly — why can't it remember position on relog

## B. The ground falls apart

- [ ] B1. When flying, the ground glitches / blurs briefly / gets holes / moves up and down in sections — it needs to lock
- [~] B2. Random times a patch below appears, then the player glitches down
      — same cause as A1 and improved by the same change, but only measured on
      arrival. A correction arriving mid-flight is still unhandled.
- [ ] B3. Sometimes most of the ground below me is missing and I stand on an invisible platform with patches
- [~] B4. Floating on invisible ground above the imagery
      — you are no longer *set down* on ground the game has not measured.
      Whether it still happens after a mid-flight correction is untested.
- [ ] B5. Ground becomes griddy and comes back — moves up or down and shows a grid
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
- [ ] B10. Sometimes everything becomes super blurry when I do something, comes back after 1 s
- [ ] B11. Random times when looking, everything becomes a solid colour
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

- [ ] C1. Load high res where I am and where I am looking, more chunks in parallel
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
- [ ] C8. Flying up should not decrease quality
- [x] C9. Minimap often does not load satellite when high up — four rescues by a
      standby latched the map onto it for the session with no way back, and two
      of the ways to earn one (no imagery here, provider not ready) are not the
      server's fault. Now a rate, over ten seconds, transport failures only,
      and it expires.
- [ ] C10. Distant view should be fixed low-res LODs, getting less detailed further out
- [ ] C11. LODs for distance render only
- [ ] C12. Why is the distance horizon forced
- [ ] C13. "Draw twice as far over country you have seen" — what is this, and it reads badly

## D. Physics

- [ ] D1. Physics do not match Minecraft — barely fall when standing still; looking down then forward quickly gives far too much forward speed
- [ ] D2. Looking down to gain speed should work as it does in MC
- [ ] D3. Should I jolt to a stop when flight duration ends and I am looking down?
- [ ] D4. Going faster by rocketing more downward makes no sense — fix the physics engine
- [ ] D5. Flight duration and deceleration should match MC — spamming should make you a bit faster (check this)
- [ ] D6. Rocket times do not match Minecraft — fix, and use the same scale for speed; the light-duration one has MC default speed
- [x] D7. Using the slot of a slower rocket slows you down
      Measured: cruising at 106 m/s on a Rocket V, firing a Rocket I took you to
      33.5 — 69% of your speed for pressing the wrong hotbar key. Minecraft's
      line pulls toward the rocket's target from either direction, which barely
      shows in vanilla because every firework aims at the same 1.5 b/t; here a
      bigger rocket pushes harder, so the small slots brake. It now pushes
      toward its target, never past it, never back from beyond it. The brake is
      60.7 m/s -> 0, and each rocket still settles at its own cruise.
- [ ] D8. More speed/movement initially when going from slow to rocket speed
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

- [ ] E1. Charges faster
- [ ] E2. 1.2x speed and duration, and rename it — "rapid mode" or something better
- [ ] E3. Should affect everything, not just rockets — base, walk, glide
- [ ] E4. Countdown should not run down while in settings or paused
- [ ] E5. Streamline the speed mode panel
- [ ] E6. Where is speed mode on touchscreen

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
- [ ] F10. Improve the starting map zoom
- [x] F11. Opening the map should not stop the game
      The map was in the pause list because stopping the world was the only way
      to stop W flying you into a mountain while you typed a place name. Those
      are two questions: `paused` stops the clock, `takingKeys` stops the
      keyboard. The map now does only the second.
- [ ] F12. Waypoint dragger in the map
- [ ] F13. Waypoints appear on the map
- [ ] F14. Waypoint and distance as a box of text plus a coloured beam beacon
- [ ] F15. Circular, square or squircle option for the minimap

## G. Providers and 3D

- [ ] G1. Google session failed (403) — maps_api.tas.BootstrapService.Bootstrap blocked
- [ ] G2. Fix broken Google generally
- [ ] G3. Photorealistic Cesium ion key broken — "failed to fetch"
- [ ] G4. 3D not working at all, including OSM buildings
- [ ] G5. No 3D terrain for buildings, infrastructure or vegetation
- [ ] G6. Why can I see 3D houses in MSFS (Azure) but not here
- [ ] G7. Mapbox supports 3D buildings + terrain — why is there none here
- [ ] G8. Bing has satellite and a 3D mode — add the 3D
- [ ] G9. Add Azure aerial
- [ ] G10. Add more Cesium; Bing via Cesium
- [ ] G11. Explain the "Cesium ion imagery asset / 2" setting properly
- [ ] G12. Ensure the latest Cesium data is used
- [ ] G13. Auto-change provider via an auto option in the dropdown
- [ ] G14. Fallbacks
- [ ] G15. Retry when failed
- [ ] G16. Stop ignoring failures and marking them normal
- [ ] G17. Remember tokens
- [ ] G18. Why is it lower res than, e.g., the Mapbox website
- [ ] G19. Show the imagery year
- [x] G20. Why cap zoom at 22 or 23 — force it to infinity and future-proof it (1–25, then Infinity)
      — the slider runs 1 to 25 and then to "No limit", which is the default.
      Every fixed number here was wrong in turn: 19, then 20, then the deepest
      a provider declared. What stops it now is the provider refusing and the
      photographs themselves stopping getting sharper, both measured.

## H. World and atmosphere

- [ ] H1. There are no bumps on trees
- [ ] H2. When bumping green parts, skip it where the green runs bigger than a size throughout, so grass is not marked — but still count areas with holes of a different colour
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
- [ ] I2. Default height 6 ft, and matching
- [x] I3. Why do I feel so big
      Measured against real anthropometry the figure was 1.68x too wide across
      the chest, 1.80x across the shoulders and 2.09x across the hips — it was
      Minecraft-shaped, not person-shaped. Now within 1.00-1.17x. The collision
      capsule went with it: 0.21 of height is an 0.83 m barrel on a 6'6" frame,
      now 0.12 (0.24 across). This is also why looking down in first person
      filled the screen with a wall of cloth — your own chest, half a metre wide,
      a quarter of a metre from your eye.
- [ ] I4. Make altitude accurate
- [ ] I5. Make speed accurate, and size
- [ ] I6. Number on the compass
- [x] I7. Vertical look angle in degrees, maybe either side of the compass
      Added next to the compass in the location card: 'level', '+45°', '−20°'.
- [x] I8. Centre dot / plus
      Already there — .hud-crosshair, behind the showCrosshair setting. Confirmed
      visible in a screenshot of the running game.
- [x] I9. Per second and per minute, not only per hour
      Added as a setting: per hour (km/h, mph), per minute (km/min, mi/min),
      per second (m/s, ft/s). Per hour stays the default.
- [ ] I10. Imperial/metric everywhere, not only in some places
- [~] I11. Seeing hand, rocket and body while gliding
      Partly: looked at first person in the running game. The body was there but
      unreadable — the chest was Minecraft-wide and the cloth texture had its
      wrapping set to repeat and its repeat never set, so one photograph of the
      weave was stretched over the whole chest at about fifty times life size.
      Both fixed. Still to check: the rocket in hand while gliding.
- [ ] I12. Improve the freecam model
- [ ] I13. Freecam that does not pause the game
- [ ] I14. Keybinds — "wtf is f"
- [x] I15. Touchscreen controls do not go away when returning to keyboard
      watchForTouch only ever called setEnabled(true) — nothing turned them off.
      On anything with both a finger and a keyboard, one tap pinned the sticks
      over the game for the session. A game key or a real mouse press now puts
      them away; a coarse pointer still starts them on, for a phone.
- [ ] I16. Broken letters on certain devices
- [x] I17. Favicon as an elytra
      A pair of folded wings with the spine between them, five paths, inline SVG.
      Rendered at 16, 32 and 128 px and looked at, not just written.
- [ ] I18. Barrel roll as in the MC mod, not a keybind
- [ ] I19. FOV increase should depend on speed
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
- [ ] M2. Flying model broken
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
- [ ] M16. One branch, with gh-pages as the only other
- [ ] M17. Stop patching with bandaids — fix the system
- [ ] M18. Barrel roll, implemented like the mod, not as a keybind

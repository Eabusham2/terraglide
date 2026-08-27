# TerraGlide backlog

Everything asked for, in the words it was asked in, so nothing depends on
anyone remembering it. Nothing is removed from this file when it is done — it
is ticked, so the record of what was asked survives alongside the record of
what was built.

Status: `[ ]` open · `[x]` done, with the evidence · `[~]` partly done, with
what is left · `[?]` needs a decision from you.

---

## A. Stops you playing

- [x] A1. Cannot move or jump on launch — it keeps restarting when I do
      — input did nothing because the arrival hold froze the player and then
      threw them: on a launch into Antarctica the ground went 0 m, 945 m,
      3,656 m and carried them up each time. Hold now waits for the ground to
      stop moving, and pressing a key gives you the controls without giving up
      the floor. Measured after: walking and jumping respond, 0 upward throws
      once you have control.
- [ ] A2. Clicking out and back in, or Esc then jumping, breaks it
- [ ] A3. Teleporting again when I look down after a teleport
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
- [ ] B8. High res unloads from behind me
- [ ] B9. Unloading and reloading and breaking
- [ ] B10. Sometimes everything becomes super blurry when I do something, comes back after 1 s
- [ ] B11. Random times when looking, everything becomes a solid colour
- [ ] B12. Randomly blurring depending on where I look
- [ ] B13. In freecam I see the ground behind me as invisible
- [ ] B14. Debug and remove glitches generally

## C. Loading order and speed

- [ ] C1. Load high res where I am and where I am looking, more chunks in parallel
- [ ] C2. Load high res more, long-range low res less
- [ ] C3. Ground loading is super slow but the minimap is already loaded
- [ ] C4. Make it load HQ ground fast
- [ ] C5. Map zooms in faster and more detailed than the terrain — ground should be faster and higher quality
- [ ] C6. Takes too long for max res to arrive — maybe fewer modes
- [ ] C7. Preload/load everything when close, so approaching does not trigger a high-res render unless it is a LOD
- [ ] C8. Flying up should not decrease quality
- [ ] C9. Minimap often does not load satellite when high up
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
- [ ] D7. Using the slot of a slower rocket slows you down
- [ ] D8. More speed/movement initially when going from slow to rocket speed
- [ ] D9. Speed accuracy breaks over time — the player slows down
- [ ] D10. Speed readout says faster than reality
- [ ] D11. Improve walking speed and being flat on the ground

## E. Speed mode

- [ ] E1. Charges faster
- [ ] E2. 1.2x speed and duration, and rename it — "rapid mode" or something better
- [ ] E3. Should affect everything, not just rockets — base, walk, glide
- [ ] E4. Countdown should not run down while in settings or paused
- [ ] E5. Streamline the speed mode panel
- [ ] E6. Where is speed mode on touchscreen

## F. Map and minimap

- [ ] F1. NWSE on the minimap preview is too big
- [ ] F2. Improve the position of NWSE on the map
- [ ] F3. Map is white, especially when going up
- [ ] F4. Map is white for a moment when zooming in
- [ ] F5. Stretched map
- [ ] F6. Explored area must look the same and stay visible at every zoom
- [ ] F7. Map should show exactly where I explored, especially zoomed out
- [ ] F8. Map does not show only what I saw, and changes size with zoom
- [ ] F9. Remove grids from places like the example map
- [ ] F10. Improve the starting map zoom
- [ ] F11. Opening the map should not stop the game
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
- [ ] G20. Why cap zoom at 22 or 23 — force it to infinity and future-proof it (1–25, then Infinity)

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

- [ ] I1. Player size should match up properly
- [ ] I2. Default height 6 ft, and matching
- [ ] I3. Why do I feel so big
- [ ] I4. Make altitude accurate
- [ ] I5. Make speed accurate, and size
- [ ] I6. Number on the compass
- [ ] I7. Vertical look angle in degrees, maybe either side of the compass
- [ ] I8. Centre dot / plus
- [ ] I9. Per second and per minute, not only per hour
- [ ] I10. Imperial/metric everywhere, not only in some places
- [ ] I11. Seeing hand, rocket and body while gliding
- [ ] I12. Improve the freecam model
- [ ] I13. Freecam that does not pause the game
- [ ] I14. Keybinds — "wtf is f"
- [ ] I15. Touchscreen controls do not go away when returning to keyboard
- [ ] I16. Broken letters on certain devices
- [ ] I17. Favicon as an elytra
- [ ] I18. Barrel roll as in the MC mod, not a keybind
- [ ] I19. FOV increase should depend on speed
- [ ] I20. Seed hacks, custom rockets, custom size and more in the cheat panel
- [ ] I21. Remember the trail

## J. How the work is done

- [ ] J1. Completely remove the code of the fake generator
- [ ] J2. A test on every mode
- [ ] J3. Fix causes, not symptoms — no papering over
- [ ] J4. Changing any setting applies instantly (graphics presets, 3D type)
- [ ] J5. Ensure graphics presets update

## K. Needs a decision

- [?] K1. "Why is it number …" — the sentence stops there; which number?

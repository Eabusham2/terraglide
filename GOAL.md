# GOAL: every item in BACKLOG.md done properly and fully — nothing failing, everything addressed

Status: IN PROGRESS | sweeps 4-7 | 10 commits pushed | backlog 131 done / 23 partial / 4 questions
Started: 2026-08-30
Base: cb1b26e, self test 1060/1060, exit 0

Backlog at start: 120 `[x]`, 0 `[ ]`, 26 `[~]`, 6 `[?]`.
This ledger covers the 32 that are not `[x]`.

---

## R-A. The throughput cluster — the one real block of open engineering
These six are the same root, stated six ways, and every one of them is
currently excused by a caveat I have since found to be false: that the test
harness's proxy serialises every tile. It does not — it runs 25 concurrent and
relays about 20 a second. So the prefetch and reordering experiments were
dismissed with a wrong reason attached, and want re-running.

- [x] R-A1  Harness runs 22 concurrent, median start-to-start gap 0 ms, p90 14 ms, 1456 reqs, 0 failed. It does NOT serialise.
- [x] R-A2  Corrected in all three places (B10, C1, C7) with the measurement that disproves it.
- [x] R-A3  B10 — root found instead: the queue was pumped once a frame. Prefetch lost because the queue was already full of undispatched certain work. 23.7% -> 11.0% stretched.
- [x] R-A4  C2 — reordering a queue drained at 11% was beside the point; recorded under C14.
- [x] R-A5  C7 — settled: the prefetch really did lose, and now there is a reason. Recorded.
- [x] R-A6  B7 — re-measured: home at 74.8%, settled plateau in 6 s where it took 16. Recorded.
- [x] R-A7  B1 — blurcheck both arms: 63.9->28.9 flying, 78.5->23.5 after a 180, 33.9->4.0 standing. Recorded.

## R-B. Items whose remaining half is a decision only the user can make
Each is finished as far as engineering goes. Not closable here; each needs a
one-line answer. They go in the closing message as a single batch of questions.

- [ ] R-B1  H6  hold the sun at the photograph's capture time? (proposal: no, as a default-off setting if wanted)
- [ ] R-B2  M2c lift/desaturate deep shadow on grazing slopes? (a display choice, not an invention)
- [ ] R-B3  I20 "seed hacks" — there is no seed; what was meant?
- [ ] R-B4  K1  "Why is it number …" — the sentence stops there
- [ ] R-B5  M16 delete `online-singlefile` and `claude/world-exploration-game-962wpo`? (irreversible, needs a word)
- [ ] R-B6  Task #18 "3D models via Glif / Hugging Face" — generated models conflict with the no-invented-data rule

## R-C. Items blocked on the user's own machine
Measured clean here; the report was from their device. Not closable by me.
The work left is to keep hardening the causes that could produce them.

- [ ] R-C1  A0  boot hang
- [ ] R-C2  A9  Chromebook
- [ ] R-C3  A6  keypress after RTP
- [ ] R-C4  A7  tab reloads
- [ ] R-C5  B3  missing ground / invisible platform
- [ ] R-C6  B5  griddy ground
- [ ] R-C7  B6  disappearing in chunks
- [ ] R-C8  I16 broken letters
- [ ] R-C9  M3  lag

## R-D. Items blocked on a credential the user holds
- [ ] R-D1  G1  Google 403
- [ ] R-D2  G2  Google generally
- [ ] R-D3  G5  3D vegetation (needs Google or ion)
- [ ] R-D4  G7  Mapbox vector buildings (needs a Mapbox token)

## R-E. Standing instructions — no end condition, so never `[x]`
The right treatment is to keep obeying them and to keep the record current.
- [ ] R-E1  B14 debug and remove glitches generally
- [ ] R-E2  J3  fix causes, not symptoms
- [ ] R-E3  L1  improve it all
- [ ] R-E4  L2  bug-test properly before claiming a fix
- [ ] R-E5  M17 no bandaids

## R-F. Triage — DONE
- [x] R-F1  H3 Antarctica: engineering complete (3 bugs fixed); the sandbox cannot reach Antarctic imagery -> moves to R-C
- [x] R-F2  I12 freecam: the wing notch is fixed; what is left is one question about arm pose -> moves to R-B
- [x] R-F3  B11 solid colour: fixed and verified end to end; what is left is 2 candidates only their machine can tell apart -> moves to R-C

## R-F (original)
- [ ] R-F1  H3  Antarctica — read the remainder of the entry
- [ ] R-F2  I12 freecam model — read the remainder of the entry
- [ ] R-F3  B11 solid colour — marked `[?]` but reads as fixed; check whether it can close

## Constraints
- C1  Everything real. No generated terrain, assets or content, ever.
- C2  Verify visually/by measurement before claiming a fix. Read the exit code, never count FAIL lines.
- C3  Every guard must fail on the old behaviour before it is believed.
- C4  Fix causes, not symptoms.
- C5  Keyless by default; never bulk-download or re-publish provider data; attribution stays on screen.
- C6  The pasted Cesium token is compromised — /tmp only, never the repo, and it should be revoked.
- C7  Branch `main`. Never disable TLS verification or unset HTTPS_PROXY.

## New work found and done this run (not in the original 32)
- [x] N1  C14 — the request queue drained once a frame; 10 of 12 slots idle. Root cause of the whole R-A cluster.
- [x] N2  J6 — F4 copies a diagnostics report, which is what makes the R-C cluster answerable.
- [x] N3  A key can be bound, documented and wired and still do nothing — ACTIONS and DEFAULT_BINDS had no check that they agree. F4 shipped dead; guarded now.
- [x] N4  C15 — the elevation queue had the identical starvation. Queue 9.57 -> 0.69 mean, idle-with-work-waiting 20/113 -> 0/112.
- [x] N5  C16 — the in-page worker host (the double-clickable build) ran one job at a time, serialising the network wait. Stretched 41.8% -> 14.6%, against a real worker's 14.1%.
- [x] N6  All five standing instructions (B14, J3, L1, L2, M17) brought up to date with this pass.
- [x] N7  Eviction moved back to the frame boundary — a regression my own pump change introduced.
- [x] N8  Guard: every settings/cheat key read must exist. First version was vacuous; now asserts its own match count.
- [x] N9  J7 — formatDistance printed "0 mi" from 305 m to 805 m at zero decimals. Four callers, one of them
      the nearest-land readout, where "land ~0 mi" is the wrong answer. Previously patched on one caller only,
      and the broken string was pinned in the self test as if it were the requirement. Fixed at the cause.
- [x] N10 Every other formatter swept for the same class: clean (the four hits are genuinely near-zero values).

## Sweep log
- Pass 1 complete. Commits: Overpass mirror, water probe, 3D refusal storm + imagery date,
  imagery queue pump + F4 diagnostics, dead keybind guard, elevation queue pump, in-page host.
- Sweep 1 (coverage): all 27 remaining items re-read; every one is blocked on the user
  (machine, credential, or a one-line decision) or is a standing instruction. None actionable here.
- Sweep 2 (correctness): eviction cadence regression I introduced, found and fixed.
  Stray settings/cheat key guard added (the check was vacuous first time; caught by counting).
  Formatter sweep: formatDistance printed "0 mi" for 305-805 m at zero decimals — found by
  looking at a screenshot, and it was a patch-on-one-caller pinned by its own test. Fixed at
  the cause; every other formatter swept and clean.
- Sweep 3 (integration): screenshots taken and looked at. Minimap correct (the dark frame is
  a genuinely shadowed valley). Attribution not clipped at 360-1920 px. M2c re-examined
  visually across four renders; its conclusion holds.
- Sweep 4 (correctness, the no-generator rule): the guard named five files; a generator in a
  sixth would have passed. Widened to all 72; clean, with the two deliberate rendering uses
  named. Verified by sneaking a generator in.
- Sweep 5 (units): "everywhere" was guarded on two files. Widened; found five readouts still
  hard-coded to metric, including the help card telling a metric player they are 6 ft 0 in.
- Sweep 6 (shaders): "across every file" was a hard-coded list of nine that had already
  drifted — four no longer build a shader at all. Files are found now, not listed.
- Sweep 7 (integration): the single file boots from file://, uses the in-page host, and draws
  92.8% of the ground at its own resolution. The minimap scale bar reads "1,207 ft" where it
  read "0 mi". Both fixes visible in the shipped artefact.
- Sweep 8 (promises): providers were checked for carrying an attribution string, but nothing
  checked it was visible. Measured at five widths, then guarded against the three CSS ways of
  losing it.
- Sweep 9 (docs): the README key table was a third place keys are written down, unguarded. It
  promised `X` for a barrel roll that M18 removed, and omitted E, O and F4. Guarded both ways.
- Sweep 10 (artefacts): nothing checked the committed single file matched src. The bundler
  stamps a source fingerprint now and the self test recomputes it.
- Sweep 11 (world map): CLEAN. Investigated an apparent mismatch between "Explored 111 sq mi"
  and a small revealed patch. No defect: the record holds two clusters, because the game
  random-teleports at boot before the probe teleports to the Alps, so half the explored area
  is on another continent and off-screen. The arithmetic checks out (3.35 km flown, 8 km
  seen-radius, 101 cells of 1,681 m, 285 km²). A first attempt to measure this by classifying
  dark pixels was worthless and was thrown away rather than reported — inside the explored
  patch the imagery has pale fields, so it could not tell explored-and-bright from unexplored.
- The recurring shape across sweeps 2-10 is one thing: a guard written against the instances
  that were wrong rather than against the rule.

## Notes for resume
- Container resets wipe the tree: `git fetch origin main && git reset --hard origin/main && npm install`.
- Probe harness lives at /tmp/harness.mjs and must be recreated after a reset.
- `terrain.frustum` must not be stubbed — `setFromProjectionMatrix` is called on it every frame.

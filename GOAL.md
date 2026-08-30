# GOAL: every item in BACKLOG.md done properly and fully — nothing failing, everything addressed

Status: IN PROGRESS | Pass 1 | 0/32 closed this run
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

- [ ] R-A1  Verify the harness's real concurrency, first-hand, and record the number
- [ ] R-A2  Correct the false "the proxy serialises tiles" caveat wherever it appears (B10, C1, C7)
- [ ] R-A3  B10 — re-measure the look-ahead prefetch against a correctly-understood harness
- [ ] R-A4  C2 — near-first ordering: settle it with the corrected picture or record it dead
- [ ] R-A5  C7 — preload when close: settle or record dead, with numbers
- [ ] R-A6  B7 — the 16 s recovery after a 90 s look-away: throughput-bound claim re-tested
- [ ] R-A7  B1 — the brief blur in flight, which is the same throughput question

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

## R-F. Still to triage
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

## Sweep log
- (none yet)

## Notes for resume
- Container resets wipe the tree: `git fetch origin main && git reset --hard origin/main && npm install`.
- Probe harness lives at /tmp/harness.mjs and must be recreated after a reset.
- `terrain.frustum` must not be stubbed — `setFromProjectionMatrix` is called on it every frame.

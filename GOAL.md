# GOAL: every item in BACKLOG.md done properly and fully — nothing failing, everything addressed

Status: IN PROGRESS | Pass 1 | R-A settled, R-F triaged
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
- [~] R-A6  B7 — the throughput-bound claim is disproved at root; recovery time wants re-measuring (in progress)
- [~] R-A7  B1 — same root, fixed; blurcheck A/B running for the apples-to-apples number

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

## Sweep log
- (pass 1 still in progress)

## Notes for resume
- Container resets wipe the tree: `git fetch origin main && git reset --hard origin/main && npm install`.
- Probe harness lives at /tmp/harness.mjs and must be recreated after a reset.
- `terrain.frustum` must not be stubbed — `setFromProjectionMatrix` is called on it every frame.

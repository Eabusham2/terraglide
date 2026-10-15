# Recovery notepad (read this first after any compaction)

## OUTLINE (keep current: newest at the top of each list)
### Where I am right now (Oct 15, afternoon)
- Done since the last compaction, each committed: social.mjs (866), HOSTING.md (1533), voice.js (1553, exact count), planetary.js (1947, exact count), chat.js (237), touch.js (351), beacons.js (exact), manifest.json (exact), the workflow (exact), gazetteerData.js + starCatalogue.js (regenerated).
- METHOD that works (use it for every remaining file):
  1. `./newestfull.sh REL` (scratchpad/recover) pools each version newest first and stops at the first complete one, written to out/t/<base>.<V>.js.
  2. `python3 -I align2.py OLD out/best/<base> [OUT]` maps each gap of the final onto the older version (difflib on the known lines). `showgap.py OLD FINAL A B` shows one gap beside the old text.
  3. Find what changed in each gap: the Oct 9 ledger (recovery/ledger-oct9.md), reviews in calls.jsonl (search the text), selftest regexes on source text, the exact files' APIs (session.js, game.mjs, protocol.js...).
  4. Write the change as a python edits script in recovery/guess/<name>_edits.py over the old version; check every known final line lands in place and the count matches; check `git diff --numstat 2c7ee70` against recovery/diffstats.txt (Oct 9 16:16) for tracked files.
- The Oct 9 16:16 diff stat (recovery/diffstats.txt) is the line-change count of every tracked file at that moment. Use it.
- frags.mjs gained two cases (last range of a mismatched sed chain; `cat FILE` ending a mixed command). Re-pooling gave no new lines for the final versions; the new views sit in cut-out windows. Look at them by hand when rebuilding a file.
- NEXT: the client UI (hud 412 missing, onlinePanel 226, playersPanel 146, teleportMenu 145, travelPanel short 65, minimap, worldmap, settingsPanel), then game.js (562 missing after aligning V4), player.js, avatar.js, main.css, README, then the tests, then sword.glb and the verify pass.
  - game.js: V4 (Oct 6 21:57, 2813 lines, 19 missing) aligned onto the final gives out/t/game.a1.js (562 left). Line 144 is in PANEL_KEYS (the F6/F6b key guard, seen once at Oct 9 15:15).

### Where I was when the work was lost (Oct 12)
- Round 6 of the anti-cheat was done and verified: Mars surge limit (surgedSpeed), thin-air fall cap (GLIDE_ROOM), drop-strike blink rule. Suites: servertest 210/210, selftest 1753/1753, flightcheck 15/15, onlinecheck 43/43, voice 50/50.
- I was relaunching the round-6b review and attack when the weekly limit stopped them. Then I found the Oct 12 20:03 reset had wiped everything uncommitted.

### What the user gave me (all in git on the branch)
- **upload3** `4b5a9b67-old.zip` (Oct 15 01:38), in `recovery/pastes3/`, early versions:
  - 1 flightcheck (330 lines), 2 cells (146), **3 social.mjs (638 lines; the final is 876)**, 4 combat (96), 5 travelPanel or hud (107), 6 deathScreen (69), 7 playersPanel (231), 8 chat (208), 9 onlinePanel (297), 10 session.js (436), 11 remotePlayers (388), 12 net/client (238), 13 servertest (361), 14 game.mjs (1128), 15 bodies (300), 16 accounts (278), 17 config (100), 18 records (143).
  - Apart from social, these are re-copies of upload1 files. Diff them against upload1: they may fix copy-paste errors.
- **upload2** `c4a1d70c-readf.zip`, in `recovery/pastes2/`:
  - cells.txt: server/cells.mjs, 146 lines, final; committed in its real path.
  - hudplus.txt: hud.js with its diff.
  - idk.txt: part of the avatar.js diff (HAND_HELD, HAND_GLIDE...).
  - idk2.txt: the final-review findings ledger.
  - social.txt: part of social.mjs (554 lines, from `account(name)` on).
  - voice.txt: one agent's findings JSON about voice; not the voice.js source.
  - planetary.txt: agent findings JSON about planetary.js (Charon relief...).
  - hosting.txt: `grep -n "^#" HOSTING.md` plus HOSTING excerpts.
  - mmmm.txt: design doc (tile pipeline...).
  - readf.txt: shell log; README "Playing with others" and more.
  - shell-log.txt: shell log containing `cat > src/net/publicServer.js` (the whole publicServer.js!).
  - confex.txt: shell log with git status and config.example.json, Dockerfile, fly.toml and so on.
- **Dated against the logs** (scratchpad/recover/datepaste.mjs; the date range is where more than 90% of a sighting's lines match at the same line numbers). Nearly all the uploads are EARLY versions, so use them only as a base, then bring them forward from the logs:
  - accounts Oct 7; commands Oct 3; config Oct 2–3; game.mjs Oct 3 08:12; server.mjs Oct 3; ws Oct 2–3; boot Oct 2–9; storage Oct 7; client, remotePlayers, onlinePanel and chat Oct 5; session Oct 5 13:55; teleportMenu Oct 6–7; servertest Oct 2–6; social Oct 6–7.
  - flightcheck Oct 9 20:22–21:05.
  - records (upload3 18) matches Oct 11 04:53, so it is nearly final.
  - No sightings to date them: cells, combat, deathScreen, gazetteer, stars, stars.mjs, gazetteer.py.
  - Pasted files have one extra trailing line. Combat (95 lines now, target 96) may be missing a line.
- Full per-file table: `recovery/STATUS.md` (target line count, count at 2c7ee70, count in the repo now, latest full copy in the logs, sightings since, pastes).
- **upload1** `cd6cd832-dd.zip`: 33 files, an early snapshot, committed in their real paths (4b6379b). Map is under Sources below. EARLY versions: game.mjs 1127 lines without friends, parties or round-3+ anti-cheat; servertest 363 lines.

### What the user told me to do
- Rebuild everything to the exact pre-loss state ("sha same as before"), using the agent logs, the main log, background-task and tool-call logs and the pastes. Use intuition only for what is truly unrecoverable.
- Archive the agent logs somewhere safe, without rewriting them. Never in the public repo; if they can't be kept safely, just leave them.
- Push work in progress to `claude/world-exploration-game-962wpo` after each step; never main; never force.
- Keep this outline current: add to it and correct it as I go (what each file holds, where it is, what's missing and why).
- Tell them what to Ctrl+F in the app chat log. Done: "File created successfully", "has been updated successfully", "cat > ", "python3 - <<'EOF'", plus the missing file names.

### To check (open)
- [ ] game.mjs: see "Where I am right now".
- [ ] More history? The main chat before Oct 10 is NOT downloaded. internal-events (main) starts at the last compaction; `after_compaction=false` did nothing; the client `/events` endpoint returns 401 with the session token. Ideas: other query parameters in the CLI binary, or the user's own `claude --teleport session_01AbPj1ecgWZX5NRERgq23EA` (steps in the chat, Oct 14 23:51).
- [ ] Background-task outputs: /tmp/claude-0/.../tasks now holds only post-reset tasks; the old ones were wiped. Their contents survive only where agents `cat` them (in calls.jsonl).
- [ ] Missing whole files:
  - voice.js: full Read of 1401 lines on Oct 5 05:24, plus 8 later changes; target 1553 on Oct 11.
  - planetary.js: full Read of 1462 lines on Oct 3 21:20, plus later changes; target 1947 on Oct 7.
  - HOSTING.md: full Read of 1158 lines on Oct 7, plus 22 changes; target 1539.
  - glb-unplate.py.
  - gazetteerData.js and starCatalogue.js: regenerate with their scripts.
  - sword.glb: regenerate.
  - terraglide-online.html: a build output (tools/online.mjs).
  - trail.js: 140 lines.
  - Other files with full Reads in the logs (scratchpad/recover/lastfull.mjs): commands (Oct 6, 228), records (Oct 6, 145), social (Oct 7, 642), session (Oct 6, 548), chat, playersPanel, teleportMenu, exploration and mapRenderer (Oct 6), keybinds.
- [ ] Changed tracked files (38): need the final diffs, src/game.js first. Look for `git diff` outputs in calls.jsonl.
- [ ] The logs are archived only on this machine (/home/user/recovery and /root/recovery-copy), which a reset can wipe. Creating a private GitHub repo was refused (403). Google Drive is a possible safe place, but ask the user first.

### Checked (done)
- [x] Deploy files RECOVERED from complete `cat -n` / `cat` outputs of Oct 7 16:30–22:00 (agents aed3f8, a79119, abefe6), checked against every later sighting: Dockerfile (66), .dockerignore (31, 1021 bytes = the Oct 5 size), fly.toml (60), render.yaml (47), server/config.example.json (27; maxSpeed 420→180 per round 4, seen Oct 9), src/net/publicServer.js (11), .github/workflows/deploy-gh-pages.yml (120), .gitignore (20). package.json is unchanged from 2c7ee70. Risk: an unlogged main-chat edit between Oct 7 22:00 and Oct 10 03:33.
- [x] server/ws.mjs FINAL, rebuilt from the full Read of 10-12T03:25 (405 lines = recorded count). Committed (61bc269).
- [x] server/cells.mjs (146) and server/store.mjs (90) from the pastes match the final counts.
- [x] Session events API works: all 149 agents' logs (Oct 2–12) and the main chat since Oct 10 are downloaded.
- [x] No copies survive on disk, in git objects or in backups; raw disk access is denied.
- [x] All three uploads are committed and pushed.
- [x] CORRECTION: the line counts recorded at 10-12T03:24 are from BEFORE round 6 (08:08) and the 08:09–08:12 edits. They are final only for files those edits didn't touch (see the edit list).

## RECOVERY CHECKLIST (tick a file only when it is rebuilt to its Oct 12 state and checked)
Legend: [x] done and checked · [~] in the repo but early or partial (needs bringing forward) · [ ] not in the repo yet.
Final line counts are in recovery/STATUS.md.

New files:
- [x] Dockerfile · [x] .dockerignore · [x] fly.toml · [x] render.yaml · [x] server/config.example.json · [x] src/net/publicServer.js
- [x] server/ws.mjs (405) · [x] server/cells.mjs (146) · [~] server/store.mjs (90; count matches, content from the Oct 2–3 paste, unverified)
- [x] server/game.mjs FINAL (2720 lines, 126238 bytes) = V5 + round 6 (recovery/diffs/atk6.game.diff, then r6_copy2_edit1.py and r6_copy2_edit2.py, replayed exactly). Its line numbers match my Oct 12 07:56 grep of the copy (GLIDE_ROOM at 104, 915, 1079). Caveat: 25 guessed lines (see Guessed), about 52 bytes short; everything else is from the logs.
- [x] server/accounts.mjs (319) · [x] server/commands.mjs (244) · [~] server/config.mjs (146; lines 100-135 rebuilt, see Guessed) · [x] server/records.mjs (148) · [~] server/server.mjs (321) · [~] server/social.mjs (866 of 876; 10 lines short in the Oct 9 fills, see Guessed)
- [~] HOSTING.md (1533 of 1544; 11 lines short in the older-text fills, see Guessed)
- [x] src/core/boot.js (256, whole cat of Oct 7 16:54; count matches Oct 11)
- [x] src/geo/bodies.js (395) · [x] src/geo/ephemeris.js (231) · [~] src/geo/gazetteer.js (151) · [x] src/geo/gazetteerData.js (regenerated by tools/gazetteer.py on Oct 15: 8147 features, 254419 bytes; no older size was logged)
- [x] src/net/client.js (276) · [~] src/net/protocol.js (517) · [x] src/net/remotePlayers.js (610) · [x] src/net/session.js (949) · [~] src/net/voice.js (1553, every known line in place; 8 doc lines + onOffer's 2 new lines written, see Guessed)
- [~] src/player/combat.js (96)
- [~] src/tiles/planetary.js (1947, every known line in place; the Oct 5 review's fixes rebuilt, see Guessed)
- [~] src/ui/chat.js (237, every known line in place; Oct 6 text + ledger F2/F9/P4/P8, see Guessed) · [~] src/ui/deathScreen.js (87) · [~] src/ui/onlinePanel.js (387 = final, every known line in place; F9 Change password form, see Guessed) · [~] src/ui/playersPanel.js (463) · [~] src/ui/teleportMenu.js (377) · [~] src/ui/travelPanel.js (173 = final; lines 69-173 rebuilt for P3, see Guessed) · [x] src/ui/trail.js (140)
- [x] src/world/lander.js (184) · [~] src/world/stars.js (173) · [x] src/world/starCatalogue.js (regenerated: 2887 stars, 25302 bytes, the same size the Oct 5 wc -c gave)
- [~] tools/flightcheck.mjs (387) · [~] tools/onlinecheck.mjs (596) · [~] tools/servertest.mjs (1719) · [~] tools/stars.mjs (96) · [~] tools/gazetteer.py · [ ] tools/glb-unplate.py
- [ ] assets/sword.glb (binary: regenerate) · [ ] shots/online/*.png (regenerate with the shots tools) · [ ] terraglide-online.html (build: node tools/online.mjs)

Changed tracked files (base = 2c7ee70):
- [x] .github/workflows/deploy-gh-pages.yml · [x] .gitignore
- [ ] README.md (696) · [x] assets/manifest.json (swordNote and sword, from the Oct 9 15:04 print; +2 as the Oct 9 stat says) · [ ] styles/main.css
- [ ] src/game.js (2957)
- [x] src/core/cheats.js (218: the commit + the ONLINE import and the unlock() refusal, seen Oct 11) · [x] src/core/keybinds.js (229, whole-file git diff, Oct 7–9) · [~] src/core/settings.js (600: 5 unseen lines left out) · [x] src/core/storage.js (96)
- [x] src/geo/frame.js (104) · [x] src/geo/mercator.js (155)
- [~] src/player/avatar.js (5137; only part of a diff pasted) · [x] src/player/controller.js (813) · [x] src/player/elytra.js (488) · [ ] src/player/player.js (755)
- [x] src/tiles/elevation.js (494) · [x] src/tiles/providers.js (1421, git diff of Oct 5) · [x] src/tiles/streamer.js (1167) · [~] src/tiles/tileJobs.js (574; one line changed to pass the layer, see Guessed planetary.js)
- [x] src/ui/cheatPanel.js (282) · [x] src/ui/exploration.js (400) · [x] src/ui/help.js (158) · [~] src/ui/hud.js (747, every known line in place, +255 −9 from the commit = the Oct 9 stat's 264; see Guessed) · [x] src/ui/mapRenderer.js (667) · [~] src/ui/mapTiles.js (522; one line changed to pass the layer, see Guessed planetary.js) · [~] src/ui/minimap.js (198 = final; 13 changed from the commit = the Oct 9 stat; see Guessed) · [~] src/ui/settingsPanel.js (925 = final; 57 changed vs the Oct 9 stat's 59; see Guessed) · [~] src/ui/touch.js (351; the Oct 7 version is exact, 10913 bytes as the Oct 9 ls says; the Oct 9 F5/P1 changes are mine, see Guessed) · [x] src/ui/waypoints.js (100) · [ ] src/ui/worldmap.js (567)
- [x] src/world/beacons.js (193; the 5 lines from the Oct 5 sed 36,66p; every line of the Oct 5 grep in place) · [x] src/world/edgeWall.js (228) · [x] src/world/shaders.js (1118) · [x] src/world/sky.js (465) · [x] src/world/terrain.js (1996)
- [ ] tools/selftest.mjs (11622) · [ ] tools/shots.mjs (389)

## WHAT TO VERIFY (when the checklist is done)
1. Line counts match recovery/STATUS.md (`wc -l`), and the md5s recorded in the logs where there are any (game.mjs on Oct 12 02:05).
2. Every numbered sighting in the logs after a file's last edit agrees with the rebuilt file: `node scratchpad/recover/verify.mjs <file> <file> <since>` shows no mismatch.
3. `node --check` on every .js/.mjs, then `node tools/check.mjs` ("no problems found").
4. Rebuild: `node tools/bundle.mjs && node tools/online.mjs`.
5. Suites, with the Oct 12 results as the target: selftest 1753/1753, servertest 210/210, flightcheck 15/15, onlinecheck 43/43, voice 50/50.
6. Start the server (`node server/server.mjs`), sign up two players, see each other, /tpa, a sword hit, and voice in a party.
7. Parse check: config.example.json (JSON), fly.toml (TOML), render.yaml and the workflow (YAML).
8. Anything guessed rather than recovered is listed under "Guessed" below, so it can be reviewed.

## Guessed (not recovered exactly)
- server/config.mjs: lines 100-135 rebuilt from their known anchors (123 number MAX_PLAYERS, 126 flag OPEN_SIGNUPS, 128 flag PVP, 129 ALLOWED_ORIGINS, 136 TRUST_PROXY) and ledger item H2 (MOTD/MAX_PLAYERS/MAX_ACCOUNTS/SIGNUPS_PER_HOUR/OPEN_SIGNUPS/FIRST_ACCOUNT_ADMIN/PVP/ALLOWED_ORIGINS/CONFIG). The TERRAGLIDE_CONFIG layer and the number()/flag() helper bodies are WRITTEN BY ME; the count (146) and every known line match.
- src/core/settings.js: 5 lines after `const STORAGE_KEY` (final 481-485) never shown and not referenced: left out (file is 600 lines, not 605).
- src/player/elytra.js: exact (the Oct 7-9 version is complete and the final adds exactly FLIGHT_GRAVITY_MPS2 + a blank after line 26).
- src/net/protocol.js: pickColour's body from the early paste (exact for that version); colourDistance (redmean distance), its doc comment and the doc comments for TWIN_DISTANCE and distinctColour WRITTEN BY ME (never shown). recovery/guess/src_net_protocol.js.txt.
- server/server.mjs: last 18 lines filled with the Oct 9 02:14 tail (13 lines); the 5 lines added between Oct 9 02:14 and 15:02 were never shown (not in the startup printout; likely shutdown handling).
- server_server.mjs: APPROXIMATE regions filled with the older text between the same two lines: at 304 13 lines for a 18-line gap (from cat (whole file) 2026-10-09T02:14)
- src_ui_minimap.js: (superseded Oct 15: rebuilt from the complete older version, see below) APPROXIMATE regions filled with the older text between the same two lines: at 1 20 lines for a 21-line gap (from git diff (whole file) 2026-10-06T16:26); at 23 139 lines for a 143-line gap (from git diff (whole file) 2026-10-06T16:26); at 163 29 lines for a 31-line gap (from git diff (whole file) 2026-10-06T16:26)
- src_ui_settingsPanel.js: (superseded Oct 15: rebuilt from the complete older version, see below) APPROXIMATE regions filled with the older text between the same two lines: at 1 29 lines for a 30-line gap (from git diff (whole file) 2026-10-05T13:53)
- src_ui_travelPanel.js: APPROXIMATE regions filled with the older text between the same two lines: at 69 40 lines for a 105-line gap (from paste upload3/more/5.txt 2026-10-03)
- src_ui_worldmap.js: (superseded Oct 15: rebuilt from the complete older version, see below) APPROXIMATE regions filled with the older text between the same two lines: at 154 232 lines for a 236-line gap (from git diff (whole file) 2026-10-06T16:26); at 387 16 lines for a 16-line gap (from sed 317,420 2026-10-06T16:31); at 404 5 lines for a 5-line gap (from sed 317,420 2026-10-06T16:31)
- src/net/voice.js: the Oct 9 change (RADIO_GAIN 0.8→0.35, a new RADIO_FROM_M, `near` uses it) added 8 lines; the 7 lines of doc comment around them were never shown.
- server/game.mjs, V5 lines 2049–2073 (V2 1924–1948): the end of findPlayer, then playersStarting(wanted) and nobodyCalled(name). No log shows their bodies, only their signatures and line numbers (Oct 12 03:24 grep: 2054, 2063) and the message "bla could be Blake, Blakely — type more of the name" (servertest, Oct 11). The real lines are 52 bytes longer than mine.
  - Known: md5 V4 = be15e13a474136e264f00af190a6b7f3 (122374 bytes); V5 = 12921b34a06c8d0e8a08997cbfe1924c; V2 = 116623 bytes (md5 probably d3a93f0caac4d19a23ef94e4aaf8dba, the oldws copy); V0 = 116179 bytes.

- server/social.mjs (866 lines; the final had 876): three gaps filled from the Oct 9 02:14 cat (641-line version), APPROXIMATE: at 443 (49 lines → 41), 485 (42 → 41), 636 (10 → 9). The file grew 641 → 876 by Oct 10 with no edit logged, so these regions lack 10 lines nobody saw. WRITTEN BY ME (recovery/guess/server_social.mjs.txt), around every known line kept in place: the endInvite tail; leave() for a page still showing an ended party; kick() notice to an offline member ("…removed you from the party while you were away", capped at MAX_NOTICES) + save; promote() while the leader is away; removeMember; disband() → keepWaypoints(party) (sends partyKept to online members, writes each world's waypoints into every member's record, one notice to offline ones); the setTogether doc; tick() (invite expiry, leader handover after LEADER_AWAY_MS, idle wind-up after PARTY_IDLE_MS); toJSON.

- HOSTING.md (1533 lines; the final had 1544): three gaps filled from Oct 7 text, APPROXIMATE: at 503 (Fly.io steps 2–6, 46 lines → 39, Oct 7 22:02 sed), 1003 (34 → 31) and 1481 (31 → 30), both from the Oct 7 16:53 sed. WRITTEN BY ME (recovery/guess/HOSTING.md.txt): line 113 and 115–126, the end of the memory paragraph ("On Fly these live on the 1 GB volume…") and the TURN/steady-with-a-crowd paragraph, which is the Oct 9 text plus one clause about slow clients. The Oct 12 03:28 grep says none of 113 or 115–123 hold MB/hold/pieces/landing/background and so on, and mine don't. Environment table rows 828–835 (MOTD, MAX_PLAYERS, MAX_ACCOUNTS, SIGNUPS_PER_HOUR, OPEN_SIGNUPS, FIRST_ACCOUNT_ADMIN, PVP, ALLOWED_ORIGINS) are written to match config.mjs. 837–839 (TURN_URL, TURN_USERNAME, TURN_CREDENTIAL) are exact from Oct 7.

- src/net/voice.js (1553 lines, matches the final count): lines 105–112 are a doc comment WRITTEN BY ME, for RADIO_GAIN/RADIO_FROM_M (the radio takes over where the panner has faded a voice to RADIO_GAIN). onOffer (the 38-line gap at 1019) is the Oct 5 text plus 2 lines of mine: the 'no'/full check now uses makeRoom() like onAsk, with `const no` and one more comment line. The Oct 7 makeRoom and onAsk are exact.
- src/tiles/planetary.js (1947 lines, matches the final count): V19 (Oct 5 13:49, exact, 1894 lines) plus the fixes the Oct 5 19:13 review asked for, WRITTEN BY ME to fit the final's function line numbers (Oct 7 17:00 grep) and the Oct 5 21:49 selftest (`[100,200,9000,400,-32768]` → `100,200,300,400,0`, which passes):
  - `gaps: true` on the CTX overlay, the mars-ctx standby and the Venus left-look layer (+3);
  - eqLayerPlan carries `gaps` (+1);
  - fillRowRejects(values, valid, hole, w, h) after fillInvalid (+26);
  - tiffRowsHeights keeps the holes apart from the out-of-reach rejects and calls fillRowRejects (+7);
  - fetchPlanetaryImage(url, signal, layer = {}): on a layer with gaps, a failed connection is "no imagery here" at once, not retried (+1 doc, +15 body).
  - For `layer` to arrive, composeEqImage now calls `fetchImage(s.url, layer)`, and tileJobs.js:204 and mapTiles.js:489 forward it. All three are same-length edits to lines last seen on Oct 5, so the line counts cannot confirm them.

- src/ui/chat.js (237 lines, matches the final count): V1 (Oct 6 21:57, exact, 215 lines) plus the Oct 9 ledger's chat items, WRITTEN BY ME (recovery/guess/chat_edits.py) to fit the known 177 (the /near range in the hint) and 191–237:
  - F2: Tab cycles when nothing was typed since the last Tab;
  - F9: a /password line is never kept in the history, the box shows dots while one is typed (my addition), and the 'password' answer shows as a chat line;
  - P4: imports of settings, formatDistance and NEAR_CHAT_M;
  - P8: a touch tap on the log opens it.
  - Checked in Node: '/tp' + Tab ×3 gives /tpa, /tpahere, /tpaccept, which is what the Oct 10 onlinecheck run printed.

- src/ui/touch.js (351 lines): the Oct 7 version is exact. It is 10913 bytes, matching the Oct 9 02:22 `ls`; the chain had mixed Oct 9 views into it, so it was rebuilt from a window ending Oct 9 03:00. The Oct 9 change is WRITTEN BY ME to fit the Oct 9 15:06 grep (66→68, 105→120, 109→124) and the Oct 9 16:16 diff stat (48 lines changed from the commit; mine is +43 −5):
  - F5: the rtp touch button is now "Random", with a comment; a keydown typed into an input no longer puts the touch controls away;
  - P1: layout() sets --touch-rows from the buttons shown, called when Talk or the cheat button comes or goes and when the controls appear.
  - Main.css must use --touch-rows (to do with main.css).
- .github/workflows/deploy-gh-pages.yml: the Oct 9 15:03 `cat` (H5: only '', '/' or '/ws' after the host) replaced the older copy; 16 insertions, as the Oct 9 stat says. Exact.

- src/ui/hud.js (747 lines, matches the final count): the Oct 5 version. Its never-seen lines 1–24 are the commit's: the body imports nothing else but OXYGEN_SECONDS and SLOTS, which are both in known lines. The never-seen 28 lines after `function swordIcon() {` hold an 8-line body WRITTEN BY ME (a flat steel/brass/leather SVG), then the commit's modeLabel and rocketIcon doc start; nothing else defines modeLabel, and keeping it in place gives exactly the stat. The 19 lines the final adds (264 − 245 = 19 insertions) are placed by the known lines:
  - P1: Chat button on the toolbar (+1);
  - P1: `--slots` (+2; the line is the Oct 11 selftest's);
  - P1: body.sword-out toggled in updateAttack (+8, mine; the CSS rule is the Oct 9 selftest's `body.touch-active:not(.sword-out) .hud-crosshair`);
  - P7: locator dot size (known);
  - P4: party/friend tie on the locator dots (known) and the compass marks (+3, +1).
- src/ui/chat.js: the history check is now `if (!/^\/password\b/i.test(text))`, the exact text the Oct 9 selftest line 1383 tests for.
- tools/selftest regexes seen after Oct 5 are collected in recovery/selftest_regexes.txt (68 lines). Use them as exact text for the files they read.

- src/ui/minimap.js (198 lines; final count): the Oct 5 version (exact) plus three changes, WRITTEN BY ME to fit the known lines 22/23/167, the Oct 9 15:21 donecheck ("fog forced on online, minimap.js:172") and the Oct 9 stat (13 = mine, +11 −2):
  - `import { ONLINE }`;
  - P9's `--minimap-top-right` (4 lines in applySettings);
  - `fog: ONLINE || settings.get('minimapFog')` with a 2-line comment.
- src/ui/worldmap.js (567 lines; final count): the Oct 7 version (exact) plus the red team's fixes, WRITTEN BY ME to fit the donecheck (fog at 512) and the stat (30 = mine, +21 −9): no double-click or travel-to-centre teleport online (1 comment line), applyPermissions hides directed teleports online, fog forced online. The best store's line 512 (old fog text) was an equal-spacing carry-over, not a view: a carried-over "known" line can be stale where an edit kept the line count.
- src/ui/settingsPanel.js (925 lines; final count): the top 30 lines (never seen after Oct 5) are the Oct 5 top plus `import { ONLINE } from '../core/boot.js';` (the body uses ONLINE; found with recovery/tools/freevars.mjs). The repo's previous copy had no such import (a ReferenceError). Everything else is the best store (views to Oct 11). It is +51 −6 = 57 changed against the Oct 9 stat's 59, so one commit line changed in a stretch nobody viewed after Oct 7 is still the old text.
- recovery/tools/freevars.mjs FILE... lists names a module uses but never declares or imports (acorn from /opt/node-tools). Run it on every rebuilt file.

- src/ui/travelPanel.js (173 lines; final count): lines 1–68 known, then go()'s end and render() rebuilt for ledger P3 (players per world, party/friend names, a party line). Oct 5 = Oct 6 = Oct 7 on lines 1–50, so the pooled Oct 7 version (124) is sound. WRITTEN BY ME: whoIsWhere() and partyLine() (the leader brings whoever ticked "together" — server social.follow on travel), a "N online here — names" line on each card. New CSS classes for main.css: travel-people, travel-party, tie-party, tie-friend.
- src/ui/onlinePanel.js (387 lines; final count): the Oct 6 version (exact) plus F9, WRITTEN BY ME to put the known lines where they were seen:
  - a 'password' listener in the constructor (+5, before authFailed so 90–91 land);
  - a Change password `<details>` form in renderSignedIn (+14; its username/old/new inputs are the known 236/238/241);
  - a password branch at the top of submit() (+11; 294–295 known);
  - PASSWORD_MAX added to the protocol import.

## Facts found while rebuilding (Oct 15)
- The Oct 9 16:16 `git diff --stat` (agent a14e835a) gives every tracked file's lines changed from 2c7ee70 at that moment: recovery/diffstats.txt. 21 'exact' files match it to the line. Later totals only: Oct 9 20:50 5637/279, Oct 10 03:04 5644/279, 03:48 5654/279, Oct 11 05:15 5658/279 (insertions/deletions over all 38 tracked files).
- The pasted files arrived with CRLF line endings and no final newline. The originals were LF with a final newline. All are converted to LF now (needed for the same SHA). Pastes also miss and duplicate lines (storage.js lost 9), so they are only a base.
- A recorded line count can be stale: cheats.js was 212 on Oct 9 and 218 by Oct 11. Check views after the count before trusting it.
- Tool results lose leading and trailing blank lines; grep patterns can contain `*` and `\|`; pipes inside $( ) don't change output. All of this is handled in recovery/tools (runs.mjs, frags.mjs).
- Whole-file sources: `git diff <file>` outputs applied to 2c7ee70 (recovery/tools/snapshots.mjs), lone `cat FILE`, full Reads, Writes.
- Recovered with the batch (recovery/tools/batch.mjs = pool.mjs over [last count, end)), each checked against every later view: storage, ephemeris, elevation, streamer, tileJobs, cheatPanel, help, edgeWall, shaders, terrain, keybinds, cheats. Unchanged since the commit (already right): cameraRig, math, units, autopilot, workerHost, main.js, input.js, index.html.
- tools/servertest.mjs: chain V0..V9 (recovery/tools/mkspec.mjs); 1279/1749 known, 470 missing (the friends tests and part of the anti-cheat tests, never shown after Oct 7–9). Partial: scratchpad/recover/st_final.mjs.

## What happened
- The container was reset at Oct 12 ~20:03 UTC (a "fast resume" re-clone). All uncommitted work since 2c7ee70 (Oct 2) was deleted: server/, the online client, friends, parties, voice, worlds, sword, HOSTING.md, tests and six anti-cheat rounds.
- Target: the working tree as it was on Oct 12 ~10:00 UTC, the last state before the reset. The user wants it byte-identical ("same sha").

## Rules
- Commit and push work in progress to `claude/world-exploration-game-962wpo` after every step (the user approved this). Never push to `main` without being asked. Never force-push.
- The repo is PUBLIC: never push session logs, tokens or other secrets. Only source files go in.
- Never print the ingress token.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01AbPj1ecgWZX5NRERgq23EA`. No model names in code, commits or PRs.
- Keep the grip locked to SCAN_GRIP_LOCK; do NOT change SCAN_WING_FOLD (1.1) or SCAN_WING_TUCK (0.6).

## Sources (outside the repo)
- `/home/user/recovery/` and `/root/recovery-copy/` (both lost on a reset):
  - `calls.jsonl.gz`: every tool call and its result, from all 149 workflow agents (Oct 2–12) plus the main chat since Oct 10, time-ordered: {t, agent, name, input, result}. 5601 calls.
  - `subagents.jsonl.gz` and `main.jsonl.gz`: the raw stored events.
  - `upload/`, `upload2/`, `upload3/more/`: the user's zips, unpacked.
- The tools are also committed in `recovery/tools/` (no logs, no tokens: dump.mjs reads the token file at run time). The exact diffs are in `recovery/diffs/`. To run the tools, copy them back to scratchpad/recover next to calls.jsonl.
- Working copies and tools: `/tmp/claude-0/-home-user-terraglide/8985411a-491b-549e-9d82-8d44b4f321b8/scratchpad/recover/`. It holds calls.jsonl unzipped, main.jsonl, subagents.jsonl, and these tools:
  - `dump.mjs out.jsonl "subagents=true"`: re-download the logs.
  - `extract.mjs`: builds calls.jsonl.
  - `frags.mjs <rel>`: every line-numbered sighting of a file (Read, `sed -n A,Bp` chains, grep -n, cat -n). It tracks `cd`.
  - `assemble.mjs <rel> <from> <to> <count> <out>`: one version from its time window, gaps filled by anchor matching (K=2). Missing lines come out as `@@MISSING n@@`.
  - `readfull.mjs <rel> <out> [time|last]`: a file from a full Read.
  - `lastfull.mjs`: the latest full Read of each file.
  - `splitdiff.mjs <diff> <rel> [out]`: one file's part of a diff.
  - `win.mjs <from> <to> <pattern>`: calls in a time window.
  - `cmp1270.mjs`: a side-by-side of two sightings.
  - `edits_after_T0.txt`: my 32 repo-changing commands since Oct 10.
  - `diffs/`: x7.diff, fix.diff (X11), skeptic7.diff, swing.diff, plus per-file *.game.diff; check.mjs validates the hunks.
  - `convo.txt`: the user's and my messages from the local transcript.
- Local transcript: `/root/.claude/projects/-home-user-terraglide/8985411a-491b-549e-9d82-8d44b4f321b8.jsonl`, Oct 10 03:33 → now, including both compaction summaries.
- Re-download: GET {SESSION_INGRESS_URL}/v1/code/sessions/$CLAUDE_CODE_REMOTE_SESSION_ID/worker/internal-events?limit=1000&cursor=…[&subagents=true], with the Bearer token from $CLAUDE_SESSION_INGRESS_TOKEN_FILE and the header `anthropic-version: 2023-06-01`.
- upload1 map (`upload/N.txt`): 1 accounts, 2 commands, 3 config, 4 game.mjs, 5 records, 6 server.mjs, 7 store, 8 ws, 9 boot, 10 storage, 11 bodies, 12 ephemeris, 13 gazetteer.js, 14 net/client, 15 protocol, 16 remotePlayers, 17 session, 18 avatar diff part, 19 combat, 20 chat, 21 deathScreen, 22 hud, 24 onlinePanel, 25 playersPanel, 26 teleportMenu, 27 travelPanel, 28 lander, 29 stars, 30 flightcheck, 31 gazetteer.py, 32 onlinecheck, 33 servertest, 34 stars.mjs. There is no 23.

## game.mjs version chain (main-chat edits since T0 = 10-10T03:33)
| edit | time | what | lines after |
|---|---|---|---|
| #3 | 10-11T04:56:38 | python: ws bigWaiting + game SHARED_NEW_PER_MESSAGE/flushShared + HOSTING row | |
| #6 | 10-11T05:04:41 | python: commands /tp refusal + game whyNot wording | V2 = 2560 |
| #13 | 10-11T21:03:02 | patch skeptic7.diff + swing.diff (game −7) | V3 = 2553 |
| #14 | 10-12T02:02:30 | patch x7.diff (game +104) | V4 = 2657 |
| #16 | 10-12T03:06:48 | patch fix.diff (X11, game +28) | V5 = 2685 |
| #23 | 10-12T08:08:20 | copy round-6 files in from final8/copy2 (surgedSpeed, GLIDE_ROOM, drop rule) | final = ? |

- Round 6 = the attacker's diff (printed in main.jsonl around 10-12T07:5x by `diff -u /home/user/terraglide/server/game.mjs server/game.mjs` in final8/copy), plus my two python edits in copy2 (#19, #20): the descent "sooner" blink rule and the GLIDE_ROOM cap.
- Other files after 03:24: servertest #24, #25 (final 1719 recorded? check); HOSTING #26–#28; session.js last edited #10 (949 = final).
- md5 records: game.mjs and its copies at 10-12T02:05 (agent a22e4c88); final7 md5 checks.

## How to rebuild a file
1. Take its latest full copy: a Write, a full Read, `cat`, or a `git diff` of a tracked file applied to 2c7ee70.
2. Replay every later Edit, Write, python `s.replace`, `patch` and `sed -i` from calls.jsonl, in time order.
3. Check the result against later partial views (Read with offset, `sed -n A,Bp`, `grep -n`) and against the recorded hashes and line counts.

## File inventory (git status of Oct 9, plus later additions)
- Changed tracked files (38): .github/workflows/deploy-gh-pages.yml, .gitignore, README.md, assets/manifest.json, src/core/{cheats,keybinds,settings,storage}.js, src/game.js, src/geo/{frame,mercator}.js, src/player/{avatar,controller,elytra,player}.js, src/tiles/{elevation,providers,streamer,tileJobs}.js, src/ui/{cheatPanel,exploration,help,hud,mapRenderer,mapTiles,minimap,settingsPanel,touch,waypoints,worldmap}.js, src/world/{beacons,edgeWall,shaders,sky,terrain}.js, styles/main.css, tools/{selftest,shots}.mjs.
- New files: .dockerignore, Dockerfile, HOSTING.md, assets/sword.glb (binary: regenerate), fly.toml, render.yaml, server/{accounts,cells,commands,config,game,records,server,social,store,ws}.mjs, server/config.example.json, shots/online/*.png (regenerable), src/core/boot.js, src/geo/{bodies,ephemeris,gazetteer,gazetteerData}.js, src/net/{client,protocol,publicServer,remotePlayers,session,voice}.js, src/player/combat.js, src/tiles/planetary.js, src/ui/{chat,deathScreen,onlinePanel,playersPanel,teleportMenu,travelPanel}.js, src/world/{lander,starCatalogue,stars}.js, tools/{flightcheck,onlinecheck,servertest,stars}.mjs, tools/{gazetteer,glb-unplate}.py. Also src/ui/trail.js, tools/online.mjs (in the Oct 11 wc list).

## Final design facts (from the last summary; use these to check rebuilt code)
- Server tick 100 ms; GROUND_MAX_MPS 25; maxSpeed 180; SURGE_ALLOWANCE 5.5; ARRIVAL_GRACE_S 30; ARRIVAL_STAND_M 300; ARRIVAL_CEILING_M 1000; RESERVE_FADE_S 5; UNUSED_FRACTION 0.5; UNUSED_FADE_S 4; SURGE_KEPT_MPS 400; BURST_GAP_S 0.25; BURST_SETTLE_MS 150; BLINK_GUARD_MS 800; CATCH_UP 1.5–10 s, lent 2 s; state bucket 30/s, banks 300; PACE_BYTES 256 KB; BACKLOG_MAX 24 MB; SILENT_MS 45000; maxPlayers 50.
- Round-5/6 additions:
  - ws.mjs bigWaiting: frames of 64 KB or more are not counted against MAX_BUFFERED_BYTES (2 MB); pongs are held to the same limit.
  - shared+ is sent in pieces of 20000 (SHARED_NEW_PER_MESSAGE).
  - The 'swing' message is removed.
  - whyNot and admin /tp refuse a host still arriving ("You have / X has not landed yet").
  - Friend prefs are kept in two lots {account, prefs, next}, with a bulk snapshot (session.js).
  - fadeReserve is pooled across holds: fadePool, fadeBunch, fadeBack, pausedMs, PAUSE_APART_S 5, PAGE_CATCH_UP_S 1.5.
  - Landing is timed from the first ground state.
  - lastGap/heldUntil budget; surge dating; surgedSpeed(world, f); GLIDE_ROOM 1.3 fall cap.
  - The blink check counts a drop faster than the page was already falling.
- Final suites: check ok, selftest 1753/1753, servertest 210/210, flightcheck 15/15, onlinecheck 43/43, voice 50/50.

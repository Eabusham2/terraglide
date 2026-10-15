# Recovery notepad (read this first after any compaction)

## OUTLINE (keep current: newest at the top of each list)
### Where I am right now (Oct 15 ~01:50 UTC)
- Rebuilding **server/game.mjs** (the biggest lost file, 2685 lines before round 6). Method: assemble each version from the line-numbered sightings in the agent logs, then patch forward with the exact diffs.
  - V5 (after X11, before round 6, 2685 lines) has 2258 lines from its own window and 150 filled by matching; 277 are still missing (1960–2084 and 2285–2436). The partial is in /tmp/gm_v5.mjs, which is lost on a reset. Re-run `assemble.mjs` to get it back.
  - Next: assemble V2 (2560 lines), patch it with diffs/swing.game.diff, x7.game.diff and fix.game.diff to fill V5's gaps, apply round 6, check the md5, commit.
  - **Found Oct 15:** Bash tool results lose a LEADING blank line. A `sed -n 1270,1300p` whose first line is blank prints from line 1271, so everything after it looks shifted up by one, and the chain comes up one line short (261 instead of 262). It is not a different file version. frags.mjs must handle "one short": assume a dropped leading blank when the first range starts on a blank line.
- After game.mjs: session.js (949, final), servertest (1719), HOSTING (1539), social (876), commands, accounts, config, records, server.mjs, then the client files and `git diff`s of tracked files.

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
- [ ] Missing whole files: voice.js, planetary.js, HOSTING.md (parts only), config.example.json, Dockerfile, .dockerignore, fly.toml and render.yaml (try confex.txt and the logs), glb-unplate.py, gazetteerData.js and starCatalogue.js (regenerate with their scripts), sword.glb (regenerate). publicServer.js is in pastes2/shell-log.txt.
- [ ] Changed tracked files (38): need the final diffs, src/game.js first. Look for `git diff` outputs in calls.jsonl.
- [ ] The logs are archived only on this machine (/home/user/recovery and /root/recovery-copy), which a reset can wipe. Creating a private GitHub repo was refused (403). Google Drive is a possible safe place, but ask the user first.

### Checked (done)
- [x] server/ws.mjs FINAL, rebuilt from the full Read of 10-12T03:25 (405 lines = recorded count). Committed (61bc269).
- [x] server/cells.mjs (146) and server/store.mjs (90) from the pastes match the final counts.
- [x] Session events API works: all 149 agents' logs (Oct 2–12) and the main chat since Oct 10 are downloaded.
- [x] No copies survive on disk, in git objects or in backups; raw disk access is denied.
- [x] All three uploads are committed and pushed.
- [x] CORRECTION: the line counts recorded at 10-12T03:24 are from BEFORE round 6 (08:08) and the 08:09–08:12 edits. They are final only for files those edits didn't touch (see the edit list).

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

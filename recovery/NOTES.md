# Recovery notepad (read this first after any compaction)

## What happened
- The container was reset at Oct 12 ~20:03 UTC (a "fast resume" re-clone). All uncommitted work since 2c7ee70 (Oct 2) was deleted: server/, online client, friends, parties, voice, worlds, sword, HOSTING.md, tests and six anti-cheat rounds.
- Target: the working tree as it was on Oct 12 ~10:00 UTC (the last state before the reset). The user wants it byte-identical ("same sha").

## Rules
- Commit and push work in progress to `claude/world-exploration-game-962wpo` after every step (the user approved this). Never push to `main` without being asked. Never force-push.
- The repo is PUBLIC: never push session logs, tokens or other secrets. Only source files go in.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01AbPj1ecgWZX5NRERgq23EA`.

## Sources (outside the repo: /home/user/recovery)
- `calls.jsonl.gz`: every tool call and its result from all 149 workflow agents (Oct 2–12) plus the main chat since Oct 10, time-ordered: {t, agent, name, input, result}.
- `subagents.jsonl.gz` and `main.jsonl.gz`: raw stored events.
- Re-download: `node dump.mjs out.jsonl "subagents=true"`. It calls GET {SESSION_INGRESS_URL}/v1/code/sessions/$CLAUDE_CODE_REMOTE_SESSION_ID/worker/internal-events, paged with `limit=1000` and `cursor`, using the Bearer token from $CLAUDE_SESSION_INGRESS_TOKEN_FILE and the header `anthropic-version: 2023-06-01`. It returns only events since the last compaction for the main chat (Oct 10 onward), but everything for the agents.
- NOT available: the main chat before Oct 10, which is where most code was written. The user is searching the app chat log for it.
- `upload/`: the user's first paste (33 files, an early snapshot). Committed as 4b6379b in their real paths. Map: 1 accounts, 2 commands, 3 config, 4 game.mjs, 5 records, 6 server.mjs, 7 store, 8 ws, 9 boot, 10 storage, 11 bodies, 12 ephemeris, 13 gazetteer.js, 14 net/client, 15 protocol, 16 remotePlayers, 17 session, 18 avatar diff part, 19 combat, 20 chat, 21 deathScreen, 22 hud, 24 onlinePanel, 25 playersPanel, 26 teleportMenu, 27 travelPanel, 28 lander, 29 stars, 30 flightcheck, 31 gazetteer.py, 32 onlinecheck, 33 servertest, 34 stars.mjs.
- `upload2/`: the second paste: cells.mjs, hud (again), avatar diff part, social log, voice part, planetary part, HOSTING part, a design doc (mmmm.txt), a ledger section, and shell logs (readf.txt, confex.txt, "$ S=…").

## How to rebuild a file
1. Take its latest full copy (a Write, a full Read, `cat`, or a `git diff` of a tracked file applied to 2c7ee70).
2. Replay every later Edit, Write, python `s.replace`, `patch` and `sed -i` from calls.jsonl in time order.
3. Check the result against later partial views (Read with offset, `sed -n A,Bp`, `grep -n`), and against the recorded hashes and line counts:
   - md5sum of server/game.mjs and its copies at 10-12T02:05 (agent a22e4c88);
   - `wc -l` of server/*.mjs, src/net/session.js, tools/servertest.mjs and HOSTING.md at 10-12T03:24 (agent a050b4c7);
   - server/ws.mjs, full Read at 10-12T03:25 (agent a050b4c7) = its final version.

## File inventory (git status of Oct 9, plus later additions)
- Changed tracked files (38): .github/workflows/deploy-gh-pages.yml, .gitignore, README.md, assets/manifest.json, src/core/{cheats,keybinds,settings,storage}.js, src/game.js, src/geo/{frame,mercator}.js, src/player/{avatar,controller,elytra,player}.js, src/tiles/{elevation,providers,streamer,tileJobs}.js, src/ui/{cheatPanel,exploration,help,hud,mapRenderer,mapTiles,minimap,settingsPanel,touch,waypoints,worldmap}.js, src/world/{beacons,edgeWall,shaders,sky,terrain}.js, styles/main.css, tools/{selftest,shots}.mjs.
- New files: .dockerignore, Dockerfile, HOSTING.md, assets/sword.glb (binary: regenerate), fly.toml, render.yaml, server/{accounts,cells,commands,config,game,records,server,social,store,ws}.mjs, server/config.example.json, shots/online/*.png (regenerable), src/core/boot.js, src/geo/{bodies,ephemeris,gazetteer,gazetteerData}.js, src/net/{client,protocol,publicServer,remotePlayers,session,voice}.js, src/player/combat.js, src/tiles/planetary.js, src/ui/{chat,deathScreen,onlinePanel,playersPanel,teleportMenu,travelPanel}.js, src/world/{lander,starCatalogue,stars}.js, tools/{flightcheck,onlinecheck,servertest,stars}.mjs, tools/{gazetteer,glb-unplate}.py.

## Final design facts (from the last summary; use these to check rebuilt code)
- Server tick 100 ms; GROUND_MAX_MPS 25; maxSpeed 180; SURGE_ALLOWANCE 5.5; ARRIVAL_GRACE_S 30; ARRIVAL_STAND_M 300; ARRIVAL_CEILING_M 1000; RESERVE_FADE_S 5; UNUSED_FRACTION 0.5; UNUSED_FADE_S 4; SURGE_KEPT_MPS 400; BURST_GAP_S 0.25; BURST_SETTLE_MS 150; BLINK_GUARD_MS 800; CATCH_UP 1.5–10 s, lent 2 s; state bucket 30/s, banks 300; PACE_BYTES 256 KB; BACKLOG_MAX 24 MB; SILENT_MS 45000; maxPlayers 50.
- Round-5/6 additions: ws.mjs bigWaiting (frames ≥64 KB not counted against MAX_BUFFERED_BYTES 2 MB) and pongs held to the same limit; shared+ sent in pieces of 20000 (SHARED_NEW_PER_MESSAGE); the 'swing' message removed; whyNot and admin /tp refuse a host still arriving ("You have / X has not landed yet"); friend prefs kept in two lots {account, prefs, next} with a bulk snapshot (session.js); fadeReserve pooled across holds (fadePool, fadeBunch, fadeBack, pausedMs, PAUSE_APART_S 5, PAGE_CATCH_UP_S 1.5); landing timed from the first ground state; lastGap/heldUntil budget; surge dating; surgedSpeed(world, f); GLIDE_ROOM 1.3 fall cap; the blink check counts a drop faster than the page was already falling.
- Final suites: check ok, selftest 1753/1753, servertest 210/210, flightcheck 15/15, onlinecheck 43/43, voice 50/50.

# Prompt donecheck — ledger (workflow wf_05c81cc9-dac)

## modes-files / seeing-others / discoveries-lines (in)
- [x] A1 world map frozen while open: others' arrows/discoveries/trails only redraw on pan/zoom → dirty on 'overlays' + every 0.25 s while open with others present
- [x] A2 map names drawn over other players' arrows → arrows in a second pass
- [x] A3 rotate-with-heading: others' arrows rotated twice → don't subtract rotation for arrows
- [x] A4 oxygen (and rocket stock) only in the page: F5 on the Moon refills the tank → server-held oxygen (drain/refill/suffocate server-side), sent at auth; fix false "server counts every rocket" claim
- [x] A5 others' discoveries off by default, no setting; online player on another world can't be toggled → setting showDiscoveries (on), per-player toggles from atlas
- [x] A6 reconnect drops watches (server starts watching empty) → resend watches in onAuth
- [x] A7 "everyone" watch only covers players known at the time → lasting watchAll on server
- [x] A8 2 km reveal is latitude/zoom-dependent at detail zoom (1.65 km at spawn, 0.8 km at 70N) → level-16 reach from MAX_REVEAL_M
- [x] A9 https page + ws:// server: panel shows the sign-in form not the error; invite link for ws:// / localhost can't connect → show failure, refuse ws:// on https with explanation, invite = server's own page for ws://, warn on localhost
- [x] A10 waypoint edits while disconnected silently lost → resend on reconnect (or refuse with toast)
  (A1-A10 fixed; servertest 93\/93 with oxygen + lasting everyone-watch checks)

## second audit round (combat, modes, seeing, discoveries re-checked on current code)
- [x] B0 first-person sword invisible on foot; no visible swing (combat)
- [x] B1 colours spaced against all accounts, not online players → collisions on a public server (ΔE<10 in 25% of sessions at 50 accounts)
- [x] B2 rocket stock page-only: reload refills every stack
- [x] B3 lander: no server cooldown / ground check; refill trusts page agl
- [x] B4 local mode: health and oxygen not saved, reload refills off Earth
- [x] B5 busy server: sign-in sends all records at once → >2 MB buffered → dropped → reconnect loop (shared map must be paced/chunked)
- [x] B6 onAuth leaves exploration.lastVisit set → new account shows 0 explored until it moves 700 m
  (B0-B6 fixed: view-model sword on foot + arm swing; distinctColour + clash fix at join; rocket stock kept; lander cooldown/ground server-side; local save health/oxygen; paced chunked shared map; lastVisit reset)
## combat challenge (a001c74, resumed)
- [x] K1 jump crit never triggered → falling judged over last 200 ms
- [x] K2 death screen stuck after reconnect while dead → closes on 'revived'
- [x] K3 kills never shown → death screen score
- [x] K4 combat-tagged player hides in spawn → spawn protects only untagged
- [x] K5 misses don't reset cooldown → charge from the swing before this one
- [x] K6 reconnect skips regen delay → lastHurtAt carried
## discoveries challenge (a9f4b0e, resumed): earlier gaps confirmed fixed
- [x] D-1 per-player overlay choices forgotten on reload/travel → remembered per server+world
## new asks (parties/friends/public) built in copy, ported; tests: selftest 1701, servertest 114, onlinecheck 31, voice all passed

## Final audit (wf_01bbaa36-c95) findings — fixed in scratchpad/party, then ported
- [x] F1 ambiguous prefix ('/tpa bla' with Blake+Blakely) says "Nobody called bla" → list the matches
- [x] F2 chat Tab doesn't cycle (trailing space → appends) → cycle when value unchanged since last Tab; test
- [x] F3 /tphere alias for /tpahere
- [x] F4 tpa to a dead player not refused; auto-accept (friend) says "Accepted" when it can't (dead → request thrown away; in fight → never auto-accepted later); 'died'/'left' end silent to sender
- [x] F5 touch: 'Teleport' touch button = random TP (toolbar 'Teleport' = menu); typing in menu hides touch controls (touch.js keydown on inputs)
- [x] F6 J menu open + box unfocused: hotkeys fire, Esc opens Settings instead of closing menu
- [x] F7 J menu toast says "sent" even when the server refuses → toast from 'requestSent' / server reply
- [ ] F8 onlinecheck: J menu (HUD button, mode, row, Esc closes, B no waypoint, absent in ?local)
## Sword (task 16)
- [x] S-a generated sword in scanned fist sized like firework (girth fits, length sqrt) — world + first person (renders r4/r5)
- [x] S-b swing: arm raised backward on both bodies (also in main) → wind-up + strike about the hinge; first person about screen level (renders r4/r5)
- [ ] S-c selftest checks (loadSwordModel/measureSwordGrip/swingPose/sign), manifest note, port, delete tools/_scansword.mjs + _probe.mjs from copy
- [x] F6b players panel: button.blur() → BODY; hotkeys (B waypoint, R rtp to server) fire; Esc opens Settings behind panel → onAction guard + focus panel
- [x] F1 server: nobodyCalled() lists matches (game.mjs, commands.mjs, social.mjs)  [code; test pending]
- [x] F3 tphere alias (protocol.js)  [test pending]
- [x] F4 server: refuse tpa to dead; auto-accept only when whyNot() null, retried each tick; died/left told to the other side  [test pending]
- [x] F9 /password: spaces cut → lockout; >117 chars cut; plain view + history → dedicated 'password' message + form; /password exactly 2 args; no history; tests (password, logout, reset)
- [x] F10 authenticate() and /password .then without .catch → unhandledRejection kills server
- [x] F11 sign-up name input `pattern` pre-empts nameProblem message
- [x] F2 F5 F6 F6b F7 client code done; onlinecheck steps written (run pending)

Evidence (copy): servertest 127/127 (tphere, ambiguity, dead target, died notice, auto-accept waits in fight then goes, password whole/spaces refused/cut refused/wrong old/too long, logout token dead); selftest 1722/1722 (swing geometry, screen-level FP turn, sword wiring/manifest, panel-key guard, touch, toast, history). onlinecheck (F2 F6 F6b F7 F8 + local absence) running.
- [ ] F8 onlinecheck run green
- [x] F8 onlinecheck 39/39 in copy (menu+panel key guard, Esc, Tab cycle, toast, local absence)
## proximity (verify + challenge)
- [x] P1 touch: Chat toolbar button (online); hotbar --slots (6); --touch-rows band (Talk row); vitals above hotbar; crosshair with sword; landscape credits moved off slot 6 (touchshots: all 6 slots tappable portrait+landscape)
- [x] P2 death screen online: DeathScreen.update fills message+score from 'died'
- [x] P3 travel panel: players per world + party/friends names; party "together" line
- [x] P4 compass/locator party (white) / friend (gold) ring; /near uses NEAR_CHAT_M; hint shows range in units; help card; keybind labels
- [x] P5 PTT with voice off → toast where to turn it on
- [x] P6 party radio: RADIO_GAIN 0.35 from RADIO_FROM_M (534 m) — continuous
- [x] P7 locator text (settings, README); dot size 50 m–50 km
- [x] P8 chat on touch: placed above band; tap log opens chat
- [x] P9 compass clear of minimap on narrow screens (--minimap-top-right)
## hosting
- [x] H1 ensureBundle builds terraglide-online.html; VPS/Updating use npm run build
- [x] H2 env vars TERRAGLIDE_MOTD/MAX_PLAYERS/MAX_ACCOUNTS/SIGNUPS_PER_HOUR/OPEN_SIGNUPS/FIRST_ACCOUNT_ADMIN/PVP/ALLOWED_ORIGINS/CONFIG; table; Fly + public-server sections
- [x] H3 public server steps: admin before advertising; rebuild after publicServer.js; deploy in step
Copy suites: selftest 1729/1729, servertest 127/127, check ok
## hosting challenge
- [ ] H4 MAJOR: records never evicted; knownOn/sendAtlas decode every players/ file per arrival → OOM at ~3000 accounts on 256 MB (crash loop). Evict offline records; atlas from a small index; HOSTING sizing
- [ ] H5 workflow regex accepts paths the server refuses (/ws/, /game) → only '', '/', '/ws'
## worlds
- [x] W1 arrival free-fall off Earth (clamp to 0 at game.js:2020; releaseSettle stale _holdY)
- [x] W2 oxygen warnings: toast+sound at 60/30/10/0 s; red edge while suffocating
- [x] W3 local nearAir needs onGround (matches server)
- [x] W4 online tank shared across worlds → refill on travel
- [x] W5 local reload while dead → save respawn point + full tank
- [x] H4 index.json + peek + evictRecords + ATLAS_MAX 300; measured 3000×60 km: heap 10 MB, RSS 75–130 MB (was OOM), atlas 30 KB in ~60 ms; stop() bounded 5 s; servertest 130/130 (eviction, index, atlas reads no files); HOSTING sizing + data layout
- [x] H5 workflow regex: '', '/', '/ws' only (checked accept/reject)

Evidence worlds: trace Moon on ground -1923.9 at 6 s (was 30 s fall), Mars -2564.1 at 9 s; servertest 131/131 x4 (travel refill, flake fixed); selftest 1734/1734

## public-shared / parties / friends (verify+challenge)
- [x] PS1 shared map once per connection+world (toggle loop sent whole map); parts encoded once (cache); deltas to all holders; watch rate limit; per-client backlog cap 24 MB
- [x] PS2 flushShared in saveAll (last half second lost on restart)
- [x] PA1 invite cooldown per target; invites survive reload/travel (re-sent on join, with world)
- [x] PA2 leader away 90 s → hand over; promote refuses offline; Object.hasOwn(BODIES) in mark
- [x] PA4 follow skips 'tpa' unless host in party; gather refused in combat; together not ticked on join; leader tick hidden
- [x] PA5 party beacons in the world; named marks (prompt) from panel and map; world map actions row on narrow screens
- [x] PA6 party null always on join; leave without party sends null; kicked-while-away notice
- [x] PA7 setTogether saves
- [x] PA8 disband keeps waypoints in members' own (page for current world, record for others; notice)
- [x] PA9 party mark/unmark rate limit (6 per 4 s)
- [x] PA10 'social' message (own budget 16/6 s) for panel friend+party actions; Party button hidden for non-leaders; invite carries world
- [x] PA11 party voice off → panel switch (push to talk)
- [x] FR1 exact account first; accept/deny/remove match within own lists
- [x] FR2 account prefs applied on sign-in; page sends only real changes (unsent flag)
- [x] FR3 friends' world refreshed on quiet join; accepted-while-away notice; help text
- [x] FR4 repeat request refused; denied → 10 min before asking again
- [x] PS3 shared map as runs (server/cells.mjs): 5.9 B/cell vs 66 (1.25M cells 7.3 MB vs 82.5 MB); no sort to encode; selftest unit checks
- [x] PS4 painter: 150k cells/player/day into the shared map; 30M cap; servertest; HOSTING limits table
Copy suites now: selftest 1740/1740, servertest 135/135, check ok

## red team anti-cheat round (copy, then ported to main)
- [x] R1 flight limit 420 -> 180 (measured honest max 143 climbing Rocket V on Earth); thin air max(180, terminal*1.3); SURGE_ALLOWANCE 5.5 (surge Rocket V climb 873)
- [x] R2 on foot 25 m/s from 2 s after landing; climbs counted from 30 s after arrival; on-foot climb (terrain refine) accepted but counted
- [x] R3 burst/blink guard: >limit*0.5s+20 m over the last half second, or a refused move -> hits ignored 0.8 s
- [x] R4 reach bonus horizontal only; hit needs a swing within 1 s; onSwing resets blade like the flag
- [x] R5 RTT from server WS pings (median of 5), rewind min(400, rtt/2+100); page rtt ignored
- [x] R6 pending timeout 20 s -> auto-arrive; arrival slack 3000 -> 400 m; blink cleared on arrival
- [x] R7 combat log = death credited to last attacker (not on replace/travel/server stop), notice on return; /kill in a fight credits attacker
- [x] R8 chat/social budgets per account; login lockout per (account,address) 5/15 min + 30/h per account for guessing addresses only; password-change guesses 5/15 min; gather 10 s cooldown
- [x] R9 HOSTING (maxSpeed row, anti-cheat section incl. what it cannot check, rate limits, combat tag), config comment + example 180
- [x] R10 tests: servertest +23 ("held to what the game can do") 158/158
- [x] PORT copy -> main (38 files, 3-way checked: main-only lines all superseded; backup mainbackup-030145)
Main suites: build ok, check ok, selftest 1747/1747, servertest 158/158, onlinecheck 39/39, voice all passed
- [x] S-c sword selftest checks + manifest note present, ported (tools/_*.mjs stay in the copy only)

## critic round 2 (wf_353c1ae3-d7a) — fixed in main directly
- [x] C1 airless worlds: honest dive/pump flying corrected (Moon, Mercury...) -> per-player energy account: fallReserve (2gh from falls below an earned ceiling; climbs pay it back; air fades it; landing clears) + surgeKept ((2.4*RocketV*1.1)^2 kept after a surge, faded by air); ceiling only rises by counted climbs (claimed arrival heights give nothing)
- [x] C2 refused moves refilled the allowance twice (cheater held ~250 m/s) -> lastStateAt advanced on refusal; cheater now ~182 m/s, kicked when asking 400
- [x] C3 honest network stalls >2.5 s corrected -> catch-up allowance (limit*(gap-1.5), up to 10 s) + state token bucket (30/s, banks up to 300) instead of a per-second cap that dropped half a stall
- [x] C4 lastHitBy lost on second-tab replace -> carried with the combat tag
- [x] C5 "auto to accept incoming to friends" other reading -> Accept friend requests automatically (friendsAutoAccept / autoFriends), server-kept, docs + warning about auto-tpa combo
- [x] C6 remote players always built body -> nearest 6 within 400 m drawn with the viewer's scanned body + generated sword/firework + swing; switches live; textures disposed on leave; settings text corrected
- [x] C7 stale claims: game.mjs maxSpeed/SURGE_ALLOWANCE comments, HOSTING maxSpeed row + anti-cheat section, servertest moon assertion comment
- [x] T tools/flightcheck.mjs (15 worlds x climb/pump/dive/high/surge/land with jitter + 3 s and 6 s stalls, real Player/Controller, fake-clock server): 15/15; servertest 168/168 (+10); selftest 1751/1751 (+4); onlinecheck 43/43 (+4, scanned-others.png)
- [x] C8 (found while the re-check ran) climbs in the arrival grace were free AND falls earned: bouncing banked a fall per bounce -> every climb pays the reserve back (grace too); servertest: 6 bounces keep one fall (the honest "stood on the highest peak and stepped off" case), documented under "What it cannot check"
- [x] C9 a refused move kept the fall it claimed (reserve farmed via refusals) -> the account is rolled back with the move; servertest
Suites after C8/C9: servertest 170/170, flightcheck 15/15, voice 50 PASS (all passed), onlinecheck 43/43 (before C8/C9, client untouched since)

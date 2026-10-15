# Partial rebuilds (gaps marked @@MISSING n@@)

Best rebuild so far of each file not yet installed (recovery/tools: chain.mjs + pool.mjs, several variants; best.mjs keeps a result only if it agrees with every view after the last recorded count and with the safe rebuild). Copies in recovery/partial/<path>.

Total: 38259 lines, 14314 missing (62.6% known; without selftest.mjs much higher).

| file | lines | missing | % known | reference views | source run |
|---|---|---|---|---|---|
| tools/shots.mjs | 389 | 0 | 100.0 | 0 | out/late2 |
| src/net/session.js | 949 | 0 | 100.0 | 7 | out/v5 |
| src/net/remotePlayers.js | 610 | 0 | 100.0 | 2 | out/v5 |
| src/geo/bodies.js | 395 | 0 | 100.0 | 6 | out/v5 |
| src/world/beacons.js | 193 | 0 | 100.0 | 1 | out/loose |
| src/ui/trail.js | 140 | 0 | 100.0 | 0 | out/v5 |
| src/core/settings.js | 605 | 9 | 98.5 | 3 | out/v5 |
| server/server.mjs | 321 | 18 | 94.4 | 0 | out/v5 |
| README.md | 696 | 25 | 96.4 | 2 | out/loose |
| src/player/elytra.js | 488 | 26 | 94.7 | 0 | out/v5 |
| src/ui/settingsPanel.js | 925 | 30 | 96.8 | 5 | out/v5 |
| src/net/protocol.js | 517 | 41 | 92.1 | 8 | out/v5 |
| src/net/voice.js | 1553 | 46 | 97.0 | 0 | out/hand |
| server/config.mjs | 146 | 51 | 65.1 | 0 | out/v5 |
| src/player/player.js | 755 | 64 | 91.5 | 1 | out/v6 |
| src/ui/minimap.js | 198 | 78 | 60.6 | 1 | out/late2 |
| src/ui/travelPanel.js | 173 | 105 | 39.3 | 1 | out/v5 |
| src/ui/playersPanel.js | 463 | 130 | 71.9 | 2 | out/v5 |
| HOSTING.md | 1544 | 136 | 91.2 | 1 | out/v6 |
| tools/onlinecheck.mjs | 596 | 136 | 77.2 | 5 | out/v5 |
| src/ui/teleportMenu.js | 377 | 145 | 61.5 | 0 | out/v5 |
| src/ui/chat.js | 237 | 189 | 20.3 | 1 | out/v6 |
| src/ui/worldmap.js | 567 | 210 | 63.0 | 3 | out/late2 |
| src/ui/onlinePanel.js | 387 | 226 | 41.6 | 1 | out/v5 |
| server/social.mjs | 876 | 248 | 71.7 | 2 | out/v5 |
| src/ui/hud.js | 747 | 412 | 44.8 | 6 | out/v6 |
| src/player/avatar.js | 5137 | 445 | 91.3 | 0 | out/v5 |
| tools/servertest.mjs | 1749 | 458 | 73.8 | 0 | out/late2 |
| src/game.js | 2957 | 577 | 80.5 | 14 | out/v6 |
| src/tiles/planetary.js | 1947 | 929 | 52.3 | 8 | out/late2 |
| tools/selftest.mjs | 11622 | 9580 | 17.6 | 2 | out/late2 |

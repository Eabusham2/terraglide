# Partial rebuilds (gaps marked @@MISSING n@@)

The best rebuild of each file not yet complete, from recovery/tools (chain.mjs + pool.mjs, several variants, best kept by best.mjs). Copies are in recovery/partial/<path>. A file is complete only when it has no gaps and agrees with every view after its last recorded count.

| file | lines | missing | % known | reference views | source run |
|---|---|---|---|---|---|
| src/net/session.js | 949 | 0 | 100.0 | 7 | out/chain |
| src/net/remotePlayers.js | 610 | 0 | 100.0 | 2 | out/chain |
| src/geo/bodies.js | 395 | 0 | 100.0 | 6 | out/chain |
| src/world/beacons.js | 188 | 0 | 100.0 | 1 | out/chain |
| src/ui/trail.js | 140 | 0 | 100.0 | 0 | out/chain |
| src/core/settings.js | 605 | 9 | 98.5 | 3 | out/chain |
| server/server.mjs | 321 | 18 | 94.4 | 0 | out/chain |
| README.md | 696 | 25 | 96.4 | 2 | out/loose |
| src/player/elytra.js | 488 | 26 | 94.7 | 0 | out/v5 |
| src/ui/settingsPanel.js | 925 | 30 | 96.8 | 5 | out/chain |
| src/net/protocol.js | 517 | 41 | 92.1 | 8 | out/chain |
| server/config.mjs | 146 | 51 | 65.1 | 0 | out/chain |
| tools/shots.mjs | 389 | 59 | 84.8 | 0 | out/loose |
| src/player/player.js | 755 | 66 | 91.3 | 1 | out/chain |
| src/ui/travelPanel.js | 173 | 105 | 39.3 | 1 | out/chain |
| src/ui/playersPanel.js | 463 | 130 | 71.9 | 2 | out/chain |
| tools/onlinecheck.mjs | 596 | 136 | 77.2 | 5 | out/chain |
| src/ui/teleportMenu.js | 377 | 145 | 61.5 | 0 | out/chain |
| HOSTING.md | 1544 | 151 | 90.2 | 1 | out/v5 |
| src/ui/chat.js | 237 | 192 | 19.0 | 1 | out/chain |
| src/ui/minimap.js | 198 | 195 | 1.5 | 1 | out/chain |
| src/ui/onlinePanel.js | 387 | 226 | 41.6 | 1 | out/chain |
| server/social.mjs | 876 | 248 | 71.7 | 2 | out/chain |
| src/ui/worldmap.js | 567 | 410 | 27.7 | 3 | out/chain |
| src/player/avatar.js | 5137 | 445 | 91.3 | 0 | out/chain |
| src/ui/hud.js | 747 | 468 | 37.3 | 6 | out/chain |
| src/net/voice.js | 1553 | 697 | 55.1 | 0 | out/chain |
| src/game.js | 2957 | 700 | 76.3 | 14 | out/v5 |
| tools/servertest.mjs | 1749 | 889 | 49.2 | 0 | out/loose |
| src/tiles/planetary.js | 1947 | 932 | 52.1 | 8 | out/chain |
| tools/selftest.mjs | 11622 | 11590 | 0.3 | 2 | out/chain |

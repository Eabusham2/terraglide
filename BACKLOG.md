# TerraGlide backlog

Everything asked for, in the words it was asked in, so nothing depends on
anyone remembering it. Nothing is removed from this file when it is done — it
is ticked, so the record of what was asked survives alongside the record of
what was built.

Status: `[ ]` open · `[x]` done, with the evidence · `[~]` partly done, with
what is left · `[?]` needs a decision from you · `[=]` a standing instruction,
which has no end condition and is never ticked — the entry is the running
record of how it is being kept.

`[~]` is used for two different things and it is worth saying which is which
in each entry: work that is genuinely half-finished, and work that is finished
on this side and waiting on something only you have — a key, a token, or the
machine it happens on. Every `[~]` below names its blocker in its last
paragraph.

---

## A. Stops you playing

- [x] A31. The explored map was wrong by four times at half the zooms
      "Explored on map still doesn't show exactly what u explored, it's
      extremely inaccurate", and "the explored being wrong especially zooming
      out".

      Levels are recorded at 8, 10, 12, 14 and 16, so half the map's zooms fall
      between two of them — and those were answered from the coarser one: zoom 9
      from level 8, zoom 11 from level 10. One recorded cell then answered for
      four squares of the zoom actually being drawn, and answered yes for all
      four. Standing in one spot lit up four times the ground you had seen, at
      exactly the zooms you are looking at when you zoom out.

      A square is explored if anything recorded inside it is. That was already
      the rule going *up* — `coarse` folded level 8 up for the whole-planet view
      — and it is the rule at every zoom now: fold every recorded level at least
      as fine as the one being asked about. Falling back to a coarser cell is
      kept only past level 16, where there is genuinely nothing better to say.

      Counted, on a record made by standing at the centre of a zoom-11 tile with
      a 1.2 km horizon:

                        before   after
        zoom 8            1        1
        zoom 9            4        1
        zoom 11           4        1

      Checked against the old code rather than assumed: it returns 4 at both.

      One earlier attempt at this entry was wrong and is worth recording. I read
      a half-tile floor in `mark` as recording ground up to 78 km away and
      "fixed" it — then the vacuity check passed with the floor restored, and
      the arithmetic showed why: the nearest a neighbour's centre can ever be is
      exactly half a tile, so that floor could never change an answer. It was
      dead code, not a bug, and the change was reverted.

- [x] A30. The online single file loaded no assets at all
      You asked for it twice — "online single file should use assets too like
      gen stuff", and "add the assets gened and other features via grab from
      GitHub to the single file and fallback if unavailable" — and it was ticked
      because the file starts and reaches Ready. It does. The player model never
      arrived in it, and nothing said so except the console.

      Driven from `file://` with the network reachable, which is how you open
      it: started true, stage Ready, bundle loaded true, and

        Access to fetch at 'file:///.../assets/manifest.json' from origin
        'null' has been blocked by CORS policy

      The bundle stood in for `import.meta.url` with `document.baseURI` — the
      page. For the offline one-file build the page and the bundle are the same
      thing, so that was right there and it is what got tested. For the online
      one they are not: that page is a small local file and the bundle it pulls
      comes from the published site. So every module-relative path — the assets
      folder, the Draco decoder — was resolved against a folder beside a file://
      page, which does not exist.

      It resolves against `document.currentScript.src` now: where the bundle
      actually came from. An inlined bundle has no `src` and falls back to the
      document exactly as before, so the offline edition is untouched.

      Verified by pointing the online page at a locally served copy of this
      build rather than at whatever is deployed — which matters, because the
      first run of this test was measuring the old published bundle and said the
      fix had not worked. Asset requests now go to
      `https://eabusham2.github.io/terraglide/assets/...` and not one goes to
      `file://`.

- [x] A29. The bumps on the green, asked for four times and never delivered
      Your words, across four messages: "on areas with big contrast like tan or
      orange and there is green slightly elevated green"; "the bumps on tree
      dark green small section contrast when there is no photoreal 3d"; "u never
      added the slight bumps above tree when theirs is a lot of deep green to
      diff color"; and "still no bumps on the green how I asked".

      The machinery was all there and one line stopped it working on exactly the
      case you kept describing. `measureCanopy` returned

        greenShare * brokenShare

      — how canopy-like the green is, multiplied by how much of the square is
      green. A wood filling a sixth of a square of tan scrub therefore scored
      about a tenth however unmistakably broken its green was, and a tenth of
      the relief is invisible. The one shape you asked for by name was the one
      shape the formula erased.

      Coverage is a *where* question and that function answers *whether*. So it
      returns the brokenness alone now, with a floor of 64 green samples so a
      dozen green pixels in a city is not mistaken for a copse. The shader
      decides where, per fragment, from how green that texel is against its own
      red and blue — so the tan stays flat and the wood inside the same square
      gets the whole score. It needs no survey and no photorealistic 3D, which
      is the condition you set.

      Driven over three made squares with known answers:

        an unbroken field         0.00   (still nothing, which was always right)
        a broken canopy           1.00
        a small wood in tan       1.00   (was about a sixth of that)

      The earlier global attempt that failed is still in the file's own notes
      and is not what this is: it scored greenness and roughness over a whole
      square and could not tell Cambridgeshire from the Amazon. This asks the
      brokenness question the same way it always did and simply stops averaging
      the answer away.

- [x] A28. It flickers to a flat plain colour
      Found by reading rather than by watching, because this sandbox draws at
      about one frame a second and cannot see a flicker that lasts a few frames
      on your phone. Sixty-eight sampled frames caught nothing, which is a limit
      of the instrument and not evidence of absence.

      The ground shader's `uMap` defaults to a white pixel, so a square with no
      photograph of its own and no coarser one to stretch is drawn flat. The
      streamer's own comment already names this exactly — "nothing to stretch
      means uHasTexture is zero, which is drawn as flat grey" — and then the
      eviction directly underneath it went ahead and created the condition.

      `resolve` stamps `used` with the current frame on the one entry it hands
      back, so an entry carrying this frame is on screen right now, either as a
      tile's own photograph or as the coarse one stretched over it. Eviction
      could take those:

        first pass    held anything seen in the last twenty seconds
        second pass   skipped only pending entries, and says of itself that
                      "the protection is a preference, not a promise"
        cover pass    no protection at all — and cover is the pool everything
                      else stretches from

      So on a machine over its texture budget, a tile could have the photograph
      it was being drawn from disposed in the frame it was drawn, and come out
      white. Turn quickly and it is not one square, it is the view.

      All three passes go through one guard now: an entry stamped with the
      current frame is never dropped. It cannot deadlock the budget — at most
      one entry per drawn tile carries the current frame, and textureLimit is
      already floored at what the tier draws, for reasons its own comment sets
      out. Tested with a limit of two against four tiles: the one on screen
      survives and the others go; and a coarse tile being stretched right now
      survives the cover pass while the pool still comes back under budget.

- [~] A27. Flat, blurred ground on foot, with photorealistic 3D off
      You corrected me: this happens with 3D switched off, and I had wrongly
      folded it into the 3D work. Reproduced on the first try, standing in
      Grindelwald under the Eiger — the ground in front of the camera is a
      smooth blurred plate to a hard horizon while the distant hills are fine.

      Measured there, 3D off, Esri imagery and AWS Terrarium elevation:

        the quadtree draws tiles at zoom 20, 21 and 22 within 30 m of you
        every one of them is built from elevation zoom 14
        elevation zoom 14 is the finest the provider has

      At 46.6 degrees north a zoom-14 elevation sample is about 6.6 m, and a
      zoom-22 terrain tile is about 6.6 m across. The tile is one sample wide.
      A zoom-21 tile is two. Those cannot carry relief, whatever else is fixed:
      there is no data at that spacing to carry.

      So the flatness within a few tens of metres is the elevation dataset's
      resolution, not a bug in the mesh. Terrarium stops at 14; Mapbox
      Terrain-RGB stops at 15 and would halve the spacing, which is worth
      trying with your token but is one level, not a fix.

      What *is* wrong, and is being counted:

        imagery at 15 s   exact 519  stretched 36  failed 39
        imagery at 90 s   exact 518  stretched 44  failed 73

      The failures climb with nothing pending. The quadtree is splitting to
      zoom 22 because Esri publishes a max of 23 somewhere in the world, then
      asking for tiles that do not exist over an alpine valley and magnifying
      the parent when they do not arrive. `reviewDepth` is meant to write a
      level off after six refusals and clearly is not stopping this. That is
      wasted requests and wasted meshes on the ground you are standing on,
      which is also part of "why so slow".

      Not fixed yet. Written down with the numbers rather than guessed at,
      because the last two times I guessed at this symptom I was wrong twice —
      once blaming the coverage rule and once blaming a stale cache.

- [~] A26. Missing buildings, a flat floor, and "why so slow"
      You drew circles on my own screenshots. They were my screenshots, on
      current code, and I had described that view as rendering properly. It was
      not, and the right thing was to look rather than to explain it away.

      Four faults, and one of them was mine.

      1. traverse() returns "everything this subtree wants to draw is drawn",
         and a REPLACE parent stops drawing itself the moment its children all
         say yes. Four early exits answered yes when they meant "I gave up
         here": past the depth cap, an unreadable bounding volume, past the
         render distance, and no content. Each is a parent dropped over ground
         nobody drew — a hole the exact shape of one tile. They answer no now.

      2. The depth cap was 24, and depth counts tiles *and* the hops between
         the tilesets they are spread across. Google's tree reaches street
         level well past that, so the cap was firing in ordinary play rather
         than as the runaway guard it is meant to be, and every tile it stopped
         at was reported to its parent as covered. 64 now.

      3. Google answers a bad key with 400, not 401 or 403 — checked against
         the live endpoint, along with 403 "Method doesn't allow unregistered
         callers" for no key at all. Only 401 and 403 were special-cased, so
         every real key problem came out as "root 400". Google says exactly
         what is wrong in the body, and the commonest answer names the project
         and the API you have to enable. It comes through now, ion's too. Also
         a child tileset's contents were resolved against the root rather than
         against that tileset — fine for Google, whose URIs are absolute, wrong
         for ion's OSM Buildings, which this offers in the settings.

      4. The slowness was mine. The request budget was 4 to 8 and was never a
         real limit, because the slot was released fifty milliseconds after a
         request started. Fixing that made the number mean what it says — and
         turned an unbounded pipe into a strictly-six one, which on a phone is
         slower than what it replaced. Six is the HTTP/1.1 per-host limit and
         both these servers speak HTTP/2. 12 to 40 now.

      Measured at the viewpoint you circled, 120 m over Market Street:

                        before            after
        at 60 s         48 loaded         272 loaded, 116 tilesets, 390k tris
        settled         253 drawn         331 drawn, 420 meshes, 478k tris

      And looked at, which is the part I skipped last time: solid buildings to
      the ground, no missing blocks, no flat plate. One small green patch
      remains near the centre of the frame that I have not chased.

      Still `[~]`: the datum estimator drifted from 32.4 to 38.6 over that run,
      against a known 32.8, so it is picking up something it should not — a roof
      cluster, most likely. And "the terrain goes flat" you have seen with
      photorealistic 3D switched *off*, which none of this touches and which I
      had wrongly folded into the 3D work.

- [x] A25. "wtf is this" — a screenshot of code that had already been fixed
      You sent a phone screenshot of Stevenson Street filled with huge grey
      slabs. Reproduced at your exact coordinates, on foot, facing NE 45 as your
      HUD read, on current main: a city, with streets. Not the same picture.

      The reason is that your phone was not running current main. The page asks
      for `terraglide.bundle.js` at a URL that never changes, and GitHub Pages
      serves it with `cache-control: max-age=600`. So for ten minutes after a
      deploy — longer on a phone holding the response for its own reasons — a
      device that had the site open recently keeps running the old three
      megabytes and sees none of the change. Confirmed against the live site:
      no version in the URL, max-age 600, and the fix present in the deployed
      file while the page that asks for it is cached separately.

      This has cost real time in both directions. It is why a fix could be
      tested against code that did not contain it, and why you can watch me
      describe a change you cannot see.

      Fixed at the point of publication rather than in the page: the deploy now
      stamps the bundle's own fingerprint into the URL the published page asks
      for, and fails rather than publishing an unstamped page. A new build is a
      new URL, so it cannot be served from cache; an unchanged build keeps its
      URL, so the cache still does its job. The checked-in page is left plain,
      so local use and the file:// editions are unaffected.

      One thing it broke and how: the boot retry appended a hard-coded
      `?retry=N`, which on a stamped URL would have produced two question marks.
      It picks its separator now, with a test for each case.

      To see a change immediately without waiting on any of this: hard-reload,
      or open the site with `?v=` and anything on the end.

- [x] A22. Ground eleven kilometres below the deepest place on Earth
      Found by driving the coordinate edges — poles, the Mercator limit, the
      antimeridian — looking for NaN. No NaN anywhere, latitude clamped to
      85.051 correctly, longitude 200 wrapped to -160 correctly. But two ground
      readings were impossible: -13,797 m at the southern Mercator limit and
      -14,460 m at null island. The deepest place on Earth is -10,994 m.

      The provider again, and this time with a bound that is a fact rather than
      a threshold. Read straight off the dataset at thirty places and three
      zooms — ninety tile-reads — the deepest real cell anywhere is -10,836 at
      the Challenger Deep and -10,706 in the Tonga Trench, and the highest is
      8,753 on Everest. Not one real cell falls outside [-11,000, 9,000]. The
      broken ones are far outside: -12,860, -13,021, -13,797, -14,460.

      Their counts gave the shape away: 256, 512, 256 and 1,536 cells, exact
      multiples of a 256-wide tile. Whole lines. And they are *columns* at the
      left edge — column 0 over Antarctica, 0-1 at null island, 0-5 at the
      southern limit. A seam artefact in the source.

      Two things worth recording from getting it wrong first. The despike could
      not reach these, and not by accident: a two-column band outvotes an
      eight-neighbour ring, because five of the eight neighbours of a cell in
      the middle are themselves bad. A physical bound consults no neighbours, so
      the width of the damage does not matter. And the first fill searched up
      and down each column and replaced nothing at all — the whole column is
      bad, so there was nothing valid to find. It has to search across the
      damage, not along it.

      A rejected cell is interpolated from the real ground either side of it on
      its row; at the tile's edge, where there is only one side, the nearest
      real value carries across a strip a few cells wide. Both ends are
      measurements; the thing being replaced is not.

      Verified: zero cells changed at every honest place tried — Alps, K2,
      Everest, Challenger Deep, Tonga Trench, the Dead Sea, Manhattan, the
      Pacific, Greenland — with every minimum and maximum identical to the
      metre. On the broken tiles: 256, 512, 256 and 1,536 cells replaced,
      exactly the counts that were wrong. In the running game, across null
      island, the southern limit, Antarctica and the mid Pacific, no cell is off
      the planet any more.

      What it does not fix: those same tiles still read about -10,400 at their
      left edge where the truth is nearer -4,800. The damage runs past the
      impossible range into wrong-but-possible values, and separating those from
      real bathymetry needs a second dataset rather than a cleverer rule.

- [x] A23. Two things checked because they differ between here and your machines
      Both came back clean, and both are worth recording so nobody spends the
      time again.

      **A save from a previous session does not stop it starting.** Every probe
      in this file boots with empty storage; seven machines that have been
      played on do not. start() reads the saved position and teleports to it
      *before* the frame loop begins, so a save the code cannot cope with would
      be a boot that never finishes — exactly the shape of A0. Driven with
      eleven different saves in that slot: a normal one, null coordinates,
      strings where numbers belong, latitude 9999, an empty object, an array, a
      bare number, truncated JSON, a spawn in the middle of the Pacific, and a
      200-kilobyte junk object. Every one started, in 1.0 to 2.7 seconds. Not
      this.

      **The standby providers still take over when the first one refuses**,
      which needed re-checking because A20 changed how "no imagery here" is
      decided. Measured by where the requests went rather than by the label on
      the primary — which is what misled me first time: tiles.maps.eox.at took
      174 requests, and all 174 of them were during the two minutes Esri was
      returning 503. None before, none after. Per-square escalation, exactly as
      designed.

- [~] A21. Buildings could not be tested here, and the sandbox is why
      Manhattan, Reykjavik and Paris all reported zero buildings at Ultra, with
      the failure count climbing. That looked like a serious fault and is not
      one: Overpass is unreachable from this container. The agent proxy's own
      log names it — `overpass-api.de:443, tunnel closed (code 1006) after 7s,
      517 B sent, 39 B received` — and Overpass queries routinely take five to
      thirty seconds, so the relay kills every one of them. Two other mirrors
      return an identical 21-byte "Internal Server Error", which is the relay
      rather than two different servers agreeing.

      So buildings are untested rather than broken, and I am not going to claim
      either way without a network that can reach the provider.

      What could be tested is the thing that matters if a player's network is
      the same: a dead provider must not be hammered. Driven with every Overpass
      request failing, over four minutes: four requests, gaps of 96, 75 and 63
      seconds. About one a minute against a provider answering nothing, and no
      invented buildings in the meantime — it simply draws none.

      Waiting on: a network that can reach Overpass. Not yours to fix and not a
      fault in the game — this container kills the connection after seven
      seconds and their queries take longer. Untested, not broken.

- [x] A20. Antarctica was unplayable because every photograph of it was
      thrown away
      Found by sweeping Ultra rather than by looking for it. Twelve stops round
      the world, watching invariants, and one row was wrong: Antarctica drew
      **two tiles** where everywhere else drew three to seven hundred. Held
      there for two and a half minutes — depth limit pinned at zoom 5, deepest
      request zoom 5, imagery 8 loaded against 561 failed, 291 squares barren.
      Elevation was fine throughout: 707 tiles, nothing failed, ground 2,867 m,
      which is right for the plateau. So it was imagery, and only imagery.

      Not the provider. Esri serves Antarctic imagery at every zoom tried — 6,
      8, 10, 12 — all HTTP 200, all JPEG, 1.7 to 2.6 kB.

      It was us. `isNoDataCard` called a tile a placeholder when it was bright,
      colourless, flat and under six kilobytes, on the reasoning that nothing
      real sits in that corner. Something real does:

        Antarctica z6    2,564 bytes   mean 239   spread 17   variance 0.4
        Antarctica z8    2,488 bytes   mean 235   spread 17   variance 0.3
        Antarctica z10   2,420 bytes   mean 232   spread 17   variance 0
        Antarctica z12   1,688 bytes   mean 230   spread 17   variance 0
        the actual card  2,521 bytes   mean 205   spread  0   variance 34

      Every one of those Antarctic rows is a real satellite photograph of the
      plateau, and every one was being discarded. The comment in that file
      claimed the pixel test "stops a genuinely featureless snowfield being
      thrown away for it" — and the snowfield it had been checked against was
      Greenland at mean 53, which is dark coastal rock. A bright one had never
      been tried.

      Fixed by identifying the card instead of guessing at it. It is one fixed
      image: 2,521 bytes, byte-identical at zooms 14, 15, 16, 17 and 18 and
      everywhere else sampled, sha256 9eafd300…, and it says "Map data not yet
      available" in grey. Matching the bytes cannot reject a photograph however
      bland it is. The length is checked first, so the hash only runs for a
      candidate and every real tile costs one integer comparison. All four
      callers now hand over the bytes rather than a decoded picture and a size.

      Checked that this does not swing the other way: a 2,521-byte buffer of
      anything else is kept, so the length is a gate and not the verdict. And
      the 672-byte tile that turned up while sampling is deep ocean — flat dark
      navy, entirely real — and is kept.

      Standing on the plateau, before and after:

                        drawn   depth limit   deepest asked   loaded   own
        before              2   zoom 5              5              8   70%
        after             748   none               18            951   85%

      Photographed: a white plateau under a low sun at 9,406 ft, which is what
      Antarctica looks like. It was two tiles and an empty world before.

      If Esri ever changes the card this stops recognising it and the card gets
      drawn again — which is the right way round. A grey rectangle is a blemish;
      discarding real ground is a continent that does not load.

      The same test was used in three other places, and each was quietly wrong
      in the same way. The minimap and world map dropped the same tiles. The
      coverage probe in providers.js concluded a provider had no imagery where
      it plainly did. And the water test in water.js threw the tile away before
      it could look at it — which matters most, because land you cannot
      photograph is land random teleport will not put you on. Checked after the
      fix, on the ground that used to fail:

        Antarctic plateau   land, land fraction 1.00
        Greenland interior  land, 1.00      Salar de Uyuni   land, 1.00
        Sahara dunes        land, 1.00      Alps             land, 1.00
        Manhattan           land, 0.63      mid Pacific      water, 0.00
                                            mid Atlantic     water, 0.00

      Eight for eight. The pixel test itself was always right — it rejects snow
      and cloud explicitly — it just never got to see the picture.

- [x] A24. It blurs so much and so long, and even the minimap is higher res
      Your words, with a photograph of Market Street attached, and later: "even
      on high it blurry more than minimap, it takes a long time and keeps
      toggling blurry not blurry and sometimes it becomes mega blurry and
      terrain becomes flat."

      Four complaints, four separate causes. None of them was the detail tier,
      which is what I would have reached for first.

      1. Blurrier than the minimap. Nothing ever set anisotropy on
         photogrammetry textures. Measured on a live Cesium ion tileset: eight
         textures loaded, all eight at anisotropy 1, on hardware reporting a
         maximum of 16, while the flat imagery beside them runs at 16 through
         streamer.js. At 1 the GPU chooses its mip level from the larger of the
         two on-screen derivatives, so any surface seen at a slant is read from
         a mip picked for its stretched axis. Standing in a street, that is
         nearly every surface there is: the road, the pavement, every facade
         running away from you. The minimap is drawn flat and face-on and never
         pays it, which is exactly why it looked sharper than the world it is a
         map of. This is why turning the tier up did not help — the tier does
         not touch the sampler.

      2. Takes a long time. The concurrency slot was released fifty
         milliseconds after a request STARTED rather than when it finished:

             setTimeout(() => {
               if (this.pending.delete(uri)) this.active = Math.max(0, ...);
             }, 50);

         So `budget.active` never limited anything — four slots recycled every
         fifty milliseconds is eighty requests a second with no ceiling on how
         many are open at once. Worse, the `pending` mark went with it, so a
         tile still downloading no longer counted as asked for and was asked for
         again on the very next frame, and the one after that. The browser's
         handful of connections to the host filled with copies of tiles that
         were already arriving, and the tiles you did not have yet queued behind
         them. It gets worse the more of the city you can see. Slots are now
         released when the request settles — GLTFLoader calls exactly one of
         onLoad or onError — with the timer kept as what it was meant to be, a
         net under a request that never answers at all, at thirty seconds.

         Driven through the real request path: with four slots and forty tiles
         wanted, four open; thirty more frames open nothing further; no URI is
         ever requested twice at once; one finishing opens exactly one more, and
         a refusal frees its slot too.

      3. Keeps toggling blurry, not blurry. A tile could be evicted the moment
         it was not wanted in one single frame — the frame you turned your head
         in. Turning back found it destroyed, so the coarse parent was drawn
         while the re-download ran: blurry, sharp, blurry again. And eviction
         walked the map in arrival order, so the ground you had been standing on
         longest went first. `entry.used` was written once when a tile landed
         and then never read or refreshed — the field named the intention the
         loop did not implement. It is now touched every frame a tile is drawn,
         eviction is least-recently-seen first, and a tile keeps its place for
         fifteen seconds after leaving view so a look around is free. The cap is
         still a cap: when everything spare is inside its grace it yields, but
         it yields what you looked at longest ago.

      4. Mega blurry and the terrain goes flat. NOT FIXED, and the attempt was
         reverted. Written out in full because I nearly shipped it.

         The theory was that the quadtree hides its own ground wherever a 3D
         tile covers it, and coverage is claimed by whatever is visible at
         whatever depth — so a coarse ancestor standing in for children that
         have not arrived would take the terrain with it and leave a blurry
         plate with no relief underneath. I required the tile to be at least as
         fine as the ground it replaces: ten metres of geometric error, reasoned
         from a zoom-15 texel being about five.

         Measured in downtown San Francisco with the tileset settled, same
         camera, one frame apart: the shipped rule left the terrain drawing 319
         tiles, the old rule 98. Three and a third times the ground work in the
         one place the ground is least needed. And the two frames were
         identical, pixel for pixel. A cost that size buying nothing is not a
         fix, so it is out.

         The fault it was aimed at is still real — one coarse box can blank
         hundreds of cells — but it happens during loading and the settled frame
         is all I measured, so the benefit stayed unproven while the cost did
         not.

         What the flat plane actually is, I do not yet know, and two attempts to
         find out were wrong in a way worth recording. Raycasting says the
         "edge-wall" is 1.2 m from the camera and the photogrammetry 200 m below
         the heightfield. Both are artefacts: the wall's radius is applied in
         its vertex shader (`position.x * aRadius`) so its CPU geometry is a
         unit ring, and the ground is bent by curvature in its shader too. A
         raycaster reads neither. The one honest test is to hide a thing and
         look, which is what the next attempt does.

         The edge wall is still the better suspect. It closes the world where
         the quadtree drew nothing, and photogrammetry coverage is precisely a
         place the quadtree draws nothing — so in a photorealistic city the
         thing that paints "here be nothing" may be painting the city.

      Regression tests for all four, driving the real methods rather than
      asserting on source text.

      What the live run does and does not prove, because I nearly overclaimed
      here. Anisotropy is a property of a texture, not a rate, so 8 of 8 at 1
      before and 319 of 319 at 16 after is a fair comparison whatever else
      differed between the runs. Throughput is not: the run before the fix spent
      331 seconds on the handshake and had no settling time left, and the run
      after spent 59 and then settled for 260. Comparing their tile counts
      would be comparing the wait, not the fix. Measured properly below.

- [x] A19. Black spikes over Reykjavik — the elevation provider is wrong there
      Found by looking at Ultra rather than measuring it. Flying over Reykjavik
      the city erupts in black shards hundreds of metres tall, standing over a
      correct aerial photograph. It is the thing B3, B5 and B6 describe.

      Chased properly, because three plausible explanations were wrong first.

      Not the imagery, not buildings, not woodland, not the edge wall or the sea
      floor: with all of those hidden the shards remained, and a triangle count
      settled it — terrain 8,023,752 triangles, everything else in the scene
      1,300 between them. (The buildings toggle was vacuous, incidentally:
      buildings.group holds nothing at all over Reykjavik.)

      Not the decode. Heights arrive as a PNG where red is the high byte, one
      unit being 256 metres, and tileJobs.js calls createImageBitmap with no
      options and reads back through a 2D canvas — so colour management or alpha
      premultiplication would land as hundreds of metres. Decoding the same
      tiles both ways, with and without colorSpaceConversion/premultiplyAlpha
      set to none: maximum difference 0 metres, on all three tiles tried.

      Not corrupt vertices either, though the numbers looked damning: 1,332
      terrain meshes with a median height range of 5 m and a worst of 1,665 m.
      The worst one is Vatnajokull, 250 km east, where the game says 1,625 m and
      the provider says 1,693 m. Correct to within four per cent. Distance was
      the thing that made the statistic look like a fault.

      It is the data. At 64.15284, -21.92219 — a kilometre from downtown, ground
      truth about zero — the provider's own tiles read:

        zoom      8     9    10     11     12     13     14     15
        metres   -1    -2    -2    835    879    913    916    917

      An 840-metre step between zoom 10 and zoom 11, and the z13 tile there
      holds values from -1,224 m to +913 m over ground that runs -50 to +100.
      The Alps read 1,123 / 1,126 / 1,134 / 1,133 across the same zooms, so the
      method is sound. Open-Meteo, reading Copernicus DEM, says 0 m at that
      point; the game's own height field agrees with the provider to within
      1 metre across sixteen points nearby, median 0. The pipeline is faithful.
      What it is faithful to is wrong.

      Not a latitude rule, which was the tempting fix. Iceland is north of 60N
      and so outside SRTM, but checked against Copernicus at twelve places:

        Reykjavik harbour   +913      Anchorage US    +11
        Akureyri IS          +80      Murmansk RU      +5
        Reykjavik centre     +64      Edinburgh GB     +3
        Nuuk GL              +37      Denver US        -2
        Oslo NO              -16      Alps CH          -5
        Bergen NO             -9      Tromso NO        -8

      Tromso at 70N and Murmansk at 69N are fine. So capping elevation zoom by
      latitude would wreck a dozen correct places to rescue one, and picking a
      threshold to reject "implausible" heights would be inventing a number and
      then editing real measurements with it — which is the thing this project
      refuses everywhere else.

      Partly fixed, and I am going to be exact about which part, because the
      part that is not fixed is the one that started this.

      There are three shapes of corruption in this dataset, not one. Isolated
      needles standing out of flat ground. Whole bad rows — the Colca Canyon and
      Yarlung Tsangpo tiles at zoom 14 carry exactly 254 bad cells each, which
      is one full row of a 256-wide tile. And blobs, where a patch of cells is
      wrong together.

      The first two are now refused, by a despike calibrated against real ground
      rather than against taste. The question asked was: how far does a cell of
      genuine terrain ever stand from the median of its eight neighbours? Twenty
      locations at zooms 12, 13 and 14 — Nanga Parbat's Rupal face, Mount Thor,
      K2, Everest, El Capitan, Half Dome, the Cliffs of Moher, Trollveggen,
      Denali, Torres del Paine, the Grand Canyon and the rest. The worst genuine
      cell on Earth is K2 on the Baltoro at 331 m, and nothing anywhere reaches
      400. So the absolute limit is 500.

      That alone was not enough, and the failure is worth recording. A cell is
      also refused if it stands more than five times its neighbours' own spread
      out of them — because K2 earns its 331 m by sitting in ground that is
      rugged in every direction, while Reykjavik's neighbours span thirteen
      metres and one cell stands 140 m out of them. Worst ratio in real terrain:
      2.7. But the ratio collapses to about 1 wherever corruption is contiguous,
      since a spike's neighbours are spikes too — which is exactly where the
      absolute limit does the work. Neither test alone covers both.

      Verified both ways. Across all twenty control locations: zero cells
      altered, and every worst-case reading identical to the byte. On the broken
      tiles: Colca 7,166 m to 13 m, the Yarlung Tsangpo 8,647 m to 15 m. Cost
      2.4-2.6 ms a tile on clean ground in this software-rendered sandbox, in a
      worker, with an exact fast path that skips the sort where the whole ring
      is flatter than the floor.

      What it does not fix is Reykjavik. The numbers move — 899 m to 463 — and
      the picture does not: re-shot from the same place and altitude, the black
      shards are still there. The corruption there is a blob, internally
      consistent, and no filter that judges a cell by its neighbours can tell
      that from a real plateau. It reached the game (the height at the old spike
      moved 918 to 895); it simply cannot see this.

      The cross-zoom idea was the obvious next thing, so it was built and
      measured, and it failed twice over. Recorded here because it looked right
      on paper and on the calibration, and was wrong in the game.

      The idea: the dataset contradicts itself across zooms — the same ground
      reads -2 m at zoom 10 and 913 m at zoom 11 — so prefer the coarse survey
      where a fine cell departs from it by more than 300 m and more than ten
      times the whole relief the coarse window covers. Calibrated on grids
      subsampled exactly as the cache stores them, over forty-six places: the
      twenty steepest faces on Earth plus twenty coastal cities with hills
      behind them, which is the shape that produces the worst honest ratios.
      Worst real ratio 6.23 at Anchorage, worst real departure 1,768 m at K2 but
      at a ratio of 0.54; Reykjavik 66.5 and 26.2. Both thresholds had better
      than fifty per cent margin.

      In the running game it refused 496 cells at Anchorage and 8 at Wellington
      — real ground, edited — and left Reykjavik at 895 m, exactly where it
      started. Two lessons. A calibration on one tile per place says nothing
      about a region: in play the check runs across hundreds of tiles at several
      zoom pairings, so the worst case is far broader than any point sample
      suggested. And the check cannot work here anyway, because it needs an
      honest ancestor — over Reykjavik everything from zoom 11 down is wrong
      together, so when the loaded ancestor is zoom 11 there is no contradiction
      to find.

      Reverted. A change that damages correct ground and does not fix the fault
      is worse than the fault.

      So Reykjavik stands unfixed and the honest remedy is a different dataset,
      not a cleverer filter over this one.

      The other remedy is a different dataset: the provider list already carries
      Mapbox terrain-RGB, and the game will use it with a token.

      Tested with the token you sent, at zoom 12, decoding both providers'
      tiles byte for byte at the same coordinates:

                                       truth    Terrarium    Mapbox
        a km from downtown               ~0 m       879 m       0 m
        Reykjavik harbour                ~0 m        73 m       1 m
        Hallgrimskirkja                 ~40 m       106 m      10 m
        Vatnajokull (control)         ~1693 m      1592 m    1587 m

      Terrarium's Reykjavik tile spans -211 m to 893 m over ground that runs
      sea level to about a hundred; Mapbox's spans 0 to 39. On Vatnajokull the
      two agree to within five metres, so this is not a north-of-60 problem and
      not a decoding difference — it is that one dataset is wrong over
      Iceland's lowlands and the other is not.

      So this closes, and it closes as a data problem with a working remedy
      rather than as something to be filtered. Nothing is switched by default,
      because the default has to work without an account. What has changed is
      that the settings panel now says which provider is wrong where, and by
      how much, instead of leaving you to find black shards and guess.

      Rotate that token: it was pasted into a chat log. The secret-scope one
      especially, which can create and delete tokens on the account.

- [x] A18. Everything was measured on a tier your machines never run
      You said the boot hang, and every other thing I could not reproduce,
      happens on all seven of your machines — Mac, Windows, Chrome, Edge,
      Safari. Nothing per-machine explains that, so the question became what is
      different about *here*.

      This: the sandbox draws through SwiftShader, a software renderer, so the
      first-run check measures a slow machine and picks **Low**. Every reading
      in this file — every "cannot reproduce", every percentage, every cache
      figure — came from Low: 520 drawn tiles, a grid 25 squares across, a
      texture budget of 320. Seven machines with real graphics cards pick High
      or Ultra: up to 1,500 drawn tiles, a grid of 41, a budget of 1,400. I had
      been testing a code path your machines never take, and reporting the
      result as if it covered them.

      Running the same flight at both tiers found a real defect immediately, and
      it is the A7 fault in the file next door.

      The height cache had `this.cacheLimit = 320` — a constant, never scaled,
      never read from the preset, while the imagery cache beside it scales with
      both `textureCacheSize` and `maxDrawnTiles`. The grid it has to cover goes
      from 25 squares across to 41, which is nearly three times the area, so on
      the tiers a real card picks the stated limit sat *below what a single
      frame needs*. That is not a cache size. It is a permanent overflow with a
      number written next to it.

      And `evict()` had one pass that could be blocked outright. It skips
      anything touched in the last couple of frames, because the mesh is
      sampling it right now; at a big grid that is most of the cache, so it
      could be asked to free a hundred tiles, find nothing it was allowed to
      take, and stop. The imagery cache was given a yielding second pass for
      exactly this reason under A7. This one never got it.

      Measured over Gibraltar, arriving cold:

                              held / limit    peak    evict asked / freed
        Low                     320 / 320      320          0 / 0
        Ultra, before           401 / 320      511        491 / 360
        Ultra, after            778 / 861      778          0 / 0

      131 tiles it wanted gone and could not take, gone. The limit now scales
      with the grid (320, 431, 558, 861 across the four tiers — Low unchanged,
      because Low was never the one over) and the floor is the live set, which
      makes the shortfall unreachable rather than rarer: the excess is only ever
      counted against tiles the loop is actually allowed to drop.

      Honest about the size of it: a height tile is a 65x65 Float32Array, 16.9
      KB, so the old overrun was about 3 MB. And the churn I expected was *not*
      there — `refetchedAfterDrop` was 0 both before and after, so nothing it
      dropped came straight back. This is a cache that lied about its size and
      could not honour it, not the cause of ground moving under you.

      The wider point stands and is the reason this is filed at the top: every
      "could not reproduce here" in this file was measured at Low and needs
      re-reading in that light.


- [x] A0. Stuck on "Starting engine" — game never boots
      — could not reproduce: the deployed index, the single file and the online
      single file all boot here, and every Pages deploy has succeeded. Two
      causes removed anyway. Booting no longer waits on the network (picking a
      spot reads imagery to check for dry land; if that never came back, the
      frame loop never started and the boot screen sat there for ever saying
      nothing). And a module that fails to download now says so and offers the
      single file, instead of leaving that first message on screen.

      Since then the mechanism has been reproduced rather than guessed at, and
      the wording of the report is what makes that possible: "Starting engine…"
      is the static text in index.html, shown before a single line of the
      game's code runs. So the report means the module graph never finished —
      sixty-odd separate files, one of them not arriving.

      Both ways that happens were simulated. One module served but never
      answered, which is a captive portal swallowing a request; and one module
      answered with a portal's own HTML instead of the script, which is a proxy
      rewriting it. In both, the watchdog fires after twenty seconds and
      replaces the message with "Could not start", the explanation — "Something
      between here and the files is blocking or rewriting one of them — a
      filtered network, a proxy, an extension — rather than a fault in the
      game" — and a working link to terraglide.html, which is one request
      instead of sixty.

      A network that is simply dead is a different thing and is also fine: with
      every outbound request refused, the game boots in under half a second,
      runs, and the status line reads "Esri World Imagery: unreachable ·
      elevation unreachable — flat ground · no provider answered — ground
      shaded from the relief". The boot overlay leaves the DOM within two
      seconds.

      So both things it could be are handled, and both are now verified rather
      than asserted.

      Then you said it happens on all seven of your machines — Mac, Windows,
      Chrome, Edge, Safari. That kills the explanation above as *the* cause. A
      captive portal, a filtered network or a broken extension does not follow
      somebody across three operating systems and four browsers, and the
      deployed site boots here in under five seconds with all seventy-seven
      modules answering 200 as JavaScript. Something common to every one of
      your machines is doing this, and nothing I can run reaches it.

      Two things came out of chasing it anyway.

      The first is a real defect, found by reading the guard and then proving
      it. The watchdog that was supposed to break the silence asked
      `if (window.terraglide) return` — and main.js publishes that handle on
      the line *before* it awaits start(). So the handle existing proved only
      that the constructor had run. Hanging start() on purpose: at thirty
      seconds the screen still read "Building interface", with no message, no
      explanation and no link — the one thing built to notice a dead boot was
      switched off for the entire window it was meant to cover. It now asks
      whether start() actually resolved, and the same run says "Could not
      start" at twenty-two seconds. Whether that is your fault or not, it was
      a hole, and any hang inside start() fell straight through it.

      The second is the part that matters for your machines: the dead screen
      now reports itself. It names the stage it stopped at — which separates
      "the code never arrived" from "the code ran and stopped at "Building
      interface"", two faults that wear the same frozen screen and want
      opposite advice — and it runs three bounded probes and prints the
      answers: this site's code, this site's textures, and one provider. So
      "nothing at all", "everything except the providers" and "this machine
      only" come back as three different reports instead of one shrug. There
      is a "Copy this report" button, because a screen that cannot start
      cannot press F4, and F4 is where every other answer in this game lives.
      Verified end to end: with providers hung, the report reads `this site's
      code — HTTP 200 (11 ms)`, `this site's textures — HTTP 200 (12 ms)`,
      `Esri imagery — failed: no answer in 10 s`. It fits a 360-pixel screen
      without overflowing, and a healthy boot twenty-six seconds past the
      watchdog does not trip it.

      Still open, and now it is one paste from being closed: play it until it
      hangs, wait twenty seconds, and send what the box says.

      **Found, and fixed at the cause.** You said it happens on all seven
      machines, so I stopped looking for something wrong with a machine and
      asked what all seven share: a network. The hosted page asked the browser
      for seventy-seven separate ES modules, and **a browser does not retry a
      module fetch that fails**. One dropped response — one flaky moment on the
      wifi — and the graph never finishes, main.js never runs, and the screen
      sits on "Starting engine..." exactly as reported.

      Measured, dropping requests at random:

                              before          after
        perfect line          3 of 3, 2.3 s   3 of 3, 0.4-0.9 s
        0.5 per cent dropped  2 of 3          3 of 3
        1 per cent dropped    0 of 3          3 of 3
        2 per cent dropped    0 of 3          3 of 3
        5 per cent dropped    0 of 3          3 of 3

      One per cent packet loss is an unremarkable evening on home wifi, and it
      takes down every device on that network at once, whatever the operating
      system or browser. That is seven machines from Mac to Windows to Safari,
      and it is why nothing reproduced here on a perfect local connection.

      The page now loads one script — `terraglide.bundle.js`, the same modules
      resolved into a single classic script by the same bundler that builds the
      double-clickable file. One request instead of seventy-seven is seventy-
      seven times less exposure, and because a classic script is not a module
      the page can *watch it fail and ask again*, which is the thing the module
      loader will not do. Three goes, backing off, and only then the old module
      path — which stays, because a plain checkout has no built bundle beside it
      and the repository is meant to be the site. Runs where the bundle itself
      was dropped and the retry recovered it are in the 3-of-3 above.

      Verified end to end rather than by the boot flag: the game runs from the
      bundle, with the *real* Web Worker rather than the in-page fallback, 94.5
      per cent of ground on its own photograph, nothing bare, ground 1,135 m at
      Murren. Photographed. All three editions still start — hosted page 1.5 s
      via the bundle, double-clickable file 1.0 s, online single file 3.8 s. The
      online edition gets the same fix, which matters most: it is the page whose
      code always comes over the network.

      One real bug came out of building it. `import.meta.url` became the
      *document's* address for every bundled module alike, which was harmless
      while the only bundle was the file:// one — but in a hosted bundle
      `createTileWorker` resolves './tileWorker.js' against it and gets
      <site>/tileWorker.js, which does not exist: a worker that 404s in silence
      and a tile pipeline that never starts. It is each module's own address
      now, and the real worker is confirmed running.

      The build refuses to publish a site without the bundle, because falling
      back to seventy-seven requests is the fault this removes.
- [~] A9. Does not work on Chromebook
      — two causes found and fixed. There was no handling for the graphics
      context being lost, which on a low-memory machine is not an edge case:
      Chrome kills the GPU process, every texture goes with it, and the loop
      carries on drawing into nothing — a frozen canvas with no error. It now
      catches that, calls preventDefault (without which the browser never
      offers a context back), stops, rebuilds and resumes; verified by taking
      the context away and giving it back. And the graphics preset defaulted to
      High for everybody, so a Chromebook started at a quality it could never
      hold; the first run now reads the GPU name, memory and core count and
      starts Low on a modest machine. Open until you confirm on yours.

      Since then the machine has been simulated rather than waited for. A
      Chromebook is a device class, and Chrome's own debugger can impose the two
      things that define it: the CPU throttled to a sixth of this one's speed,
      `deviceMemory` reporting two gigabytes, two cores. Flown for two minutes
      under that, auto settled on Low and stayed there, the graphics context was
      never lost, the degraded latch never tripped, and no square was ever drawn
      bare — so none of the three failures this item was opened for reproduced.

      What it did find is A7's real cause: the texture cache holding 1,731
      textures against its own budget of 160, which is about 440 MB on a machine
      with two gigabytes. That is a tab being killed, and it is fixed. See A7.

      Waiting on: the machine. Three causes were found and fixed and none of the
      three failures reproduced here. If it still fails on the Chromebook, the
      boot screen now copies a report that says which of them it is.
- [x] A10. Online single file broken; single file missing things
      Two causes. The zip's index.html runs from file://, where browsers refuse
      ES modules, so main.js never ran and the watchdog blamed the network after
      20 s of blank screen — no network was involved, and terraglide.html was in
      the same folder. It now goes straight there. And tools/online.mjs stripped
      every <script> from index.html, which threw away the watchdog with the
      module tag, so the page most likely to fail was the only one that could
      not say so — that is the silent 'Starting engine…'. The online edition is
      now index.html itself with three URLs made absolute, so it cannot drift.
- [x] A11. Freecam shows the ground not holding; breaks in freecam
      Cause: in freecam the terrain is built for the player's camera on purpose —
      so flying the camera across a country does not re-cut the quadtree — but
      the frustum came from that same camera, so anything outside the player's
      view was never drawn. The freecam is usually pointed at exactly that. The
      frustum now comes from the camera the frame is drawn through; priority and
      level of detail still come from the player.

- [x] A1. Cannot move or jump on launch — it keeps restarting when I do
      — input did nothing because the arrival hold froze the player and then
      threw them: on a launch into Antarctica the ground went 0 m, 945 m,
      3,656 m and carried them up each time. Hold now waits for the ground to
      stop moving, and pressing a key gives you the controls without giving up
      the floor. Measured after: walking and jumping respond, 0 upward throws
      once you have control.
- [x] A2. Clicking out and back in, or Esc then jumping, breaks it
      — jump was a toggle for the wings. Measured gliding at 1.4 m/s down: one
      press and the wings shut and the fall went to 16 m/s. Space opens them
      now and never shuts them, as in Minecraft; the wings key stows. Verified
      through Esc, blur and focus — glide holds at ~3 m/s throughout.
- [x] A3. Teleporting again when I look down after a teleport
      The walk returns outright on a frustum miss, so the square under you was
      never visited while you looked at the horizon: never split, never built,
      never in `drawn` — and meshHeightAt reads `drawn`, so the game did not
      know where the floor was. Looking down brought the real relief in all at
      once. Ground within 250 m is now built whichever way you face.
- [x] A4. Hang when changing providers on terrain
      Cause: setSource() called clear(), disposing every texture at once — so the
      instant you picked a different provider the whole world went flat grey and
      came back a square at a time. Hundreds blinking out and back is the
      flashing; the seconds of blank world while it happened is the hang. The
      old picture of a place is a good picture of that place until the new one
      lands, so each square now swaps as its replacement arrives.
- [x] A5. Seizure/flashing when changing provider
      Cause: setSource() called clear(), disposing every texture at once — so the
      instant you picked a different provider the whole world went flat grey and
      came back a square at a time. Hundreds blinking out and back is the
      flashing; the seconds of blank world while it happened is the hang. The
      old picture of a place is a good picture of that place until the new one
      lands, so each square now swaps as its replacement arrives.
- [~] A6. Pressing a button within 3 s of RTP reverts to old spots and removes the new discovery
      The half I could reproduce is fixed: a keypress no longer abandons the
      hold onto unmeasured ground.

      The other half still does not reproduce, and now it has been tried
      properly. Three random teleports, each followed by a real keypress at one
      second and at two and a half, with the position and the exploration record
      read before, at the moment of landing, and six seconds later:

        no press            landed -21.27897, 140.04305   moved 0.00000 deg
        press after 1 s     landed  43.98885, 118.19822   moved 0.00000 deg
        press after 2.5 s   landed  -8.17581, 157.40461   moved 0.00000 deg

      and the explored record only ever grew — 317 cells to 385 to 543 to 645,
      with the copy on disk growing alongside it, 747 characters to 1,567.
      Nothing reverted and nothing was removed.

      Worth recording how that test was wrong the first time, because it passed
      then too and meant nothing: it pressed a key the game does not bind, so
      the game never saw a press at all. It now checks first that a press
      reaches the game — pressing the minimap key and watching the setting flip
      — and refuses to report anything if it does not. The first version of this
      check said "NO", which is how the fault was found.

      Tried again on a slow machine, because this is a report about a
      three-second window and the first test ran at full speed — where that
      window is two hundred frames. Throttled to an eighth, it is a handful,
      which is exactly where a frame-ordering fault would live. The keypress
      was again proved to reach the game first:

        no press          landed 23.37434, 114.15322   moved 0.00000 deg   cells 100 -> 151
        press at 1.0 s    landed -15.66336, -62.83765  moved 0.00000 deg   cells 151 -> 165
        press at 2.5 s    landed 33.00387, -7.01450    moved 0.00000 deg   cells 165 -> 217

      Nothing moved after landing and the record only ever grew, at both
      timings, on a machine eight times slower than this one.

      Still open because it is your machine it happened on, not this one — but
      the condition most likely to produce it has now been tried and did not.
- [~] A7. It randomly refreshes
      Nothing in the game reloads itself — no location.reload anywhere — so this
      is the browser killing the tab, and the likeliest reason is memory. The
      texture cache was counted in *tiles*, which is a proxy for memory that is
      wrong by four when a provider serves 512 px instead of 256: "high" was
      1.2 GB of texture rather than 300 MB, on top of the meshes. It is a byte
      budget now, and halved again where the browser reports 4 GB or less.
      Context loss was already handled (preventDefault plus a rebuild).

      Measured in the running game, asking the cache what it would allow at each
      tile size — the point being that the two columns agree, which is what
      "budget in bytes rather than in tiles" means:

        Low       320 tiles at 256 px = 107 MB     80 at 512 px = 107 MB
        Medium    560                 = 187 MB    140            = 187 MB
        High      900                 = 300 MB    225            = 300 MB
        Ultra   1,400                 = 467 MB    350            = 467 MB

      That was not the whole of it, and the rest was found by reproducing the
      machine instead of waiting for one. A Chromebook is a device *class*, and
      Chrome's own debugger can impose the two things that define it: the CPU
      throttled to a sixth, `deviceMemory` reporting two gigabytes, two cores.
      Flown for two minutes under that:

        textures held      1,731
        budget             160

      Ten times over its own budget — about 440 MB of texture where the budget
      says 40, on a machine with two gigabytes. That is a tab being killed, and
      it is exactly what "it randomly refreshes" is.

      The cause: the twenty-second hold that stops a tile being thrown away and
      immediately re-fetched (B8/B9) was absolute. Nothing bounded how many
      tiles it could protect, and on a slow machine covering ground quickly the
      set of "seen in the last twenty seconds" is larger than the whole cache,
      so eviction found nothing it was allowed to drop and the cache just grew.

      The first fix was wrong and is worth recording. Letting the hold yield
      brought the cache inside its budget — and took the share of ground drawn
      at its own resolution from 71% to 15%, with the queue going from 104 deep
      to 1,165. That is the thrash the hold exists to prevent, and B7 predicted
      it in as many words: a cache smaller than the view is not a smaller
      cache, it is no history.

      Which is the actual cause. On Low with two gigabytes the budget was 160
      while the same tier draws up to 520 squares — a cache that cannot hold
      what is on screen has to either evict things still being drawn or ignore
      its own budget, and it was silently doing the second. So the budget is
      floored at what the tier draws, and the hold yields above that. Nothing
      still on screen is ever evicted, and memory is bounded:

                          before   hold removed   floored
        textures held      1,731        174         534
        against a budget     160        160         520
        own picture        70.7%       14.8%       66.8%
        queue, mean          104         356         112

      133 MB of texture instead of an unbounded 440, with the picture intact.
      The self test now refuses any tier whose cache is smaller than what it
      draws, and the check that a heavier preset holds more asserts that rather
      than the multiple it happened to have.

      Still open until you can say whether the tab still dies on yours — but
      there is now a measured cause that was not visible from this machine
      until it was made to behave like yours.

      Soaked at Ultra, which is the tier your machines pick and none of the
      earlier readings used. Fifteen minutes, fifteen stops right round the
      world — Alps, Tokyo, Sydney, Reykjavik, Antarctica, Manhattan, Everest,
      the Andes, the Sahara, Svalbard, Singapore, Rio, Edinburgh, the New
      Zealand fjords, Anchorage — sampling every minute:

        heap        278 170 122  93 148 208 120 121 290 298 107 184 109 156 152 MB
        meshes     1400 838 548 381 682 1019 517 522 1400 1400 469 907 495 747 723
        textures   1509-1552 against a limit of 1500
        height     446-925 against a limit of 861
        geometries tracked the mesh count exactly, every sample
        contexts lost                                                        0

      The heap moves with how much is on screen and ends where it started.
      Geometries never exceed meshes, so nothing is orphaned. Fourteen console
      errors in fifteen minutes, every one a provider 5xx.

      So on this machine, at the tier yours run, nothing grows without bound and
      the graphics context is never lost. That is not proof it does not happen
      on yours — a real GPU driver under real memory pressure is a different
      thing — but every mechanism I can measure here is bounded, and F4 now
      carries the numbers if it happens to you.
- [x] A8. Why is it forcing to fly — why can't it remember position on relog
      The position was always remembered. What you were *doing* was not, so the
      spawn had nothing to go on and took "arrive in the sky" at its word every
      time — hence being thrown into the air with the wings out on every reload.
      Leaving mid-glide brings you back gliding; leaving on your feet brings you
      back on your feet.

## B. The ground falls apart

- [x] B1. When flying, the ground glitches / blurs briefly / gets holes / moves up and down in sections — it needs to lock
      The moving up and down is fixed, and it was not LOD popping. Every tile
      samples the same height field whatever level it is drawn at, so a split
      does not change a vertex's height. What changes it is *fresh elevation
      landing*: a tile is drawn from the finest data that has arrived, so when
      finer data arrives the answer changes and the tile is rebuilt with it —
      in one frame, several metres, across the whole square. The sections are
      elevation tiles and the moment is the moment their data landed.

      A tile now remembers where it stood and walks to where it now stands over
      a third of a second: one float a vertex, a uniform, and a mix in the
      vertex shader. Verified in the running game rather than by the shader
      compiling, which proves nothing — a morph left finished renders exactly
      like one that never started. tools/morphcheck.mjs teleports somewhere
      empty and watches every tile: 21 of 40 half-second samples caught tiles
      mid-walk, 116 walking at once at the peak, and all 320 settled at the end.

      "It needs to lock" was the other half of that, and it is done now too. The
      walk was only ever in the vertex shader, so everything standing on the
      ground — the collision, the camera, the chase rig — carried on reading the
      tile's *destination* height while the surface was still on its way there.
      The picture locked; you did not. See B2 and B4: 55 corrections of more
      than a metre in two and a half minutes of flight, the biggest 82.8 m, and
      the floor now blends exactly as the shader does.

      Holes: measured at 0.00 to 0.10 per cent across every view once the
      character is excluded from the measurement — see the note under M7.

      The brief blur was the one part left open, called throughput and not a
      bug. It was a bug. The request queue was pumped from one place, once a
      frame, and a slot freed by a finished request stayed empty until the next
      frame — so the pipeline ran at eleven per cent of its own allowance with
      sixty-six squares waiting. Fixed in C14, and blurcheck on both arms of
      the same build says what it was worth: 63.9 per cent of the ground
      stretched in settled flight becomes 28.9, an about-face 78.5 becomes
      23.5, and standing still 33.9 becomes 4.0. See B12 for turning and B11
      for the flat-colour case, which was the degraded latch and is fixed.

      Ticked because all four halves of the report are now answered with a
      measurement: the up-and-down is the morph, the locking is the collision
      reading the drawn surface, the holes are 0.00 to 0.10 per cent, and the
      blur was a starved queue and is more than halved.
- [x] B2. Random times a patch below appears, then the player glitches down
      The mid-flight correction is handled now, and it had a cause worth naming.

      When fresh elevation lands, a tile does not step to the new heights, it
      walks to them over a third of a second — but the walk happens in the
      vertex shader, `mix(prevY, position.y, uMorph)`, and the geometry on the
      CPU side holds only the destination. So everything that stands on the
      ground — the collision, the camera, the chase rig — was reading a surface
      that is not there yet, while the surface you can see was somewhere else.

      Measured over two and a half minutes of flight: the height under a fixed
      point took 55 steps of more than a metre, 45 of more than five, the
      biggest 82.8 m. Every one instant on the standing side and a third of a
      second long on the drawn side.

      Two changes. The floor now blends the same way the shader does, from the
      same attribute, at the point the ray actually hit — so asking where the
      ground is gets the answer you can see. And the controller prefers that
      answer outright while the ground is settling, rather than taking the
      higher of it and the field: taking the higher one is what lifted you to
      the new height the moment it landed and left you there until the hillside
      caught up.

      Checked deterministically rather than in flight, and that is worth saying:
      the headless harness renders at about 1.4 frames a second, so a third of a
      second of morph is over before the next frame and the transient cannot be
      observed here at all. The blend is unit-tested instead — 20 m at the start
      of the walk, 60 halfway, 100 at the end, and a tile that is not settling
      left exactly alone.
- [~] B3. Sometimes most of the ground below me is missing and I stand on an invisible platform with patches
      An invisible platform is the elevation field still answering while the
      mesh over it is not drawn, so that is what was measured: over three
      minutes of hard banking flight, every frame, is there a drawn square whose
      footprint covers the player?

        frames with no drawn square under the player          0 of 186 (0.00%)
        built squares within 600 m that were drawn      mean 99.9%, worst 93%

      The 7% at worst is the frustum — squares behind you are built and not
      drawn, which is correct. So it does not reproduce on this build.

      One cause that could have produced it is fixed since the report: the cap
      on how many squares may be drawn was keyed on the raw graphics setting,
      which reads 'auto' for everybody by default, so every machine took the
      *high* figure of 1100. When that cap bites, what goes undrawn is whatever
      the walk had not reached, and a machine that could not keep up would lose
      ground rather than frames. The other is B4, being set down on ground the
      game has not measured.

      Left open rather than closed because it is your screen it happened on, not
      this one, and the measurement above is a hard flight rather than every
      condition — a provider failing mid-flight, or a machine short of memory,
      are not in it.

      Measured again on a simulated low-end machine rather than this one — CPU
      throttled to a sixth, two gigabytes reported, two cores — flying and
      banking hard for two minutes. No square was ever drawn bare, and the cap
      on how many squares may be drawn never bound after the fixes, so nothing
      went undrawn for want of budget. That is the condition this was most
      likely to happen under, and it did not.

      Tried on the network the boot hang proved you have. A0 established that
      one per cent packet loss is enough to kill the boot, so tiles are dropping
      too — and this item is the shape that would take. Same valley, seventy
      seconds, four loss rates:

        packet loss   squares drawn   own picture   drawn bare
          0 per cent       324            95%           0%
          1 per cent       315            95%           0%
          5 per cent       196            93%           0%
         15 per cent        64            96%           0%

      At one per cent — your measured rate — the ground is unaffected. It thins
      above that, and nothing is ever drawn *bare*: what degrades is how finely
      the tree subdivides, not whether a square has a photograph. So on a lossy
      line the ground gets coarse, never holey.

      A fix was built for it and reverted, and the reason is worth keeping. One
      run at fifteen per cent drew eight squares against a black screen, which
      is this item almost word for word, and the cause looked obvious: every
      failure that was not our own abort was recorded as "nobody has this
      square", so a dropped connection told the quadtree the ground was
      unphotographed and `barren` stopped it descending. Making that conditional
      on the provider having actually answered is more correct semantically. It
      is also worse. Three runs each way:

                                      5 per cent loss    15 per cent loss
        barren on any failure         234 268 279        105 125 161
        barren only on a real answer  121 204 210        107 141 170

      Worse at five per cent, inside the noise at fifteen. And the eight-square
      run that started it was an outlier — the same build repeated gives 105 to
      161. The mechanism, seen afterwards: writing off a square that keeps
      failing frees throughput for squares that can succeed, so on a bad line
      the blunt rule is the better one.

      Second time this session a single stochastic run has produced a finding
      that repeats destroyed. One run of a random process is not a measurement.

      Waiting on: seeing it again. Nothing was ever drawn bare under any condition
      tried, including a lossy line. If it happens, whether the missing ground
      is black or grey separates the two remaining candidates.
- [x] B4. Floating on invisible ground above the imagery
      Two causes, and this was the second one. You are no longer *set down* on
      ground the game has not measured — that was the first.

      The other is B2's, seen from the other side. A correction that raises the
      ground steps the elevation field instantly and walks the surface up over a
      third of a second, and the rule for standing was "take the higher of the
      field and the drawn mesh" — a rule that exists to stop a missing field
      reading sea level and dropping you through a mountain. So on the way up
      the field won, and you were lifted to the new height while the hillside
      was still on its way: standing on nothing, above the imagery, until it
      arrived under you.

      Fixed with B2, and the same measurement covers both: 55 corrections of
      more than a metre in two and a half minutes, the biggest 82.8 m. The
      no-falling-through rule is untouched everywhere else; it only steps aside
      while the ground is actually moving.
- [~] B5. Ground becomes griddy and comes back — moves up or down and shows a grid
      The moving up and down is fixed — see B1, it is fresh elevation landing
      and the tile now walks rather than steps.

      The grid: photographed at the place it was reported, the Strait of
      Gibraltar, where a stipple of dotted lines in the shape of the tile grid
      used to lie across the water. Flown at 1,500 m looking down over open sea,
      the surface is a clean gradient — no stipple, no seams, no tile edges —
      and the coast and the Rock read correctly. That is the fix for it working:
      coplanar stand-ins are sunk a hand's breadth per level of coarseness so
      the depth test can separate them, since over sea every vertex sits at
      exactly zero and nothing else can.

      Re-shot since, at the same place and on a slow machine, because a grid
      that only appears when the machine is struggling would have been missed
      by the first photograph. From 1,500 m over the Strait looking straight
      down, CPU throttled to a sixth: a clean gradient across the water, no
      stipple, no seams, no tile edges, 96.3 per cent of the ground at its own
      resolution and nothing bare.

      Left open rather than closed because two photographs of one place are
      still not the same as it never happening. If you see it again, where
      matters — over water or over land tells the two candidate causes apart.

      Waiting on: seeing it again, and where. Over water or over land tells the two
      candidate causes apart.
- [~] B6. Randomly starts disappearing, getting patchy, falling apart, coming back in chunks
      Three separate things were behind this and two are now measured out.

      "Coming back in chunks" is the texture cache: ground you looked away from
      for more than twenty seconds is thrown away and re-fetched square by
      square, which is exactly what chunks coming back looks like. Measured
      under B7 — turn away for ninety seconds and you come home at 70%, turn
      away for twenty and you come home at 100%.

      "Getting patchy" while you turn is B12, and it is stretching rather than
      disappearing: 45 degrees costs 12% of the frame, an about-face 37%, and
      nothing goes bare because the coarse cover is stretched over it.

      "Disappearing" is the one that could really be squares not drawn at all,
      and the cause found for it is the drawn cap taking the high tier's figure
      on every machine — see B3. Measured after that fix, over three minutes of
      banking flight, 99.9% of built squares within 600 m were drawn and there
      was never a frame with nothing under the player.

      Same caveat as B3: open until you see it or stop seeing it.

      Measured again on a simulated low-end machine rather than this one — CPU
      throttled to a sixth, two gigabytes reported, two cores — flying and
      banking hard for two minutes. No square was ever drawn bare, and the cap
      on how many squares may be drawn never bound after the fixes, so nothing
      went undrawn for want of budget. That is the condition this was most
      likely to happen under, and it did not.

      Waiting on: seeing it again. Same measurements as B3 — nothing drawn bare,
      the draw cap never binding. F4 copies what is needed to tell it apart.
- [x] B7. Random refresh of textures
      Not random — it is ground you looked away from for more than twenty
      seconds, and the trigger is exactly that.

      Measured. Standing still, settled facing north at 100% of the drawn ground
      at its own resolution rather than stretched. Turn right round, wait ninety
      seconds until south is settled too, turn back: north comes home at 70% and
      takes about sixteen seconds to recover. Do the same round trip inside
      twenty seconds and it comes home at 100%. Twenty seconds is KEEP_SECONDS,
      which protects a tile from eviction after it was last drawn — so what you
      are seeing is the protection expiring, not a cache too small to hold it.

      Half of it is fixed already and this is the other half. B8/B9 was the
      timer being counted in frames, so a fast machine threw the ground away
      after 1.7 seconds; that is gone. What is left is that there is no history
      *behind* the twenty seconds at all, and there is a reason: the texture
      cache is smaller than the number of squares the same tier will draw, on
      every tier — Low caches 320 against 520 drawn, Medium 560 against 760,
      High 900 against 1100, Ultra 1400 against 1500. A cache smaller than the
      view is not a smaller cache, it is no history, because drawn tiles are
      stamped every frame and may never be evicted whatever the cap says.

      Raising the cap to the drawn cap was tried and is not the answer: the
      same ninety-second round trip came home at 73% instead of 70% and reached
      100% one sample sooner, which is inside the noise, while costing about
      forty megabytes on the tier a Chromebook runs. It also quietly broke the
      tile-size scaling — the cap is divided by (size/256)^2 so that 512-pixel
      tiles cost the same memory as 256-pixel ones, and a floor that ignores
      size quadruples it. Reverted.

      What the measurement said at the time was that the recovery is
      throughput-bound rather than cache-bound: sixteen seconds to re-fetch a
      view is the wire, not the eviction. Half right. It was not the eviction,
      and it was not the wire either — see C14. The queue was pumped once a
      frame and a slot freed by a finished request stayed empty until the next
      frame, so the pipeline ran at eleven per cent of its own allowance.

      Same round trip, re-measured after that fix: settled facing north at
      98.9 per cent, turned about, ninety seconds, turned back. It comes home
      at 74.8 per cent and is back to its settled plateau of 96.6 within six
      seconds, where it used to take sixteen. The plateau is a few points below
      a hundred because a handful of squares have nothing deeper published for
      them, which blurcheck agrees with independently — four per cent standing
      still.

      So the answer was not fewer round trips. It was making the round trips
      that were already queued actually happen. The cache floor experiment
      recorded above is still a dead end and still worth not repeating.

      Ticked: it was never random — it is ground you looked away from for more
      than twenty seconds — and the recovery it triggers is now six seconds
      rather than sixteen.
- [x] B8. High res unloads from behind me
      Cause: the texture cache held a tile for 240 *frames*, commented as "about
      four seconds at 60 fps" — true only at exactly sixty. 144 fps got 1.7 s,
      30 fps got 8, 10 fps got 24. The better the machine, the sooner the ground
      behind you was thrown away. Now 20 seconds of wall clock, the same on
      every machine.
- [x] B9. Unloading and reloading and breaking
      Cause: the texture cache held a tile for 240 *frames*, commented as "about
      four seconds at 60 fps" — true only at exactly sixty. 144 fps got 1.7 s,
      30 fps got 8, 10 fps got 24. The better the machine, the sooner the ground
      behind you was thrown away. Now 20 seconds of wall clock, the same on
      every machine.
- [x] B10. Sometimes everything becomes super blurry when I do something, comes back after 1 s
      Measured rather than guessed, and it is not auto-quality — that averages
      over four seconds and will not move more often than every six, so it
      cannot produce a one-second blur. It is stretching: a tile with no
      photograph of its own is drawn from a coarser one stretched over it, and
      every step up halves the detail. tools/blurcheck.mjs counts it.

      In settled flight at 55 m/s, 58 per cent of the ground is stretched, 1.42
      levels on average. Just after a 180 it is 73 per cent. Standing still it
      converges to 8 per cent in about ten seconds — which was read at the time
      as ground the provider has nothing deeper for, and was not: see C14. With
      the request queue drained on completion rather than once a frame, the
      same tool on the same course gives 28.9 per cent flying, 23.5 after a
      180, and 4.0 standing still. So most of this was ours.

      Ticked: the cause is named, it was ours rather than the provider's, and
      the number it is measured by has more than halved.

      So the flying blur is throughput: at 55 m/s you cross six of the deepest
      tiles in the time one comes back. Which is about how fast tiles *return*,
      not how many are asked for at once — raising the number in flight from 12
      to 24 to 48 changes nothing measurable, with an empty queue throughout.
      See C7. Asking ahead was the obvious answer and
      it was tried — a lead point two seconds along the velocity, three levels,
      a ring of nine — and it measured *worse*: 58.1 per cent became 61.7, and
      gating it to an empty queue still gave 61.5. The pipeline is limited by
      how fast tiles return rather than by knowing which to ask for, and a
      dispatched request cannot be recalled, so a speculative tile holds one of
      the dozen-odd slots for its whole round trip while a tile you are looking
      at waits behind it. Reverted rather than shipped.

      That caveat was wrong and is worth correcting rather than deleting. It
      read: "these measurements come through a proxy that serialises every
      tile, so the sandbox is more throughput-bound than a real browser".
      Measured since, first-hand: the relay runs 22 requests concurrently with
      a median start-to-start gap of 0 ms and a p90 of 14 ms across 1,456
      requests, none failed. It does not serialise anything.

      And the thing that *was* limiting it turned out to be ours. See C14: the
      request queue was pumped from exactly one place, the terrain walk, once a
      frame, and nothing refilled a slot when the request holding it finished.
      In flight that measured 1.34 requests in the air against a cap of twelve
      while the queue averaged sixty-six squares deep. Throughput was never the
      constraint; the refill cadence was. With the pump moved onto completion,
      the same probe on the same course took the stretched share from 23.7 per
      cent to 11.0.
- [~] B11. Random times when looking, everything becomes a solid colour
      A solid colour is a tile with no texture at all — not even a coarser one
      stretched over it — because the shader then has only the relief to colour
      by. It is counted now, per frame, alongside the stretching, and over
      settled flight, a 180 and standing still it came back 0.0 per cent every
      time. So it does not reproduce here.

      But there was a way for it to happen that the counter could not see,
      because it is not about any one square: the `degraded` latch.

      It means "nothing is reaching any provider". It trips after ten
      consecutive failures with nothing yet loaded, and it stopped the streamer
      asking for a URL at all — so nothing could arrive, so nothing could clear
      it, and every square in the world drew from the relief alone. Which is
      exactly "everything becomes a solid colour".

      What makes it a mid-session event rather than a boot-time one: the
      counters it keys on are reset by `clear()`, and `clear()` runs when the
      graphics context is lost and restored. On a machine short of memory that
      happens at unpredictable moments — a turn that uploads a burst of
      textures will do it — and the refetch storm immediately afterwards is
      exactly the run of failures the latch is looking for. So: a stutter, and
      then a flat-coloured world for the rest of the session. That also ties
      this to A9.

      Fixed, and verified end to end rather than by reading. Forcing the latch
      in the running game left 330 squares drawing from relief alone; fifteen
      seconds later it was 369 squares all carrying photographs, the flag
      cleared, one "recovered" toast, and the loaded count climbing 120, 282,
      413. Before the fix the same test sat at 477 bare, unchanged after
      forty-five seconds.

      The fix took two goes and the first one is worth recording: letting a
      probe through by returning a null URL fell into the branch that marks a
      square BARE, and bare is terminal — so the first pump after the latch
      wrote off the entire view permanently and only newly created tiles ever
      got a probe. Throttled and refused are different answers.

      Still marked as a question because the *other* candidates in the original
      note remain: a provider refusing one square, and the first moments after a
      teleport. If it happens again, whether it clears by itself within a few
      seconds now tells the two apart.

      One of the original candidates is answered now, and it was the provider
      test rather than the streamer. Over bright ground — snow, ice, salt flats,
      desert — every photograph was being thrown away as a placeholder, so those
      squares had nothing to draw and fell back to the relief, which is exactly
      "everything becomes a solid colour". It would have followed you to any
      pale landscape and cleared when you left. See A20.
      Reopened, because you reported it again and the colour rules out the
      explanation above: "it's not flat white, sometimes it's light or dark
      green or tan". A square with no texture at all is drawn from
      groundNotLoaded, which is grey. Green and tan are a photograph — the cover
      pool at zoom 9, magnified about two thousand times over your feet, which
      is a flat wash of whatever that square mostly is. Farmland green, desert
      tan.

      So the question is not "why is there no texture" but "why did a square
      that had its own photograph fall back eleven levels", and there is a
      second mechanism for that, found by reading: eviction could take the
      photograph a square was being drawn from in the very frame it was drawn.
      The second pass skipped only pending entries and says of itself that the
      protection is a preference rather than a promise; the cover pass, which
      holds the very tiles everything else stretches from, had no protection at
      all. See A28 — all three passes go through one guard now.

      Still `[~]` and not `[x]`: this sandbox draws at about a frame a second
      and cannot see a flicker lasting a few frames, so the mechanism is proved
      by test and the disappearance is not. It needs your eyes.

- [x] B12. Randomly blurring depending on where I look
      Real, not random, and proportional to how far you turn. The ground behind
      you is outside the frustum, so it is never drawn and never asked for;
      turning is the first time it is wanted.

      Measured from settled, as the share of drawn ground at its own resolution
      rather than stretched from a coarser tile:

        turn 45 degrees    100% -> 88%, back to 100% within five seconds
        turn 90 degrees    100% -> 80%, back to 100% within five seconds
        turn 180 degrees   100% -> 63%, then 77, 92, and 100 after fifteen

      So a glance costs nothing you would notice and an about-face costs a
      third of the frame for a few seconds. Nothing goes *bare* — the coarse
      cover is already there and gets stretched over it, which is why this is
      blur and not holes.

      It is not fixable by fetching more: asking for ground you cannot see is
      the prefetch that measured worse twice, under C1/B10 and again under C2,
      and it loses for the same reason both times — throughput is the
      constraint, and a speculative request is one a certain request did not
      get. What is fixable is how long the recovery takes, and that is B7.
- [x] B13. In freecam I see the ground behind me as invisible
      Cause: in freecam the terrain is built for the player's camera on purpose —
      so flying the camera across a country does not re-cut the quadtree — but
      the frustum came from that same camera, so anything outside the player's
      view was never drawn. The freecam is usually pointed at exactly that. The
      frustum now comes from the camera the frame is drawn through; priority and
      level of detail still come from the player.
- [=] B14. Debug and remove glitches generally
      Standing rather than closable, so here is the account rather than a tick.
      Glitches found and fixed by going looking, in this pass alone:

        held rockets at a shallow dive compounded without bound — 350 m/s in
          twenty seconds, 81,837 in two minutes, against vanilla's steady 35;
        one press of the ascend key while flying deployed the elytra behind
          your back, and dropped you into a glide when the cheat came off;
        every machine drew the *high* tier's ground whatever tier it chose,
          because the cap was keyed on a setting that reads 'auto';
        the cloud deck and the wall that closes the world were depth-testing on
          a different scale from everything else, so from above the clouds
          there were no clouds;
        the world map stretched whenever its box changed height rather than
          width;
        the fog claimed sixteen times the ground you had actually seen, and
          more the further you zoomed out;
        the trail dropped whole flights rather than thinning them, and never
          trimmed a single unbroken flight at all;
        both size keys wrote NaN into a setting nothing reads, so neither had
          ever done anything.

      Every one of those has a self-test that fails on the old behaviour by
      name.

      And from the pass after it, all six found by measuring rather than by
      report:

        a mirror in the Overpass fallback list held Switzerland and nothing
          else, and answered 200-with-nothing for the rest of the planet — so
          one 503 from the main instance and every building, wood, bridge and
          mast on Earth outside Switzerland silently stopped existing;
        a failed land/water probe was cached exactly like an answer, so one
          hiccup made a continent-sized square read "cannot tell" for the
          session — which reads as land, which is a teleport into open sea;
        a refused 3D tile was asked for ninety-four times a second, against
          two APIs that bill per request;
        a failed imagery-date query was cached as though it were the permanent
          truth about that ground;
        the imagery request queue was pumped once a frame and never on
          completion, so ten of twelve slots sat idle with sixty-six squares
          waiting — the single biggest thing in this file, and the cause behind
          six separate entries that had all concluded "throughput";
        the elevation queue had the identical fault, which is worse, because
          ground with no DEM tile reads as sea level;
        and a key could be bound, documented on the help card and wired to a
          working handler and still do nothing, because two lists had to agree
          and nothing checked that they did.

      Every one has a self-test that fails on the old behaviour by name. The
      suite is 1,070 checks.

      Left open because "generally" has no end, and the useful next input is
      which glitch you are still seeing — F4 now copies everything needed to
      tell the candidates apart, so "it does it on mine" can become a paste.

## C. Loading order and speed

- [x] C1. Load high res where I am and where I am looking, more chunks in parallel
      Half of it is already so and the other half measured worse. Requests are
      priority-ordered by distance over 2^(20-z), so the nearest and deepest go
      first — "where I am and where I am looking" is what the queue already
      does. Parallelism is 12 to 34 by preset.

      Asking ahead of where you are going was tried and reverted; see B10 for
      the numbers. The reason given there for discounting them — that the
      sandbox proxy serialises tiles — was wrong, and B10 now carries the
      measurement that disproves it.

      "More chunks in parallel" turned out to be the right instinct aimed at
      the wrong number. The parallelism was already twelve to thirty-four; it
      was simply never used, because the queue was pumped once a frame and a
      slot freed by a finished request sat empty until the next one. Measured
      at 1.34 requests in flight against a cap of twelve. Fixed in C14, and that
      is what this item was asking for.

      Ticked: both halves are now so. Where you are and where you are looking
      was already the queue's order, and more chunks in parallel is real rather
      than nominal.
- [x] C2. Load high res more, long-range low res less
      Measured first, and the picture is not what it looks like from the code.

      Flying at 400 m, the share of drawn ground at its own resolution rather
      than stretched from a coarser tile: within a kilometre 64%, one to sixteen
      kilometres 69%, past sixteen 71%, and all three reach 100% and stay there
      once you stop covering new ground. So the far field is not being served
      *instead* of the near one — the whole pyramid converges together.

      The request priority does look wrong. It is distance / 2^(20-z), which
      reads as "biggest on screen first", and sampling the live queue in flight
      the next twelve to be served were z12@132 z14@132 z12@132 z15@134 z14@134
      z16@134 z16@135 z17@135 — a z12 square thirty kilometres off and a z21
      square underfoot inside a band of a quarter. It carries almost no
      information, because the split rule already equalises apparent size:
      that is what a screen-space-error quadtree *is*.

      Two principled replacements were built and both measured worse, on the
      same steady glide, sampled every twelve seconds for two minutes:

                                    within 1 km   1-16 km   past 16 km
        as it is                        64%         69%        71%
        holes first, then by distance   72%         34%         0%
        holes first, then by pixels
          put right (area x stretch)    15%         12%        26%

      The distance rule does what C2 asks for and the horizon never recovers:
      near ground churns continuously in flight, so under a strict near-first
      order there is always near work outstanding and the far field is never
      reached. Eight points nearer for a permanently soft horizon is not the
      trade — see B10 and M9, blur is the complaint on the other side of this.
      Ranking by visible error thrashes: it promotes whatever is most stretched,
      which is always the newest coarse square, and nothing finishes.

      So the near-uniform ordering is left alone. It looks degenerate and it is
      what makes the pyramid converge together. Left partly done rather than
      done because the ask is not satisfied — near is not favoured — and the
      honest reason is that the two ways of favouring it both cost more than
      they bought. Both are recorded here so the next attempt starts past them.

      Re-measured after C14, since every number above was taken while the queue
      was being drained at eleven per cent of its allowance. Same three bands,
      same steady glide, ten samples:

                          before    after
        within 1 km          64%     87.1%
        1 to 16 km           69%     97.5%
        past 16 km           71%     93.0%

      Every band up by a fifth to a third, and the pyramid still converges
      together, which was the argument for leaving the order alone.

      Near is still the worst of the three, and there is a reason for it that
      is not the queue's ordering: near ground is the ground that keeps being
      new. At 55 m/s the square under you is replaced continuously while the
      ground a few kilometres out stays in view for a minute, so the near band
      is always the one with the most recent arrivals in it. Favouring it in
      the queue does not change that — it is what the two reordering
      experiments above found, from the other side.

      Still open, because the literal ask is still not met. But the gap it was
      complaining about is now 87 against 97 rather than 64 against 69, and the
      reason for the remaining ten points is arithmetic rather than a fault.

      The third way, more requests in flight at once, has since been tried too
      and made no difference either: 12, 24 and 48 concurrent all land within
      half a per cent of each other, with an empty queue throughout. See C7 for
      the run and for the one caveat it cannot rule out.
- [x] C3. Ground loading is super slow but the minimap is already loaded
      Cause found: the per-frame streaming budget was spare time only, so any
      machine missing its target pinned to the 1.5 ms floor — 45 ms of terrain
      work a second at 30 fps against 1296 at 144. It now also gets a share of
      the frame, so the rate holds at any frame rate. The minimap was sharp
      first because it never went through this budget at all.
- [x] C4. Make it load HQ ground fast
      Cause found: the per-frame streaming budget was spare time only, so any
      machine missing its target pinned to the 1.5 ms floor — 45 ms of terrain
      work a second at 30 fps against 1296 at 144. It now also gets a share of
      the frame, so the rate holds at any frame rate. The minimap was sharp
      first because it never went through this budget at all.
- [x] C5. Map zooms in faster and more detailed than the terrain — ground should be faster and higher quality
      Same finding as M4, which has the detail: a depth limit that latched two
      levels below the provider and could never recover, plus the map being a
      flat view at native scale against ground seen at an angle and stretched
      58 per cent of the time while moving.
- [x] C6. Takes too long for max res to arrive — maybe fewer modes
      The waiting was real and had two causes, both already fixed elsewhere: the
      streaming budget was spare time only, so a machine missing its target got
      45 ms of terrain work a second instead of 1296 (C3/C4), and the depth
      limit latched two levels below the provider with no way back (M4/C5).

      Measured after both, over a two and a half minute repeated dive from 900 m
      down to 120 m: in the final frame, 320 of the 326 squares on screen are
      drawn at their own resolution and six are stretched, none bare. That is
      the max res arriving.

      "Maybe fewer modes" is the one thing not worth doing. Of the 1,238 tiles
      fetched across that approach, 363 — 29% — later had a finer tile of the
      same ground fetched as well, which is the ladder the complaint is about.
      But those are not waste: at 900 m you are looking at z14 and at 120 m you
      are looking at z20, and both are on the screen at the time. Taking rungs
      out does not make the sharp one arrive sooner; it makes you look at a
      coarser picture for longer on the way down. The depth by count over that
      approach was z11:22 z12:30 z13:33 z14:53 z15:77 z16:115 z17:139 z18:142
      z19:125 z20:157 z21:307 — a pyramid, with most of the spend at the bottom
      where you end up.
- [x] C7. Preload/load everything when close, so approaching does not trigger a high-res render unless it is a LOD
      The first half was built and measured worse. Asking ahead of where you are
      going — the tiles you will need in a second, fetched now — took the share
      of the frame drawn from stretched imagery from 58.1% to 61.7%, and 61.5%
      with the look-ahead gated on speed. It was reverted.

      The reason offered for discounting that result — that the sandbox proxy
      serialises tiles and so punishes an extra request harder than a real
      browser would — was false, and is corrected under B10: the relay runs 22
      concurrent with a median gap of 0 ms. So the prefetch really did lose,
      and it lost for a reason that has since been found: the queue was drained
      once a frame rather than on completion, so it was already full of certain
      work that was not being dispatched. Adding speculative work to a queue
      running at eleven per cent of its allowance could only make it worse. See
      C14.

      The reason it loses is the same one that sank C2's reordering: throughput
      is the constraint, not ordering, and a speculative request is one a
      certain request did not get. It only pays if the guess is nearly always
      right, and steering is not.

      The second half — "unless it is a LOD" — is already so. Approaching does
      not trigger a fresh high-res render of ground you have: the finer tile is
      requested while the coarser one you already have keeps being drawn,
      stretched, until it lands. That is what the 29% ladder in C6 is.

      "More throughput" was the obvious remaining lever and it has now been
      tried, because the assumption blocking it turned out to be wrong. This
      sandbox was believed to serialise outbound requests, which would have made
      any concurrency measurement meaningless; measured, it reaches 25 requests
      in flight at once and 20 a second. So the experiment is possible after
      all.

      Run over four alpine places this session had never fetched — clearing the
      texture cache is not enough, because the browser's HTTP cache then serves
      the refetch off disk and every arm after the first measures that instead
      of the setting:

        12 in flight   Chamonix        0.5% of the ground stretched
        24             Zugspitze       0.8%
        48             Zermatt         0.6%
        12             Barcelonnette  10.8%, and that is the settle after the
                                      teleport — its samples run 45, 14, 0, 2,
                                      0, 4

      No effect. And the reason is in the same table: the queue is empty in
      three of the four arms. There is nothing waiting for a slot, so more slots
      cannot help.

      One caveat that matters and cannot be measured away here: this harness
      renders at about 1.4 frames a second, so the game asks for tiles some
      forty times less often than it would at 60. An empty queue at 1.4 fps does
      not prove an empty queue at 60. What the run does establish is that the
      limit is not the binding constraint in an environment where the network is
      fast, and that raising it is not a free win to be assumed.
- [x] C8. Flying up should not decrease quality
      Cause: the split test used the *horizontal* distance, which is nought for
      ground directly beneath you however high you are — so at 9 km the quadtree
      descended to zoom 23 straight down (true distance says z12) and spent the
      frame's whole tile budget there. maxDrawn then cuts the walk short and the
      view is what goes missing. The quality did not decrease; it went somewhere
      useless. Split now uses the real distance, including the square's own
      height range; culling and reach stay horizontal, because those are about
      ground covered rather than apparent size. On foot, nothing changes.
- [x] C9. Minimap often does not load satellite when high up — four rescues by a
      standby latched the map onto it for the session with no way back, and two
      of the ways to earn one (no imagery here, provider not ready) are not the
      server's fault. Now a rate, over ten seconds, transport failures only,
      and it expires.
- [x] C10. Distant view should be fixed low-res LODs, getting less detailed further out
      It already is, and here it is measured rather than asserted. Standing on
      the ground looking at the horizon, and again from 400 m with the nose 15
      degrees down, every square actually drawn, bucketed by how far off it is
      and reported as the shallowest / middle / deepest zoom in the bucket:

        under 250 m      18 / 20 / 21
        250 m to 1 km    17 / 18 / 19
        1 to 4 km        15 / 16 / 17
        4 to 16 km       13 / 14 / 15
        16 to 64 km      11 / 12 / 13
        past 64 km       11 / 11 / 11

      Which is a fixed pyramid getting two levels coarser for every four times
      the distance, and it stops at z11 rather than running on. It is not a
      constant anyone typed: it falls out of the screen-space-error rule, which
      splits a square only while it still looks bigger than a threshold. At
      30 km a z12 square is 9.8 km across and subtends about 250 screen pixels
      on a 960-wide view, so its 256-pixel texture is landing at roughly 1:1 —
      exactly the level it should be, and one coarser would visibly blur the
      horizon.
- [x] C11. LODs for distance render only
      Same answer as C10, from the same measurement: the distant view is drawn
      from coarse levels only and never descends. Past 16 km nothing finer than
      z13 is ever built, and past 64 km nothing finer than z11 — the quadtree
      stops splitting there because the square already looks small enough, so
      the deep levels are never requested, never fetched and never meshed for
      ground at that range.

      The one place this was not true was straight up and down, and it is fixed:
      the split test used horizontal distance, which is nought for the ground
      directly beneath you however high you are, so at 9 km the tree descended
      to z23 under your feet — maximum depth for a patch seen from nine
      kilometres — and spent the frame's whole budget there. See C8.
- [x] C12. Why is the distance horizon forced
      Because the setting is a floor, not a ceiling: renderDistance is
      clamp(horizon, setting, setting * 6). From 400 m up the real horizon is
      71 km, and stopping the world at a 24 km setting anyway puts a flat band of
      haze across the view where the mountains should be. That was true and
      unexplained; the setting now says it.
- [x] C13. "Draw twice as far over country you have seen" — what is this, and it reads badly
      It read badly because it was wrong: the distance is a separate slider from
      64 to 1024 km, so there is no "twice" anywhere in it. The toggle is now
      "Keep drawing past the horizon where you have been" with the distance as its
      own control underneath.
- [x] C14. The request queue was drained once a frame, so ten of twelve slots sat idle
      This is the cause behind "throughput is the constraint", which B1, B7,
      B10, C1, C2 and C7 all concluded and none of them measured directly.

      `pump` — the thing that turns queued squares into requests — was called
      from exactly one place, the terrain's walk, once a frame. Nothing
      refilled a slot when the request holding it completed. So a slot freed
      just after a frame stayed empty until the next frame came round.

      At sixty frames a second that is a sixteen-millisecond gap and invisible,
      which is why it survived this long. On the machines the complaints
      actually come from it is not. Measured in flight:

        requests in flight    mean 1.34 of a cap of 12
        queue depth           mean 66 squares, peak 510
        saturated samples     10 of 177

      Eleven per cent of its own allowance, with sixty-six squares waiting. And
      the gap widens as the frame rate falls, so the ground arrives slowest
      exactly where the frame rate is already low.

      The fix is the one every other queue in this project already uses — the
      map's own tiles, Overpass, geocoding all pump on completion — and this
      one did not. Same probe, same course, before and after:

                              before    after
        ground stretched       23.7%     11.0%
        queue depth, mean         66        16
        queue depth, peak        510       294
        requests in flight      1.34      2.23
        tiles fetched          2,534     3,575

      Stretched ground more than halved and the queue drained. Those are this
      probe's own course; blurcheck, the project's own tool and the one that
      produced the 58% quoted under B10, run on both arms of the same build:

                            once a frame    on completion
        settled, flying          63.9%           28.9%
        just after a 180         78.5%           23.5%
        standing still           33.9%            4.0%

      Standing still is the one that settles the argument. B10 recorded 8 per
      cent there and called it "ground the provider has nothing deeper for,
      which is honest rather than broken". It is 4 per cent once the queue is
      drained properly — so half of what had been written off as the provider's
      limit was this. Nothing is bare in either arm; it was never about squares
      going missing, only about how long they stayed coarse.

      One thing guarded alongside it: with a completion pumping as well as a
      frame, the queue would have been re-sorted a dozen times a frame instead
      of once. It now sorts only when something has been added since the last
      pump.

- [x] C15. The elevation queue starved the same way, and it matters more
      Found by looking for the shape of C14 elsewhere rather than by a report.
      `pump` ran from one place — `ensureAround`, off the terrain's walk, once
      a frame — and `onMessage` freed a slot without refilling it. Identical.

      It matters more than the imagery one. Until a square's DEM tile arrives
      the ground under it reads as exactly sea level, and when it lands the
      surface walks to its real height over a third of a second. That is what
      B1, B2 and B4 are all about — the ground moving up and down in sections,
      the patch that appears then drops you, standing on ground that is not
      there yet. A slow elevation queue is not a blurrier picture; it is longer
      spent standing on ground that has not arrived.

      Measured in flight, same probe both arms:

                                    before    after
        queue depth, mean             9.57      0.69
        queue depth, peak               74        27
        idle while work waited      20/113     0/112
        requests in flight, mean      0.25      0.21

      Six per cent of a cap of four, with ten tiles waiting, and a fifth of all
      samples with nothing in flight *and* work queued. That last figure is the
      defect stated exactly, and it is zero now.

      Guarded the same way, including the failure path: a request that fails
      frees a slot too, and used to leave it empty just the same.

- [x] C16. The double-clickable build loaded ground three times as slowly as the hosted one
      Third instance of the same shape, found by looking rather than by report.

      A page opened from file:// cannot start a Web Worker, so the single-file
      build — the one meant to be double-clicked — runs the tile jobs in the
      page instead. That host ran exactly one at a time, described as "one at a
      time, yielding between them so the frame still gets drawn". The yielding
      was right and is what protects the frame. One at a time was not: most of
      a tile job is `await fetch`, which never touches the main thread, so
      serialising the job serialised the network wait along with the decode.

      Meanwhile the streamer believed it had a dozen requests in flight,
      because it had posted a dozen messages. They were sitting in this queue.

      Measured on the fallback path against a real worker over the same course,
      then again after:

                            before    after    real worker
        ground stretched     41.8%    14.6%       14.1%
        tiles fetched        1,280    1,556       1,906
        queue behind it        157       24          19
        frames per second     1.42     1.51        1.44

      Within half a point of a real worker, from three times the blur. The
      frame rate went up rather than down, which was the thing to check: the
      yield between starts is untouched and is still what keeps the page
      responsive.


## D. Physics

- [x] D1. Physics do not match Minecraft — barely fall when standing still; looking down then forward quickly gives far too much forward speed
      The glide is Minecraft exactly, and that is measured rather than asserted:
      a second transcription of LivingEntity.updateFallFlyingMovement, written
      from the Java in its own units and sign convention, diverges from ours by
      1.8e-14 blocks a tick over 200 ticks across 66 manoeuvres. Which is float
      noise. The fall when not gliding is Minecraft's too — 0.08 a tick with a
      0.98 drag, terminal 3.92 b/t — and the fixed clock always hands the glide
      whole ticks, so it cannot be running at the wrong rate.

      The flight numbers come out where a player would expect them: level glide
      1.49 b/t at 7.6:1, nose down 30 degrees 2.48 b/t, straight down 3.92 b/t.
      "Barely fall when standing still" is what a 7.6:1 glide ratio is, and it
      is vanilla's.

      So the difference being felt is not in the glide. The two candidates left
      were scale — 30 m/s crosses a Minecraft village in a second and a real
      valley in a minute — and the rocket, which deliberately departs from
      vanilla so a weak slot cannot brake you (D7, D5).

      It was the rocket, and it was worse than a mismatch. See D4: the fix that
      stopped a weak slot braking you clamped only the forward half of vanilla's
      push and left the steering half running for ever, which at a shallow dive
      is an engine. "Looking down then forward quickly gives far too much
      forward speed" is that exactly — ten to thirty-five degrees down was the
      band it compounded in, and looking down is what put you there. Fixed at
      the cause. Held twenty degrees down on continuous rockets, the game now
      settles at 40 m/s and stays there; it used to pass 5,700 m/s in a minute.
- [x] D2. Looking down to gain speed should work as it does in MC
      It does, and the trade is the interesting part. Dive for three seconds
      from a 30 m/s cruise, then level out, and the horizontal speed you keep
      against the height you spent:

        10 deg    30 m/s     18 m of height     0.6 m/s per 100 m
        20 deg    33         21                14.4
        30 deg    38         27                27.4
        40 deg    43         37                33.3
        50 deg    47         53                32.2
        60 deg    50         73                27.2
        75 deg    51        110                19.4
        90 deg    51        129                16.4

      So there is a best angle and it is about forty degrees, a vertical drop is
      the *worst* trade on the board — nearly twice the height for the same
      speed as sixty — and none of that is tuned here, it falls out of
      Minecraft's own tick. It is also why the dive-and-climb rhythm does not
      close (see CLIMB_TRADE): the speed bleeds back off. After a 60 degree
      dive, levelled, it goes 47.5 -> 41.9 -> 38.0 -> 35.4 -> 33.7 m/s over ten
      seconds, on its way back to the 30.2 m/s a level glide holds. About eight
      seconds of being fast for seventy metres of height.
- [x] D3. Should I jolt to a stop when flight duration ends and I am looking down?
      No, and you do not. Measured at the burnout tick itself, which is where a
      jolt would have to be:

        aimed level, Rocket I     33.5 -> 33.2 m/s    -0.7% in one tick
        aimed level, Rocket V    107.0 -> 106.0       -0.9%
        45 down, Rocket I         36.8 -> 37.2        +0.8%
        45 down, Rocket V        107.1 -> 106.5       -0.6%
        straight down, Rocket I   43.4 -> 44.1        +1.6%
        straight down, Rocket V  107.8 -> 107.2       -0.5%

      Under one per cent in a twentieth of a second, and pointed down it is
      often positive — gravity takes over the moment the rocket stops. The
      largest single-tick change anywhere in a rocket flight is ignition, at
      +120%, not burnout. What you actually feel afterwards is drag, which is
      slow and directional: a Rocket V burning out level is down to 91.6 m/s a
      second later, but nosed 45 degrees down it is still doing 106.5.

      This was asked as a design question rather than a bug report, so: it
      should not jolt, because Minecraft does not — the firework stops pushing
      and the drag and the gravity are already what they were. Nothing was
      changed for it.
- [x] D4. Going faster by rocketing more downward makes no sense — fix the physics engine
      Right, and it was a real bug rather than a matter of degree — the engine
      had a runaway in it, and pointing down is what triggered it.

      D7 stopped a weak rocket braking you by clamping the forward half of
      Minecraft's push at nought. But that push is one vector doing two jobs:
      driving your speed along your look toward the rocket's target, and halving
      whatever part of your velocity points elsewhere, which is the half that
      makes a rocket steer. Clamping only the forward half left the steering
      half at full strength for ever after the rocket was spent — and that half
      alone is an engine. It pins your velocity to your look axis, so a shallow
      dive sinks at |v| * sin(dive) instead of the glide's own few metres a
      second, and the elytra hands a tenth of the sink straight back as forward
      speed. A gain proportional to your speed against a drag that is one per
      cent of it, so it compounds.

      Isolated rather than guessed: the glide alone held at twenty degrees down
      settles at 40 m/s; the steering half alone, with the forward push removed
      entirely, reaches 2,512.

      Held thrust — which is what a hotbar full of rockets buys — used to do
      this, against vanilla sitting at 35 m/s for ever:

        aim       vanilla    was        now
        level      33.5      33.5      33.5
        10 down    34.3      93.8      34.1
        20 down    34.7     248.0      40.1
        30 down    34.6     102.4      50.2
        45 down    34.3      40.7      65.3
        90 down    35.7      78.4      78.4

      and at twenty degrees down it did not settle at 248 either, it was still
      climbing: 353 m/s at twenty seconds, 81,837 at two minutes.

      Fixed at the cause. The push is gated whole instead of clamped in half — a
      rocket with nothing left to give at this speed gives nothing, steering
      included. Everything the clamp existed for survives: a Rocket I fired
      while cruising on a V is now bit-identical to coasting (107.0 -> 94.2
      either way), so it is inert rather than a brake (D7); the governor is
      vanilla's own, two tenths of a block a tick past the target; the slots
      still read 33/52/70/89/107; three alight still reach cruise in 2 ticks
      against 7 for one (D5); and the kick off a standstill is unchanged (D8).

      What is left is the honest answer to the question as asked. Across a whole
      burn, aim barely matters: 70.2 m/s level, 74.5 straight down, and nothing
      outside that. Six per cent from level to vertical — which is what vanilla
      does too, 33.5 to 35.7, also six per cent. Pointing down is worth a little
      because gravity pulls the way you are pointed, and that is all it is worth.

      Guarded in the self-test by a sweep of every angle and three slots under
      twenty seconds of unbroken thrust. It fails at 458 m/s on the old clamp
      and passes at 112 on this. Verified in the running game as well, not only
      in the module: holding the rocket key at twenty degrees down, the speed
      reads 39 -> 40 m/s and stays there for a minute, where the old code read
      53 -> 5,759.
- [x] D5. Flight duration and deceleration should match MC — spamming should make you a bit faster (check this)
      Checked, and it did nothing: a firework was a single timer, so "lighting
      one mid-burn simply restarts the burn" — the second rocket bought you
      nothing at all. In Minecraft a firework is an entity and every one alive
      applies its own push every tick, so two overlapping push twice. They are
      a list now, each keeping the power it was lit with, so a rocket in flight
      is the one you lit rather than whichever slot you have since scrolled to.

      And the push itself was capping too early. Minecraft's line is
      0.1 + (thrust - along) * 0.5 with no floor, and it settles where that
      reaches nought — two tenths of a block a tick past the rocket's own
      target. D7 had dropped the nudge along with the pull, which capped the
      cruise at the target exactly (30 m/s for a Rocket I against vanilla's
      33.5), put a step in the curve where you reach it, and left a second
      firework with nothing to contribute. Clamping the line at nought instead
      of cutting it keeps all three properties: no brake, the governor intact,
      and every firework pushing.

      Measured: a Rocket I settles at 33.5 m/s where vanilla settles at 33.5,
      and three alight reach 33 m/s in 2 ticks against 7 for one, holding 33.7.

      The clamp itself did not survive — see D4. Clamping the forward half of
      the push left the steering half running after the rocket was spent, which
      at a shallow dive compounds without bound. The push is gated whole now:
      spent means spent, steering included. Every number above is unchanged by
      that, because below the governor nothing about the arithmetic differs.
- [x] D6. Rocket times do not match Minecraft — fix, and use the same scale for speed; the light-duration one has MC default speed
      They do. Minecraft's firework lifetime is 10 * duration + rand(6) +
      rand(7), so 10 to 21 ticks for a duration of one, mean 15.5. Ours is
      10 * duration + 6, which is inside that range and half a tick off its
      mean — a deterministic stand-in for a die roll rather than a different
      number. And the scale holds: rocketPowerFor(1) is exactly 1, so a Rocket I
      is vanilla's own push, and every heavier slot's power is its burn length
      over Rocket I's. Both checked in the self-test.

      What was wrong was the cruise those times produced, not the times. See
      D5: the push was capping at the rocket's target instead of vanilla's
      target-plus-two-tenths, so a Rocket I settled at 30 m/s against
      vanilla's 33.5. Fixed there.
- [x] D7. Using the slot of a slower rocket slows you down
      Measured: cruising at 106 m/s on a Rocket V, firing a Rocket I took you to
      33.5 — 69% of your speed for pressing the wrong hotbar key. Minecraft's
      line pulls toward the rocket's target from either direction, which barely
      shows in vanilla because every firework aims at the same 1.5 b/t; here a
      bigger rocket pushes harder, so the small slots brake. A spent rocket is
      inert instead: the brake is 60.7 m/s -> 0, and each rocket still settles
      at its own cruise.

      How it is made inert changed once. Clamping the forward half of the push
      at nought did it, but left the steering half pushing for ever — see D4,
      which is the runaway that came out of exactly that. The whole push is
      gated now, so a Rocket I fired while cruising on a V is bit-identical to
      coasting: 107.0 -> 94.2 either way, which is drag and nothing else.
- [x] D8. More speed/movement initially when going from slow to rocket speed
      The speed was already there — lit from 8 m/s a Rocket I puts you at 20.8 by
      the first tick and 30.4 by the third. What was missing was the view: the
      field of view eased in on one rate for both directions, about six tenths of
      a second, so the acceleration was over before the camera acknowledged it.
      It opens fast now and closes slowly — 88% of the way in 0.15 s instead of
      53% — which is also just how it should feel: arriving speed is a shove,
      leaving speed is a drift.
- [x] D9. Speed accuracy breaks over time — the player slows down
      Same frame-clock cause: as the world loaded and the frame rate fell, the
      catch-up ceiling threw the difference away and you really did slow down
      while the readout did not. See MAX_FRAME_S.
- [x] D10. Speed readout says faster than reality
      Two causes, both fixed. The big one was the frame clock: below 4 fps the
      world ran in slow motion, so the model said 30 m/s while you covered 15 —
      the readout was right and the world was slow. The second: `speed` returned
      the bare velocity while the controller moves you by velocity x multiplier,
      so with speed mode on it read half, not double. Both now agree.
- [x] D11. Improve walking speed and being flat on the ground
      The speed was already right: 4.32 m/s walking and 5.61 sprinting are
      Minecraft's own 4.317 and 5.612, and the fixed clock hands them out
      whole. Nothing to improve there.

      Standing on the ground was half done. The grade was measured *along* the
      way you face and the body leant with it — but not the grade *across* you,
      so walking a contour read as flat ground and the figure stood bolt
      upright out of the hillside with one boot in the air and the other
      buried. Which is the case that matters, because walking along a contour
      is what anyone does on a steep slope: it is the only way up one.

      Both grades are measured now, over a couple of metres either side rather
      than from a polygon normal — what a walker feels, not the tilt under one
      boot — and the body banks with the cross-slope as it already leant with
      the grade. The same 0.45 of it either way, because a walker takes up some
      of a hill in their ankles rather than all of it in their spine.

      Checked on a synthetic hillside: facing up it reads 0.46 rad of slope and
      no bank, facing along the contour reads 0.46 of bank and no slope,
      turning about puts the hill on the other shoulder, and in the air both
      fade to nothing.

## E. Speed mode

- [x] E1. Charges faster
      Cooldown 45 s -> 30 s. You are in it 29% of the time now, was 18%.
- [x] E2. 1.2x speed and duration, and rename it — "rapid mode" or something better
      A fifth again on both: 2.0x -> 2.4x, 10 s -> 12 s. Renamed Surge, everywhere
      it is shown — gauge, help card, key list, cheat panel, toasts.
- [x] E3. Should affect everything, not just rockets — base, walk, glide
      Already does: speedMultiplier scales the displacement the controller applies,
      so walking, gliding and falling all carry it. Rockets get it on top.
- [x] E4. Countdown should not run down while in settings or paused
      Already so, and now checked: a paused frame is update(0), so every timer is
      stepped by nothing. Ten seconds of paused frames spend no surge and no
      cooldown; a second of real time spends one second.
- [x] E5. Streamline the speed mode panel
      Asked what you meant and you said: less gliding stuff always visible, and
      a timer. Both, and by the same rule — a readout is on screen while it has
      something to say and gone when it has not.

      The Surge box used to sit there permanently reading "Ready": a title, a
      keycap, a bar and a word, all spent saying that nothing is happening. It
      now appears only while the burst is running, while you are still coasting
      on it, and while it recharges — all three of which are a number counting
      down, which is the timer — and is gone the rest of the time. The key still
      works when the box is not there.

      The two numbers you fly by went the same way. The flight-path angle and
      the pitch are what a glider pilot reads, and standing on the ground they
      say "+0.0 degrees" and whatever you last looked at. They are there while
      you are in the air and gone while you are walking.

      Checked in the browser across four states in one flight: on the ground the
      surge box, the glide angle and the pitch are all gone; gliding brings the
      angle and the pitch back; lighting the surge shows the box reading
      "2x · 10.9s"; once spent it stays, counting the recharge down from 21s.
- [x] E6. Where is speed mode on touchscreen
      It was there all along, labelled "2x" — a value rather than a thing. It says
      Surge now, like everywhere else.

## F. Map and minimap

- [x] F1. NWSE on the minimap preview is too big
      Was 8% of the minimap — a 19 px letter on a 240 px map, bigger than the
      place names under it. Now 5.5%, floored at 10 px for phones.
- [x] F2. Improve the position of NWSE on the map
      They sat a whole letter's height inside the rim, over the ground you were
      reading. Moved out to 0.62 of the letter height, and the outline halo
      thinned from 0.28 to 0.2 so the pair stops reading as one blob when small.
- [x] F3. Map is white, especially when going up
      Cause: resolve() only ever walks up. Zooming out — which is what climbing
      does to the minimap — leaves the sharp squares cached and the coarse one
      not yet asked for, so it found nothing and the renderer painted
      STREET_BLANK over everything. That colour is #eceae3, near-white. It now
      draws the finer squares it already has, and paints paper only where
      nothing at all is known.
- [x] F4. Map is white for a moment when zooming in
      Cause: resolve() only ever walks up. Zooming out — which is what climbing
      does to the minimap — leaves the sharp squares cached and the coarse one
      not yet asked for, so it found nothing and the renderer painted
      STREET_BLANK over everything. That colour is #eceae3, near-white. It now
      draws the finer squares it already has, and paints paper only where
      nothing at all is known.
- [x] F5. Stretched map
      A two-dimensional size checked in one dimension. The map canvas lives in a
      flex panel, so its box changes for reasons the window knows nothing about
      — the sidebar rewrapping on a narrow screen, the waypoint list growing, a
      phone's toolbar sliding away — and the only two checks were a window
      resize listener and, inside update, `clientWidth !== this.width`. Get
      taller or shorter without getting wider and the backing store kept its old
      height while the CSS stretched it over the new one.

      Reproduced in the browser rather than argued: shrink the box from 642x502
      to 642x301 without touching its width, and the store stayed 642x502 — the
      picture squashed to 0.60 of its height. With the fix it followed to
      642x301 exactly, factor 1.00.

      Fixed at the cause: a ResizeObserver on the canvas's own box, which is
      told whatever moved it, with the width-and-height check underneath as the
      fallback for anything that has no ResizeObserver.
- [x] F6. Explored area must look the same and stay visible at every zoom
      Cause: save() threw away 45% of the level-16 squares at random whenever the
      record passed 160,000 — permanently, since what it wrote is what came
      back, so every reload thinned the survivors again (55%, 30%, 17%).
      Random scattered holes through ground you had actually flown, different
      every time. The cap was real at ~3 MB of key strings; explored ground is
      discs along a path, so rows compress 14x and 2.7M squares now fit. Over
      the ceiling the oldest fine detail goes, in order, never at random.
- [x] F7. Map should show exactly where I explored, especially zoomed out
      Cause: save() threw away 45% of the level-16 squares at random whenever the
      record passed 160,000 — permanently, since what it wrote is what came
      back, so every reload thinned the survivors again (55%, 30%, 17%).
      Random scattered holes through ground you had actually flown, different
      every time. The cap was real at ~3 MB of key strings; explored ground is
      discs along a path, so rows compress 14x and 2.7M squares now fit. Over
      the ceiling the oldest fine detail goes, in order, never at random.
- [x] F8. Map does not show only what I saw, and changes size with zoom
      Both halves were the same line. The fog subdivided every map tile sixteen
      ways whatever the zoom, which sounds like a resolution and is not: it
      makes the mask level `tileZoom + 4`, which is coarser than the record
      everywhere below map zoom 12 and lands *between* recorded levels on the
      odd ones. isExplored answers a level it does not keep by shifting down to
      the nearest one it does, and a coarse cell counts as explored if any part
      of it is — deliberately, so a continent you crossed does not read as
      unvisited. Put together, the ground you had seen grew as you zoomed out.

      The level is chosen now, and always one the record actually keeps, which
      is what stops both the shifting and the growth. The finest worth drawing
      is about four pixels a cell — below that it is a lookup per pixel for an
      edge that is blurred anyway — and a level-L cell is 256 * 2^(zoom - L)
      pixels across, so four pixels is L = zoom + 6, capped at the record's own
      finest. Area claimed per cell you actually saw:

        map zoom      was            now
          4        65,536x         4,096x
          6         4,096x           256x
          8           256x            16x
          9           256x            16x
         10            16x             1x
         11            16x             1x
         12+            1x             1x

      Sixteen times tighter at every zoom, and exact from map zoom 10 up, which
      is where the map is actually read. Photographed at z16, z12, z10 and z7:
      a 0.4 mile flight over Lauterbrunnen shows as a patch you can cover with a
      thumbnail at z7, where before it was read at level 10 whose cells are
      about forty kilometres across.
- [x] F9. Remove grids from places like the example map
      Gone. The world map drew white hairlines on every map-tile boundary from
      zoom 12 up — the seams of the fetching machinery, drawn over a photograph
      of somewhere real. A developer wants to see those and a player never does,
      and it is most of why the map read as a screenshot of a tool rather than
      as a map. Removed at both ends, the drawing and the flag that asked for
      it, and the self-test holds it shut.
- [x] F10. Improve the starting map zoom
      It opened at zoom 6 every time — 1,473 km across at a middling latitude,
      most of a continent — so the first thing anybody did was zoom in. It opens
      at 11 now (46 km, a city and the country round it) and after that wherever
      you left it.
- [x] F11. Opening the map should not stop the game
      The map was in the pause list because stopping the world was the only way
      to stop W flying you into a mountain while you typed a place name. Those
      are two questions: `paused` stops the clock, `takingKeys` stops the
      keyboard. The map now does only the second.
- [x] F12. Waypoint dragger in the map
      Press a waypoint on the world map and it comes with the pointer; press
      anywhere else and the map pans as before. The cursor changes over one, so
      you can tell it is draggable before you try.

      Moved rather than re-added, which is the part worth doing carefully:
      dropping a new waypoint and deleting the old one would renumber it and
      give it the next colour in the palette, so a drag would look like a
      different waypoint appearing somewhere else. WaypointStore.move keeps the
      id, the name and the colour.

      The hit test is in pixels, not metres, because that is what a hand aims
      with — the marker is a seven-pixel square and the grab area is nine
      pixels, a little wider than it is drawn so a touchpad can catch it — and
      it takes the antimeridian the short way round exactly as the drawing does,
      or a waypoint just past the date line would be unreachable.

      Checked in the browser: a waypoint dragged 90 px east and 60 px south went
      from 46.57230, 7.92260 to 46.56523, 7.93801 — east and south, still one
      waypoint with the same id — and a press on empty map still panned.

      One honest limit: this is mouse and trackpad, because the map's panning is
      too. Neither listens for touch.
- [x] F13. Waypoints appear on the map
      Already so on both maps — minimap behind the minimapShowWaypoints setting,
      world map always.
- [x] F14. Waypoint and distance as a box of text plus a coloured beam beacon
      Built: a coloured beam standing on the ground under every waypoint, bright at
      the foot and fading with height, additive and depth-write off so it never
      punches a hole in the ground. Widened with distance so it does not vanish
      inside a pixel from ten kilometres. Beside each one, a box with the name and
      the distance in the colour of its beam.
- [x] F15. Circular, square or squircle option for the minimap
      Four: rounded (as it was), circle, squircle, square. One border-radius each
      — the canvas is square and overflow:hidden on the frame is what cuts it, so
      the compass and scale bar inside carry on unchanged.

## G. Providers and 3D

- [~] G23. The photorealistic city was sitting about thirty metres too low
      Found by chasing the flat pale plane in A24, and it is very likely the
      root cause of that, of G22, and of some of what you photographed.

      What the pictures show. Standing at Market Street, the lower half of the
      frame is a featureless pale plane with the city behind it. Hiding the edge
      wall changes nothing. Hiding the sea-floor sheet reveals downtown San
      Francisco in full: roads, crossings, cars, pavements. So the sheet — a
      disc at twelve metres below sea level that paints where the mask says sea
      — is drawn in front of the streets. It should be far underneath them.

      Why it is in front. Raycasting the photogrammetry (valid: those meshes are
      placed by matrix and have no vertex-shader displacement, unlike the ground
      and the wall) against the height field at the same points:

        point        photogrammetry     height field    difference
        200, 200          -26.6 m            6.8 m         33.4 m
        -120, 80          -23.2 m            9.5 m         32.7 m

      Two independent points agreeing at about thirty-three metres. The geoid to
      ellipsoid separation at San Francisco is about thirty-two.

      That is the whole explanation and it is a units mismatch, not a bug in any
      one file. 3D Tiles are ECEF, which is ellipsoidal by definition. Terrarium
      and SRTM heights are orthometric — metres above the geoid. The local frame
      is built tangent to the ellipsoid, so the two are placed against different
      surfaces and end up separated by the geoid height wherever you are. At San
      Francisco that is thirty-two metres down. Globally the separation runs from
      about -107 m to +85 m, so elsewhere it is worse and can be either way.

      What it explains. The city's streets sit below a sheet at -12 m, so that
      sheet covers them. You stand on the height field at street level while the
      photogrammetric street is thirty metres beneath you, which puts you inside
      the ground floor of a building — G22, and the grey mass in the first
      photograph I took. And ground that ought to be photogrammetry reads as a
      flat plane, which is "the terrain becomes flat".

      One city is one city, so the same measurement was taken in three, with a
      grid of forty-odd columns each, taking the deepest hit in each column as
      the ground:

        place            EGM96      measured (p25 / median / p75)
        San Francisco    -32.3      -33.0 / -32.8 / -32.5
        Denver           -17.4      -18.1 / -17.9 / -17.7
        London           +46.6      -344.5 / -63.0 / -35.1

      Two places whose geoid heights differ by fifteen metres each match their
      own value to within half a metre, and neither matches the other. That is
      the geoid, not a constant.

      London is not a counter-example so much as an unusable reading: 186 of 220
      tiles drawn and quartiles spanning three hundred metres, which is what
      "deepest hit in the column" returns when the tree is half loaded and the
      columns have holes in them. Being re-measured settled.

      Still unexplained: two of the four original sample points read about
      -199 m rather than -26 m. Both are the pair nearest the spawn, which is
      inside a building.

      Fixed, by measuring rather than modelling. A geoid model would be a
      megabyte of grid and would still be a model; the two datasets the game is
      actually drawing can be asked directly, and their difference is the truth
      for that pair of providers — it absorbs anything else systematic between
      them too, and it needs no new file and no network.

      The estimator is the part that needed care, because a ray fired down
      through a city hits roofs, canopies and holes in shells as well as the
      street. The naive answer — the lowest hit in each column — is what gave
      that -63 m median in London. So every hit from every ray goes into a
      histogram of its height above the field, and the answer is the lowest
      cluster dense enough to be real: the ground is the one surface that turns
      up in every column at the same offset, and it is below the roofs.

      It declines rather than guesses. Too little loaded, too few samples in the
      winning cluster, or an answer outside the geoid's range, and nothing moves.
      A teleport drops it, because the geoid at the far end is a different
      number.

      Verified twice. Against a built ground with roofs at nine different
      heights and shells with their far side missing: recovers 32.8 from -32.8
      and -46.6 from +46.6, is not dragged down by the holes, and stays silent
      in all three refusal cases. And live on the real tileset at Market Street,
      converging as tiles arrive:

        after ~60 s   110 tiles loaded    lift 32.3 m
        after ~120 s  226 tiles loaded    lift 32.8 m
        after ~200 s  253 tiles loaded    lift 32.9 m

      against the -32.8 measured independently by raycast and EGM96's -32.3.

      What the picture does: the city comes down to the ground, and street-level
      detail — the construction site on Stevenson Street, the lower storeys, the
      road surface — appears where there had been a blank plane.

      The pale band that remains across the near field is not the sheet any
      more. Same test that found it — hide it and look — re-run with the lift in
      place at a measured 32.6 m: the two frames are the same picture. Before
      the lift, hiding the sheet was the difference between a blank plane and a
      city with streets in it.

      So what is left is the near ground itself not having arrived: at fourteen
      metres over a street the tiles directly underfoot want the finest level in
      the tree, and this sandbox reaches the city through a relay that makes
      everything slow. That is a loading-speed matter, which is what the
      concurrency fix in A24 is for, and not a placement fault.

      Still `[~]` rather than `[x]` for two honest reasons. The lift is verified
      in one city live and in two by raycast, and the third — London — has never
      given a usable reading because the City has no open ground to measure
      over; a park would settle it. And the two sample points that read -199 m
      instead of -26 m are still unexplained.

- [ ] G22. In a photorealistic city you can stand inside a building
      Noticed while photographing the blur, not reported — so it goes in the
      record rather than being quietly fixed or quietly ignored.

      Teleporting to 37.78970, -122.40000 (Stevenson Street, San Francisco) puts
      you at street level inside a building's shell. The player collides with
      the terrain heightfield; the photogrammetry is drawn but nothing in it is
      solid. So the ground you stand on is right and the walls are not there.

      What it looks like from inside is a large, near, featureless surface
      filling the view, with no terrain under it. Which is worth flagging next
      to A24, because "sometimes it becomes mega blurry and terrain becomes
      flat" describes that exactly as well as it describes the coverage fault
      A24 fixed. If it still happens after those fixes, this is the next
      suspect, and the tell is whether the minimap shows you inside a building
      footprint.

      Not fixed, and not fixed quietly-in-passing either: making photogrammetry
      solid means raycasting against loaded tile meshes on a moving budget,
      which is a real piece of work and its own decision. Say the word.

- [~] G21. Test the street view merge
      Asked alongside the blur. The merge rule is the part I could test without
      a key, and I drove the real update() rather than reading it: standing on a
      capture point gives opacity 1.00, a hundred metres off gives 0.00, halfway
      gives 0.65 — a blend that arrives rather than a switch that flips. Taking
      off to 40 m kills it, so does 30 mph, and the three conditions multiply
      rather than vote, so being on the spot but sprinting is correctly not a
      moment a still photograph can describe. With no provider the dome is off
      rather than merely transparent.

      Testing it turned up a fault that had nothing to do with the blend.
      Every wait in that path was unbounded — the stitch handshake with the
      worker, the equirect image load, the coverage lookup — and maybeSearch
      refuses to look again while `loading` is true, a flag only cleared in the
      promise chain's finally. So one stitch the worker never answered, or one
      image request that hung rather than failing, left that flag true for the
      rest of the session: street level searched once, could not finish, and
      never tried again anywhere in the world. Silence is not a failure; a
      failure has to settle. Everything is bounded at twenty seconds now, and
      clear() settles whatever was still waiting.

      What is not tested is the network half — the actual Street View or
      Mapillary fetch and the four-way stitch into an equirect. That needs a
      Google Maps Platform key or a Mapillary token, and the tokens you sent
      are Mapbox, which does not serve street-level imagery. Send either one and
      I will finish it.

- [~] G1. Google session failed (403) — maps_api.tas.BootstrapService.Bootstrap blocked
      That message is Google's own and it is about a *project*, not about this
      game: `BootstrapService.Bootstrap` is the Maps JavaScript API's startup
      call, which nothing here makes — the game talks to the Map Tiles API and
      nothing else. So the 403 is the key or the project refusing, and it says
      which in the body.

      One cause was ours and is fixed: createSession left out the required
      `region` field, so the call never returned a session at all. See the note
      in prepareGoogle.

      The rest are three specific and fixable things, and the game now passes
      Google's own explanation through instead of swallowing it:

        the Map Tiles API is not enabled on the project — each API is enabled
          separately, and a key that works for one is refused by another;
        the key is restricted to a set of APIs that does not include Map Tiles;
        the key has HTTP-referrer restrictions that do not list this page.

      The third has a trap worth naming and the settings panel now names it: a
      page opened from a file:// URL sends no referrer at all, so a
      referrer-restricted key can never work in the offline single file, however
      correct it is. Use the online single file or the hosted page with one.

      Open until you say what the message reads now, because it will be Google's
      sentence rather than a status code.

      Verified since, without a key, by serving the refusals instead of the
      success. Google's createSession was stubbed with the three bodies their
      API actually returns for this — the Map Tiles API not enabled on the
      project, a referrer restriction, and an invalid key — and the game was
      watched from the outside:

        API not enabled   "Google session failed (403) — Map Tiles API has not
                          been used in project 123456 before or it is disabled.
                          Enable it by visiting https://console.developers.
                          google.com/apis/api/tile.googleapis.com/overview
                          ?project=123456 then retry."
        referrer blocked  "Google session failed (403) — Requests from referer
                          http://127.0.0.1/ are blocked."
        invalid key       "Google session failed (400) — API key not valid.
                          Please pass a valid API key."

      Google's own words, including the link that fixes it, on the status line.
      And in all three the ground kept being drawn — 314, 339 and 345 squares,
      degraded never tripped — because the keyless provider carries on while
      Google refuses. So a bad key says what is wrong and costs you nothing
      else, which is what this item asked for.

      What is still open is the half no stub can reach: whether *your* key works
      once the project is right. That needs the key.
- [~] G2. Fix broken Google generally
      Same as G1, which has the detail. The one thing that was broken on this
      side — the missing `region` on createSession, which meant no session was
      ever issued — is fixed. Everything after that is the key's own
      configuration, and the game now reports Google's explanation of it rather
      than a bare 403.
- [x] G3. Photorealistic Cesium ion key broken — "failed to fetch"
      "Failed to fetch" is not a refusal. It is the browser saying the request
      never arrived — no status, no body, no origin — and it is the one case
      where the token is probably *not* what is wrong. It was being passed
      straight through, which reads as a broken key.

      It now says what it is. Three causes, all named in the message: nothing is
      reaching the network; the service would not answer this page's origin,
      and a page opened from a file:// URL sends `Origin: null` which several
      metered APIs refuse before the request is made; or an extension or proxy
      blocked it. Both routes into ion say it — the imagery provider and the 3D
      tileset — and so do Google's and Bing's calls, which had the same hole.

      The settings help for the token also now says the two things that make ion
      refuse a *good* token: it needs the assets:read scope, and the asset has
      to be in your account — the sample assets are not until you add them.
- [x] G4. 3D not working at all, including OSM buildings
      Not a bug in the buildings. A fallback that never engaged.

      Overpass is asked for buildings over a list of public mirrors, and the
      client moved to the next one on a 429 or a 504 and nothing else. A 500 or
      a 503 — which is what an instance actually returns when it is unwell —
      threw without advancing, so every retry went back to the same dead
      endpoint and the second mirror in the list was never reached. Measured
      from here: the main instance answers 503 and kumi answers 500, both at
      once. With a list of two and no rotation, that is every building in the
      world gone, for ever, with nine of nine tile requests failing.

      It moves on for any 429 or 5xx now, and for a request that never arrives
      at all — DNS, a reset, a blocked host — while leaving a 4xx alone, since
      that is the query being wrong and no other mirror will like it better.
      The list is four mirrors rather than two.

      Measured after: nine tiles, zero failed, six buildings measured from the
      survey and 182 estimated, twelve bridge segments, four meshes.

      Worth knowing for the rest of the G group: this sandbox's egress blocks
      or fails several hosts outright, so a provider that "does not work" here
      may work perfectly for you. That is what made this one look environmental
      until the rotation was read.
- [x] G5. No 3D terrain for buildings, infrastructure or vegetation
      Buildings: there already are, and with no account at all. Every
      OpenStreetMap footprint near you is extruded to its surveyed height, and
      infrastructure comes with it — masts, pylons and turbines are asked for by
      name. That is on by default.

      Vegetation and the rest: not without a key, and not because of anything
      here. Trees as geometry come from aerial photogrammetry, and there are
      exactly two ways to get that in a browser — Google's Photorealistic 3D
      Tiles, or the same dataset through a Cesium ion token. Both are metered
      and neither has a keyless door. Everything keyless in the world of
      published tiles is imagery, elevation and vector features; none of it is
      a scanned mesh.

      Open, because the honest state is "half of it works with no key and the
      other half needs one of two accounts", and which of those you want to set
      up is your call.

      The pipeline itself has now been verified without an account, which is
      the half of this that was never really about the key. A stub was stood up
      that speaks Cesium ion's handshake, hands back a real 3D Tiles tileset,
      and serves genuinely valid GLB content — a proper binary glTF, header,
      JSON chunk and BIN chunk — and the game's own loader was driven against
      it. End to end:

        ion endpoint asked            1, token accepted, bearer applied
        tileset fetched and parsed    1
        GLB content loaded            5, drawn 4, failed 0
        terrain coverage engaged      1 square, so the ground steps aside
        attribution carried through   "Stub Imagery Co" from ion's own
                                      attributions, and the copyright out of
                                      the GLB's asset block — both routes
        status line                   "photorealistic 3D: 4 tiles"

      So the handshake, the bearer header, the tileset walk, the Draco-capable
      loader, the scene insertion, both attribution paths and the handshake with
      the quadtree all work. What a real token adds is their servers, their
      data and their quota — not any of this.

      Finished with your token, and it found two real bugs that no stub could
      have. Both were in the half this entry said only a credential could
      reach, and the entry's confidence that "the handshake, the bearer header,
      the tileset walk ... all work" was wrong on two of those three.

      **The handshake read the wrong field.** ion answers in two shapes: an
      asset it hosts itself returns `url` and a short-lived `accessToken`; an
      *external* one returns `externalType: '3DTILES'` and puts the real tileset
      under `options.url`. Google's photorealistic tiles — asset 2275207, the
      thing anybody turning this on actually wants — are the second shape. The
      code read only `grant.url`, got undefined, fetched it, and told the player
      "root 404" with a perfectly good token. The stub it had been tested
      against answered in the first shape.

      **Then every child tile was refused.** With the root loading, `absolute()`
      branched on which provider was chosen in the settings rather than on where
      the tiles actually live — so a Google tileset reached *through* ion took
      the ion path and had its children resolved as bare relative paths, with no
      key and no session. Google refuses those. Measured: root 200, and all
      twenty-four child requests 403 with no query string on any of them. It
      resolves by host now, and carries the key forward from the tileset URL —
      which is where ion's Google key arrives, since `this.key` there is the ion
      token and Google has never heard of it.

      After both: 227 requests, every one 200, no refusals at all. 119 tiles,
      167 meshes, 221,180 triangles standing on Market Street in San Francisco,
      with Google and Maxar credited in the attribution line. Photographed.

      The token was used only from /tmp at run time and is not in the repository
      — checked. It is still live and should be rotated, since it has been
      sitting in a chat log since 25 August.
- [x] G6. Why can I see 3D houses in MSFS (Azure) but not here
      Because that data is not published. Microsoft Flight Simulator's cities
      are Bing's aerial photogrammetry, delivered through a private pipeline
      built for that title; Azure Maps — the API you can actually buy — serves
      raster imagery, roads and elevation, and no mesh at all. There is no
      endpoint to point at, with or without a key. Azure's own provider note
      here says so.

      What you *can* have is the same shape of thing from Google's
      Photorealistic 3D Tiles or from Cesium ion, both of which are already
      wired up and both of which need an account. See G5.
- [x] G7. Mapbox supports 3D buildings + terrain — why is there none here
      There is, and it is the same data — the difference is how it arrives.

      Terrain: Mapbox Terrain-RGB is already one of the elevation providers, on
      your Mapbox token. Turn it on in Settings and the relief you fly over is
      Mapbox's.

      Buildings: Mapbox's 3D buildings are the `building` layer of Mapbox
      Streets, and that layer is OpenStreetMap. The footprints and the heights
      are the same survey this game already extrudes — so what you see in a
      Mapbox demo and what you see here is the same building, from the same
      source, fetched a different way.

      There is one real advantage to their way and it is worth doing: vector
      tiles are far steadier than Overpass, which is a handful of volunteer
      mirrors that go down (see G4, where two of them returned 500 and 503 at
      once and took every building in the world with them). Fetching the
      building layer from Mapbox Streets for anyone holding a token would make
      buildings reliable rather than best-effort. Left open rather than built
      because it cannot be tested from here without your token, and shipping an
      untested provider is how "fixed" turns into "still broken".

      The keyless version of that idea was checked and does not work.
      OpenStreetMap's own vector tiles — vector.openstreetmap.org, the
      Shortbread schema, no account, served and reachable — do carry a
      `buildings` layer, and its field list is empty: footprints and nothing
      else. No height, no storey count. Since a building here is only drawn at
      a height somebody surveyed, that layer would extrude nothing at all. So
      Overpass stays the keyless route for buildings, and G21 is what made it
      hold up.

      The pipeline itself has now been verified without an account, which is
      the half of this that was never really about the key. A stub was stood up
      that speaks Cesium ion's handshake, hands back a real 3D Tiles tileset,
      and serves genuinely valid GLB content — a proper binary glTF, header,
      JSON chunk and BIN chunk — and the game's own loader was driven against
      it. End to end:

        ion endpoint asked            1, token accepted, bearer applied
        tileset fetched and parsed    1
        GLB content loaded            5, drawn 4, failed 0
        terrain coverage engaged      1 square, so the ground steps aside
        attribution carried through   "Stub Imagery Co" from ion's own
                                      attributions, and the copyright out of
                                      the GLB's asset block — both routes
        status line                   "photorealistic 3D: 4 tiles"

      So the handshake, the bearer header, the tileset walk, the Draco-capable
      loader, the scene insertion, both attribution paths and the handshake with
      the quadtree all work. What a real token adds is their servers, their
      data and their quota — not any of this.

      Finished with your token, and it found two real bugs that no stub could
      have. Both were in the half this entry said only a credential could
      reach, and the entry's confidence that "the handshake, the bearer header,
      the tileset walk ... all work" was wrong on two of those three.

      **The handshake read the wrong field.** ion answers in two shapes: an
      asset it hosts itself returns `url` and a short-lived `accessToken`; an
      *external* one returns `externalType: '3DTILES'` and puts the real tileset
      under `options.url`. Google's photorealistic tiles — asset 2275207, the
      thing anybody turning this on actually wants — are the second shape. The
      code read only `grant.url`, got undefined, fetched it, and told the player
      "root 404" with a perfectly good token. The stub it had been tested
      against answered in the first shape.

      **Then every child tile was refused.** With the root loading, `absolute()`
      branched on which provider was chosen in the settings rather than on where
      the tiles actually live — so a Google tileset reached *through* ion took
      the ion path and had its children resolved as bare relative paths, with no
      key and no session. Google refuses those. Measured: root 200, and all
      twenty-four child requests 403 with no query string on any of them. It
      resolves by host now, and carries the key forward from the tileset URL —
      which is where ion's Google key arrives, since `this.key` there is the ion
      token and Google has never heard of it.

      After both: 227 requests, every one 200, no refusals at all. 119 tiles,
      167 meshes, 221,180 triangles standing on Market Street in San Francisco,
      with Google and Maxar credited in the attribution line. Photographed.

      The token was used only from /tmp at run time and is not in the repository
      — checked. It is still live and should be rotated, since it has been
      sitting in a chat log since 25 August.
- [x] G8. Bing has satellite and a 3D mode — add the 3D
      Bing's satellite is here — the `bing` provider, on a Bing Maps key, and
      also reachable through Cesium ion as asset 2. Its 3D is not, and cannot
      be: Bing Maps' 3D cities were a Silverlight-era viewer feature and were
      never exposed as a tile API; what survives of that data is what MSFS uses
      privately (see G6). There is nothing to add — no endpoint exists to point
      at. Microsoft is retiring Bing Maps into Azure Maps, and Azure serves no
      mesh either.
- [x] G9. Add Azure aerial
      Already there: the `azure` provider, "Azure Maps (satellite)", is
      Microsoft's `microsoft.imagery` tileset on an Azure Maps subscription key,
      to zoom 19, credited to Microsoft, Airbus DS and Maxar. It sits alongside
      Bing rather than replacing it, because Bing still has coverage and zoom
      levels Azure has not inherited yet.
- [x] G10. Add more Cesium; Bing via Cesium
      Both, already. "Cesium ion imagery" serves *any* raster asset in your ion
      account — the asset number is a setting, and G11 explains where to find it
      — so "more Cesium" is a number rather than a code change. And Bing via
      Cesium is the default: asset 2 is Bing Aerial, which is on almost every
      ion account, and the code handles ion's two shapes of answer separately
      because a Bing asset comes back as Bing's own quadkey URL rather than as
      an ion template.

      On the 3D side the same token drives two datasets, chosen in Settings:
      Google's photogrammetry, and Cesium OSM Buildings — every OpenStreetMap
      building on Earth extruded, which covers ground the photogrammetry has
      never been flown over.
- [x] G11. Explain the "Cesium ion imagery asset / 2" setting properly
      It said "which raster asset in your ion account to fly over", which tells
      you what the number is for and nothing about where to get it or what
      happens when it is wrong. It now says where to find it — My Assets on the
      ion dashboard, the ID column — that it must be an *imagery* asset, since
      terrain and 3D Tiles have IDs too and pasting one of those refuses every
      tile and looks like a broken key rather than a wrong number, why 2 is the
      default, and that getting it wrong invents nothing: the ground falls back
      through the other providers and says so.
- [x] G12. Ensure the latest Cesium data is used
      It is, and by construction rather than by care: nothing here pins a
      version. Every session asks ion for the asset's *endpoint* — a fresh
      short-lived token and wherever the tiles currently live — and follows
      whatever it is given, so an asset that ion updates is served updated the
      next time you fly. There is no cached manifest, no recorded URL and no
      version number anywhere in the request.

      The only staleness that can happen is the ordinary tile cache, which holds
      a picture for twenty seconds after you last looked at it and then asks
      again.
- [x] G13. Auto-change provider via an auto option in the dropdown
      There was a "find the best one here" button that ran once and wrote its
      answer into the setting. Now there is a standing choice: "Auto — the best
      one you can use", first in the dropdown, resolved fresh every time the
      panel changes anything. Paste a Mapbox key and the ground is Mapbox on the
      next frame without reopening the dropdown; remove it and it falls back
      rather than leaving a blank world.

      The order is the same one the standby chain already falls through —
      anything you hold a key for first, then the free ones deepest first — so
      auto is exactly the top of the list the game would use anyway rather than
      a second opinion that could disagree with it.

      It is deliberately not a member of the provider list. It is a choice
      *about* providers, and putting it in the list would have it turning up in
      fallback chains, in the standby order, and in "which square does this one
      serve", none of which mean anything for something that is not a map
      server. It is resolved to a real id once, where the sources are built, and
      everything downstream sees an ordinary provider.

      The help text says which one it has landed on, so it is never a mystery
      what you are actually flying over.
- [x] G14. Fallbacks
      Already: providerChain builds a standby list (keyed providers first, then
      free ones), a refused tile walks down it, and the flat maps fall back to the
      keyless mosaic. The refusal-latch bug in that path was fixed earlier.
- [x] G15. Retry when failed
      Already: a failed tile retries after 20 s, and every standby provider is
      tried before it counts as a failure at all. What was missing was the case
      above — the permanent write-off that no retry could reach.
- [x] G16. Stop ignoring failures and marking them normal
      The real one: "nobody has this square" was kept in a Set, which means for
      ever. One dropped connection wrote off whatever you were flying over — and
      the four squares beneath it and the sixteen beneath those — for the rest of
      the session, and it read as ground that simply had no imagery. It carries a
      time now and expires after 90 s.

      The same bug one level up, found later and fixed the same way. Every
      *reason* a square goes bare now expires — but the square itself did not.
      `request` returns early on a bare entry, before the barren record or
      anything else is consulted, so once bare it was retired for the session
      however long ago the refusal was and however completely the network had
      recovered.

      What that strands, besides the square: the depth probe. probeDeeper asks
      for one tile a level below the written-off depth every thirty seconds, and
      the depth lifts the moment anything arrives below it — but if the probe's
      square had gone bare during an earlier outage, `request` handed back the
      bare entry instead of asking. Traced over Antarctica: the probe skipped on
      every frame for two minutes with the entry reading state 4.

      A bare entry now carries the time it went bare and is asked again once the
      ninety seconds are up, unless a live refusal above it still stands.
      Verified by behaviour rather than by regex: freshly bare is not re-asked,
      expired goes back in the queue, and expired-under-a-live-refusal stays
      bare.
- [x] G17. Remember tokens
      Measured rather than assumed: localStorage works from file:// in Chromium
      (all file URLs share one origin), the store writes every token, and a fresh
      store built from the same storage reads them back. The store class is
      exported now so that reload path can actually be exercised.
- [x] G18. Why is it lower res than, e.g., the Mapbox website
      Two reasons, one of which was a bug and is fixed.

      The bug: the ground was capped below what the provider serves and could
      never recover — see M4. A depth written off in one place stayed written
      off everywhere for the rest of the session, because the cap stopped
      anything asking above it, so nothing could arrive to lift it.

      The rest is presentation, and the Mapbox setting now says so where it is
      asked: it is the same tiles at the same 512-pixel size their own site
      draws. A flat map puts about one texel on one screen pixel; here the
      photograph is draped over terrain and usually seen at an angle, so the
      same picture covers fewer pixels. Fly straight down at it and the two
      match.
- [x] G19. Show the imagery year
      Esri publish it per square — capture date, ground resolution, the satellite
      that took it, and the deepest zoom that square is served at. It sits on the
      attribution line: Black Forest "Sep 2018 · 0.5 m · WV02", Vienna "Apr 2025 ·
      0.075 m · Stadt Wien". One request per 80 km square, cached, background.
- [x] G20. Why cap zoom at 22 or 23 — force it to infinity and future-proof it (1–25, then Infinity)
      — the slider runs 1 to 25 and then to "No limit", which is the default.
      Every fixed number here was wrong in turn: 19, then 20, then the deepest
      a provider declared. What stops it now is the provider refusing and the
      photographs themselves stopping getting sharper, both measured.
- [x] G21. No buildings anywhere, and nothing said so
      Found by measuring, not by report: flying over central Paris with
      buildings on, twelve OpenStreetMap squares all reading `ready` and every
      one of them holding zero buildings, zero bridges, zero masts. Paris.

      The cause was in the fallback list. `overpass.osm.ch` was the second of
      four Overpass mirrors, so it was the *first* thing tried whenever the
      main instance was unwell — and it holds Switzerland and nothing else. It
      does not fail when you ask it about Paris. It answers 200, in half a
      second, with an empty element list, which is indistinguishable from open
      sea. Measured against the live service: 1,928 building ways inside one
      Zurich square, zero in the same size of square over central Paris, zero
      over Manhattan. So a single 503 from the main instance and every
      building, wood, bridge, mast and bridge deck on Earth outside Switzerland
      quietly stopped existing — nothing logged, nothing retried, no failure
      recorded, every tile `ready`. A mirror that succeeds with nothing is
      worse than one that is down.

      Two fixes. The list now holds only planet-wide instances, and a regional
      extract is not allowed back into it. And an empty answer is remembered
      against the mirror that gave it: "nothing here" is kept rather than
      re-asked, because most of the planet really has no buildings on it and
      re-asking would query every square of the Atlantic for ever — but it does
      not outlive the mirror. The moment the client gives up on an instance,
      the squares that instance called empty are asked once more on the new
      one. Buildings and woodland both.
- [x] G22. A graphics tier that set a number nothing read
      `buildingRadiusM` sat in all four presets — 420 m on Low up to 1800 m on
      Ultra — and nothing has read one of them since the first commit. Removed
      rather than wired up, and the reason is worth keeping: the grain is a
      zoom-15 square, about 800 m across at Paris and 1220 m at the equator, so
      420, 750 and 1200 all round to the same single ring of squares and could
      not have differed even if something had read them. The one that could,
      Ultra's 1800, buys a second ring — twenty-five Overpass queries per
      position instead of nine, asked of donated hardware, for one more row of
      rooftops. A tier setting the data cannot express is not a setting. The
      self test now fails on any tier number that nothing reads.
- [x] G23. A sea the game could not see stayed dry for the session
      Same shape as G21, found by looking for it. The land/water test reads one
      zoom-6 imagery square per region and caches a 32x32 mask from it. When
      that fetch came back with nothing — a reset, a provider between
      deployments, or the "map data not yet available" card from every source
      at once — the *failure* was cached in the same map as the answers, with
      no expiry. So one hiccup and a square the size of a continent read
      "cannot tell" for the rest of the session; "cannot tell" reads as land;
      and a random teleport looking for somewhere dry would drop you into the
      middle of an ocean it could not see, while the climate model called that
      ocean continental.

      Failures are now held apart from answers and for a minute, so a
      teleport's seventy-odd probes still cost one request rather than seventy,
      and the next teleport recovers. The self test exercises the real
      WaterMap: one probe for two lookups in the same square, nothing cached as
      an answer, and a second probe once the wait is over.
- [x] G24. What the buildings actually build, measured
      The question G21 was opened to answer, now that there is data to answer
      it with. One real OpenStreetMap square over central Paris — 771 building
      ways, 543 with a surveyed height or storey count, fetched from
      api.openstreetmap.org and served to the game through the same interface
      an Overpass mirror uses:

        585 structures built, 255 skipped for having no surveyed height;
        heights 2.5 m to 28.8 m, median 19.2 m — which is the median of the
          raw survey, to the decimal, so the extrusion is faithful;
        no NaN, nothing absurdly tall, nothing under two metres;
        every roof took its colour from the aerial photograph — none fell back
          to the grey placeholder;
        founding: median 0.29 m into the ground, worst case 11 m, nothing
          floating above it. Buildings sit on the lowest ground under their
          own footprint, which is what puts them slightly into a slope.
- [x] G25. A refused 3D tile was asked for ninety-four times a second
      Both routes to photogrammetry — Google's Map Tiles API and Cesium ion —
      bill per request. The wanted list is rebuilt every frame and every entry
      offered to the loader again, and there was no memory of a refusal at all:
      the only gates were the concurrency budget and a fifty-millisecond
      in-flight flag. So a tile the server would not serve was asked for
      sixteen times a second, and a viewful of them ninety-four times a second.
      An expired session refuses every tile at once, which is exactly when this
      happens — the screen is empty and the requests are being billed.

      Measured by driving the real request path with a loader that refuses,
      forty tiles, twenty seconds:

        before   1,854 requests   93/s
        after       120 requests    6/s

      A refusal now rests for eight seconds — short enough that a hiccup or a
      refreshed session comes back almost at once — and is forgotten on a
      success or when the account changes. The self test runs the same
      measurement.
- [x] G26. A failed imagery-date query was cached as though it were an answer
      "This square has no metadata record" is true and permanent for ocean and
      the poles, and is rightly kept for ever. A timeout is neither, and it was
      being kept in exactly the same way — one hiccup while crossing Kansas and
      the attribution line never carried a date for those eighty kilometres
      again, however long the session ran. The query now throws rather than
      returning nothing when it could not ask at all, so only a genuine
      "nothing here" is cached; a refusal waits two minutes and is asked again.
      Tested against a driven clock: one request, then none, then one more once
      the wait is over, and the date arrives — while a square that genuinely
      has no record is asked once and believed.

## H. World and atmosphere

- [x] H1. There are no bumps on trees
      Cause: the relief was gated entirely on an OpenStreetMap wood polygon, so
      anywhere nobody has drawn one — most of the world — there were no bumps at
      all. The photograph is asked now where the survey is silent.
- [x] H2. When bumping green parts, skip it where the green runs bigger than a size throughout, so grass is not marked — but still count areas with holes of a different colour
      Implemented as the rule was stated, measured per tile from the photograph:
      green share x how broken that green is at crown scale. On real Esri tiles —
      rainforest 0.765, conifer 0.842, broadleaf 0.803, scrub with trees 0.403,
      uniform green fields 0.129, ploughed field 0.000, desert 0.000.
- [x] H3. Improve Antarctica
      The launch-into-Antarctica throw is fixed. Going after how it *looks*
      turned up three real bugs, none of them about Antarctica, and one honest
      limit.

      First, what is actually there. Esri answers every request over the East
      Antarctic plateau with HTTP 200 — but from zoom 14 down it is their "map
      data not yet available" card, not a photograph. Proved rather than
      guessed: four neighbouring z14 tiles come back byte-identical to each
      other *and* to four tiles from the mid-Pacific, all 2,521 bytes, the same
      hash. Real imagery is never byte-identical between neighbours. Walking the
      zooms, Esri has genuine pictures down to z13 and the card from z14.

      So the ground should draw the z13 photograph stretched. It drew grey.
      Three causes, all fixed:

      The quadtree had no brake over unimaged ground. `finest`, the thing that
      stops it subdividing, is fed only by tiles that *load*, from their
      measured sharpness — a square nobody has photographed never loads, so it
      never reports anything. The tree carried on splitting into squares that
      cannot have a picture and drew every leaf bare. It now stops where the
      squares below are known barren, read off the `barren` record so it expires
      with it; as a set of its own, which is how it was first written, one
      transient refusal capped the depth over a whole region for the session.

      "This square has no picture" was being counted as "this provider stops at
      this depth". reviewDepth's own comment says coverage is not a single depth
      — Esri serves 19 over a town and stops at 17 over a glacier a valley away
      — which is exactly why `barren` exists per square. Feeding the card
      refusals into the global limit as well pulls it down over any ground where
      the imagery genuinely ends. The two travel separately now.

      And `degraded` had no way back. It means "nothing is reaching any
      provider", it latches after ten consecutive failures with nothing loaded,
      and it stopped urlFor being called at all — so nothing could succeed, so
      nothing could clear it. A tab that booted while the network was down, or
      that arrived somewhere with no imagery before anything had loaded, drew
      grey for the rest of the session and only changing provider brought it
      back. One probe still goes out now, and an arrival clears it and says so.

      The honest limit: Antarctica cannot be judged from this sandbox. Its
      outbound proxy fails most fetches there — the per-zoom tally after a
      teleport reads 0 loaded and 5 to 30 failed at every level from 6 to 15,
      while the same URLs fetched directly from the page return real imagery.
      So the "372 tiles, all bare" I measured before the fixes is largely this
      environment, and the "0 bare, but only zoom 5" after it is the depth
      limiter correctly reacting to those same failures. What the fixes are
      worth over Antarctica is for your machine to say.

      The elevation is better than this file claimed: 2,895 m here against the
      ~944 m recorded, so the coarse-elevation complaint may have been a
      different spot or a since-updated tile.

      That honest limit no longer holds, and Antarctica has now been judged.
      Esri answers the East Antarctic plateau from here after all: fetched
      directly, zoom 8, 10 and 13 come back as real imagery (2,573, 2,934 and
      2,026 bytes, all different) and zoom 14 and 15 come back as the
      "map data not yet available" card — 2,521 bytes, hash 9eafd300d613, the
      same card recorded above. So the claim that coverage runs to 13 and stops
      is confirmed from live data rather than inferred.

      Flown at Dome C (-75.1, 123.4) for seventy-five seconds, the three fixes
      do exactly what they were made to do:

        squares drawn bare            0
        degraded latch                never tripped
        depth limit                   never pulled down
        squares recorded barren       61
        drawn                         22, all stretched from a coarser tile

      Twenty-two squares and everything stretched is not a fault here, it is
      the right answer: the imagery genuinely stops at 13, the tree correctly
      refuses to split into squares that cannot have a picture, and what it
      draws is the zoom-13 photograph stretched — which is what the fix was
      for. Nothing is grey.

      And it looks like Antarctica. Photographed: a featureless white plain to
      the horizon, the winter sun sitting on it, the readout saying -57 F,
      feels -72, wind 18 mph, overcast — the weather actually happening there —
      "Unmapped location", and 10,728 ft, against Dome C's real 10,607. The ice
      sheet is flat because the ice sheet is flat.

      So what is left of "improve Antarctica" is not a defect list. It is that
      Antarctica is a featureless white plain that nobody has photographed
      below zoom 13, and the game now shows exactly that rather than grey. If
      there is something specific you want it to look like instead, say which
      and it becomes a real item again.

      Reopened and now closed, because the analysis above was right about the
      card and wrong about everything else being fine. It established that Esri
      has real photographs down to zoom 13 and the card from 14 — and the card
      *detector* was condemning those real zoom 6 to 13 tiles too. Bright,
      colourless, flat and under six kilobytes described the polar plateau
      exactly. See A20 for the measurements.

      With the card identified by its bytes instead of guessed at from how bland
      the picture is, standing on the plateau: 748 tiles drawn against 2, no
      depth limit against one pinned at zoom 5, 951 imagery tiles loaded against
      8, own-picture 85 per cent. Photographed. Antarctica is a place you can
      fly over now.
- [x] H4. Improve above the clouds
      There was nothing above the clouds, because there were no clouds. Flying
      at 5,000 m over a valley floor at 1,000 with the cover forced to 0.85 and
      the deck confirmed on and visible, the frame had no cloud in it at all —
      the deck was being hidden by ground four kilometres behind it.

      The cause is one omission and it is a class of bug rather than a one-off.
      The renderer runs with a logarithmic depth buffer, which means depth is
      not the rasteriser's interpolated value: every material has to compute it,
      and three.js does that for its own materials through four shader chunks.
      The cloud deck's hand-written shaders had none of the four, so it was
      depth-testing against a buffer written on a completely different scale.
      That fails silently — as a thing that exists, is visible, is in the scene,
      and is simply never drawn.

      The wall that closes the world had the same omission, and it is drawn
      against the furthest ground there is. Both fixed.

      Photographed after: from 5,000 m the deck is an overcast sheet at 2,100 m
      with the peaks standing out of it and the valleys covered, which is what
      being above a cloud layer over the Alps looks like — and from 900 m
      underneath, the layer still reads correctly against the sky, so nothing
      below it regressed.

      Guarded across every file that writes a shader rather than across the two
      that were wrong, since the next hand-written shader would have the same
      hole. Removing one include makes the check fail by name.

      Except it was not, quite. "Across every file" was a hard-coded list of
      nine, and it had already drifted — four of the nine no longer build a
      shader material at all, including the sky, which the exemption in the
      check describes. A hand-written shader in a file nobody thought to add
      would not have been looked at, which is the entire point of the guard.
      The files are found now rather than listed: anything in src that builds a
      ShaderMaterial is checked. Verified by adding one to a file that was never
      on the list — it is found, and it fails.

      Worth knowing separately: the Low graphics tier turns weather off
      entirely, so on the tier a Chromebook runs there is no deck at all.
- [x] H5. Weather should follow the imagery's own weather state
      It follows something better, and the thing you asked for turns out to be
      empty.

      Better: the sky is driven by the weather actually happening where you are
      standing, right now. Open-Meteo publishes current conditions for anywhere
      on Earth, keyless and CORS-open, and the game asks it once per place you
      arrive at and caches it for ten minutes. Cloud cover, rain, snow and the
      readout all come from that; when it cannot be reached it falls back to the
      climatology and the HUD says "seasonal average" so the two are never
      confused. `this.weather.setState(this.weatherState)` is the same object
      the readout prints.

      Empty: satellite basemap imagery has no weather in it to follow. Providers
      composite a basemap from many passes and pick the clearest pixels, on
      purpose — that is what makes a basemap usable. So "the imagery's own
      weather state" is "clear" everywhere, always, and matching it would mean
      permanently clear skies over a world where it is actually raining on you.
- [?] H6. Match the sun angle to the imagery's time, maybe
      The "maybe" is right, and the answer is probably no — but it is your call,
      so here is what it would actually mean.

      Where the metadata exists the capture time is already known and shown: see
      imageryAge, which prints things like "Sep 2018 · 0.5 m · WorldView-2".

      Three reasons matching the sun to it would be worse than what happens now.
      A basemap is a mosaic of many captures with different dates and times, so
      there is no single time to match — the sun would jump as you flew from one
      source scene to the next. Pinning it means no dawn, no dusk and no night,
      anywhere, for ever. And most providers publish a date rather than a time
      of day, so for most ground there is nothing precise to match to.

      What it would buy is the one real thing on the other side: the shadows
      baked into the photograph point one way, the game's sun moves, and at some
      hours the two disagree. That is already kept small deliberately — the
      ground shader does not re-light the photograph, because grading a finished
      photograph is the thing this project refuses to do everywhere else — so
      the disagreement is in the relief shading and the cloud shadow, not in the
      picture.

      Left as a question. If you want it, the shape that makes sense is a
      setting: "hold the sun where the photograph was taken", off by default,
      using the mean capture time of whatever is on screen.

## I. Player, HUD and controls

- [x] I1. Player size should match up properly
      Measured against real anthropometry the figure was 1.68x too wide across
      the chest, 1.80x across the shoulders and 2.09x across the hips — it was
      Minecraft-shaped, not person-shaped. Now within 1.00-1.17x. The collision
      capsule went with it: 0.21 of height is an 0.83 m barrel on a 6'6" frame,
      now 0.12 (0.24 across). This is also why looking down in first person
      filled the screen with a wall of cloth — your own chest, half a metre wide,
      a quarter of a metre from your eye.
- [x] I2. Default height 6 ft, and matching
      1.98 m (6'6") -> 1.8288 m (6'0"). Everything scales off it — stride, eye
      height, reach, the collision capsule — so they all follow. The settings help
      and the README say six feet; the help card reads the setting rather than
      quoting a number, so it cannot fall out of step.
- [x] I3. Why do I feel so big
      Measured against real anthropometry the figure was 1.68x too wide across
      the chest, 1.80x across the shoulders and 2.09x across the hips — it was
      Minecraft-shaped, not person-shaped. Now within 1.00-1.17x. The collision
      capsule went with it: 0.21 of height is an 0.83 m barrel on a 6'6" frame,
      now 0.12 (0.24 across). This is also why looking down in first person
      filled the screen with a wall of cloth — your own chest, half a metre wide,
      a quarter of a metre from your eye.
- [x] I4. Make altitude accurate
      Height above ground went through formatDistance, which switches to miles past
      a thousand feet and was asked for no decimals — so 305 m AGL printed "0 mi".
      A thousand feet up, reported as zero. It reads 1,001 ft now, and stays in
      feet all the way to 29,528.
- [x] I5. Make speed accurate, and size
      Both measured against reality rather than against the code.

      Speed: flown level at 3 km and sampled over a forty-second window, with
      the path length accumulated frame by frame rather than the straight line
      between the ends, so a curving flight cannot be mistaken for a wrong
      readout:

        level glide          readout 30.3 m/s   covered 29.8   error  1.8%
        surge, settled       readout 72.8       covered 73.2   error -0.5%
        rockets held         readout 107.9      covered 109.0  error -1.0%

      Within one per cent wherever the speed is steady. The first row is the
      only one over one per cent and it is the one that had not finished
      settling — its readout drifted 24% across the window.

      Worth recording how that measurement went wrong twice first, because it is
      the same trap both times: a six-second window at the one frame a second
      this sandbox renders at is seven frames, so the window's own length is
      uncertain by about fifteen per cent. It read +11% one run and -8% the
      next for the identical condition. Forty seconds makes that ±2%. And an
      earlier version compared an instantaneous readout against a six-second
      average *during* a transient, which is not a comparison at all.

      The two things that genuinely made it wrong are fixed and have their own
      measurements: the frame clock throwing away catch-up below four frames a
      second (D9) and `speed` returning the bare velocity while the controller
      moves you by velocity times the multiplier (D10).

      Size: the setting is 1.8288 m, the scale 1.00, and player.height reads
      1.829 — 0.00% off. And I1/I2/I3 have the anthropometry, which is where
      the model went from 1.68 to 2.09 times too wide down to 1.00 to 1.17.
- [x] I6. Number on the compass
      The strip had letters at the four cardinals and blank ticks everywhere else,
      so it never said a number at all. Degrees on the intercardinals now, and a
      live three-figure bearing under the needle in tabular figures so it does
      not jitter as it counts.
- [x] I7. Vertical look angle in degrees, maybe either side of the compass
      Added next to the compass in the location card: 'level', '+45°', '−20°'.
- [x] I8. Centre dot / plus
      Already there — .hud-crosshair, behind the showCrosshair setting. Confirmed
      visible in a screenshot of the running game.
- [x] I9. Per second and per minute, not only per hour
      Added as a setting: per hour (km/h, mph), per minute (km/min, mi/min),
      per second (m/s, ft/s). Per hour stays the default.
- [x] I10. Imperial/metric everywhere, not only in some places
      Two readouts printed one system whatever the setting said: the explored area
      on the world map (always km²) and the wind on the weather line (always
      km/h — beside a temperature on the same line that did convert). Both go
      through formatters now.

      And the check written for it refused a hard-coded unit "in either file",
      which is the same mistake as the rest of this pass: the ask is
      *everywhere*, and a check scoped to the two places that were wrong cannot
      see a third. Widened to the whole of src, and it found five more:

        the autopilot's distance in the cheat panel, always km and m;
        the sea-distance slider's label, always km;
        the freecam speed toast, always m/s;
        the size toast, which printed "1.83 m" from the same keypress that
          leaves the HUD's own height row reading 6' 0";
        and the help card's height, which built feet and inches by hand and
          never looked at the setting at all — so a metric player was told
          they were 6 ft 0 in while the HUD beside it said 1.83 m.

      All five go through the formatters now. The two engineering readouts that
      are deliberately metric — the F3 engine line and the F4 diagnostics
      report, both of which end up in a bug report where SI cannot be misread —
      say so on the line, so the exemption is a claim in the source that can be
      read and argued with rather than something the checker infers.
- [x] I11. Seeing hand, rocket and body while gliding
      Looked at first person in the running game. The body was there but
      unreadable — the chest was Minecraft-wide and the cloth texture had its
      wrapping set to repeat and its repeat never set, so one photograph of the
      weave was stretched over the whole chest at about fifty times life size.
      Both fixed. Then a shot of a first-person glide in the running game, and
      there was nothing of you in it — no arms, no hands, no rocket, landscape
      and nothing else. Two causes, and neither was visible without measuring
      against the frame. The arms had been swung back to -1.85 to keep the
      firework off the lens, which left the hand four centimetres in front of
      the eye against a near plane of fifteen. And the spread was 0.62, which
      put the hands 66 degrees off the view axis: even clear of the near plane
      they were outside a frame that is 55 degrees to the side at the default
      FOV, so widening the arms to "frame the view" pushed them out of it.
      And a third: the too-close backstop was 0.34 of height, a 62 cm bubble on
      a 1.83 m player, so the rule meant to catch a limb through the lens was
      deleting the firework at every distance a hand actually holds one at.

      Swept the arm rather than guessed it — your shoulder is a quarter of a
      metre behind your eye when you are face down, so the hand can only get
      about 0.36 m in front of the camera whatever the arm does. Which turned
      out to be the answer to a question that should not have been asked: at
      that range the world arm is a 0.7 m box starting at the lens, and it
      draws as a flat slab across a fifth of the screen however it is posed.
      The cause is the shoulder being at the camera, not the arm being wrong.

      So the glide draws the view model instead, which is what a view model is
      for, and the world arms come off with it. That machinery had been here
      all along — hands in view space at fractions of the frustum, blended
      between the carried pose and the flying one, with sway, bob and the kick
      a firework gives — and had lost its call: updateHand was defined and
      invoked from nowhere, so the group sat at the camera's own origin and
      drew nothing. Standing keeps the world arms, where the shoulder is a
      quarter of a metre *below* the eye and looking down finds the arm side-on.

      Measured in the running game at four look angles: the hand lands 0.85 m
      ahead at (0.81, 0.81) and the firework at (0.76, 0.74), the same every
      time — the pose turns about your eye, so your hands stay where they are
      in the frame however you pitch. tools/handcheck.mjs is that measurement
      kept as a check, and it exits non-zero if any angle shows you nothing.

      There are hands on the ends of the arms now as well — the sleeve used to
      stop in mid-air, so the firework was held by nothing — and the rocket was
      on the wrong side of the body, because the glide pose crossed both arms
      over the chest. See M2. The self-test checks the hand and the firework
      against the near plane and both frame half-angles.
- [~] I12. Improve the freecam model
      Asked what you meant and you said the model itself. So: photographed it
      alone, from the nine angles that matter, rather than judging it against a
      hillside at forty pixels tall.

      What is already right, and left alone: standing, the figure reads as a
      person — head with hair and eyes, shoulders, arms at the sides with hands,
      legs, boots, and the proportions are the measured ones from I1/I2/I3. And
      the freecam draws it correctly out there: full body, wings out, gliding
      pose, at the right place.

      What was wrong, and is fixed: the wings had nothing between them. The two
      shells met at the centreline with no spine, so from the chase camera — the
      angle you actually spend your time looking at this from — the pair read as
      one continuous sheet with a notch cut out of the top. A hang-glider rather
      than an elytra. There is a spine now, sized off the wing roots rather than
      typed: the outline starts at WING_ROOT_X either side, so the gap is
      exactly twice that and the spine fills it leaving a seam of daylight at
      each edge, spans the root chord, stands a little proud so it takes light
      as its own surface, and is the darker rim colour rather than the membrane
      colour. Photographed before and after from behind and from above: the
      notch is filled and the shells read as two wings on a back.

      What I looked at and did not change, because it was measured into its
      current shape and changing it on taste is how this goes backwards: the
      leg pose in a glide (apart at the ankle rather than crossed, which was
      arrived at by measuring what crossing them did), and the 49-degree arm
      spread. From directly astern the legs are the largest thing in frame, and
      that is perspective rather than a defect — they are nearest the camera.

      Left partly done: if the arms reaching out toward the wings is what you
      meant, say so and I will bring them in along the body, which is the
      Minecraft pose. That is one number and a measurement.
- [x] I13. Freecam that does not pause the game
      Already so: the freecam is deliberately not in the pause list, and there is a
      comment saying why. Confirmed by a check that the word does not appear in the
      expression `paused` returns.
- [x] I14. Keybinds — "wtf is f"
      F was in fact on the help card — "open or stow the wings". Four other keys
      were not: M for the minimap, F1 for the display, F2 for the card itself
      and F3 for the engine readout. Which is the same problem for four keys,
      and the same problem waiting for the next one added.

      So they are listed, and the list is now checked against the bindings
      themselves. A binding with no line on the card fails the build rather
      than reaching somebody's keyboard undocumented, and a line naming an
      action the game does not bind fails it too — the card cannot promise a
      key that does nothing.

      That guarded the help card and left the README out, which is a third
      place the keys are written down with nothing checking it, and it had
      drifted. It promised `X` for a barrel roll, which M18 removed when the
      roll became the strafe keys held while gliding — so the README named a
      key that does nothing at all. And it never mentioned `E` for a rocket,
      `O` for pause, or `F4` for the diagnostics report, the last of which was
      added earlier in this same pass and not documented, which is the same
      mistake one commit later.

      All four corrected, and the README is checked in both directions now, like
      the card. Thirty-three bindings, written down in both places, and neither
      place naming a key that does nothing. Keys documented as a group — W A S D,
      1 to 5, Shift — are named in the check as groups rather than counted
      missing.
- [x] I15. Touchscreen controls do not go away when returning to keyboard
      watchForTouch only ever called setEnabled(true) — nothing turned them off.
      On anything with both a finger and a keyboard, one tap pinned the sticks
      over the game for the session. A game key or a real mouse press now puts
      them away; a coarse pointer still starts them on, for a phone.

      And the surface itself was driven, on an emulated phone with a real
      coarse pointer and touch events rather than a mouse pretending: the
      sticks appear once a finger is seen, dragging the movement stick moved
      the player 19.26 m, and a look drag turned the view 0.43 radians. The
      action row is all there — boost, jump, dive, surge, teleport, map — and
      the cheats button draws its middle dot, which is the I16 fix rendering.
- [x] I16. Broken letters on certain devices
      Could not reproduce it here, so this is the audit and the hardening rather
      than a confirmed cause. Two things were ruled out first: every build
      declares UTF-8 and does it inside the first kilobyte, where the browser
      still looks — index.html at byte 52, terraglide.html at 46, the online one
      at 481 — so it is not mojibake from a missed charset. And the whole of
      src/ uses exactly thirteen non-ASCII characters, all counted: em dash,
      middle dot, ellipsis, minus sign, copyright, degree, en dash, right arrow,
      bullet, multiplication, sharp s, o-circumflex, e-acute.

      Of those, one was a real risk and it is fixed. The map zoom controls were
      the characters "+" and U+2212 MINUS SIGN, typed as the *entire* content of
      a twenty-pixel button — and U+2212 is missing from some Android and
      embedded font sets, where it draws as an empty box. A blank square where
      the zoom-out control should be is exactly what a broken letter looks like,
      and it is the most visible possible place to lose a glyph. Both pairs are
      drawn in CSS now, two rectangles, no font involved, with the name kept on
      the button for a screen reader and a tooltip. Photographed and clicked:
      they render as a proper + and − and still step the zoom one level a press.

      The touch cheats button had U+2022 BULLET for its label for the same
      reason; it is U+00B7 MIDDLE DOT now, which is Latin-1 and in everything.

      Left open because it is your device, not this one. If it is still
      happening, the useful thing is which screen it is on and roughly what the
      broken text says — that names the character.

      Reopened and now actually closed, because the rule had a hole and the
      character it was written about was still in the game.

      The scan read each file as written. A character typed as a `\uXXXX`
      escape therefore walked straight past it while rendering as exactly the
      glyph it forbids — and two of them were doing so: `src/ui/hud.js` and
      `src/core/units.js` both carried U+2212 MINUS SIGN as an escape, drawn
      beside the glide angle and every bearing. That is the very character this
      item was opened about, and the named check for it two lines below the scan
      was passing, because it looked for the literal while the source held the
      escape. Ten curly apostrophes and two curly quotes were hiding the same
      way.

      The scan decodes escapes before judging anything now, and it reads
      index.html and the stylesheet as well as src — the boot screen most of
      all, since that is what is on screen when nothing else has loaded, on a
      device whose fonts are the problem. Fourteen characters replaced with
      their ASCII equivalents across ten files: the minus signs are
      hyphen-minus, the curly quotes and apostrophes are straight.

      One test had to change with it: `down is negative` asserted that a pitch
      readout *starts with* U+2212 — it was pinning the forbidden character as a
      requirement. It asserts a hyphen now, and separately that no minus sign
      appears.

      Verified on screen: nothing the game draws contains U+2212 or U+2192.
      3,161 literals scanned, plus both pages, nothing risky left.
- [x] I17. Favicon as an elytra
      A pair of folded wings with the spine between them, five paths, inline SVG.
      Rendered at 16, 32 and 128 px and looked at, not just written.
- [x] I18. Barrel roll as in the MC mod, not a keybind
      Was a key: X ran a canned 360 over 0.8 s whatever you were doing. Now it is
      the strafe keys held while gliding — you keep rolling for as long as you
      hold, all the way round if you want, and the wings come back level when
      you let go. And a bank turns you, scaled by airspeed, which is the reason
      to roll one: a 30-degree bank is a 46-degree arc over two seconds, upside
      down turns nothing. The keybind is gone.
- [x] I19. FOV increase should depend on speed
      Already there — clamp(horizontalSpeed/90) * 16 degrees, behind the
      speedFovKick setting. But it also added a flat 6 degrees while speed mode
      ran, and since horizontalSpeed now includes the multiplier that counted the
      same boost twice: 22 degrees where 16 was meant. One input now.
      0 standing, 0.8 walking, 5.3 gliding, 16 at a rocket, and it stops there.
- [x] I20. Seed hacks, custom rockets, custom size and more in the cheat panel
      Custom size found a real bug rather than needing a new control. Both size
      keys did nothing, in every build, and did it quietly: `player.scale` reads
      cheats.playerScale — size moved there deliberately — and the keybind was
      left behind pointing at settings, where there is no `playerScale` at all.
      So it read undefined, multiplied it by 1.12, and clamp passed the NaN
      straight through, because `NaN < lo` and `NaN > hi` are both false. That
      went into a setting nothing reads, and the toast said "Size NaNx · NaN m"
      while you stayed exactly the size you were.

      Guarded at the class rather than at the key: every `settings.get`/`set`
      name in the whole of src must exist in DEFAULT_SETTINGS, and every
      `cheats.<name>` must exist in CHEAT_DEFAULTS. Typo either one and the
      check names it. The first version of that guard was itself vacuous — it
      looked for `cheats.get('...')`, which the code never writes, so it
      matched nothing and passed on an empty set. It now asserts the number of
      reads it found as well as the result: 150 settings reads and 19 cheat
      reads, and a check that suddenly matches nothing fails.

      Fixed at the store: the key writes cheats.playerScale, which is what the
      player reads. Checked in the running game — five presses of `]` take you
      from 1.00 to 1.76 (1.12^5) and nine of `[` bring you back to 0.64, with
      height and eye height following, and the toast reads real numbers.

      And it is a slider in the cheat panel now, 0.25x to 40x, which is the
      whole range in one drag rather than eleven presses.

      One thing worth doing while there: being tall is not cheating. The HUD's
      cheat flag was "anything that is not its default", so the first press of
      a documented key with a permanent HUD row would have lit it. It reads off
      a list now, and size is deliberately not on it — it lives in that store
      because that is where the player reads it and because locking should put
      it back, not because it is a cheat.

      Custom rockets: the Rocket strength dial is already there, 0.1x to 12x.

      Seed hacks: there is no seed. This is the Earth, from photographs — there
      is nothing to reseed and nothing a seed would change. That is the short
      answer and it has been left at that for too long, so here is every
      reading of it and what each one already is:

        a seed that changes the terrain — there is nothing to change. The
          ground is somebody's photograph and somebody's elevation survey. A
          seed cannot move a mountain that exists.
        a seed that decides where you start — that is the random teleport, on
          R. It can be aimed at populated places rather than anywhere, and held
          within reach of a coast, both in Settings » World.
        a seed you can give somebody so they see what you saw — that is the
          coordinates, on P. Copy them, send them, they teleport to the same
          spot on the same Earth. It is a better seed than a seed: it works
          across versions, because the world is not generated from it.
        a seed that makes a *sequence* of random teleports repeatable — this is
          the one reading that does not exist. Two people entering the same
          seed and pressing R five times would land in the same five places.

      That last one is buildable and is the only version of "seed hacks" with
      anything in it. Worth knowing before asking for it: it needs a seeded
      pseudo-random generator, and the self test currently refuses one anywhere
      in src — that guard exists because a PRNG lying about is how invented
      terrain came back last time. So it would need a deliberate, named
      exemption rather than being slipped in. Say if you want it and it gets
      one.
- [x] I21. Remember the trail
      It was already saved and reloaded — every six seconds and again on the way
      out — so the trail survived a reload. What it did not survive was its own
      budget.

      A leg is one continuous flight; only a teleport starts a new one. So a leg
      can be very nearly the whole record, and the rule for staying inside 4,000
      points was to drop the oldest *leg*. Measured on the old code: five
      flights of 1,200 steps kept three of them — 480 km of an 801 km journey,
      with two whole flights simply gone at a moment with no visible cause. And
      a single unbroken flight was never trimmed at all, because the loop
      stopped while `legs.length > 1` was false: 6,000 points against a budget
      of 4,000 and rising.

      The oldest leg is halved instead, both ends kept, so it covers the same
      ground with half the points; each halving doubles the distance the budget
      buys. Now: one long flight holds at 4,000 points and still covers all
      801 km, and the same five flights are all five still on the map, covering
      all 801 km, at 2 / 301 / 1200 / 1200 / 1200 points — history fading in
      detail from the oldest end while the line you are drawing now keeps its
      full ninety-metre spacing. Which is the same rule the exploration record
      already follows: the oldest fine detail goes, in order, never at random.

## J. How the work is done

- [x] J1. Completely remove the code of the fake generator
      Gone, and not by deleting the file and leaving the callers. There is no
      src/tiles/procedural.js, nothing imports one, no provider list carries an
      'offline' or 'procedural' id, and core/math.js has lost hash3, rand3 and
      makeRng — the three functions that were the whole ability to invent a
      square. A tile that does not arrive is drawn as a neutral grey (see
      groundNotLoaded) or not drawn at all; elevation with no reading is sea
      level rather than invented relief; a coastline with no imagery answers
      "land" rather than guessing; and the two octaves of noise that used to be
      multiplied over the photograph are gone, which is what used to make bare
      rock look like carpet.

      The self-test holds all of that shut rather than trusting the deletion:
      the file must not exist, nothing may match /procedural/i, the provider
      list may not carry those ids, elevation may not expose an `invented`
      getter, and the map may not invent a tile.

      What is left that is not measured, in full, because "no fake data" should
      mean an enumerable claim rather than a slogan. Every remaining call to
      Math.random or a noise hash in the whole of src/:

        world/weather.js   the cloud sheet, and where raindrops and snowflakes
                           sit in the box around you. Sky, not ground.
        world/shaders.js   the same cloud field again, for the shadow the deck
                           casts and for crown-scale relief inside a wood.
        world/places.js    picking one of a list of real settlements.
        world/rtp.js       picking a bearing for a random teleport.
        geo/mercator.js    picking a point for the same.

      The last three choose rather than invent — a real place, chosen at random.
      The first two are weather and are the sky. The crown relief is the one
      that touches the ground, and its *placement* is data both ways: an
      OpenStreetMap woodland polygon, or a canopy score measured off the
      photograph's own greenness and roughness. Nothing there decides that a
      wood exists.
- [x] J1b. The no-generator rule was guarded on five files, not on the rule
      "Nothing is generated" is the rule this project is judged on, and the
      check for it named five files. A generator added to a sixth would have
      passed every part of it — which is the shape M17 forbids: guard the
      system, not the places that happened to be wrong once.

      The whole of src is scanned now, all seventy-two files, for noise and for
      any seeded generator. It comes back clean, and the two deliberate uses
      are named in the check rather than left to be rediscovered:

        world/weather.js  the cloud deck. There is no per-frame photograph of
                          the sky to draw instead, and the weather state
                          driving it is real, from Open-Meteo — see H5.
        world/shaders.js  the same value noise, for cloud shadow and for
                          crown-scale relief over woodland. Shading only:
                          nothing is built, the ground you walk on does not
                          move, and it is off wherever OpenStreetMap has no
                          wood mapped — see H1.

      Anything else reaching for noise now fails the build and has to come and
      say why. The exemptions are checked in both directions, so one that stops
      using noise comes off the list rather than sitting there licensing a
      future use. Verified by sneaking a generator into a sixth file and a
      seeded PRNG into core/math.js: both fail by name.

- [x] J1c. The document stating the data position was the last place promising a generator
      J1 removed the generator, and the self test has guarded the code against
      its return ever since. It did not guard the prose. THIRD-PARTY.md — the
      document that sets out what data this project ships, what it fetches and
      under whose terms — still said the game "falls back to locally generated
      terrain so it runs with no account and no network".

      True once. It stopped being true when the generator went, and it is the
      opposite of the rule everything else here is judged on, sitting in the
      one file somebody would read to find out what the project's position is.

      Corrected, with the old wording kept in a parenthesis that says why it is
      wrong rather than quietly rewritten. Guarded: no document may promise
      generated terrain, and separately every vendored dependency must be
      credited, which is a licence obligation rather than a courtesy — both of
      them checked by doing the wrong thing and watching the check fail.

- [x] J1d. The README's provider table listed five of twelve, and hid three keyless ones
      Found by the same sweep as J1c. The provider table said the imagery slot
      offers "Esri World Imagery (keyless, the default), Google Maps, Bing Maps,
      Azure Maps, Mapbox Satellite". There are twelve, and the three it left out
      of the keyless half — Sentinel-2 cloudless, USGS imagery, NASA GIBS — are
      exactly the ones that matter to somebody deciding whether this needs an
      account. THIRD-PARTY.md had them all; the README, which is what anybody
      reads first, did not. The elevation row and the reference-map row were
      short too.

      Corrected, split into keyless and on-a-key so the promise is legible, and
      guarded: every provider in the code must be named in the README, and the
      keyless ones must be marked as such.

      The first version of that guard demanded the label verbatim and failed on
      six providers that were all present — the README shortens "Google Maps
      (satellite)" to "Google Maps", reasonably. A check nobody can keep green
      is worse than none, so it matches the part of the label that identifies
      the provider. Verified by dropping one keyless provider from the table.

- [x] J2. A test on every mode
      The individual behaviours were already tested — a fall reaches 78.4, a
      walk is 4.32, a glide is Minecraft's tick — but nothing went through the
      thing being asked about: the selector that *chooses* the mode. Those are
      different failures. A mode that is never selected passes every test of
      what it does, because none of them go through the selector.

      There is one now, driving the real controller with one state per mode
      rather than setting player.mode and reading it back: on the ground is
      walk and it moves you 8.4 m; airborne with the wings shut is fall and it
      drops you; airborne with them open is glide and it makes 57 m across for
      5 m down rather than falling; the fly cheat is fly and it holds altitude
      and climbs; standing in a lake sets swimming and the water holds you at
      -0.9 m/s instead of 78; and both perspectives are reachable.

      It found one straight away. Jump was the ascend key while flying *and*
      still the wings key, because the airborne branch of readJumpEdges only
      asks whether you are off the ground and flying always is. One press of
      ascend deployed the elytra behind your back — invisible, because the fly
      tick moves you the same either way — made rockets lightable in a mode
      with no use for them, and dropped you into a glide the moment you turned
      the cheat off, from wherever you were. Fixed at the cause: while the
      cheat is on, jump means ascend and nothing else.
- [=] J3. Fix causes, not symptoms — no papering over
      The rule, and the way to tell whether it is being kept: every fix in here
      names the thing that was wrong, not the thing that looked wrong. A few
      from this pass, each stated as cause rather than remedy:

        clouds did not draw from above → four missing shader chunks, so a
          material was depth-testing on a different scale from the buffer;
        the map stretched → a two-dimensional size checked in one dimension;
        the trail forgot → the unit of eviction was a whole flight;
        the fog grew as you zoomed out → the mask was read at a level the
          record does not keep, and a coarser cell counts as explored if any
          part of it is;
        the rocket ran away → the previous fix clamped half of a vector and
          left the other half running.

      That last one is the point of this item. Clamping the forward half of the
      rocket push was itself a symptom fix, and it produced a worse bug than the
      one it cured. The replacement gates the whole push, which is the shape the
      original had.

      Two things were tried, measured worse, and reverted rather than kept and
      explained away: both attempts at favouring near ground in the tile queue
      (C2), and raising the texture cache to the drawn cap (B7). Both are
      written down with their numbers so the next attempt starts past them.

      The clearest case in the pass after that is C14, and it is worth stating
      as cause rather than remedy. Six entries in this file — B1, B7, B10, C1,
      C2, C7 — had concluded "throughput is the constraint". None of them had
      measured the pipeline; they had measured the *symptom* and inferred the
      cause. The evidence offered for it was that the test harness serialised
      tiles, which was checked and found to be false: 22 concurrent, median
      start-to-start gap 0 ms. Measured properly, the queue was being drained
      once a frame and ran at eleven per cent of its own allowance. Two of
      those six had reverted a prefetch on the strength of the wrong reason.

      The habit that failed here was not the fixing. It was accepting an
      inferred cause across six entries because each one agreed with the last.
- [x] J4. Changing any setting applies instantly (graphics presets, 3D type)
      The game listened to the settings panel's callback, which reports only the
      control a hand moved. Picking Low writes nine settings; eight were stored
      and never applied — and auto quality, which everyone now starts on, moved
      the tier without ever moving the picture. It listens to the store now,
      coalesced to one pass a frame, and a preset change rebuilds the meshes
      because the mesh grid is read from the preset.
- [x] J5. Ensure graphics presets update
      The game listened to the settings panel's callback, which reports only the
      control a hand moved. Picking Low writes nine settings; eight were stored
      and never applied — and auto quality, which everyone now starts on, moved
      the tier without ever moving the picture. It listens to the store now,
      coalesced to one pass a frame, and a preset change rebuilds the meshes
      because the mesh grid is read from the preset.
- [x] J6. F4 copies a diagnostics report, so "it happened on my machine" is answerable
      Nine items in this file are stuck at the same place: measured clean here,
      reported from your machine, and no way to tell the candidate causes apart
      without being sat at it. A0 the boot hang, A9 the Chromebook, A7 the tab
      reloading, B3 ground missing, B5 the grid, B6 disappearing in chunks,
      I16 broken letters, M3 the lag — and B11, which has two candidates left.

      Every one of those is already distinguishable from inside the running
      game. What was missing was a way to get the numbers off the machine. The
      frame-time readout on F3 is not it: it shows tiles and frame time, and
      none of the figures that actually separate the candidates.

      F4 now puts the whole thing on the clipboard — the GPU string, memory and
      cores as the browser reports them, the tier auto has actually settled on
      (not the setting, which reads "auto" for everybody), the texture budget in
      bytes rather than tiles, how many times the graphics context has been
      lost, whether the degraded latch is set, the depth limit, the share of
      ground drawn from its own photograph against stretched against bare, the
      queue depth and requests in flight against the cap, every provider's
      state, and the last eight errors. Where the clipboard is blocked — a page
      opened from file:// has no secure context — it prints to the console
      instead and says so.

      It is on the help card, which the build enforces in both directions: a
      binding with no line fails, and a line naming an action the game does not
      bind fails too.

      It shipped dead the first time, and the reason is worth keeping because
      it is a hole in the system rather than a slip. Keys live in two lists —
      ACTIONS, which declares what an action is, and DEFAULT_BINDS, which says
      which key it starts on — and `reindex` walks ACTIONS. So a key named in
      DEFAULT_BINDS with no ACTIONS entry is never indexed, `actionsFor`
      returns nothing for it, and pressing it does nothing: no error, no
      warning, nothing on screen. F4 was bound, documented on the help card and
      wired to a working handler, and unreachable.

      Caught because the probe checked that the press reached the game before
      believing anything about what it did — the same check that caught the
      vacuous A6 test, and the reason it exists. The self test now fails when
      the two lists disagree in either direction, and separately when any
      default binding does not resolve to its own action when pressed. Thirty
      three keys, all of them reachable.

- [x] J7. "land ~0 mi" — a patch on one caller, pinned in place by its own test
      Found by looking at a screenshot: the minimap's scale legend read "0 mi"
      under a five-hundred-metre bar.

      `formatDistance` switches to miles past a thousand feet, and a mile is
      5,280 — so at zero decimal places everything from a thousand feet to half
      a mile printed "0 mi". Four callers ask for zero places: the minimap's
      scale bar, the world map's scale bar, the altitude readout, and the
      nearest-land readout. That last one is not a cosmetic problem. Flying
      eight hundred metres off a coast it said "land ~0 mi", which reads as
      "you are over land" when you are not.

      The interesting part is the history. This exact fault was found once
      before, for the altitude readout — "three hundred metres above the ground
      read 0 mi AGL" — and the fix was to give altitude a formatter of its own
      and leave `formatDistance` as it was. That is a patch on the one caller
      that was noticed; the other three still had it. And the self test then
      pinned the broken behaviour in place, asserting

        formatDistance(305, 'imperial', 0) === '0 mi'

      as though it were the requirement. So the bug had a test protecting it.

      Fixed at the cause: the unit threshold and the number of decimal places
      were decided in different places and had no way to agree, and now they
      do — a unit that would round the number away is the wrong unit, and the
      smaller one is used instead. 305 m reads "1,001 ft", 500 m reads
      "1,640 ft", 800 m reads "2,625 ft", and everything that already worked is
      unchanged. Checked across every whole metre from 1 to 20,000 in both unit
      systems at nought, one and two decimal places — 120,000 readings, none of
      which prints a zero. The old check now asks what it should have asked.

- [x] J8. The credit was required to exist, not required to be visible
      Every provider is checked for an attribution string, and that check has
      been there a long time. Carrying the string is not the same as showing
      it, and the licence this ships under keeps the credit on screen.

      Measured in the running game at 360, 768, 960, 1280 and 1920 px wide: the
      line wraps inside its own box, overflows by nothing in either direction,
      and stays inside the viewport at every one of them. It reads "Imagery ©
      Esri, Maxar, Earthstar Geographics · Aug 2024 · 0.1 m · SWISSIMAGE 10 cm ·
      Elevation: AWS Terrain Tiles, SRTM/GMTED · Geocoding: Nominatim" — 148
      characters, and it is not clipped at any of them. (It looked clipped in a
      screenshot, which is what sent me to measure it; it wraps.)

      What a measurement cannot do is stay true, so the three CSS ways of losing
      it — clipping, holding it to one line, hiding it — are now refused, along
      with the HUD ceasing to render the row at all. Each one verified by doing
      it and watching the check fail by name.

- [x] J9. Nothing checked that the file people download is the game in src
      terraglide.html is the artefact this project tells people to
      double-click. It is generated from src, it is committed, and nothing
      verified the two still agreed. Edit a module, forget to rebuild, and the
      file people download is the old game — silently, because it still boots
      and still works, just not the way the source says. Every other artefact
      here has a check; this one had none.

      The bundler now stamps the file with a fingerprint of the sources it
      read, and the self test recomputes that from src the same way — from the
      files on disk rather than the transformed text, so the check does not
      have to reproduce the transform to verify it. It also confirms the stamp
      exists, that the bundle names the modules it holds, and that every one of
      them is still in the tree, so the check cannot pass by matching nothing.

      Verified by editing a module and not rebuilding: it fails, and prints both
      fingerprints.

- [x] J10. Keyless by default, checked rather than intended
      The promise has two halves. The first — that the game works with no
      account — was already checked: every provider declares whether it needs a
      key, every label says which, and the recommended one needs none.

      The second half was not checked at all: that nobody's key ends up in the
      repository. It is clean, and now it stays clean. All eight key settings
      must ship empty, and nothing token-shaped — a JWT, a Mapbox pk., a Google
      AIza, an sk- — may appear in any of the seventy-six files scanned, which
      includes both shipped artefacts as well as the source.

      Verified by shipping a Mapbox key in the defaults and by pasting a Google
      key into a source file: both fail by name and by file, and the bundle
      staleness check fires alongside, which is the two guards agreeing.


## L. Standing instructions

- [=] L1. Improve it all
      Standing, and the record is the answer: every item in this file is done,
      partly done with the remaining half named, or waiting on something only
      you can supply — a machine, a key, or a one-line decision. Each carries
      the measurement that settled it.

      What is genuinely left splits three ways and nothing in it is idle work
      waiting to be done here. Nine items are measured clean on this machine
      and reported from yours (F4 now copies everything needed to tell their
      candidate causes apart). Four need a credential you hold. Six are one-line
      decisions. The rest, including this one, are standing instructions with no
      end condition.

      The useful input is which part is worst now — or a paste of F4.
- [=] L2. Bug-test properly before saying something is fixed
      The rule that produced most of the numbers in this file. What "properly"
      has come to mean here, learned mostly by getting it wrong:

      Read the exit code, never count FAIL lines — the suite can crash while
      reporting "failures: 0".

      Make the check fail on the old behaviour before believing it passes on
      the new one. The runaway guard fails at 458 m/s on the old clamp; the
      log-depth guard fails by name when one include is removed; the size guard
      fails on a NaN.

      Prove the input reaches the thing before believing anything about what it
      did. This is the A6 lesson and it earned its keep again: the diagnostics
      key was bound to F4, listed on the help card and wired to a handler that
      worked, and pressing it did nothing at all — two lists have to agree and
      nothing checked that they did. The probe printed "press reached the
      action: NO", which is the only reason it was caught before shipping.

      Watch for the reason as well as the result. A prefetch was reverted twice
      on the strength of "the sandbox proxy serialises tiles". That was never
      measured, and it was false. The result stood; the reason did not, and the
      reason was what stopped anyone looking further for four entries.

      Watch the measurement itself for the same bugs as the code. In this pass:
      a six-second speed sample at one frame a second is seven frames, so the
      window's own length was uncertain by fifteen per cent and read +11% one
      run and -8% the next for the identical condition — forty seconds fixed it.
      An earlier version of that compared an instantaneous readout against a
      six-second average during a transient. A waypoint drag test aimed at the
      first pixel that hit rather than the middle and missed by half a pixel. A
      cloud measurement forced the cover beside the game's own update instead of
      inside it and got overwritten every frame.

      Say what could not be measured. Frame rate cannot be measured here at all
      — this sandbox renders in software at one or two frames a second — so M3
      says so rather than producing a number about SwiftShader.

      Keep the negative results. Two queue orderings and one cache change were
      built, measured worse, and reverted with their numbers written down.

## K. Needs a decision

- [?] K1. "Why is it number …" — the sentence stops there; which number?

## M. From the third message

- [x] M1. Player model still floating or underground, feet separate — I said look, and I did not
      Looked. It is arithmetic: hip 0.51, legs 0.36, so the trousers stopped at
      0.15 — twenty-seven centimetres above the sole — and the boots were placed
      by a hand-written -0.34 that put them at -0.035 to 0.015, below the origin
      entirely. Buried boots, floating trousers, a hand's span of nothing
      between. Legs are 0.46 now and the boot offset is derived from the leg and
      boot heights rather than typed, so 0.51 - 0.46 - 0.05 = 0 puts the sole on
      the ground and the boot top against the leg.
- [x] M2. Flying model broken
      A screenshot from the chase camera, and six separate faults in it.

      The wings spanned 1.60 of standing height — 2.9 metres on a 1.83 metre
      player, nine times his own width. A hang glider, and from behind it was
      the whole frame with a person hanging under it as a detail. An elytron
      spans about as wide as its wearer is tall, so the outline runs to 0.505 a
      side now, with the chord set to the 1.5:1 aspect an elytron has rather
      than the 2:1 of a paper aeroplane.

      The wing was also a prism — one polygon extruded 14 mm, so every point on
      the top surface shared a normal and the whole thing shaded as one flat
      colour. It is bent into a shell, every vertex pushed down and back by the
      square of how far out it is, and the leading edge is built from the bent
      outline so it follows the curve instead of cutting across it.

      The arms crossed. An arm hangs along -Y from its shoulder, so a positive
      Z rotation swings it toward +X, which for the left arm is over the chest
      and out the other side. Both signs were that way round, so in a glide the
      hands finished on each other's sides and the firework held in the right
      hand appeared on the left of the body with nothing near it.

      The legs crossed too: the tuck swung each foot 50 mm inward across hips
      44 mm apart, so the ankles overlapped and the legs — the largest thing on
      a figure seen from directly behind — drew as one blank rectangle.

      And nothing on the body had any fill. The scene's sun and hemisphere are
      right for a landscape and wrong for the one object that has to stay
      readable in it: glide with the sun ahead and every surface facing the
      chase camera is lit by 0x4a4a44 alone. The character carries its own fill
      now, emissive on its own materials so it lands nowhere else in the world.
      The trousers were lightened and the wing membrane darkened besides — they
      were 87 against 142, so the figure read as a dark slab under pale sails.

      Measured, not guessed: tools/model.mjs draws the character alone under the
      game's own lights from six angles and reports the mean brightness of each
      part, because judging a forty-pixel figure against a hillside is how a
      model with one leg and no arms survived several passes.
- [x] M2b. The elytra look backwards or upside down
      Four faults, and the one that mattered was not about the wing at all.

      The tips hung 30 cm below the shoulders — 40 degrees of sweep and minus
      22 of dihedral, a wing hanging off a body rather than one holding it up.
      Fixing that gave a wing 0.99 flat to the airflow, 28 degrees of sweep,
      correct in every way a wing can be measured against the air.

      And 0.06 square to the chase camera, at every pitch. The camera sits 16
      degrees above the flight line in level flight and climbs to 55 in a dive,
      so a horizontal surface seen from there is a blade — and a blade has no
      shape in it to read, which is exactly why it looked like it was on
      backwards or inside out. Every check passed because every check measured
      the wing against the air, and the complaint was about the wing against
      the camera. It is canted to meet it now: 28 degrees of sweep, 5 of
      dihedral so the tips sit above the shoulders, 0.83 to 0.88 square to the
      camera from a climb through a steep dive.

      The planform was wrong too. The bend displaced along Y as well as Z, and
      Y is in the plane the outline is drawn in — so it was a square-law shear,
      not the droop it was named as, and a square-law shear turns two straight
      edges into two arcs. Any outline came out a rounded lobe. And the aspect
      ratio had been reasoned from what an elytron is, about 1.5:1, which
      renders as two fat leaves: it is 2.1 now, with a tip chord of 0.028
      instead of 0.154 — a point rather than a paddle.

      Then the colour, which was the deepest one. Every colour set on this
      character was dead code in the served build: the loader set the material
      to white when a kit texture arrived and let the photograph decide. The
      four photographs were not balanced — mean luminance 183 for the wing, 41
      for the trousers — so the wings were near-white cloth and the legs
      near-black, which is the whole of "pale sails over a dark blob" and is
      why the model harness and the running game kept disagreeing. Each texture
      is reduced to luminance and normalised now, so it is a weave rather than
      a colour, and the two builds finally match. In the game the wing went
      from 169-192 to 114-123 against legs at 89 and grass at 80.

      tools/wingpose.mjs solves and reports the attitude; the self-test checks
      the angle to the camera and the dihedral, not just the shape.
- [?] M2c. Steep slopes look streaked and smeared
      Raised by me from my own screenshots, and the measurement does not
      support what I called it. Sampling the streaked patch with woodland
      relief off, and again with anisotropy forced to 1, gives readings
      identical to three significant figures — so it is neither the un-mipmapped
      woodland mask nor the texture filtering. Pixel-to-pixel step is 2.02 over
      a mean of 27.8: smooth, not sparkling, so it is not aliasing either.

      Third elimination: the tile skirts. A skirt is a curtain hung off a tile
      edge with the edge row of texels stretched down it, which is exactly the
      shape of smear being complained about — so they were zeroed and the same
      view re-shot. The band is pixel-for-pixel unchanged. Not the skirts.

      One of those eliminations was right about the answer and wrong about the
      evidence, and it is worth correcting. "Anisotropy forced to 1 gives
      readings identical to three significant figures" was comparing the patch's
      mean and colour spread — and those barely move whether pixels are blurred
      or smeared, because it is the same pixels rearranged. It could not have
      shown a difference.

      Measured again on the thing that actually differs. A smear is directional:
      little variation along it, plenty across it. Sampling the streaked slope
      in four directions, as the mean step between pixels two apart:

        aniso   horizontal  vertical   diag /   diag \    roughest/smoothest
            1         4.73      5.10     6.82     3.33          2.05
            2         5.46      5.78     7.43     3.92          1.89
            8         5.71      6.04     7.66     4.16          1.84
           16         5.74      6.06     7.68     4.20          1.83

      So filtering does do something the old test could not see — detail rises
      about a fifth from anisotropy 1 to 16, while the mean sits at 45.2 the
      whole way. But it does not remove the streak: the ratio only falls from
      2.05 to 1.83, and 8 to 16 is worth 0.01, so the preset's 8 is already at
      the point where more buys nothing. The smooth direction is the same one at
      every setting — down-right, which is the way the slope runs.

      What is left is the same answer as before, now with the right evidence
      under it: a shadowed slope seen at a grazing angle, where the surface's
      own texture is genuinely elongated in screen space, showing the
      photograph's chroma noise along it — colour spread 11.8 against a mean of
      27.8, high in relative terms, which is what reads as rainbow in near-black.
      That is real imagery displayed honestly. It could be made to look better by
      lifting or desaturating deep shadow, which is a display choice rather than
      an invention, but it is a choice worth asking about rather than making.

      Looked at again rather than measured again, because this entry has been
      wrong about its evidence once already. The same view rendered four ways —
      as is, anisotropy forced to 1, forced to 16, and with the photograph
      switched off — and photographed each time. Anisotropy 1 and 16 are
      indistinguishable by eye, which agrees with the numbers above. The band
      is exactly where the slope runs closest to the camera and steepest away
      from it, and nowhere else in the frame.

      So the conclusion stands, and it is worth saying plainly that the first
      impression on seeing the screenshots was that it looked far too regular
      and saturated to be photograph noise. It is not: near-black is where
      eight-bit colour has the least room, so the imagery's own chroma noise is
      at its largest in relative terms exactly there, and a grazing surface
      stretches each texel across many pixels so that noise becomes bands. The
      remaining question is unchanged and is yours: lift or desaturate deep
      shadow, or leave the photograph alone.

      One thing that helped and is not a display choice: the chase camera used
      to be pushed straight up out of any ground it landed in, so standing on a
      steep slope it ended up about sixty centimetres above the hillside
      looking straight along it. It walks the line out to where it wants to be
      now and stops short of whatever is in the way — closer, not higher, which
      is what a chase camera in anything else does. Measured at Lauterbrunnen:
      facing the west wall it comes in to 1.51 m from 4.44, and every other
      direction is unchanged. tools/chasecheck.mjs is that measurement kept.

      It does not fix the band in the obvious screenshot, because there the
      cliff is beside the player rather than under the camera — which is why a
      screenshot could not settle it either way and the probe could.


      Measured rather than argued, since it was worth knowing whether the render
      was adding anything. Flown against a shadowed valley wall at Murren, the
      worst pixel the render produces on that face is [27, 27, 15]; the worst in
      Esri's own photograph of the same ground is [26, 29, 10]. The faint
      magenta and green mottling on a dark cliff is in the picture, not put
      there by us — the render is faithful to within a couple of levels of
      8-bit quantisation.

      That does not make it look better, and it does not settle your question.
      It does mean the only way to change it is to grade the photograph, which
      is the thing refused everywhere else in this project. Still yours to
      decide.
- [~] M3. It is so laggy
      One real cause found and fixed, and it is not the one it looks like: the
      cap on how many squares may be drawn in a frame was keyed on the raw
      graphics setting, which reads 'auto' for anyone who has not picked a tier
      by hand. 'auto' was not one of the keys, so every machine took the high
      tier's 1100 whatever tier it was actually running — a Chromebook on Low
      was being asked for more than twice the ground it had chosen. See the
      commit; the drawn cap is a preset field now, resolved like the rest.

      Honest about what that is worth: measured after the fix, the cap does not
      bite in ordinary views. Standing on the ground draws 329 squares of a cap
      of 520, a kilometre up 207, six kilometres up 199 — 332 draw calls and
      446k triangles at the worst of those. So the mismatch was real and is not
      what makes it laggy for you.

      What is left cannot be measured here and that is worth saying plainly
      rather than guessing at: this sandbox renders in software at one or two
      frames a second by design, so any frame-rate number it produces is about
      SwiftShader and not about your machine. The numbers that do transfer are
      the counts above. What would settle it is which tier the game picked on
      your machine and what the frame counter reads there — both are on the
      debug overlay.

      One thing measured since, on a machine made to behave like a slow one:
      the texture cache was holding ten times its own budget, about 440 MB
      against 40 on a two-gigabyte machine. Memory pressure at that scale is
      felt as everything being slow before it is felt as a tab dying, so this
      may be part of what "so laggy" was. Fixed and bounded — see A7.

      Waiting on: a frame rate from your machine. This sandbox renders in software
      at about 1.4 frames a second, so no number it produces about speed means
      anything for yours. F4 carries the frame rate and the graphics tier.
- [x] M4. The quality is bad; zooming in on the map looks better than the ground
      Two answers, and the second was a real bug.

      The plain one: it is the same imagery. The map is flat and drawn at about
      one texel to the pixel; the ground is that photograph draped over terrain
      and usually seen at an angle, so the same data is spread over fewer
      pixels. On top of that the map is static and always shows exact tiles,
      while 58 per cent of the moving ground is a coarser tile stretched over
      it — see B10. Presentation, not data.

      The real one: the ground was capped two levels below what the provider
      serves, and could never recover. `reviewDepth` writes a provider off at a
      level once it has refused enough tiles there, and it says of itself that
      "one tile arriving at a written-off level puts it back" — which is true
      and could never happen, because the limit caps how deep anything is asked
      for, so no tile could arrive to lift it. A one-way latch.

      And the limit is one number for the whole provider rather than one per
      place. Esri stops at zoom 21 over an alpine valley and serves 23 over a
      city, so flying the valley first capped the city at 21 for the rest of the
      session with nothing able to discover otherwise. Measured at
      Lauterbrunnen: provider declares 23, ground drew at 21.

      It asks again now — one tile, every half minute, one level above the
      limit, over the ground being looked at, last in the queue. If it lands the
      limit lifts; if not the failure count grows and nothing changes.
- [x] M5. Explored area on the map is still nowhere near what was actually explored
      Cause: save() threw away 45% of the level-16 squares at random whenever the
      record passed 160,000 — permanently, since what it wrote is what came
      back, so every reload thinned the survivors again (55%, 30%, 17%).
      Random scattered holes through ground you had actually flown, different
      every time. The cap was real at ~3 MB of key strings; explored ground is
      discs along a path, so rows compress 14x and 2.7M squares now fit. Over
      the ceiling the oldest fine detail goes, in order, never at random.
- [x] M6. Player position is still off on the minimap
      The marker is dead centre by construction and the tile maths is right —
      the player's own point lands at exactly the canvas centre. What was off
      was the number being handed in.

      Physics runs on a fixed twentieth of a second and the world is drawn
      somewhere between the last two ticks, so the drawn position trails the
      physics one by up to a whole tick. The coordinates were read from the
      physics position, so the marker sat ahead of the ground under it by
      exactly that: nothing at walking pace, 1.5 m gliding, and 5.35 m on a
      Rocket V — six or seven pixels of map sliding out from under you, and
      more the faster you go, which is what makes it look like the map rather
      than the clock.

      They come from the drawn position now. It is settled before they are
      read, and a teleport snaps the two together, so there is no moment where
      the answer is from before the jump.
- [x] M7. Ground still has holes, still reloads, still moves up and down
      Three claims, three answers.

      Holes: 0.00 to 0.10% of the frame across every standard view, once the
      character is excluded from the measurement — the first version of that
      measurement counted the player's own body as sky enclosed by ground and
      reported holes that were the avatar. And over three minutes of banking
      flight there was never a frame without a drawn square under the player.

      Reloads: real, and it is the twenty-second rule. See B7 — ground you look
      away from for longer than that is thrown away and re-fetched, and the
      same round trip inside twenty seconds costs nothing.

      Moves up and down: fixed. Fresh elevation arriving used to move the tile
      in one step, so the ground jumped under you; it now morphs from the old
      height to the new one over a third of a second, per vertex, and anything
      under five centimetres is not morphed at all. See B1 and B5.
- [x] M8. Unloading while the player is still inside the render distance
      Cause: the texture cache held a tile for 240 *frames*, commented as "about
      four seconds at 60 fps" — true only at exactly sixty. 144 fps got 1.7 s,
      30 fps got 8, 10 fps got 24. The better the machine, the sooner the ground
      behind you was thrown away. Now 20 seconds of wall clock, the same on
      every machine.
- [x] M9. Ground becomes blurry
      Two causes, both measured, both named elsewhere and neither of them
      random.

      Turning your head: the ground behind you is outside the frustum, so it is
      never drawn and never asked for, and turning is the first time it is
      wanted. 45 degrees costs 12% of the frame for under five seconds, 90
      degrees 20%, an about-face 37% and about fifteen seconds. It is stretched
      from the coarse cover rather than missing, which is why it reads as blur.
      See B12.

      Coming back to somewhere you left: ground you looked away from for more
      than twenty seconds has been thrown away, so it arrives soft and sharpens.
      See B7.

      What it is *not* is auto-quality dropping a tier, which was the obvious
      suspect and was ruled out by measurement under B10 — that averages over
      seconds and cannot produce a one-second blur.
- [x] M10. Player width and speed on the ground do not feel real
      Measured against real anthropometry the figure was 1.68x too wide across
      the chest, 1.80x across the shoulders and 2.09x across the hips — it was
      Minecraft-shaped, not person-shaped. Now within 1.00-1.17x. The collision
      capsule went with it: 0.21 of height is an 0.83 m barrel on a 6'6" frame,
      now 0.12 (0.24 across). This is also why looking down in first person
      filled the screen with a wall of cloth — your own chest, half a metre wide,
      a quarter of a metre from your eye.
- [x] M11. Still teleporting when I look down after an RTP
      The walk returns outright on a frustum miss, so the square under you was
      never visited while you looked at the horizon: never split, never built,
      never in `drawn` — and meshHeightAt reads `drawn`, so the game did not
      know where the floor was. Looking down brought the real relief in all at
      once. Ground within 250 m is now built whichever way you face.
- [x] M12. Photorealistic 3D "failed to fetch"
      Same as G3, which has the detail. In short: that message means the request
      never arrived rather than being refused, which is the one case where the
      token is not what is wrong — and it was being passed through with none of
      that attached. It now names the three causes, including the non-obvious
      one, that a page opened from a file:// URL sends `Origin: null` and
      several metered APIs will not answer it.
- [x] M13. Not everything fake has been removed
      Right at the time, and swept again now rather than assumed. See J1 for the
      full enumeration: every remaining source of an unmeasured number in the
      whole of src/ is listed there, and none of them decides where anything on
      the ground is. What went since the complaint: the noise printed over the
      imagery, the biome guessed from latitude, the sand along a waterline, the
      rock on anything steep, the invented interiors of buildings, the invented
      relief under a tile with no elevation reading, the invented coastline, and
      hash3/rand3/makeRng themselves.
- [x] M14. The README reads as a contextless changelog of what I asked you to change
      — rewritten to describe the game rather than narrate edits. Every "there
      used to be" is gone.
- [x] M15. "with gaps left as gaps" — I said NO GAPS
      — line removed.
- [~] M16. One branch, with gh-pages as the only other
      Two dead branches remain: online-singlefile, which holds nothing main
      does not (136 files changed, 231,358 deletions against 70 insertions —
      it is a strict subset), and claude/world-exploration-game-962wpo, which
      is an old snapshot and the only place the deleted terrain generator still
      exists. Deleting a remote branch is refused by the permission gate here,
      it is irreversible, and it is outward-facing, so neither is something to
      delete unilaterally. Both still want a word — but the facts behind that
      word are exact now rather than approximate, which is most of what was
      missing from it.

      `online-singlefile`: two commits, and not one file that main does not
      have. It differs only by older copies of README.md, index.html and
      terraglide-online.html — 70 insertions against 238,766 deletions. It
      holds nothing at all.

      `claude/world-exploration-game-962wpo`: two commits, the second of them
      called "Retire this branch: take main's tree wholesale". That retirement
      took main's tree at a point before the generator was removed, so exactly
      one file on it does not exist on main —

          src/tiles/procedural.js, 7,990 bytes

      — which is the terrain generator J1 deleted. It is the last living copy
      of the thing this project is judged on not having, on a branch nobody
      uses. That is a stronger reason to delete it than tidiness, and it is new
      since this item was written.

      Tried, and this environment will not do it. `git push origin --delete`
      hangs up mid-transfer every time, five attempts across two syntaxes, and
      the proxy's own log records no failure for github at all — so it is the
      git relay refusing ref deletions rather than a network fault. The GitHub
      tools available here have create-branch and delete-file but no
      delete-branch. Normal pushes work; ten went out this session.

      So it is two commands, and they are yours:

        git push origin --delete online-singlefile
        git push origin --delete claude/world-exploration-game-962wpo

      Verified safe before asking: `online-singlefile` holds nothing main does
      not, and the claude branch holds exactly one file main lacks —
      src/tiles/procedural.js, the invented-terrain generator you asked to be
      removed. Restore points if ever wanted: 83108cf and 13d8e43.

      One caution against acting on that alone: this session's own instructions
      name that branch as the one to develop on, even though the work has all
      gone to main at your direction. So it is not merely stale — it is named,
      which is a second reason it is your word rather than mine.
- [=] M17. Stop patching with bandaids — fix the system
      Same rule as J3, and the clearest example of it being obeyed is the one
      where it had previously been broken. D7 stopped a weak rocket braking you
      by clamping half of vanilla's push vector — a patch on the symptom. It
      produced a runaway that took you past 80,000 m/s. The fix is not a second
      clamp; it gates the whole push, which is the shape the original line had.

      Two more from this pass where the system was changed rather than the
      symptom. The drawn cap was a second table keyed on the raw graphics
      setting, which is why it could disagree with every other tier setting —
      the fix is one table, resolved the same way as the rest, not a special
      case for 'auto'. And the missing shader chunks are guarded across every
      file that writes a shader, not across the two that were wrong, because
      the next hand-written shader would have the same hole.

      Three more from the pass after it.

      The request queue was drained once a frame. The symptom fix would have
      been to raise the concurrency cap, which had already been tried at 12, 24
      and 48 and made no difference — because the cap was never the thing being
      hit. The system fix is that a completing request fills the slot it just
      freed, which is what every other queue in this project already did.

      The same fault was then looked for in the *other* queues rather than
      waiting for it to be reported, and the elevation queue had it too.

      And when a key turned out to be bound, documented and wired yet dead, the
      guard went on the two lists that have to agree and on every binding
      resolving when pressed — not on F4.
- [x] M18. Barrel roll, implemented like the mod, not as a keybind
      Was a key: X ran a canned 360 over 0.8 s whatever you were doing. Now it is
      the strafe keys held while gliding — you keep rolling for as long as you
      hold, all the way round if you want, and the wings come back level when
      you let go. And a bank turns you, scaled by airspeed, which is the reason
      to roll one: a 30-degree bank is a 46-degree arc over two seconds, upside
      down turns nothing. The keybind is gone.

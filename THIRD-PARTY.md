# Third-party components and data

TerraGlide itself is covered by the TerraGlide Restricted Source License (see
`LICENSE`). The items below are **not** ours and are not covered by it.

## Bundled software

| Component | Version | License | Notes |
| --- | --- | --- | --- |
| [three.js](https://threejs.org) | 0.185.x | MIT | WebGL renderer, math types, geometry helpers. |
| [Vite](https://vite.dev) | 7.x | MIT | Build tool / dev server. Not shipped in the bundle. |
| [TypeScript](https://www.typescriptlang.org) | 5.9.x | Apache-2.0 | Type checking only. Not shipped in the bundle. |

No third-party source code was copied into this repository. The engine, the
terrain quadtree, the flight model, the map UI and the shaders here were written
for this project.

## Map data providers (none bundled, all optional)

TerraGlide ships with **no** map data and with every provider slot empty. It
runs with no account because several of the providers below need no key, not
because it makes anything up: there is no generator, and ground nobody has
photographed is drawn from the relief and left honest about it. (This paragraph
used to say it "falls back to locally generated terrain", which was true once
and stopped being true when the generator was removed. A document that states
this project's data position should not have been the last place still claiming
the opposite.)

If you enter a key in Settings → Providers you are using that provider's
service directly from your browser, under that provider's terms, on your own
quota. Read them before you turn a provider on.

| Provider | Used for | Key required | Terms |
| --- | --- | --- | --- |
| Google Maps Platform (Map Tiles API, Street View Static API, Geocoding API, Elevation API) | satellite tiles, street-level panoramas, addresses, elevation grids | yes | <https://cloud.google.com/maps-platform/terms> |
| Microsoft Bing Maps | satellite tiles, elevation grids | yes | <https://www.microsoft.com/maps/product/terms> |
| Azure Maps (Render) | satellite tiles | yes | <https://azure.microsoft.com/support/legal/> |
| Maxar SecureWatch | satellite tiles | yes (enterprise connect ID) | <https://www.maxar.com/legal> |
| Cesium ion | satellite tiles (any raster asset you own), photorealistic 3D tiles | yes (token) | <https://cesium.com/legal/terms-of-service/> |
| Mapbox (Satellite, Terrain-RGB) | satellite tiles, elevation | yes | <https://www.mapbox.com/legal/tos> |
| Esri World Imagery | satellite tiles | no | <https://www.esri.com/en-us/legal/terms/full-master-agreement> |
| Sentinel-2 cloudless (EOX IT Services) | satellite tiles | no | <https://s2maps.eu> |
| USGS The National Map (imagery, United States) | satellite tiles | no | <https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits> |
| NASA EOSDIS GIBS (VIIRS true colour) | satellite tiles | no | <https://nasa-gibs.github.io/gibs-api-docs/> |
| Esri World Street Map | reference map layer | no | <https://www.esri.com/en-us/legal/terms/full-master-agreement> |
| OpenStreetMap standard tiles | reference map layer | no | <https://operations.osmfoundation.org/policies/tiles/> |
| OpenFreeMap (OpenMapTiles vector schema) | reference map layer | no | <https://openfreemap.org> |
| Nominatim | reverse geocoding (address readout) | no | <https://operations.osmfoundation.org/policies/nominatim/> |
| Overpass API | OpenStreetMap buildings, bridges, infrastructure and land cover | no | <https://dev.overpass-api.de/overpass-doc/en/preface/commons.html> |
| Mapillary | street-level panoramas | yes (token) | <https://www.mapillary.com/terms> |
| AWS Terrain Tiles (Terrarium) | elevation | no | <https://registry.opendata.aws/terrain-tiles/> |

Bing and Google also publish elevation as *numbers* rather than as pictures —
Bing's `Elevation/Bounds` answers with a grid for a rectangle, Google's
Elevation API with a list of heights for a list of points, sent as an encoded
polyline so a tile fits in one request. Both are offered, both cost one request
per tile against your own quota, and both are capped shallow for that reason.
Where you have the choice, AWS Terrain Tiles are finer and ask for no account.
Google's real terrain detail is in the photorealistic 3D tiles, not in the
Elevation API.

Maxar's imagery reaches most people through Esri, Bing and Google, all of which
serve Maxar scenes and all of which credit them. The direct route, Maxar
SecureWatch, is offered for anyone who has an enterprise connect ID.

Attribution for whichever providers you enable is shown in the bottom-right of
the HUD and must not be hidden — see `LICENSE` §3(e) and §4.

The keyless providers above are community or public endpoints with strict fair-use
policies: they are rate limited in `src/tiles/providers.ts` and
`src/geo/geocode.ts`, and those limits must not be raised for unattended or
bulk use.

Every layer has a standby behind it, because "busy" is a normal answer from a
community server. The flat maps fall back from your chosen imagery to
Sentinel-2 cloudless, and the drawn street map falls back from OpenStreetMap's
raster tiles to Esri's street map and then to OpenFreeMap. Nothing is cached to
disk on any of those routes.

## Vector tiles

OpenFreeMap serves the roads, coastlines and place names themselves rather than
a picture of them, under the OpenMapTiles schema, keyless and explicitly
unmetered. TerraGlide reads and draws them itself — `src/tiles/vectorTile.js` is
a small Mapbox Vector Tile reader written for this project and
`src/ui/vectorMap.js` draws the result. No third-party renderer is bundled: this
is not MapLibre GL JS and does not include any of it. Only the flat maps use it;
a drawn map draped over terrain looks like a mistake, so it is not offered as
flight imagery.

Attribution for it — OpenFreeMap, OpenMapTiles and OpenStreetMap — is carried in
the provider descriptor and shown with the rest.

## Photorealistic 3D tiles

Optional, off by default, and reachable two ways — both on your own account.

**Google Photorealistic 3D Tiles** needs a Google Maps Platform key with the
Map Tiles API enabled. Requests go straight from your browser to Google on your
quota, under the Google Maps Platform Terms of Service.

**Cesium ion** also serves ordinary imagery — any raster asset in your account,
asset 2 (Bing Aerial) by default — through the same token and the same endpoint
exchange. Whatever attribution ion returns with the asset is shown with it.
Every ion asset is metered per account and there is no keyless route to one; the
API refuses an unauthenticated request outright.

**Cesium ion** serves the same photorealistic dataset as asset 2275207 and
needs a Cesium ion access token. The token is exchanged at
`api.cesium.com/v1/assets/2275207/endpoint` for a short-lived bearer, the
tileset URL and a list of attributions; requests then go from your browser to
Cesium on your quota, under the Cesium ion Terms of Service.

Both providers require the copyright returned with the tiles to be displayed
while they are on screen. The game collects it — Google's string, or ion's
attribution list with its HTML stripped — and shows it in the attribution
corner. Removing it breaks their terms and this project's licence. Nothing is
cached to disk on either route.

Bing is not an option *for 3D* and cannot be made one: Microsoft Flight
Simulator gets its Bing photogrammetry through an internal agreement, Bing
Maps never published a 3D tile API, and the platform is being retired into
Azure Maps, which does not serve photogrammetry either. Bing's flat aerial
imagery is a separate thing and is offered in the table above.

three.js's GLTFLoader, DRACOLoader, BufferGeometryUtils and SkeletonUtils
(`vendor/three/loaders/`, `vendor/three/utils/`) and the Draco decoder
(`vendor/draco/`) are vendored to read those tiles. three.js is MIT; Draco is
Apache 2.0, Copyright Google LLC.

## OpenStreetMap land cover and infrastructure

The scenery reads `natural=wood|scrub|heath|bare_rock|scree|shingle`,
`landuse=forest|orchard|vineyard|meadow` and `natural=tree`. The structures
layer reads `building`, `building:part`, `bridge`, and
`man_made=tower|mast|chimney|water_tower|cooling_tower|storage_tank|silo|gasometer|pier`
and `power=tower|generator`, standing each one at its mapped height where the
data records one.

Bridge decks read `highway` ways carrying a `bridge` tag, at their surveyed
width — a tagged `width` first, then `lanes` at 3.1 m a lane, and only then the
usual width for that class. Roads at ground level are not read at all: they are
already in the imagery.

All of it comes from the same Overpass API, under the Open Database Licence,
in one request per tile. Attribution is already in the corner of the screen
alongside the buildings credit.
Requests are queued one at a time with a gap and a long backoff, and nothing is
cached to disk.

## Generated assets

Everything in `assets/` is an AI-generated material texture, made for this
project through Pixa (FLUX 2 Klein) from prompts asking for a seamless tileable
material. They depict no real place, person or product, and they are covered by
the project licence along with the rest of the Work.

| File | What it dresses | Drawn when |
| --- | --- | --- |
| `foliage.jpg` | trees, scrub | generated world only |
| `rock.jpg` | boulders, scree | generated world only |
| `jacket.jpg` | torso and arms | always |
| `trousers.jpg` | legs | always |
| `wing.jpg` | the wings | always |
| `rocket.jpg` | the rocket in your hand | always |

The split is deliberate and is the project's rule about generated art: the
scenery textures could be mistaken for a statement about what is actually
growing on that ground, so they are shown only where the ground itself is
generated — select any real imagery provider and they come off, and the scenery
takes its colour from the satellite image instead. The player's own kit has no
real-world counterpart any provider publishes, so it displaces nothing and is
drawn in every mode.

`assets/player.glb` is a generated character mesh — TRELLIS.2 on Hugging Face,
from a prompt, then reduced by `tools/glb-optimise.py`: the baked ground plane
cut away, textures halved and re-encoded, normals and UVs quantised, 3.9 MB
down to 0.9 MB. It depicts no real person. Off by default, and never fetched by
the single-file build.

It went out smudged black for a fortnight, and the reduction was what did it.
glTF requires every vertex attribute to sit on a four-byte boundary, so three
signed bytes of normal have to be written as four — which the tool did, and
then did not declare the padding as the bufferView's `byteStride`. A view with
no stride is tightly packed by the specification, so every reader stepped three
bytes at a time through data written four apart: the first normal correct and
each one after dragged a byte further out of place. Half of them arrived as
directions of no particular length, and a short normal draws dark, which is why
the patches followed nothing visible in the texture. `tools/glb-normals.py`
repairs a mesh already written that way, and the self-test reads every mesh in
`assets/` the way a glTF reader reads it and refuses one that is not unit
length.

All of it is optional. `assets/manifest.json` is fetched at startup and, when
it is absent — as it is in the single-file build — everything falls back to
flat colour.

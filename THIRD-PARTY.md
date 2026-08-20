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
falls back to locally generated terrain so it runs with no account and no
network. If you enter a key in Settings → Providers you are using that
provider's service directly from your browser, under that provider's terms, on
your own quota. Read them before you turn a provider on.

| Provider | Used for | Key required | Terms |
| --- | --- | --- | --- |
| Google Maps Platform (Map Tiles API, Street View Static API, Geocoding API) | satellite tiles, street-level panoramas, addresses | yes | <https://cloud.google.com/maps-platform/terms> |
| Microsoft Bing Maps | satellite tiles | yes | <https://www.microsoft.com/maps/product/terms> |
| Azure Maps (Render) | satellite tiles | yes | <https://azure.microsoft.com/support/legal/> |
| Mapbox (Satellite, Terrain-RGB) | satellite tiles, elevation | yes | <https://www.mapbox.com/legal/tos> |
| Esri World Imagery | satellite tiles | no | <https://www.esri.com/en-us/legal/terms/full-master-agreement> |
| OpenStreetMap standard tiles | reference map layer | no | <https://operations.osmfoundation.org/policies/tiles/> |
| Nominatim | reverse geocoding (address readout) | no | <https://operations.osmfoundation.org/policies/nominatim/> |
| Overpass API | OpenStreetMap buildings, bridges, infrastructure and land cover | no | <https://dev.overpass-api.de/overpass-doc/en/preface/commons.html> |
| Mapillary | street-level panoramas | yes (token) | <https://www.mapillary.com/terms> |
| AWS Terrain Tiles (Terrarium) | elevation | no | <https://registry.opendata.aws/terrain-tiles/> |

Attribution for whichever providers you enable is shown in the bottom-right of
the HUD and must not be hidden — see `LICENSE` §3(e) and §4.

The keyless providers above are community or public endpoints with strict fair-use
policies: they are rate limited in `src/tiles/providers.ts` and
`src/geo/geocode.ts`, and those limits must not be raised for unattended or
bulk use.

## Photorealistic 3D tiles

Optional, off by default, and reachable two ways — both on your own account.

**Google Photorealistic 3D Tiles** needs a Google Maps Platform key with the
Map Tiles API enabled. Requests go straight from your browser to Google on your
quota, under the Google Maps Platform Terms of Service.

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

All of it is optional. `assets/manifest.json` is fetched at startup and, when
it is absent — as it is in the single-file build — everything falls back to
flat colour.

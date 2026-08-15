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
| Mapbox (Satellite, Terrain-RGB) | satellite tiles, elevation | yes | <https://www.mapbox.com/legal/tos> |
| Esri World Imagery | satellite tiles | no | <https://www.esri.com/en-us/legal/terms/full-master-agreement> |
| OpenStreetMap standard tiles | reference map layer | no | <https://operations.osmfoundation.org/policies/tiles/> |
| Nominatim | reverse geocoding (address readout) | no | <https://operations.osmfoundation.org/policies/nominatim/> |
| Overpass API | OpenStreetMap building footprints | no | <https://dev.overpass-api.de/overpass-doc/en/preface/commons.html> |
| Mapillary | street-level panoramas | yes (token) | <https://www.mapillary.com/terms> |
| AWS Terrain Tiles (Terrarium) | elevation | no | <https://registry.opendata.aws/terrain-tiles/> |

Attribution for whichever providers you enable is shown in the bottom-right of
the HUD and must not be hidden — see `LICENSE` §3(e) and §4.

The keyless providers above are community or public endpoints with strict fair-use
policies: they are rate limited in `src/tiles/providers.ts` and
`src/geo/geocode.ts`, and those limits must not be raised for unattended or
bulk use.

## Generated assets

`assets/foliage.jpg` and `assets/rock.jpg` are AI-generated material textures,
made for this project through Pixa (FLUX 2 Klein) from prompts asking for
seamless tileable foliage and granite. They depict no real place, person or
product, and they are covered by the project licence along with the rest of the
Work. They are optional: `assets/manifest.json` is fetched at startup and, when
it is absent — as it is in the single-file build — the scenery falls back to
flat colour.

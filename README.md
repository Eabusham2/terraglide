# TerraGlide — online single file

One file. It is about a kilobyte, and it holds no game: it loads the modules,
the stylesheet and the textures from the published site at
<https://eabusham2.github.io/terraglide/>. Download `terraglide-online.html`,
double-click it, and you are playing the current version — no build, no install,
nothing to keep up to date.

It needs a network. If you want a copy that does not, take `terraglide.html`
from the same place: that one inlines everything and is about 2.5 MB. The two
are opposites and both are built from `main`:

| | offline `terraglide.html` | online `terraglide-online.html` |
| --- | --- | --- |
| Size | ~2.5 MB | ~1 KB |
| Needs a network to start | no | yes |
| Always the current version | no, rebuild it | yes |
| Photorealistic 3D | no — needs a module loader | yes |
| Generated textures and player mesh | fetched from the site, flat colour if blocked | yes |

## How it works

A module's relative imports resolve against the module's own address, not the
document's. One `<script type="module">` pointing at the published `src/main.js`
is enough — the other sixty modules follow it home. Two things needed help:

- a worker script has to be same-origin, so a cross-origin one is loaded through
  a small blob that imports it (`src/tiles/workerHost.js`);
- the textures are found relative to the module rather than the page
  (`src/core/paths.js`).

## Mirroring it

Regenerate it against your own copy:

```
node tools/online.mjs https://your.host/terraglide/
```

The licence permits mirrors and republication with visible credit — "TerraGlide
by Eabusham2" and a link to <https://github.com/eabusham2/terraglide>. See
`LICENSE` on `main`.

## This branch

Generated from `main` by `tools/online.mjs`. Nothing is developed here; open
issues and changes against `main`.

/**
 * Where the game's own files live.
 *
 * There are three ways to run this and they disagree about what "./assets/"
 * means. Served normally, the page and the modules sit in the same place and
 * either answer works. In the single-file build there is no assets folder next
 * to the document at all. And in the online single-file page the document is
 * one small file that could be anywhere — a download in your home directory, a
 * company intranet — while the modules are being loaded from the published
 * site; there, a path relative to the *document* points at nothing, and a path
 * relative to the *module* points at exactly the right folder.
 *
 * So: relative to the module, with the document as the fallback for the bundled
 * build, where `import.meta` has been compiled away and `new URL` throws.
 */

function moduleRelative(path, fallback) {
  // The one-file build has no folders of its own next to it, whatever its own
  // address suggests — it *is* the whole game, sitting in a downloads folder.
  // Resolving against the document there produces a real-looking path to
  // nothing, so it goes straight to the published copy. The flag is set by the
  // bundler and by nothing else.
  if (globalThis.__TERRAGLIDE_INLINE_WORKER__) return fallback;
  try {
    return new URL(path, import.meta.url).href;
  } catch {
    return fallback;
  }
}

/**
 * Where the published copy of this version lives.
 *
 * The offline bundle has no assets folder of its own, so it asks the site for
 * one. That is a nicety rather than a dependency: when there is no network, or
 * the host is blocked, the fetch fails and everything falls back to flat
 * colour exactly as it did before.
 */
export const PUBLISHED_BASE = 'https://eabusham2.github.io/terraglide/';

/** Folder holding the optional generated textures and the player mesh. */
export const ASSET_BASE = moduleRelative('../../assets/', `${PUBLISHED_BASE}assets/`);

/**
 * Folder holding the Draco decoder.
 *
 * A megabyte of WebAssembly, which is why it is not inlined into the
 * single-file build even though the code that needs it now is. Photorealistic
 * 3D tiles are Draco-compressed, so without this there is nothing to decode
 * them with — and asking the published site for it is what lets a downloaded
 * copy of the game fly the scanned world too, as long as it has a network.
 */
export const DRACO_BASE = moduleRelative('../../vendor/draco/', `${PUBLISHED_BASE}vendor/draco/`);

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

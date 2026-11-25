// Applying a new version to an open page.

/** Paths that differ between two { path: hash } maps. */
export const changes = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((p) => a[p] !== b[p]);
export const hashes = (files) => Object.fromEntries(Object.entries(files).map(([p, f]) => [p, f.h]));

/** Whether a full reload would lose nothing. Pages can say for themselves. */
export function safeToReload() {
  if (globalThis.librarySafe) return globalThis.librarySafe();
  return ![...document.querySelectorAll('input, textarea')].some((el) => el.value && el.offsetParent !== null)
    && !document.querySelector('dialog[open]');
}

/**
 * Lets the page apply the changes itself. Returns 'done', 'wait' (busy just
 * now) or 'reload' (it can't).
 */
export async function applyChanges(changed) {
  if (!changed.length) return 'done';
  if (!globalThis.libraryUpdate) return 'reload';
  return globalThis.libraryUpdate({ changed });
}

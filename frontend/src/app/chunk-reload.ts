/**
 * What to do when a lazily loaded route fails to download its chunk.
 *
 * Lazy routes buy a smaller first download, and they cost one new failure mode:
 * after a deploy the old chunks are gone, and a tab that was opened before it -
 * or a service worker that served a stale `index.html` - asks for a file that no
 * longer exists. From outside this looks exactly like "the page did not open":
 * no error the user can act on, no obvious cause.
 *
 * The cure is a reload, because the reload fetches the current `index.html` with
 * the new file names. The reload must happen at most once per short window,
 * otherwise a genuinely missing chunk turns into a reload loop that hides the
 * problem instead of showing it.
 */

/** Marks the chunk errors browsers actually produce. */
export function isChunkLoadError(error: unknown): boolean {
  const message =
    (error as { message?: string })?.message ?? (error as { error?: { message?: string } })?.error?.message ?? '';
  return /dynamically imported module|Loading chunk|Importing a module script failed|Failed to fetch/i.test(
    message
  );
}

/** How long a reload is remembered, so a broken chunk cannot loop the page. */
export const CHUNK_RELOAD_WINDOW_MS = 30_000;

const STORAGE_KEY = 'chunkReloadAt';

/**
 * Reloads the page once if a chunk failed to load.
 *
 * Returns true when the reload was started, false when one already happened
 * inside the window - the caller then has to say something, because reloading
 * again would only hide the failure.
 */
export function reloadAfterChunkFailure(
  storage: Storage,
  reload: () => void,
  now: number = Date.now(),
): boolean {
  const previous = Number(storage.getItem(STORAGE_KEY) ?? '0');
  if (previous && now - previous < CHUNK_RELOAD_WINDOW_MS) {
    return false;
  }
  storage.setItem(STORAGE_KEY, String(now));
  reload();
  return true;
}

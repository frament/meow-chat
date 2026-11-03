import { isChunkLoadError, reloadAfterChunkFailure, CHUNK_RELOAD_WINDOW_MS } from './chunk-reload';

/**
 * A lazy route turns a deploy into a new failure mode: the old chunk is gone, and
 * a tab that was opened before it asks for a file that no longer exists. From the
 * outside that is "the page did not open" - nothing to act on.
 *
 * These tests pin both halves: the shapes of the error that are recognisable, and
 * the rule that a reload happens at most once per window. The window matters as
 * much as the reload: without it a genuinely missing chunk loops the page and
 * hides the failure instead of showing it.
 */
describe('chunk reload', () => {
  function memoryStorage(): Storage {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (k: string) => map.get(k) ?? null,
      key: (i: number) => [...map.keys()][i] ?? null,
      removeItem: (k: string) => void map.delete(k),
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  }

  it('recognises what browsers say when a chunk is gone', () => {
    const real = [
      'Failed to fetch dynamically imported module: https://x/main-ABC.js',
      'Loading chunk 5 failed.',
      'Importing a module script failed.',
      'error loading dynamically imported module',
    ];
    for (const message of real) {
      expect(isChunkLoadError({ message })).withContext(message).toBeTrue();
    }
  });

  it('recognises it when it arrives wrapped in the navigation event', () => {
    expect(isChunkLoadError({ error: { message: 'Loading chunk 12 failed.' } })).toBeTrue();
  });

  it('does not mistake an ordinary error for a stale bundle', () => {
    expect(isChunkLoadError({ message: 'Cannot read properties of undefined' })).toBeFalse();
    expect(isChunkLoadError(null)).toBeFalse();
    expect(isChunkLoadError({})).toBeFalse();
  });

  it('reloads once and refuses to loop', () => {
    const storage = memoryStorage();
    let reloads = 0;
    const reload = () => reloads++;

    expect(reloadAfterChunkFailure(storage, reload, 1_000)).toBeTrue();
    expect(reloads).withContext('first failure reloads').toBe(1);

    // Same broken chunk a second later: reloading again would only flicker.
    expect(reloadAfterChunkFailure(storage, reload, 2_000)).toBeFalse();
    expect(reloads).withContext('second failure inside the window must not reload').toBe(1);

    // Outside the window the tab deserves another try: the deployment may have
    // been fixed, or the user switched networks.
    expect(reloadAfterChunkFailure(storage, reload, 1_000 + CHUNK_RELOAD_WINDOW_MS + 1)).toBeTrue();
    expect(reloads).toBe(2);
  });
});

/**
 * Build stamp: identifies exactly which build is in front of the user.
 *
 * The problem it solves. `/api/version` returns the **server's** release number,
 * which the client never changes, so a browser two days behind its server still
 * reports the same version as a current one. There was no way to answer "am I
 * running the build the server is serving?", which is why "Проверить обновление
 * PWA" could say "Версия актуальна" with a pending update on screen.
 *
 * Where the stamp lives, and why that matters. It goes into `index.html` as a
 * meta tag, read back at runtime from the DOM. Embedding it in the JS bundle
 * instead would need a generated source file (no `define` in the Angular CLI),
 * and a separate fetched file would be served stale by the service worker - at
 * which point it says "current" while the bundle is old, which is the exact lie
 * being fixed. The meta tag cannot drift from the bundle: index.html names that
 * bundle, so a cached document and a stale stamp always agree, and a fresh
 * document always carries the fresh stamp.
 *
 * No node builtins here, on purpose: this module is imported by the Angular
 * client, which is bundled for the browser. The git side lives in
 * stamp-from-git.mjs, which only the build script pulls in. Merging them back
 * would break the browser build on `node:child_process`.
 *
 * Writing and reading sit in one file for the same reason the split above
 * exists: the name of the meta tag is written here and asked for here, so the
 * two cannot drift. They did drift in the first version - the writer emitted
 * `build-stamp` while the service spelled the selector out again by hand - and
 * no test failed, because each side had its own.
 */

export const META_NAME = 'build-stamp';

/**
 * Builds the stamp out of what git and the clock know.
 *
 * Dirty is not decoration: a build from an uncommitted tree reports the last
 * commit, and comparing it against a server that built from a commit would
 * wrongly look current.
 *
 * @returns {{value: string, commit: string, dirty: boolean, builtAt: string}}
 */
export function makeStamp({ commit, dirty, builtAt }) {
  return { value: dirty ? `${commit}-dirty` : commit, commit, dirty, builtAt };
}

/** Injects the stamp into the built document. Idempotent. */
export function injectStamp(html, stamp) {
  const meta = `<meta name="${META_NAME}" content="${stamp.value}">`;
  const withTime = `<meta name="${META_NAME}-built" content="${stamp.builtAt}">`;

  const anyTag = new RegExp(`<meta\\s+name=["']${META_NAME}["'][^>]*>`, 'i');
  const anyTime = new RegExp(`<meta\\s+name=["']${META_NAME}-built["'][^>]*>`, 'i');

  // Заменой, а не добавлением: скрипт может быть запущен на документе, где
  // метка уже есть (пересборка поверх прежнего dist). Два тега означали бы,
  // что читается первый - старый.
  let out = html.replace(anyTag, '').replace(anyTime, '');

  if (!/<\/head>/i.test(out)) {
    throw new Error('в index.html нет </head> — метку некуда вставить');
  }
  out = out.replace(/<\/head>/i, `  ${meta}\n  ${withTime}\n</head>`);
  return out;
}

/**
 * The value the browser will read at runtime.
 *
 * Takes anything with `querySelector`, which is what lets the same function run
 * in the browser against `document.head` and under node against a stub. Returns
 * null when there is no stamp - an absent stamp is unknown, never current.
 */
export function stampFromHead(head) {
  return head?.querySelector?.(`meta[name="${META_NAME}"]`)?.getAttribute('content') || null;
}

/** Build time, same reasoning: one definition, read where it is written. */
export function builtAtFromHead(head) {
  const el = head?.querySelector?.(`meta[name="${META_NAME}-built"]`);
  return el?.getAttribute('content') || null;
}
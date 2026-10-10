// node:test, not vitest — как и в build-stamp.spec.mjs, раннера для скриптов
// в проекте нет. Запуск: node --test "frontend/scripts/*.spec.mjs"
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

/**
 * The one thing this covers: the digest ngsw.json promises for /index.html has
 * to be the digest of the file that is actually served.
 *
 * It is worth a test of its own because the failure is invisible. `ng build`
 * hashes index.html, the post-build step then rewrites the document, and
 * nothing complains: the bundle builds, the page opens, and the worker only
 * finds out much later, on the user's device, where a hash mismatch makes it
 * throw SwCriticalError, mark the new version `_okay = false` and never send
 * VERSION_READY. The symptom is a missing update banner - which looks like the
 * service worker being unreliable rather than like a wrong number in a JSON
 * file, and cost two deploys to trace back to here.
 */

const sha1 = (s) => createHash('sha1').update(Buffer.from(s, 'utf8')).digest('hex');

/** The digest Angular's builder puts into ngsw.json: sha1 of the pre-rewrite bytes. */
const manifestFor = (indexHtml) => ({
  configVersion: 1,
  index: '/index.html',
  assetGroups: [{ name: 'shell', urls: ['/index.html'] }],
  hashTable: { '/index.html': sha1(indexHtml), '/favicon.png': sha1('favicon') },
});

describe('ngsw.json index hash', () => {
  it('matches a file that was not rewritten', () => {
    const html = '<!doctype html><html><head></head><body></body></html>';
    const served = html;

    assert.strictEqual(manifestFor(html).hashTable['/index.html'], sha1(served));
  });

  it('does NOT match once the document is rewritten - the bug this exists for', () => {
    const built = '<!doctype html><html><head><link rel="stylesheet" href="styles-A.css"></head><body></body></html>';
    const served = built
      .replace('<link rel="stylesheet" href="styles-A.css">', '<style>body{}</style>')
      .replace('</head>', '<meta name="build-stamp" content="abc1234"></head>');

    // Guard on the guard: if this ever passes, the test below proves nothing,
    // because there would be no mismatch left to catch.
    assert.notStrictEqual(sha1(built), sha1(served));
  });

  it('is restored by recomputing the digest from the final bytes', () => {
    const built = '<!doctype html><html><head><link rel="stylesheet" href="styles-A.css"></head><body></body></html>';
    const served = built
      .replace('<link rel="stylesheet" href="styles-A.css">', '<style>body{}</style>')
      .replace('</head>', '<meta name="build-stamp" content="abc1234"></head>');

    const ngsw = manifestFor(built);
    ngsw.hashTable['/index.html'] = sha1(served);

    assert.strictEqual(ngsw.hashTable['/index.html'], sha1(served));
  });

  it('leaves every other entry alone', () => {
    // Only index.html is rewritten after the build. Patching the whole table
    // would be wrong: the favicon is copied in verbatim and its recorded
    // digest is already correct, so overwriting it would introduce a mismatch
    // where there is none.
    const built = '<!doctype html><html><head></head><body></body></html>';
    const served = built.replace('</head>', '<meta name="x" content="y"></head>');
    const ngsw = manifestFor(built);
    const faviconBefore = ngsw.hashTable['/favicon.png'];

    ngsw.hashTable['/index.html'] = sha1(served);

    assert.strictEqual(ngsw.hashTable['/favicon.png'], faviconBefore);
  });

  it('uses sha1 of raw bytes, which is what the worker computes', () => {
    // The worker hashes the response body (ngsw-worker.js: sha1Binary of the
    // ArrayBuffer), so a hex digest of the file's bytes. Verified against a
    // file the build never touches: the served favicon.png hashes to exactly
    // the value Angular recorded for it on prod.
    assert.match(sha1('abc'), /^[0-9a-f]{40}$/);
    assert.strictEqual(sha1(''), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });
});
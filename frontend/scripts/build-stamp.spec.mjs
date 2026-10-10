// node:test, not vitest: the project has no runner for plain scripts, and adding
// one for two files would be a dependency nobody asked for. Run with
// `node --test "frontend/scripts/*.spec.mjs"` - a bare directory argument does
// not work on node 24, it tries to load the directory as a module.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { injectStamp, stampFromHead, builtAtFromHead, META_NAME } from './build-stamp.mjs';

/**
 * The stamp is written by the post-build step and read back by the client. A
 * silent failure in the middle produces a document with no stamp, which the UI
 * would then show as "unknown" - so these assert both the happy path and that a
 * second injection does not leave two tags behind.
 *
 * These run under node, with a stub head standing in for `document.head`. That
 * is enough for the writer/reader agreement below because both sides come from
 * the same module and the stub is generic; BuildStampService's own reach into a
 * real DOM is covered under Karma.
 */
describe('build stamp', () => {
  const html = (head) => `<!doctype html><html><head>${head}</head><body></body></html>`;

  /** Minimal querySelector: understands `meta[name="..."]` over a string of HTML. */
  function stubHead(inner) {
    return {
      querySelector(selector) {
        const name = selector.match(/name="([^"]+)"/)?.[1];
        const content = inner.match(new RegExp(`name="${name}"\\s+content="([^"]*)"`))?.[1];
        return content === undefined ? null : { getAttribute: () => content };
      },
    };
  }

  /** The head of a built document, as the client would find it. */
  function headOf(document) {
    return stubHead(document.slice(document.indexOf('<head>') + 6, document.indexOf('</head>')));
  }

  it('injects both tags before </head>', () => {
    const out = injectStamp(html('<title>x</title>'), {
      value: 'abc1234', commit: 'abc1234', dirty: false, builtAt: '2026-10-10 16:40:04',
    });

    assert.ok(out.includes(`<meta name="${META_NAME}" content="abc1234">`));
    assert.ok(out.includes('<meta name="build-stamp-built" content="2026-10-10 16:40:04">'));
    assert.ok(out.indexOf(META_NAME) < out.indexOf('</head>'));
  });

  it('is idempotent - a second pass replaces rather than appends', () => {
    const once = injectStamp(html(''), {
      value: 'aaa1111', commit: 'aaa1111', dirty: false, builtAt: 't1',
    });
    const twice = injectStamp(once, {
      value: 'bbb2222', commit: 'bbb2222', dirty: false, builtAt: 't2',
    });

    const count = (twice.match(new RegExp(`name="${META_NAME}"`, 'g')) || []).length;
    assert.strictEqual(count, 1);
    assert.ok(twice.includes('bbb2222'));
    assert.ok(!twice.includes('aaa1111'));
  });

  it('survives being run against a document that already had one', () => {
    // The real sequence: a stale index.html from a previous build can already
    // carry a tag, and the post-build step must not produce a second.
    const stale = html(`<meta name="${META_NAME}" content="old-stamp">`);
    const out = injectStamp(stale, {
      value: 'new-stamp', commit: 'new-stamp', dirty: false, builtAt: 't',
    });

    assert.strictEqual((out.match(new RegExp(`name="${META_NAME}"`, 'g')) || []).length, 1);
    assert.ok(out.includes('new-stamp'));
    assert.ok(!out.includes('old-stamp'));
  });

  it('refuses a document with no head instead of writing it nowhere', () => {
    assert.throws(() => injectStamp('<html><body>no head</body></html>', {
      value: 'x', commit: 'x', dirty: false, builtAt: 't',
    }));
  });

  describe('writer and reader agree', () => {
    // The seam. It was broken once: the writer emitted `build-stamp` while the
    // reader spelled the selector out again by hand. Both had their own passing
    // tests, and the settings page would have shown "неизвестно" on every build.
    // Any test of one side alone would not have noticed.

    it('reads back exactly what was written', () => {
      const built = injectStamp(html(''), {
        value: 'abc1234', commit: 'abc1234', dirty: false, builtAt: '2026-10-10 16:40:04',
      });

      assert.strictEqual(stampFromHead(headOf(built)), 'abc1234');
      assert.strictEqual(builtAtFromHead(headOf(built)), '2026-10-10 16:40:04');
    });

    it('reads back a dirty stamp with its suffix intact', () => {
      const built = injectStamp(html(''), {
        value: 'abc1234-dirty', commit: 'abc1234', dirty: true, builtAt: 't',
      });

      assert.strictEqual(stampFromHead(headOf(built)), 'abc1234-dirty');
    });

    it('reads the new value after a rebuild over a stale document', () => {
      // If a rebuild appended instead of replacing, the reader would take the
      // first tag and report the previous build - the exact "I am current" lie
      // the stamp exists to prevent.
      const stale = html(`<meta name="${META_NAME}" content="old-build">`);
      const rebuilt = injectStamp(stale, {
        value: 'new-build', commit: 'new-build', dirty: false, builtAt: 't2',
      });

      assert.strictEqual(stampFromHead(headOf(rebuilt)), 'new-build');
    });
  });

  describe('reading a document with no stamp', () => {
    // Unknown is not current. Everything that reports on freshness has to tell
    // these apart from a match.
    it('returns null, not an empty string and not a guess', () => {
      const head = stubHead('<title>no stamp here</title>');

      assert.strictEqual(stampFromHead(head), null);
      assert.strictEqual(builtAtFromHead(head), null);
    });

    it('survives a head that cannot answer at all', () => {
      assert.strictEqual(stampFromHead(null), null);
      assert.strictEqual(stampFromHead(undefined), null);
      assert.strictEqual(stampFromHead({}), null);
      assert.strictEqual(builtAtFromHead({}), null);
    });
  });
});
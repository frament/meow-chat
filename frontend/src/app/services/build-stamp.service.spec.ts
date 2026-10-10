import { TestBed } from '@angular/core/testing';
import { BuildStampService } from './build-stamp.service';
// The pure half of the build stamp: same module the post-build step writes
// with, and browser-safe (the git side lives in stamp-from-git.mjs).
import { injectStamp } from '../../../scripts/build-stamp.mjs';

/**
 * The stamp answers "am I running the build the server has?". Two ways it could
 * lie, and both are covered here:
 *
 *  - an absent stamp read as "current" - a document built without the post-build
 *    step would then look identical to an up-to-date one;
 *  - `-dirty` swallowed, so a build from an uncommitted tree looks matchable
 *    against a server that built from a commit.
 */
describe('BuildStampService', () => {
  let service: BuildStampService;

  function withStamp(content: string | null, built?: string) {
    document.head.innerHTML = content === null
      ? ''
      : `<meta name="build-stamp" content="${content}">` +
        (built ? `<meta name="build-stamp-built" content="${built}">` : '');
    TestBed.resetTestingModule();
    service = TestBed.inject(BuildStampService);
  }

  afterEach(() => { document.head.innerHTML = ''; });

  it('reads the stamp out of the document', () => {
    withStamp('abc1234');
    expect(service.stamp).toBe('abc1234');
  });

  it('reports unknown, not current, when the document carries no stamp', () => {
    withStamp(null);
    expect(service.stamp).toBeNull();
    // The failure this prevents: "неизвестно" shown as though it were a match.
    expect(service.displayStamp).toContain('неизвестно');
    expect(service.displayStamp).not.toContain('abc');
  });

  it('spells out a dirty tree instead of leaving it as a suffix', () => {
    withStamp('abc1234-dirty');
    expect(service.stamp).toBe('abc1234-dirty');
    expect(service.displayStamp).toContain('несохранённые правки');
  });

  it('leaves a clean stamp as-is', () => {
    withStamp('abc1234');
    expect(service.displayStamp).toBe('abc1234');
  });

  it('exposes the build time when there is one', () => {
    withStamp('abc1234', '2026-10-10 16:40:04');
    expect(service.builtAt).toBe('2026-10-10 16:40:04');
  });

  it('has no build time when the document has none', () => {
    withStamp('abc1234');
    expect(service.builtAt).toBeNull();
  });

  it('caches the lookup, and does not go back to the DOM for every read', () => {
    withStamp('abc1234');
    expect(service.stamp).toBe('abc1234');

    // A stamp that changed under a live component would be a bug of its own;
    // the value is fixed for the lifetime of the document.
    document.head.innerHTML = '<meta name="build-stamp" content="other">';
    expect(service.stamp).toBe('abc1234');
  });

  describe('written by the build script', () => {
    /**
     * The seam. Every other test here hand-writes the meta tag, so all of them
     * would pass with the writer and the reader disagreeing about the name -
     * a stamp nothing ever emits, read by a selector nothing ever matches, and
     * the settings page showing "неизвестно" forever. Only running the real
     * writer's output through the real reader catches that.
     */
    function stampWrittenByScript(value: string, builtAt: string) {
      const built = injectStamp('<!doctype html><html><head></head><body></body></html>', {
        value, commit: value.replace(/-dirty$/, ''), dirty: value.endsWith('-dirty'), builtAt,
      });
      document.head.innerHTML = built.slice(
        built.indexOf('<head>') + 6, built.indexOf('</head>'),
      );
      TestBed.resetTestingModule();
      return TestBed.inject(BuildStampService);
    }

    it('reads back exactly what the script wrote', () => {
      const written = stampWrittenByScript('abc1234', '2026-10-10 16:40:04');

      expect(written.stamp).toBe('abc1234');
      expect(written.builtAt).toBe('2026-10-10 16:40:04');
      expect(written.displayStamp).toBe('abc1234');
    });

    it('reads back a dirty stamp, still marked as dirty', () => {
      const written = stampWrittenByScript('abc1234-dirty', '2026-10-10 16:40:04');

      expect(written.stamp).toBe('abc1234-dirty');
      expect(written.displayStamp).toContain('несохранённые правки');
    });

    it('reads the same value a rebuild over a stale document leaves behind', () => {
      // A second build over an existing dist replaces the tag. If it appended
      // instead, the reader would take the first and report the previous build
      // - the exact "I am current" lie the stamp exists to prevent.
      const stale = '<!doctype html><html><head>' +
        '<meta name="build-stamp" content="old-build"></head><body></body></html>';
      const rebuilt = injectStamp(stale, {
        value: 'new-build', commit: 'new-build', dirty: false, builtAt: 't2',
      });

      document.head.innerHTML = rebuilt.slice(
        rebuilt.indexOf('<head>') + 6, rebuilt.indexOf('</head>'),
      );
      TestBed.resetTestingModule();

      expect(TestBed.inject(BuildStampService).stamp).toBe('new-build');
    });
  });
});
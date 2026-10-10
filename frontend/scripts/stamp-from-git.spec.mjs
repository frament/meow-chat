// The git half of the build stamp. node:test for the same reason as
// build-stamp.spec.mjs - no runner for plain scripts, and not worth a dependency.
import { describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { computeStamp } from './stamp-from-git.mjs';

const repoRoot = new URL('..', import.meta.url).pathname;

function git(args, cwd) {
  return execFileSync('git', args, {
    encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

describe('computeStamp', () => {
  it('reports dirtiness that matches git, so an uncommitted build is marked', () => {
    // Asserted against git rather than a literal: a hardcoded expectation would
    // silently stop testing anything the moment the tree changed state, which is
    // exactly the case this matters for. A mutation that pinned `dirty` to
    // false passed the first version of this test.
    let treeDirty;
    let head;
    try {
      treeDirty = git(['status', '--porcelain'], repoRoot) !== '';
      head = git(['rev-parse', '--short', 'HEAD'], repoRoot);
    } catch {
      return; // no git here (a tarball build) - nothing to compare against
    }

    // env: {} explicitly, and the reason matters: `make test-scripts` exports
    // BUILD_COMMIT for the docker build, so an omitted env here reads the
    // caller's commit and this test fails for a reason that has nothing to do
    // with the code. A test that depends on ambient environment is a test that
    // stops testing the moment the build harness changes.
    const stamp = computeStamp({ cwd: repoRoot, env: {} });
    assert.strictEqual(stamp.dirty, treeDirty);
    assert.strictEqual(stamp.value.endsWith('-dirty'), treeDirty);
    assert.strictEqual(stamp.commit, head);
  });

  it('degrades to unknown outside a repository instead of failing the build', () => {
    // A Docker build context without .git is a legitimate build, and
    // computeStamp runs on every build. Throwing here would break it.
    const stamp = computeStamp({ cwd: '/nonexistent-directory-for-test', env: {} });

    assert.strictEqual(stamp.commit, 'unknown');
    assert.strictEqual(stamp.value, 'unknown');
    assert.strictEqual(stamp.dirty, false);
  });

  describe('commit passed in as a build arg', () => {
    // This is the path that runs on the server. `.git/` is excluded by
    // .dockerignore, so inside the image there is no repository to ask - without
    // these the stamp on the deployed bundle would read "unknown" and the
    // feature would be inert exactly where it matters.

    it('uses the given commit instead of asking git', () => {
      // cwd points at a real repository, so a stamp of "unknown" here would mean
      // the argument was ignored rather than that git was unavailable.
      const stamp = computeStamp({ cwd: repoRoot, env: { BUILD_COMMIT: 'abc1234' } });

      assert.strictEqual(stamp.commit, 'abc1234');
      assert.strictEqual(stamp.value, 'abc1234');
    });

    it('honours the dirty flag alongside it', () => {
      const stamp = computeStamp({ cwd: repoRoot, env: { BUILD_COMMIT: 'abc1234', BUILD_DIRTY: 'true' } });

      assert.strictEqual(stamp.dirty, true);
      assert.strictEqual(stamp.value, 'abc1234-dirty');
    });

    it('treats anything but true as a clean tree', () => {
      // "1", "yes" and "" would be a caller guessing. A build that might be
      // dirty but reports itself clean is the one case the marker exists for.
      for (const value of ['1', 'yes', '', 'false', 'TRUE ']) {
        const dirty = value === 'TRUE ' ? true : false;
        const stamp = computeStamp({ cwd: repoRoot, env: { BUILD_COMMIT: 'abc1234', BUILD_DIRTY: value } });
        assert.strictEqual(stamp.dirty, dirty, `BUILD_DIRTY=${JSON.stringify(value)}`);
      }
    });

    it('falls back to git when no commit was passed', () => {
      const stamp = computeStamp({ cwd: repoRoot, env: {} });

      assert.notStrictEqual(stamp.value, 'unknown');
      assert.match(stamp.value, /^[0-9a-f]+(-dirty)?$/);
    });
  });

  it('carries a build time the client can show', () => {
    // The exact shape matters only in that it is readable; the value is not
    // asserted, since asserting the clock would fail by design after midnight.
    assert.match(computeStamp({ env: {} }).builtAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
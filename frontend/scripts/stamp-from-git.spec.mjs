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

    const stamp = computeStamp({ cwd: repoRoot });
    assert.strictEqual(stamp.dirty, treeDirty);
    assert.strictEqual(stamp.value.endsWith('-dirty'), treeDirty);
    assert.strictEqual(stamp.commit, head);
  });

  it('degrades to unknown outside a repository instead of failing the build', () => {
    // A Docker build context without .git is a legitimate build, and
    // computeStamp runs on every build. Throwing here would break it.
    const stamp = computeStamp({ cwd: '/nonexistent-directory-for-test' });

    assert.strictEqual(stamp.commit, 'unknown');
    assert.strictEqual(stamp.value, 'unknown');
    assert.strictEqual(stamp.dirty, false);
  });

  it('carries a build time the client can show', () => {
    // The exact shape matters only in that it is readable; the value is not
    // asserted, since asserting the clock would fail by design after midnight.
    assert.match(computeStamp().builtAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
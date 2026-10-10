/**
 * The node-only half of the build stamp: asks git what the build is.
 *
 * Split out of build-stamp.mjs because that module is imported by the Angular
 * client, and a browser bundle cannot resolve `node:child_process`. Only the
 * post-build step pulls this in.
 */
import { execFileSync } from 'node:child_process';
import { makeStamp } from './build-stamp.mjs';

/** Shallow clone depth does not bring tags, so a shallow checkout is fine. */
function git(args, cwd) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/**
 * @returns {{value: string, commit: string, dirty: boolean, builtAt: string}}
 */
export function computeStamp({ cwd } = {}) {
  let commit = 'unknown';
  let dirty = false;

  try {
    commit = git(['rev-parse', '--short', 'HEAD'], cwd);
    // --porcelain covers staged, unstaged and untracked. Untracked files count:
    // a new file that is not yet committed is not in that build on the server.
    dirty = git(['status', '--porcelain'], cwd) !== '';
  } catch {
    // A tarball with no .git is a legitimate build - a Docker build context that
    // did not copy it, or an export. "unknown" is honest; failing the build is not.
  }

  const builtAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  return makeStamp({ commit, dirty, builtAt });
}
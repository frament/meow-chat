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
export function computeStamp({ cwd, env = process.env } = {}) {
  // Inside the Docker build there is no .git (excluded by .dockerignore), so the
  // commit arrives as a build arg instead. Without this the stamp on the server
  // reads "unknown" and the whole feature is inert in production.
  const fromEnv = env.BUILD_COMMIT?.trim();

  let commit = 'unknown';
  let dirty = false;

  if (fromEnv) {
    commit = fromEnv;
    // Only "true" counts: an unset or empty arg means the caller did not say,
    // and claiming a clean tree on a build that might not be one is the lie the
    // -dirty marker exists to prevent.
    dirty = env.BUILD_DIRTY?.trim().toLowerCase() === 'true';
  } else {
    try {
      commit = git(['rev-parse', '--short', 'HEAD'], cwd);
      // --porcelain covers staged, unstaged and untracked. Untracked files count:
      // a new file that is not yet committed is not in that build on the server.
      dirty = git(['status', '--porcelain'], cwd) !== '';
    } catch {
      // A tarball with no .git is a legitimate build. "unknown" is honest;
      // failing the build is not.
    }
  }

  const builtAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  return makeStamp({ commit, dirty, builtAt });
}
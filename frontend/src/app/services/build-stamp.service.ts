import { Injectable } from '@angular/core';
import { stampFromHead, builtAtFromHead } from '../../../scripts/build-stamp.mjs';

/**
 * Which build this browser is actually running.
 *
 * The stamp is a `<meta name="build-stamp">` in index.html, written at build
 * time (see `scripts/build-stamp.mjs`) and read back from the DOM here.
 *
 * Reading it from the document rather than baking it into the JS is what makes
 * the answer trustworthy. index.html names the bundle it loads, so a document
 * served from the service-worker cache carries the stamp of the build that
 * document belongs to - which is exactly the question being asked. A stamp in
 * the bundle would need a generated source file (no `define` in the Angular
 * CLI), and a stamp fetched over the network could be served stale and say
 * "current" while the code is not.
 *
 * `null` means the document has no stamp: a `ng build` run without the
 * post-build step, or a unit test with a synthetic DOM. Callers must show it as
 * unknown rather than as fresh - an absent stamp is not a current one.
 *
 * The selector comes from `scripts/build-stamp.mjs` rather than being spelled
 * out here. It is the same module that writes the tag, so the two cannot drift;
 * when they were separate literals, both had their own passing tests and the
 * client would still have shown "неизвестно" on every build.
 *
 * There is deliberately no "compare against the server over the network" method.
 * It was written and removed: a `fetch('/index.html')` would be answered by the
 * service worker itself, so the client would compare its own cached document
 * against itself and report "current" - a false reassurance, which is the one
 * failure this whole thing exists to prevent. Bypassing the worker reliably
 * (a cache-busting query makes ngsw treat the URL as an unhashed asset) is
 * doable but fiddly enough that a wrong answer would be worse than none. The
 * comparison stays manual: the stamp is on screen, and the server's is one
 * `curl` away.
 */
@Injectable({ providedIn: 'root' })
export class BuildStampService {
  private cached: string | null | undefined;

  /** The commit this bundle was built from, `-dirty` if the tree was not clean. */
  get stamp(): string | null {
    if (this.cached === undefined) {
      this.cached = stampFromHead(document.head);
    }
    return this.cached;
  }

  /** When the build ran, to tell two builds of one commit apart. */
  get builtAt(): string | null {
    return builtAtFromHead(document.head);
  }

  /**
   * The stamp as it should appear on screen.
   *
   * `-dirty` is spelled out in the UI rather than left as a suffix: it means
   * the build came from a tree with uncommitted changes, so it cannot be
   * matched against a server that built from a commit.
   */
  get displayStamp(): string {
    const stamp = this.stamp;
    if (!stamp) return 'неизвестно (сборка без метки)';
    return stamp.endsWith('-dirty') ? `${stamp} — несохранённые правки` : stamp;
  }
}
/**
 * Types for the pure build-stamp module, so the Angular client can import it.
 *
 * The module is plain JS because it runs at build time under node as well as in
 * the browser. `allowJs` is off, so without this declaration the compiler types
 * the import as `any` and reads nothing.
 */
export const META_NAME: string;

export interface Stamp {
  /** What the client shows and compares: the commit, `-dirty` when uncommitted. */
  value: string;
  commit: string;
  dirty: boolean;
  /** `YYYY-MM-DD HH:MM:SS` in UTC. */
  builtAt: string;
}

export function makeStamp(input: { commit: string; dirty: boolean; builtAt: string }): Stamp;

/** Throws if the document has no `<head>` to write into. */
export function injectStamp(html: string, stamp: Stamp): string;

/** The stamp in `document.head`, or null when it carries none. */
export function stampFromHead(head: { querySelector?: (s: string) => any } | null | undefined): string | null;

export function builtAtFromHead(head: { querySelector?: (s: string) => any } | null | undefined): string | null;
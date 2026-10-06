import { HttpInterceptorFn } from '@angular/common/http';
import { defer, from } from 'rxjs';
import { concatMap, finalize } from 'rxjs/operators';

/**
 * Caps how many API requests may be in flight at once.
 *
 * Measured on LTE through the router's proxy: a fresh connection costs about a
 * second (TCP connect 494ms + TLS 413ms), and the settings page asks for eleven
 * things the moment it opens. A single request, in a private tab, went through in
 * 2.7s - but the burst did not: in the captured HAR eleven requests sat `blocked`
 * in the browser for ~216 seconds and then completed together, while the server
 * log showed nothing arriving for those three and a half minutes. The block needed
 * the burst.
 *
 * Serialising a few at a time also makes the requests share one warm connection
 * instead of paying a handshake each, so this is not only a defensive limit.
 *
 * Uploads are exempt: they are long by nature, and one holding the gate would
 * stall everything behind it.
 */
const MAX_CONCURRENT_REQUESTS = 3;

let active = 0;
const waiting: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT_REQUESTS) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  if (next) {
    // The slot hands straight over; `active` stays as it is.
    next();
    return;
  }
  active--;
}

export const concurrencyInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.body instanceof FormData) {
    return next(req);
  }

  // defer, so the slot is taken when the request is actually subscribed to rather
  // than when the interceptor is built - a request that is never started must not
  // hold one.
  return defer(() =>
    from(acquire()).pipe(
      concatMap(() => next(req)),
      // Covers completion, error and unsubscription alike, so a cancelled request
      // cannot leak its slot and wedge the queue.
      finalize(() => release()),
    ),
  );
};

/** Exported so a test cannot drift from the value the app actually uses. */
export const MAX_CONCURRENT = MAX_CONCURRENT_REQUESTS;

/** Test-only: puts the gate back to its starting state between specs. */
export function resetConcurrency(): void {
  active = 0;
  waiting.length = 0;
}

import { HttpInterceptorFn } from '@angular/common/http';
import { defer, from } from 'rxjs';
import { concatMap, finalize } from 'rxjs/operators';

/**
 * Caps how many API requests may be in flight at once.
 *
 * Measured, not guessed. Through the relay on LTE a burst of three parallel
 * requests arrives complete; a burst of four arrives as one request and the rest
 * never reach the host at all - nginx logs nothing for them and the browser
 * holds them `blocked` until they time out. That is the whole of the "spins
 * forever, then breaks through after a while" behaviour, and it also explains why
 * it only ever showed up on cellular: on WiFi the phone talks to the router and
 * never reaches the relay, which has no such limit.
 *
 * Two, not three: three is exactly the measured ceiling, and this gate competes
 * for the same slots as the service worker's own fetches and the health poll. A
 * request that sits in this queue costs a full connection setup (measured at
 * 500-1650ms for the handshake alone over LTE), so the cap is set with room to
 * spare rather than at the edge.
 *
 * Note what this does *not* cover: <script> and <link> on a cold page load open
 * their own connections and never pass through here. That is why the build
 * inlines the stylesheet and the favicon - it takes the cold load from seven
 * connections down to five.
 *
 * Uploads are exempt: they are long by nature, and one holding the gate would
 * stall everything behind it.
 */
const MAX_CONCURRENT_REQUESTS = 2;

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

import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { TimeoutError, throwError, timer } from 'rxjs';
import { timeout, catchError, retryWhen, mergeMap } from 'rxjs/operators';

/**
 * Ceilings on how long a request may stay unanswered, and one retry when it does.
 *
 * Measured on LTE through the relay: a request the browser has not dispatched at
 * all - no address, no status, nothing in the network tab - sits in its queue
 * until something times out. `wait` was ~150ms throughout, so the server was
 * never the slow part.
 *
 * A blocked request is worse than a failed one: a failure can be shown and
 * retried, while a block keeps every dependent piece of the screen waiting. The
 * timeout bounds it, and the retry is not just a second attempt - aborting a
 * request stuck on a connection is what makes the browser drop that connection,
 * so the retry has a real chance of going out on a fresh one.
 *
 * Twelve seconds, not thirty. A new connection over LTE costs 693-2905ms
 * (measured, median 1137ms), so twelve is still four times the worst observed
 * handshake. Thirty was the wrong number twice over: the user waited a full minute
 * for a login attempt that had never left the browser, because the timeout fired
 * once and then the retry sat through another full ceiling.
 *
 * Uploads are excluded: a photo over a slow link can legitimately take minutes,
 * and aborting it would lose the upload rather than report a problem with it.
 */
const REQUEST_TIMEOUT_MS = 12000;
const RETRY_DELAY_MS = 1000;

/**
 * Requests that may be repeated even though they are POSTs.
 *
 * A POST is normally not repeated: it may still be processing on the server, and
 * repeating it would duplicate the message or the post. These two have no such
 * effect - they only hand back a token, and a second token costs nothing.
 *
 * Login is here because it is the one request a user makes in a state where they
 * cannot do anything else. Failing to sign in leaves the app unusable with no
 * workaround, and the failure it guards against - a connection dropped by the
 * relay - is exactly what a second attempt can escape.
 */
const RETRYABLE_POSTS = [/\/api\/login$/, /\/api\/refresh$/];

export const timeoutInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.body instanceof FormData) {
    return next(req);
  }

  const attempt = next(req).pipe(
    timeout(REQUEST_TIMEOUT_MS),
    catchError((err) => {
      if (err instanceof TimeoutError) {
        // Shaped like an HttpErrorResponse so callers that already branch on
        // status need no second kind of failure. Status 0 is what Angular uses
        // for "no response", which is what a timeout is.
        return throwError(() => new HttpErrorResponse({
          status: 0,
          statusText: 'Request timed out',
          url: req.url,
          error: { error: 'timeout' },
        }));
      }
      return throwError(() => err);
    }),
  );

  const retryable = req.method === 'GET'
    || RETRYABLE_POSTS.some((re) => re.test(req.urlWithParams));
  if (!retryable) {
    return attempt;
  }

  return attempt.pipe(
    retryWhen((errors) => errors.pipe(
      mergeMap((err, index) =>
        // One retry, and only for a timeout - a 401 or a 500 is an answer, and
        // asking again would produce the same one.
        index === 0 && err instanceof HttpErrorResponse && err.status === 0
          ? timer(RETRY_DELAY_MS)
          : throwError(() => err),
      ),
    )),
  );
};

/** Exported so a test cannot drift from the value the app actually uses. */
export const REQUEST_TIMEOUT = REQUEST_TIMEOUT_MS;
/** Exported for the same reason, so a test can advance past it. */
export const REQUEST_RETRY_DELAY = RETRY_DELAY_MS;

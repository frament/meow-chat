import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { TimeoutError, throwError, timer } from 'rxjs';
import { timeout, catchError, retryWhen, mergeMap } from 'rxjs/operators';

/**
 * Ceilings on how long a request may stay unanswered, and one retry when it does.
 *
 * Measured on LTE, through the router's proxy: eleven requests issued at once all
 * sat `blocked` in the browser for ~216 seconds and then completed together the
 * moment the queue cleared. `wait` was ~120ms throughout, so the server was never
 * the slow part - the requests were not even sent. That is the "sometimes it
 * breaks through after a while, but F5 breaks it again" report.
 *
 * A blocked request is worse than a failed one: a failure can be shown and
 * retried, while a block keeps every dependent piece of the screen waiting. The
 * timeout bounds it, and the single retry is not just a second attempt - aborting
 * a request that is stuck on a connection is what makes the browser drop that
 * connection, so the retry has a real chance of going out on a fresh one.
 *
 * Uploads are excluded: a photo over a slow link can legitimately take minutes,
 * and aborting it would lose the upload rather than report a problem with it.
 */
const REQUEST_TIMEOUT_MS = 30000;
const RETRY_DELAY_MS = 500;

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

  // Retried only when the request cannot have had an effect. A POST that timed out
  // may still be processing on the server, and repeating it would duplicate the
  // message or the post.
  if (req.method !== 'GET') {
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

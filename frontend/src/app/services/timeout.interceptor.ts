import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { TimeoutError, throwError } from 'rxjs';
import { timeout, catchError } from 'rxjs/operators';

/**
 * Puts a ceiling on how long a request may stay unanswered.
 *
 * Without one an API call that never gets a reply leaves the UI spinning
 * indefinitely - which is what was reported: requests to /api circling forever in
 * the network tab, with the server never seeing them. A hung request is worse than
 * a failed one: a failure can be shown, retried and dismissed, while a hang keeps
 * every dependent piece of the screen waiting and the user with no idea why.
 *
 * Uploads are excluded. A photo over a slow mobile link can legitimately take
 * minutes; cutting it off would lose the upload rather than report a problem.
 */
const REQUEST_TIMEOUT_MS = 30000;

export const timeoutInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.body instanceof FormData) {
    return next(req);
  }

  return next(req).pipe(
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
};

/** Exported so a test cannot drift from the value the app actually uses. */
export const REQUEST_TIMEOUT = REQUEST_TIMEOUT_MS;

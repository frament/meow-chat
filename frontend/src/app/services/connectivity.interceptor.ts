import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs/operators';

import { ConnectivityService } from './connectivity.service';

/**
 * Reports every request's outcome to ConnectivityService.
 *
 * Sits inside the auth interceptor so it sees the status the app will act on: a
 * 401 that the refresh token then fixes is invisible here, which is right - the
 * user never saw a problem, so the app should not tell them about one.
 */
export const connectivityInterceptor: HttpInterceptorFn = (req, next) => {
  const conn = inject(ConnectivityService);
  return next(req).pipe(
    // tap's error callback observes and rethrows, so the request keeps failing
    // exactly as it did before this interceptor existed.
    tap({
      next: () => conn.reportSuccess(),
      error: (err) => conn.reportFailure(err instanceof HttpErrorResponse ? err.status : 0),
    }),
  );
};
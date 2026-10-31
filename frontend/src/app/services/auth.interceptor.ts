import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from './api.service';
import { catchError, switchMap, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const api = inject(ApiService);
  const router = inject(Router);

  const accessToken = api.accessToken();
  if (accessToken) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${accessToken}` },
    });
  }

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (
        error.status === 401 &&
        !req.url.includes('/login') &&
        !req.url.includes('/register') &&
        !req.url.includes('/refresh') &&
        !req.url.includes('/logout')
      ) {
        return api.refreshAccessToken().pipe(
          switchMap((res) => {
            const newReq = req.clone({
              setHeaders: { Authorization: `Bearer ${res.access_token}` },
            });
            return next(newReq);
          }),
          catchError((refreshError) => {
            // By status, not by type: "no refresh token" is our own Error with
            // status 401, and instanceof would let that one through as a silent
            // failure - the app then stayed offline instead of asking to sign in.
            if ((refreshError as HttpErrorResponse)?.status === 401) {
              api.logout();
              router.navigate(['/login']);
            }
            return throwError(() => error);
          })
        );
      }
      return throwError(() => error);
    })
  );
};

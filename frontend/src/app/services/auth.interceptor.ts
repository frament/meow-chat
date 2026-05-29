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
        !req.url.includes('/refresh')
      ) {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) {
          api.logout();
          router.navigate(['/login']);
          return throwError(() => error);
        }

        return api.refreshToken().pipe(
          switchMap((res) => {
            localStorage.setItem('accessToken', res.access_token);
            localStorage.setItem('refreshToken', res.refresh_token);
            api.accessToken.set(res.access_token);

            const newReq = req.clone({
              setHeaders: { Authorization: `Bearer ${res.access_token}` },
            });
            return next(newReq);
          }),
          catchError(() => {
            api.logout();
            router.navigate(['/login']);
            return throwError(() => error);
          })
        );
      }
      return throwError(() => error);
    })
  );
};

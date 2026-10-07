import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './services/auth.interceptor';
import { timeoutInterceptor } from './services/timeout.interceptor';
import { concurrencyInterceptor } from './services/concurrency.interceptor';
import { connectivityInterceptor } from './services/connectivity.interceptor';
import { provideServiceWorker } from '@angular/service-worker';

// Logs actionable error text instead of Angular's default "[object Object]".
class LoggingErrorHandler implements ErrorHandler {
  handleError(error: any): void {
    try {
      if (error?.status && error?.url) {
        console.error(`AppError: HTTP ${error.status} ${error.message || ''} ${error.url}`);
      } else {
        console.error('AppError:', error?.message ?? String(error), error?.stack ?? '');
      }
    } catch {
      console.error('AppError: unknown');
    }
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: LoggingErrorHandler },
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // Order matters, outermost first:
    //   concurrency - a slot is held for the whole chain, including the retry;
    //   timeout     - a stuck request gives its slot back instead of keeping it
    //                 for the full ceiling;
    //   connectivity- sees the status the user is finally shown, and sees it
    //                 after the timeout has turned a hang into a status 0;
    //   auth        - innermost, so a 401 that the refresh token then fixed is
    //                 never reported to the banner.
    provideHttpClient(
      withInterceptors([concurrencyInterceptor, timeoutInterceptor, connectivityInterceptor, authInterceptor]),
    ),
    provideServiceWorker('sw-push-handler.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};

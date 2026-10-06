import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './services/auth.interceptor';
import { timeoutInterceptor } from './services/timeout.interceptor';
import { concurrencyInterceptor } from './services/concurrency.interceptor';
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
    // Timeout first: it wraps the request the interceptor chain builds, so the
    // ceiling applies to the retried request too, not only the original.
    // Order matters. Concurrency outermost, so a slot is held for the whole chain
    // including the retry; timeout next, so a stuck request gives its slot back;
    // auth innermost, so its refresh-and-retry does not take a second slot.
    provideHttpClient(withInterceptors([concurrencyInterceptor, timeoutInterceptor, authInterceptor])),
    provideServiceWorker('sw-push-handler.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};

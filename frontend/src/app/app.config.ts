import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './services/auth.interceptor';
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
    provideHttpClient(withInterceptors([authInterceptor])),
    provideServiceWorker('sw-push-handler.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};

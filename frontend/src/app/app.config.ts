import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, isDevMode } from '@angular/core';
import { provideRouter, withNavigationErrorHandler } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { isChunkLoadError, reloadAfterChunkFailure } from './chunk-reload';
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
    provideRouter(
      routes,
      // A lazy route that cannot download its chunk used to look like "the page
      // did not open": nothing to act on, no cause. After a deploy the old chunks
      // are gone, so the cure is one reload that picks up the new index.html.
      withNavigationErrorHandler((event) => {
        if (!isChunkLoadError(event.error)) return;
        if (reloadAfterChunkFailure(sessionStorage, () => window.location.reload())) return;
        // A second failure inside the window: reloading again would loop. Say it
        // out loud instead - the diagnostics panel collects it as well.
        console.error(
          'Navigation failed: a lazily loaded part of the app could not be downloaded. ' +
            'Reload the page; if it repeats, the deployment is incomplete.',
          event.error,
        );
      }),
    ),
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
      // Пять секунд, а не тридцать. При тридцати обновление не ставилось вовсе,
      // если страницу перезагрузили раньше: service worker не зарегистрирован —
      // новой версии нет. Проверено на себе - HAR показывал main-JKU7KMLV.js,
      // тогда как прод уже отдавал main-2OLX7FD7.js. То есть приложение целиком
      // работало на старом бандле, и все правки после него не действовали.
      registrationStrategy: 'registerWhenStable:5000',
    }),
  ],
};

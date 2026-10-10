import { Injectable, signal } from '@angular/core';

/**
 * Whether a downloaded service-worker version is waiting to be activated.
 *
 * It is a service rather than a field on the app component because two places
 * need the same answer and neither owns it: the banner in the app shell, and the
 * "Проверить обновление PWA" button in settings. When only the banner had it,
 * the button answered a different question - `checkForUpdate()`, which asks
 * whether there is anything *newer* to download - and so it said "Версия
 * актуальна" while a downloaded update was sitting there waiting, contradicting
 * the banner right above it.
 *
 * The signal is set from `SwUpdate.versionUpdates` (VERSION_READY) and cleared
 * when an update is activated, which reloads the page anyway.
 */
@Injectable({ providedIn: 'root' })
export class UpdateAvailableService {
  private readonly available = signal(false);

  /** True when a downloaded version is waiting to be activated. */
  isUpdateAvailable = this.available.asReadonly();

  setUpdateAvailable(value: boolean): void {
    this.available.set(value);
  }
}
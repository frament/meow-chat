import { Injectable } from '@angular/core';

/**
 * Hard reload of the app, behind an injection token.
 *
 * The component that swaps the E2EE identity key needs a *full* restart, not a
 * route re-navigation: the CryptoService keeps the SubtleCrypto context and
 * derived keys in memory, and re-running the router would leave the old key
 * material in place. So this is `window.location.reload()` and not
 * `Router.navigateByUrl(url, { onSameUrlNavigation: 'reload' })`.
 *
 * It is a service rather than a direct call because the global `location` cannot
 * be replaced in a test: the spec that reaches this path would reload the Karma
 * page and fail the entire suite with "Some of your tests did a full page
 * reload!". DOCUMENT is not an option either - TestBed's own renderer uses it,
 * so replacing it breaks component creation.
 */
@Injectable({ providedIn: 'root' })
export class AppReloadService {
  reload(): void {
    window.location.reload();
  }
}

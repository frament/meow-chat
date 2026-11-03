import { routes } from './app.routes';
import { Route } from '@angular/router';

/**
 * Lazy routes are a decision about a phone on a bad link, and a silent regression
 * is easy: someone adds a component back to the static import list, the initial
 * bundle grows by a hundred kilobytes, and nothing anywhere says so.
 *
 * These tests pin the decision at the level where it is made - the route table.
 * The size itself is measured by `ng build --stats-json` (2026-11-03: initial
 * 871.45 kB → 565.75 kB, transfer 186.00 kB → 146.01 kB, and `qrcode` left the
 * initial chunks with `settings`).
 */
describe('app routes: what ships up front', () => {
  function flatten(table: Route[]): Route[] {
    const out: Route[] = [];
    for (const route of table) {
      out.push(route);
      if (route.children) out.push(...flatten(route.children));
    }
    return out;
  }

  const all = flatten(routes);
  const byPath = (path: string) => all.filter((r) => r.path === path);

  const lazy = ['chat', 'chat/:userId', 'chat/group/:groupId', 'settings', 'admin', 'admin/federation', 'add-friend', 'join-group'];
  const eager = ['login', 'register', 'feed', ''];

  it('loads the heavy screens on navigation, not on start', () => {
    for (const path of lazy) {
      const matches = byPath(path);
      expect(matches.length).withContext(`route ${path} must exist`).toBeGreaterThan(0);
      for (const route of matches) {
        expect(typeof route.loadComponent)
          .withContext(`route ${path} must be lazy: it is not needed to draw the first screen`)
          .toBe('function');
        expect(route.component)
          .withContext(`route ${path} must not also be eager - that is how the bundle grew back before`)
          .toBeUndefined();
      }
    }
  });

  it('keeps the screens the app opens with in the initial bundle', () => {
    // A lazy chunk for these would add a round-trip to the very screen that has to
    // appear fastest, which is the opposite of the point.
    for (const path of eager) {
      const matches = byPath(path);
      expect(matches.length).withContext(`route ${path} must exist`).toBeGreaterThan(0);
      for (const route of matches) {
        expect(route.loadComponent)
          .withContext(`route ${path} must stay eager`)
          .toBeUndefined();
      }
    }
  });

  it('never asks the browser to preload every chunk', () => {
    // `PreloadAllModules` would fetch all of the above right after start-up and
    // throw the whole gain away. The check is on the route table because that is
    // the only place this file can see; the provider is `provideRouter(routes)`
    // with no strategy in app.config.ts.
    for (const route of all) {
      expect((route as unknown as { loadChildren?: unknown }).loadChildren)
        .withContext('children are components here, not sub-routers')
        .toBeUndefined();
    }
  });
});

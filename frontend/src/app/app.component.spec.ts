import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component } from '@angular/core';
import { App } from './app';
import { ApiService } from './services/api.service';
import { NotificationService } from './services/notification.service';
import { ThemeService } from './services/theme.service';
import { CryptoService } from './services/crypto.service';
import { PwaInstallService } from './services/pwa-install.service';
import { Router } from '@angular/router';
import { SwUpdate, SwPush } from '@angular/service-worker';
import { signal, computed } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';

// Minimal PushSubscriptionJSON-like object for mock
function makeSubJSON(endpoint = 'https://example.push'): PushSubscriptionJSON {
  return { endpoint, keys: { p256dh: 'abc', auth: 'def' } };
}

@Component({ selector: 'app-device-auth', standalone: true, template: '' })
class MockDeviceAuth {
  showIncomingRequest = jasmine.createSpy('showIncomingRequest');
  startNewDeviceFlow = jasmine.createSpy('startNewDeviceFlow');
  loadPendingRequests = jasmine.createSpy('loadPendingRequests');
  handleDeviceApproved = jasmine.createSpy('handleDeviceApproved');
  decryptIdentityKeyFromDevice = jasmine.createSpy('decryptIdentityKeyFromDevice');
}

describe('App', () => {
  let mockApi: jasmine.SpyObj<ApiService>;
  let mockNotif: jasmine.SpyObj<NotificationService>;
  let mockTheme: jasmine.SpyObj<ThemeService>;
  let mockCrypto: jasmine.SpyObj<CryptoService>;
  let mockSwUpdate: jasmine.SpyObj<SwUpdate>;
  let mockSwPush: jasmine.SpyObj<SwPush>;
  let routerEvents: Subject<any>;
  let wsMessages$: Subject<any>;
  let versionUpdates$: Subject<any>;

  beforeEach(async () => {
    routerEvents = new Subject();
    wsMessages$ = new Subject();
    versionUpdates$ = new Subject();

    mockApi = jasmine.createSpyObj('ApiService', [
      'connectWebSocket', 'incrementUnread', 'clearUnread',
      'incrementGroupUnread', 'clearGroupUnread', 'markGroupRead',
      'getUnread', 'hydrateUnread', 'pushUnsubscribe', 'pushLog', 'pushLogBatch',
      'checkHealth', 'getVapidPublicKey', 'pushSubscribe', 'pushWelcome',
      'registerDevice', 'logout', 'checkUpdate', 'retryConnection',
      'getAuthRequests', 'getAuthRequest',
    ], {
      currentUser: signal(null),
      totalUnread: computed(() => 0),
      unreadCounts: signal<Record<number, number>>({}),
      groupUnreadCounts: signal<Record<number, number>>({}),
      wsMessages$: wsMessages$,
      accessToken: signal(''),
      wsConnected: signal(false),
    });

    localStorage.removeItem('pushVapidKey');

    mockNotif = jasmine.createSpyObj('NotificationService', [
      'requestPermission', 'show',
    ]);

    mockTheme = {} as jasmine.SpyObj<ThemeService>;

    (mockApi.checkUpdate as jasmine.Spy).and.returnValue(of({ update_available: false }));
    (mockApi.checkHealth as jasmine.Spy).and.returnValue(of({ status: 'ok' }));
    (mockApi.getUnread as jasmine.Spy).and.returnValue(of({ users: [], groups: [] }));
    (mockApi.getAuthRequests as jasmine.Spy).and.returnValue(of([]));
    (mockApi.getVapidPublicKey as jasmine.Spy).and.returnValue(of({ publicKey: 'test-vapid-key' }));
    (mockApi.pushLog as jasmine.Spy).and.returnValue(of({}));
    // Batching exists so a subscribe run is one request, not five. The mock needs
    // it too, or the batched flush throws inside a timer and the test fails with
    // "pushLogBatch is not a function" instead of what it is about.
    (mockApi.pushLogBatch as jasmine.Spy).and.returnValue(of({}));
    (mockApi.pushUnsubscribe as jasmine.Spy).and.returnValue(of({}));

    mockCrypto = jasmine.createSpyObj('CryptoService', [
      'init', 'syncPublicKey', 'hasIdentityKey',
      'ensureDeviceKeyPair', 'getDevicePublicKeySPKI',
    ]);
    (mockCrypto.init as jasmine.Spy).and.returnValue(Promise.resolve());
    (mockCrypto.hasIdentityKey as jasmine.Spy).and.returnValue(Promise.resolve(true));
    (mockCrypto.syncPublicKey as jasmine.Spy).and.returnValue(Promise.resolve());
    (mockCrypto.ensureDeviceKeyPair as jasmine.Spy).and.returnValue(Promise.resolve());
    (mockCrypto.getDevicePublicKeySPKI as jasmine.Spy).and.returnValue(Promise.resolve('pubkey'));
    (mockCrypto as any).deviceId = 'test-device-id';

    mockSwUpdate = jasmine.createSpyObj('SwUpdate', [
      'checkForUpdate', 'activateUpdate',
    ], {
      isEnabled: false,
      versionUpdates: versionUpdates$,
    });

    mockSwPush = jasmine.createSpyObj('SwPush', ['requestSubscription'], { isEnabled: false });

    await TestBed.configureTestingModule({
      imports: [App, MockDeviceAuth],
      providers: [
        { provide: ApiService, useValue: mockApi },
        { provide: NotificationService, useValue: mockNotif },
        { provide: ThemeService, useValue: mockTheme },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: SwUpdate, useValue: mockSwUpdate },
        { provide: SwPush, useValue: mockSwPush },
        { provide: PwaInstallService },
        { provide: Router, useValue: { events: routerEvents, url: '/feed', navigate: jasmine.createSpy() } },
      ],
    }).compileComponents();
  });

  it('creates the component', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows update banner when version is ready', () => {
    const vu$ = new Subject<any>();
    const swUpdate = jasmine.createSpyObj('SwUpdate', ['checkForUpdate', 'activateUpdate'], {
      isEnabled: true,
      versionUpdates: vu$,
    });
    TestBed.overrideProvider(SwUpdate, { useValue: swUpdate });

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;

    expect(app.updateAvailable()).toBeFalse();
    vu$.next({ type: 'VERSION_READY' });
    expect(app.updateAvailable()).toBeTrue();
  });

  it('shows maintenance overlay when health returns maintenance', fakeAsync(() => {
    mockApi.currentUser.set({ id: 1, username: 'test', email: 't@t.com', avatar_url: '', is_admin: false });
    (mockApi.checkHealth as jasmine.Spy).and.returnValue(of({ status: 'maintenance' }));

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    expect(app.maintenanceMode()).toBeFalse();

    tick(3000);
    expect(app.maintenanceMode()).toBeTrue();
  }));

  it('shows notification on WS message when tab is hidden', () => {
    (mockNotif.show as jasmine.Spy).and.returnValue(null);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    wsMessages$.next({
      type: 'message',
      from: 2,
      from_name: 'Alice',
      content: 'Hello',
      msg_type: 'text',
      created_at: '2024-01-01T00:00:00Z',
    });

    expect(mockNotif.show).toHaveBeenCalled();
    expect(mockApi.incrementUnread).toHaveBeenCalledWith(2, '2024-01-01T00:00:00Z');
  });

  it('shows install banner on beforeinstallprompt event', () => {
    localStorage.removeItem('installDismissed');
    const pwa = TestBed.inject(PwaInstallService);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    expect(pwa.canInstall()).toBeFalse();

    window.dispatchEvent(new Event('beforeinstallprompt'));
    expect(pwa.canInstall()).toBeTrue();
    expect(app.pwa.canInstall()).toBeTrue();
  });

  it('dismissInstall hides banner and sets localStorage flag', () => {
    localStorage.removeItem('installDismissed');
    const pwa = TestBed.inject(PwaInstallService);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;

    window.dispatchEvent(new Event('beforeinstallprompt'));
    expect(pwa.canInstall()).toBeTrue();

    app.dismissInstall();
    expect(pwa.canInstall()).toBeFalse();
    expect(localStorage.getItem('installDismissed')).toBe('true');
  });

  it('handles device_auth_request WS message without crashing', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    wsMessages$.next({ type: 'device_auth_request', from_device_id: 'test' });
    expect().nothing();
  });

  describe('tryReSubscribePush', () => {
    let origSW: any;
    let mockReg: jasmine.SpyObj<ServiceWorkerRegistration>;
    let mockSW: any;

    function makeMockSW(controller: any) {
      return {
        controller,
        ready: Promise.resolve(mockReg),
        addEventListener: jasmine.createSpy('addEventListener'),
        removeEventListener: jasmine.createSpy('removeEventListener'),
        postMessage: jasmine.createSpy('postMessage'),
        getRegistration: () => Promise.resolve(mockReg),
      };
    }

    beforeEach(() => {
      origSW = (navigator as any).serviceWorker;
      mockReg = jasmine.createSpyObj('ServiceWorkerRegistration', [], {
        pushManager: jasmine.createSpyObj('PushManager', ['getSubscription', 'subscribe']),
      });
      (mockReg.pushManager.getSubscription as jasmine.Spy).and.resolveTo(null);
      (mockReg.pushManager.subscribe as jasmine.Spy).and.resolveTo({ toJSON: () => makeSubJSON() });
      (mockApi.getVapidPublicKey as jasmine.Spy).and.returnValue(of({ publicKey: 'test-vapid-key' }));
      (mockApi.pushLog as jasmine.Spy).and.returnValue(of({}));
      (mockApi.pushSubscribe as jasmine.Spy).and.returnValue(of({}));
      (mockApi.pushWelcome as jasmine.Spy).and.returnValue(of({ sent: true }));
      mockSW = makeMockSW(null);
      (mockNotif.requestPermission as jasmine.Spy).and.returnValue(Promise.resolve(true));
    });

    afterEach(() => {
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        writable: true,
        value: origSW,
      });
    });

    it('subscribes when SwPush.isEnabled is false (controller null) — iOS first launch', fakeAsync(async () => {
      mockSW = makeMockSW(null);
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        get: () => mockSW,
      });

      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const app = fixture.componentInstance as any;
      await app.tryReSubscribePush();
      tick();

      expect(mockReg.pushManager.subscribe).toHaveBeenCalledWith({
        userVisibleOnly: true,
        applicationServerKey: jasmine.any(Uint8Array),
      });
      expect(mockApi.pushSubscribe).toHaveBeenCalledWith(makeSubJSON());
    }));

    it('renews existing subscription when already subscribed', fakeAsync(async () => {
      mockSW = makeMockSW({ postMessage: jasmine.createSpy('postMessage') });
      (mockApi.pushSubscribe as jasmine.Spy).and.returnValue(of({}));
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        get: () => mockSW,
      });
      (mockReg.pushManager.getSubscription as jasmine.Spy).and.resolveTo({
        toJSON: () => makeSubJSON('https://existing.push'),
      });
      localStorage.setItem('pushVapidKey', 'v2:test-vapid-key');

      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const app = fixture.componentInstance as any;
      await app.tryReSubscribePush();
      tick();

      expect(mockReg.pushManager.getSubscription).toHaveBeenCalled();
      expect(mockReg.pushManager.subscribe).not.toHaveBeenCalled();
      expect(mockApi.pushSubscribe).toHaveBeenCalledWith(makeSubJSON('https://existing.push'));
    }));

    it('re-subscribes when the VAPID key rotated', fakeAsync(async () => {
      mockSW = makeMockSW({ postMessage: jasmine.createSpy('postMessage') });
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        get: () => mockSW,
      });
      const unsub = jasmine.createSpy('unsubscribe').and.resolveTo(true);
      (mockReg.pushManager.getSubscription as jasmine.Spy).and.resolveTo({
        endpoint: 'https://stale.push',
        toJSON: () => makeSubJSON('https://stale.push'),
        unsubscribe: unsub,
      });
      (mockReg.pushManager.subscribe as jasmine.Spy).and.resolveTo({
        toJSON: () => makeSubJSON('https://fresh.push'),
      });
      (mockApi.pushSubscribe as jasmine.Spy).and.returnValue(of({}));
      (mockApi.pushUnsubscribe as jasmine.Spy).and.returnValue(of({}));
      localStorage.setItem('pushVapidKey', 'old-vapid-key');

      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const app = fixture.componentInstance as any;
      await app.tryReSubscribePush();
      tick();

      expect(unsub).toHaveBeenCalled();
      expect(mockApi.pushUnsubscribe).toHaveBeenCalledWith('https://stale.push');
      expect(mockReg.pushManager.subscribe).toHaveBeenCalled();
      expect(mockApi.pushSubscribe).toHaveBeenCalledWith(makeSubJSON('https://fresh.push'));
    }));

    it('does nothing when navigator has no serviceWorker', fakeAsync(async () => {
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: undefined,
      });

      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const app = fixture.componentInstance as any;
      await app.tryReSubscribePush();

      expect(mockApi.getVapidPublicKey).not.toHaveBeenCalled();
    }));

    it('asks for the welcome push after a fresh subscription', fakeAsync(async () => {
      // A fresh subscription means a fresh install: the user has never seen a
      // notification from this device, so the one nudge must be requested.
      mockSW = makeMockSW({ postMessage: jasmine.createSpy('postMessage') });
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        get: () => mockSW,
      });
      (mockApi.pushSubscribe as jasmine.Spy).and.returnValue(of({}));
      (mockApi.pushWelcome as jasmine.Spy).and.returnValue(of({ sent: true }));
      (mockReg.pushManager.getSubscription as jasmine.Spy).and.resolveTo(null);
      (mockReg.pushManager.subscribe as jasmine.Spy).and.resolveTo({ toJSON: () => makeSubJSON() });

      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const app = fixture.componentInstance as any;
      await app.tryReSubscribePush();
      tick();

      expect(mockApi.pushWelcome).toHaveBeenCalled();
    }));

    it('does not ask for the welcome push when reusing a subscription', fakeAsync(async () => {
      // Reuse means a returning device that already got the nudge on install.
      mockSW = makeMockSW({ postMessage: jasmine.createSpy('postMessage') });
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        get: () => mockSW,
      });
      (mockApi.pushSubscribe as jasmine.Spy).and.returnValue(of({}));
      (mockApi.pushWelcome as jasmine.Spy).and.returnValue(of({ sent: false, reason: 'already_sent' }));
      (mockReg.pushManager.getSubscription as jasmine.Spy).and.resolveTo({
        toJSON: () => makeSubJSON('https://existing.push'),
      });
      localStorage.setItem('pushVapidKey', 'v2:test-vapid-key');

      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const app = fixture.componentInstance as any;
      await app.tryReSubscribePush();
      tick();

      expect(mockApi.pushSubscribe).toHaveBeenCalled();
      expect(mockApi.pushWelcome).not.toHaveBeenCalled();
    }));
  });
  describe('startup request pacing', () => {
    // The HAR from LTE: six requests to /api in one second, each needing its own
    // TLS handshake, which on that link costs 337-409ms. Device registration is
    // needed for *sending*, not for showing a feed, so it waits for the first
    // paint instead of competing with it.
    beforeEach(() => {
      (mockCrypto.init as jasmine.Spy).and.returnValue(Promise.resolve());
      (mockCrypto.ensureDeviceKeyPair as jasmine.Spy).and.returnValue(Promise.resolve());
      (mockCrypto.getDevicePublicKeySPKI as jasmine.Spy).and.returnValue(Promise.resolve('spki'));
      (mockApi.registerDevice as jasmine.Spy).and.returnValue(of({}));
      (mockApi.getAuthRequests as jasmine.Spy).and.returnValue(of([]));
      mockApi.currentUser.set({ id: 1, username: 'me', avatar_url: '' } as any);
    });

    it('holds device registration back until after the first paint', fakeAsync(() => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const app = fixture.componentInstance as any;
      // crypto.init() is a resolved promise, so its .then() body runs on the next
      // microtask - long before any macrotask timer. tick(0) drains microtasks
      // only, which is exactly the window the deferral exists to protect.
      tick(0);

      expect((mockApi.registerDevice as jasmine.Spy)).not.toHaveBeenCalled();

      tick(3000);
      expect((mockApi.registerDevice as jasmine.Spy)).toHaveBeenCalled();

      app.flushPushLog();
      tick(6000);
    }));

    it('does not let the deferred work stack up on repeated init', fakeAsync(() => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      tick(0);
      const app = fixture.componentInstance as any;

      tick(3000);
      app.flushPushLog();
      tick(6000);

      // One registration per load, not one per pending timer.
      expect((mockApi.registerDevice as jasmine.Spy).calls.count()).toBe(1);
    }));
  });

  describe('push log batching', () => {
    // A subscribe run fires several log entries in a row, and one request each
    // meant one connection and one TLS handshake each - at the moment the app was
    // trying to appear. Measured over LTE: 337-409ms per handshake.
    function makeApp() {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const app = fixture.componentInstance as any;
      // ngOnInit asks for notification permission, and the mocked service logs
      // 'permission_denied' when it is refused. Drain whatever that produced
      // before the test starts recording, so the counts are about the entries the
      // test itself adds.
      app.flushPushLog();
      tick(6000);
      (mockApi.pushLog as jasmine.Spy).calls.reset();
      (mockApi.pushLogBatch as jasmine.Spy).calls.reset();
      return app;
    }

    it('sends several entries in one request instead of one each', fakeAsync(() => {
      const app = makeApp();

      app.logPush('permission_denied');
      app.logPush('rotate', 'https://old.push');
      app.logPush('subscribe', 'https://new.push');
      tick(6000);

      expect((mockApi.pushLog as jasmine.Spy)).not.toHaveBeenCalled();
      expect((mockApi.pushLogBatch as jasmine.Spy).calls.count()).toBe(1);
      const entries = (mockApi.pushLogBatch as jasmine.Spy).calls.mostRecent().args[0];
      expect(entries.length).toBe(3);
      expect(entries.map((e: any) => e.kind)).toEqual([
        'permission_denied', 'rotate', 'subscribe',
      ]);
    }));

    it('does not send anything before the flush window closes', fakeAsync(() => {
      const app = makeApp();

      app.logPush('subscribe', 'https://new.push');
      tick(1000);

      expect((mockApi.pushLogBatch as jasmine.Spy)).not.toHaveBeenCalled();
      tick(5000);
      expect((mockApi.pushLogBatch as jasmine.Spy).calls.count()).toBe(1);
    }));

    it('falls back to individual requests when the batch endpoint is missing', fakeAsync(() => {
      // An older backend has no /push/log/batch. Diagnostics must survive that
      // rather than vanish - they are what a push failure gets diagnosed from.
      const app = makeApp();
      (mockApi.pushLogBatch as jasmine.Spy).and.returnValue(throwError(() => new Error('404')));

      app.logPush('subscribe_error', '', 'boom');
      tick(6000);

      expect((mockApi.pushLog as jasmine.Spy).calls.count()).toBe(1);
    }));
  });
});

import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component } from '@angular/core';
import { App } from './app';
import { ApiService } from './services/api.service';
import { NotificationService } from './services/notification.service';
import { ThemeService } from './services/theme.service';
import { CryptoService } from './services/crypto.service';
import { Router } from '@angular/router';
import { SwUpdate, SwPush } from '@angular/service-worker';
import { signal, computed } from '@angular/core';
import { Subject, of } from 'rxjs';

@Component({ selector: 'app-device-auth', standalone: true, template: '' })
class MockDeviceAuth {
  showIncomingRequest = jasmine.createSpy('showIncomingRequest');
  startNewDeviceFlow = jasmine.createSpy('startNewDeviceFlow');
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
      'checkHealth', 'getVapidPublicKey', 'pushSubscribe',
      'registerDevice', 'logout', 'checkUpdate', 'retryConnection',
    ], {
      currentUser: signal(null),
      totalUnread: computed(() => 0),
      wsMessages$: wsMessages$,
      accessToken: signal(''),
      wsConnected: signal(false),
    });

    mockNotif = jasmine.createSpyObj('NotificationService', [
      'requestPermission', 'show',
    ]);

    mockTheme = {} as jasmine.SpyObj<ThemeService>;

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
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    expect(app.canInstall()).toBeFalse();

    window.dispatchEvent(new Event('beforeinstallprompt'));
    expect(app.canInstall()).toBeTrue();
  });

  it('dismissInstall hides banner and sets localStorage flag', () => {
    localStorage.removeItem('installDismissed');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;

    window.dispatchEvent(new Event('beforeinstallprompt'));
    expect(app.canInstall()).toBeTrue();

    app.dismissInstall();
    expect(app.canInstall()).toBeFalse();
    expect(localStorage.getItem('installDismissed')).toBe('true');
  });

  it('handles device_auth_request WS message without crashing', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    wsMessages$.next({ type: 'device_auth_request', from_device_id: 'test' });
    expect().nothing();
  });
});

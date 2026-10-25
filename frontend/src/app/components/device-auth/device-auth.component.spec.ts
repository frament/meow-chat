import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DeviceAuthComponent, recoveryLandingUrl } from './device-auth';
import { ApiService } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';
import { AppReloadService } from '../../services/app-reload.service';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';

describe('DeviceAuthComponent', () => {
  let component: DeviceAuthComponent;
  let fixture: ComponentFixture<DeviceAuthComponent>;

  const mockApi = {
    createAuthRequest: jasmine.createSpy().and.returnValue(of({ id: 1 })),
    getAuthRequest: jasmine.createSpy().and.returnValue(of({ status: 'pending' })),
    getAuthRequests: jasmine.createSpy().and.returnValue(of([])),
    approveAuthRequest: jasmine.createSpy().and.returnValue(of({})),
    denyAuthRequest: jasmine.createSpy().and.returnValue(of({})),
    recoverKeys: jasmine.createSpy().and.returnValue(of({ identity_key_jwk: '{}' })),
  };

  // Without this the component's real reload() runs and takes the Karma page
  // down with it, which is what made the whole suite fail intermittently.
  const mockReload = { reload: jasmine.createSpy('reload') };

  const mockCrypto = {
    init: jasmine.createSpy('init').and.returnValue(Promise.resolve()),
    needsRecovery: signal(false),
    ensureDeviceKeyPair: jasmine.createSpy().and.returnValue(Promise.resolve()),
    getDevicePublicKeySPKI: jasmine.createSpy().and.returnValue(Promise.resolve('spki')),
    deviceId: 'dev-1',
    hasIdentityKey: jasmine.createSpy().and.returnValue(Promise.resolve(true)),
    encryptIdentityKeyForDevice: jasmine.createSpy().and.returnValue(Promise.resolve({ encrypted: 'enc', iv: 'iv' })),
    decryptIdentityKeyFromDevice: jasmine.createSpy().and.returnValue(Promise.resolve('{}')),
    importIdentityKey: jasmine.createSpy().and.returnValue(Promise.resolve()),
    syncPublicKey: jasmine.createSpy().and.returnValue(Promise.resolve()),
  };

  beforeEach(async () => {
    mockApi.createAuthRequest.calls.reset();
    mockApi.approveAuthRequest.calls.reset();
    mockApi.denyAuthRequest.calls.reset();
    mockApi.recoverKeys.calls.reset();

    await TestBed.configureTestingModule({
      imports: [DeviceAuthComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: AppReloadService, useValue: mockReload },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DeviceAuthComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('keeps the recovery form closed by default', () => {
    // It used to be open by default, and because a successful recovery ends with
    // reload() the panel returned after every attempt - hiding whether the key
    // had been applied at all. That is the bug this asserts against.
    expect(component.showRecovery).toBeFalse();
  });

  it('renders approval dialog when incomingRequest is set', () => {
    component.showIncomingRequest({ id: 1, device_name: 'My Phone', device_public_key: 'key' });
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('My Phone');
    expect(compiled.textContent).toContain('Подтвердить');
    expect(compiled.textContent).toContain('Отклонить');
  });

  it('renders recovery dialog when showRecovery is toggled', () => {
    component.showRecovery = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Восстановление ключей');
    expect(compiled.querySelector('select')).toBeTruthy();
    expect(compiled.querySelector('input[placeholder*="пароль"]')).toBeTruthy();
  });

  it('calls approveAuthRequest on approve', fakeAsync(() => {
    component.showIncomingRequest({ id: 2, device_name: 'Laptop', device_public_key: 'pk' });
    fixture.detectChanges();

    component.approveRequest();
    tick();

    expect(mockCrypto.encryptIdentityKeyForDevice).toHaveBeenCalledWith('pk');
    expect(mockApi.approveAuthRequest).toHaveBeenCalledWith(2, 'enc', 'iv', 'spki');
  }));

  it('shows a pending request from another device via polling', fakeAsync(() => {
    mockApi.getAuthRequests.and.returnValue(of([
      { id: 9, device_name: 'Laptop', device_public_key: 'pk9', device_id: 'other-dev' },
    ]));
    component.loadPendingRequests();
    tick();
    expect(component.incomingRequest()?.id).toBe(9);
  }));

  it('ignores its own pending request', fakeAsync(() => {
    mockApi.getAuthRequests.and.returnValue(of([
      { id: 9, device_name: 'Me', device_public_key: 'pk9', device_id: 'dev-1' },
    ]));
    component.loadPendingRequests();
    tick();
    expect(component.incomingRequest()).toBeNull();
  }));

  it('calls denyAuthRequest on deny', fakeAsync(() => {
    component.showIncomingRequest({ id: 3, device_name: 'Tablet', device_public_key: 'pk2' });
    fixture.detectChanges();

    component.denyRequest();
    tick();

    expect(mockApi.denyAuthRequest).toHaveBeenCalledWith(3);
  }));

  it('clears incomingRequest after approve', fakeAsync(() => {
    component.showIncomingRequest({ id: 2, device_name: 'Laptop', device_public_key: 'pk' });
    component.approveRequest();
    tick();
    expect(component.incomingRequest()).toBeNull();
  }));

  it('clears incomingRequest after deny', fakeAsync(() => {
    component.showIncomingRequest({ id: 3, device_name: 'Tablet', device_public_key: 'pk2' });
    component.denyRequest();
    tick();
    expect(component.incomingRequest()).toBeNull();
  }));

  it('calls recoverKeys on doRecover', fakeAsync(() => {
    component.recoveryInput = 'mypassword';
    component.doRecover();
    tick();
    expect(mockApi.recoverKeys).toHaveBeenCalledWith('password', 'mypassword');
  }));

  it('shows recovery error on failed recover', fakeAsync(() => {
    // This used to throw a bare `{}` and expect the password message for it.
    // Now a status-less failure says the server did not answer, which is what
    // an empty error actually means; a rejected password comes with 401.
    mockApi.recoverKeys.and.returnValue(throwError(() => ({ status: 401 })));
    component.recoveryInput = 'wrong';
    component.doRecover();
    tick();
    expect(component.recoveryError).toBe('Неверный пароль или фраза восстановления');
  }));

  it('says there is no backup instead of blaming the password', fakeAsync(() => {
    // With needsRecovery the form opens by itself, so this message is the first
    // thing a device without a key sees. Telling those people their password is
    // wrong sends them to retype a correct one forever.
    mockApi.recoverKeys.and.returnValue(throwError(() => ({
      status: 404,
      error: { error: 'No password backup found' },
    })));
    component.recoveryInput = 'правильный пароль';
    component.doRecover();
    tick();

    expect(component.recoveryError).toContain('Резервной копии ключа нет');
    expect(component.recoveryError).not.toContain('Неверный пароль');
  }));

  it('still blames the password when the server rejects it', fakeAsync(() => {
    mockApi.recoverKeys.and.returnValue(throwError(() => ({
      status: 401,
      error: { error: 'Invalid password or phrase' },
    })));
    component.recoveryInput = 'неверный';
    component.doRecover();
    tick();

    expect(component.recoveryError).toBe('Неверный пароль или фраза восстановления');
  }));

  it('asks the injected reload service to restart the app after a successful recover', fakeAsync(() => {
    // The app has to come back up for the new identity key to be used
    // everywhere, and this assertion is only possible because the reload goes
    // through an injectable service rather than the global location object.
    mockApi.recoverKeys.and.returnValue(of({ identity_key_jwk: '{}' }));
    component.recoveryInput = 'mypassword';
    component.doRecover();
    tick();

    expect(mockCrypto.importIdentityKey).toHaveBeenCalled();
    expect(mockReload.reload).toHaveBeenCalled();
  }));
});

describe('DeviceAuthComponent recovery entry point', () => {
  const mockApi = {
    recoverKeys: jasmine.createSpy().and.returnValue(of({ identity_key_jwk: '{}' })),
    getAuthRequests: jasmine.createSpy().and.returnValue(of([])),
  };
  const mockCrypto = {
    init: jasmine.createSpy('init').and.returnValue(Promise.resolve()),
    needsRecovery: signal(false),
    deviceId: 'dev-1',
    hasIdentityKey: jasmine.createSpy().and.returnValue(Promise.resolve(true)),
    importIdentityKey: jasmine.createSpy().and.returnValue(Promise.resolve()),
    syncPublicKey: jasmine.createSpy().and.returnValue(Promise.resolve()),
  };

  it('opens the form when the profile link asks for it with ?recover=1', async () => {
    await TestBed.configureTestingModule({
      imports: [DeviceAuthComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: AppReloadService, useValue: { reload: jasmine.createSpy('reload') } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ recover: '1' }) } } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeviceAuthComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.showRecovery).toBeTrue();
  });
});

describe('recoveryLandingUrl', () => {
  // The reload after a successful recovery re-opens the current address, so a
  // surviving ?recover=1 brings the form back over the decrypted thread - the
  // original complaint, one level down.
  it('drops the param and leaves the chat where it is', () => {
    expect(recoveryLandingUrl('https://chat.example/chat/2?recover=1')).toBe('/chat/2');
  });

  it('moves the bare recovery route to the chat', () => {
    // /device-auth on its own is an empty route: a form with no page behind it.
    expect(recoveryLandingUrl('https://chat.example/device-auth?recover=1')).toBe('/chat');
  });

  it('keeps the other query parameters', () => {
    expect(recoveryLandingUrl('https://chat.example/chat/2?recover=1&tab=1')).toBe('/chat/2?tab=1');
  });

  it('does nothing without the param', () => {
    expect(recoveryLandingUrl('https://chat.example/chat/2')).toBeNull();
    expect(recoveryLandingUrl('https://chat.example/chat/2?recover=0')).toBeNull();
  });
});

describe('DeviceAuthComponent opening on need', () => {
  function configure(needsRecovery: boolean) {
    const mockCrypto = {
      init: jasmine.createSpy('init').and.returnValue(Promise.resolve()),
      needsRecovery: signal(needsRecovery),
      deviceId: 'dev-1',
      hasIdentityKey: jasmine.createSpy().and.returnValue(Promise.resolve(true)),
    };
    TestBed.configureTestingModule({
      imports: [DeviceAuthComponent],
      providers: [
        { provide: ApiService, useValue: { getAuthRequests: () => of([]), recoverKeys: () => of({}) } },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: AppReloadService, useValue: { reload: jasmine.createSpy('reload') } },
      ],
    });
    return TestBed.createComponent(DeviceAuthComponent);
  }

  it('opens the form when the account key lives on another device', fakeAsync(() => {
    // No key here, key present on the server: the form is the only fix, so it
    // must appear without anyone knowing the ?recover=1 URL.
    const fixture = configure(true);
    fixture.detectChanges();
    flushMicrotasks();

    expect(fixture.componentInstance.showRecovery).toBeTrue();
  }));

  it('stays closed when there is nothing to recover', fakeAsync(() => {
    const fixture = configure(false);
    fixture.detectChanges();
    flushMicrotasks();

    expect(fixture.componentInstance.showRecovery).withContext('a healthy device sees no form').toBeFalse();
  }));
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DeviceAuthComponent } from './device-auth';
import { ApiService } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';
import { of } from 'rxjs';

describe('DeviceAuthComponent', () => {
  let component: DeviceAuthComponent;
  let fixture: ComponentFixture<DeviceAuthComponent>;

  const mockApi = {
    createAuthRequest: jasmine.createSpy().and.returnValue(of({ id: 1 })),
    getAuthRequest: jasmine.createSpy().and.returnValue(of({ status: 'pending' })),
    approveAuthRequest: jasmine.createSpy().and.returnValue(of({})),
    denyAuthRequest: jasmine.createSpy().and.returnValue(of({})),
    recoverKeys: jasmine.createSpy().and.returnValue(of({ identity_key_jwk: '{}' })),
  };

  const mockCrypto = {
    ensureDeviceKeyPair: jasmine.createSpy().and.returnValue(Promise.resolve()),
    getDevicePublicKeySPKI: jasmine.createSpy().and.returnValue(Promise.resolve('spki')),
    deviceId: 'dev-1',
    encryptIdentityKeyForDevice: jasmine.createSpy().and.returnValue(Promise.resolve({ encrypted: 'enc', iv: 'iv' })),
    decryptIdentityKeyFromDevice: jasmine.createSpy().and.returnValue(Promise.resolve('{}')),
    importIdentityKey: jasmine.createSpy().and.returnValue(Promise.resolve()),
    syncPublicKey: jasmine.createSpy().and.returnValue(Promise.resolve()),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeviceAuthComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
        { provide: CryptoService, useValue: mockCrypto },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DeviceAuthComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
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
});

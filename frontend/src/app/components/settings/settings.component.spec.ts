import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SettingsComponent } from './settings';
import { ApiService } from '../../services/api.service';
import { ThemeService } from '../../services/theme.service';
import { CryptoService } from '../../services/crypto.service';
import { ActivatedRoute, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { signal, computed } from '@angular/core';
import { of } from 'rxjs';
import { HttpEventType } from '@angular/common/http';

describe('SettingsComponent', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;

  const mockApi = {
    currentUser: signal({ id: 1, username: 'test', email: 'test@t.com', avatar_url: '' }),
    totalUnread: computed(() => 0),
    updateProfile: jasmine.createSpy().and.returnValue(of({ id: 1, username: 'test', email: 'test@t.com', avatar_url: '' })),
    uploadAvatar: jasmine.createSpy().and.returnValue(of({ type: HttpEventType.Response, body: { avatar_url: 'a.jpg' } })),
    getMyInvites: jasmine.createSpy().and.returnValue(of([])),
    createInvite: jasmine.createSpy().and.returnValue(of({ token: 'abc', max_uses: 1, use_count: 0, created_at: '' })),
    deleteInvite: jasmine.createSpy().and.returnValue(of({})),
    getFriends: jasmine.createSpy().and.returnValue(of([])),
    createFriendInvite: jasmine.createSpy().and.returnValue(of({ token: 'xyz' })),
    removeFriend: jasmine.createSpy().and.returnValue(of({})),
    webauthnListCredentials: jasmine.createSpy().and.returnValue(of([])),
    webauthnRemoveCredential: jasmine.createSpy().and.returnValue(of({})),
    webauthnBeginRegistration: jasmine.createSpy().and.returnValue(of({ session_id: 's1', options: {} })),
    logout: jasmine.createSpy(),
    getVersion: jasmine.createSpy().and.returnValue(of({ version: '0.1.0-dev' })),
    checkUpdate: jasmine.createSpy().and.returnValue(of({ update_available: false, current_version: '0.1.0-dev', latest_version: '', download_url: '', release_notes_url: '' })),
  };

  const mockTheme = {
    currentMode: 'light',
    setTheme: jasmine.createSpy(),
  };

  const mockCrypto = {
    init: jasmine.createSpy().and.returnValue(Promise.resolve()),
    getPublicKey: jasmine.createSpy().and.returnValue(Promise.resolve('pubkey')),
  };

  const mockSwUpdate = {
    isEnabled: false,
    checkForUpdate: jasmine.createSpy().and.returnValue(Promise.resolve(false)),
    versionUpdates: of(null),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
        { provide: ThemeService, useValue: mockTheme },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: SwUpdate, useValue: mockSwUpdate },
        { provide: Router, useValue: { navigate: jasmine.createSpy() } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('renders profile edit form with username and email inputs', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(component.username).toBe('test');
    expect(component.email).toBe('test@t.com');
    expect(compiled.querySelector('input[name="username"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="email"]')).toBeTruthy();
    expect(compiled.querySelector('button[type="submit"]')?.textContent?.trim()).toContain('Сохранить');
  });
});

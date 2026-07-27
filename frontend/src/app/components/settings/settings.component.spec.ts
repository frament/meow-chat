import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { SettingsComponent } from './settings';
import { ApiService } from '../../services/api.service';
import { ThemeService } from '../../services/theme.service';
import { CryptoService } from '../../services/crypto.service';
import { ActivatedRoute, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { signal, computed } from '@angular/core';
import { of, throwError } from 'rxjs';
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
    createInvite: jasmine.createSpy().and.returnValue(of({ id: 1, created_by: 1, token: 'abc', max_uses: 1, use_count: 0, expires_at: null, created_at: '2024-01-01' })),
    deleteInvite: jasmine.createSpy().and.returnValue(of({})),
    getFriends: jasmine.createSpy().and.returnValue(of([])),
    createFriendInvite: jasmine.createSpy().and.returnValue(of({ token: 'xyz', created_at: '2024-01-01' })),
    removeFriend: jasmine.createSpy().and.returnValue(of({})),
    webauthnListCredentials: jasmine.createSpy().and.returnValue(of([])),
    webauthnRemoveCredential: jasmine.createSpy().and.returnValue(of({})),
    webauthnBeginRegistration: jasmine.createSpy().and.returnValue(of({ session_id: 's1', options: {} })),
    logout: jasmine.createSpy(),
    getVersion: jasmine.createSpy().and.returnValue(of({ version: '1.1.0' })),
    checkUpdate: jasmine.createSpy().and.returnValue(of({ update_available: false, current_version: '1.1.0', latest_version: '', download_url: '', release_notes_url: '' })),
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

  const mockRouter = { navigate: jasmine.createSpy() };

  beforeEach(async () => {
    mockRouter.navigate.calls.reset();
    mockApi.logout.calls.reset();
    mockTheme.setTheme.calls.reset();
    mockApi.updateProfile.calls.reset();
    mockApi.createInvite.calls.reset();
    mockApi.deleteInvite.calls.reset();
    mockApi.createFriendInvite.calls.reset();
    mockApi.removeFriend.calls.reset();
    mockApi.webauthnRemoveCredential.calls.reset();

    mockApi.updateProfile.and.returnValue(of({ id: 1, username: 'test', email: 'test@t.com', avatar_url: '' }));
    mockApi.getMyInvites.and.returnValue(of([]));
    mockApi.getFriends.and.returnValue(of([]));
    mockApi.webauthnListCredentials.and.returnValue(of([]));
    mockApi.createInvite.and.returnValue(of({ id: 1, created_by: 1, token: 'abc', max_uses: 1, use_count: 0, expires_at: null, created_at: '2024-01-01' }));
    mockApi.createFriendInvite.and.returnValue(of({ token: 'xyz', created_at: '2024-01-01' }));
    mockApi.removeFriend.and.returnValue(of({}));
    mockApi.webauthnRemoveCredential.and.returnValue(of({}));

    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
        { provide: ThemeService, useValue: mockTheme },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: SwUpdate, useValue: mockSwUpdate },
        { provide: Router, useValue: mockRouter },
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
    expect(compiled.querySelector('input[name="username"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="email"]')).toBeTruthy();
    expect(compiled.querySelector('button[type="submit"]')?.textContent?.trim()).toContain('Сохранить');
  });

  it('calls updateProfile and shows success on form submit', fakeAsync(() => {
    mockApi.updateProfile.and.returnValue(of({ id: 1, username: 'newuser', email: 'new@t.com', avatar_url: '' }));
    component.username = 'newuser';
    component.email = 'new@t.com';

    component.onSubmit();
    tick();

    expect(mockApi.updateProfile).toHaveBeenCalledWith('newuser', 'new@t.com');
  }));

  it('shows error when updateProfile fails', fakeAsync(() => {
    mockApi.updateProfile.and.returnValue(throwError(() => ({ error: 'err' })));
    component.onSubmit();
    tick();

    expect(component.error).toBe('Ошибка сохранения. Возможно, имя или email уже заняты.');
  }));

  it('calls setTheme when theme option clicked', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const themeOptions = compiled.querySelectorAll('.theme-option');
    expect(themeOptions.length).toBe(3);

    (themeOptions[0] as HTMLElement).click();
    expect(mockTheme.setTheme).toHaveBeenCalledWith('light');

    (themeOptions[1] as HTMLElement).click();
    expect(mockTheme.setTheme).toHaveBeenCalledWith('dark');

    (themeOptions[2] as HTMLElement).click();
    expect(mockTheme.setTheme).toHaveBeenCalledWith('system');
  });

  it('calls logout and navigates to /login', () => {
    component.logout();
    expect(mockApi.logout).toHaveBeenCalled();
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('calls createInvite', fakeAsync(() => {
    component.createInvite();
    tick();

    expect(mockApi.createInvite).toHaveBeenCalledWith(1);
  }));

  it('calls deleteInvite', fakeAsync(() => {
    component.invites = [{ id: 1, created_by: 1, token: 'tok1', max_uses: 1, use_count: 0, expires_at: null, created_at: '2024-01-01' }];
    fixture.detectChanges();

    component.revokeInvite(1);
    tick();

    expect(mockApi.deleteInvite).toHaveBeenCalledWith(1);
  }));

  it('calls createFriendInvite', fakeAsync(() => {
    component.createFriendInvite();
    tick();

    expect(mockApi.createFriendInvite).toHaveBeenCalled();
    expect(component.friendInviteToken).toBe('xyz');
  }));

  it('calls removeFriend', fakeAsync(() => {
    mockApi.getFriends.and.returnValue(of([{ id: 10, username: 'bob', avatar_url: '', is_online: false }]));
    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component.removeFriend(10);
    tick();

    expect(mockApi.removeFriend).toHaveBeenCalledWith(10);
  }));

  it('displays E2EE status when keys are ready', fakeAsync(() => {
    mockCrypto.getPublicKey.and.returnValue(Promise.resolve('some-key'));
    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    tick();

    expect(component.e2eeStatus).toBe('Активно');
  }));

  it('shows webauthn register button when supported', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Face ID');
  });

  it('renders version info', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('1.1.0');
  });
});

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { LoginComponent } from './login';
import { ApiService } from '../../services/api.service';
import { NotificationService } from '../../services/notification.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError, Subject } from 'rxjs';
import { ServerCryptoService } from '../../services/server-crypto.service';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  const mockRouter = { navigate: jasmine.createSpy(), navigateByUrl: jasmine.createSpy(), createUrlTree: jasmine.createSpy(), serializeUrl: jasmine.createSpy(), events: of(null) };

  const ensureAccountKey = jasmine.createSpy('ensureAccountKey').and.resolveTo();

  const mockApi = {
    login: jasmine.createSpy().and.returnValue(of({ access_token: 'at', refresh_token: 'rt' })),
    webauthnHasCredentials: jasmine.createSpy().and.returnValue(of({ has_credentials: false })),
    storeAuth: jasmine.createSpy(),
  };

  function init(routeParams: Record<string, string> = {}) {
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: ServerCryptoService, useValue: { ensureAccountKey } },
        { provide: ApiService, useValue: mockApi },
        { provide: NotificationService, useValue: { requestPermission: jasmine.createSpy() } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: routeParams }, paramMap: of(convertToParamMap({})), url: of([]) } },
        { provide: Router, useValue: mockRouter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    mockRouter.navigate.calls.reset();
    mockRouter.navigateByUrl.calls.reset();
    mockApi.login.calls.reset();
    mockApi.storeAuth.calls.reset();
    mockApi.login.and.returnValue(of({ access_token: 'at', refresh_token: 'rt' }));
    mockApi.webauthnHasCredentials.and.returnValue(of({ has_credentials: false }));
  });

  it('creates the component', () => {
    init();
    expect(component).toBeTruthy();
  });

  it('renders username and password input fields', () => {
    init();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('input[name="username"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="password"]')).toBeTruthy();
  });

  it('renders submit button with login text', () => {
    init();
    const compiled = fixture.nativeElement as HTMLElement;
    const submitBtn = compiled.querySelector('button[type="submit"]');
    expect(submitBtn).toBeTruthy();
    expect(submitBtn?.textContent?.trim()).toBe('Войти');
  });

  it('calls login and navigates on successful submit', fakeAsync(() => {
    init();
    component.username = 'alice';
    component.password = 'secret';

    component.onSubmit();
    tick();

    expect(mockApi.login).toHaveBeenCalledWith('alice', 'secret');
    expect(mockApi.storeAuth).toHaveBeenCalled();
    // The key is wrapped with this same password, and this is the only moment it
    // is in hand. Without this call the account has no key and every message of
    // the new scheme reads as "no key on this device".
    expect(ensureAccountKey).withContext('sign-in must set up the account key').toHaveBeenCalledWith('secret');
    expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/feed');
  }));

  it('shows error on failed login', fakeAsync(() => {
    mockApi.login.and.returnValue(throwError(() => ({})));
    init();
    component.onSubmit();
    tick();

    expect(component.error).toBe('Неверное имя пользователя или пароль');
  }));

  it('navigates to redirect URL on login', fakeAsync(() => {
    init({ redirect: '/chat/5' });

    component.username = 'bob';
    component.password = 'pass';
    component.onSubmit();
    tick();

    expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/chat/5');
  }));

  it('checks biometric on username input', fakeAsync(() => {
    mockApi.webauthnHasCredentials.and.returnValue(of({ has_credentials: true }));
    init();
    component.username = 'alice';
    component.checkBiometric();
    tick(500);

    expect(mockApi.webauthnHasCredentials).toHaveBeenCalledWith('alice');
  }));
  it('does not send a second login while the first is still in flight', fakeAsync(() => {
    // Two taps on a slow link used to produce two POSTs. The first came back in
    // 444ms; the duplicate then sat in Safari's dispatch queue and timed out 30
    // seconds later, which read as a broken app rather than as a double tap.
    const pending = new Subject<{ access_token: string; refresh_token: string }>();
    mockApi.login.and.returnValue(pending);
    init();

    component.onSubmit();
    component.onSubmit();

    expect(mockApi.login).toHaveBeenCalledTimes(1);

    pending.next({ access_token: 'at', refresh_token: 'rt' });
    pending.complete();
    tick();
  }));

  it('lets the next attempt through once a failed one has settled', fakeAsync(() => {
    // The guard has to be released on failure, or one bad link would lock the
    // user out of the form until they reloaded the page.
    mockApi.login.and.returnValue(throwError(() => ({ status: 0 })));
    init();

    component.onSubmit();
    tick();
    expect(component.submitting).toBeFalse();

    mockApi.login.and.returnValue(of({ access_token: 'at', refresh_token: 'rt' }));
    component.onSubmit();
    tick();
    expect(mockApi.login).toHaveBeenCalledTimes(2);
  }));

  it('does not blame the password when the link dropped the request', fakeAsync(() => {
    // "Wrong password" is the one reply that is certainly wrong here: the user
    // goes off to reset a password that was fine.
    mockApi.login.and.returnValue(throwError(() => ({ status: 0 })));
    init();

    component.onSubmit();
    tick();

    expect(component.error).toContain('не ответил');
    expect(component.error).not.toContain('пароль');
  }));

  it('still says the password is wrong when the server says so', fakeAsync(() => {
    mockApi.login.and.returnValue(throwError(() => ({ status: 401 })));
    init();

    component.onSubmit();
    tick();

    expect(component.error).toContain('пароль');
  }));

  describe('политика запросов', () => {
    it('на чистом браузере не делает ни одного запроса', fakeAsync(() => {
      // Ничего не запомнено - спрашивать не о чем. Ноль запросов важнее одного:
      // это состояние, с которого начинается первый вход в жизни.
      mockApi.webauthnHasCredentials.calls.reset();
      localStorage.removeItem('lastUsername');
      init();
      tick();

      expect(mockApi.webauthnHasCredentials).not.toHaveBeenCalled();
    }));

    it('при сохранённом имени спрашивает ровно один раз', fakeAsync(() => {
      // Проверка биометрии - единственное, что можно узнать о человеке без его
      // участия. Один раз, а не на каждое нажатие и не по три подряд: на сети,
      // где соединений мало, каждый лишний отнимает слот у авторизации.
      mockApi.webauthnHasCredentials.calls.reset();
      localStorage.setItem('lastUsername', 'frament');
      try {
        init();
        // 400 мс - это debounce у checkBiometric.
        tick(400);
        expect(mockApi.webauthnHasCredentials).toHaveBeenCalledTimes(1);
        expect(mockApi.login).not.toHaveBeenCalled();
      } finally {
        localStorage.removeItem('lastUsername');
      }
    }));

    it('при отправке формы делает только запрос авторизации', fakeAsync(() => {
      init();
      tick();
      mockApi.login.calls.reset();

      component.onSubmit();
      tick();

      // Ровно один запрос на отправку формы. Проверка биометрии при этом уже была
      // при открытии страницы - повторять её незачем.
      expect(mockApi.login).toHaveBeenCalledTimes(1);
    }));
  });

  describe('key setup after Face ID', () => {
    // Face ID hands over no password, and the account key is wrapped with it.
    // Without this form a biometric user gets a session that cannot read anything
    // new, and nothing on screen says why.

    function makeKeyMock(validPassword: string | null) {
      const state = { hasKey: false };
      return {
        state,
        ensureAccountKey: jasmine.createSpy('ensureAccountKey').and.callFake(async (pw?: string) => {
          if (pw && pw === validPassword) state.hasKey = true;
        }),
        hasAccountKey: () => state.hasKey,
        getAccountPublicKey: () => null,
        // These specs exist because the layer is ON: that is the only case where
        // the password form has a purpose.
        isEnabled: () => true,
      };
    }

    function initWithKeyMock(keyMock: any) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [LoginComponent],
        providers: [
          { provide: ServerCryptoService, useValue: keyMock },
          { provide: ApiService, useValue: mockApi },
          { provide: NotificationService, useValue: { requestPermission: jasmine.createSpy() } },
          { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} }, paramMap: of(convertToParamMap({})), url: of([]) } },
          { provide: Router, useValue: mockRouter },
        ],
      });
      const f = TestBed.createComponent(LoginComponent);
      return f.componentInstance;
    }

    it('does not ask for a password when the layer is switched off', async () => {
      // Prod state on 2026-10-25: no pinned server key, so nothing needs an
      // account key. Face ID has to go straight in.
      const keyMock = { ...makeKeyMock('secret'), isEnabled: () => false };
      const component = initWithKeyMock(keyMock);

      const ok = await (component as any).ensureKey('');

      expect(ok).toBeTrue();
      expect(keyMock.ensureAccountKey).withContext('nothing to set up').not.toHaveBeenCalled();
    });

    it('opens the password form instead of navigating when the device has no key', async () => {
      const keyMock = makeKeyMock('secret');
      const component = initWithKeyMock(keyMock);

      // No password was supplied, so nothing can be created - the form must open.
      const ok = await (component as any).ensureKey('');

      expect(ok).toBeFalse();
      expect(keyMock.ensureAccountKey).toHaveBeenCalledWith('');
    });

    it('opens the password form when Face ID signs in a device with no key', async () => {
      // The only path that matters: biometry hands over no password, so the key
      // has to be asked for. Everything below the form is useless if this does
      // not trigger.
      const keyMock = makeKeyMock('secret');
      const component = initWithKeyMock(keyMock);

      (mockApi as any).webauthnBeginLogin = jasmine
        .createSpy('webauthnBeginLogin')
        .and.returnValue(of({ session_id: 's1', options: { publicKey: { challenge: 'AAAA' } } }));
      (mockApi as any).webauthnFinishLogin = jasmine
        .createSpy('webauthnFinishLogin')
        .and.returnValue(of({ access_token: 'at', refresh_token: 'rt' }));

      (globalThis as any).PublicKeyCredential = class {};
      const credential = { toJSON: () => ({ id: 'cred' }) };
      spyOn(navigator.credentials, 'get').and.resolveTo(credential as any);
      mockRouter.navigateByUrl.calls.reset();

      await component.biometricLogin();
      // The finish handler is async inside a subscribe; whenStable does not wait
      // for a promise the callback never returned.
      await new Promise(resolve => setTimeout(resolve));

      expect(component.keyPromptOpen).withContext('the form must open rather than let them in').toBeTrue();
      expect(mockRouter.navigateByUrl).withContext('navigating would hide the missing key').not.toHaveBeenCalled();
    });

    it('closes the form and navigates once the password produces a key', async () => {
      const keyMock = makeKeyMock('secret');
      const component = initWithKeyMock(keyMock);
      mockRouter.navigateByUrl.calls.reset();

      component.keyPromptOpen = true;
      component.keyPassword = 'secret';
      await component.submitKeyPassword();

      expect(keyMock.ensureAccountKey).toHaveBeenCalledWith('secret');
      expect(component.keyPromptOpen).withContext('the form must disappear').toBeFalse();
      expect(mockRouter.navigateByUrl).toHaveBeenCalled();
    });

    it('keeps the form open and explains why when the password does not help', async () => {
      const keyMock = makeKeyMock('secret');
      const component = initWithKeyMock(keyMock);
      mockRouter.navigateByUrl.calls.reset();

      component.keyPromptOpen = true;
      component.keyPassword = 'не тот';
      await component.submitKeyPassword();

      expect(component.keyPromptOpen).toBeTrue();
      expect(component.keyPromptError).withContext('silence would look like a broken button').toContain('Не удалось');
      expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();
    });

    it('lets the user in anyway: signing in does not depend on the key', async () => {
      const keyMock = makeKeyMock('secret');
      const component = initWithKeyMock(keyMock);
      mockRouter.navigateByUrl.calls.reset();

      component.keyPromptOpen = true;
      component.skipKeySetup();

      expect(component.keyPromptOpen).toBeFalse();
      expect(mockRouter.navigateByUrl).withContext('old messages must stay reachable').toHaveBeenCalled();
    });
  });
});

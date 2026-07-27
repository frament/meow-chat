import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { LoginComponent } from './login';
import { ApiService } from '../../services/api.service';
import { NotificationService } from '../../services/notification.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  const mockRouter = { navigate: jasmine.createSpy(), navigateByUrl: jasmine.createSpy(), createUrlTree: jasmine.createSpy(), serializeUrl: jasmine.createSpy(), events: of(null) };

  const mockApi = {
    login: jasmine.createSpy().and.returnValue(of({ access_token: 'at', refresh_token: 'rt' })),
    webauthnHasCredentials: jasmine.createSpy().and.returnValue(of({ has_credentials: false })),
    storeAuth: jasmine.createSpy(),
  };

  function init(routeParams: Record<string, string> = {}) {
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
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
});

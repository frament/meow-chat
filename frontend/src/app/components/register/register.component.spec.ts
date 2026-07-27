import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { RegisterComponent } from './register';
import { ApiService } from '../../services/api.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';

describe('RegisterComponent', () => {
  let component: RegisterComponent;
  let fixture: ComponentFixture<RegisterComponent>;
  const mockRouter = { navigate: jasmine.createSpy(), navigateByUrl: jasmine.createSpy(), createUrlTree: jasmine.createSpy(), serializeUrl: jasmine.createSpy(), events: of(null) };

  const mockApi = {
    register: jasmine.createSpy().and.returnValue(of({})),
    checkInvite: jasmine.createSpy().and.returnValue(of({ valid: true })),
  };

  function init(routeParams: Record<string, string> = {}) {
    TestBed.configureTestingModule({
      imports: [RegisterComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: routeParams }, paramMap: of(convertToParamMap({})), url: of([]) } },
        { provide: Router, useValue: mockRouter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    mockRouter.navigate.calls.reset();
    mockApi.register.calls.reset();
    mockApi.checkInvite.calls.reset();
    mockApi.register.and.returnValue(of({}));
    mockApi.checkInvite.and.returnValue(of({ valid: true }));
  });

  it('creates the component', () => {
    init();
    expect(component).toBeTruthy();
  });

  it('renders username, email, password, and invite token input fields', () => {
    init();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('input[name="username"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="email"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="password"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="invite_token"]')).toBeTruthy();
  });

  it('renders submit button with registration text', () => {
    init();
    const compiled = fixture.nativeElement as HTMLElement;
    const submitBtn = compiled.querySelector('button[type="submit"]');
    expect(submitBtn).toBeTruthy();
    expect(submitBtn?.textContent?.trim()).toBe('Зарегистрироваться');
  });

  it('calls register and shows success, then navigates to /login', fakeAsync(() => {
    init();
    component.username = 'newguy';
    component.email = 'new@t.com';
    component.password = 'pass123';
    component.inviteToken = 'token1';

    component.onSubmit();
    tick();

    expect(mockApi.register).toHaveBeenCalledWith('newguy', 'new@t.com', 'pass123', 'token1');
    expect(component.success).toBe('Регистрация успешна! Перенаправляю...');

    tick(1500);
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
  }));

  it('shows error on 400 response', fakeAsync(() => {
    mockApi.register.and.returnValue(throwError(() => ({ status: 400, error: { error: 'bad token' } })));
    init();
    component.inviteToken = 'bad';
    component.username = 'x';
    component.email = 'x@x.com';
    component.password = 'x';

    component.onSubmit();
    tick();

    expect(component.error).toBe('bad token');
  }));

  it('shows generic error on non-400 response', fakeAsync(() => {
    mockApi.register.and.returnValue(throwError(() => ({ status: 500 })));
    init();
    component.inviteToken = 'ok';
    component.username = 'x';
    component.email = 'x@x.com';
    component.password = 'x';

    component.onSubmit();
    tick();

    expect(component.error).toBe('Ошибка регистрации. Возможно, пользователь уже существует.');
  }));

  it('does not call register when inviteToken is empty', () => {
    init();
    component.inviteToken = '';
    component.onSubmit();
    expect(mockApi.register).not.toHaveBeenCalled();
  });

  it('checks invite token validity on init when query param present', fakeAsync(() => {
    init({ invite: 'tok99' });
    tick();

    expect(mockApi.checkInvite).toHaveBeenCalledWith('tok99');
    expect(component.inviteToken).toBe('tok99');
  }));
});

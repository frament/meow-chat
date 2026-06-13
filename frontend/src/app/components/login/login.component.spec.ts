import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoginComponent } from './login';
import { ApiService } from '../../services/api.service';
import { NotificationService } from '../../services/notification.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal, computed } from '@angular/core';
import { of } from 'rxjs';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;

  const mockApi = {
    login: jasmine.createSpy().and.returnValue(of({})),
    webauthnHasCredentials: jasmine.createSpy().and.returnValue(of({ has_credentials: false })),
    storeAuth: jasmine.createSpy(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
        { provide: NotificationService, useValue: { requestPermission: jasmine.createSpy() } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} }, paramMap: of(convertToParamMap({})), url: of([]) } },
        { provide: Router, useValue: { navigate: jasmine.createSpy(), navigateByUrl: jasmine.createSpy(), createUrlTree: jasmine.createSpy(), serializeUrl: jasmine.createSpy(), events: of(null) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('renders username and password input fields', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('input[name="username"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="password"]')).toBeTruthy();
  });

  it('renders submit button with login text', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const submitBtn = compiled.querySelector('button[type="submit"]');
    expect(submitBtn).toBeTruthy();
    expect(submitBtn?.textContent?.trim()).toBe('Войти');
  });
});

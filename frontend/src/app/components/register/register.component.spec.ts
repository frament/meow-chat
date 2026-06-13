import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RegisterComponent } from './register';
import { ApiService } from '../../services/api.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal, computed } from '@angular/core';
import { of } from 'rxjs';

describe('RegisterComponent', () => {
  let component: RegisterComponent;
  let fixture: ComponentFixture<RegisterComponent>;

  const mockApi = {
    register: jasmine.createSpy().and.returnValue(of({})),
    checkInvite: jasmine.createSpy().and.returnValue(of({ valid: true })),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RegisterComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} }, paramMap: of(convertToParamMap({})), url: of([]) } },
        { provide: Router, useValue: { navigate: jasmine.createSpy(), navigateByUrl: jasmine.createSpy(), createUrlTree: jasmine.createSpy(), serializeUrl: jasmine.createSpy(), events: of(null) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('renders username, email, password, and invite token input fields', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('input[name="username"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="email"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="password"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="invite_token"]')).toBeTruthy();
  });

  it('renders submit button with registration text', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const submitBtn = compiled.querySelector('button[type="submit"]');
    expect(submitBtn).toBeTruthy();
    expect(submitBtn?.textContent?.trim()).toBe('Зарегистрироваться');
  });
});

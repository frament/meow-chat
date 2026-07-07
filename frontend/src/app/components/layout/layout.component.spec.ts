import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LayoutComponent } from './layout';
import { ApiService } from '../../services/api.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal, computed } from '@angular/core';
import { of } from 'rxjs';

describe('LayoutComponent', () => {
  let component: LayoutComponent;
  let fixture: ComponentFixture<LayoutComponent>;

  const mockApi = {
    currentUser: signal(null),
    chatHeaderInfo: signal(null),
    totalUnread: computed(() => 0),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LayoutComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} }, paramMap: of(convertToParamMap({})), url: of([]) } },
        { provide: Router, useValue: { navigate: jasmine.createSpy(), navigateByUrl: jasmine.createSpy(), createUrlTree: jasmine.createSpy(), serializeUrl: jasmine.createSpy(), events: of(null) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('renders navigation sections', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('nav')).toBeTruthy();
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });

  it('renders logo and brand name', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const brand = compiled.querySelector('a[routerLink="/feed"]');
    expect(brand).toBeTruthy();
    expect(brand?.textContent?.trim()).toContain('MeowChat');
  });

  it('renders feed and chat nav links', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const links = compiled.querySelectorAll('a.nav-link');
    expect(links.length).toBeGreaterThan(0);
  });
});

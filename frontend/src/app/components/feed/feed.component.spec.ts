import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeedComponent } from './feed';
import { ApiService } from '../../services/api.service';
import { signal, computed } from '@angular/core';
import { of } from 'rxjs';

describe('FeedComponent', () => {
  let component: FeedComponent;
  let fixture: ComponentFixture<FeedComponent>;

  const mockApi = {
    currentUser: signal({ id: 1, username: 'test', avatar_url: '' }),
    getFeed: jasmine.createSpy().and.returnValue(of([])),
    wsMessages$: of(null),
    totalUnread: computed(() => 0),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeedComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('renders feed area', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.new-post')).toBeTruthy();
  });

  it('has post creator with textarea', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const textarea = compiled.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect(textarea?.getAttribute('placeholder')).toContain('нового');
  });

  it('renders public post toggle checkbox', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const checkbox = compiled.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
  });

  it('renders submit button', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const btn = Array.from(compiled.querySelectorAll('button')).find(b => b.textContent?.includes('Опубликовать'));
    expect(btn).toBeTruthy();
  });
});

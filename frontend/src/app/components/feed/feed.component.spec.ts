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
    deletePost: jasmine.createSpy().and.returnValue(of({})),
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

  it('has new post trigger button instead of inline form', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.new-post')).toBeFalsy();
    const buttons = compiled.querySelectorAll('button');
    const triggerBtn = Array.prototype.find.call(buttons, (b: Element) => b.textContent?.includes('Написать пост'));
    expect(triggerBtn).toBeTruthy();
  });

  it('shows delete button on own post', () => {
    component.posts = [{
      id: 1,
      user_id: 1,
      content: 'Test post',
      created_at: new Date().toISOString(),
      username: 'test',
      avatar_url: '',
      is_admin: false,
      is_public: false,
    }];
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const deleteBtn = compiled.querySelector('button[title="Удалить пост"]');
    expect(deleteBtn).toBeTruthy();
  });

  it('hides delete button on other user post', () => {
    component.posts = [{
      id: 2,
      user_id: 2,
      content: 'Other post',
      created_at: new Date().toISOString(),
      username: 'other',
      avatar_url: '',
      is_admin: false,
      is_public: false,
    }];
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const deleteBtn = compiled.querySelector('button[title="Удалить пост"]');
    expect(deleteBtn).toBeFalsy();
  });
});

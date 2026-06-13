import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AddFriendComponent } from './add-friend';
import { ApiService } from '../../services/api.service';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';

describe('AddFriendComponent', () => {
  let component: AddFriendComponent;
  let fixture: ComponentFixture<AddFriendComponent>;

  const mockApi = {
    currentUser: signal({ id: 1, username: 'test', email: 't@t.com', avatar_url: '' }),
    checkFriendInvite: jasmine.createSpy().and.returnValue(of({ valid: true, creator: 'Alice', created_by: 2 })),
    acceptFriendInvite: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddFriendComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
        { provide: Router, useValue: { navigate: jasmine.createSpy(), navigateByUrl: jasmine.createSpy(), createUrlTree: jasmine.createSpy(), serializeUrl: jasmine.createSpy(), events: of(null) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: { token: 'abc123' } } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AddFriendComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('renders invite details and accept button for valid token', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(component.loading).toBeFalse();
    expect(component.inviteData?.creator).toBe('Alice');
    expect(compiled.textContent).toContain('Приглашение в друзья');
    expect(compiled.textContent).toContain('Alice');
    expect(compiled.textContent).toContain('Принять приглашение');
  });
});

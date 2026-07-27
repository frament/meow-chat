import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { AddFriendComponent } from './add-friend';
import { ApiService } from '../../services/api.service';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';

describe('AddFriendComponent', () => {
  let component: AddFriendComponent;
  let fixture: ComponentFixture<AddFriendComponent>;
  const mockRouter = { navigate: jasmine.createSpy(), navigateByUrl: jasmine.createSpy(), createUrlTree: jasmine.createSpy(), serializeUrl: jasmine.createSpy(), events: of(null) };

  const mockApiFn = (checkResult = of({ valid: true, creator: 'Alice', created_by: 2 })) => ({
    currentUser: signal({ id: 1, username: 'test', email: 't@t.com', avatar_url: '' }),
    checkFriendInvite: jasmine.createSpy().and.returnValue(checkResult),
    acceptFriendInvite: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
  });

  function setup(params?: Record<string, string>, api?: any) {
    TestBed.resetTestingModule();
    const a = api || mockApiFn();
    TestBed.configureTestingModule({
      imports: [AddFriendComponent],
      providers: [
        { provide: ApiService, useValue: a },
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: params || { token: 'abc123' } } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AddFriendComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    return { api: a };
  }

  beforeEach(() => {
    mockRouter.navigate.calls.reset();
    mockRouter.navigateByUrl.calls.reset();
  });

  it('creates the component', () => {
    setup();
    expect(component).toBeTruthy();
  });

  it('renders invite details and accept button for valid token', () => {
    setup();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(component.loading).toBeFalse();
    expect(component.inviteData?.creator).toBe('Alice');
    expect(compiled.textContent).toContain('Приглашение в друзья');
    expect(compiled.textContent).toContain('Alice');
    expect(compiled.textContent).toContain('Принять приглашение');
  });

  it('shows error when invite is invalid', () => {
    setup({ token: 'bad' }, mockApiFn(of({ valid: false, creator: '', created_by: 0, reason: 'already_used' })));
    expect(component.error).toBe('Это приглашение уже использовано');
  });

  it('shows error when invite check fails', () => {
    setup({ token: 'bad' }, mockApiFn(throwError(() => ({}))));
    expect(component.error).toBe('Приглашение не найдено');
  });

  it('shows error when token query param is missing', () => {
    setup({});
    expect(component.error).toBe('Неверная ссылка приглашения');
  });

  it('sets acceptSuccess on successful doAccept', fakeAsync(() => {
    const { api } = setup();
    component.doAccept();
    tick();
    expect(api.acceptFriendInvite).toHaveBeenCalledWith('abc123');
    expect(component.acceptSuccess).toBeTrue();
  }));

  it('sets acceptError on failed doAccept', fakeAsync(() => {
    const a = mockApiFn();
    a.acceptFriendInvite.and.returnValue(throwError(() => ({ error: { error: 'bad' } })));
    setup({ token: 'abc123' }, a);
    component.doAccept();
    tick();
    expect(component.acceptError).toBe('bad');
  }));
});

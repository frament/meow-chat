import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { JoinGroupComponent } from './join-group';
import { ApiService } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';

describe('JoinGroupComponent', () => {
  let component: JoinGroupComponent;
  let fixture: ComponentFixture<JoinGroupComponent>;
  const mockRouter = { navigate: jasmine.createSpy(), navigateByUrl: jasmine.createSpy(), createUrlTree: jasmine.createSpy(), serializeUrl: jasmine.createSpy(), events: of(null) };

  const mockApiFn = (inviteResult = of({ group_chat_id: 5, group_name: 'My Group', token: 'token' })) => ({
    currentUser: signal({ id: 1, username: 'test', email: 't@t.com', avatar_url: '' }),
    getGroupInvite: jasmine.createSpy().and.returnValue(inviteResult),
    joinGroupViaInvite: jasmine.createSpy().and.returnValue(of({ message: 'ok', group_chat_id: 5, group_name: 'My Group' })),
  });

  const mockCrypto = {
    init: jasmine.createSpy().and.returnValue(Promise.resolve()),
    getGroupKey: jasmine.createSpy().and.returnValue(Promise.resolve()),
  };

  function setup(params?: Record<string, string>, api?: any) {
    TestBed.resetTestingModule();
    const a = api || mockApiFn();
    TestBed.configureTestingModule({
      imports: [JoinGroupComponent],
      providers: [
        { provide: ApiService, useValue: a },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: params || { token: 'invite123' } } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(JoinGroupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    return { api: a };
  }

  beforeEach(() => {
    mockRouter.navigate.calls.reset();
  });

  it('creates the component', () => {
    setup();
    expect(component).toBeTruthy();
  });

  it('renders group name and join button for valid token', () => {
    setup();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(component.loading).toBeFalse();
    expect(component.groupName).toBe('My Group');
    expect(compiled.textContent).toContain('Приглашение в группу');
    expect(compiled.textContent).toContain('My Group');
    expect(compiled.textContent).toContain('Присоединиться');
  });

  it('shows error when invite check fails', () => {
    setup({ token: 'bad' }, mockApiFn(throwError(() => ({}))));
    expect(component.error).toBe('Приглашение не найдено или истекло');
  });

  it('shows error when token query param is missing', () => {
    setup({});
    expect(component.error).toBe('Неверная ссылка приглашения');
  });

  it('sets joinSuccess on successful doJoin', fakeAsync(() => {
    const { api } = setup();
    component.doJoin();
    tick();
    expect(api.joinGroupViaInvite).toHaveBeenCalledWith('invite123');
    expect(component.joinSuccess).toBeTrue();
  }));

  it('sets joinError on failed doJoin', fakeAsync(() => {
    const a = mockApiFn();
    a.joinGroupViaInvite.and.returnValue(throwError(() => ({ error: { error: 'group full' } })));
    setup({ token: 'invite123' }, a);
    component.doJoin();
    tick();
    expect(component.joinError).toBe('group full');
  }));
});

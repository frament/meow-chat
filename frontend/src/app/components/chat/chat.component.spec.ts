import { ComponentFixture, TestBed, fakeAsync } from '@angular/core/testing';
import { ChatComponent } from './chat';
import { ApiService } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal, computed } from '@angular/core';
import { of, Subject } from 'rxjs';

describe('ChatComponent', () => {
  let component: ChatComponent;
  let fixture: ComponentFixture<ChatComponent>;

  const wsMessages$ = new Subject<any>();
  const wsOnlineEvent = new Subject<{ type: 'user_online' | 'user_offline'; user_id: number }>();

  const mockApi = {
    currentUser: signal({ id: 1, username: 'test', avatar_url: '' }),
    cachedUsers: signal([]),
    cachedPins: signal([]),
    unreadCounts: signal<Record<number, number>>({}),
    unreadBoundaries: signal<Record<number, string>>({}),
    totalUnread: computed(() => 0),
    wsMessages$: wsMessages$.asObservable(),
    wsOnlineEvent: wsOnlineEvent.asObservable(),
    selectUser: jasmine.createSpy(),
    getUsers: jasmine.createSpy().and.returnValue(of([])),
    getPinned: jasmine.createSpy().and.returnValue(of({ pinned_user_ids: [] })),
    getMessages: jasmine.createSpy().and.returnValue(of({ messages: [], hasMore: false })),
    sendMessage: jasmine.createSpy().and.returnValue(of({ id: 1 })),
    getGroupChats: jasmine.createSpy().and.returnValue(of([])),
    getGroupMessages: jasmine.createSpy().and.returnValue(of([])),
    sendGroupMessage: jasmine.createSpy().and.returnValue(of({ id: 1 })),
    pinUser: jasmine.createSpy().and.returnValue(of({})),
    unpinUser: jasmine.createSpy().and.returnValue(of({})),
    createGroupChat: jasmine.createSpy().and.returnValue(of({ id: 1 })),
    getGroupChat: jasmine.createSpy().and.returnValue(of({ members: [] })),
    createGroupInvite: jasmine.createSpy().and.returnValue(of({ token: 'abc' })),
    deleteGroupChat: jasmine.createSpy().and.returnValue(of({})),
    sendMessageWithProgress: jasmine.createSpy().and.returnValue(of({})),
    sendGroupMessageWithProgress: jasmine.createSpy().and.returnValue(of({})),
    clearUnread: jasmine.createSpy(),
    clearUnreadBoundary: jasmine.createSpy(),
  };

  const mockCrypto = {
    init: jasmine.createSpy().and.returnValue(Promise.resolve()),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({}) }, paramMap: of(convertToParamMap({})), url: of([]) } },
        { provide: Router, useValue: { navigate: jasmine.createSpy(), navigateByUrl: jasmine.createSpy(), createUrlTree: jasmine.createSpy(), serializeUrl: jasmine.createSpy(), events: of(null), url: '' } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('renders user list section with friends heading', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const headings = compiled.querySelectorAll('h3');
    const friendsHeading = Array.from(headings).find(h => h.textContent?.includes('Друзья'));
    expect(friendsHeading).toBeTruthy();
  });

  it('renders group chats section heading', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const headings = compiled.querySelectorAll('h3');
    const groupHeading = Array.from(headings).find(h => h.textContent?.includes('Групповые чаты'));
    expect(groupHeading).toBeTruthy();
  });

  it('renders message input area after selecting a user', fakeAsync(() => {
    component.selectedUser = { id: 2, username: 'friend', email: '', avatar_url: '', is_admin: false, is_banned: false, created_at: '', is_online: false };
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector('input[type="text"]');
    expect(input).toBeTruthy();
  }));

  it('renders type selector buttons after selecting a user', fakeAsync(() => {
    component.selectedUser = { id: 2, username: 'friend', email: '', avatar_url: '', is_admin: false, is_banned: false, created_at: '', is_online: false };
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const buttons = compiled.querySelectorAll('button');
    const typeBtn = Array.from(buttons).find(b => b.textContent?.includes('Текст'));
    expect(typeBtn).toBeTruthy();
  }));

  it('renders send button after selecting a user', fakeAsync(() => {
    component.selectedUser = { id: 2, username: 'friend', email: '', avatar_url: '', is_admin: false, is_banned: false, created_at: '', is_online: false };
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const sendBtn = compiled.querySelector('button[title="Отправить"]');
    expect(sendBtn).toBeTruthy();
  }));

  it('shows "Выберите чат" when no user or group selected', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Выберите чат');
  });
});

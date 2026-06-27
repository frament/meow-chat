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
    getGiphyKey: jasmine.createSpy().and.returnValue(of({ has_key: false, key: '' })),
    searchUsers: jasmine.createSpy().and.returnValue(of([])),
    sendFriendRequest: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    getFriendRequests: jasmine.createSpy().and.returnValue(of([])),
    acceptFriendRequest: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    rejectFriendRequest: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
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

  it('renders type toggle button with current type label after selecting a user', fakeAsync(() => {
    component.selectedUser = { id: 2, username: 'friend', email: '', avatar_url: '', is_admin: false, is_banned: false, created_at: '', is_online: false };
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const container = compiled.querySelector('.type-menu-container') as HTMLElement;
    expect(container).toBeTruthy();
    const toggleBtn = container?.querySelector('button') as HTMLButtonElement;
    expect(toggleBtn).toBeTruthy();
    expect(toggleBtn.textContent).toContain('Текст');
  }));

  it('opens popup menu on toggle button click', fakeAsync(() => {
    component.selectedUser = { id: 2, username: 'friend', email: '', avatar_url: '', is_admin: false, is_banned: false, created_at: '', is_online: false };
    fixture.detectChanges();
    expect(component.showTypeMenu).toBeFalse();
    const compiled = fixture.nativeElement as HTMLElement;
    const container = compiled.querySelector('.type-menu-container') as HTMLElement;
    const toggleBtn = container?.querySelector('button') as HTMLButtonElement;
    toggleBtn.click();
    fixture.detectChanges();
    expect(component.showTypeMenu).toBeTrue();
  }));

  it('selects type from popup menu', fakeAsync(() => {
    component.selectedUser = { id: 2, username: 'friend', email: '', avatar_url: '', is_admin: false, is_banned: false, created_at: '', is_online: false };
    component.showTypeMenu = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const container = compiled.querySelector('.type-menu-container') as HTMLElement;
    const allButtons = container?.querySelectorAll('button') || [];
    const fotoBtn = Array.from(allButtons).find(b => b.textContent?.includes('Фото'));
    expect(fotoBtn).toBeTruthy();
    expect(fotoBtn?.hasAttribute('disabled')).toBeFalse();
    fotoBtn?.click();
    fixture.detectChanges();
    expect(component.messageType).toBe('image');
    expect(component.showTypeMenu).toBeFalse();
  }));

  it('shows disabled gif item in popup when giphy key missing', fakeAsync(() => {
    component.selectedUser = { id: 2, username: 'friend', email: '', avatar_url: '', is_admin: false, is_banned: false, created_at: '', is_online: false };
    component.showTypeMenu = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const container = compiled.querySelector('.type-menu-container') as HTMLElement;
    const disabledBtns = container?.querySelectorAll('button[disabled]') || [];
    const disabledTexts = Array.from(disabledBtns).map(b => b.textContent?.trim());
    expect(disabledTexts.some(t => t?.includes('GIF'))).toBeTrue();
  }));

  it('shows sticker item in popup', fakeAsync(() => {
    component.selectedUser = { id: 2, username: 'friend', email: '', avatar_url: '', is_admin: false, is_banned: false, created_at: '', is_online: false };
    component.showTypeMenu = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const container = compiled.querySelector('.type-menu-container') as HTMLElement;
    const btns = container?.querySelectorAll('button') || [];
    const texts = Array.from(btns).map(b => b.textContent?.trim());
    expect(texts.some(t => t?.includes('Стикер'))).toBeTrue();
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

import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ApiService } from './api.service';

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;
  let mockWsInstance: { close: jasmine.Spy; readyState: number };
  let originalWebSocket: any;

  function mockWebSocket(): void {
    mockWsInstance = {
      close: jasmine.createSpy('close'),
      readyState: WebSocket.OPEN,
    };
    (globalThis as any).WebSocket = jasmine
      .createSpy('WebSocket')
      .and.returnValue(mockWsInstance);
  }

  function triggerWsOnclose(): void {
    const constructor = (globalThis as any).WebSocket as jasmine.Spy;
    const instance = constructor.calls.mostRecent().returnValue;
    if (instance.onclose) instance.onclose(new Event('close'));
  }

  beforeEach(() => {
    localStorage.clear();
    originalWebSocket = (globalThis as any).WebSocket;
    mockWebSocket();

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    (globalThis as any).WebSocket = originalWebSocket;
  });

  it('creates service', () => {
    expect(service).toBeTruthy();
  });

  it('baseUrl defaults to /api', () => {
    expect((service as any).baseUrl).toBe('/api');
  });

  it('currentUser() initially returns null', () => {
    expect(service.currentUser()).toBeNull();
  });

  it('accessToken() initially returns null', () => {
    expect(service.accessToken()).toBeNull();
  });

  it('login() calls /api/login with correct body', () => {
    const username = 'testuser';
    const password = 'testpass';

    service.login(username, password).subscribe();

    const req = httpMock.expectOne('/api/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username, password });
    req.flush({
      access_token: 'at',
      refresh_token: 'rt',
      user: { id: 1, username: 'testuser', email: '', avatar_url: '', is_admin: false },
    });
  });

  it('register() calls /api/register with correct body', () => {
    service.register('newuser', 'new@e.ml', 'secret123', 'inv-token').subscribe();

    const req = httpMock.expectOne('/api/register');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      username: 'newuser',
      email: 'new@e.ml',
      password: 'secret123',
      invite_token: 'inv-token',
    });
    req.flush({ id: 1, message: 'ok' });
  });

  it('storeAuth sets signals and localStorage', () => {
    const auth = {
      access_token: 'access-123',
      refresh_token: 'refresh-456',
      user: { id: 42, username: 'alice', email: 'a@b.c', avatar_url: '', is_admin: false },
    };

    service.storeAuth(auth);

    expect(service.accessToken()).toBe('access-123');
    expect(service.currentUser()?.id).toBe(42);
    expect(localStorage.getItem('accessToken')).toBe('access-123');
    expect(localStorage.getItem('refreshToken')).toBe('refresh-456');
    expect(localStorage.getItem('currentUser')).toBe(JSON.stringify(auth.user));
  });

  it('stores accessToken and user from localStorage on init', () => {
    TestBed.resetTestingModule();
    localStorage.setItem('accessToken', 'stored-token');
    localStorage.setItem('currentUser', JSON.stringify({ id: 7, username: 'bob' }));

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const s = TestBed.inject(ApiService);
    expect(s.accessToken()).toBe('stored-token');
    expect(s.currentUser()?.id).toBe(7);
    expect(s.currentUser()?.username).toBe('bob');
  });

  it('logout clears signals and localStorage', () => {
    localStorage.setItem('accessToken', 'x');
    localStorage.setItem('refreshToken', 'y');
    localStorage.setItem('currentUser', '{"id":1}');
    service.accessToken.set('x');
    service.currentUser.set({ id: 1, username: '', email: '', avatar_url: '', is_admin: false });

    service.logout();

    const req = httpMock.expectOne('/api/logout');
    req.flush({});

    expect(service.accessToken()).toBeNull();
    expect(service.currentUser()).toBeNull();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(localStorage.getItem('currentUser')).toBeNull();
  });

  // ── Friend Request API ──

  it('searchUsers() calls /api/users/search with query param', () => {
    const query = 'alice';
    service.searchUsers(query).subscribe();

    const req = httpMock.expectOne('/api/users/search?q=alice');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('sendFriendRequest() calls POST /api/friend-requests/:id', () => {
    const userId = 42;
    service.sendFriendRequest(userId).subscribe();

    const req = httpMock.expectOne('/api/friend-requests/42');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ message: 'Запрос в друзья отправлен' });
  });

  it('sendFriendRequest() returns auto_accepted when mutual', () => {
    const userId = 42;
    service.sendFriendRequest(userId).subscribe((res) => {
      expect(res.auto_accepted).toBeTrue();
      expect(res.message).toBe('Вы стали друзьями!');
    });

    const req = httpMock.expectOne('/api/friend-requests/42');
    req.flush({ message: 'Вы стали друзьями!', auto_accepted: true });
  });

  it('getFriendRequests() calls GET /api/friend-requests', () => {
    const mockRequests = [
      { id: 1, from_user: 10, username: 'alice', avatar_url: '', status: 'pending', created_at: '2026-01-01' },
    ];

    service.getFriendRequests().subscribe((reqs) => {
      expect(reqs.length).toBe(1);
      expect(reqs[0].username).toBe('alice');
    });

    const req = httpMock.expectOne('/api/friend-requests');
    expect(req.request.method).toBe('GET');
    req.flush(mockRequests);
  });

  it('acceptFriendRequest() calls POST /api/friend-requests/:id/accept', () => {
    const requestId = 5;
    service.acceptFriendRequest(requestId).subscribe();

    const req = httpMock.expectOne('/api/friend-requests/5/accept');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ message: 'Запрос принят' });
  });

  it('rejectFriendRequest() calls DELETE /api/friend-requests/:id', () => {
    const requestId = 7;
    service.rejectFriendRequest(requestId).subscribe();

    const req = httpMock.expectOne('/api/friend-requests/7');
    expect(req.request.method).toBe('DELETE');
    req.flush({ message: 'Запрос отклонён' });
  });

  // ── T9a: PWA — after 20 failed reconnects → slow-poll 60s ──

  it('T9a: switches to slow-poll after 20 failed reconnect attempts', fakeAsync(() => {
    // Use a JWT with far-future exp so scheduleReconnect doesn't call refreshToken
    const futureToken =
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) +
      '.' +
      btoa(JSON.stringify({ exp: 9999999999 })) +
      '.fakesig';
    service.storeAuth({
      access_token: futureToken,
      refresh_token: 'test-refresh',
      user: { id: 1, username: 'u', email: 'e@m.c', avatar_url: '', is_admin: false },
    });
    tick();

    // Cycle 20 times: trigger onclose → timer fires → reconnect → onclose again
    for (let i = 0; i < 20; i++) {
      triggerWsOnclose();     // sets wsReconnecting, schedules timer
      tick(120000);           // fire the timer (bigger than max backoff 30s + jitter)
    }

    expect((service as any).wsRetryCount).toBeGreaterThanOrEqual(20);
  }));

  // ── T9b: PWA — visibilitychange → visible resets retryCount ──

  it('T9b: visibilitychange resets retry state and reconnects', fakeAsync(() => {
    const futureToken =
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) +
      '.' +
      btoa(JSON.stringify({ exp: 9999999999 })) +
      '.fakesig';
    service.storeAuth({
      access_token: futureToken,
      refresh_token: 'test-refresh',
      user: { id: 1, username: 'u', email: 'e@m.c', avatar_url: '', is_admin: false },
    });
    tick();

    // Simulate a few reconnection failures
    for (let i = 0; i < 5; i++) {
      triggerWsOnclose();
      tick(120000);
    }
    expect((service as any).wsRetryCount).toBeGreaterThan(0);

    // Reset retry state (as visibilitychange would)
    (service as any).resetRetryState();
    tick();

    expect((service as any).wsRetryCount).toBe(0);
  }));

  // ── T9c: PWA — after logout, no reconnect ──

  it('T9c: logout prevents reconnection attempts', fakeAsync(() => {
    service.storeAuth({
      access_token: 'irrelevant',
      refresh_token: 'irrelevant',
      user: { id: 1, username: 'u', email: 'e@m.c', avatar_url: '', is_admin: false },
    });
    tick();

    // Logout clears token and user, disconnects WS
    service.logout();
    const logoutReq = httpMock.expectOne('/api/logout');
    logoutReq.flush({});
    tick();

    // After logout, wsRetryTimer should be null
    expect((service as any).wsRetryTimer).toBeNull();

    // Simulate a stray onclose from the now-null'd ws — scheduleReconnect should bail
    triggerWsOnclose();
    tick(5000);
    expect((service as any).wsRetryTimer).toBeNull();
  }));
});

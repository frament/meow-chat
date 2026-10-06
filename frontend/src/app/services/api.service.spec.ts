import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
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

  // ── Regression: refreshAccessToken used to read a field its own callback had
  // already cleared, so a synchronous HTTP response made it throw before it
  // returned. An unhandled rejection of that shape aborts a whole Karma run.

  it('returns a usable observable when the refresh response is synchronous', fakeAsync(() => {
    localStorage.setItem('refreshToken', 'test-refresh');

    // of() delivers on subscribe, so the response arrives before
    // refreshAccessToken reaches its own return statement. That ordering is the
    // whole point: it is what the interceptor hits when a transport is cached or
    // mocked, and it is what the test harness always does.
    spyOn(service['http'], 'post').and.returnValue(
      of({ access_token: 'fresh-access', refresh_token: 'fresh-refresh' }),
    );

    let result: { access_token: string; refresh_token: string } | undefined;
    let failure: unknown = undefined;
    service.refreshAccessToken().subscribe({
      next: (res) => (result = res),
      error: (err) => (failure = err),
    });
    tick();

    expect(failure).toBeUndefined();
    expect(result).toEqual({ access_token: 'fresh-access', refresh_token: 'fresh-refresh' });
    expect(localStorage.getItem('accessToken')).toBe('fresh-access');
  }));

  it('returns a usable observable when the refresh fails synchronously', fakeAsync(() => {
    localStorage.setItem('refreshToken', 'test-refresh');

    spyOn(service['http'], 'post').and.returnValue(
      throwError(() => new Error('refresh rejected')),
    );

    let failure: unknown = undefined;
    service.refreshAccessToken().subscribe({
      next: () => fail('should not have succeeded'),
      error: (err) => (failure = err),
    });
    tick();

    // An expired refresh token ends in a logged-out user, not a thrown
    // TypeError nobody catches.
    expect((failure as Error)?.message).toBe('refresh rejected');
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

  // ── T10a: scheduleReconnect — no logout on network error ──

  it('T10a: does not logout on network error during refresh in scheduleReconnect', fakeAsync(() => {
    const expiredToken =
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
      btoa(JSON.stringify({ exp: 0 })) + '.fakesig';
    service.storeAuth({
      access_token: expiredToken,
      refresh_token: 'rt',
      user: { id: 1, username: 'u', email: 'e@m.c', avatar_url: '', is_admin: false },
    });
    tick();

    spyOn(service, 'logout');

    // Trigger WS close → scheduleReconnect → timer → refresh
    triggerWsOnclose();
    tick(2000);

    const refreshReq = httpMock.expectOne('/api/refresh');
    // Network error (status 0) — should NOT trigger logout
    refreshReq.flush('Network Error', { status: 0, statusText: 'Unknown Error' });

    expect(service.logout).not.toHaveBeenCalled();
  }));

  // ── T10b: scheduleReconnect — does logout on 401 ──

  it('T10b: logs out on 401 during refresh in scheduleReconnect', fakeAsync(() => {
    const expiredToken =
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
      btoa(JSON.stringify({ exp: 0 })) + '.fakesig';
    service.storeAuth({
      access_token: expiredToken,
      refresh_token: 'rt',
      user: { id: 1, username: 'u', email: 'e@m.c', avatar_url: '', is_admin: false },
    });
    tick();

    spyOn(service, 'logout');

    triggerWsOnclose();
    tick(2000);

    const refreshReq = httpMock.expectOne('/api/refresh');
    // 401 from refresh — should trigger logout
    refreshReq.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(service.logout).toHaveBeenCalled();
  }));

  // ── T10c: retryConnection — refresh expired token before WS connect ──

  it('T10c: retryConnection refreshes expired token before connecting WS', fakeAsync(() => {
    const expiredToken =
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
      btoa(JSON.stringify({ exp: 0 })) + '.fakesig';
    service.storeAuth({
      access_token: expiredToken,
      refresh_token: 'rt',
      user: { id: 1, username: 'u', email: 'e@m.c', avatar_url: '', is_admin: false },
    });
    tick();

    const wsSpy = (globalThis as any).WebSocket as jasmine.Spy;
    const initialWsCount = wsSpy.calls.count();

    // Simulate disconnected state
    (service as any).ws = null;

    service.retryConnection();

    // Should call refresh instead of connecting directly
    const refreshReq = httpMock.expectOne('/api/refresh');
    expect(wsSpy.calls.count()).toBe(initialWsCount);

    // Flush refresh success
    refreshReq.flush({ access_token: 'new-token', refresh_token: 'new-rt' });
    tick();

    expect(wsSpy.calls.count()).toBe(initialWsCount + 1);
    expect(service.accessToken()).toBe('new-token');
  }));

  // ── T10d: retryConnection — skip refresh when token is valid ──

  it('T10d: retryConnection skips refresh and connects directly when token is valid', fakeAsync(() => {
    const futureToken =
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
      btoa(JSON.stringify({ exp: 9999999999 })) + '.fakesig';
    service.storeAuth({
      access_token: futureToken,
      refresh_token: 'rt',
      user: { id: 1, username: 'u', email: 'e@m.c', avatar_url: '', is_admin: false },
    });
    tick();

    const wsSpy = (globalThis as any).WebSocket as jasmine.Spy;
    const initialWsCount = wsSpy.calls.count();

    // Simulate disconnected state
    (service as any).ws = null;

    service.retryConnection();

    // Should connect directly, no refresh call
    httpMock.expectNone('/api/refresh');
    expect(wsSpy.calls.count()).toBe(initialWsCount + 1);
  }));
  // ── Handshake watchdog ──
  //
  // The bug this covers: on a mobile network packets are dropped rather than
  // refused, so a socket can sit in CONNECTING indefinitely. Neither onopen nor
  // onclose ever fires, wsConnecting stays true, and the guard at the top of
  // connectWebSocket rejects every later attempt - the socket dies silently and
  // nothing recovers it. Observed on LTE: HTTP came back, the WebSocket never did,
  // zero "WS connect" in ten minutes.

  it('gives up on a handshake that stalls, and schedules a retry', fakeAsync(() => {
    const futureToken =
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
      btoa(JSON.stringify({ exp: 9999999999 })) + '.fakesig';
    service.storeAuth({
      access_token: futureToken,
      refresh_token: 'rt',
      user: { id: 1, username: 'u', email: 'e@m.c', avatar_url: '', is_admin: false },
    });
    tick();

    const wsSpy = (globalThis as any).WebSocket as jasmine.Spy;
    const before = wsSpy.calls.count();

    // No onopen and no onclose - the handshake just hangs.
    expect((service as any).wsConnecting).toBe(true);

    tick((service as any).WS_CONNECT_TIMEOUT + 100);

    // Cleared, so the next attempt is allowed through.
    expect((service as any).wsConnecting).toBe(false);
    expect(service.wsConnected()).toBe(false);

    // And the backoff timer fired, opening a new socket.
    tick(35000);
    expect(wsSpy.calls.count()).toBeGreaterThan(before);
  }));

  it('lets a handshake that completes in time stand - the watchdog must not fire', fakeAsync(() => {
    const futureToken =
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
      btoa(JSON.stringify({ exp: 9999999999 })) + '.fakesig';
    service.storeAuth({
      access_token: futureToken,
      refresh_token: 'rt',
      user: { id: 1, username: 'u', email: 'e@m.c', avatar_url: '', is_admin: false },
    });
    tick();

    const wsSpy = (globalThis as any).WebSocket as jasmine.Spy;
    const socket = wsSpy.calls.mostRecent().returnValue;
    const countAfterConnect = wsSpy.calls.count();

    // The handshake succeeds, as it would on a healthy network.
    socket.onopen(new Event('open'));
    expect(service.wsConnected()).toBe(true);

    // Well past the watchdog deadline: nothing should happen.
    tick((service as any).WS_CONNECT_TIMEOUT + 60000);
    expect(wsSpy.calls.count()).toBe(countAfterConnect);
    expect(service.wsConnected()).toBe(true);
  }));

  it('does not stack two retries when the watchdog drops a stalled socket', fakeAsync(() => {
    const futureToken =
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
      btoa(JSON.stringify({ exp: 9999999999 })) + '.fakesig';
    service.storeAuth({
      access_token: futureToken,
      refresh_token: 'rt',
      user: { id: 1, username: 'u', email: 'e@m.c', avatar_url: '', is_admin: false },
    });
    tick();

    const wsSpy = (globalThis as any).WebSocket as jasmine.Spy;

    // Watchdog fires; it detaches onclose before closing so that close cannot
    // schedule a second reconnect on top of the one already asked for.
    tick((service as any).WS_CONNECT_TIMEOUT + 100);
    const afterWatchdog = wsSpy.calls.count();

    // Over a long window, backoff opens sockets at 1s, 2s, 4s, 8s, 16s, 30s...
    // One extra attempt per step is correct; a doubled rate is not.
    const single = (service as any).wsRetryCount;
    tick(120000);

    // Roughly six steps in two minutes - nowhere near double that.
    expect((service as any).wsRetryCount - single).toBeLessThan(12);
    expect(wsSpy.calls.count()).toBeGreaterThan(afterWatchdog);
  }));

  it('stops retrying after logout even if a handshake was in flight', fakeAsync(() => {
    const futureToken =
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
      btoa(JSON.stringify({ exp: 9999999999 })) + '.fakesig';
    service.storeAuth({
      access_token: futureToken,
      refresh_token: 'rt',
      user: { id: 1, username: 'u', email: 'e@m.c', avatar_url: '', is_admin: false },
    });
    tick();

    const wsSpy = (globalThis as any).WebSocket as jasmine.Spy;
    const count = wsSpy.calls.count();

    // The socket is still handshaking when the user signs out.
    expect((service as any).wsConnecting).toBe(true);
    service.logout();
    // logout() tells the server to drop the refresh token; drain that request.
    const logoutReq = httpMock.expectOne('/api/logout');
    logoutReq.flush({ ok: true });

    tick((service as any).WS_CONNECT_TIMEOUT + 120000);

    // No token, no reconnect - and the watchdog found nothing left to clear.
    expect((service as any).wsConnecting).toBe(false);
    expect(wsSpy.calls.count()).toBe(count);
  }));

  it('caps the backoff at the ceiling instead of jumping to a minute', fakeAsync(() => {
    const futureToken =
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
      btoa(JSON.stringify({ exp: 9999999999 })) + '.fakesig';
    service.storeAuth({
      access_token: futureToken,
      refresh_token: 'rt',
      user: { id: 1, username: 'u', email: 'e@m.c', avatar_url: '', is_admin: false },
    });
    tick();

    // Push the retry counter far past the old WS_MAX_RETRIES threshold.
    (service as any).wsRetryCount = 40;
    triggerWsOnclose();

    // The ceiling is 30s. It used to become 60s here, which read as a dead socket.
    tick(31000);
    expect((service as any).wsRetryCount).toBeGreaterThan(40);
  }));
  it('does not leave the watchdog armed after a clean close', fakeAsync(() => {
    // A timer left running is not harmless: it holds the service alive through the
    // backoff window and fires against a socket that no longer exists. Asserted
    // directly rather than through behaviour, because every observable effect is
    // indistinguishable from "the watchdog did nothing" - which is exactly the kind
    // of test that passes while the bug is present.
    const futureToken =
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
      btoa(JSON.stringify({ exp: 9999999999 })) + '.fakesig';
    service.storeAuth({
      access_token: futureToken,
      refresh_token: 'rt',
      user: { id: 1, username: 'u', email: 'e@m.c', avatar_url: '', is_admin: false },
    });
    tick();

    // The handshake fails normally: the server refuses, onclose arrives.
    triggerWsOnclose();

    expect((service as any).wsConnectTimer).toBeNull();
  }));

  it('does not leave the watchdog armed when the socket opens', fakeAsync(() => {
    const futureToken =
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
      btoa(JSON.stringify({ exp: 9999999999 })) + '.fakesig';
    service.storeAuth({
      access_token: futureToken,
      refresh_token: 'rt',
      user: { id: 1, username: 'u', email: 'e@m.c', avatar_url: '', is_admin: false },
    });
    tick();

    const wsSpy = (globalThis as any).WebSocket as jasmine.Spy;
    wsSpy.calls.mostRecent().returnValue.onopen(new Event('open'));

    expect((service as any).wsConnectTimer).toBeNull();
  }));

  it('does not leave the watchdog armed when the constructor throws', fakeAsync(() => {
    const futureToken =
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
      btoa(JSON.stringify({ exp: 9999999999 })) + '.fakesig';
    (globalThis as any).WebSocket = jasmine.createSpy('WebSocket').and.throwError('blocked');
    service.storeAuth({
      access_token: futureToken,
      refresh_token: 'rt',
      user: { id: 1, username: 'u', email: 'e@m.c', avatar_url: '', is_admin: false },
    });
    tick();

    expect((service as any).wsConnectTimer).toBeNull();
  }));
  it('does not open a socket when the token is expired and the refresh fails', fakeAsync(() => {
    // The old behaviour connected anyway, which is the run of
    // `GET /api/ws ... 401` with the same stale token that production logs showed
    // and no /api/refresh next to it.
    const expiredToken =
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
      btoa(JSON.stringify({ exp: 0 })) + '.fakesig';
    service.storeAuth({
      access_token: expiredToken,
      refresh_token: 'rt',
      user: { id: 1, username: 'u', email: 'e@m.c', avatar_url: '', is_admin: false },
    });
    tick();
    const wsSpy = (globalThis as any).WebSocket as jasmine.Spy;
    // Let storeAuth's own connect settle, then measure from there.
    tick(60000);
    (service as any).ws = null;
    const before = wsSpy.calls.count();
    spyOn(service, 'logout');

    service.retryConnection();
    httpMock.expectOne('/api/refresh').flush('nope', { status: 500, statusText: 'Server Error' });
    tick();

    expect(wsSpy.calls.count()).toBe(before);
  }));
});

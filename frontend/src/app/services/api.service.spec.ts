import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ApiService } from './api.service';

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
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
});

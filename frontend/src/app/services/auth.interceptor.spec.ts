import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { ApiService } from './api.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let router: jasmine.SpyObj<Router>;
  let mockApi: {
    accessToken: ReturnType<typeof signal<string | null>>;
    refreshToken: jasmine.Spy;
    logout: jasmine.Spy;
  };

  beforeEach(() => {
    mockApi = {
      accessToken: signal('test-token'),
      refreshToken: jasmine
        .createSpy('refreshToken')
        .and.returnValue(of({ access_token: 'new-token', refresh_token: 'new-refresh' })),
      logout: jasmine.createSpy('logout'),
    };

    const routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: routerSpy },
        { provide: ApiService, useValue: mockApi },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
    localStorage.clear();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('adds Bearer token to request', () => {
    http.get('/api/test').subscribe();

    const req = httpMock.expectOne('/api/test');
    expect(req.request.headers.get('Authorization')).toBe('Bearer test-token');
    req.flush({});
  });

  it('does not add Bearer token when accessToken is null', () => {
    mockApi.accessToken.set(null);

    http.get('/api/test').subscribe();

    const req = httpMock.expectOne('/api/test');
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });

  it('on 401 calls refreshToken then retries', () => {
    localStorage.setItem('refreshToken', 'old-refresh');

    http.get('/api/test').subscribe();

    const req1 = httpMock.expectOne('/api/test');
    req1.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(mockApi.refreshToken).toHaveBeenCalled();

    const retryReq = httpMock.expectOne('/api/test');
    expect(retryReq.request.headers.get('Authorization')).toBe('Bearer new-token');
    expect(localStorage.getItem('accessToken')).toBe('new-token');
    expect(localStorage.getItem('refreshToken')).toBe('new-refresh');
    expect(mockApi.accessToken()).toBe('new-token');
    retryReq.flush({});
  });

  it('on 401 without refreshToken calls logout and navigates to /login', () => {
    http.get('/api/test').subscribe({
      error: () => {},
    });

    const req = httpMock.expectOne('/api/test');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(mockApi.logout).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('skips 401 for /login', () => {
    http.get('/api/login').subscribe({
      error: () => {},
    });

    const req = httpMock.expectOne('/api/login');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(mockApi.refreshToken).not.toHaveBeenCalled();
    expect(mockApi.logout).not.toHaveBeenCalled();
  });

  it('skips 401 for /register', () => {
    http.post('/api/register', {}).subscribe({
      error: () => {},
    });

    const req = httpMock.expectOne('/api/register');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(mockApi.refreshToken).not.toHaveBeenCalled();
    expect(mockApi.logout).not.toHaveBeenCalled();
  });

  it('skips 401 for /refresh', () => {
    http.post('/api/refresh', {}).subscribe({
      error: () => {},
    });

    const req = httpMock.expectOne('/api/refresh');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(mockApi.refreshToken).not.toHaveBeenCalled();
    expect(mockApi.logout).not.toHaveBeenCalled();
  });

  it('skips 401 for /logout', () => {
    http.post('/api/logout', {}).subscribe({
      error: () => {},
    });

    const req = httpMock.expectOne('/api/logout');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(mockApi.refreshToken).not.toHaveBeenCalled();
    expect(mockApi.logout).not.toHaveBeenCalled();
  });

  it('passes through 5xx errors', () => {
    http.get('/api/test').subscribe({
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(500);
      },
    });

    const req = httpMock.expectOne('/api/test');
    req.flush('Server Error', { status: 500, statusText: 'Internal Server Error' });
  });
});

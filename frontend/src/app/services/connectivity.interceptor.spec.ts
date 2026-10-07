import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ConnectivityService } from './connectivity.service';
import { connectivityInterceptor } from './connectivity.interceptor';

describe('connectivityInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let conn: ConnectivityService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([connectivityInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    conn = TestBed.inject(ConnectivityService);
  });

  afterEach(() => {
    httpMock.match(() => true).forEach((r) => {
      if (!r.cancelled) r.flush({});
    });
    httpMock.verify();
  });

  it('says nothing while every request succeeds', () => {
    // A banner that appears on a healthy network is worse than no banner.
    http.get('/api/feed').subscribe();
    httpMock.expectOne('/api/feed').flush([]);
    expect(conn.problem()).toBeNull();
  });

  it('reports a request that never got an answer', () => {
    http.get('/api/feed').subscribe({ error: () => {} });
    httpMock.expectOne('/api/feed').error(new ProgressEvent('error'));

    expect(conn.problem()?.status).toBe(0);
    expect(conn.problem()?.reason).toContain('Нет связи');
  });

  it('reports a server error differently from a dead connection', () => {
    // "No connection" sends people to look at their Wi-Fi. A 500 is the server's
    // problem and the message has to say so.
    http.get('/api/feed').subscribe({ error: () => {} });
    httpMock.expectOne('/api/feed').flush('boom', { status: 503, statusText: 'Service Unavailable' });

    expect(conn.problem()?.status).toBe(503);
    expect(conn.problem()?.reason).toContain('Сервер отвечает с ошибкой');
  });

  it('stays quiet for an expired session', () => {
    // 401 means log in again. Telling someone there is no connection sends them
    // to debug the wrong thing entirely.
    http.get('/api/feed').subscribe({ error: () => {} });
    httpMock.expectOne('/api/feed').flush('nope', { status: 401, statusText: 'Unauthorized' });

    expect(conn.problem()).toBeNull();
  });

  it('stays quiet for a request that was simply wrong', () => {
    http.get('/api/nope').subscribe({ error: () => {} });
    httpMock.expectOne('/api/nope').flush('nope', { status: 404, statusText: 'Not Found' });

    expect(conn.problem()).toBeNull();
  });

  it('clears the problem once a request succeeds again', () => {
    http.get('/api/feed').subscribe({ error: () => {} });
    httpMock.expectOne('/api/feed').error(new ProgressEvent('error'));
    expect(conn.problem()).not.toBeNull();

    http.get('/api/health').subscribe();
    httpMock.expectOne('/api/health').flush({ status: 'ok' });

    // Leaving it up trains people to ignore it: one success is proof the link works.
    expect(conn.problem()).toBeNull();
  });

  it('still fails the caller - this reports, it does not swallow', () => {
    // tap's error callback observes and rethrows. If it stopped rethrowing, every
    // caller in the app would see its request succeed.
    const seen: number[] = [];
    http.get('/api/feed').subscribe({ error: (e) => seen.push(e.status) });
    httpMock.expectOne('/api/feed').flush('boom', { status: 500, statusText: 'Server Error' });

    expect(seen).toEqual([500]);
  });
});
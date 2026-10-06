import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { fakeAsync, tick } from '@angular/core/testing';

import { timeoutInterceptor, REQUEST_TIMEOUT } from './timeout.interceptor';

/**
 * A request that never gets a reply used to leave the UI spinning forever: on one
 * network the app's calls to /api circled in the network tab while the server never
 * saw them. A failed request can be shown and retried; a hung one cannot.
 */
describe('timeoutInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([timeoutInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Requests the timeout already gave up on are still open in the testing
    // backend - that is the whole point of the interceptor - so they are drained
    // before verify(), which would otherwise report them as unexpected.
    httpMock.match(() => true).forEach((r) => r.flush({}));
    httpMock.verify();
  });

  it('fails a request that gets no reply, instead of waiting forever', fakeAsync(() => {
    let failure: HttpErrorResponse | undefined;
    http.get('/api/feed').subscribe({ error: (e) => (failure = e) });

    // Nothing will answer it. Held so the testing backend can be told the request
    // ended - the point of the timeout is that the client gives up on its own.
    httpMock.expectOne('/api/feed');
    tick(REQUEST_TIMEOUT + 1);

    expect(failure).toBeTruthy();
    expect(failure!.status).toBe(0);
  }));

  it('reports the timeout as a status-0 HttpErrorResponse', fakeAsync(() => {
    // Callers already branch on status, so a timeout that arrived as some other
    // shape would need every one of them changed. 0 is Angular's "no response".
    let failure: HttpErrorResponse | undefined;
    http.get('/api/feed').subscribe({ error: (e) => (failure = e) });

    httpMock.expectOne('/api/feed');
    tick(REQUEST_TIMEOUT + 1);

    expect(failure instanceof HttpErrorResponse).toBeTrue();
    expect(failure!.status).toBe(0);
  }));

  it('leaves a request that answers in time alone', fakeAsync(() => {
    let body: unknown;
    http.get('/api/feed').subscribe((r) => (body = r));

    const req = httpMock.expectOne('/api/feed');
    req.flush([{ id: 1 }]);
    tick(REQUEST_TIMEOUT + 1);

    expect(body).toEqual([{ id: 1 }]);
  }));

  it('does not cut off an upload', fakeAsync(() => {
    // A photo over a slow link can legitimately take minutes. Aborting it would
    // lose the upload rather than report a problem with it.
    let settled = false;
    const form = new FormData();
    form.append('content', 'hi');
    http.post('/api/posts', form).subscribe({ next: () => (settled = true), error: () => (settled = true) });

    tick(REQUEST_TIMEOUT * 3);

    // Still waiting, deliberately: no timeout was applied.
    expect(settled).toBeFalse();
    httpMock.expectOne('/api/posts').flush({ id: 1 });
    expect(settled).toBeTrue();
  }));
});

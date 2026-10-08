import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { fakeAsync, tick } from '@angular/core/testing';

import { timeoutInterceptor, REQUEST_TIMEOUT, REQUEST_RETRY_DELAY } from './timeout.interceptor';

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
    httpMock.match(() => true).forEach((r) => {
      if (!r.cancelled) r.flush({});
    });
    httpMock.verify();
  });

  it('fails a request that gets no reply, instead of waiting forever', fakeAsync(() => {
    let failure: HttpErrorResponse | undefined;
    http.get('/api/feed').subscribe({ error: (e) => (failure = e) });

    // Nothing will answer it. Held so the testing backend can be told the request
    // ended - the point of the timeout is that the client gives up on its own.
    httpMock.expectOne('/api/feed');
    tick(REQUEST_TIMEOUT + 1);
    // One retry follows the first timeout; let it time out too before asserting.
    tick(REQUEST_RETRY_DELAY + REQUEST_TIMEOUT + 1);

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
    tick(REQUEST_RETRY_DELAY + REQUEST_TIMEOUT + 1);

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
  it('retries a timed-out GET once, on a fresh request', fakeAsync(() => {
    // Aborting the stuck request is what makes the browser drop the connection it
    // was blocked on, so the retry has a real chance of going out at all.
    let body: unknown;
    http.get('/api/feed').subscribe({ next: (r) => (body = r), error: () => {} });

    const first = httpMock.expectOne('/api/feed');
    tick(REQUEST_TIMEOUT + 1);

    // A second request, not the same one replayed.
    tick(REQUEST_RETRY_DELAY + 1);
    const second = httpMock.expectOne('/api/feed');
    expect(second).not.toBe(first);

    second.flush([{ id: 7 }]);
    tick();
    expect(body).toEqual([{ id: 7 }]);
  }));

  it('does not retry a POST - it may already have had an effect', fakeAsync(() => {
    // A timed-out POST may still be processing; repeating it would duplicate the
    // message or the post.
    let failed = false;
    http.post('/api/messages', { content: 'hi' }).subscribe({ error: () => (failed = true) });

    httpMock.expectOne('/api/messages');
    tick(REQUEST_TIMEOUT + 1);
    tick(REQUEST_RETRY_DELAY + REQUEST_TIMEOUT + 1);

    expect(failed).toBeTrue();
    // No second request was made: expectOne below would throw if there were two.
    expect(httpMock.match('/api/messages').length).toBe(0);
  }));

  it('retries only once, not in a loop', fakeAsync(() => {
    let failed = false;
    http.get('/api/feed').subscribe({ error: () => (failed = true) });

    httpMock.expectOne('/api/feed');
    tick(REQUEST_TIMEOUT + 1);
    tick(REQUEST_RETRY_DELAY + 1);
    httpMock.expectOne('/api/feed');
    tick(REQUEST_TIMEOUT + 1);
    tick(REQUEST_RETRY_DELAY + REQUEST_TIMEOUT + 1);

    expect(failed).toBeTrue();
    expect(httpMock.match('/api/feed').length).toBe(0);
  }));
  it('retries a timed-out login, so a dropped relay does not lock the user out', fakeAsync(() => {
    // Вход - единственный запрос, из-за которого приложением нельзя пользоваться
    // вообще: подсказки нет, обойти нечем. Повтор делается один раз, и только
    // для таймаута, и только потому что повторный вход просто выдаёт ещё один
    // токен и ничего не создаёт.
    let done = false;
    http.post('/api/login', { username: 'u', password: 'p' }).subscribe({
      next: () => (done = true),
      error: () => {},
    });

    httpMock.expectOne('/api/login');
    tick(REQUEST_TIMEOUT + 1);
    tick(REQUEST_RETRY_DELAY + 1);
    const second = httpMock.expectOne('/api/login');

    second.flush({ access_token: 'at', refresh_token: 'rt' });
    tick();
    expect(done).toBeTrue();
  }));

  it('still refuses to repeat a POST that creates something', fakeAsync(() => {
    // Повтор отправленного сообщения создал бы второе сообщение. Потолок
    // повторов не должен распространяться на это.
    let failed = false;
    http.post('/api/messages', { content: 'hi' }).subscribe({ error: () => (failed = true) });

    httpMock.expectOne('/api/messages');
    tick(REQUEST_TIMEOUT + 1);
    tick(REQUEST_RETRY_DELAY + REQUEST_TIMEOUT + 1);

    expect(failed).toBeTrue();
    expect(httpMock.match('/api/messages').length).toBe(0);
  }));

  it('does not retry a login the server answered - a 401 is an answer', fakeAsync(() => {
    http.post('/api/login', { username: 'u', password: 'p' }).subscribe({ error: () => {} });
    httpMock.expectOne('/api/login').flush('nope', { status: 401, statusText: 'Unauthorized' });

    // Ни одной попытки повторно: неверный пароль не станет верным.
    expect(httpMock.match('/api/login').length).toBe(0);
  }));

  it('waits twelve seconds, not thirty', () => {
    // Тридцать секунд означали минуту ожидания: потолок срабатывал, повтор
    // садился на следующий полный потолок. Новое соединение по LTE стоит
    // 693-2905 мс, то есть двенадцати секунд с большим запасом.
    expect(REQUEST_TIMEOUT).toBe(12000);
    expect(REQUEST_RETRY_DELAY).toBe(1000);
  });

});

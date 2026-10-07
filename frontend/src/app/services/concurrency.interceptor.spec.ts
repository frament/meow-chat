import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { concurrencyInterceptor, MAX_CONCURRENT, resetConcurrency } from './concurrency.interceptor';

/**
 * The settings page asked for eleven things at once. On LTE that turned into
 * eleven requests `blocked` in the browser for ~216 seconds, completing together
 * only when the queue cleared - while the server saw none of them for the whole
 * three and a half minutes. A single request in a private tab went through in
 * 2.7s, so the burst was the trigger.
 */
describe('concurrencyInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    resetConcurrency();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([concurrencyInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.match(() => true).forEach((r) => {
      if (!r.cancelled) r.flush({});
    });
    httpMock.verify();
    resetConcurrency();
  });

  // Note: httpMock.match() *removes* what it matches, so it cannot be used to take
  // a reading twice - the first call already consumed the list. Each assertion
  // below calls it once, or looks for a specific URL.
  it('lets only the cap through at once', fakeAsync(() => {
    const urls = Array.from({ length: MAX_CONCURRENT + 4 }, (_, i) => `/api/x${i}`);
    urls.forEach((u) => http.get(u).subscribe({ error: () => {} }));
    tick();

    // The gate, not the browser, is what holds the rest back now.
    expect(httpMock.match(() => true).length).toBe(MAX_CONCURRENT);
  }));

  it('releases the next one when a slot frees up', fakeAsync(() => {
    const urls = Array.from({ length: MAX_CONCURRENT + 1 }, (_, i) => `/api/x${i}`);
    urls.forEach((u) => http.get(u).subscribe({ error: () => {} }));
    tick();

    const first = httpMock.match(() => true);
    expect(first.length).toBe(MAX_CONCURRENT);

    // The last URL is the one still waiting.
    expect(httpMock.match(`/api/x${MAX_CONCURRENT}`).length).toBe(0);

    first[0].flush({});
    tick();

    // Its slot went to the waiter: the request that was held back has now been
    // sent, which is the whole point of the gate.
    expect(httpMock.match(`/api/x${MAX_CONCURRENT}`).length).toBe(1);
  }));

  it('frees the slot when a request fails, not only when it succeeds', fakeAsync(() => {
    // A gate that only released on success would close for good after the first
    // error, and on a flaky link that is the first thing that happens.
    const urls = Array.from({ length: MAX_CONCURRENT + 1 }, (_, i) => `/api/x${i}`);
    urls.forEach((u) => http.get(u).subscribe({ error: () => {} }));
    tick();

    const open = httpMock.match(() => true);
    open[0].error(new ProgressEvent('error'));
    tick();

    expect(httpMock.match(`/api/x${MAX_CONCURRENT}`).length).toBe(1);
  }));

  it('frees the slot when the caller cancels while waiting', fakeAsync(() => {
    const subs = Array.from({ length: MAX_CONCURRENT + 1 }, (_, i) =>
      http.get(`/api/x${i}`).subscribe({ error: () => {} }));

    tick();
    // Cancel the one that is still waiting its turn, then let a slot go.
    subs[MAX_CONCURRENT].unsubscribe();
    const open = httpMock.match(() => true);
    open.forEach((r) => r.flush({}));
    tick();

    // The cancelled waiter must not have consumed a slot: a new request is still
    // able to go through.
    http.get('/api/after').subscribe({ error: () => {} });
    tick();
    expect(httpMock.match('/api/after').length).toBe(1);
  }));

  it('does not make uploads queue behind the gate', fakeAsync(() => {
    const form = new FormData();
    form.append('content', 'hi');

    Array.from({ length: MAX_CONCURRENT + 2 }, (_, i) => http.get(`/api/x${i}`).subscribe({ error: () => {} }));
    http.post('/api/posts', form).subscribe({ error: () => {} });
    tick();

    // The upload went straight out; it is long by nature and must not wait.
    expect(httpMock.match('/api/posts').length).toBe(1);
  }));
  it('is pinned to the measured limit of the relay, not chosen for looks', () => {
    // Замерено на LTE через релей: залп из трёх доходит целиком, из четырёх -
    // только один, остальные не доходят до хоста вовсе. Остальные тесты этого
    // файла сравнивают с константой, поэтому значение можно было бы поднять
    // обратно, и ни один тест не покраснел бы.
    expect(MAX_CONCURRENT).toBe(2);
  });

});

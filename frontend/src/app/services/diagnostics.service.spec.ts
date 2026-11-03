import { DiagnosticsService } from './diagnostics.service';

/**
 * The ring buffer is the only record of what happened on a phone, so it has to
 * hold the right things and stay bounded. An unbounded one leaks a message per
 * error; a buffer that misses console.error misses the lines that matter.
 */
describe('DiagnosticsService', () => {
  it('collects console errors and warnings, and still prints them', () => {
    const service = new DiagnosticsService();
    service.clear();
    const original = console.error;
    let printed = 0;
    console.error = (...args: unknown[]) => {
      printed++;
      original.apply(console, args);
    };

    try {
      console.error('AppError: HTTP 500', { url: '/api/messages' });
      console.warn('WebSocket error');
    } finally {
      console.error = original;
    }

    const text = service.logs().map((line) => `${line.level}:${line.text}`).join('\n');
    expect(text).withContext('the error line').toContain('AppError: HTTP 500');
    expect(text).withContext('an error is not a warning').toContain('error:AppError: HTTP 500');
    expect(text).toContain('warn:WebSocket error');
    expect(printed).withContext('collecting must not silence the console').toBe(1);
  });

  it('keeps the newest 200 lines and drops the oldest', () => {
    const service = new DiagnosticsService();
    service.clear();

    for (let i = 0; i < 250; i++) service.log('info', `строка ${i}`);

    expect(service.logs().length).toBe(200);
    expect(service.logs()[0].text).withContext('the tail is what survives').toBe('строка 50');
    expect(service.logs()[199].text).toBe('строка 249');
  });

  it('records the last decryption outcome, success or not', () => {
    const service = new DiagnosticsService();

    service.reportDecrypt(false, 'dm');
    expect(service.lastDecrypt()?.ok).toBeFalse();

    service.reportDecrypt(true, 'group');
    expect(service.lastDecrypt()?.ok).toBeTrue();
    expect(service.lastDecrypt()?.kind).toBe('group');
    expect(service.lastDecrypt()?.at).toBeGreaterThan(0);
  });

  it('counts scroll requests, so two in a row are two events', () => {
    const service = new DiagnosticsService();
    const before = service.scrollToBottomRequest();

    service.requestScrollToBottom();
    service.requestScrollToBottom();

    expect(service.scrollToBottomRequest()).toBe(before + 2);
  });
});

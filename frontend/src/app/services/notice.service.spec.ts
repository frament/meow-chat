import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoticeService } from './notice.service';

describe('NoticeService', () => {
  let service: NoticeService;
  let writeText: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(NoticeService);

    writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => service.dismiss());

  it('starts with nothing to show', () => {
    expect(service.message()).toBe('');
    expect(service.kind()).toBe('info');
  });

  it('shows a message and clears it after the timeout', fakeAsync(() => {
    service.show('Скопировано');
    expect(service.message()).toBe('Скопировано');

    tick(2500);
    expect(service.message()).toBe('');
  }));

  it('restarts the timer when a second message replaces the first', fakeAsync(() => {
    service.show('Первое');
    tick(2000);
    service.show('Второе');
    tick(1000);
    // The first timer must not have wiped the second message early.
    expect(service.message()).toBe('Второе');

    tick(1500);
    expect(service.message()).toBe('');
  }));

  it('dismisses on demand', () => {
    service.show('Скопировано');
    service.dismiss();
    expect(service.message()).toBe('');
  });

  it('copy confirms on success', async () => {
    await expectAsync(service.copy('https://example.com/invite')).toBeResolvedTo(true);
    expect(writeText).toHaveBeenCalledWith('https://example.com/invite');
    expect(service.message()).toBe('Скопировано');
    expect(service.kind()).toBe('info');
  });

  it('copy uses the supplied label', async () => {
    await service.copy('https://example.com', 'Ссылка-приглашения скопирована');
    expect(service.message()).toBe('Ссылка-приглашения скопирована');
  });

  it('copy reports failure instead of swallowing it', async () => {
    // The old call sites did .catch(() => {}), so a denied clipboard permission
    // was indistinguishable from a successful copy.
    writeText.and.rejectWith(new Error('denied'));

    await expectAsync(service.copy('https://example.com')).toBeResolvedTo(false);
    expect(service.message()).toBe('Не удалось скопировать');
    expect(service.kind()).toBe('error');
  });

  it('copy of an empty string does nothing at all', async () => {
    await expectAsync(service.copy('')).toBeResolvedTo(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(service.message()).toBe('');
  });
});

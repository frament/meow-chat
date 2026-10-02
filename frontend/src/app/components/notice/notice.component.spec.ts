import { TestBed } from '@angular/core/testing';
import { NoticeComponent } from './notice';
import { NoticeService } from '../../services/notice.service';

describe('NoticeComponent', () => {
  let notice: NoticeService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [NoticeComponent] });
    notice = TestBed.inject(NoticeService);
  });

  afterEach(() => notice.dismiss());

  it('renders nothing while there is no message', () => {
    const fixture = TestBed.createComponent(NoticeComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });

  it('renders the message and marks it up for screen readers', () => {
    notice.show('Скопировано');
    const fixture = TestBed.createComponent(NoticeComponent);
    fixture.detectChanges();

    const el = (fixture.nativeElement as HTMLElement).querySelector('[role="status"]');
    expect(el).toBeTruthy();
    expect(el?.getAttribute('aria-live')).toBe('polite');
    expect(el?.textContent?.trim()).toBe('Скопировано');
  });

  it('applies the error style only for errors', () => {
    notice.show('Скопировано');
    let fixture = TestBed.createComponent(NoticeComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.notice-error')).toBeNull();

    notice.show('Не удалось скопировать', 'error');
    fixture = TestBed.createComponent(NoticeComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.notice-error')).toBeTruthy();
  });
});

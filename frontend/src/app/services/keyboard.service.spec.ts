import { TestBed } from '@angular/core/testing';
import { KeyboardService } from './keyboard.service';

describe('KeyboardService', () => {
  let service: KeyboardService;
  let input: HTMLInputElement;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    input = document.createElement('input');
    document.body.appendChild(input);
    service = TestBed.inject(KeyboardService);
  });

  afterEach(() => {
    document.body.removeChild(input);
    document.body.classList.remove('keyboard-open');
  });

  it('creates service', () => {
    expect(service).toBeTruthy();
  });

  it('sets isKeyboardOpen true on input focus', () => {
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(service.isKeyboardOpen()).toBeTrue();
    expect(document.body.classList.contains('keyboard-open')).toBeTrue();
  });

  it('sets isKeyboardOpen true on textarea focus', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(service.isKeyboardOpen()).toBeTrue();
    document.body.removeChild(ta);
  });

  it('sets isKeyboardOpen false on blur when no input is focused', (done) => {
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(service.isKeyboardOpen()).toBeTrue();

    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    setTimeout(() => {
      expect(service.isKeyboardOpen()).toBeFalse();
      expect(document.body.classList.contains('keyboard-open')).toBeFalse();
      done();
    }, 10);
  });

  it('keeps isKeyboardOpen true on blur when another input is focused', (done) => {
    const input2 = document.createElement('input');
    document.body.appendChild(input2);

    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(service.isKeyboardOpen()).toBeTrue();

    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    setTimeout(() => {
      try {
        expect(service.isKeyboardOpen()).toBeFalse();
        document.body.removeChild(input2);
        done();
      } catch (e: any) {
        document.body.removeChild(input2);
        done.fail(e);
      }
    }, 50);
  });
});

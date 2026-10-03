import { TestBed } from '@angular/core/testing';

import { KeyboardService } from './keyboard.service';

/**
 * KeyboardService decides two things: it grows the phone chat pane (mobileChatHeight)
 * and hides the bottom navigation (`body.keyboard-open .bottom-nav`). Both exist
 * because the on-screen keyboard covers the bottom of the layout viewport - without
 * them the last messages and the input end up underneath it.
 *
 * So "did focus actually register" is worth pinning down: it is the difference
 * between the pane growing when the keyboard opens and messages sliding under it.
 */
describe('KeyboardService', () => {
  let service: KeyboardService;
  let input: HTMLInputElement;

  beforeEach(() => {
    // The service registers document-level focus listeners in its constructor,
    // and it only gets constructed once something asks for it.
    service = TestBed.inject(KeyboardService);
    input = document.createElement('input');
    document.body.appendChild(input);
  });

  afterEach(() => {
    input.remove();
    document.body.classList.remove('keyboard-open');
  });

  it('reports the keyboard as open when a text field takes focus', () => {
    expect(service.isKeyboardOpen()).toBe(false);

    input.focus();

    expect(service.isKeyboardOpen()).toBe(true);
    expect(document.body.classList.contains('keyboard-open')).toBe(true);
  });

  it('treats a textarea the same as an input', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    textarea.focus();
    expect(service.isKeyboardOpen()).toBe(true);

    textarea.remove();
  });

  it('ignores focus on anything that cannot open a keyboard', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);

    button.focus();

    expect(service.isKeyboardOpen()).toBe(false);
    expect(document.body.classList.contains('keyboard-open')).toBe(false);
    button.remove();
  });

  it('closes only after focus leaves the field for good', () => {
    input.focus();
    expect(service.isKeyboardOpen()).toBe(true);

    // Handing focus from one field to another must not close it - that is a tap
    // from the input to the "Aa" font button, and the keyboard stays up.
    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();

    expect(service.isKeyboardOpen()).toBe(true);
    expect(document.body.classList.contains('keyboard-open')).toBe(true);
    other.remove();
  });

  it('closes when focus leaves the field entirely', done => {
    input.focus();
    expect(service.isKeyboardOpen()).toBe(true);

    input.blur();
    // The close is deferred by a macrotask so the blur/focus pair settles first.
    setTimeout(() => {
      expect(service.isKeyboardOpen()).toBe(false);
      expect(document.body.classList.contains('keyboard-open')).toBe(false);
      done();
    }, 1);
  });
});

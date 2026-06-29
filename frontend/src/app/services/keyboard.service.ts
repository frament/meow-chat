import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class KeyboardService {
  readonly isKeyboardOpen = signal(false);

  constructor() {
    if (typeof document === 'undefined') return;
    document.addEventListener('focusin', (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        this.isKeyboardOpen.set(true);
        document.body.classList.add('keyboard-open');
      }
    });
    document.addEventListener('focusout', (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        setTimeout(() => {
          const active = document.activeElement;
          if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) {
            this.isKeyboardOpen.set(false);
            document.body.classList.remove('keyboard-open');
          }
        }, 0);
      }
    });
  }
}

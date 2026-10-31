import { Injectable, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class KeyboardService {
  readonly isKeyboardOpen = signal(false);

  constructor() {
    if (typeof document === 'undefined') return;

    // A screen change means the field is gone, keyboard or not. Without this the
    // flag survived the login form: the password input is removed from the DOM
    // rather than blurred, so focusout never fired, body.keyboard-open stayed,
    // and its rule `display:none` hid the bottom navigation until the app was
    // restarted. Reported 2026-10-31 as "после входа нет нижней панели".
    //
    // Optional: unit tests build this service without a router.
    inject(Router, { optional: true })?.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.clear());

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

  private clear(): void {
    this.isKeyboardOpen.set(false);
    document.body.classList.remove('keyboard-open');
  }
}

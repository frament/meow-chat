import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  readonly canInstall = signal(false);
  #prompt: any = null;
  #dismissed = localStorage.getItem('installDismissed') === 'true';

  constructor() {
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      this.#prompt = e;
      if (!this.#dismissed) {
        this.canInstall.set(true);
      }
    });
    window.addEventListener('appinstalled', () => {
      this.canInstall.set(false);
      this.#prompt = null;
      localStorage.removeItem('installDismissed');
      this.#dismissed = false;
    });
  }

  get isStandalone(): boolean {
    return (window.matchMedia?.('(display-mode: standalone)').matches) ||
      (navigator as any).standalone === true;
  }

  get isIos(): boolean {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  get canPrompt(): boolean {
    return !!this.#prompt;
  }

  install(): Promise<boolean> {
    const p = this.#prompt;
    if (!p) return Promise.resolve(false);
    p.prompt();
    return p.userChoice.then((r: any) => {
      const ok = r?.outcome === 'accepted';
      this.canInstall.set(false);
      this.#prompt = null;
      if (ok) {
        localStorage.removeItem('installDismissed');
        this.#dismissed = false;
      }
      return ok;
    });
  }

  dismiss() {
    this.canInstall.set(false);
    this.#prompt = null;
    localStorage.setItem('installDismissed', 'true');
    this.#dismissed = true;
  }
}

import { Injectable, Renderer2, RendererFactory2 } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private renderer: Renderer2;
  private mediaQuery: MediaQueryList;
  private systemDark = false;
  private themeListeners: (() => void)[] = [];

  constructor(rendererFactory: RendererFactory2) {
    this.renderer = rendererFactory.createRenderer(null, null);

    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.systemDark = this.mediaQuery.matches;

    this.mediaQuery.addEventListener('change', (e) => {
      this.systemDark = e.matches;
      if (this.getStoredMode() === 'system') {
        this.applyThemeClass();
      }
    });

    this.applyStoredTheme();
  }

  private getStoredMode(): ThemeMode {
    return (localStorage.getItem('theme') as ThemeMode) || 'light';
  }

  get currentMode(): ThemeMode {
    return this.getStoredMode();
  }

  get resolvedTheme(): 'light' | 'dark' {
    const mode = this.getStoredMode();
    if (mode === 'system') return this.systemDark ? 'dark' : 'light';
    return mode;
  }

  private applyThemeClass() {
    const theme = this.resolvedTheme;
    this.renderer.removeClass(document.documentElement, 'theme-light');
    this.renderer.removeClass(document.documentElement, 'theme-dark');
    this.renderer.addClass(document.documentElement, `theme-${theme}`);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'dark' ? '#151210' : '#f5f0eb');
    }
  }

  applyStoredTheme() {
    this.applyThemeClass();
  }

  setTheme(mode: ThemeMode) {
    localStorage.setItem('theme', mode);
    this.applyThemeClass();
    this.notify();
  }

  private notify() {
    for (const fn of this.themeListeners) fn();
  }

  onChange(fn: () => void) {
    this.themeListeners.push(fn);
  }
}

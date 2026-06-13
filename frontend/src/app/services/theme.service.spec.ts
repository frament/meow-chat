import { TestBed } from '@angular/core/testing';
import { Renderer2, RendererFactory2 } from '@angular/core';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  let service: ThemeService;
  let rendererSpy: jasmine.SpyObj<Renderer2>;
  let matchMediaSpy: jasmine.SpyObj<MediaQueryList>;
  let mediaChangeHandler: EventListener;
  let prefersDark: boolean;

  function setPrefersDark(v: boolean) {
    prefersDark = v;
  }

  beforeEach(() => {
    localStorage.clear();
    prefersDark = false;

    rendererSpy = jasmine.createSpyObj('Renderer2', ['addClass', 'removeClass']);

    mediaChangeHandler = () => {};
    matchMediaSpy = jasmine.createSpyObj('MediaQueryList', [
      'addEventListener',
      'removeEventListener',
    ]);
    Object.defineProperty(matchMediaSpy, 'matches', {
      get: () => prefersDark,
      configurable: true,
    });
    matchMediaSpy.addEventListener.and.callFake(
      (_event: string, handler: EventListener) => {
        mediaChangeHandler = handler;
      },
    );

    spyOn(window, 'matchMedia').and.returnValue(matchMediaSpy);

    const rendererFactorySpy = jasmine.createSpyObj('RendererFactory2', [
      'createRenderer',
    ]);
    rendererFactorySpy.createRenderer.and.returnValue(rendererSpy);

    TestBed.configureTestingModule({
      providers: [
        ThemeService,
        { provide: RendererFactory2, useValue: rendererFactorySpy },
      ],
    });

    service = TestBed.inject(ThemeService);
  });

  it('should default to light theme', () => {
    expect(service.currentMode).toBe('light');
    expect(service.resolvedTheme).toBe('light');
  });

  it('setTheme("dark") should store and apply dark theme', () => {
    service.setTheme('dark');

    expect(localStorage.getItem('theme')).toBe('dark');
    expect(service.resolvedTheme).toBe('dark');
    expect(rendererSpy.removeClass).toHaveBeenCalledWith(
      document.documentElement,
      'theme-light',
    );
    expect(rendererSpy.addClass).toHaveBeenCalledWith(
      document.documentElement,
      'theme-dark',
    );
  });

  it('setTheme("light") should store and apply light theme', () => {
    service.setTheme('light');

    expect(localStorage.getItem('theme')).toBe('light');
    expect(service.resolvedTheme).toBe('light');
    expect(rendererSpy.removeClass).toHaveBeenCalledWith(
      document.documentElement,
      'theme-dark',
    );
    expect(rendererSpy.addClass).toHaveBeenCalledWith(
      document.documentElement,
      'theme-light',
    );
  });

  it('setTheme("system") should follow light system preference', () => {
    setPrefersDark(false);
    service.setTheme('system');

    expect(localStorage.getItem('theme')).toBe('system');
    expect(service.resolvedTheme).toBe('light');
    expect(rendererSpy.addClass).toHaveBeenCalledWith(
      document.documentElement,
      'theme-light',
    );
  });

  it('setTheme("system") should follow dark system preference', () => {
    setPrefersDark(true);
    mediaChangeHandler({ matches: true } as MediaQueryListEvent);
    service.setTheme('system');

    expect(localStorage.getItem('theme')).toBe('system');
    expect(service.resolvedTheme).toBe('dark');
    expect(rendererSpy.addClass).toHaveBeenCalledWith(
      document.documentElement,
      'theme-dark',
    );
  });

  it('should toggle html class when theme changes', () => {
    service.setTheme('dark');
    expect(rendererSpy.removeClass).toHaveBeenCalledWith(
      document.documentElement,
      'theme-light',
    );
    expect(rendererSpy.addClass).toHaveBeenCalledWith(
      document.documentElement,
      'theme-dark',
    );

    service.setTheme('light');
    expect(rendererSpy.removeClass).toHaveBeenCalledWith(
      document.documentElement,
      'theme-dark',
    );
    expect(rendererSpy.addClass).toHaveBeenCalledWith(
      document.documentElement,
      'theme-light',
    );
  });

  it('should notify onChange listeners', () => {
    const listener = jasmine.createSpy('listener');
    service.onChange(listener);

    service.setTheme('dark');
    expect(listener).toHaveBeenCalled();
  });

  it('should respond to media query change event in system mode', () => {
    service.setTheme('system');

    mediaChangeHandler({ matches: true } as MediaQueryListEvent);
    expect(service.resolvedTheme).toBe('dark');

    mediaChangeHandler({ matches: false } as MediaQueryListEvent);
    expect(service.resolvedTheme).toBe('light');
  });
});

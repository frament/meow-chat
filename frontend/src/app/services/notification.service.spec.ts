import { TestBed } from '@angular/core/testing';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockNotifCalls: Array<{ title: string; options: NotificationOptions }>;
  let MockNotification: {
    (title: string, options?: NotificationOptions): void;
    permission: NotificationPermission;
    requestPermission: jasmine.Spy;
  };
  let origNotification: any;

  beforeAll(() => {
    origNotification = (window as any).Notification;
  });

  afterAll(() => {
    (window as any).Notification = origNotification;
  });

  beforeEach(() => {
    mockNotifCalls = [];
    MockNotification = function MockNotification(
      this: any,
      title: string,
      options?: NotificationOptions,
    ) {
      mockNotifCalls.push({ title, options: options || {} });
    } as any;
    MockNotification.permission = 'default';
    MockNotification.requestPermission = jasmine.createSpy('requestPermission');
    (window as any).Notification = MockNotification;

    TestBed.configureTestingModule({});
    service = TestBed.inject(NotificationService);
  });

  afterEach(() => {
    try {
      delete (document as any).hidden;
    } catch {
      /* ignore */
    }
  });

  it('should request permission when status is default', async () => {
    MockNotification.requestPermission.and.resolveTo('granted');
    const result = await service.requestPermission();
    expect(result).toBeTrue();
    expect(MockNotification.requestPermission).toHaveBeenCalled();
  });

  it('should return true without calling API when permission already granted', async () => {
    MockNotification.permission = 'granted';
    const result = await service.requestPermission();
    expect(result).toBeTrue();
    expect(MockNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('should return false without calling API when permission denied', async () => {
    MockNotification.permission = 'denied';
    const result = await service.requestPermission();
    expect(result).toBeFalse();
    expect(MockNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('show() should create a Notification with correct title and body', () => {
    MockNotification.permission = 'granted';
    service.show('Hello', { body: 'World' });
    expect(mockNotifCalls.length).toBe(1);
    expect(mockNotifCalls[0].title).toBe('Hello');
    expect(mockNotifCalls[0].options.body).toBe('World');
    expect(mockNotifCalls[0].options.silent).toBeTrue();
  });

  it('show() should return null when permission is denied', () => {
    MockNotification.permission = 'denied';
    const result = service.show('Test', { body: 'Test' });
    expect(result).toBeNull();
    expect(mockNotifCalls.length).toBe(0);
  });

  it('should track tab visibility via visibilitychange event', () => {
    expect(service.isTabHidden).toBeFalse();

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(service.isTabHidden).toBeTrue();

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(service.isTabHidden).toBeFalse();
  });

  it('should set tabHidden on window blur', () => {
    window.dispatchEvent(new Event('blur'));
    expect(service.isTabHidden).toBeTrue();
  });

  it('should clear tabHidden on window focus', () => {
    window.dispatchEvent(new Event('blur'));
    expect(service.isTabHidden).toBeTrue();

    window.dispatchEvent(new Event('focus'));
    expect(service.isTabHidden).toBeFalse();
  });
});

import { Component, inject, signal, ViewChild, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { SwUpdate, SwPush } from '@angular/service-worker';
import { interval, fromEvent, filter, tap, map, switchMap, Subscription } from 'rxjs';
import { ApiService } from './services/api.service';
import { NotificationService } from './services/notification.service';
import { ThemeService } from './services/theme.service';
import { CryptoService } from './services/crypto.service';
import { DeviceAuthComponent } from './components/device-auth/device-auth';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, DeviceAuthComponent],
  template: `
    @if (gitHubUpdateAvailable()) {
      <div class="update-banner" style="background:var(--accent-gradient);">
        <span>Доступна новая версия {{ gitHubLatestVersion() }}</span>
        <a [href]="gitHubDownloadUrl()" target="_blank" rel="noopener noreferrer" style="background:#fff;color:var(--accent);border:none;border-radius:6px;padding:4px 12px;font-weight:600;cursor:pointer;text-decoration:none;font-size:14px;">Скачать</a>
        <button (click)="dismissGitHubUpdate()" style="background:transparent;border:none;color:rgba(255,255,255,0.7);cursor:pointer;font-size:16px;padding:0 4px;">✕</button>
      </div>
    }
    @if (updateAvailable()) {
      <div class="update-banner">
        <span>Доступна новая версия</span>
        <button (click)="applyUpdate()">Обновить</button>
      </div>
    }
    @if (toast(); as t) {
      <div class="toast" (click)="openChat(t.from)">
        <div class="toast-avatar"><span>{{ t.from_name[0] }}</span></div>
        <div class="toast-body">
          <strong>{{ t.from_name }}</strong>
          <span>{{ t.body }}</span>
        </div>
      </div>
    }
    @if (canInstall()) {
      <div class="install-banner">
        <span>Установите MeowChat на устройство</span>
        <button (click)="installApp()">Установить</button>
        <button class="dismiss" (click)="dismissInstall()">✕</button>
      </div>
    }
    @if (maintenanceMode()) {
      <div style="position:fixed;inset:0;z-index:99999;background:var(--bg-body);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;">
        <div style="width:48px;height:48px;border:4px solid var(--border-default);border-top-color:var(--accent);border-radius:50%;animation:spin 1s linear infinite;"></div>
        <p style="font-size:18px;font-weight:600;color:var(--text-primary);">Сервер восстанавливается...</p>
        <p style="font-size:14px;color:var(--text-secondary);">Это может занять несколько минут</p>
      </div>
    }
    @if (!api.wsConnected() && api.currentUser() && !offlineDismissed) {
      <div class="offline-banner">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
        <span>Нет соединения</span>
        <button class="reconnect-btn" (click)="api.retryConnection()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Подключиться
        </button>
        <button class="offline-dismiss" (click)="dismissOffline()">✕</button>
      </div>
    }
    @if (pullDistance() > 0) {
      <div class="pull-indicator" [style.top.px]="pullDistance() / 2 - 60">
        <div class="pull-spinner" [class.pull-ready]="pullReady()">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </div>
        <span>{{ pullReady() ? 'Отпустите для подключения' : 'Потяните для подключения' }}</span>
      </div>
    }
    <app-device-auth #deviceAuth />
    <router-outlet />
  `,
  styles: [`
    @keyframes spin { to { transform: rotate(360deg); } }
    .update-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: calc(10px + env(safe-area-inset-top, 0px)) 16px 10px;
      background: #1d4ed8;
      color: #fff;
      font-size: 14px;
    }
    .update-banner button {
      background: #fff;
      color: #1d4ed8;
      border: none;
      border-radius: 6px;
      padding: 4px 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .toast {
      position: fixed;
      top: 16px;
      left: 16px;
      right: 16px;
      z-index: 10000;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      background: var(--bg-surface);
      color: var(--text-primary);
      border: 1px solid var(--border-default);
      border-radius: 14px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.15);
      cursor: pointer;
      animation: slideIn 0.3s ease;
      max-width: 400px;
      margin: 0 auto;
    }
    .toast-avatar {
      width: 36px; height: 36px;
      border-radius: 50%;
      background: var(--accent-gradient);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .toast-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow: hidden;
    }
    .toast-body strong {
      font-size: 13px;
    }
    .toast-body span {
      font-size: 12px;
      opacity: 0.7;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .install-banner {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 9998;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom, 0px));
      background: var(--bg-surface);
      color: var(--text-primary);
      border-top: 1px solid var(--border-default);
      font-size: 14px;
      animation: slideUp 0.3s ease;
    }
    .install-banner button {
      background: var(--accent-gradient);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 6px 16px;
      font-weight: 600;
      cursor: pointer;
      flex-shrink: 0;
    }
    .install-banner .dismiss {
      background: transparent;
      color: var(--text-tertiary);
      padding: 4px 8px;
      font-size: 16px;
    }
    .install-banner span {
      flex: 1;
    }
    @keyframes slideUp {
      from { transform: translateY(100%); }
      to { transform: translateY(0); }
    }
    @keyframes slideIn {
      from { transform: translateY(-20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .offline-banner {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 9997;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
      background: var(--bg-surface);
      border-top: 1px solid var(--border-default);
      font-size: 13px;
      color: var(--text-secondary);
      animation: slideUp 0.3s ease;
    }
    .offline-banner button.reconnect-btn {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 4px;
      background: var(--accent-gradient);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      flex-shrink: 0;
    }
    .offline-banner .offline-dismiss {
      background: transparent;
      border: none;
      color: var(--text-tertiary);
      cursor: pointer;
      padding: 4px;
      font-size: 14px;
      flex-shrink: 0;
    }
    .pull-indicator {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: calc(20px + env(safe-area-inset-top, 0px)) 0 12px;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-default);
      color: var(--text-secondary);
      font-size: 12px;
      transition: none;
    }
    .pull-spinner {
      width: 32px; height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: var(--bg-body);
      border: 2px solid var(--border-default);
      color: var(--text-tertiary);
      transition: background 0.2s, border-color 0.2s, color 0.2s;
    }
    .pull-spinner.pull-ready {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
  `],
})
export class App implements OnInit, OnDestroy {
  readonly #sw = inject(SwUpdate);
  readonly #swPush = inject(SwPush);
  readonly #api = inject(ApiService);
  readonly #notif = inject(NotificationService);
  readonly #router = inject(Router);
  readonly #theme = inject(ThemeService);
  readonly #crypto = inject(CryptoService);
  readonly updateAvailable = signal(false);
  readonly toast = signal<{ from: number; from_name: string; body: string } | null>(null);
  readonly canInstall = signal(false);
  readonly #sub = new Subscription();
  readonly maintenanceMode = signal(false);
  readonly pullDistance = signal(0);
  readonly pullReady = signal(false);
  readonly gitHubUpdateAvailable = signal(false);
  readonly gitHubLatestVersion = signal('');
  readonly gitHubDownloadUrl = signal('');
  #maintenanceSub: Subscription | null = null;
  #toastTimer: ReturnType<typeof setTimeout> | null = null;
  #badgeCount = 0;
  #deviceAuthInitDone = false;
  #installPrompt: any = null;
  #pullStartY = 0;
  #pulling = false;
  #offlineDismissed = false;
  #gitHubDismissed = false;
  @ViewChild('deviceAuth') deviceAuth!: DeviceAuthComponent;

  constructor() {
    // PWA install prompt
    const wasDismissed = localStorage.getItem('installDismissed') === 'true';
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      this.#installPrompt = e;
      if (!wasDismissed) {
        this.canInstall.set(true);
      }
    });
    window.addEventListener('appinstalled', () => {
      this.canInstall.set(false);
      this.#installPrompt = null;
      localStorage.removeItem('installDismissed');
    });

    // Listen for push subscription change from service worker
    navigator.serviceWorker?.addEventListener('message', (event) => {
      if (event.data?.type === 'push-subscription-changed') {
        this.tryReSubscribePush();
      }
    });

    if (this.#sw.isEnabled) {
      this.#sw.versionUpdates
        .pipe(filter(evt => evt.type === 'VERSION_READY'))
        .subscribe(() => this.updateAvailable.set(true));

      this.#sub.add(
        fromEvent(window, 'focus').subscribe(() => {
          this.#sw.checkForUpdate();
          this.#clearBadge();
          this.tryReSubscribePush();
        })
      );

      this.#sub.add(
        interval(30 * 60 * 1000)
          .pipe(tap(() => this.#sw.checkForUpdate()))
          .subscribe()
      );
    }

    // Periodic GitHub update check (only for logged-in users, once per 6 hours)
    this.#sub.add(
      interval(6 * 60 * 60 * 1000).pipe(
        filter(() => this.#api.currentUser() !== null)
      ).subscribe(() => this.checkGitHubUpdate())
    );

    // Check on focus as well
    this.#sub.add(
      fromEvent(window, 'focus').pipe(
        filter(() => this.#api.currentUser() !== null)
      ).subscribe(() => this.checkGitHubUpdate())
    );
  }

  private checkedGitHubUpdate = false;

  private checkGitHubUpdate() {
    if (this.#gitHubDismissed) return;
    this.#api.checkUpdate().subscribe({
      next: (res) => {
        if (res.update_available && !this.checkedGitHubUpdate) {
          this.checkedGitHubUpdate = true;
          this.gitHubUpdateAvailable.set(true);
          this.gitHubLatestVersion.set(res.latest_version || '');
          this.gitHubDownloadUrl.set(res.download_url || '');
        }
      },
    });
  }

  dismissGitHubUpdate() {
    this.gitHubUpdateAvailable.set(false);
    this.#gitHubDismissed = true;
  }

  ngOnInit() {
    if (this.#api.currentUser()) {
      this.#api.connectWebSocket();
      this.#crypto.init().then(() => {
        this.#crypto.syncPublicKey();
        this.checkDeviceAuth();
      });
    }
    this.#notif.requestPermission();

    this.#sub.add(
      this.#router.events.subscribe(() => {
        if (this.#router.url.startsWith('/chat')) {
          this.#clearBadge();
          const m = this.#router.url.match(/\/chat\/(\d+)/);
          if (m) this.#api.clearUnread(Number(m[1]));
        }
      })
    );

    this.#sub.add(
      this.#api.wsMessages$.subscribe((msg: any) => {
        if (msg.type === 'device_auth_request') {
          if (this.deviceAuth) {
            this.deviceAuth.showIncomingRequest(msg);
          }
          return;
        }

        const isHidden = document.hidden;
        const isGroup = msg.type === 'group_message';
        const chatPath = isGroup ? `/chat/group/${msg.group_id}` : `/chat/${msg.from}`;
        const isCorrectChat = this.#router.url.startsWith(chatPath);
        if (isHidden || !isCorrectChat) {
          if (!isGroup) {
            this.#api.incrementUnread(msg.from, msg.created_at);
          }
          const notifTitle = isGroup
            ? `New message in group`
            : `New message from ${msg.from_name || 'Someone'}`;
          const notifBody = msg.content
            || (msg.msg_type === 'image' || msg.images?.length ? '[Image]' : '')
            || (msg.msg_type === 'sticker' ? '[Sticker]' : '')
            || (msg.msg_type === 'gif' ? '[GIF]' : '')
            || (msg.msg_type === 'poll' ? '[Poll]' : '')
            || '';
          const n = this.#notif.show(notifTitle, {
            body: notifBody,
            icon: '/favicon.png',
            tag: isGroup ? `group-${msg.group_id}` : `chat-${msg.from}`,
            data: { url: chatPath, senderId: msg.from, groupId: msg.group_id },
          });
          this.#badgeCount++;
          this.#setBadge(this.#badgeCount);

          if (n) {
            n.onclick = () => {
              this.#clearBadge();
              window.focus();
              if (isGroup) {
                this.#router.navigate(['/chat/group', msg.group_id]);
              } else {
                this.#router.navigate(['/chat', msg.from]);
                this.#api.clearUnread(msg.from);
              }
              n.close();
            };
          } else if (!document.hidden) {
            if (this.#toastTimer) clearTimeout(this.#toastTimer);
            const toastBody = msg.content
              || (msg.msg_type === 'image' || msg.images?.length ? '[Image]' : '')
              || (msg.msg_type === 'sticker' ? '[Sticker]' : '')
              || (msg.msg_type === 'gif' ? '[GIF]' : '')
              || (msg.msg_type === 'poll' ? '[Poll]' : '')
              || '';
            this.toast.set({
              from: msg.from,
              from_name: isGroup ? `Group: ${msg.from_name}` : (msg.from_name || 'Someone'),
              body: toastBody,
            });
            this.#toastTimer = setTimeout(() => this.toast.set(null), 4000);
          }
        }
      })
    );

    this.#maintenanceSub = interval(3000)
      .pipe(
        filter(() => this.#api.currentUser() !== null),
        switchMap(() => this.#api.checkHealth()),
        map(res => res.status === 'maintenance')
      )
      .subscribe(isMaintenance => {
        if (isMaintenance && !this.maintenanceMode()) {
          this.maintenanceMode.set(true);
        } else if (!isMaintenance && this.maintenanceMode()) {
          location.reload();
        }
      });

    this.tryReSubscribePush();

    // Pull-to-refresh for reconnection
    this.#sub.add(
      fromEvent<TouchEvent>(document, 'touchstart').subscribe(e => this.#onTouchStart(e))
    );
    this.#sub.add(
      fromEvent<TouchEvent>(document, 'touchmove', { passive: false }).subscribe(e => this.#onTouchMove(e))
    );
    this.#sub.add(
      fromEvent<TouchEvent>(document, 'touchend').subscribe(() => this.#onTouchEnd())
    );
  }

  private async tryReSubscribePush(): Promise<void> {
    if (!this.#swPush.isEnabled) return;

    try {
      const reg = await navigator.serviceWorker.ready;
      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        // Already subscribed — re-register on server (INSERT OR IGNORE)
        this.#api.pushSubscribe(existingSub.toJSON()).subscribe();
        return;
      }
    } catch {
      // Service worker not ready yet
    }

    // No valid subscription — request a new one (may prompt on first time)
    this.#api.getVapidPublicKey().subscribe({
      next: (keys) => {
        this.#swPush.requestSubscription({ serverPublicKey: keys.publicKey })
          .then(sub => this.#api.pushSubscribe(sub.toJSON()).subscribe())
          .catch(() => {});
      },
    });
  }

  ngOnDestroy() {
    this.#sub.unsubscribe();
    this.#maintenanceSub?.unsubscribe();
  }

  installApp() {
    if (this.#installPrompt) {
      this.#installPrompt.prompt();
      this.#installPrompt.userChoice.then((result: any) => {
        if (result.outcome === 'accepted') {
          this.canInstall.set(false);
          localStorage.removeItem('installDismissed');
        }
        this.#installPrompt = null;
      });
    }
  }

  dismissInstall() {
    this.canInstall.set(false);
    this.#installPrompt = null;
    localStorage.setItem('installDismissed', 'true');
  }

  openChat(userId: number) {
    this.#clearBadge();
    this.toast.set(null);
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
    this.#router.navigate(['/chat', userId]);
  }

  async #setBadge(count: number): Promise<void> {
    try {
      if ('setAppBadge' in navigator) {
        await (navigator as any).setAppBadge(count);
      }
    } catch {}
  }

  async #clearBadge(): Promise<void> {
    this.#badgeCount = 0;
    try {
      if ('clearAppBadge' in navigator) {
        await (navigator as any).clearAppBadge();
      }
    } catch {}
  }

  private async checkDeviceAuth() {
    if (this.#deviceAuthInitDone) return;
    this.#deviceAuthInitDone = true;
    const hasIdentity = await this.#crypto.hasIdentityKey();
    if (!hasIdentity && this.deviceAuth) {
      // Ensure device keypair exists first
      await this.#crypto.ensureDeviceKeyPair();
      // Register device on server
      const pubKey = await this.#crypto.getDevicePublicKeySPKI();
      this.#api.registerDevice(
        navigator.platform || 'Unknown device',
        pubKey,
        this.#crypto.deviceId,
      ).subscribe();
      // Start auth request flow
      this.deviceAuth.startNewDeviceFlow();
    }
  }

  get api() { return this.#api; }
  get offlineDismissed() { return this.#offlineDismissed; }

  dismissOffline() {
    this.#offlineDismissed = true;
  }

  #onTouchStart(e: TouchEvent): void {
    if (this.#api.wsConnected() || !this.#api.currentUser() || this.#offlineDismissed) return;
    if (window.scrollY > 0) return;
    this.#pullStartY = e.touches[0].clientY;
    this.#pulling = true;
  }

  #onTouchMove(e: TouchEvent): void {
    if (!this.#pulling) return;
    const dy = e.touches[0].clientY - this.#pullStartY;
    if (dy < 0) { this.#endPull(); return; }
    e.preventDefault();
    this.pullDistance.set(dy);
    this.pullReady.set(dy >= 80);
  }

  #onTouchEnd(): void {
    if (!this.#pulling) return;
    if (this.pullReady()) {
      this.#api.retryConnection();
    }
    this.#endPull();
  }

  #endPull(): void {
    this.#pulling = false;
    this.pullDistance.set(0);
    this.pullReady.set(false);
  }

  applyUpdate() {
    this.#sw.activateUpdate().then(() => document.location.reload());
  }
}

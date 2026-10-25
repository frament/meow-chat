import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { NotificationService } from '../../services/notification.service';
import { ServerCryptoService } from '../../services/server-crypto.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="min-h-screen flex items-center justify-center px-4" style="background:var(--bg-body);">
      <div class="card" style="padding:24px 28px;width:100%;max-width:400px;">
        <h1 class="text-2xl font-bold text-center mb-6" style="color:var(--text-primary);">Вход</h1>
        <form (ngSubmit)="onSubmit()" class="space-y-4">
          <div>
            <label class="block text-sm font-medium" style="color:var(--text-secondary);">Имя пользователя</label>
            <input type="text" [(ngModel)]="username" name="username" required class="form-input mt-1" (input)="checkBiometric()">
          </div>
          <div>
            <label class="block text-sm font-medium" style="color:var(--text-secondary);">Пароль</label>
            <input type="password" [(ngModel)]="password" name="password" required class="form-input mt-1">
          </div>
          <button type="submit" class="btn-primary" style="width:100%;padding:10px 20px;"
            [disabled]="submitting">
            {{ submitting ? 'Вход...' : 'Войти' }}
          </button>
        </form>
        @if (hasBiometric) {
          <button type="button" (click)="biometricLogin()" [disabled]="biometricLoading"
            class="btn-secondary" style="width:100%;margin-top:8px;padding:10px 20px;display:flex;align-items:center;justify-content:center;gap:8px;">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 1.104-.896 2-2 2s-2-.896-2-2 .896-2 2-2 2 .896 2 2zm6 0c0 1.104-.896 2-2 2s-2-.896-2-2 .896-2 2-2 2 .896 2 2zm-12 0c0 1.104-.896 2-2 2s-2-.896-2-2 .896-2 2-2 2 .896 2 2z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19c0-1.5 2-3 7-3s7 1.5 7 3"/></svg>
            {{ biometricLoading ? 'Запрос биометрии...' : 'Войти по Face ID / Touch ID' }}
          </button>
        }
        @if (keyPromptOpen) {
          <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border-default);">
            <p class="text-sm" style="color:var(--text-secondary);">
              Вход выполнен. Чтобы сообщения можно было читать на этом устройстве, нужен пароль — он
              нужен один раз, дальше устройство помнит ключ. Без него всё, написанное раньше, откроется,
              а новое — нет.
            </p>
            <div style="margin-top:8px;">
              <label class="block text-sm font-medium" style="color:var(--text-secondary);">Пароль</label>
              <input type="password" [(ngModel)]="keyPassword" name="keyPassword" class="form-input mt-1"
                (keyup.enter)="submitKeyPassword()">
            </div>
            @if (keyPromptError) {
              <p class="mt-2 text-sm" style="color:#e74c3c;">{{ keyPromptError }}</p>
            }
            <button type="button" class="btn-primary" style="width:100%;padding:10px 20px;margin-top:8px;"
              [disabled]="keySubmitting" (click)="submitKeyPassword()">
              {{ keySubmitting ? 'Настраиваем ключ...' : 'Настроить ключ' }}
            </button>
            <button type="button" class="btn-secondary" style="width:100%;padding:8px 20px;margin-top:6px;"
              (click)="skipKeySetup()">Позже</button>
          </div>
        }
        @if (error) {
          <p class="mt-2 text-sm text-center" style="color:#e74c3c;">{{ error }}</p>
        }
      </div>
    </div>
  `,
})
export class LoginComponent implements OnInit {
  username = '';
  password = '';
  error = '';
  /** Key setup form, shown after a sign-in that could not supply the password. */
  keyPromptOpen = false;
  keyPassword = '';
  keyPromptError = '';
  keySubmitting = false;
  redirectUrl = '';
  hasBiometric = false;
  biometricLoading = false;
  /** Set for the whole lifetime of the POST, so a second tap cannot start another. */
  submitting = false;
  private bioCheckTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private router: Router,
    private notif: NotificationService,
    private serverCrypto: ServerCryptoService,
  ) {}

  ngOnInit() {
    this.redirectUrl = this.route.snapshot.queryParams['redirect'] || '/feed';
    const saved = localStorage.getItem('lastUsername');
    if (saved) {
      this.username = saved;
      this.checkBiometric();
    }
  }

  checkBiometric() {
    if (this.bioCheckTimer) clearTimeout(this.bioCheckTimer);
    if (!this.username.trim()) { this.hasBiometric = false; return; }
    this.bioCheckTimer = setTimeout(() => {
      this.api.webauthnHasCredentials(this.username).subscribe({
        next: (res) => {
          // Only show biometric button if WebAuthn is supported
          this.hasBiometric = res.has_credentials && typeof PublicKeyCredential !== 'undefined';
        },
        error: () => { this.hasBiometric = false; },
      });
    }, 400);
  }

  private prepareWebAuthnOptions(opts: any): any {
    const b = (s: string): Uint8Array => {
      const base64 = s.replace(/-/g, '+').replace(/_/g, '/');
      const p = base64.length % 4;
      const raw = atob(p ? base64 + '='.repeat(4 - p) : base64);
      const buf = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
      return buf;
    };
    const pk = opts.publicKey ?? opts;
    if (pk.challenge) pk.challenge = b(pk.challenge);
    if (pk.user?.id) pk.user.id = b(pk.user.id);
    for (const key of ['excludeCredentials', 'allowCredentials']) {
      if (pk[key]) pk[key].forEach((c: any) => { if (c.id) c.id = b(c.id); });
    }
    return opts;
  }

  async biometricLogin() {
    if (typeof PublicKeyCredential === 'undefined') {
      this.error = 'WebAuthn не поддерживается вашим браузером';
      return;
    }
    this.biometricLoading = true;
    this.error = '';

    this.api.webauthnBeginLogin(this.username).subscribe({
      next: async (challenge) => {
        try {
          const credential = await navigator.credentials.get({
            publicKey: this.prepareWebAuthnOptions(challenge.options).publicKey,
          }) as PublicKeyCredential;

          const credJson = credential.toJSON();
          this.api.webauthnFinishLogin(challenge.session_id, credJson).subscribe({
            next: async (res) => {
              localStorage.setItem('lastUsername', this.username);
              this.api.storeAuth(res);

              // Face ID never yields the password, and the key is wrapped with it.
              // Picking up a key this device already stored needs no password; if
              // there is none, ask for it here instead of letting the user into a
              // session that cannot read anything new.
              if (await this.ensureKey('')) {
                this.router.navigateByUrl(this.redirectUrl);
              } else {
                this.keyPromptOpen = true;
                this.biometricLoading = false;
              }
            },
            error: () => {
              this.error = 'Ошибка входа по биометрии';
              this.biometricLoading = false;
            },
          });
        } catch (e: any) {
          this.error = e?.message || 'Биометрия не выполнена';
          this.biometricLoading = false;
        }
      },
      error: (err) => {
        this.error = err.error?.error || 'Ошибка запроса биометрии';
        this.biometricLoading = false;
      },
    });
  }

  /**
   * Carries out the key setup and reports whether a usable key exists afterwards.
   *
   * The error is logged rather than swallowed: an empty catch here once hid a
   * device that could not create keys at all, and the only symptom was "cannot
   * send" much later.
   */
  private async ensureKey(password: string): Promise<boolean> {
    // The client-to-server layer is off in this build (no pinned server key), so
    // there is no account key to create or unlock. Asking for the account
    // password to set up a layer that nothing uses is a question with no
    // consequence - and it stood between Face ID and the app.
    if (!this.serverCrypto.isEnabled()) return true;
    try {
      await this.serverCrypto.ensureAccountKey(password);
    } catch (err) {
      console.error('Account key setup failed', err);
    }
    return this.serverCrypto.hasAccountKey();
  }

  async submitKeyPassword() {
    if (!this.keyPassword || this.keySubmitting) return;
    this.keySubmitting = true;
    this.keyPromptError = '';

    const ok = await this.ensureKey(this.keyPassword);
    this.keySubmitting = false;

    if (ok) {
      this.keyPromptOpen = false;
      this.keyPassword = '';
      this.router.navigateByUrl(this.redirectUrl);
      return;
    }
    // Wrong password and "the device cannot create keys" look the same from here,
    // so the message says both rather than blaming the user for the second.
    this.keyPromptError = 'Не удалось: пароль не подошёл или устройство не может создать ключ. Попробуйте ещё раз.';
  }

  /** Signing in is not conditional on the key; old messages must stay reachable. */
  skipKeySetup() {
    this.keyPromptOpen = false;
    this.keyPassword = '';
    this.router.navigateByUrl(this.redirectUrl);
  }

  onSubmit() {
    // A second tap while the first POST is still in flight sends a second one. On a
    // good link the duplicate is invisible and wasteful; over LTE the first request
    // can leave the connection busy for seconds, and the duplicate then waits behind
    // it and times out - which reads as "the app is broken" rather than as "you
    // tapped twice".
    if (this.submitting) return;
    this.submitting = true;

    this.notif.requestPermission();
    this.api.login(this.username, this.password).subscribe({
      next: async (res) => {
        localStorage.setItem('lastUsername', this.username);
        this.api.storeAuth(res);
        // The account key is wrapped with this very password, so this is the one
        // moment it can be created or unwrapped without asking again. Awaited
        // rather than fired off: the thread loads right after the redirect, and
        // arriving before the key is ready would show every new message as
        // "no key on this device" for no reason.
        try {
          await this.serverCrypto.ensureAccountKey(this.password);
        } catch (err) {
          // Failing to set up the key must not block sign-in: everything written
          // under the old scheme still reads. But it must be visible - an empty
          // catch hid a device that cannot create keys at all, and the only
          // symptom was "cannot send" much later.
          console.error('Account key setup failed', err);
        }
        this.router.navigateByUrl(this.redirectUrl);
      },
      error: (err) => {
        this.submitting = false;
        // Saying "wrong password" to someone whose link dropped the request is the
        // one reply that is certainly wrong: they will go and reset a password that
        // was fine. Status 0 is what both a timeout and a dead connection look like.
        this.error = err?.status === 0
          ? 'Сервер не ответил. Проверьте соединение и попробуйте ещё раз.'
          : 'Неверное имя пользователя или пароль';
      },
    });
  }
}

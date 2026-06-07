import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { NotificationService } from '../../services/notification.service';

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
          <button type="submit" class="btn-primary" style="width:100%;padding:10px 20px;">
            Войти
          </button>
        </form>
        @if (hasBiometric) {
          <button type="button" (click)="biometricLogin()" [disabled]="biometricLoading"
            class="btn-secondary" style="width:100%;margin-top:8px;padding:10px 20px;display:flex;align-items:center;justify-content:center;gap:8px;">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 1.104-.896 2-2 2s-2-.896-2-2 .896-2 2-2 2 .896 2 2zm6 0c0 1.104-.896 2-2 2s-2-.896-2-2 .896-2 2-2 2 .896 2 2zm-12 0c0 1.104-.896 2-2 2s-2-.896-2-2 .896-2 2-2 2 .896 2 2z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19c0-1.5 2-3 7-3s7 1.5 7 3"/></svg>
            {{ biometricLoading ? 'Запрос биометрии...' : 'Войти по Face ID / Touch ID' }}
          </button>
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
  redirectUrl = '';
  hasBiometric = false;
  biometricLoading = false;
  private bioCheckTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private router: Router,
    private notif: NotificationService,
  ) {}

  ngOnInit() {
    this.redirectUrl = this.route.snapshot.queryParams['redirect'] || '/feed';
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
            next: (res) => {
              this.api.storeAuth(res);
              this.router.navigateByUrl(this.redirectUrl);
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

  onSubmit() {
    this.notif.requestPermission();
    this.api.login(this.username, this.password).subscribe({
      next: (res) => {
        this.api.storeAuth(res);
        this.router.navigateByUrl(this.redirectUrl);
      },
      error: () => {
        this.error = 'Неверное имя пользователя или пароль';
      },
    });
  }
}

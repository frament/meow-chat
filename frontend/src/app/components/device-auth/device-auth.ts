import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { interval, Subscription } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';

interface IncomingRequest {
  id: number;
  device_name: string;
  device_public_key: string;
}

@Component({
  selector: 'app-device-auth',
  standalone: true,
  imports: [FormsModule],
  template: `
    <!-- Waiting for approval (new device) -->
    @if (status() === 'waiting') {
      <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div class="card" style="max-width:400px;width:100%;padding:24px;">
          <h2 style="font-size:18px;font-weight:700;margin-bottom:8px;color:var(--text-primary);">Подтверждение входа</h2>
          <p style="font-size:14px;color:var(--text-secondary);margin-bottom:16px;">
            Открыто новое устройство <strong>{{ deviceName }}</strong>.<br>
            Подтвердите вход на одном из ваших доверенных устройств.
          </p>
          <div style="display:flex;gap:8px;justify-content:center;">
            <div style="width:20px;height:20px;border:2px solid var(--accent);border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></div>
          </div>
          <p style="font-size:13px;color:var(--text-tertiary);margin-top:16px;text-align:center;">
            Ожидание подтверждения...
          </p>
          <button (click)="cancel()" style="width:100%;margin-top:12px;padding:8px;border-radius:8px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:13px;color:var(--text-secondary);">
            Отмена
          </button>
          <button (click)="showRecovery = true" style="width:100%;margin-top:8px;padding:8px;border-radius:8px;border:none;background:transparent;cursor:pointer;font-size:13px;color:var(--accent);text-decoration:underline;">
            Нет доступа к другому устройству? Восстановить
          </button>
        </div>
      </div>
    }

    <!-- Approval dialog (trusted device) -->
    @if (incomingRequest(); as req) {
      <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div class="card" style="max-width:400px;width:100%;padding:24px;">
          <h2 style="font-size:18px;font-weight:700;margin-bottom:8px;color:var(--text-primary);">Подтвердить устройство</h2>
          <p style="font-size:14px;color:var(--text-secondary);margin-bottom:16px;">
            Устройство <strong>{{ req.device_name }}</strong> запрашивает доступ к вашей учётной записи.
          </p>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button (click)="denyRequest()" style="padding:8px 16px;border-radius:8px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:13px;color:var(--text-secondary);">
              Отклонить
            </button>
            <button (click)="approveRequest()" style="padding:8px 16px;border-radius:8px;border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-size:13px;font-weight:500;">
              Подтвердить
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Recovery dialog -->
    @if (showRecovery) {
      <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div class="card" style="max-width:400px;width:100%;padding:24px;">
          <h2 style="font-size:18px;font-weight:700;margin-bottom:8px;color:var(--text-primary);">Восстановление ключей</h2>
          <p style="font-size:14px;color:var(--text-secondary);margin-bottom:16px;">
            Введите пароль от учётной записи или фразу восстановления.
          </p>
          <select [(ngModel)]="recoveryMethod" style="width:100%;padding:10px 12px;border:1px solid var(--border-default);border-radius:8px;font-size:14px;margin-bottom:12px;background:var(--bg-surface);color:var(--text-primary);">
            <option value="password">Пароль</option>
            <option value="phrase">Фраза восстановления</option>
          </select>
          <input [(ngModel)]="recoveryInput" type="text" placeholder="Введите {{ recoveryMethod === 'password' ? 'пароль' : 'фразу восстановления' }}"
            style="width:100%;padding:10px 12px;border:1px solid var(--border-default);border-radius:8px;font-size:14px;margin-bottom:16px;">
          @if (recoveryError) {
            <p style="font-size:13px;color:#e74c3c;margin-bottom:12px;">{{ recoveryError }}</p>
          }
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button (click)="showRecovery = false; recoveryError = ''" style="padding:8px 16px;border-radius:8px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:13px;color:var(--text-secondary);">
              Отмена
            </button>
            <button (click)="doRecover()" [disabled]="!recoveryInput" style="padding:8px 16px;border-radius:8px;border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-size:13px;font-weight:500;">
              Восстановить
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    @keyframes spin { to { transform: rotate(360deg); } }
  `]
})
export class DeviceAuthComponent {
  readonly status = signal<'idle' | 'waiting' | 'approved' | 'failed'>('idle');
  readonly incomingRequest = signal<IncomingRequest | null>(null);
  deviceName: string = '';
  private authRequestId: number = 0;
  private pollSub?: Subscription;
  showRecovery = false;
  recoveryMethod: 'password' | 'phrase' = 'password';
  recoveryInput = '';
  recoveryError = '';

  constructor(
    private api: ApiService,
    private crypto: CryptoService,
  ) {}

  async startNewDeviceFlow() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    this.deviceName = 'Device ' + Array.from({length: 4}, () => letters[Math.floor(Math.random() * letters.length)]).join('');
    this.status.set('waiting');

    await this.crypto.ensureDeviceKeyPair();
    const pubKey = await this.crypto.getDevicePublicKeySPKI();

    this.api.createAuthRequest(this.deviceName, pubKey, this.crypto.deviceId).subscribe({
      next: (res) => {
        this.authRequestId = res.id;
        this.startPolling();
      },
      error: () => {
        this.status.set('failed');
        this.showRecovery = true;
      },
    });
  }

  private startPolling() {
    this.pollSub = interval(3000).subscribe(() => {
      this.api.getAuthRequest(this.authRequestId).subscribe(res => {
        if (res.status === 'approved' && res.encrypted_key) {
          this.status.set('approved');
          this.pollSub?.unsubscribe();
          this.processApprovedKey(res.encrypted_key, res.iv);
        } else if (res.status === 'denied' || res.status === 'expired') {
          this.status.set('failed');
          this.pollSub?.unsubscribe();
        }
      });
    });
  }

  handleDeviceApproved(deviceId: string) {
    if (this.status() === 'waiting' && this.pollSub && deviceId === this.crypto.deviceId) {
      this.api.getAuthRequest(this.authRequestId).subscribe(res => {
        if (res.status === 'approved' && res.encrypted_key) {
          this.status.set('approved');
          this.pollSub?.unsubscribe();
          this.processApprovedKey(res.encrypted_key, res.iv);
        }
      });
    }
  }

  private async processApprovedKey(encryptedB64: string, ivB64: string) {
    const deviceSPKI = await this.crypto.getDevicePublicKeySPKI();
    const jwk = await this.crypto.decryptIdentityKeyFromDevice(encryptedB64, ivB64, deviceSPKI);
    if (jwk) {
      await this.crypto.importIdentityKey(jwk);
      await this.crypto.syncPublicKey();
      location.reload();
    }
  }

  // Called when this trusted device receives a WS event
  showIncomingRequest(req: IncomingRequest) {
    this.incomingRequest.set(req);
  }

  async approveRequest() {
    const req = this.incomingRequest();
    if (!req) return;
    const result = await this.crypto.encryptIdentityKeyForDevice(req.device_public_key);
    if (!result) return;

    this.api.approveAuthRequest(req.id, result.encrypted, result.iv).subscribe({
      next: () => this.incomingRequest.set(null),
    });
  }

  denyRequest() {
    const req = this.incomingRequest();
    if (!req) return;
    this.api.denyAuthRequest(req.id).subscribe(() => this.incomingRequest.set(null));
  }

  cancel() {
    if (this.authRequestId) {
      this.api.denyAuthRequest(this.authRequestId).subscribe();
    }
    this.status.set('idle');
    this.pollSub?.unsubscribe();
  }

  async doRecover() {
    if (!this.recoveryInput) return;
    this.recoveryError = '';
    this.api.recoverKeys(this.recoveryMethod, this.recoveryInput).subscribe({
      next: (res) => {
        this.crypto.importIdentityKey(res.identity_key_jwk).then(() => {
          this.crypto.syncPublicKey();
          this.showRecovery = false;
          this.status.set('approved');
          location.reload();
        });
      },
      error: () => {
        this.recoveryError = 'Неверный пароль или фраза восстановления';
      },
    });
  }
}

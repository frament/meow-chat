import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="max-w-lg mx-auto space-y-6">
      <div class="bg-white rounded-xl shadow-sm border p-6">
        <h1 class="text-2xl font-bold mb-6">Настройки профиля</h1>

        <div class="flex flex-col items-center mb-6">
          <div class="relative">
            @if (previewUrl || currentAvatar) {
              <img [src]="previewUrl || currentAvatar" alt="Avatar"
                class="w-24 h-24 rounded-full object-cover border-2 border-gray-200">
            } @else {
              <div class="w-24 h-24 rounded-full bg-blue-100 flex items-center justify-center text-2xl font-medium text-blue-600 border-2 border-gray-200">
                {{ currentUsername[0] }}
              </div>
            }
            <label class="absolute bottom-0 right-0 bg-blue-600 text-white rounded-full p-1.5 cursor-pointer hover:bg-blue-700 transition-colors shadow-sm">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <input type="file" accept="image/*" (change)="onFileSelected($event)" class="hidden">
            </label>
          </div>
          @if (uploading) {
            <p class="text-sm text-blue-600 mt-2">Загрузка...</p>
          }
          @if (avatarSuccess) {
            <p class="text-sm text-green-600 mt-2">Аватар обновлён</p>
          }
        </div>

        <form (ngSubmit)="onSubmit()" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700">Имя пользователя</label>
            <input type="text" [(ngModel)]="username" name="username" required
              class="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">Email</label>
            <input type="email" [(ngModel)]="email" name="email" required
              class="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
          </div>
          <div class="flex gap-3">
            <button type="submit" [disabled]="saving"
              class="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
              {{ saving ? 'Сохранение...' : 'Сохранить' }}
            </button>
            <button type="button" (click)="logout()"
              class="px-4 py-2 text-sm text-red-600 hover:text-red-800 transition-colors">
              Выйти
            </button>
          </div>
        </form>
        @if (success) {
          <p class="mt-3 text-sm text-green-600 text-center">{{ success }}</p>
        }
        @if (error) {
          <p class="mt-3 text-sm text-red-600 text-center">{{ error }}</p>
        }
      </div>
    </div>
  `,
})
export class SettingsComponent implements OnInit {
  username = '';
  email = '';
  saving = false;
  success = '';
  error = '';
  selectedFile: File | null = null;
  previewUrl: string | null = null;
  uploading = false;
  avatarSuccess = false;

  constructor(private api: ApiService, private router: Router) {}

  get currentUsername() {
    return this.api.currentUser()?.username ?? '';
  }

  get currentAvatar() {
    return this.api.currentUser()?.avatar_url ?? '';
  }

  ngOnInit() {
    const user = this.api.currentUser();
    if (user) {
      this.username = user.username;
      this.email = user.email;
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.selectedFile = input.files[0];
      this.previewUrl = URL.createObjectURL(input.files[0]);
      this.uploadAvatar();
    }
  }

  uploadAvatar() {
    if (!this.selectedFile) return;
    this.uploading = true;
    this.avatarSuccess = false;
    this.api.uploadAvatar(this.selectedFile).subscribe({
      next: (res) => {
        this.uploading = false;
        this.avatarSuccess = true;
        const user = this.api.currentUser();
        if (user) {
          const updated = { ...user, avatar_url: res.avatar_url };
          this.api.currentUser.set(updated);
          localStorage.setItem('currentUser', JSON.stringify(updated));
        }
        setTimeout(() => (this.avatarSuccess = false), 3000);
      },
      error: () => {
        this.uploading = false;
        this.error = 'Ошибка загрузки аватара';
      },
    });
  }

  onSubmit() {
    if (!this.username.trim() || !this.email.trim()) return;
    this.saving = true;
    this.success = '';
    this.error = '';
    this.api.updateProfile(this.username, this.email).subscribe({
      next: (res) => {
        this.saving = false;
        this.api.currentUser.set(res);
        localStorage.setItem('currentUser', JSON.stringify(res));
        this.success = 'Профиль сохранён';
        setTimeout(() => (this.success = ''), 3000);
      },
      error: () => {
        this.saving = false;
        this.error = 'Ошибка сохранения. Возможно, имя или email уже заняты.';
      },
    });
  }

  logout() {
    this.api.currentUser.set(null);
    localStorage.removeItem('currentUser');
    this.router.navigate(['/login']);
  }
}

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminComponent } from './admin';
import { ApiService } from '../../services/api.service';
import { signal, computed } from '@angular/core';
import { of } from 'rxjs';
import { HttpEventType } from '@angular/common/http';

describe('AdminComponent', () => {
  let component: AdminComponent;
  let fixture: ComponentFixture<AdminComponent>;

  const mockApi = {
    currentUser: signal({ id: 1, username: 'admin', email: 'a@a.com', avatar_url: '', is_admin: true }),
    totalUnread: computed(() => 0),
    getAdminUsers: jasmine.createSpy().and.returnValue(of([])),
    getAdminFiles: jasmine.createSpy().and.returnValue(of({ files: [], disk: { total: 0, used: 0, free: 0, total_gb: 0, used_gb: 0, free_gb: 0, used_pct: 0 } })),
    adminMakeAdmin: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    adminRemoveAdmin: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    getAdminGroupChats: jasmine.createSpy().and.returnValue(of([])),
    adminDeleteGroupChat: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    getBackups: jasmine.createSpy().and.returnValue(of([])),
    createBackup: jasmine.createSpy().and.returnValue(of({ filename: 'b.zip', size_bytes: 100, created_at: '' })),
    uploadBackup: jasmine.createSpy().and.returnValue(of({ type: HttpEventType.Response, body: { filename: 'b.zip' } })),
    deleteBackup: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    restoreBackup: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    downloadBackupUrl: jasmine.createSpy().and.returnValue('/api/admin/backup/backups/b.zip'),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('renders all 5 tab buttons', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const buttons = compiled.querySelectorAll('button');
    const tabTexts = Array.from(buttons)
      .map(b => b.textContent?.trim())
      .filter(t => t === 'Управление пользователями' || t === 'Управление файлами' || t === 'Чаты' || t === 'Бэкапы' || t === 'Федерация');
    expect(tabTexts.length).toBe(5);
    expect(component.activeTab).toBe('users');
  });
});

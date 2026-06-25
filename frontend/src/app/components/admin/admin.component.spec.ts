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
    getGiphyKey: jasmine.createSpy().and.returnValue(of({ has_key: false, key: '' })),
    updateGiphyKey: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
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

  it('renders all 6 tab buttons on desktop', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const buttons = compiled.querySelectorAll('button');
    const tabTexts = Array.from(buttons)
      .map(b => b.textContent?.trim())
      .filter(t => t === 'Управление пользователями' || t === 'Управление файлами' || t === 'Чаты' || t === 'Бэкапы' || t === 'Федерация' || t === 'Настройки');
    expect(tabTexts.length).toBe(6);
    expect(component.activeTab).toBe('users');
  });

  it('renders mobile select with 6 options', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const select = compiled.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.options.length).toBe(6);
    expect(select.options[0].value).toBe('users');
    expect(select.options[1].value).toBe('files');
    expect(select.options[2].value).toBe('chats');
    expect(select.options[3].value).toBe('backups');
    expect(select.options[4].value).toBe('federation');
    expect(select.options[5].value).toBe('settings');
  });

  it('changes activeTab via mobile select', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const select = compiled.querySelector('select') as HTMLSelectElement;
    select.value = 'files';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(component.activeTab).toBe('files');
  });
});

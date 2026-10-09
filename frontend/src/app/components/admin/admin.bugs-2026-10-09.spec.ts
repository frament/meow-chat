import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { of, throwError } from 'rxjs';
import { HttpEventType } from '@angular/common/http';
import { AdminComponent } from './admin';
import { ApiService } from '../../services/api.service';

/**
 * Regression cover for bug #34 (2026-10-09): sticker packs vanished after
 * leaving and re-entering /admin.
 *
 * The cause was that loading lived in the click handlers of the desktop
 * sidebar. The mobile <select> went through onTabChange(), which knew only
 * about push and decrypt, and ngOnInit never restored stickerPacks - it lived
 * in the component alone. These tests drive the mobile path, which is the one
 * that showed the empty list.
 */

describe('AdminComponent: bug #34, sticker packs after re-entering the admin panel', () => {
  let component: AdminComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<AdminComponent>>;
  let mockApi: any;

  beforeEach(async () => {
    mockApi = {
      currentUser: signal({ id: 1, username: 'admin', avatar_url: '', is_admin: true }),
      totalUnread: computed(() => 0),
      getAdminUsers: jasmine.createSpy().and.returnValue(of([])),
      getAdminFiles: jasmine.createSpy().and.returnValue(of({ files: [], disk: { total: 0, used: 0, free: 0, total_gb: 0, used_gb: 0, free_pct: 0 } })),
      adminMakeAdmin: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      adminRemoveAdmin: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      getAdminGroupChats: jasmine.createSpy().and.returnValue(of([])),
      adminDeleteGroupChat: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      getBackups: jasmine.createSpy().and.returnValue(of([])),
      getStickerPacks: jasmine.createSpy().and.returnValue(of([{ id: 1, name: 'Мой пак', stickers: [{ id: 7, image_url: '/u.png' }] }])),
      adminCreateStickerPack: jasmine.createSpy().and.returnValue(of({ id: 1, name: 'Пак' })),
      adminRenameStickerPack: jasmine.createSpy().and.returnValue(of({ message: 'Pack renamed' })),
      adminDeleteStickerPack: jasmine.createSpy().and.returnValue(of({ message: 'Pack deleted' })),
      adminUploadSticker: jasmine.createSpy().and.returnValue(of({ id: 1, image_url: '/u.png' })),
      adminDeleteSticker: jasmine.createSpy().and.returnValue(of({ message: 'Sticker deleted' })),
      createBackup: jasmine.createSpy().and.returnValue(of({ filename: 'b.zip', size_bytes: 1, created_at: '' })),
      uploadBackup: jasmine.createSpy().and.returnValue(of({ type: HttpEventType.Response, body: { filename: 'b.zip' } })),
      deleteBackup: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      restoreBackup: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      downloadBackupUrl: jasmine.createSpy().and.returnValue('/api/admin/backup/backups/b.zip'),
      getGiphyKey: jasmine.createSpy().and.returnValue(of({ has_key: false, key: '' })),
      updateGiphyKey: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      getVersion: jasmine.createSpy().and.returnValue(of({ version: '1.1.0' })),
      checkUpdate: jasmine.createSpy().and.returnValue(of({ has_update: false, latest: '', current: '' })),
      adminPushStatus: jasmine.createSpy().and.returnValue(of({ total_subscriptions: 0, users_with_subscriptions: 0, last_server_send: '', last_client_event: '', subscriptions: [] })),
      adminPushLogs: jasmine.createSpy().and.returnValue(of([])),
      adminDecryptFailures: jasmine.createSpy().and.returnValue(of({ total: 0, dm_count: 0, group_count: 0, users: 0, groups: 0, last_at: '', recent: [] })),
    };

    await TestBed.configureTestingModule({
      imports: [AdminComponent],
      providers: [{ provide: ApiService, useValue: mockApi }],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function pickTab(value: string) {
    const select = (fixture.nativeElement as HTMLElement).querySelector('select') as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('shows the packs that exist on the server, not "Нет стикерпаков"', () => {
    pickTab('stickers');

    expect(mockApi.getStickerPacks).toHaveBeenCalled();
    expect(component.stickerPacks.length).toBe(1);
    expect(component.stickerPacks[0].name).toBe('Мой пак');

    const text = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(text).not.toContain('Нет стикерпаков');
  });

  it('loads the packs on a freshly created component - the "re-entered /admin" case', () => {
    // A new component instance stands in for navigating away and back: the
    // array starts empty, exactly as it did when the packs appeared to vanish.
    const second = TestBed.createComponent(AdminComponent);
    second.detectChanges();
    second.componentInstance.selectTab('stickers');
    second.detectChanges();

    expect(second.componentInstance.stickerPacks.length).toBe(1);
    second.destroy();
  });

  it('covers every tab that needs data, not just stickers', () => {
    // The same asymmetry affected chats and backups on mobile.
    pickTab('chats');
    expect(mockApi.getAdminGroupChats).toHaveBeenCalled();

    pickTab('backups');
    expect(mockApi.getBackups).toHaveBeenCalled();

    pickTab('decrypt');
    expect(mockApi.adminDecryptFailures).toHaveBeenCalled();

    pickTab('push');
    expect(mockApi.adminPushStatus).toHaveBeenCalled();
  });

  it('keeps the push refresh timer off outside the push tab', () => {
    pickTab('push');
    pickTab('stickers');
    expect(component.activeTab).toBe('stickers');
    expect((component as any).pushTimer).toBeNull();
  });

  it('reflects the open tab back into the mobile select', () => {
    pickTab('stickers');
    const select = (fixture.nativeElement as HTMLElement).querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('stickers');
  });

  it('still routes the desktop sidebar through the same loader', () => {
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('nav button');
    const stickers = Array.from(buttons).find(b => b.textContent?.trim() === 'Стикеры') as HTMLButtonElement;
    stickers.click();
    fixture.detectChanges();

    expect(component.activeTab).toBe('stickers');
    expect(component.stickerPacks.length).toBe(1);
  });

  // ── Renaming, 2026-10-09 ──────────────────────────────────────────────
  //
  // The endpoint and the API method were there since the feature landed; only
  // the button was missing. These cover the states the inline editor has.

  const packFor = () => ({ id: 1, name: 'Мой пак', stickers: [{ id: 7, image_url: '/u.png' }] });

  it('starts renaming with the current name in the field', () => {
    component.selectTab('stickers');
    component.startRename(packFor() as any);

    expect(component.renamingPackId).toBe(1);
    expect(component.stickerRenameDraft).toBe('Мой пак');
  });

  it('sends the new name and reports success', () => {
    component.startRename(packFor() as any);
    component.stickerRenameDraft = '  Переименованный  ';
    component.commitRename(packFor() as any);

    // Trimmed before the request, not after.
    expect(mockApi.adminRenameStickerPack).toHaveBeenCalledWith(1, 'Переименованный');
    expect(component.stickerMsg).toBe('Пак переименован');
    expect(component.stickerMsgOk).toBe(true);
    expect(component.renamingPackId).toBeNull();
  });

  it('refuses an empty name without calling the server', () => {
    component.startRename(packFor() as any);
    component.stickerRenameDraft = '   ';
    component.commitRename(packFor() as any);

    expect(mockApi.adminRenameStickerPack).not.toHaveBeenCalled();
    expect(component.stickerMsgOk).toBe(false);
    expect(component.renamingPackId).toBe(1); // stays in edit mode
  });

  it('treats an unchanged name as a cancel, not a request', () => {
    component.startRename(packFor() as any);
    component.commitRename(packFor() as any);

    expect(mockApi.adminRenameStickerPack).not.toHaveBeenCalled();
    expect(component.renamingPackId).toBeNull();
  });

  it('keeps edit mode open and says so when the rename fails', () => {
    mockApi.adminRenameStickerPack = jasmine.createSpy().and.returnValue(throwError(() => new Error('nope')));
    component.startRename(packFor() as any);
    component.stickerRenameDraft = 'Другое';
    component.commitRename(packFor() as any);

    expect(component.renamingPackId).toBe(1);
    expect(component.stickerMsgOk).toBe(false);
  });

  it('drops a half-typed name when the list reloads', () => {
    component.startRename(packFor() as any);
    component.stickerRenameDraft = 'недописанное';

    // Any reload does it: the tab, another mutation, leaving the page.
    component.loadStickers();

    expect(component.renamingPackId).toBeNull();
    expect(component.stickerRenameDraft).toBe('');
  });

  it('renders the rename controls in both the desktop and mobile layouts', () => {
    component.selectTab('stickers');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(text).toContain('Переименовать');

    component.startRename(packFor() as any);
    fixture.detectChanges();
    const editText = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(editText).toContain('Сохранить');
    expect(editText).toContain('Отмена');
  });

  // ── iPhone stickers, 2026-10-09 ──────────────────────────────────────
  //
  // An iOS sticker is APNG/GIF/PNG and the only way one leaves the sticker
  // keyboard is by dragging or copying it - never through a file chooser. So
  // the entry points that matter are a drop and a paste, both of which arrive
  // as a File rather than through the <input>.

  const pack = () => ({ id: 1, name: 'Мой пак', stickers: [] });

  /** A FileList as a drop or a change event would carry it. */
  function fileList(file: File) {
    return { files: [file], length: 1, item: (i: number) => (i === 0 ? file : null) };
  }

  function pngFile(name = 'sticker.png') {
    // A real PNG signature, so toMemoryFile and any sniffing see an image.
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    return new File([bytes], name, { type: 'image/png' });
  }

  function dropEvent(file: File) {
    const e: any = new Event('drop');
    e.preventDefault = () => {};
    e.dataTransfer = { files: [file] };
    return e as DragEvent;
  }

  it('uploads a sticker dropped onto the pack', async () => {
    await (component as any).uploadStickerFile(pack() as any, pngFile());
    expect(mockApi.adminUploadSticker).toHaveBeenCalled();
  });

  it('uploads a sticker from a drop event', async () => {
    component.selectTab('stickers');
    await component.onStickerDropped(pack() as any, dropEvent(pngFile()));

    expect(mockApi.adminUploadSticker).toHaveBeenCalled();
    const sent = mockApi.adminUploadSticker.calls.mostRecent().args[1] as File;
    expect(sent.type).toBe('image/png');
  });

  it('marks the drop zone only while a file is over it', () => {
    const over: any = new Event('dragover');
    over.preventDefault = () => {};

    component.onStickerDragOver(1, over);
    expect(component.stickerDragOver).toBe(1);

    component.onStickerDragLeave(1);
    expect(component.stickerDragOver).toBeNull();
  });

  it('uploads a pasted image into the pack whose zone was armed', async () => {
    component.selectTab('stickers');
    const pack2 = { id: 5, name: 'Другой', stickers: [] };
    component.stickerPacks = [pack(), pack2] as any;

    // The zone is armed by clicking it: a paste event carries no target, and on
    // an iPhone the two fingers land on the page rather than on a div.
    component.onStickerZoneArmed(5);

    const item = { type: 'image/png', getAsFile: () => pngFile('from-clipboard.png') };
    const e: any = new Event('paste');
    e.preventDefault = () => {};
    e.clipboardData = { items: [item] };

    await component.onDocumentPaste(e);

    expect(mockApi.adminUploadSticker).toHaveBeenCalledWith(5, jasmine.anything());
  });

  it('ignores a paste when no zone is armed', async () => {
    component.selectTab('stickers');
    const item = { type: 'image/png', getAsFile: () => pngFile() };
    const e: any = new Event('paste');
    e.clipboardData = { items: [item] };

    await component.onDocumentPaste(e);

    expect(mockApi.adminUploadSticker).not.toHaveBeenCalled();
  });

  it('ignores a paste outside the stickers tab', async () => {
    component.selectTab('users');
    component.onStickerZoneArmed(1);
    const item = { type: 'image/png', getAsFile: () => pngFile() };
    const e: any = new Event('paste');
    e.clipboardData = { items: [item] };

    await component.onDocumentPaste(e);

    expect(mockApi.adminUploadSticker).not.toHaveBeenCalled();
  });

  it('leaves a text-only paste alone', async () => {
    component.selectTab('stickers');
    component.onStickerZoneArmed(1);
    const e: any = new Event('paste');
    e.preventDefault = jasmine.createSpy();
    e.clipboardData = { items: [{ type: 'text/plain', getAsFile: () => null }] };

    await component.onDocumentPaste(e);

    expect(mockApi.adminUploadSticker).not.toHaveBeenCalled();
    // A text paste in a rename field must still reach the field.
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
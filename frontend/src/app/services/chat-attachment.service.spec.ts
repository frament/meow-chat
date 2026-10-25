import { TestBed } from '@angular/core/testing';
import { ChatAttachmentService } from './chat-attachment.service';

describe('ChatAttachmentService', () => {
  let service: ChatAttachmentService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ChatAttachmentService);
  });

  /** A FileList stand-in: the service only reads length and indices. */
  function fileList(files: File[]): FileList {
    const list = { length: files.length } as unknown as FileList & Record<number, File>;
    files.forEach((f, i) => { (list as Record<number, File>)[i] = f; });
    return list;
  }

  function file(name: string): File {
    return new File(['x'], name, { type: 'image/jpeg' });
  }

  it('caps the remaining slots at zero', () => {
    expect(service.remainingSlots(0)).toBe(10);
    expect(service.remainingSlots(7)).toBe(3);
    // A caller that already has more than the limit must not be handed a
    // negative slice, which would mean "all but the last N".
    expect(service.remainingSlots(12)).toBe(0);
  });

  it('takes no more than the remaining slots from a file list', () => {
    return service.fromFileList(fileList([file('a'), file('b'), file('c')]), 2)
      .then(picked => expect(picked.length).toBe(2));
  });

  it('returns nothing when no slots are left', () => {
    return service.fromFileList(fileList([file('a')]), 0)
      .then(picked => expect(picked).toEqual([]));
  });

  /** The preview must be a data URL the <img> can show, and the service must
   *  not touch any list: the caller owns `previews`. */
  it('reads a preview as a data URL', (done) => {
    service.readPreview(file('a.jpg')).then(url => {
      expect(url.startsWith('data:image/jpeg')).toBeTrue();
      done();
    }).catch(done.fail);
  });
});

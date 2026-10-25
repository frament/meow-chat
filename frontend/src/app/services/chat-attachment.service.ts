import { Injectable } from '@angular/core';
import { toMemoryFile } from './upload-utils';

/**
 * Reading attachments for the composer: the FileReader and the ten-file cap.
 *
 * Extracted on 2026-10-25. The component keeps the lists (`selectedFiles`,
 * `previews`) and the decision to switch the message type; this service only
 * reads bytes and counts slots. That split is what makes it testable without
 * mounting the chat.
 *
 * `readPreview` returns the data URL instead of pushing it. Pushing inside the
 * reader's callback was the original bug: `onload` fires after the current turn,
 * so a send in the same turn copied an empty `previews` array and the optimistic
 * bubble went out with no images. The caller awaits.
 */
@Injectable({ providedIn: 'root' })
export class ChatAttachmentService {
  /** Matches the server's own limit for one message. */
  readonly maxFiles = 10;

  /** How many more files may be attached. Never negative. */
  remainingSlots(currentCount: number): number {
    return Math.max(0, this.maxFiles - currentCount);
  }

  /** Reads one file as a data URL, for the composer preview strip. */
  readPreview(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target!.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  /** Image files from a paste, capped at `remaining`. */
  async fromClipboard(items: DataTransferItemList, remaining: number): Promise<File[]> {
    const out: File[] = [];
    for (let i = 0; i < items.length && out.length < remaining; i++) {
      const item = items[i];
      if (!item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (!file) continue;
      out.push(await toMemoryFile(file));
    }
    return out;
  }

  /** Files from an <input type="file">, capped at `remaining`. */
  async fromFileList(files: FileList, remaining: number): Promise<File[]> {
    const chosen = Array.from(files).slice(0, Math.max(0, remaining));
    const out: File[] = [];
    for (const file of chosen) {
      out.push(await toMemoryFile(file));
    }
    return out;
  }
}

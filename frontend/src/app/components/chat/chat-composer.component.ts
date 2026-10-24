import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SafeHtml } from '@angular/platform-browser';
import { MsgType } from '../../services/api.service';

/**
 * The composer: type menu, textarea, attachments, poll fields, send button.
 *
 * Extracted from ChatComponent on 2026-10-24. The desktop and mobile blocks
 * were identical - 105 lines each, zero differences - so this component has no
 * `mobile` input either. The wrappers stayed in the parent, which is where the
 * one real difference lives: the mobile pane is `<div class="shrink-0">` inside
 * the fixed container whose height is `mobileChatHeight()`.
 *
 * That height calculation is deliberately NOT part of this component. It lives
 * in the parent's Wrapper (`[style.height]="mobileChatHeight()"`) and is driven
 * by KeyboardService; moving it here would move the keyboard handling with it
 * for no gain, and AGENTS.md records how much that logic cost to get right.
 *
 * State that belongs to sending stays in the parent: messageContent, poll
 * options, files and errors are read by sendMessage(). The component owns only
 * what is purely local UI: whether the type menu is open, and the textarea's
 * own auto-growth.
 */
@Component({
  selector: 'app-chat-composer',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './chat-composer.component.html',
})
export class ChatComposerComponent {
  @Input() messageContent = '';
  @Output() messageContentChange = new EventEmitter<string>();

  @Input() messageType: MsgType = 'text';
  @Input() pollOptions: string[] = [];
  @Input() pollMultiple = false;
  @Output() pollMultipleChange = new EventEmitter<boolean>();

  @Input() previews: string[] = [];
  @Input() sendErrorText = '';
  @Input() visibleMsgTypes: Array<{ id: MsgType; icon: SafeHtml; label: string }> = [];
  @Input() currentTypeIcon: SafeHtml = '';
  @Input() currentTypeLabel = '';
  @Input() giphyHasKey = false;

  @Output() sendRequested = new EventEmitter<void>();
  @Output() selectTypeRequested = new EventEmitter<MsgType>();
  @Output() addPollOptionRequested = new EventEmitter<void>();
  @Output() removePollOptionRequested = new EventEmitter<number>();
  @Output() removeFileRequested = new EventEmitter<number>();
  @Output() openGifPickerRequested = new EventEmitter<void>();
  @Output() openStickerPickerRequested = new EventEmitter<void>();
  @Output() pasteRequested = new EventEmitter<ClipboardEvent>();
  @Output() keydownRequested = new EventEmitter<KeyboardEvent>();

  /** Pure UI: the type menu belongs to the composer, not to the conversation. */
  showTypeMenu = false;

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (this.showTypeMenu && !target.closest('.type-menu-container')) {
      this.showTypeMenu = false;
    }
  }

  @HostListener('document:keydown.escape')
  onEscapePress(): void {
    this.showTypeMenu = false;
  }

  sendMessage(): void {
    this.sendRequested.emit();
  }

  selectType(id: MsgType): void {
    this.selectTypeRequested.emit(id);
  }

  addPollOption(): void {
    this.addPollOptionRequested.emit();
  }

  removePollOption(idx: number): void {
    this.removePollOptionRequested.emit(idx);
  }

  removeFile(index: number): void {
    this.removeFileRequested.emit(index);
  }

  openGifPicker(): void {
    this.openGifPickerRequested.emit();
  }

  openStickerPicker(): void {
    this.openStickerPickerRequested.emit();
  }

  onPaste(event: ClipboardEvent): void {
    this.pasteRequested.emit(event);
  }

  onComposerKeydown(event: KeyboardEvent): void {
    this.keydownRequested.emit(event);
  }

  /** Grows with the content up to the CSS max-height, then scrolls. */
  autoGrowComposer(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  trackPollOption(idx: number, _item: string): number {
    return idx;
  }
}

import { Injectable, inject } from '@angular/core';
import { HttpEventType } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiService, EnvelopePayload, Message, MsgType } from './api.service';
import { CryptoService } from './crypto.service';
import { ServerCryptoService } from './server-crypto.service';

export interface SendTarget {
  userId?: number;
  groupId?: number;
}

export interface SendRequest {
  target: SendTarget;
  currentUserId: number;
  content: string;
  msgType: MsgType;
  files: File[];
  pollOptions?: string[];
  pollMultiple: boolean;
}

/**
 * What went out on the wire. Produced by `prepare`, consumed by `deliver`.
 *
 * `wireContent` is empty whenever the message was encrypted: the plaintext
 * travels only inside the ciphertext and, for direct chats, inside the per-device
 * envelopes. Sending it twice would defeat the point.
 */
export interface PreparedSend {
  wireContent: string;
  encryptedContent?: string;
  encryptedIV?: string;
  pushPreview?: string;
  envelope?: EnvelopePayload;
  groupEpoch: number;
  /** Envelope for the server scheme, produced by `prepare` when the pin is set. */
  serverEnvelope?: string;
}

export type PrepareResult =
  | { ok: true; prepared: PreparedSend }
  | { ok: false; reason: 'no-peer-key' | 'no-group-key' | 'no-server-key' };

export type DeliveryEvent =
  | { type: 'progress'; percent: number }
  | { type: 'done'; body: Message | undefined };

/**
 * Sending a message: encryption on the way out, and the call that carries it.
 *
 * Extracted on 2026-10-25. Two rules live here and are worth stating, because
 * both were violated before:
 *
 * - **Never fall back to plaintext.** If encryption returns nothing, the send is
 *   refused and the caller is told why. A message that quietly goes out in the
 *   clear is worse than one that does not go out.
 * - **A group without a key is not an error the user caused.** It is reported as
 *   `no-group-key` so the caller can ask the members for the key and retry by
 *   itself, rather than showing a dead end.
 *
 * The optimistic bubble is NOT created here. The caller owns the thread, the
 * scroll and the "pending" flag; this service only produces the bytes and makes
 * the call, which is what makes both testable without mounting the chat.
 */
@Injectable({ providedIn: 'root' })
export class ChatSendService {
  private readonly api = inject(ApiService);
  private readonly crypto = inject(CryptoService);
  private readonly serverCrypto = inject(ServerCryptoService);

  async prepare(req: SendRequest): Promise<PrepareResult> {
    // Only user-typed text is encrypted. Structural types - a sticker id, a gif
    // url, a poll question - stay in `content` because the server and the
    // renderer need to read them.
    const encryptable = (req.msgType === 'text' || req.msgType === 'image') && !!req.content;
    if (!encryptable) {
      return { ok: true, prepared: { wireContent: req.content, groupEpoch: 0 } };
    }

    // New scheme first. When this build pinned a server key, text goes out
    // wrapped to the server and the legacy fields are not used at all. A failure
    // to seal is an error, never a quiet return to the old path - that fallback
    // is the failure mode the layer exists to prevent.
    // Text only. The server accepts envelopes for text alone: a caption on an
    // image would otherwise be sealed while the file itself travels as before,
    // and the request is rejected - a whole message lost for a half-encrypted
    // shape nobody designed.
    if (this.serverCrypto.isEnabled() && req.msgType === 'text') {
      const sealed = await this.serverCrypto.sealForServer(req.content);
      if (!sealed) {
        return { ok: false, reason: 'no-server-key' };
      }
      return {
        ok: true,
        prepared: {
          wireContent: '',
          serverEnvelope: JSON.stringify(sealed.envelope),
          pushPreview: req.content.length > 120 ? req.content.slice(0, 120) + '...' : req.content,
          groupEpoch: 0,
        },
      };
    }

    await this.crypto.init();

    let result: { encrypted: string; iv: string } | null = null;
    let groupEpoch = 0;

    if (req.target.userId) {
      result = await this.crypto.encrypt(req.currentUserId, req.target.userId, req.content);
    } else if (req.target.groupId) {
      groupEpoch = await this.crypto.getCurrentGroupEpoch(req.target.groupId);
      result = await this.crypto.encryptGroupMessage(req.target.groupId, req.content, groupEpoch);
    }

    if (!result) {
      return { ok: false, reason: req.target.groupId ? 'no-group-key' : 'no-peer-key' };
    }

    const prepared: PreparedSend = {
      wireContent: '',
      encryptedContent: result.encrypted,
      encryptedIV: result.iv,
      pushPreview: req.content.length > 120 ? req.content.slice(0, 120) + '...' : req.content,
      groupEpoch,
    };

    if (req.target.userId) {
      // Additive: the legacy fields above stay for older clients.
      prepared.envelope = (await this.crypto.buildEnvelopes(req.content, req.target.userId)) ?? undefined;
    }

    return { ok: true, prepared };
  }

  /** Makes the call: upload progress when there are files, plain JSON otherwise. */
  deliver(req: SendRequest, prepared: PreparedSend): Observable<DeliveryEvent> {
    const hasFiles = req.files.length > 0;

    const request$ = (req.target.groupId
      ? hasFiles
        ? this.api.sendGroupMessageWithProgress(req.target.groupId, prepared.wireContent, req.files, req.msgType,
            prepared.encryptedContent, prepared.encryptedIV, prepared.pushPreview, req.pollOptions, req.pollMultiple, prepared.groupEpoch)
        : this.api.sendGroupMessage(req.target.groupId, prepared.wireContent, req.files, req.msgType,
            prepared.encryptedContent, prepared.encryptedIV, prepared.pushPreview, req.pollOptions, req.pollMultiple, prepared.groupEpoch)
      : hasFiles
        ? this.api.sendMessageWithProgress(req.target.userId!, prepared.wireContent, req.files, req.msgType,
            prepared.encryptedContent, prepared.encryptedIV, prepared.pushPreview, req.pollOptions, req.pollMultiple, prepared.envelope, prepared.serverEnvelope)
        : this.api.sendMessage(req.target.userId!, prepared.wireContent, req.files, req.msgType,
            prepared.encryptedContent, prepared.encryptedIV, prepared.pushPreview, req.pollOptions, req.pollMultiple, prepared.envelope, prepared.serverEnvelope)) as Observable<unknown>;

    return request$.pipe(
      map((event: unknown): DeliveryEvent => {
        if (hasFiles) {
          const e = event as { type: number; loaded?: number; total?: number; body?: Message };
          if (e.type === HttpEventType.UploadProgress) {
            const percent = e.total ? Math.round(100 * (e.loaded ?? 0) / e.total) : 0;
            return { type: 'progress', percent };
          }
          return { type: 'done', body: e.body };
        }
        return { type: 'done', body: event as Message | undefined };
      }),
    );
  }
}

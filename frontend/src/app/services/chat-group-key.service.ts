import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { CryptoService } from './crypto.service';

/**
 * Group key epochs and distribution.
 *
 * Extracted on 2026-10-25, and it is the part where the races live. Two are
 * worth naming, because both were real:
 *
 * 1. **The local epoch must never go backwards.** The server's answer can be
 *    older than what the device already holds - a second tab, a refetch that
 *    started before a rotation, a peer's stale reply. Setting it unconditionally
 *    would make the device try to decrypt new messages with the previous key and
 *    show "[Зашифрованное сообщение]" until the next reload.
 * 2. **Asking for a key must happen once per group per session.** Every message
 *    that fails to decrypt used to trigger another request; with a few members
 *    reading at once that becomes a storm over the websocket. A failed request
 *    does clear the guard, so a retry is still possible.
 */
@Injectable({ providedIn: 'root' })
export class ChatGroupKeyService {
  private readonly api = inject(ApiService);
  private readonly crypto = inject(CryptoService);

  /** Groups we have already asked for a key on. */
  private readonly requestedForRead = new Set<number>();

  /**
   * Brings the local epoch up to the server's, if the server is ahead, and
   * reports whether a usable key exists afterwards.
   *
   * Deliberately tolerant: any failure leaves the device on its current epoch
   * rather than clearing it.
   */
  async syncEpoch(groupId: number): Promise<{ epoch: number; hadKey: boolean }> {
    try {
      const { epoch } = await firstValueFrom(this.api.getGroupKeyEpoch(groupId));
      const localEpoch = await this.crypto.getCurrentGroupEpoch(groupId);

      if (epoch > localEpoch) {
        const fetched = await this.crypto.getGroupKey(groupId, epoch);
        // Only commit the move once the key is actually here. Advancing the epoch
        // without it makes the device claim a key it cannot use.
        if (fetched) {
          await this.crypto.setCurrentGroupEpoch(groupId, epoch);
        }
      }
    } catch {
      // Keep whatever epoch we have.
    }

    const epochNow = await this.crypto.getCurrentGroupEpoch(groupId);
    const key = await this.crypto.getGroupKey(groupId, epochNow);
    return { epoch: epochNow, hadKey: !!key };
  }

  /** Asks other members for the key, at most once per group. */
  requestKeyOnce(groupId: number): void {
    if (this.requestedForRead.has(groupId)) return;
    this.requestedForRead.add(groupId);
    this.api.requestGroupKey(groupId).subscribe({
      error: () => {
        // Leave the group unguarded so a later attempt can go out.
        this.requestedForRead.delete(groupId);
      },
    });
  }

  /** The key arrived, so a later loss must be able to ask again. */
  allowRequest(groupId: number): void {
    this.requestedForRead.delete(groupId);
  }

  /** Test hook: forget what has been asked for. */
  resetRequested(): void {
    this.requestedForRead.clear();
  }

  /**
   * Wraps the current group key for every member and every device.
   *
   * User-level shares reach all linked devices of a member (legacy clients);
   * device-level shares also reach devices that were never linked. Both are sent,
   * because dropping either leaves someone unable to read.
   */
  async distributeToMembers(groupId: number, currentUserId: number): Promise<void> {
    try {
      const res = await firstValueFrom(this.api.getGroupChat(groupId));
      const epoch = await this.crypto.getCurrentGroupEpoch(groupId);
      const raw = await this.crypto.getRawGroupKey(groupId, epoch);
      if (!raw) return;

      for (const member of res.members) {
        if (member.user_id === currentUserId) continue;

        const share = await this.crypto.encryptGroupKeyForPeer(raw, member.user_id);
        if (share) {
          this.api.uploadGroupKeyShare(groupId, member.user_id, share.encrypted_key, share.iv)
            .subscribe({ error: () => {} });
        }
        await this.distributeToMemberDevices(groupId, member.user_id, raw, epoch);
      }

      // Our own other devices.
      await this.distributeToMemberDevices(groupId, currentUserId, raw, epoch);
    } catch {
      // Distribution is best-effort: the next open retries it.
    }
  }

  async distributeToMemberDevices(
    groupId: number, userId: number, raw: Uint8Array, epoch: number,
  ): Promise<void> {
    try {
      const devices = await firstValueFrom(this.api.getUserDeviceKeys(userId));
      for (const d of devices || []) {
        if (!d.device_id || !d.device_public_key) continue;
        const wrapped = await this.crypto.wrapKeyForDeviceFromDevice(raw, d.device_public_key);
        if (wrapped) {
          this.api.uploadGroupDeviceKeyShare(groupId, userId, d.device_id, wrapped.wrapped_key, wrapped.iv, epoch)
            .subscribe({ error: () => {} });
        }
      }
    } catch {
      // Best-effort per member.
    }
  }
}

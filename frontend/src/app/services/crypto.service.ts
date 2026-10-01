import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { firstValueFrom } from 'rxjs';

const DB_NAME = 'MeowChatCrypto';
const DB_VERSION = 1;
const KEY_STORE = 'keys';
const KEY_NAME = 'identity-key';

@Injectable({ providedIn: 'root' })
export class CryptoService {
  private db: IDBDatabase | null = null;
  private peerKeysCache = new Map<number, CryptoKey>();
  private sharedSecrets = new Map<string, CryptoKey>(); // "ourID:peerID" → AES key
  private initPromise: Promise<void> | null = null;

  constructor(private api: ApiService) {}

  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(KEY_STORE)) {
          db.createObjectStore(KEY_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async getStore(mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
    if (!this.db) {
      this.db = await this.openDB();
    }
    return this.db.transaction(KEY_STORE, mode).objectStore(KEY_STORE);
  }

  private async get<T>(key: string): Promise<T | null> {
    const store = await this.getStore('readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  private async set(key: string, value: unknown): Promise<void> {
    const store = await this.getStore('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.ensureIdentityKey();
    return this.initPromise;
  }

  private async ensureIdentityKey(): Promise<void> {
    const existing = await this.get<JsonWebKey>('identityKeyJWK');
    if (existing) return;

    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits'],
    );

    const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey!);
    // Stored as a JSON string (consistent with importIdentityKey and backups).
    await this.set('identityKeyJWK', JSON.stringify(jwk));

    const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(spki)));

    await this.set('publicKeySPKI', publicKeyBase64);

    try {
      await firstValueFrom(this.api.putKey(publicKeyBase64));
    } catch {
      console.warn('Failed to upload E2E public key to server');
    }
  }

  async getPublicKey(): Promise<string | null> {
    await this.init();
    return this.get<string>('publicKeySPKI');
  }

  /** Identity JWK as a JSON string (handles the legacy object form too). */
  private async getIdentityJWKString(): Promise<string | null> {
    const stored = await this.get<string | JsonWebKey>('identityKeyJWK');
    if (!stored) return null;
    return typeof stored === 'string' ? stored : JSON.stringify(stored);
  }

  async exportIdentityJWK(): Promise<string | null> {
    return this.getIdentityJWKString();
  }

  private async getMyPrivateKey(): Promise<CryptoKey | null> {
    const raw = await this.getIdentityJWKString();
    if (!raw) return null;
    const jwk = JSON.parse(raw) as JsonWebKey;
    return crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey', 'deriveBits'],
    );
  }

  async fetchPeerPublicKey(peerId: number): Promise<CryptoKey | null> {
    const cached = this.peerKeysCache.get(peerId);
    if (cached) return cached;

    try {
      const res = await firstValueFrom(this.api.getKey(peerId));
      const spkiBytes = Uint8Array.from(atob(res.public_key), c => c.charCodeAt(0));
      const key = await crypto.subtle.importKey(
        'spki', spkiBytes.buffer,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        [],
      );
      this.peerKeysCache.set(peerId, key);
      return key;
    } catch {
      return null;
    }
  }

  /** Derive (or get cached) AES-256-GCM key for (myId, peerId) pair */
  async getSharedKey(myId: number, peerId: number): Promise<CryptoKey | null> {
    const cacheKey = `${Math.min(myId, peerId)}:${Math.max(myId, peerId)}`;
    const cached = this.sharedSecrets.get(cacheKey);
    if (cached) return cached;

    const myPriv = await this.getMyPrivateKey();
    const peerPub = await this.fetchPeerPublicKey(peerId);
    if (!myPriv || !peerPub) return null;

    const sharedKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: peerPub },
      myPriv,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );

    this.sharedSecrets.set(cacheKey, sharedKey);
    return sharedKey;
  }

  /** Encrypt plaintext using AES-256-GCM with the shared key for (myId, peerId) */
  async encrypt(myId: number, peerId: number, plaintext: string): Promise<{ encrypted: string; iv: string } | null> {
    const key = await this.getSharedKey(myId, peerId);
    if (!key) return null;

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded,
    );

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return {
      encrypted: btoa(String.fromCharCode(...combined)),
      iv: btoa(String.fromCharCode(...iv)),
    };
  }

  /** Decrypt ciphertext using AES-256-GCM with the shared key for (myId, peerId) */
  async decrypt(myId: number, peerId: number, encryptedBase64: string, ivBase64: string): Promise<string | null> {
    const key = await this.getSharedKey(myId, peerId);
    if (!key) return null;

    try {
      const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
      const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
      const ciphertext = combined.subarray(12);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext,
      );
      return new TextDecoder().decode(plaintext);
    } catch {
      return null;
    }
  }

  /** Re-upload public key to server (e.g. after re-login on new device) */
  async syncPublicKey(): Promise<void> {
    const pubKey = await this.getPublicKey();
    if (!pubKey) return;
    try {
      await firstValueFrom(this.api.putKey(pubKey));
    } catch {
      console.warn('Failed to sync public key');
    }
  }

  // ─── Group E2EE ─────────────────────────────────────────────

  // Cache is keyed by `${groupId}:${epoch}`.
  private groupKeyCache = new Map<string, CryptoKey>();

  private groupKeyStoreKey(groupId: number, epoch: number): string {
    return `groupKeyRaw_${groupId}__${epoch}`;
  }

  private async readRawGroupKey(groupId: number, epoch: number): Promise<number[] | null> {
    const stored = await this.get<number[]>(this.groupKeyStoreKey(groupId, epoch));
    if (stored) return stored;
    if (epoch === 0) {
      // Legacy single-key storage.
      return await this.get<number[]>(`groupKeyRaw_${groupId}`);
    }
    return null;
  }

  private async writeRawGroupKey(groupId: number, epoch: number, raw: Uint8Array): Promise<void> {
    await this.set(this.groupKeyStoreKey(groupId, epoch), Array.from(raw));
    if (epoch === 0) {
      // Keep the legacy key readable by older code paths.
      await this.set(`groupKeyRaw_${groupId}`, Array.from(raw));
    }
  }

  async getCurrentGroupEpoch(groupId: number): Promise<number> {
    return (await this.get<number>(`groupEpoch_${groupId}`)) ?? 0;
  }

  async setCurrentGroupEpoch(groupId: number, epoch: number): Promise<void> {
    await this.set(`groupEpoch_${groupId}`, epoch);
  }

  /** Generate a random AES-256-GCM group key for an epoch and store it locally. */
  async generateGroupKey(groupId: number, epoch = 0): Promise<Uint8Array | null> {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey(
      'raw', raw,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );
    await this.writeRawGroupKey(groupId, epoch, raw);
    this.groupKeyCache.set(`${groupId}:${epoch}`, key);
    const current = await this.getCurrentGroupEpoch(groupId);
    if (epoch >= current) await this.setCurrentGroupEpoch(groupId, epoch);
    return raw;
  }

  /** Get (from cache or derive from server share) the group AES key for an epoch. */
  async getGroupKey(groupId: number, epoch = 0): Promise<CryptoKey | null> {
    const cacheKey = `${groupId}:${epoch}`;
    const cached = this.groupKeyCache.get(cacheKey);
    if (cached) return cached;

    const stored = await this.readRawGroupKey(groupId, epoch);
    if (stored) {
      const key = await crypto.subtle.importKey(
        'raw', new Uint8Array(stored),
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt'],
      );
      this.groupKeyCache.set(cacheKey, key);
      return key;
    }

    // Device-scoped share: self-sufficient, works even when this device has a
    // different identity key than the rest of the account.
    const deviceKey = await this.tryGetDeviceGroupKey(groupId, epoch);
    if (deviceKey) return deviceKey;

    // Legacy user-level share only exists for epoch 0.
    if (epoch !== 0) return null;

    try {
      const share = await firstValueFrom(this.api.getMyGroupKeyShare(groupId));
      const myId = this.api.currentUser()?.id;
      if (!myId) return null;

      // The share is encrypted with the ECDH key between us and some member;
      // try every known member's key.
      const groupInfo = await firstValueFrom(this.api.getGroupChat(groupId));
      for (const member of groupInfo.members) {
        if (member.user_id === myId) continue;
        const sharedKey = await this.getSharedKey(myId, member.user_id);
        if (!sharedKey) continue;

        const iv = Uint8Array.from(atob(share.iv), c => c.charCodeAt(0));
        const combined = Uint8Array.from(atob(share.encrypted_key), c => c.charCodeAt(0));
        const ciphertext = combined.subarray(12);

        try {
          const rawKey = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            sharedKey,
            ciphertext,
          );
          const rawBytes = new Uint8Array(rawKey);
          const key = await crypto.subtle.importKey(
            'raw', rawBytes,
            { name: 'AES-GCM' },
            false,
            ['encrypt', 'decrypt'],
          );
          await this.writeRawGroupKey(groupId, 0, rawBytes);
          this.groupKeyCache.set(cacheKey, key);
          return key;
        } catch {
          continue; // try next member
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Encrypt a group key's raw bytes for a specific peer using ECDH shared secret */
  async encryptGroupKeyForPeer(rawKeyBytes: Uint8Array, peerId: number): Promise<{ encrypted_key: string; iv: string } | null> {
    const myId = this.api.currentUser()?.id;
    if (!myId) return null;

    const sharedKey = await this.getSharedKey(myId, peerId);
    if (!sharedKey) return null;

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      sharedKey,
      rawKeyBytes,
    );

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return {
      encrypted_key: btoa(String.fromCharCode(...combined)),
      iv: btoa(String.fromCharCode(...iv)),
    };
  }

  /** Encrypt a group message using the group's AES-256-GCM key for an epoch */
  async encryptGroupMessage(groupId: number, plaintext: string, epoch = 0): Promise<{ encrypted: string; iv: string } | null> {
    const key = await this.getGroupKey(groupId, epoch);
    if (!key) return null;

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded,
    );

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return {
      encrypted: btoa(String.fromCharCode(...combined)),
      iv: btoa(String.fromCharCode(...iv)),
    };
  }

  /** Fetch our device-scoped group key share for an epoch and unwrap it. */
  private async tryGetDeviceGroupKey(groupId: number, epoch = 0): Promise<CryptoKey | null> {
    if (!this.deviceKeyPair || !this.deviceId) await this.ensureDeviceKeyPair();
    if (!this.deviceId) return null;
    try {
      const share = await firstValueFrom(this.api.getMyGroupDeviceKeyShare(groupId, this.deviceId, epoch));
      if (!share.creator_id || !share.encrypted_key) return null;
      const spki = (await firstValueFrom(this.api.getKey(share.creator_id))).public_key;
      if (!spki) return null;
      const raw = await this.unwrapKeyFromDevice(share.encrypted_key, share.iv, spki);
      if (!raw) return null;
      const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      await this.writeRawGroupKey(groupId, epoch, raw);
      this.groupKeyCache.set(`${groupId}:${epoch}`, key);
      return key;
    } catch {
      return null;
    }
  }

  /** Get raw 32-byte key for a group epoch (for re-encrypting for members) */
  async getRawGroupKey(groupId: number, epoch = 0): Promise<Uint8Array | null> {
    const stored = await this.readRawGroupKey(groupId, epoch);
    if (stored) return new Uint8Array(stored);

    // Try to derive from server share (triggers full getGroupKey flow)
    const key = await this.getGroupKey(groupId, epoch);
    if (!key) return null;

    const re = await this.readRawGroupKey(groupId, epoch);
    return re ? new Uint8Array(re) : null;
  }

  // ─── Multi-Device Key Sync ─────────────────────────────────────

  private deviceKeyPair: CryptoKeyPair | null = null;
  deviceId: string = '';
  deviceName: string = '';

  async ensureDeviceKeyPair(): Promise<void> {
    const stored = await this.get<string>('deviceKeyJWK');
    const storedPub = await this.get<string>('devicePublicKeySPKI');
    if (stored && storedPub) {
      const jwk = JSON.parse(stored);
      this.deviceKeyPair = {
        privateKey: await crypto.subtle.importKey(
          'jwk', jwk,
          { name: 'ECDH', namedCurve: 'P-256' },
          false,
          ['deriveKey', 'deriveBits'],
        ),
        publicKey: await crypto.subtle.importKey(
          'spki', this.base64ToArrayBuffer(storedPub),
          { name: 'ECDH', namedCurve: 'P-256' },
          true,
          [],
        ),
      };
      this.deviceId = (await this.get<string>('deviceId')) || '';
      return;
    }

    // Extractable is required: the private JWK is persisted to IndexedDB and the
    // public SPKI is used for wrapping keys to this device.
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits'],
    ) as CryptoKeyPair;

    const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    const pubB64 = btoa(String.fromCharCode(...new Uint8Array(spki)));

    await this.set('deviceKeyJWK', JSON.stringify(jwk));
    await this.set('devicePublicKeySPKI', pubB64);

    const deviceId = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    await this.set('deviceId', deviceId);
    this.deviceId = deviceId;

    this.deviceKeyPair = keyPair;
  }

  async getDevicePublicKeySPKI(): Promise<string> {
    const stored = await this.get<string>('devicePublicKeySPKI');
    if (stored) return stored;
    await this.ensureDeviceKeyPair();
    return (await this.get<string>('devicePublicKeySPKI')) || '';
  }

  async encryptIdentityKeyForDevice(deviceSPKI: string): Promise<{ encrypted: string; iv: string } | null> {
    if (!this.deviceKeyPair) await this.ensureDeviceKeyPair();
    if (!this.deviceKeyPair) return null;

    const spkiBytes = Uint8Array.from(atob(deviceSPKI), c => c.charCodeAt(0));
    const peerPubKey = await crypto.subtle.importKey(
      'spki', spkiBytes.buffer,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      [],
    );

    const sharedKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: peerPubKey },
      this.deviceKeyPair.privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );

    const identityJWK = await this.getIdentityJWKString();
    if (!identityJWK) return null;

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(identityJWK);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      sharedKey,
      encoded,
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    return {
      encrypted: btoa(String.fromCharCode(...combined)),
      iv: btoa(String.fromCharCode(...iv)),
    };
  }

  async decryptIdentityKeyFromDevice(encryptedB64: string, ivB64: string, myDeviceSPKI: string): Promise<string | null> {
    if (!this.deviceKeyPair) await this.ensureDeviceKeyPair();
    if (!this.deviceKeyPair) return null;

    // Use the request's device_public_key (the trusted device's key) as peer
    const spkiBytes = Uint8Array.from(atob(myDeviceSPKI), c => c.charCodeAt(0));
    const peerPubKey = await crypto.subtle.importKey(
      'spki', spkiBytes.buffer,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      [],
    );

    const sharedKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: peerPubKey },
      this.deviceKeyPair.privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );

    const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
    const combined = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
    const ciphertext = combined.subarray(12);

    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        sharedKey,
        ciphertext,
      );
      return new TextDecoder().decode(plaintext);
    } catch {
      return null;
    }
  }

  async importIdentityKey(jwkJson: string): Promise<void> {
    const jwk = JSON.parse(jwkJson);
    const privateKey = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey', 'deriveBits'],
    );
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true } as JsonWebKey,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      [],
    );
    const spki = await crypto.subtle.exportKey('spki', publicKey);
    const pubB64 = btoa(String.fromCharCode(...new Uint8Array(spki)));

    await this.set('identityKeyJWK', jwkJson);
    await this.set('publicKeySPKI', pubB64);
  }

  async hasIdentityKey(): Promise<boolean> {
    return !!(await this.get<string>('identityKeyJWK'));
  }

  private base64ToArrayBuffer(b64: string): ArrayBuffer {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
  }

  /** Decrypt a group message using the group's AES-256-GCM key */
  async decryptGroupMessage(groupId: number, encryptedBase64: string, ivBase64: string, epoch = 0): Promise<string | null> {
    const key = await this.getGroupKey(groupId, epoch);
    if (!key) return null;

    try {
      const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
      const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
      const ciphertext = combined.subarray(12);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext,
      );
      return new TextDecoder().decode(plaintext);
    } catch {
      return null;
    }
  }

  // ─── Per-device envelopes (DM) ─────────────────────────────────

  private randomKey(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
  }

  /** Encrypt text with a raw AES-256-GCM key. */
  async encryptWithRawKey(rawKey: Uint8Array, plaintext: string): Promise<{ encrypted: string; iv: string }> {
    const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return { encrypted: btoa(String.fromCharCode(...combined)), iv: btoa(String.fromCharCode(...iv)) };
  }

  async decryptWithRawKey(rawKey: Uint8Array, encryptedBase64: string, ivBase64: string): Promise<string | null> {
    try {
      const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
      const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
      const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined.subarray(12));
      return new TextDecoder().decode(plaintext);
    } catch {
      return null;
    }
  }

  /** Wrap a content key for a recipient device: ECDH(myIdentityPriv, devicePub). */
  async wrapKeyForDevice(rawKey: Uint8Array, devicePubSPKI: string): Promise<{ wrapped_key: string; iv: string } | null> {
    const myPriv = await this.getMyPrivateKey();
    if (!myPriv) return null;
    try {
      const spki = Uint8Array.from(atob(devicePubSPKI), c => c.charCodeAt(0));
      const devicePub = await crypto.subtle.importKey('spki', spki.buffer, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
      const shared = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: devicePub }, myPriv,
        { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, shared, rawKey);
      const combined = new Uint8Array(iv.length + ciphertext.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(ciphertext), iv.length);
      return { wrapped_key: btoa(String.fromCharCode(...combined)), iv: btoa(String.fromCharCode(...iv)) };
    } catch {
      return null;
    }
  }

  /** Unwrap a content key: ECDH(myDevicePriv, senderIdentityPub). */
  async unwrapKeyFromDevice(wrappedB64: string, ivB64: string, senderIdentitySPKI: string): Promise<Uint8Array | null> {
    if (!this.deviceKeyPair || !this.deviceId) await this.ensureDeviceKeyPair();
    if (!this.deviceKeyPair) return null;
    try {
      const spki = Uint8Array.from(atob(senderIdentitySPKI), c => c.charCodeAt(0));
      const senderPub = await crypto.subtle.importKey('spki', spki.buffer, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
      const shared = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: senderPub }, this.deviceKeyPair.privateKey,
        { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
      );
      const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
      const combined = Uint8Array.from(atob(wrappedB64), c => c.charCodeAt(0));
      const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, shared, combined.subarray(12));
      return new Uint8Array(raw);
    } catch {
      return null;
    }
  }

  /** Wrap a content key with our device private key: ECDH(myDevicePriv, devicePub). */
  async wrapKeyForDeviceFromDevice(rawKey: Uint8Array, devicePubSPKI: string): Promise<{ wrapped_key: string; iv: string } | null> {
    if (!this.deviceKeyPair || !this.deviceId) await this.ensureDeviceKeyPair();
    if (!this.deviceKeyPair) return null;
    try {
      const spki = Uint8Array.from(atob(devicePubSPKI), c => c.charCodeAt(0));
      const devicePub = await crypto.subtle.importKey('spki', spki.buffer, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
      const shared = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: devicePub }, this.deviceKeyPair.privateKey,
        { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, shared, rawKey);
      const combined = new Uint8Array(iv.length + ciphertext.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(ciphertext), iv.length);
      return { wrapped_key: btoa(String.fromCharCode(...combined)), iv: btoa(String.fromCharCode(...iv)) };
    } catch {
      return null;
    }
  }

  /**
   * Build a per-device envelope payload for a DM: encrypt under a fresh content
   * key and wrap that key for the recipient's devices and our own devices using
   * our device key (not the account identity key), so it works per device.
   * Returns null when no device keys are available (caller falls back to legacy).
   */
  async buildEnvelopes(plaintext: string, peerId: number): Promise<{
    env_content: string;
    env_iv: string;
    sender_device_id: string;
    envelopes: { device_id: string; wrapped_key: string; iv: string }[];
  } | null> {
    const myId = this.api.currentUser()?.id;
    if (!myId) return null;
    await this.ensureDeviceKeyPair();
    if (!this.deviceId) return null;

    const rawKey = this.randomKey();
    const enc = await this.encryptWithRawKey(rawKey, plaintext);

    const targets: { device_id: string; device_public_key: string }[] = [];
    try {
      const [peerDevices, myDevices] = await Promise.all([
        firstValueFrom(this.api.getUserDeviceKeys(peerId)),
        firstValueFrom(this.api.getUserDeviceKeys(myId)),
      ]);
      targets.push(...(peerDevices || []), ...(myDevices || []));
    } catch { /* no devices available */ }
    if (targets.length === 0) return null;

    const envelopes: { device_id: string; wrapped_key: string; iv: string }[] = [];
    const seen = new Set<string>();
    for (const d of targets) {
      if (!d.device_id || !d.device_public_key || seen.has(d.device_id)) continue;
      seen.add(d.device_id);
      const wrapped = await this.wrapKeyForDeviceFromDevice(rawKey, d.device_public_key);
      if (wrapped) envelopes.push({ device_id: d.device_id, wrapped_key: wrapped.wrapped_key, iv: wrapped.iv });
    }
    if (envelopes.length === 0) return null;
    return { env_content: enc.encrypted, env_iv: enc.iv, sender_device_id: this.deviceId, envelopes };
  }

  /** Decrypt a DM via a per-device envelope; null when not applicable. */
  async decryptViaEnvelope(
    envelopes: { device_id: string; wrapped_key: string; iv: string }[] | undefined,
    envContent: string | undefined,
    envIv: string | undefined,
    senderId: number,
    senderDeviceId?: string,
  ): Promise<string | null> {
    if (!envelopes?.length || !envContent || !envIv) return null;
    if (!this.deviceKeyPair || !this.deviceId) await this.ensureDeviceKeyPair();
    const mine = envelopes.find(e => e.device_id === this.deviceId);
    if (!mine) return null;

    let senderPub: string | null = null;
    if (senderDeviceId) {
      try {
        const devices = await firstValueFrom(this.api.getUserDeviceKeys(senderId));
        senderPub = devices?.find(d => d.device_id === senderDeviceId)?.device_public_key ?? null;
      } catch { /* fall back to identity key below */ }
    }
    if (!senderPub) {
      // Envelopes created before per-device sender keys used the account identity.
      try {
        senderPub = (await firstValueFrom(this.api.getKey(senderId))).public_key;
      } catch {
        return null;
      }
    }
    if (!senderPub) return null;
    const rawKey = await this.unwrapKeyFromDevice(mine.wrapped_key, mine.iv, senderPub);
    if (!rawKey) return null;
    return this.decryptWithRawKey(rawKey, envContent, envIv);
  }

  // ─── Key backup / recovery (Phase 4) ───────────────────────────

  private async deriveKek(secret: string, saltBytes: Uint8Array, iterations: number): Promise<CryptoKey> {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  /**
   * Encrypt our identity key with a password/phrase-derived key. Matches the
   * server recovery scheme: PBKDF2-HMAC-SHA256 + AES-256-GCM, with the salt's
   * UTF-8 bytes (the salt itself is transmitted as a string) as PBKDF2 salt.
   */
  async createKeyBackup(secret: string, iterations = 100000): Promise<{ encrypted_key: string; iv: string; salt: string; hash_iterations: number } | null> {
    await this.init();
    const jwk = await this.getIdentityJWKString();
    if (!jwk) return null;

    const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    const kek = await this.deriveKek(secret, new TextEncoder().encode(salt), iterations);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, new TextEncoder().encode(jwk));

    return {
      encrypted_key: btoa(String.fromCharCode(...new Uint8Array(ct))),
      iv: btoa(String.fromCharCode(...iv)),
      salt,
      hash_iterations: iterations,
    };
  }
}

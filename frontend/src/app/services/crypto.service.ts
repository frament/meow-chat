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
    await this.set('identityKeyJWK', jwk);

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

  private async getMyPrivateKey(): Promise<CryptoKey | null> {
    const jwk = await this.get<JsonWebKey>('identityKeyJWK');
    if (!jwk) return null;
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

  private groupKeyCache = new Map<number, CryptoKey>();

  /** Generate a random AES-256-GCM group key and cache it locally. Returns raw key bytes. */
  async generateGroupKey(groupId: number): Promise<Uint8Array | null> {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey(
      'raw', raw,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );
    await this.set(`groupKeyRaw_${groupId}`, Array.from(raw));
    this.groupKeyCache.set(groupId, key);
    return raw;
  }

  /** Get (from cache or derive from server share) the group AES key */
  async getGroupKey(groupId: number): Promise<CryptoKey | null> {
    const cached = this.groupKeyCache.get(groupId);
    if (cached) return cached;

    const stored = await this.get<number[]>(`groupKeyRaw_${groupId}`);
    if (stored) {
      const key = await crypto.subtle.importKey(
        'raw', new Uint8Array(stored),
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt'],
      );
      this.groupKeyCache.set(groupId, key);
      return key;
    }

    // Fetch share from server
    try {
      const share = await firstValueFrom(this.api.getMyGroupKeyShare(groupId));
      const myId = this.api.currentUser()?.id;
      if (!myId) return null;

      // Find who shared this key (we need the sender's ID)
      // The share's creator is any group member — we need to try all members
      // Actually, the share is encrypted with the ECDH key between us and the creator
      // We don't know the creator from just the endpoint.
      // We need to try with all group members' public keys
      // For simplicity, we store the key_creator_id in the share
      // But our API doesn't return it.
      //
      // Option: Use a deterministic approach — always encrypt for user with
      // the same key pair (the key creator is implicit: the one who uploaded the share)
      // We don't have that info from our current API.
      //
      // Let's try decrypting with every known peer key
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
          await this.set(`groupKeyRaw_${groupId}`, Array.from(rawBytes));
          this.groupKeyCache.set(groupId, key);
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

  /** Encrypt a group message using the group's AES-256-GCM key */
  async encryptGroupMessage(groupId: number, plaintext: string): Promise<{ encrypted: string; iv: string } | null> {
    const key = await this.getGroupKey(groupId);
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

  /** Get raw 32-byte key for a group (for re-encrypting for new members) */
  async getRawGroupKey(groupId: number): Promise<Uint8Array | null> {
    const stored = await this.get<number[]>(`groupKeyRaw_${groupId}`);
    if (stored) return new Uint8Array(stored);

    // Try to derive from server share (triggers full getGroupKey flow)
    const key = await this.getGroupKey(groupId);
    if (!key) return null;

    // Re-fetch after caching
    const re = await this.get<number[]>(`groupKeyRaw_${groupId}`);
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

    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
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

    const identityJWK = await this.get<string>('identityKeyJWK');
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
  async decryptGroupMessage(groupId: number, encryptedBase64: string, ivBase64: string): Promise<string | null> {
    const key = await this.getGroupKey(groupId);
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
}

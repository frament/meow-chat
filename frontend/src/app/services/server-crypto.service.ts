import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

/**
 * Pinned fingerprint of the server's X25519 key: base64(SHA-256(raw 32 bytes)).
 *
 * Taken from `GET /api/crypto/server-key` on the deployment that owns the key -
 * the server generates its pair on first start, so this value cannot exist
 * before that. Filled 2026-10-25 for the home server.
 *
 * Empty means "not configured": the service then refuses to seal or open rather
 * than trusting whatever arrived on the channel. An empty pin that silently
 * behaved like a match would be worse than no pin at all - it would look like
 * protection. Changing this value requires rebuilding the client, which is the
 * trade-off the root/leaf scheme in v1.11.0 exists to remove.
 */
export const PINNED_SERVER_KEY_FINGERPRINT = '';

/** Wire format shared with `backend/messagecrypto`. Field names are load-bearing. */
export interface ServerEnvelope {
  v: number;
  kid: string;
  eph: string;
  salt: string;
  wrap_iv: string;
  wrapped_key: string;
  content_iv: string;
  ciphertext: string;
}

const WRAP_INFO = new TextEncoder().encode('meowchat/wrap/v1');
const ENVELOPE_VERSION = 1;
const DB_NAME = 'MeowChatServerCrypto';
const DB_VERSION = 1;
const STORE = 'keys';
const PRIVATE_KEY_ENTRY = 'receive-private';

/**
 * Client half of the client -> server encryption layer.
 *
 * Two keys, for two different reasons: the server's, pinned in the bundle, so a
 * substituted certificate or a direct plain-HTTP port cannot be used to read the
 * text; and the account's own, which the server wraps every incoming message to.
 * The second leg is the one that does not depend on TLS at all.
 */
@Injectable({ providedIn: 'root' })
export class ServerCryptoService {
  private accountPrivate: CryptoKey | null = null;
  private accountPublicB64: string | null = null;
  private db: IDBDatabase | null = null;
  /**
   * Copy of the build-time constant. A field rather than a direct read so a
   * test can point it at a throwaway key; in the app it always starts from the
   * constant and is never changed.
   */
  private pinned = PINNED_SERVER_KEY_FINGERPRINT;

  constructor(private readonly http: HttpClient) {}

  // ---- storage -------------------------------------------------------------

  private async openDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  // Public half is stored next to the private one: WebCrypto can derive it from
  // the private key, but not on demand from an imported raw key, and recomputing
  // it wrongly would silently wrap messages to a key nobody can open.
  private async readStored(): Promise<{ priv: Uint8Array; pub: Uint8Array } | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(PRIVATE_KEY_ENTRY);
      req.onsuccess = () => {
        const value = req.result;
        if (!value) return resolve(null);
        resolve({ priv: new Uint8Array(value.priv), pub: new Uint8Array(value.pub) });
      };
      req.onerror = () => reject(req.error);
    });
  }

  private async writeStored(priv: Uint8Array, pub: Uint8Array): Promise<void> {
    const db = await this.openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ priv, pub }, PRIVATE_KEY_ENTRY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---- account key ---------------------------------------------------------

  /**
   * Loads the account key, creating and registering it the first time.
   *
   * The created key is stored locally and registered once. Registering a second
   * different key is refused by the server on purpose: whoever holds a token
   * could otherwise point the account's key at themselves and receive the whole
   * history. That is a rotation, and rotation needs the password.
   */
  async ensureAccountKey(password?: string): Promise<void> {
    if (this.accountPrivate) return;

    const stored = await this.readStored();
    if (stored) {
      this.accountPrivate = await this.importPrivate(stored.priv);
      this.accountPublicB64 = b64(stored.pub);
      return;
    }

    // No local key. Another device may already have one for this account.
    const existing = await this.http
      .get<{ public_key: string; wrapped_private_key: string; kdf_salt: string }>(
        '/api/crypto/receive-key'
      )
      .toPromise()
      .catch(() => null);

    if (existing?.wrapped_private_key && password) {
      const raw = await this.unwrapPrivate(existing.wrapped_private_key, existing.kdf_salt, password);
      if (raw) {
        const pub = b64d(existing.public_key);
        await this.writeStored(raw, pub);
        this.accountPrivate = await this.importPrivate(raw);
        this.accountPublicB64 = existing.public_key;
        return;
      }
      // A wrong password here is not fatal for the session: the user can still
      // read everything the old scheme covers.
      return;
    }
    if (existing?.public_key) {
      // The account has a key but this device cannot open it without the
      // password. Do not create a second one - the server would refuse it, and
      // trying would look like a bug.
      return;
    }

    if (!password) return; // first setup needs the password to wrap the key

    const keyPair = (await crypto.subtle.generateKey({ name: 'X25519' } as any, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    // PKCS#8, not raw: Chrome refuses to export an X25519 private key as 'raw',
    // and the wrapped blob is exactly what another device has to import later.
    const rawPrivate = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
    const publicB64 = b64(new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey)));
    const wrapped = await this.wrapPrivate(rawPrivate, password);

    await this.http
      .post('/api/crypto/receive-key', {
        public_key: publicB64,
        wrapped_private_key: wrapped.wrapped,
        kdf_salt: wrapped.salt,
      })
      .toPromise()
      .catch(() => null);

    await this.writeStored(rawPrivate, b64d(publicB64));
    this.accountPrivate = keyPair.privateKey;
    this.accountPublicB64 = publicB64;
  }

  hasAccountKey(): boolean {
    return this.accountPrivate !== null;
  }

  getAccountPublicKey(): string | null {
    return this.accountPublicB64;
  }

  // ---- server key ----------------------------------------------------------

  /** Fetches the server key and refuses to continue unless it matches the pin. */
  async fetchServerKey(): Promise<{ kid: string; publicKey: Uint8Array } | null> {
    if (!this.pinned) {
      // Not configured. Sealing would produce content wrapped to a key nobody
      // verified, which reads as protection and is not.
      console.error('ServerCrypto: server key fingerprint is not pinned; refusing to use the layer');
      return null;
    }

    const info = await this.http
      .get<{ kid: string; public_key: string; fingerprint: string }>('/api/crypto/server-key')
      .toPromise()
      .catch(() => null);
    if (!info) return null;

    if (info.fingerprint !== this.pinned) {
      // Both values are shown: "pinned a1b2, got c3d4" is a substitution and the
      // app must not be updated; "pinned a1b2, got a1b2" with a newer bundle is
      // an outdated client. Telling them apart in the message is the difference
      // between a user who waits and a user who wipes their keys.
      console.error(
        `ServerCrypto: server key fingerprint mismatch. pinned=${this.pinned} received=${info.fingerprint}`
      );
      throw new Error('SERVER_KEY_MISMATCH');
    }

    return { kid: info.kid, publicKey: b64d(info.public_key) };
  }

  // ---- envelopes -----------------------------------------------------------

  /** Encrypts for the server. Null means "cannot", never "sent in the clear". */
  async sealForServer(plaintext: string): Promise<{ kid: string; envelope: ServerEnvelope } | null> {
    const serverKey = await this.fetchServerKey();
    if (!serverKey) return null;

    const recipient = await crypto.subtle.importKey(
      'raw',
      serverKey.publicKey,
      { name: 'X25519' } as any,
      false,
      []
    );

    const contentKey = crypto.getRandomValues(new Uint8Array(32));
    const contentIv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await aesGcmEncrypt(contentKey, contentIv, new TextEncoder().encode(plaintext));

    const eph = (await crypto.subtle.generateKey({ name: 'X25519' } as any, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const ephRaw = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
    const shared = new Uint8Array(
      await crypto.subtle.deriveBits({ name: 'X25519', public: recipient } as any, eph.privateKey, 256)
    );

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const kek = await hkdfKey(shared, salt);
    const wrapIv = crypto.getRandomValues(new Uint8Array(12));
    const wrappedKey = await aesGcmEncrypt(kek, wrapIv, contentKey);

    return {
      kid: serverKey.kid,
      envelope: {
        v: ENVELOPE_VERSION,
        kid: serverKey.kid,
        eph: b64(ephRaw),
        salt: b64(salt),
        wrap_iv: b64(wrapIv),
        wrapped_key: b64(wrappedKey),
        content_iv: b64(contentIv),
        ciphertext: b64(ciphertext),
      },
    };
  }

  /**
   * Is the layer configured for this build?
   *
   * The pin is a build-time constant, so this is a property of the deployment,
   * not a per-message choice. A build without a pin keeps the old path; a build
   * with one never falls back to it.
   */
  isEnabled(): boolean {
    return !!this.pinned;
  }

  /**
   * Replaces envelopes in a fetched thread with readable text.
   *
   * A message that cannot be opened keeps an empty content and is flagged
   * `needs_key`, the same state the server reports when the account has no key
   * yet. Both mean "there is text and this device cannot show it", which is the
   * honest shape - an empty bubble would read as deleted history.
   */
  async openMany(messages: any[]): Promise<any[]> {
    const out: any[] = [];
    for (const message of messages) {
      if (!message?.server_envelope) {
        out.push(message);
        continue;
      }
      const text = await this.openFromServer(message.server_envelope);
      out.push({
        ...message,
        content: text ?? '',
        server_envelope: undefined,
        needs_key: text === null ? true : message.needs_key,
      });
    }
    return out;
  }

  /** Opens an envelope addressed to this account. Null means unreadable, not empty. */
  async openFromServer(envelope: ServerEnvelope): Promise<string | null> {
    if (!this.accountPrivate) return null;
    if (envelope?.v !== ENVELOPE_VERSION) return null;

    try {
      const eph = await crypto.subtle.importKey('raw', b64d(envelope.eph), { name: 'X25519' } as any, false, []);
      const shared = new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: 'X25519', public: eph } as any,
          this.accountPrivate,
          256
        )
      );

      const kek = await hkdfKey(shared, b64d(envelope.salt));
      const contentKey = await aesGcmDecrypt(kek, b64d(envelope.wrap_iv), b64d(envelope.wrapped_key));
      if (!contentKey || contentKey.length !== 32) return null;

      const plaintext = await aesGcmDecrypt(contentKey, b64d(envelope.content_iv), b64d(envelope.ciphertext));
      return plaintext ? new TextDecoder().decode(plaintext) : null;
    } catch {
      // A failed authentication is not an empty message. The caller must be able
      // to tell the difference, so nothing is returned instead of ''.
      return null;
    }
  }

  // ---- key wrapping with the account password ------------------------------

  private async importPrivate(pkcs8: Uint8Array): Promise<CryptoKey> {
    return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' } as any, true, ['deriveBits']);
  }

  private async wrapPrivate(raw: Uint8Array, password: string): Promise<{ wrapped: string; salt: string }> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const kek = await pbkdf2Key(password, salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await aesGcmEncrypt(kek, iv, raw);
    // iv||ciphertext, the same shape the at-rest blob uses, so one decoder can
    // read it on the other side if it ever needs to.
    return { wrapped: b64(concat(iv, wrapped)), salt: b64(salt) };
  }

  private async unwrapPrivate(wrappedB64: string, saltB64: string, password: string): Promise<Uint8Array | null> {
    try {
      const blob = b64d(wrappedB64);
      const kek = await pbkdf2Key(password, b64d(saltB64));
      return await aesGcmDecrypt(kek, blob.slice(0, 12), blob.slice(12));
    } catch {
      return null;
    }
  }
}

// ---- primitives ------------------------------------------------------------

async function aesGcmEncrypt(key: CryptoKey | Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = key instanceof Uint8Array
    ? await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt'])
    : key;
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, data));
}

async function aesGcmDecrypt(key: CryptoKey | Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const cryptoKey = key instanceof Uint8Array
      ? await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt'])
      : key;
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, data));
  } catch {
    return null;
  }
}

async function hkdfKey(shared: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: WRAP_INFO },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function pbkdf2Key(password: string, salt: Uint8Array, iterations = 100000): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function b64(bytes: Uint8Array): string {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}

export function b64d(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

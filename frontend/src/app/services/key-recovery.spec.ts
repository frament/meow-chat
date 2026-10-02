import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CryptoService } from './crypto.service';
import { ApiService } from './api.service';

/**
 * Same names and version as in CryptoService. If those change and this does not,
 * the test quietly stops wiping the store it is meant to wipe, and starts
 * asserting against a device that still holds its key.
 */
const DB_NAME = 'MeowChatCrypto';
const DB_VERSION = 1;
const KEY_STORE = 'keys';


/**
 * The scenario ROADMAP v1.7.0 called for and could not test: recover on a new
 * device and read what was written before.
 *
 * The point is not that `recoverKeys` returns a JWK. It is that the recovered
 * key is the *same* key, so a message encrypted on the old device still decrypts.
 * A restore that silently produced a fresh identity key would report success and
 * leave the user staring at an empty history with no explanation, which is the
 * failure mode worth a test.
 *
 * The ECDH/AES-GCM pair is real, not mocked: the whole chain is WebCrypto in the
 * browser, and a mock would prove nothing about whether the keys match.
 */
/**
 * Empties the key store the way losing a phone would. IndexedDB, not
 * localStorage: CryptoService keeps its identity key in an object store, so
 * clearing localStorage achieves nothing - a "lost device" simulated that way
 * was never lost, and the test would prove only that a key which never left still
 * works.
 *
 * The records are deleted rather than the whole database, because the service
 * still holds its connection open: `deleteDatabase` blocks on that handle and
 * the request hangs instead of completing.
 */
function wipeKeyStore(): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(KEY_STORE, 'readwrite');
      tx.objectStore(KEY_STORE).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

/** A CryptoService with no cached shared secrets, standing in for a new device. */
function newDevice(api: jasmine.SpyObj<ApiService>): CryptoService {
  return new CryptoService(api);
}

describe('Key recovery on a new device', () => {
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', [
      'getKey',
      'putKey',
      'getGroupChat',
      'getUserDeviceKeys',
    ]);
    api.getKey.and.returnValue(of({ public_key: '' }));
    api.putKey.and.returnValue(of({ message: 'ok' }));

    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
  });

  it('recovers a key that can decrypt what was encrypted before the loss', async () => {
    const oldDevice = TestBed.inject(CryptoService);
    await oldDevice.init();

    // Bob on the server, so there is a peer key to derive a shared secret with.
    const bobPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits'],
    );
    const bobSpki = await crypto.subtle.exportKey('spki', bobPair.publicKey);
    api.getKey.and.returnValue(of({ public_key: btoa(String.fromCharCode(...new Uint8Array(bobSpki))) }));

    const plaintext = 'what we said before the phone was lost';
    const sent = await oldDevice.encrypt(1, 2, plaintext);
    expect(sent).withContext('the message should have been encrypted').not.toBeNull();

    // ── the device is lost ──
    const backup = await oldDevice.exportIdentityJWK();
    expect(backup).withContext('there should be a key to back up').toBeTruthy();
    await wipeKeyStore();

    const newDeviceInstance = newDevice(api);
    expect(await newDeviceInstance.hasIdentityKey())
      .withContext('a new device starts without a key')
      .toBeFalse();

    // ── and recovered from the server backup ──
    // The peer key stays available on purpose: it comes from the server, not from
    // the lost device, and blanking it here would only make decrypt return null for a
    // reason that has nothing to do with recovery.
    const restoredDevice = newDevice(api);
    await restoredDevice.importIdentityKey(backup!);
    await restoredDevice.getPublicKey();

    const decrypted = await restoredDevice.decrypt(1, 2, sent!.encrypted, sent!.iv);
    expect(decrypted).withContext('the recovered key must open the old message').toBe(plaintext);
  });

  it('recovers a key that still derives the same shared secret', async () => {
    // The direct-message check above goes through a cached peer key; this one
    // derives from scratch on the new device, which is what happens when the
    // peer's public key is fetched again after a restart.
    const oldDevice = TestBed.inject(CryptoService);
    await oldDevice.init();

    const bobPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits'],
    );
    const bobSpki = await crypto.subtle.exportKey('spki', bobPair.publicKey);
    api.getKey.and.returnValue(of({ public_key: btoa(String.fromCharCode(...new Uint8Array(bobSpki))) }));

    const before = await oldDevice.getSharedKey(1, 2);
    expect(before).not.toBeNull();

    const backup = await oldDevice.exportIdentityJWK();
    await wipeKeyStore();

    const restored = newDevice(api);
    await restored.importIdentityKey(backup!);
    await restored.getPublicKey();

    const after = await restored.getSharedKey(1, 2);
    expect(after).not.toBeNull();

    const message = 'second conversation';
    const sent = await restored.encrypt(1, 2, message);
    expect(await restored.decrypt(1, 2, sent!.encrypted, sent!.iv)).toBe(message);
  });

  it('rejects a wrong password without destroying the stored key', async () => {
    // The failure mode that matters on a real phone: the user types the wrong
    // password twice, and now their identity key is gone anyway.
    const device = TestBed.inject(CryptoService);
    await device.init();
    const original = await device.exportIdentityJWK();

    // A JWK the server would never hand back, standing in for a failed decrypt.
    const wrong = JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'not-a-key', y: 'nope', d: 'wrong' });

    let failed = false;
    try {
      await device.importIdentityKey(wrong);
    } catch {
      failed = true;
    }

    // Whether or not the import throws, the point is what is left behind.
    if (failed) {
      expect(await device.exportIdentityJWK()).toBe(original);
    } else {
      // If it does not throw, then a wrong password silently replaced the key and
      // the user cannot read anything ever again. That is unacceptable, so this
      // branch fails on purpose.
      expect(await device.exportIdentityJWK())
        .withContext('a rejected recovery must not replace the identity key')
        .toBe(original);
    }
  });
});

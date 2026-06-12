# MeowChat Multi-Device E2EE Key Sync

## Overview

Synchronize ECDH identity keys across multiple devices so a user can read and send E2EE messages from any device. The system provides a fast path (device-to-device key transfer via authenticated approval) and two recovery paths (password-derived key for password users, BIP39 recovery phrase for WebAuthn-only or emergency scenarios).

## Architecture

### Key hierarchy (per user)

```
User identity
  └── Identity Key (ECDH P-256 keypair)
        ├── Used for all 1:1 E2EE with other users
        ├── Derives shared secrets via ECDH + AES-256-GCM
        └── Protected by:

Device Key (ECDH P-256, per device)
  ├── Generated locally on each device
  ├── Used for device-to-device key transfer
  ├── Public key stored on server (user_devices table)
  └── Private key in IndexedDB (never leaves device)

Encrypted Backup Key (KEK, for recovery)
  ├── Password users: PBKDF2(password, salt) → AES-256-GCM key
  ├── WebAuthn-only: recovery phrase → PBKDF2(phrase, salt) → AES-256-GCM key
  └── Encrypted identity key stored in user_keys_backup table
```

### Device-to-device key transfer

```
Device B (new)                    Server                     Device A (trusted)
    │                               │                            │
    │ POST /api/devices/auth-req    │                            │
    │ { device_name, device_pubkey }│                            │
    │ ─────────────────────────────►│                            │
    │                               │ WS: device_auth_request    │
    │                               │ ──────────────────────────►│
    │                               │                            │ (UI prompt)
    │                               │                            │ "Approve Device B?"
    │                               │ POST /api/devices/auth/:id/approve
    │                               │ { encrypted_identity_key } │
    │                               │ ◄──────────────────────────│
    │                               │                            │
    │ poll GET /api/devices/auth/:id│                            │
    │ ◄─────────────────────────────│                            │
    │ (receives encrypted key)      │                            │
    │                               │                            │
    │ Decrypt:                      │                            │
    │ device_b_priv + device_a_pub  │                            │
    │ → ECDH shared secret          │                            │
    │ → AES-GCM decrypt identity    │                            │
    │ → import to IndexedDB         │                            │
```

### Recovery flow (no trusted device)

```
Device B (new)                    Server
    │                               │
    │ POST /api/devices/recover     │
    │ { method: "password" |        │
    │   "phrase",                    │
    │   password_or_phrase }         │
    │ ─────────────────────────────►│
    │                               │ PBKDF2(input) → KEK
    │                               │ Decrypt identity key
    │ ◄─────────────────────────────│
    │ { encrypted_identity_key,     │
    │   salt, iv }                  │
    │                               │
    │ Decrypt locally (KEK)         │
    │ → import to IndexedDB         │
```

## Database Schema

### New: `user_devices` table

```sql
CREATE TABLE IF NOT EXISTS user_devices (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name       TEXT NOT NULL,
    device_public_key TEXT NOT NULL,           -- base64 SPKI
    device_id         TEXT NOT NULL UNIQUE,     -- random 32-byte hex, identifies this device
    last_seen         DATETIME,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### New: `device_auth_requests` table

```sql
CREATE TABLE IF NOT EXISTS device_auth_requests (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name       TEXT NOT NULL,
    device_public_key TEXT NOT NULL,            -- base64 SPKI of requesting device
    device_id         TEXT NOT NULL,             -- device_id of requesting device
    status            TEXT DEFAULT 'pending',   -- pending | approved | denied | expired
    encrypted_key     TEXT,                      -- filled on approve: base64(iv + ciphertext)
    iv                TEXT,                      -- AES-GCM IV for encrypted_key
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at        DATETIME DEFAULT (datetime('now', '+15 minutes'))
);
```

### New: `user_keys_backup` table

```sql
CREATE TABLE IF NOT EXISTS user_keys_backup (
    user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_key      TEXT NOT NULL,            -- base64(iv + AES-256-GCM ciphertext of identity JWK)
    iv                 TEXT NOT NULL,             -- AES-GCM IV
    salt               TEXT NOT NULL,             -- PBKDF2 salt
    hash_iterations    INTEGER DEFAULT 100000,   -- PBKDF2 iteration count
    recovery_phrase_encrypted TEXT,               -- encrypted with phrase-derived key
    recovery_phrase_salt     TEXT,                -- salt for phrase PBKDF2
    recovery_phrase_iv       TEXT,                -- IV for phrase-derived encryption
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

When password user logs in, `user_keys_backup` is auto-created/updated with password-derived KEK.
When recovery phrase is set, `recovery_phrase_*` columns are filled (can be same key encrypted with different KEK).

## API Endpoints

### New routes (before AuthRequired — device auth needs no token)

```
POST /api/devices/register
  Body: { device_name, device_public_key, device_id }
  Auth: JWT
  Desc: Register the current device's public key + device_id

GET /api/devices
  Auth: JWT
  Desc: List user's trusted devices

DELETE /api/devices/:device_id
  Auth: JWT
  Desc: Remove a device (revoke)

POST /api/devices/auth-request
  Auth: JWT
  Body: { device_name, device_public_key, device_id }
  Desc: Create pending auth request for new device

GET /api/devices/auth-requests
  Auth: JWT
  Desc: List pending auth requests (for trusted devices to see)

POST /api/devices/auth/:id/approve
  Auth: JWT
  Body: { encrypted_key, iv }
  Desc: Approve — upload encrypted identity key for the device

DELETE /api/devices/auth/:id
  Auth: JWT
  Desc: Deny/cancel an auth request

GET /api/devices/auth/:id
  Auth: JWT
  Desc: Poll for approved key (for the requesting device)

POST /api/devices/backup-keys
  Auth: JWT
  Body: { encrypted_key, iv, salt, hash_iterations }
  Desc: Upload password-derived encrypted key backup

POST /api/devices/recover
  Auth: JWT (fresh login, before key init)
  Body: { method: "password" | "phrase", password_or_phrase: "..." }
  Desc: Recover identity key from backup

POST /api/devices/recovery-phrase
  Auth: JWT
  Body: {}  (empty — server generates phrase)
  Desc: Generate and return BIP39 recovery phrase

POST /api/devices/recovery-phrase/set
  Auth: JWT
  Body: { encrypted_key, iv, salt }
  Desc: Upload phrase-encrypted key backup

GET /api/devices/recovery-phrase
  Auth: JWT
  Desc: Check if recovery phrase is set
```

### WS events (from server to trusted devices)

```
device_auth_request: { id, device_name, created_at }
device_approved: { device_name }
device_revoked: { device_id, device_name }
```

## Frontend Flows

### Registration / First login

```
CryptoService.init()
  └─ generateIdentityKeyPair() → store in IndexedDB
  └─ generateDeviceKeyPair() → store in IndexedDB
  └─ POST /api/devices/register { device_name, device_public_key, device_id }
  └─ PUT /api/keys (upload ECDH public key)
  └─ If password login:
       └─ deriveKEK(password) → encrypt identity key → POST /api/devices/backup-keys
```

### New device login (fast path)

```
Auth → index.html loads
CryptoService.init()
  ├─ No identity key in IndexedDB → no E2EE yet
  ├─ Generate device keypair → POST /api/devices/register
  ├─ POST /api/devices/auth-request
  └─ Start polling GET /api/devices/auth/:id (every 3s)

App component: show spinner "Ожидание подтверждения на другом устройстве"

Trusted device receives WS device_auth_request
  → Show notification + in-app dialog
  → User approves:
     ├─ ECDH derive(device_priv + new_device_pub) → shared secret
     ├─ Encrypt identity_key JWK with shared secret → AES-256-GCM
     ├─ POST /api/devices/auth/:id/approve { encrypted_key, iv }
     └─ Server stores, returns to polling device

New device receives encrypted_key in poll response
  → ECDH derive(new_device_priv + trusted_device_pub_from_request) → shared secret
  → AES-GCM decrypt → import identity key to IndexedDB
  → E2EE active

On approval, trigger group key re-sharing:
  └─ For each group:
       ├─ Get raw group key from IndexedDB (on trusted device)
       ├─ Encrypt for new device's identity key
       └─ POST /api/group-chats/:id/keys { user_id: me, encrypted_key, iv }
```

### Recovery flow

```
Login → CryptoService.init()
  ├─ No identity key → show recovery option
  ├─ User picks "password" or "recovery phrase"
  ├─ POST /api/devices/recover { method, password_or_phrase }
  ├─ Server:
  │    ├─ PBKDF2(input, salt) → KEK
  │    ├─ AES-GCM decrypt encrypted_key from user_keys_backup
  │    └─ Return decrypted (over HTTPS — still server-side decrypt)
  └─ CryptoService imports identity key to IndexedDB

Note: Server-side PBKDF2 + decrypt means the identity key is briefly in server memory.
      This is acceptable because:
      - The connection is HTTPS, PBKDF2 is done server-side, plaintext discarded immediately
      - The phrase/password is used only for PBKDF2 derivation, never stored
      - The identity key would be restored on first message exchange if compromised
      - PBKDF2 with 100000 iterations makes offline bruteforce of intercepted traffic impractical
```

### WebSocket event processing

```typescript
// ApiService
wsMessages$.subscribe(msg => {
  if (msg.type === 'device_auth_request') {
    // Show in-app modal / notification
    deviceAuthRequests.update(prev => [...prev, msg]);
  }
  if (msg.type === 'device_approved') {
    // On the requesting device — stop polling, key will be in poll response
  }
  if (msg.type === 'device_revoked') {
    // Trusted device removed — no action needed
  }
});
```

## Group Key Re-sharing

When a new device is approved, the trusted device must:

1. For each group: get raw group key from IndexedDB
2. Encrypt with new device's identity public key (ECDH derive + AES-GCM)
3. POST group key share for self (`user_id: currentUserId`)

This ensures the new device can read all group messages.

## Security Considerations

### Secret material exposure

| Scenario | What server sees |
|----------|-----------------|
| Device-to-device transfer | Encrypted blob + IV (no KEK, no identity key) |
| Password recovery | PBKDF2 salt + iterations (no plain password, identity key briefly in memory) |
| Recovery phrase recovery | Server does PBKDF2(phrase, salt) + AES-GCM decrypt (phrase in memory only, never stored) |

### Device revocation

When a device is removed:
- Its `user_devices` entry is deleted
- Its pending `device_auth_requests` are deleted
- No need to rotate identity key (the device never had plaintext access to new messages)

### Forward secrecy

The current ECDH static key approach has no forward secrecy. An attacker who compromises the identity key can decrypt all past messages. This is unchanged by this design — forward secrecy (Double Ratchet) is out of scope.

## Database migrations

```sql
CREATE TABLE IF NOT EXISTS user_devices (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name       TEXT NOT NULL,
    device_public_key TEXT NOT NULL,
    device_id         TEXT NOT NULL UNIQUE,
    last_seen         DATETIME,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_auth_requests (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name       TEXT NOT NULL,
    device_public_key TEXT NOT NULL,
    device_id         TEXT NOT NULL,
    status            TEXT DEFAULT 'pending',
    encrypted_key     TEXT,
    iv                TEXT,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at        DATETIME DEFAULT (datetime('now', '+15 minutes'))
);

CREATE TABLE IF NOT EXISTS user_keys_backup (
    user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_key      TEXT NOT NULL,
    iv                 TEXT NOT NULL,
    salt               TEXT NOT NULL,
    hash_iterations    INTEGER DEFAULT 100000,
    recovery_phrase_encrypted TEXT,
    recovery_phrase_salt     TEXT,
    recovery_phrase_iv       TEXT,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Implementation order

1. Database migrations (3 new tables)
2. Backend: device registration + listing + revocation endpoints
3. Backend: device auth request flow (request, approve, poll, deny)
4. Backend: key backup endpoints (upload, recover with password)
5. Backend: recovery phrase endpoints (generate, set, recover)
6. Backend: WS broadcast for device_auth_request events
7. Frontend: CryptoService device keypair generation + registration
8. Frontend: device auth request flow (new device polls, trusted device approves)
9. Frontend: recovery UI (password + phrase)
10. Frontend: group key re-sharing on device approval
11. Add `key_creator_id` to `group_key_shares` table + fix `getGroupKey` to use it

package database

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strings"
)

// AtRestKey encrypts message content in the database.
//
// Deliberately not stored on disk and not next to the database: the whole point
// of separating it from the transport key is that a copy of the database, or of
// a backup of it, does not contain the content in readable form. Losing this key
// is loss of history, which is why startup refuses to run without it instead of
// generating something and carrying on.
var AtRestKey []byte

// AtRestKeyEnv names the variable the key is read from.
const AtRestKeyEnv = "MEOWCHAT_ATREST_KEY"

// LoadAtRestKey reads and validates the at-rest key from the environment.
//
// It returns an error rather than generating a key on first start. A generated
// key would be written into the container filesystem - the exact place the key
// must not be - and the next container would quietly encrypt with a different
// one, so every message written before the restart would become unreadable with
// nothing in the logs to say why.
func LoadAtRestKey() error {
	raw := strings.TrimSpace(os.Getenv(AtRestKeyEnv))
	if raw == "" {
		return fmt.Errorf("%s is not set: message content cannot be encrypted at rest (generate one with: openssl rand -hex 32)", AtRestKeyEnv)
	}
	key, err := parseAtRestKey(raw)
	if err != nil {
		return fmt.Errorf("%s: %w", AtRestKeyEnv, err)
	}
	AtRestKey = key
	return nil
}

// parseAtRestKey accepts hex or base64 and insists on exactly 32 bytes.
//
// Length is checked here rather than by the caller because AES-256 accepts only
// three sizes and would otherwise fail at the first encryption, long after
// startup, on a message the user was trying to send.
func parseAtRestKey(raw string) ([]byte, error) {
	if key, err := hex.DecodeString(raw); err == nil && len(key) == 32 {
		return key, nil
	}
	if key, err := base64.StdEncoding.DecodeString(raw); err == nil && len(key) == 32 {
		return key, nil
	}
	if key, err := base64.RawStdEncoding.DecodeString(raw); err == nil && len(key) == 32 {
		return key, nil
	}
	return nil, fmt.Errorf("must be exactly 32 bytes, encoded as hex or base64")
}

func atRestGCM() (cipher.AEAD, error) {
	if len(AtRestKey) != 32 {
		return nil, fmt.Errorf("at-rest key is not loaded")
	}
	block, err := aes.NewCipher(AtRestKey)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// EncryptAtRest returns nonce||ciphertext, which is what gets stored.
//
// The nonce is stored with the ciphertext rather than derived: deriving it from
// the message id would make two writes of the same message under the same key
// produce the same keystream, and GCM then leaks the xor of the plaintexts.
func EncryptAtRest(plaintext []byte) ([]byte, error) {
	gcm, err := atRestGCM()
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// DecryptAtRest reverses EncryptAtRest. A tampered blob fails here instead of
// returning garbage, because GCM authenticates.
func DecryptAtRest(blob []byte) ([]byte, error) {
	gcm, err := atRestGCM()
	if err != nil {
		return nil, err
	}
	nonceSize := gcm.NonceSize()
	if len(blob) < nonceSize {
		return nil, fmt.Errorf("at-rest blob is shorter than its nonce")
	}
	return gcm.Open(nil, blob[:nonceSize], blob[nonceSize:], nil)
}

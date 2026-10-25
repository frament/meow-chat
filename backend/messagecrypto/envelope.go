// Package messagecrypto implements the wire format of one message.
//
// Two legs, both ECIES over X25519, and the reason there are two is that the
// server cannot read what it cannot decrypt: a client encrypting to the server's
// key leaves a message the server must re-encrypt for its recipient, or deliver
// in the clear. The second leg is the one that matters - "server to recipient"
// then does not depend on TLS at all, even if the channel is fully controlled.
//
// A per-message content key wraps the text, and the content key is wrapped to
// the recipient's public key. Rotating a key therefore costs nothing for history:
// old messages keep the key they were written under.
package messagecrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"

	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/hkdf"
)

const (
	// Version is the envelope schema. It is inside the structure rather than
	// implied, so a format change can be recognised instead of misparsed.
	Version = 1

	// wrapInfo separates this key derivation from any other use of the same
	// shared secret. Without it the KEK and some future key would be the same
	// bytes, and a protocol change would silently reuse a key.
	wrapInfo = "meowchat/wrap/v1"

	keySize   = 32
	nonceSize = 12
	saltSize  = 16
)

// Envelope is what crosses the wire, in both directions.
//
// Fields are base64 because they travel inside JSON. `Kid` says which public key
// the content key was wrapped to: on the way in that is a server key, on the way
// out a device key. Without it a reader cannot tell which private key to try.
type Envelope struct {
	V          int    `json:"v"`
	Kid        string `json:"kid"`
	Eph        string `json:"eph"`
	Salt       string `json:"salt"`
	WrapIV     string `json:"wrap_iv"`
	WrappedKey string `json:"wrapped_key"`
	ContentIV  string `json:"content_iv"`
	Ciphertext string `json:"ciphertext"`
}

// Seal encrypts plaintext to recipientPublic.
//
// kid is carried, not used: it names the key on the other side so the reader can
// pick the right private key after a rotation.
func Seal(plaintext, recipientPublic []byte, kid string) (*Envelope, error) {
	if len(recipientPublic) != curve25519.PointSize {
		return nil, fmt.Errorf("recipient public key must be %d bytes, got %d", curve25519.PointSize, len(recipientPublic))
	}

	contentKey := make([]byte, keySize)
	if _, err := io.ReadFull(rand.Reader, contentKey); err != nil {
		return nil, err
	}

	contentIV, err := randomBytes(nonceSize)
	if err != nil {
		return nil, err
	}
	ciphertext, err := sealGCM(contentKey, contentIV, plaintext)
	if err != nil {
		return nil, err
	}

	ephPrivate, err := randomBytes(curve25519.ScalarSize)
	if err != nil {
		return nil, err
	}
	ephPublic, err := curve25519.X25519(ephPrivate, curve25519.Basepoint)
	if err != nil {
		return nil, fmt.Errorf("deriving ephemeral public key: %w", err)
	}

	shared, err := curve25519.X25519(ephPrivate, recipientPublic)
	if err != nil {
		return nil, fmt.Errorf("deriving shared secret: %w", err)
	}

	salt, err := randomBytes(saltSize)
	if err != nil {
		return nil, err
	}
	kek, err := deriveKEK(shared, salt)
	if err != nil {
		return nil, err
	}

	wrapIV, err := randomBytes(nonceSize)
	if err != nil {
		return nil, err
	}
	wrappedKey, err := sealGCM(kek, wrapIV, contentKey)
	if err != nil {
		return nil, err
	}

	return &Envelope{
		V:          Version,
		Kid:        kid,
		Eph:        base64.StdEncoding.EncodeToString(ephPublic),
		Salt:       base64.StdEncoding.EncodeToString(salt),
		WrapIV:     base64.StdEncoding.EncodeToString(wrapIV),
		WrappedKey: base64.StdEncoding.EncodeToString(wrappedKey),
		ContentIV:  base64.StdEncoding.EncodeToString(contentIV),
		Ciphertext: base64.StdEncoding.EncodeToString(ciphertext),
	}, nil
}

// Open decrypts an envelope with the private key its kid points at.
//
// Every failure returns an error and nothing else: a caller that got a byte
// slice back would have no way to tell a decrypted message from a decryption
// that silently produced garbage.
func Open(env *Envelope, recipientPrivate []byte) ([]byte, error) {
	if len(recipientPrivate) != curve25519.ScalarSize {
		return nil, fmt.Errorf("recipient private key must be %d bytes, got %d", curve25519.ScalarSize, len(recipientPrivate))
	}
	if err := env.Validate(); err != nil {
		return nil, err
	}

	eph, err := decodeField("eph", env.Eph, curve25519.PointSize)
	if err != nil {
		return nil, err
	}
	salt, err := decodeField("salt", env.Salt, saltSize)
	if err != nil {
		return nil, err
	}
	wrapIV, err := decodeField("wrap_iv", env.WrapIV, nonceSize)
	if err != nil {
		return nil, err
	}
	wrappedKey, err := decodeField("wrapped_key", env.WrappedKey, keySize+overhead)
	if err != nil {
		return nil, err
	}
	contentIV, err := decodeField("content_iv", env.ContentIV, nonceSize)
	if err != nil {
		return nil, err
	}
	ciphertext, err := base64.StdEncoding.DecodeString(env.Ciphertext)
	if err != nil {
		return nil, fmt.Errorf("ciphertext is not base64: %w", err)
	}

	shared, err := curve25519.X25519(recipientPrivate, eph)
	if err != nil {
		return nil, fmt.Errorf("deriving shared secret: %w", err)
	}
	kek, err := deriveKEK(shared, salt)
	if err != nil {
		return nil, err
	}
	contentKey, err := openGCM(kek, wrapIV, wrappedKey)
	if err != nil {
		return nil, fmt.Errorf("unwrapping content key: %w", err)
	}
	if len(contentKey) != keySize {
		return nil, fmt.Errorf("content key is %d bytes, expected %d", len(contentKey), keySize)
	}

	plaintext, err := openGCM(contentKey, contentIV, ciphertext)
	if err != nil {
		return nil, fmt.Errorf("decrypting content: %w", err)
	}
	return plaintext, nil
}

// overhead is the GCM tag length.
const overhead = 16

// Validate rejects a malformed envelope before any key material is touched.
//
// The point is to make the server's first step a size check rather than a
// decryption attempt: it means a caller cannot make the server do X25519 work on
// arbitrary blobs, and it turns "wrong thing sent" into one clear error instead
// of a failure deep inside a curve operation.
func (e *Envelope) Validate() error {
	if e == nil {
		return fmt.Errorf("envelope is nil")
	}
	if e.V != Version {
		return fmt.Errorf("envelope version %d is not supported", e.V)
	}
	if e.Kid == "" {
		return fmt.Errorf("envelope has no kid: the reader cannot tell which key to use")
	}
	for _, f := range []struct {
		name string
		val  string
		size int
	}{
		{"eph", e.Eph, curve25519.PointSize},
		{"salt", e.Salt, saltSize},
		{"wrap_iv", e.WrapIV, nonceSize},
		{"wrapped_key", e.WrappedKey, keySize + overhead},
		{"content_iv", e.ContentIV, nonceSize},
	} {
		if _, err := decodeField(f.name, f.val, f.size); err != nil {
			return err
		}
	}
	ciphertext, err := base64.StdEncoding.DecodeString(e.Ciphertext)
	if err != nil {
		return fmt.Errorf("ciphertext is not base64: %w", err)
	}
	if len(ciphertext) < overhead {
		return fmt.Errorf("ciphertext is %d bytes, shorter than an authentication tag", len(ciphertext))
	}
	return nil
}

func randomBytes(n int) ([]byte, error) {
	buf := make([]byte, n)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return nil, err
	}
	return buf, nil
}

func decodeField(name, value string, want int) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return nil, fmt.Errorf("%s is not base64: %w", name, err)
	}
	if len(raw) != want {
		return nil, fmt.Errorf("%s is %d bytes, expected %d", name, len(raw), want)
	}
	return raw, nil
}

func deriveKEK(shared, salt []byte) ([]byte, error) {
	kek := make([]byte, keySize)
	reader := hkdf.New(sha256.New, shared, salt, []byte(wrapInfo))
	if _, err := io.ReadFull(reader, kek); err != nil {
		return nil, fmt.Errorf("deriving key-encryption key: %w", err)
	}
	return kek, nil
}

func sealGCM(key, nonce, plaintext []byte) ([]byte, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	return gcm.Seal(nil, nonce, plaintext, nil), nil
}

func openGCM(key, nonce, ciphertext []byte) ([]byte, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, nonce, ciphertext, nil)
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

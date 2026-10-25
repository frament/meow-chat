package database

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"golang.org/x/crypto/curve25519"
)

// ServerX25519Private and ServerX25519Public are the pair clients encrypt to on
// the first leg. The public half is pinned in the client bundle by its
// fingerprint; the private half never leaves the server.
//
// Unlike the at-rest key these are generated on first start and kept next to
// the database, because a rotated transport key can be recovered from the
// server's own copy while losing it only costs reissuing, not history.
var (
	ServerX25519Private []byte
	ServerX25519Public  []byte
)

func serverKeyPairPath() string {
	if path := os.Getenv("DB_PATH"); path != "" {
		return filepath.Join(filepath.Dir(path), "server_key_x25519.bin")
	}
	return "./data/server_key_x25519.bin"
}

// LoadOrGenerateServerKeyPair reads the X25519 pair, creating it on first start.
func LoadOrGenerateServerKeyPair() error {
	path := serverKeyPairPath()

	data, err := os.ReadFile(path)
	switch {
	case err == nil:
		// A file of the wrong size must stop the server, not be replaced. It means
		// something wrote over the key or the file was truncated; overwriting it
		// would silently make every message already wrapped under it unreadable,
		// and the client pin would then mismatch for a reason nobody can trace.
		if len(data) != curve25519.ScalarSize {
			return fmt.Errorf("server key file %s is %d bytes, expected %d", path, len(data), curve25519.ScalarSize)
		}
		public, err := curve25519.X25519(data, curve25519.Basepoint)
		if err != nil {
			return fmt.Errorf("server key file %s is not a usable X25519 private key: %w", path, err)
		}
		ServerX25519Private, ServerX25519Public = data, public
		return nil

	case !os.IsNotExist(err):
		// Unreadable for a reason other than absence (permissions, a directory in
		// the way). Generating a new pair here would lose the old one.
		return fmt.Errorf("reading server key file %s: %w", path, err)
	}

	private := make([]byte, curve25519.ScalarSize)
	if _, err := rand.Read(private); err != nil {
		return fmt.Errorf("generating server key: %w", err)
	}
	public, err := curve25519.X25519(private, curve25519.Basepoint)
	if err != nil {
		return fmt.Errorf("deriving server public key: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("creating directory for server key: %w", err)
	}
	if err := os.WriteFile(path, private, 0o600); err != nil {
		return fmt.Errorf("writing server key: %w", err)
	}

	ServerX25519Private, ServerX25519Public = private, public
	log.Println("Server X25519 key pair generated")
	return nil
}

// Fingerprint is what the client pins: base64 of SHA-256 over the raw 32 bytes.
//
// Deliberately not a hash of the base64 text: the same key encoded differently
// would then produce a different fingerprint, and the pin would fail for a
// reason that has nothing to do with an attacker.
func Fingerprint(public []byte) string {
	sum := sha256.Sum256(public)
	return base64.StdEncoding.EncodeToString(sum[:])
}

// KeyID is a short, stable label for a public key, so a message can say which
// key wrapped it without carrying the key itself. Derived from the bytes, so two
// servers storing the same key agree on the label without coordinating.
func KeyID(public []byte) string {
	sum := sha256.Sum256(public)
	return base64.RawURLEncoding.EncodeToString(sum[:9])
}

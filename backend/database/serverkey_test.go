package database

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/curve25519"
)

func useTempDBPath(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("DB_PATH", filepath.Join(dir, "chat.db"))
	ServerX25519Private, ServerX25519Public = nil, nil
	t.Cleanup(func() { ServerX25519Private, ServerX25519Public = nil, nil })
	return dir
}

func TestServerKeyPair_GeneratedAndPersisted(t *testing.T) {
	useTempDBPath(t)

	if err := LoadOrGenerateServerKeyPair(); err != nil {
		t.Fatal(err)
	}
	if len(ServerX25519Private) != 32 || len(ServerX25519Public) != 32 {
		t.Fatalf("expected 32-byte halves, got %d and %d", len(ServerX25519Private), len(ServerX25519Public))
	}
	first := append([]byte(nil), ServerX25519Private...)

	// The public half must actually be derived from the private one, otherwise
	// the server would decrypt with a key nobody encrypted to.
	derived, err := curve25519.X25519(first, curve25519.Basepoint)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(derived, ServerX25519Public) {
		t.Fatal("public key is not X25519(private, basepoint)")
	}

	// A restart reads the file instead of making a new pair.
	ServerX25519Private, ServerX25519Public = nil, nil
	if err := LoadOrGenerateServerKeyPair(); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first, ServerX25519Private) {
		t.Fatal("a restart generated a new key instead of loading the stored one")
	}
}

func TestServerKeyPair_FileIsPrivate(t *testing.T) {
	dir := useTempDBPath(t)
	if err := LoadOrGenerateServerKeyPair(); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(dir, "server_key_x25519.bin")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("key file mode is %o, expected 600", perm)
	}
}

// A truncated or overwritten key file must stop the server.
//
// Regenerating would look like success while every message already wrapped under
// the old key becomes unreadable, and the client pin would start mismatching for
// a reason nothing in the logs explains.
func TestServerKeyPair_MalformedFileIsAnErrorAndSurvives(t *testing.T) {
	dir := useTempDBPath(t)
	path := filepath.Join(dir, "server_key_x25519.bin")

	broken := bytes.Repeat([]byte{9}, 7)
	if err := os.WriteFile(path, broken, 0o600); err != nil {
		t.Fatal(err)
	}

	if err := LoadOrGenerateServerKeyPair(); err == nil {
		t.Fatal("a 7-byte key file must be an error")
	}

	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, broken) {
		t.Fatal("the malformed file was overwritten; the old key is now unrecoverable")
	}
}

func TestFingerprint_IsOverRawBytes(t *testing.T) {
	public := bytes.Repeat([]byte{0x42}, 32)

	want := base64.StdEncoding.EncodeToString(func() []byte {
		sum := sha256.Sum256(public)
		return sum[:]
	}())
	if got := Fingerprint(public); got != want {
		t.Errorf("fingerprint = %q, want %q", got, want)
	}

	// Hashing the encoded text instead of the bytes would make the same key
	// produce a different fingerprint depending on its encoding.
	encoded := base64.StdEncoding.EncodeToString(public)
	if Fingerprint([]byte(encoded)) == want {
		t.Error("fingerprint appears to hash the base64 text, not the raw key")
	}
}

func TestKeyID_DistinguishesKeys(t *testing.T) {
	a := bytes.Repeat([]byte{1}, 32)
	b := bytes.Repeat([]byte{2}, 32)

	if KeyID(a) == KeyID(b) {
		t.Fatal("different keys produced the same kid")
	}
	if KeyID(a) != KeyID(append([]byte(nil), a...)) {
		t.Fatal("kid is not stable for the same key")
	}
}

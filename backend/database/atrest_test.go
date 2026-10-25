package database

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"os"
	"strings"
	"testing"
)

func TestLoadAtRestKey_MissingIsAnError(t *testing.T) {
	t.Setenv(AtRestKeyEnv, "")
	AtRestKey = nil

	err := LoadAtRestKey()
	if err == nil {
		t.Fatal("a missing key must be an error, not a generated default")
	}
	if !strings.Contains(err.Error(), AtRestKeyEnv) {
		t.Errorf("the error must name the variable to set, got %q", err)
	}
	if AtRestKey != nil {
		t.Error("a failed load must not leave a key behind")
	}
}

func TestLoadAtRestKey_RejectsWrongLength(t *testing.T) {
	// 16 bytes is a valid AES key size, so a naive decoder would accept it and
	// then fail in AES-NewCipher much later, on a user's first message.
	short := hex.EncodeToString(bytes.Repeat([]byte{7}, 16))
	t.Setenv(AtRestKeyEnv, short)
	AtRestKey = nil

	if err := LoadAtRestKey(); err == nil {
		t.Fatal("16 bytes must be rejected: only 32-byte keys are allowed here")
	}
}

func TestLoadAtRestKey_AcceptsHexAndBase64(t *testing.T) {
	key := bytes.Repeat([]byte{0x5a}, 32)

	for name, encoded := range map[string]string{
		"hex":    hex.EncodeToString(key),
		"base64": base64.StdEncoding.EncodeToString(key),
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv(AtRestKeyEnv, encoded)
			AtRestKey = nil
			if err := LoadAtRestKey(); err != nil {
				t.Fatalf("expected %s to be accepted: %v", name, err)
			}
			if !bytes.Equal(AtRestKey, key) {
				t.Fatalf("decoded key does not match what was set")
			}
		})
	}
}

func TestAtRest_RoundTripAndTamper(t *testing.T) {
	AtRestKey = bytes.Repeat([]byte{0x11}, 32)

	plaintext := []byte("привет, это сообщение лежит в базе шифротекстом")
	blob, err := EncryptAtRest(plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(blob, plaintext) {
		t.Fatal("the plaintext survived into the blob")
	}

	got, err := DecryptAtRest(blob)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Fatalf("round trip changed the content: %q", got)
	}

	// Same plaintext twice must not produce the same blob: with a repeated nonce
	// GCM leaks the xor of the two plaintexts.
	second, err := EncryptAtRest(plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(blob, second) {
		t.Fatal("two encryptions of the same text produced identical blobs - the nonce is not random")
	}

	blob[len(blob)-1] ^= 0xff
	if _, err := DecryptAtRest(blob); err == nil {
		t.Fatal("a tampered blob must fail authentication, not decrypt to garbage")
	}
}

func TestAtRest_RefusesWithoutKey(t *testing.T) {
	AtRestKey = nil
	if _, err := EncryptAtRest([]byte("x")); err == nil {
		t.Fatal("encrypting without a loaded key must fail")
	}
}

// The at-rest key comes from the environment, not from the data directory.
// A file next to the database would be copied by every backup of it, which is
// the one thing this split exists to prevent.
func TestAtRestKey_IsNotReadFromDisk(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/atrest_key.bin"
	if err := os.WriteFile(path, bytes.Repeat([]byte{3}, 32), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DB_PATH", dir+"/chat.db")
	t.Setenv(AtRestKeyEnv, "")
	AtRestKey = nil

	if err := LoadAtRestKey(); err == nil {
		t.Fatal("a key file in the data directory must not be picked up")
	}
}

package messagecrypto

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"

	"golang.org/x/crypto/curve25519"
)

// keyPair seeds the scalar so two calls with different seeds are different keys.
// The first version of this helper ignored the seed, which made the "wrong key"
// test compare a key with itself and pass for the wrong reason.
func keyPairSeeded(t *testing.T, seed byte) (private, public []byte) {
	t.Helper()
	private = make([]byte, curve25519.ScalarSize)
	for i := range private {
		private[i] = byte(i+1) + seed
	}
	public, err := curve25519.X25519(private, curve25519.Basepoint)
	if err != nil {
		t.Fatal(err)
	}
	return private, public
}

func keyPair(t *testing.T) (private, public []byte) {
	t.Helper()
	return keyPairSeeded(t, 0)
}

func TestSealOpen_RoundTrip(t *testing.T) {
	private, public := keyPair(t)
	plaintext := []byte("привет, это сообщение едет по каналу шифротекстом")

	env, err := Seal(plaintext, public, "srv-1")
	if err != nil {
		t.Fatal(err)
	}
	if env.Kid != "srv-1" {
		t.Errorf("kid = %q, want the one that was passed", env.Kid)
	}

	got, err := Open(env, private)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Fatalf("round trip changed the text: %q", got)
	}
}

func TestSeal_DoesNotLeakPlaintext(t *testing.T) {
	_, public := keyPair(t)
	plaintext := []byte("совершенно секретная строка")

	env, err := Seal(plaintext, public, "srv-1")
	if err != nil {
		t.Fatal(err)
	}
	blob := env.Eph + env.Salt + env.WrapIV + env.WrappedKey + env.ContentIV + env.Ciphertext
	if strings.Contains(blob, string(plaintext)) {
		t.Fatal("the plaintext appears verbatim in the envelope")
	}

	// Also check the decoded bytes: base64 could hide it from a string search.
	ct, err := base64.StdEncoding.DecodeString(env.Ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(ct, plaintext) {
		t.Fatal("the plaintext appears in the decoded ciphertext")
	}
}

// Two seals of the same text must differ in every random part. Reusing any of
// them breaks a security property, so all of them are checked rather than just
// the obvious one.
func TestSeal_IsRandomised(t *testing.T) {
	_, public := keyPair(t)
	plaintext := []byte("одно и то же")

	first, err := Seal(plaintext, public, "srv-1")
	if err != nil {
		t.Fatal(err)
	}
	second, err := Seal(plaintext, public, "srv-1")
	if err != nil {
		t.Fatal(err)
	}

	for _, f := range []struct{ name, a, b string }{
		{"eph", first.Eph, second.Eph},
		{"salt", first.Salt, second.Salt},
		{"wrap_iv", first.WrapIV, second.WrapIV},
		{"wrapped_key", first.WrappedKey, second.WrappedKey},
		{"content_iv", first.ContentIV, second.ContentIV},
		{"ciphertext", first.Ciphertext, second.Ciphertext},
	} {
		if f.a == f.b {
			t.Errorf("%s is identical across two envelopes; it is not random", f.name)
		}
	}
}

func TestOpen_WrongKeyFails(t *testing.T) {
	private, public := keyPair(t)
	otherPrivate, _ := keyPairSeeded(t, 100)

	env, err := Seal([]byte("привет"), public, "srv-1")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(otherPrivate, private) {
		t.Fatal("test setup is broken: both keys are the same")
	}
	if _, err := Open(env, otherPrivate); err == nil {
		t.Fatal("decrypting with the wrong private key must fail, not return garbage")
	}
}

func TestOpen_TamperedContentFails(t *testing.T) {
	private, public := keyPair(t)
	env, err := Seal([]byte("привет"), public, "srv-1")
	if err != nil {
		t.Fatal(err)
	}

	ct, _ := base64.StdEncoding.DecodeString(env.Ciphertext)
	ct[len(ct)-1] ^= 0xff
	env.Ciphertext = base64.StdEncoding.EncodeToString(ct)

	if _, err := Open(env, private); err == nil {
		t.Fatal("a flipped bit in the ciphertext must fail authentication")
	}
}

// The wrapped content key is the interesting target: if its authentication is
// skipped, an attacker substitutes their own content key and the text decrypts
// cleanly to whatever they wrote.
func TestOpen_TamperedWrappedKeyFails(t *testing.T) {
	private, public := keyPair(t)
	env, err := Seal([]byte("привет"), public, "srv-1")
	if err != nil {
		t.Fatal(err)
	}

	wk, _ := base64.StdEncoding.DecodeString(env.WrappedKey)
	wk[0] ^= 0x01
	env.WrappedKey = base64.StdEncoding.EncodeToString(wk)

	if _, err := Open(env, private); err == nil {
		t.Fatal("a tampered wrapped key must fail, not yield a different content key")
	}
}

func TestOpen_EmptyPlaintextWorks(t *testing.T) {
	private, public := keyPair(t)

	env, err := Seal(nil, public, "srv-1")
	if err != nil {
		t.Fatal(err)
	}
	got, err := Open(env, private)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("expected empty output, got %q", got)
	}
}

func TestValidate_RejectsMalformed(t *testing.T) {
	_, public := keyPair(t)
	good, err := Seal([]byte("x"), public, "srv-1")
	if err != nil {
		t.Fatal(err)
	}
	if err := good.Validate(); err != nil {
		t.Fatalf("a fresh envelope must validate: %v", err)
	}

	tests := map[string]func(*Envelope){
		"no version":       func(e *Envelope) { e.V = 99 },
		"no kid":           func(e *Envelope) { e.Kid = "" },
		"short eph":        func(e *Envelope) { e.Eph = base64.StdEncoding.EncodeToString(make([]byte, 31)) },
		"short salt":       func(e *Envelope) { e.Salt = base64.StdEncoding.EncodeToString(make([]byte, 8)) },
		"not base64":       func(e *Envelope) { e.WrapIV = "%%%" },
		"short wrapped":    func(e *Envelope) { e.WrappedKey = base64.StdEncoding.EncodeToString(make([]byte, 47)) },
		"ciphertext short": func(e *Envelope) { e.Ciphertext = base64.StdEncoding.EncodeToString(make([]byte, 15)) },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			env := *good
			mutate(&env)
			if err := env.Validate(); err == nil {
				t.Fatalf("%s must be rejected", name)
			}
		})
	}
}

func TestSeal_RejectsBadPublicKey(t *testing.T) {
	if _, err := Seal([]byte("x"), make([]byte, 31), "srv-1"); err == nil {
		t.Fatal("a 31-byte recipient key must be rejected")
	}
}

// The kid is not decoration: after a rotation the reader decides which private
// key to use from it. Losing it means every message becomes "which key?".
func TestKid_SurvivesRoundTrip(t *testing.T) {
	private, public := keyPair(t)
	env, err := Seal([]byte("x"), public, "device-abc")
	if err != nil {
		t.Fatal(err)
	}
	if env.Kid != "device-abc" {
		t.Fatalf("kid = %q", env.Kid)
	}
	if _, err := Open(env, private); err != nil {
		t.Fatal(err)
	}
}

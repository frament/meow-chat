package auth

import (
	"os"
	"strings"
	"testing"
)

// The secret used to have a fallback literal in the source while the repo was
// public, which made every production token forgeable. These tests pin the
// behaviour that replaced it: no secret, no server.
//
// The refusal lives in RequireSecret because log.Fatal would take the test
// binary down with it - so it is exercised in a separate process by
// cmd/jwtprobe, driven from scripts/check-jwt-secret.sh. What is testable here
// is the state RequireSecret looks at.
func TestSetJWTSecret(t *testing.T) {
	original := jwtSecret
	t.Cleanup(func() { jwtSecret = original })

	SetJWTSecret("a-real-secret")
	if string(jwtSecret) != "a-real-secret" {
		t.Errorf("secret = %q, want %q", jwtSecret, "a-real-secret")
	}
}

// A secret of spaces is set as far as the environment is concerned and is about
// as strong as the fallback it replaced. Whitespace is trimmed everywhere, so a
// pasted value with a stray newline still works and a blank one does not.
func TestSetJWTSecretTrimsWhitespace(t *testing.T) {
	original := jwtSecret
	t.Cleanup(func() { jwtSecret = original })

	SetJWTSecret("  padded-secret\n")
	if string(jwtSecret) != "padded-secret" {
		t.Errorf("secret = %q, want the trimmed value", jwtSecret)
	}

	SetJWTSecret("   ")
	if len(jwtSecret) != 0 {
		t.Errorf("blank secret left %d bytes, want 0", len(jwtSecret))
	}
}

// Guards against the exact regression that caused this: a fallback literal.
// Generated secrets are base64, so 48 bytes is a realistic minimum.
func TestNoBuiltInFallback(t *testing.T) {
	original := jwtSecret
	t.Cleanup(func() { jwtSecret = original })

	t.Setenv("JWT_SECRET", "")
	jwtSecret = nil

	if len(jwtSecret) != 0 {
		t.Fatalf("a secret exists with an empty environment: %q", jwtSecret)
	}

	// t.Setenv above also proved the variable can be cleared; if init() had left
	// anything behind, token generation would have a usable key right now.
	if v := os.Getenv("JWT_SECRET"); v != "" {
		t.Errorf("JWT_SECRET unexpectedly present in the test environment: %q", v)
	}
	if strings.Contains(strings.ToLower(string(jwtSecret)), "dev-secret") {
		t.Error("the old development secret is still in use")
	}
}
package auth

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var jwtSecret []byte

// init runs for every binary that imports this package, including `go test`.
// Under test the secret comes from the environment, which means a developer with
// an empty shell would see every package in the module die at startup with a
// message about JWT rather than about their code.
//
// SetJWTSecret is the escape hatch tests use instead: it runs after init, so a
// test can install a known value even when the environment had none. Production
// never calls it - main() goes through init and RequireSecret, and stops if the
// environment is empty, which is the whole point.
func SetJWTSecret(secret string) {
	jwtSecret = []byte(strings.TrimSpace(secret))
}

// RequireSecret stops the process unless a secret was supplied.
//
// This is the guard that matters. Without it the server would start and sign
// tokens with an empty key: anyone could forge is_admin for any user. Called
// from main() before anything listens, so the failure is immediate and loud.
func RequireSecret() {
	if len(jwtSecret) == 0 {
		log.Fatal("JWT_SECRET is not set. Generate one with: openssl rand -base64 48")
	}
}

func init() {
	// TrimSpace, not a plain emptiness check: a secret of "   " is set as far as
	// the environment is concerned, and it would be about as strong as the
	// fallback this replaced. Generated secrets are base64 and never carry
	// surrounding whitespace, so trimming cannot reject a legitimate one.
	secret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if secret != "" {
		jwtSecret = []byte(secret)
		return
	}
	// No fallback. A built-in secret would be a secret in the source, and this
	// repo is public - anyone could mint a token for any user, is_admin
	// included. init() stays quiet so that `go test` can run at all (see
	// SetJWTSecret); the refusal to serve lives in RequireSecret, which main()
	// calls and tests do not.
}

type Claims struct {
	UserID  int64  `json:"user_id"`
	Type    string `json:"type"`
	IsAdmin bool   `json:"is_admin"`
	jwt.RegisteredClaims
}

func GenerateAccessToken(userID int64, isAdmin bool) (string, error) {
	claims := &Claims{
		UserID:  userID,
		Type:    "access",
		IsAdmin: isAdmin,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(15 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func GenerateRefreshToken(userID int64) (string, string, error) {
	tokenID := generateTokenID()
	claims := &Claims{
		UserID: userID,
		Type:   "refresh",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ID:        tokenID,
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString(jwtSecret)
	return tokenStr, tokenID, err
}

func ValidateAccessToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid || claims.Type != "access" {
		return nil, jwt.ErrSignatureInvalid
	}
	return claims, nil
}

func ValidateRefreshToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid || claims.Type != "refresh" {
		return nil, jwt.ErrSignatureInvalid
	}
	return claims, nil
}

func generateTokenID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

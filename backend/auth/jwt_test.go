package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestGenerateAccessToken(t *testing.T) {
	token, err := GenerateAccessToken(42, false)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}
}

func TestValidateAccessToken_Valid(t *testing.T) {
	token, err := GenerateAccessToken(42, false)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := ValidateAccessToken(token)
	if err != nil {
		t.Fatalf("ValidateAccessToken failed: %v", err)
	}
	if claims.UserID != 42 {
		t.Errorf("expected UserID 42, got %d", claims.UserID)
	}
	if claims.Type != "access" {
		t.Errorf("expected type 'access', got %s", claims.Type)
	}
	if claims.IsAdmin {
		t.Error("expected IsAdmin false")
	}
}

func TestValidateAccessToken_Admin(t *testing.T) {
	token, err := GenerateAccessToken(1, true)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := ValidateAccessToken(token)
	if err != nil {
		t.Fatalf("ValidateAccessToken failed: %v", err)
	}
	if claims.UserID != 1 {
		t.Errorf("expected UserID 1, got %d", claims.UserID)
	}
	if !claims.IsAdmin {
		t.Error("expected IsAdmin true")
	}
}

func TestValidateAccessToken_Expired(t *testing.T) {
	claims := &Claims{
		UserID: 1,
		Type:   "access",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString(jwtSecret)
	if err != nil {
		t.Fatal(err)
	}
	_, err = ValidateAccessToken(tokenStr)
	if err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestValidateAccessToken_WrongSignature(t *testing.T) {
	claims := &Claims{
		UserID: 1,
		Type:   "access",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(15 * time.Minute)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString([]byte("wrong-secret"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = ValidateAccessToken(tokenStr)
	if err == nil {
		t.Fatal("expected error for wrong signature")
	}
}

func TestValidateAccessToken_Garbage(t *testing.T) {
	_, err := ValidateAccessToken("not-a-jwt-token")
	if err == nil {
		t.Fatal("expected error for garbage token")
	}
}

func TestValidateAccessToken_RefreshTokenRejected(t *testing.T) {
	refresh, _, err := GenerateRefreshToken(1)
	if err != nil {
		t.Fatal(err)
	}
	_, err = ValidateAccessToken(refresh)
	if err == nil {
		t.Fatal("expected error when passing refresh token to ValidateAccessToken")
	}
}

func TestGenerateRefreshToken(t *testing.T) {
	token, id, err := GenerateRefreshToken(42)
	if err != nil {
		t.Fatalf("GenerateRefreshToken failed: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}
	if id == "" {
		t.Fatal("expected non-empty token ID")
	}
}

func TestValidateRefreshToken_Valid(t *testing.T) {
	token, _, err := GenerateRefreshToken(42)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := ValidateRefreshToken(token)
	if err != nil {
		t.Fatalf("ValidateRefreshToken failed: %v", err)
	}
	if claims.UserID != 42 {
		t.Errorf("expected UserID 42, got %d", claims.UserID)
	}
	if claims.Type != "refresh" {
		t.Errorf("expected type 'refresh', got %s", claims.Type)
	}
	if claims.ID == "" {
		t.Error("expected non-empty token ID in claims")
	}
}

func TestValidateRefreshToken_Expired(t *testing.T) {
	claims := &Claims{
		UserID: 1,
		Type:   "refresh",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString(jwtSecret)
	if err != nil {
		t.Fatal(err)
	}
	_, err = ValidateRefreshToken(tokenStr)
	if err == nil {
		t.Fatal("expected error for expired refresh token")
	}
}

func TestValidateRefreshToken_AccessTokenRejected(t *testing.T) {
	access, err := GenerateAccessToken(1, false)
	if err != nil {
		t.Fatal(err)
	}
	_, err = ValidateRefreshToken(access)
	if err == nil {
		t.Fatal("expected error when passing access token to ValidateRefreshToken")
	}
}

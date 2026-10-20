package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"math/big"
)

// tokenBytes is the entropy of session, device, verification and reset
// tokens.
const tokenBytes = 32

// NewToken returns a random token (32 bytes, unpadded base64url).
func NewToken() (string, error) {
	b := make([]byte, tokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// HashToken returns the SHA-256 of a token: the only form in which tokens
// are stored.
func HashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

// TokenFingerprint is the hex SHA-256 of a token, for correlating log lines
// without logging the token.
func TokenFingerprint(token string) string { return hex.EncodeToString(HashToken(token)) }

// guestName returns a generated display name like "Settler 4821".
func guestName() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(9000))
	if err != nil {
		return "", err
	}
	return "Settler " + big.NewInt(0).Add(n, big.NewInt(1000)).String(), nil
}

// Package auth implements accounts and sessions (docs/ARCHITECTURE.md
// §4.6): guest play with a device token, registration, login, sessions
// stored in PostgreSQL by token hash, email verification and password reset
// through a Mailer, and the Redis-backed rate limiter of the auth
// endpoints.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Argon2Params are the argon2id parameters of new password hashes.
type Argon2Params struct {
	// Time is the number of passes.
	Time uint32
	// MemoryKiB is the memory in KiB.
	MemoryKiB uint32
	// Threads is the parallelism.
	Threads uint8
	// SaltLen and KeyLen are in bytes.
	SaltLen uint32
	KeyLen  uint32
}

// DefaultArgon2 are the OWASP minimum parameters for argon2id: t=2,
// m=19 MiB, p=1, with a 16-byte salt and a 32-byte key. Raising them later
// is backward compatible: the PHC string stores the parameters of each
// hash, and VerifyPassword reports hashes with other parameters so that the
// caller re-hashes them after the next successful login.
var DefaultArgon2 = Argon2Params{Time: 2, MemoryKiB: 19456, Threads: 1, SaltLen: 16, KeyLen: 32}

// Password length limits in bytes (no composition rules).
const (
	MinPasswordLen = 8
	MaxPasswordLen = 128
)

// ErrWeakPassword is returned for a password outside the length limits.
var ErrWeakPassword = errors.New("password must be 8 to 128 bytes long")

var errBadHash = errors.New("malformed password hash")

// CheckPassword enforces the length limits.
func CheckPassword(password string) error {
	if len(password) < MinPasswordLen || len(password) > MaxPasswordLen {
		return ErrWeakPassword
	}
	return nil
}

// HashPassword returns the argon2id hash of password in PHC string format:
// $argon2id$v=19$m=<KiB>,t=<time>,p=<threads>$<salt>$<key> (unpadded
// standard base64).
func HashPassword(password string, p Argon2Params) (string, error) {
	salt := make([]byte, p.SaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, p.Time, p.MemoryKiB, p.Threads, p.KeyLen)
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, p.MemoryKiB, p.Time, p.Threads,
		b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

// ParsePHC parses an argon2id PHC string into its parameters, salt and key.
func ParsePHC(phc string) (Argon2Params, []byte, []byte, error) {
	var p Argon2Params
	parts := strings.Split(phc, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return p, nil, nil, errBadHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return p, nil, nil, errBadHash
	}
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.MemoryKiB, &p.Time, &p.Threads); err != nil {
		return p, nil, nil, errBadHash
	}
	b64 := base64.RawStdEncoding
	salt, err := b64.DecodeString(parts[4])
	if err != nil {
		return p, nil, nil, errBadHash
	}
	key, err := b64.DecodeString(parts[5])
	if err != nil || len(key) == 0 {
		return p, nil, nil, errBadHash
	}
	p.SaltLen, p.KeyLen = uint32(len(salt)), uint32(len(key)) // #nosec G115 -- lengths of decoded PHC fields.
	return p, salt, key, nil
}

// VerifyPassword checks password against a PHC hash in constant time.
// rehash is true when the hash was made with parameters other than want
// (the caller should store a new hash after a successful login).
func VerifyPassword(password, phc string, want Argon2Params) (ok, rehash bool, err error) {
	p, salt, key, err := ParsePHC(phc)
	if err != nil {
		return false, false, err
	}
	got := argon2.IDKey([]byte(password), salt, p.Time, p.MemoryKiB, p.Threads, p.KeyLen)
	if subtle.ConstantTimeCompare(got, key) != 1 {
		return false, false, nil
	}
	return true, p != want, nil
}

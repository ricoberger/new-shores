package auth

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"log/slog"
	"regexp"
	"strings"
	"testing"
)

// TestArgon2idParametersInPHC: new hashes use argon2id with t=2,
// m=19456 KiB, p=1, a 16-byte salt and a 32-byte key, in PHC format.
func TestArgon2idParametersInPHC(t *testing.T) {
	phc, err := HashPassword("correct horse battery", DefaultArgon2)
	if err != nil {
		t.Fatal(err)
	}
	re := regexp.MustCompile(`^\$argon2id\$v=19\$m=19456,t=2,p=1\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$`)
	m := re.FindStringSubmatch(phc)
	if m == nil {
		t.Fatalf("PHC string %q", phc)
	}
	salt, err := base64.RawStdEncoding.DecodeString(m[1])
	if err != nil || len(salt) != 16 {
		t.Fatalf("salt %d bytes, %v", len(salt), err)
	}
	key, err := base64.RawStdEncoding.DecodeString(m[2])
	if err != nil || len(key) != 32 {
		t.Fatalf("key %d bytes, %v", len(key), err)
	}
	p, _, _, err := ParsePHC(phc)
	if err != nil || p != DefaultArgon2 {
		t.Fatalf("ParsePHC = %+v, %v", p, err)
	}
	other, _ := HashPassword("correct horse battery", DefaultArgon2)
	if other == phc {
		t.Fatal("two hashes share a salt")
	}
}

func TestVerifyPassword(t *testing.T) {
	phc, _ := HashPassword("correct horse battery", DefaultArgon2)
	if ok, rehash, err := VerifyPassword("correct horse battery", phc, DefaultArgon2); !ok || rehash || err != nil {
		t.Fatalf("right password: %v %v %v", ok, rehash, err)
	}
	if ok, _, err := VerifyPassword("wrong horse battery", phc, DefaultArgon2); ok || err != nil {
		t.Fatalf("wrong password: %v %v", ok, err)
	}
	// Raised parameters: the old hash still verifies and asks for a re-hash.
	raised := DefaultArgon2
	raised.Time = 3
	if ok, rehash, err := VerifyPassword("correct horse battery", phc, raised); !ok || !rehash || err != nil {
		t.Fatalf("raised parameters: %v %v %v", ok, rehash, err)
	}
	for _, bad := range []string{"", "$argon2i$v=19$m=1,t=1,p=1$AA$AA", "$argon2id$v=18$m=1,t=1,p=1$AA$AA", "$argon2id$v=19$m=x$AA$AA"} {
		if _, _, err := VerifyPassword("x", bad, DefaultArgon2); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestCheckPassword(t *testing.T) {
	for n, want := range map[int]error{7: ErrWeakPassword, 8: nil, 128: nil, 129: ErrWeakPassword} {
		if err := CheckPassword(strings.Repeat("a", n)); !errors.Is(err, want) {
			t.Errorf("length %d: %v", n, err)
		}
	}
}

func TestNormalizeEmail(t *testing.T) {
	if e, err := NormalizeEmail("  Player@Example.ORG "); err != nil || e != "player@example.org" {
		t.Fatalf("%q %v", e, err)
	}
	for _, bad := range []string{"", "a", "no-at.example.org", "A <a@b.org>", "a@b.org, c@d.org", strings.Repeat("a", 250) + "@b.org"} {
		if _, err := NormalizeEmail(bad); !errors.Is(err, ErrInvalidEmail) {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestNormalizeDisplayName(t *testing.T) {
	ok := " Captain Ahab "
	if n, err := normalizeDisplayName(&ok); err != nil || *n != "Captain Ahab" {
		t.Fatalf("%v %v", n, err)
	}
	for _, bad := range []string{"", "   ", strings.Repeat("x", 33), "a\nb"} {
		if _, err := normalizeDisplayName(&bad); !errors.Is(err, ErrInvalidDisplayName) {
			t.Errorf("%q accepted", bad)
		}
	}
}

// TestLogMailerLogsNoSecrets: the dev mailer logs the subject and the
// token's hash, never the token, the address or the body.
func TestLogMailerLogsNoSecrets(t *testing.T) {
	var buf bytes.Buffer
	m := LogMailer{Logger: slog.New(slog.NewTextHandler(&buf, nil))}
	token, _ := NewToken()
	if err := m.Send(context.Background(), "player@example.org", "Confirm", "link: http://x/?verify_email=1&token="+token+"\n"); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if strings.Contains(out, token) || strings.Contains(out, "player@example.org") || strings.Contains(out, "link:") {
		t.Fatalf("secret in log: %s", out)
	}
	if !strings.Contains(out, TokenFingerprint(token)) || !strings.Contains(out, "Confirm") {
		t.Fatalf("log lacks subject or token hash: %s", out)
	}
}

func TestTokens(t *testing.T) {
	a, _ := NewToken()
	b, _ := NewToken()
	raw, err := base64.RawURLEncoding.DecodeString(a)
	if err != nil || len(raw) != 32 || a == b || len(HashToken(a)) != 32 {
		t.Fatalf("token %q (%d bytes)", a, len(raw))
	}
	n, err := guestName()
	if err != nil || !regexp.MustCompile(`^Settler [1-9][0-9]{3}$`).MatchString(n) {
		t.Fatalf("guest name %q", n)
	}
}

func TestSMTPMailerConfig(t *testing.T) {
	if _, err := NewSMTPMailer("smtp://user:pw@mail.example.org:2525", "New Shores <noreply@example.org>"); err != nil {
		t.Fatal(err)
	}
	for _, c := range [][2]string{{"http://x", "a@b"}, {"smtp://x", ""}, {"smtp://x", "a@b\r\nBcc: c@d"}} {
		if _, err := NewSMTPMailer(c[0], c[1]); err == nil {
			t.Errorf("%v accepted", c)
		}
	}
}

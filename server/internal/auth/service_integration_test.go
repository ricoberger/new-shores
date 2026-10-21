//go:build integration

package auth

import (
	"context"
	"errors"
	"log/slog"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/devworld"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store/postgres"
	"github.com/ricoberger/new-shores/server/internal/testenv"
)

type recordingMailer struct {
	mu     sync.Mutex
	bodies []string
}

func (m *recordingMailer) Send(_ context.Context, _, _, body string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.bodies = append(m.bodies, body)
	return nil
}

func (m *recordingMailer) token(t *testing.T, action string) string {
	t.Helper()
	re := regexp.MustCompile(action + `=1&token=([A-Za-z0-9_-]+)`)
	for range 250 {
		m.mu.Lock()
		for i := len(m.bodies) - 1; i >= 0; i-- {
			if mt := re.FindStringSubmatch(m.bodies[i]); mt != nil {
				m.mu.Unlock()
				return mt[1]
			}
		}
		m.mu.Unlock()
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("no %s mail", action)
	return ""
}

func newService(t *testing.T) (*Service, *recordingMailer) {
	t.Helper()
	_, pool := testenv.Database(t)
	c := testenv.Catalogue(t)
	st := postgres.New(pool, c, slog.New(slog.DiscardHandler))
	mail := &recordingMailer{}
	s, err := NewService(Config{
		Store: st, NewWorld: func(now time.Time) (*sim.World, error) { return devworld.New(c, now) },
		Region: c.Region.ID, Freshness: time.Hour, SessionTTL: time.Hour * 24, Argon2: DefaultArgon2,
		Mailer: mail, PublicURL: "http://localhost:8000", Logger: slog.New(slog.DiscardHandler),
	})
	if err != nil {
		t.Fatal(err)
	}
	return s, mail
}

// TestLoginRacingPasswordReset: a login that verified the old password
// while a password reset runs must not leave a usable session behind (and
// must not overwrite the new hash).
func TestLoginRacingPasswordReset(t *testing.T) {
	s, mail := newService(t)
	ctx := context.Background()
	const email, oldPW, newPW = "racer@example.org", "old password 123", "new password 456"
	if _, err := s.Register(ctx, nil, email, oldPW, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.RequestPasswordReset(ctx, email); err != nil {
		t.Fatal(err)
	}
	resetToken := mail.token(t, "password_reset")

	verified := make(chan struct{})
	release := make(chan struct{})
	s.loginVerified = func() {
		close(verified)
		<-release
	}
	type result struct {
		out *Issued
		err error
	}
	login := make(chan result, 1)
	go func() {
		out, err := s.Login(ctx, nil, email, oldPW)
		login <- result{out, err}
	}()
	<-verified // the login verified the old password and is paused
	s.loginVerified = nil
	reset := make(chan error, 1)
	go func() { reset <- s.ConfirmPasswordReset(ctx, resetToken, newPW) }()
	select {
	case err := <-reset:
		close(release)
		<-login
		t.Fatalf("reset completed while the login held the player (err %v): not serialised", err)
	case <-time.After(300 * time.Millisecond):
	}
	close(release)
	res := <-login
	if res.err != nil {
		t.Fatalf("login: %v", res.err)
	}
	if err := <-reset; err != nil {
		t.Fatalf("reset: %v", err)
	}
	if _, err := s.Authenticate(ctx, res.out.SessionToken); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("session of the old password survived the reset: %v", err)
	}
	if _, err := s.Login(ctx, nil, email, oldPW); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("old password still works: %v", err)
	}
	if _, err := s.Login(ctx, nil, email, newPW); err != nil {
		t.Fatalf("new password: %v", err)
	}
}

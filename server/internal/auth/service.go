package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/ricoberger/new-shores/server/internal/events"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
	"github.com/ricoberger/new-shores/server/internal/store/postgres"
)

// Errors of the account operations (mapped to API error codes).
var (
	ErrUnauthorized       = errors.New("no valid session")
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrEmailTaken         = errors.New("email already registered")
	ErrAlreadyRegistered  = errors.New("player is already registered")
	ErrInvalidToken       = errors.New("invalid or expired token")
	ErrInvalidEmail       = errors.New("invalid email address")
	ErrInvalidDisplayName = errors.New("display name must be 1 to 32 printable characters")
)

// Token lifetimes.
const (
	VerifyEmailTTL   = 24 * time.Hour
	PasswordResetTTL = time.Hour
	// sessionRefresh: the sliding expiry is refreshed at most this often.
	sessionRefresh = time.Hour
	// MaxDisplayNameLen is in characters (runes).
	MaxDisplayNameLen = 32
)

// Config configures the Service.
type Config struct {
	Store *postgres.Store
	// NewWorld builds the start world of a new player evaluated at now
	// (the database clock).
	NewWorld func(now time.Time) (*sim.World, error)
	// Region is the region of new worlds (the loaded catalogue's).
	Region string
	// Freshness is the interval of the advance_to chain of a world.
	Freshness  time.Duration
	SessionTTL time.Duration
	Argon2     Argon2Params
	Mailer     Mailer
	// PublicURL is the base URL of links in mails.
	PublicURL string
	Logger    *slog.Logger
}

// Service implements the account operations.
type Service struct {
	cfg   Config
	dummy string // hash verified for unknown emails (constant-time login)
	// loginVerified is a test hook called after Login verified the
	// password, inside its transaction.
	loginVerified func()
}

// NewService returns the service.
func NewService(cfg Config) (*Service, error) {
	if cfg.Store == nil || cfg.NewWorld == nil || cfg.Mailer == nil || cfg.Logger == nil || cfg.Region == "" {
		return nil, errors.New("auth: store, world factory, mailer, logger and region are required")
	}
	if cfg.SessionTTL <= 0 || cfg.Freshness <= 0 {
		return nil, errors.New("auth: session TTL and freshness interval must be > 0")
	}
	dummy, err := HashPassword("dummy password for unknown emails", cfg.Argon2)
	if err != nil {
		return nil, err
	}
	return &Service{cfg: cfg, dummy: dummy}, nil
}

// Session is the authenticated session of a request.
type Session struct {
	ID       string
	PlayerID string
	// WorldID is the player's world in the server's region.
	WorldID store.WorldID
	// Refreshed: the sliding expiry was extended by this request (the
	// cookie is re-issued so that its Max-Age slides too).
	Refreshed bool
}

// Player is the public account view returned to its owner.
type Player struct {
	ID            string
	DisplayName   string
	Guest         bool
	Email         *string
	EmailVerified bool
}

func playerView(p *postgres.Player) Player {
	return Player{ID: p.ID, DisplayName: p.DisplayName, Guest: p.Guest(), Email: p.Email, EmailVerified: p.EmailVerifiedAt != nil}
}

// Issued is the result of an operation that may start a session.
type Issued struct {
	Player Player
	// SessionToken is set when a new session was started.
	SessionToken string
	// DeviceToken is set when a new guest was created.
	DeviceToken string
}

// tx runs fn in one database transaction.
func (s *Service) tx(ctx context.Context, fn func(pgx.Tx) error) error {
	return postgres.InTx(ctx, s.cfg.Store.Pool(), fn)
}

// Authenticate resolves a session token. Unknown or expired tokens are
// ErrUnauthorized. The expiry slides (30 days idle by default) and is
// refreshed at most once per hour.
func (s *Service) Authenticate(ctx context.Context, token string) (*Session, error) {
	if token == "" {
		return nil, ErrUnauthorized
	}
	rs, err := postgres.ResolveSession(ctx, s.cfg.Store.Pool(), HashToken(token), s.cfg.Region)
	if errors.Is(err, postgres.ErrNotFound) {
		return nil, ErrUnauthorized
	}
	if err != nil {
		return nil, err
	}
	refreshed := false
	if time.Since(rs.LastSeenAt) > sessionRefresh {
		if err := postgres.RefreshSession(ctx, s.cfg.Store.Pool(), rs.ID, s.cfg.SessionTTL); err != nil {
			return nil, err
		}
		refreshed = true
	}
	return &Session{ID: rs.ID, PlayerID: rs.PlayerID, WorldID: store.WorldID(rs.WorldID), Refreshed: refreshed}, nil
}

// startSession creates a session and returns its token.
func (s *Service) startSession(ctx context.Context, q postgres.Querier, playerID string) (string, error) {
	token, err := NewToken()
	if err != nil {
		return "", err
	}
	if _, err := postgres.CreateSession(ctx, q, playerID, HashToken(token), s.cfg.SessionTTL); err != nil {
		return "", err
	}
	return token, nil
}

// createPlayerWithWorld creates a guest player, its start world (evaluated
// at the database clock) and the world's first advance_to event.
func (s *Service) createPlayerWithWorld(ctx context.Context, tx pgx.Tx, displayName string) (*postgres.Player, error) {
	if displayName == "" {
		name, err := guestName()
		if err != nil {
			return nil, err
		}
		displayName = name
	}
	now, err := postgres.DBNow(ctx, tx)
	if err != nil {
		return nil, err
	}
	p, err := postgres.CreatePlayer(ctx, tx, displayName)
	if err != nil {
		return nil, err
	}
	w, err := s.cfg.NewWorld(now)
	if err != nil {
		return nil, err
	}
	wid, err := s.cfg.Store.CreateWorld(ctx, tx, p.ID, s.cfg.Region, w)
	if err != nil {
		return nil, err
	}
	if err := events.ScheduleAdvanceTo(ctx, tx, wid, now.Add(s.cfg.Freshness)); err != nil {
		return nil, err
	}
	return p, nil
}

// Guest starts a guest session. Without a device token it creates a new
// guest player with a world and returns a new device token; with one it
// starts a new session for that guest (ErrInvalidCredentials when the token
// is unknown or revoked).
func (s *Service) Guest(ctx context.Context, deviceToken string) (*Issued, error) {
	var out Issued
	err := s.tx(ctx, func(tx pgx.Tx) error {
		var p *postgres.Player
		if deviceToken != "" {
			id, err := postgres.TokenPlayer(ctx, tx, postgres.TokenDevice, HashToken(deviceToken))
			if errors.Is(err, postgres.ErrNotFound) {
				return ErrInvalidCredentials
			}
			if err != nil {
				return err
			}
			if p, err = postgres.PlayerByID(ctx, tx, id); errors.Is(err, postgres.ErrNotFound) || (err == nil && !p.Guest()) {
				return ErrInvalidCredentials
			} else if err != nil {
				return err
			}
		} else {
			var err error
			if p, err = s.createPlayerWithWorld(ctx, tx, ""); err != nil {
				return err
			}
			if out.DeviceToken, err = NewToken(); err != nil {
				return err
			}
			if err := postgres.CreateToken(ctx, tx, p.ID, postgres.TokenDevice, HashToken(out.DeviceToken), 0); err != nil {
				return err
			}
		}
		token, err := s.startSession(ctx, tx, p.ID)
		if err != nil {
			return err
		}
		out.Player, out.SessionToken = playerView(p), token
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// NormalizeEmail trims and lower-cases an email and validates its shape.
func NormalizeEmail(email string) (string, error) {
	e := strings.ToLower(strings.TrimSpace(email))
	if len(e) < 3 || len(e) > 254 {
		return "", ErrInvalidEmail
	}
	a, err := mail.ParseAddress(e)
	if err != nil || a.Address != e || a.Name != "" {
		return "", ErrInvalidEmail
	}
	return e, nil
}

// normalizeDisplayName validates an optional display name.
func normalizeDisplayName(name *string) (*string, error) {
	if name == nil {
		return nil, nil
	}
	n := strings.TrimSpace(*name)
	if n == "" || utf8.RuneCountInString(n) > MaxDisplayNameLen || !utf8.ValidString(n) {
		return nil, ErrInvalidDisplayName
	}
	for _, r := range n {
		if !unicode.IsPrint(r) {
			return nil, ErrInvalidDisplayName
		}
	}
	return &n, nil
}

// Register sets email and password. With a guest session (cur) the guest
// keeps its world and its device token is revoked; without a session a
// new player with a world is created and a session started. A session of a
// registered player is ErrAlreadyRegistered; an email in use is
// ErrEmailTaken. A verification mail is sent after commit.
func (s *Service) Register(ctx context.Context, cur *Session, email, password string, displayName *string) (*Issued, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return nil, err
	}
	if err := CheckPassword(password); err != nil {
		return nil, err
	}
	name, err := normalizeDisplayName(displayName)
	if err != nil {
		return nil, err
	}
	hash, err := HashPassword(password, s.cfg.Argon2)
	if err != nil {
		return nil, err
	}
	verifyToken, err := NewToken()
	if err != nil {
		return nil, err
	}
	var out Issued
	err = s.tx(ctx, func(tx pgx.Tx) error {
		var playerID string
		if cur != nil {
			p, err := postgres.LockPlayer(ctx, tx, cur.PlayerID)
			if err != nil {
				return err
			}
			if !p.Guest() {
				return ErrAlreadyRegistered
			}
			playerID = p.ID
		} else {
			initial := ""
			if name != nil {
				initial = *name
			}
			p, err := s.createPlayerWithWorld(ctx, tx, initial)
			if err != nil {
				return err
			}
			playerID = p.ID
			if out.SessionToken, err = s.startSession(ctx, tx, playerID); err != nil {
				return err
			}
		}
		p, err := postgres.SetCredentials(ctx, tx, playerID, email, hash, name)
		if errors.Is(err, postgres.ErrEmailTaken) {
			return ErrEmailTaken
		}
		if err != nil {
			return err
		}
		if err := postgres.RevokeTokens(ctx, tx, playerID, postgres.TokenDevice); err != nil {
			return err
		}
		if err := postgres.CreateToken(ctx, tx, playerID, postgres.TokenVerifyEmail, HashToken(verifyToken), VerifyEmailTTL); err != nil {
			return err
		}
		out.Player = playerView(p)
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.send(ctx, email, "Confirm your New Shores email address",
		"Open this link to confirm your email address:\n\n"+s.link("verify_email", verifyToken)+"\n\nThe link expires in 24 hours.\n")
	return &out, nil
}

func (s *Service) link(action, token string) string {
	return strings.TrimRight(s.cfg.PublicURL, "/") + "/?" + action + "=1&token=" + token
}

// send delivers a mail. Failures are logged by category only: mail server
// replies and wrapped errors can contain the recipient address.
func (s *Service) send(ctx context.Context, to, subject, body string) {
	if err := s.cfg.Mailer.Send(ctx, to, subject, body); err != nil {
		s.cfg.Logger.Error("sending mail failed", "subject", subject, "reason", MailFailure(err))
	}
}

// Login verifies email and password and starts a session, replacing the
// current one. Unknown email and wrong password are the same
// ErrInvalidCredentials (and take the same time).
//
// Verification and session creation run in one transaction that holds the
// player's row lock, which ConfirmPasswordReset takes too: a reset either
// completes first (the old password no longer verifies) or waits until the
// session exists (and then deletes it). A login can therefore never leave
// a session authenticated by a replaced password, and a re-hash can never
// overwrite a newer hash.
func (s *Service) Login(ctx context.Context, cur *Session, email, password string) (*Issued, error) {
	email, err := NormalizeEmail(email)
	if err != nil || len(password) > MaxPasswordLen {
		_, _, _ = VerifyPassword(password, s.dummy, s.cfg.Argon2)
		return nil, ErrInvalidCredentials
	}
	var out Issued
	err = s.tx(ctx, func(tx pgx.Tx) error {
		p, err := postgres.LockPlayerByEmail(ctx, tx, email)
		if err != nil && !errors.Is(err, postgres.ErrNotFound) {
			return err
		}
		if p == nil || p.PasswordHash == nil {
			_, _, _ = VerifyPassword(password, s.dummy, s.cfg.Argon2)
			return ErrInvalidCredentials
		}
		ok, rehash, err := VerifyPassword(password, *p.PasswordHash, s.cfg.Argon2)
		if err != nil {
			return fmt.Errorf("player %s: %w", p.ID, err)
		}
		if !ok {
			return ErrInvalidCredentials
		}
		if s.loginVerified != nil {
			s.loginVerified()
		}
		if rehash {
			h, err := HashPassword(password, s.cfg.Argon2)
			if err != nil {
				return err
			}
			if err := postgres.SetPasswordHash(ctx, tx, p.ID, h); err != nil {
				return err
			}
		}
		if cur != nil {
			if err := postgres.DeleteSession(ctx, tx, cur.ID); err != nil {
				return err
			}
		}
		token, err := s.startSession(ctx, tx, p.ID)
		if err != nil {
			return err
		}
		if err := postgres.TouchLogin(ctx, tx, p.ID); err != nil {
			return err
		}
		out.SessionToken, out.Player = token, playerView(p)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// Logout deletes the session.
func (s *Service) Logout(ctx context.Context, cur *Session) error {
	return postgres.DeleteSession(ctx, s.cfg.Store.Pool(), cur.ID)
}

// Me returns the session's player.
func (s *Service) Me(ctx context.Context, cur *Session) (Player, error) {
	p, err := postgres.PlayerByID(ctx, s.cfg.Store.Pool(), cur.PlayerID)
	if errors.Is(err, postgres.ErrNotFound) {
		return Player{}, ErrUnauthorized
	}
	if err != nil {
		return Player{}, err
	}
	return playerView(p), nil
}

// VerifyEmail consumes a verification token (single use, 24 h).
func (s *Service) VerifyEmail(ctx context.Context, token string) error {
	if token == "" {
		return ErrInvalidToken
	}
	return s.tx(ctx, func(tx pgx.Tx) error {
		id, err := postgres.ConsumeToken(ctx, tx, postgres.TokenVerifyEmail, HashToken(token))
		if errors.Is(err, postgres.ErrNotFound) {
			return ErrInvalidToken
		}
		if err != nil {
			return err
		}
		return postgres.MarkEmailVerified(ctx, tx, id)
	})
}

// RequestPasswordReset sends a reset mail when the email is registered.
// It never reveals whether it is: invalid and unknown emails succeed too,
// and the mail is sent in the background.
func (s *Service) RequestPasswordReset(ctx context.Context, email string) error {
	email, err := NormalizeEmail(email)
	if err != nil {
		return nil
	}
	p, err := postgres.PlayerByEmail(ctx, s.cfg.Store.Pool(), email)
	if errors.Is(err, postgres.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	token, err := NewToken()
	if err != nil {
		return err
	}
	if err := postgres.CreateToken(ctx, s.cfg.Store.Pool(), p.ID, postgres.TokenPasswordReset, HashToken(token), PasswordResetTTL); err != nil {
		return err
	}
	go func(ctx context.Context) {
		ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		s.send(ctx, email, "Reset your New Shores password",
			"Open this link to choose a new password:\n\n"+s.link("password_reset", token)+"\n\nThe link expires in 1 hour. If you did not ask for it, ignore this mail.\n")
	}(context.WithoutCancel(ctx))
	return nil
}

// ConfirmPasswordReset consumes a reset token (single use, 1 h), sets the
// new password and revokes every session of the player.
func (s *Service) ConfirmPasswordReset(ctx context.Context, token, password string) error {
	if err := CheckPassword(password); err != nil {
		return err
	}
	if token == "" {
		return ErrInvalidToken
	}
	hash, err := HashPassword(password, s.cfg.Argon2)
	if err != nil {
		return err
	}
	return s.tx(ctx, func(tx pgx.Tx) error {
		id, err := postgres.ConsumeToken(ctx, tx, postgres.TokenPasswordReset, HashToken(token))
		if errors.Is(err, postgres.ErrNotFound) {
			return ErrInvalidToken
		}
		if err != nil {
			return err
		}
		// Serialise with Login (see there).
		if _, err := postgres.LockPlayer(ctx, tx, id); err != nil {
			return err
		}
		if err := postgres.SetPasswordHash(ctx, tx, id, hash); err != nil {
			return err
		}
		if err := postgres.RevokeTokens(ctx, tx, id, postgres.TokenPasswordReset); err != nil {
			return err
		}
		return postgres.DeleteSessionsOfPlayer(ctx, tx, id)
	})
}

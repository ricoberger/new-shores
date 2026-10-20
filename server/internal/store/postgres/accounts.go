package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ErrNotFound is returned when a player, session or token does not exist
// (or is expired, consumed or revoked).
var ErrNotFound = errors.New("not found")

// ErrEmailTaken is returned when an email is already registered.
var ErrEmailTaken = errors.New("email taken")

// Player is a row of players.
type Player struct {
	ID              string
	DisplayName     string
	Email           *string
	EmailVerifiedAt *time.Time
	PasswordHash    *string
	CreatedAt       time.Time
	LastLoginAt     *time.Time
}

// Guest reports whether the player has not registered yet.
func (p *Player) Guest() bool { return p.Email == nil }

const playerColumns = "id::text, display_name, email, email_verified_at, password_hash, created_at, last_login_at"

func scanPlayer(row pgx.Row) (*Player, error) {
	var p Player
	err := row.Scan(&p.ID, &p.DisplayName, &p.Email, &p.EmailVerifiedAt, &p.PasswordHash, &p.CreatedAt, &p.LastLoginAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// CreatePlayer inserts a guest player.
func CreatePlayer(ctx context.Context, q Querier, displayName string) (*Player, error) {
	return scanPlayer(q.QueryRow(ctx, "INSERT INTO players (display_name) VALUES ($1) RETURNING "+playerColumns, displayName))
}

// PlayerByID returns a player (not archived).
func PlayerByID(ctx context.Context, q Querier, id string) (*Player, error) {
	if !validUUID(id) {
		return nil, ErrNotFound
	}
	return scanPlayer(q.QueryRow(ctx, "SELECT "+playerColumns+" FROM players WHERE id = $1 AND archived_at IS NULL", id))
}

// PlayerByEmail returns the player registered with email (case-insensitive).
func PlayerByEmail(ctx context.Context, q Querier, email string) (*Player, error) {
	return scanPlayer(q.QueryRow(ctx, "SELECT "+playerColumns+" FROM players WHERE lower(email) = lower($1) AND archived_at IS NULL", email))
}

// LockPlayer locks a player row (FOR UPDATE) and returns it.
func LockPlayer(ctx context.Context, tx pgx.Tx, id string) (*Player, error) {
	if !validUUID(id) {
		return nil, ErrNotFound
	}
	return scanPlayer(tx.QueryRow(ctx, "SELECT "+playerColumns+" FROM players WHERE id = $1 AND archived_at IS NULL FOR UPDATE", id))
}

// SetCredentials registers a player: email (lower-cased by the caller),
// password hash and optionally a new display name. ErrEmailTaken when the
// email is in use.
func SetCredentials(ctx context.Context, q Querier, playerID, email, passwordHash string, displayName *string) (*Player, error) {
	p, err := scanPlayer(q.QueryRow(ctx, `UPDATE players
SET email = $2, password_hash = $3, display_name = COALESCE($4, display_name), email_verified_at = NULL
WHERE id = $1 RETURNING `+playerColumns, playerID, email, passwordHash, displayName))
	if isUniqueViolation(err, "players_email_key") {
		return nil, ErrEmailTaken
	}
	return p, err
}

// SetPasswordHash replaces the password hash.
func SetPasswordHash(ctx context.Context, q Querier, playerID, hash string) error {
	_, err := q.Exec(ctx, "UPDATE players SET password_hash = $2 WHERE id = $1", playerID, hash)
	return err
}

// MarkEmailVerified sets email_verified_at (first verification wins).
func MarkEmailVerified(ctx context.Context, q Querier, playerID string) error {
	_, err := q.Exec(ctx, "UPDATE players SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1", playerID)
	return err
}

// TouchLogin sets last_login_at to now.
func TouchLogin(ctx context.Context, q Querier, playerID string) error {
	_, err := q.Exec(ctx, "UPDATE players SET last_login_at = now() WHERE id = $1", playerID)
	return err
}

// Session is a row of sessions.
type Session struct {
	ID         string
	PlayerID   string
	ExpiresAt  time.Time
	LastSeenAt time.Time
}

// CreateSession stores a session by the SHA-256 hash of its token.
func CreateSession(ctx context.Context, q Querier, playerID string, tokenHash []byte, ttl time.Duration) (*Session, error) {
	var s Session
	err := q.QueryRow(ctx, `INSERT INTO sessions (player_id, token_hash, expires_at)
VALUES ($1, $2, now() + $3::interval) RETURNING id::text, player_id::text, expires_at, last_seen_at`,
		playerID, tokenHash, ttl).Scan(&s.ID, &s.PlayerID, &s.ExpiresAt, &s.LastSeenAt)
	if err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}
	return &s, nil
}

// RefreshSession slides the session's expiry to now + ttl.
func RefreshSession(ctx context.Context, q Querier, id string, ttl time.Duration) error {
	_, err := q.Exec(ctx, "UPDATE sessions SET last_seen_at = now(), expires_at = now() + $2::interval WHERE id = $1", id, ttl)
	return err
}

// DeleteSession deletes one session.
func DeleteSession(ctx context.Context, q Querier, id string) error {
	_, err := q.Exec(ctx, "DELETE FROM sessions WHERE id = $1", id)
	return err
}

// DeleteSessionsOfPlayer deletes every session of a player.
func DeleteSessionsOfPlayer(ctx context.Context, q Querier, playerID string) error {
	_, err := q.Exec(ctx, "DELETE FROM sessions WHERE player_id = $1", playerID)
	return err
}

// Token kinds of auth_tokens.
const (
	TokenDevice        = "device"
	TokenVerifyEmail   = "verify_email"
	TokenPasswordReset = "password_reset"
)

// CreateToken stores an auth token by its hash. ttl 0 means no expiry.
func CreateToken(ctx context.Context, q Querier, playerID, kind string, tokenHash []byte, ttl time.Duration) error {
	var err error
	if ttl > 0 {
		_, err = q.Exec(ctx, `INSERT INTO auth_tokens (player_id, kind, token_hash, expires_at)
VALUES ($1, $2, $3, now() + $4::interval)`, playerID, kind, tokenHash, ttl)
	} else {
		_, err = q.Exec(ctx, "INSERT INTO auth_tokens (player_id, kind, token_hash) VALUES ($1, $2, $3)", playerID, kind, tokenHash)
	}
	if err != nil {
		return fmt.Errorf("create %s token: %w", kind, err)
	}
	return nil
}

// TokenPlayer returns the player of a valid (unused, unexpired) token
// without consuming it.
func TokenPlayer(ctx context.Context, q Querier, kind string, tokenHash []byte) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT player_id::text FROM auth_tokens
WHERE kind = $1 AND token_hash = $2 AND used_at IS NULL AND (expires_at IS NULL OR expires_at > now())`, kind, tokenHash).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return id, err
}

// ConsumeToken marks a valid token used and returns its player. A token can
// be consumed once.
func ConsumeToken(ctx context.Context, q Querier, kind string, tokenHash []byte) (string, error) {
	var id string
	err := q.QueryRow(ctx, `UPDATE auth_tokens SET used_at = now()
WHERE kind = $1 AND token_hash = $2 AND used_at IS NULL AND (expires_at IS NULL OR expires_at > now())
RETURNING player_id::text`, kind, tokenHash).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return id, err
}

// RevokeTokens marks every unused token of a kind of the player used.
func RevokeTokens(ctx context.Context, q Querier, playerID, kind string) error {
	_, err := q.Exec(ctx, "UPDATE auth_tokens SET used_at = now() WHERE player_id = $1 AND kind = $2 AND used_at IS NULL", playerID, kind)
	return err
}

// ResolvedSession is a valid session with the player's world in a region
// (WorldID is empty when the player has no world there).
type ResolvedSession struct {
	Session
	WorldID string
}

// ResolveSession returns the unexpired session of a token hash together
// with its player's world in region. Sessions of archived players do not
// resolve.
func ResolveSession(ctx context.Context, q Querier, tokenHash []byte, region string) (*ResolvedSession, error) {
	var (
		s     ResolvedSession
		world *string
	)
	err := q.QueryRow(ctx, `SELECT s.id::text, s.player_id::text, s.expires_at, s.last_seen_at, w.id::text
FROM sessions s
JOIN players p ON p.id = s.player_id AND p.archived_at IS NULL
LEFT JOIN worlds w ON w.player_id = s.player_id AND w.region = $2
WHERE s.token_hash = $1 AND s.expires_at > now()`, tokenHash, region).Scan(&s.ID, &s.PlayerID, &s.ExpiresAt, &s.LastSeenAt, &world)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if world != nil {
		s.WorldID = *world
	}
	return &s, nil
}

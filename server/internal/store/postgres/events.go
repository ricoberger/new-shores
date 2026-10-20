package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ricoberger/new-shores/server/internal/store"
)

// NewEvent is a scheduled event to insert.
type NewEvent struct {
	DueAt    time.Time
	Kind     string
	WorldIDs []store.WorldID
	Payload  json.RawMessage
}

// InsertEvent inserts a pending scheduled event. The caller must hold the
// row lock of every world in WorldIDs in tx: the pending-event cap of
// world updates (WorldNow) is race-free only under this rule. Inserting
// wakes the workers (trigger + NOTIFY on commit).
func InsertEvent(ctx context.Context, tx pgx.Tx, e NewEvent) (int64, error) {
	if len(e.WorldIDs) == 0 {
		return 0, fmt.Errorf("event %s: no worlds", e.Kind)
	}
	ids := make([]string, len(e.WorldIDs))
	for i, id := range e.WorldIDs {
		if !validUUID(string(id)) {
			return 0, fmt.Errorf("event %s: bad world ID %q", e.Kind, id)
		}
		ids[i] = string(id)
	}
	payload := e.Payload
	if len(payload) == 0 {
		payload = json.RawMessage(`{}`)
	}
	var id int64
	err := tx.QueryRow(ctx, `INSERT INTO scheduled_events (due_at, kind, world_ids, payload, next_attempt_at)
VALUES ($1, $2, $3::text[]::uuid[], $4, $1) RETURNING id`,
		e.DueAt.UTC().Truncate(time.Millisecond), e.Kind, ids, []byte(payload)).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("insert event %s: %w", e.Kind, err)
	}
	return id, nil
}

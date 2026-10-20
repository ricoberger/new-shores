package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
	"github.com/ricoberger/new-shores/server/internal/store/postgres"
	"github.com/ricoberger/new-shores/server/internal/telemetry"
)

// Retry policy: after a failed attempt the event is retried 2^attempts
// seconds later; the MaxAttempts-th failure marks it failed.
const MaxAttempts = 5

// Defaults of the worker.
const (
	DefaultPollInterval = time.Second
	DefaultBatchSize    = 10
	// DefaultLease is how long a claimed event is hidden from other
	// workers' claims (a crashed worker's events become claimable again
	// after it). Exactly-once does not depend on it: processing re-locks
	// the event row and re-checks its status.
	DefaultLease = 30 * time.Second
	// notifyChannel is the LISTEN channel notified on insert.
	notifyChannel = "scheduled_events"
)

// Publisher announces committed world changes (Redis pub/sub or the
// in-process hub). Implementations log and count their errors.
type Publisher interface {
	Publish(ctx context.Context, id store.WorldID)
}

// Worker drains the scheduled_events table.
type Worker struct {
	Store     *postgres.Store
	Registry  *Registry
	Catalogue *content.Catalogue
	Publisher Publisher
	Logger    *slog.Logger
	// PollInterval, BatchSize and Lease default to the constants above.
	PollInterval time.Duration
	BatchSize    int
	Lease        time.Duration
}

func (w *Worker) pool() *pgxpool.Pool { return w.Store.Pool() }

// Run processes due events until ctx is cancelled. Cancellation stops the
// loop after the current event has committed (or rolled back).
func (w *Worker) Run(ctx context.Context) error {
	if w.PollInterval <= 0 {
		w.PollInterval = DefaultPollInterval
	}
	if w.BatchSize <= 0 {
		w.BatchSize = DefaultBatchSize
	}
	if w.Lease <= 0 {
		w.Lease = DefaultLease
	}
	wake := make(chan struct{}, 1)
	listenDone := make(chan struct{})
	go func() {
		defer close(listenDone)
		w.listen(ctx, wake)
	}()
	defer func() { <-listenDone }()

	ticker := time.NewTicker(w.PollInterval)
	defer ticker.Stop()
	var lastSample time.Time
	for {
		if ctx.Err() != nil {
			return nil
		}
		n, err := w.RunOnce(ctx)
		if err != nil && ctx.Err() == nil {
			w.Logger.Error("events: claim failed", "error", err)
		}
		// The queue depth is sampled once per poll interval, also while
		// batches keep arriving (a long drain is when it matters).
		if time.Since(lastSample) >= w.PollInterval {
			w.samplePending(ctx)
			lastSample = time.Now()
		}
		if n > 0 {
			continue // drain without waiting
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		case <-wake:
		}
	}
}

// listen wakes the loop on NOTIFY scheduled_events.
func (w *Worker) listen(ctx context.Context, wake chan<- struct{}) {
	for ctx.Err() == nil {
		err := w.listenOnce(ctx, wake)
		if ctx.Err() != nil {
			return
		}
		w.Logger.Warn("events: LISTEN connection lost; polling only until it is back", "error", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(w.PollInterval):
		}
	}
}

func (w *Worker) listenOnce(ctx context.Context, wake chan<- struct{}) error {
	pooled, err := w.pool().Acquire(ctx)
	if err != nil {
		return err
	}
	// The connection stays in LISTEN state: take it out of the pool.
	conn := pooled.Hijack()
	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()
	if _, err := conn.Exec(ctx, "LISTEN "+notifyChannel); err != nil {
		return err
	}
	for {
		if _, err := conn.WaitForNotification(ctx); err != nil {
			return err
		}
		select {
		case wake <- struct{}{}:
		default:
		}
	}
}

func (w *Worker) samplePending(ctx context.Context) {
	var n int64
	if err := w.pool().QueryRow(ctx, "SELECT count(*) FROM scheduled_events WHERE status = 'pending'").Scan(&n); err == nil {
		telemetry.EventsPending.Set(float64(n))
	}
}

type claimed struct {
	id    int64
	dueAt time.Time
}

// RunOnce claims one batch of due events and processes them in due order,
// each in its own transaction. It returns the number of claimed events.
// Processing continues with a context that is not cancelled, so that a
// shutdown lets the current event commit; the remaining claimed events are
// released by their lease.
func (w *Worker) RunOnce(ctx context.Context) (int, error) {
	if w.BatchSize <= 0 {
		w.BatchSize = DefaultBatchSize
	}
	if w.Lease <= 0 {
		w.Lease = DefaultLease
	}
	rows, err := w.pool().Query(ctx, `UPDATE scheduled_events SET next_attempt_at = now() + $2::interval, updated_at = now()
WHERE id IN (
  SELECT id FROM scheduled_events
  WHERE status = 'pending' AND next_attempt_at <= now()
  ORDER BY due_at, id
  LIMIT $1
  FOR UPDATE SKIP LOCKED)
RETURNING id, due_at`, w.BatchSize, w.Lease)
	if err != nil {
		return 0, err
	}
	batch, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (claimed, error) {
		var c claimed
		err := r.Scan(&c.id, &c.dueAt)
		return c, err
	})
	if err != nil {
		return 0, err
	}
	slices.SortFunc(batch, func(a, b claimed) int {
		if c := a.dueAt.Compare(b.dueAt); c != 0 {
			return c
		}
		return int(a.id - b.id)
	})
	for i, c := range batch {
		if i > 0 && ctx.Err() != nil {
			break
		}
		w.process(context.WithoutCancel(ctx), c.id)
	}
	return len(batch), nil
}

// errDeferred: an earlier pending event shares a world; retry shortly.
var errDeferred = errors.New("an earlier event of the same world is pending")

// process applies one event. Failures are recorded on the event (backoff,
// failed after MaxAttempts) and never affect other events.
func (w *Worker) process(ctx context.Context, id int64) {
	begin := time.Now()
	ctx, span := telemetry.Tracer().Start(ctx, "event")
	defer span.End()
	span.SetAttributes(attribute.Int64("event.id", id))

	var (
		ev      *Event
		changed []store.WorldID
		lag     time.Duration
	)
	err := postgres.InTx(ctx, w.pool(), func(tx pgx.Tx) error {
		var err error
		ev, err = lockEvent(ctx, tx, id)
		if err != nil || ev == nil {
			return err
		}
		span.SetAttributes(attribute.String("event.kind", ev.Kind), attribute.StringSlice("world.ids", worldStrings(ev.WorldIDs)))
		if earlier, err := hasEarlierPending(ctx, tx, ev); err != nil {
			return err
		} else if earlier {
			return errDeferred
		}
		now, err := postgres.DBNow(ctx, tx)
		if err != nil {
			return err
		}
		lag = now.Sub(ev.DueAt)
		changed, err = w.apply(ctx, tx, ev)
		return err
	})
	switch {
	case ev == nil && err == nil:
		return // already processed (or failed) by another worker
	case errors.Is(err, errDeferred):
		w.deferEvent(ctx, id)
		return
	case err != nil:
		span.RecordError(err)
		span.SetStatus(codes.Error, "event failed")
		w.fail(ctx, id, ev, err)
		return
	}
	telemetry.EventsLag.Observe(max(0, lag.Seconds()))
	telemetry.EventsHandlerDuration.WithLabelValues(ev.Kind).Observe(time.Since(begin).Seconds())
	telemetry.EventsProcessed.WithLabelValues(ev.Kind, "done").Inc()
	if w.Publisher != nil {
		for _, wid := range changed {
			w.Publisher.Publish(ctx, wid)
		}
	}
}

func worldStrings(ids []store.WorldID) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = string(id)
	}
	return out
}

// lockEvent locks a pending event row; nil when it is no longer pending.
func lockEvent(ctx context.Context, tx pgx.Tx, id int64) (*Event, error) {
	var (
		ev  Event
		ids []string
	)
	err := tx.QueryRow(ctx, `SELECT id, due_at, kind, world_ids::text[], payload, attempts
FROM scheduled_events WHERE id = $1 AND status = 'pending' FOR UPDATE`, id).Scan(&ev.ID, &ev.DueAt, &ev.Kind, &ids, &ev.Payload, &ev.Attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lock event %d: %w", id, err)
	}
	ev.DueAt = ev.DueAt.UTC()
	for _, s := range ids {
		ev.WorldIDs = append(ev.WorldIDs, store.WorldID(s))
	}
	return &ev, nil
}

// hasEarlierPending reports a pending event due earlier (ties by ID) that
// shares a world with ev: events of a world are applied in due order.
func hasEarlierPending(ctx context.Context, tx pgx.Tx, ev *Event) (bool, error) {
	var earlier bool
	err := tx.QueryRow(ctx, `SELECT EXISTS (
  SELECT 1 FROM scheduled_events
  WHERE status = 'pending' AND id <> $1 AND world_ids && $2::text[]::uuid[]
    AND (due_at < $3 OR (due_at = $3 AND id < $1)))`, ev.ID, worldStrings(ev.WorldIDs), ev.DueAt).Scan(&earlier)
	return earlier, err
}

// apply locks the event's worlds in ascending ID order, advances each to
// due_at, runs the handler, saves the worlds, inserts follow-ups and marks
// the event done.
func (w *Worker) apply(ctx context.Context, tx pgx.Tx, ev *Event) ([]store.WorldID, error) {
	h, ok := w.Registry.Handler(ev.Kind)
	if !ok {
		return nil, fmt.Errorf("unregistered event kind %q", ev.Kind)
	}
	ids := slices.Clone(ev.WorldIDs)
	slices.Sort(ids)
	ids = slices.Compact(ids)
	locked := make([]*postgres.LockedWorld, 0, len(ids))
	hc := &HandlerContext{Event: *ev, Worlds: map[store.WorldID]*sim.World{}, Catalogue: w.Catalogue, Logger: w.Logger}
	for _, id := range ids {
		lw, err := w.Store.LockWorld(ctx, tx, id)
		if err != nil {
			return nil, err
		}
		if lw.World.LastEvaluatedAt.After(ev.DueAt) {
			return nil, fmt.Errorf("world %s was evaluated at %s, past the event's due_at %s", id,
				lw.World.LastEvaluatedAt.Format(time.RFC3339Nano), ev.DueAt.Format(time.RFC3339Nano))
		}
		if _, err := sim.Advance(lw.World, w.Catalogue, ev.DueAt); err != nil {
			return nil, fmt.Errorf("advance world %s to due_at: %w", id, err)
		}
		locked = append(locked, lw)
		hc.Worlds[id] = lw.World
	}
	if err := h(ctx, hc); err != nil {
		return nil, fmt.Errorf("%s handler: %w", ev.Kind, err)
	}
	for _, lw := range locked {
		if err := w.Store.SaveWorld(ctx, tx, lw); err != nil {
			return nil, err
		}
	}
	for _, f := range hc.followUps {
		if _, err := postgres.InsertEvent(ctx, tx, postgres.NewEvent(f)); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, "UPDATE scheduled_events SET status = 'done', updated_at = now() WHERE id = $1", ev.ID); err != nil {
		return nil, fmt.Errorf("mark event done: %w", err)
	}
	return ids, nil
}

// deferEvent makes an event claimable again shortly without counting an
// attempt.
func (w *Worker) deferEvent(ctx context.Context, id int64) {
	_, err := w.pool().Exec(ctx, `UPDATE scheduled_events SET next_attempt_at = now() + interval '1 second', updated_at = now()
WHERE id = $1 AND status = 'pending'`, id)
	if err != nil {
		w.Logger.Error("events: defer failed", "event_id", id, "error", err)
	}
}

// maxErrorLen bounds last_error.
const maxErrorLen = 1000

// fail records a failed attempt in a separate statement (the processing
// transaction is rolled back): attempts + 1, last_error, next_attempt_at =
// now + 2^attempts s; failed after MaxAttempts. due_at is never modified.
func (w *Worker) fail(ctx context.Context, id int64, ev *Event, cause error) {
	msg := cause.Error()
	if len(msg) > maxErrorLen {
		msg = msg[:maxErrorLen]
	}
	var (
		attempts int
		status   string
	)
	err := w.pool().QueryRow(ctx, `UPDATE scheduled_events SET
  attempts = attempts + 1,
  last_error = $2,
  next_attempt_at = now() + make_interval(secs => power(2, attempts + 1)),
  status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE 'pending' END,
  updated_at = now()
WHERE id = $1 AND status = 'pending'
RETURNING attempts, status`, id, msg, MaxAttempts).Scan(&attempts, &status)
	kind := "unknown"
	var worlds []string
	if ev != nil {
		kind, worlds = ev.Kind, worldStrings(ev.WorldIDs)
	}
	if err != nil {
		w.Logger.Error("events: recording a failed attempt failed", "event_id", id, "kind", kind, "error", err, "cause", cause)
		return
	}
	if status == "failed" {
		telemetry.EventsProcessed.WithLabelValues(kind, "failed").Inc()
		w.Logger.Error("events: event failed permanently", "event_id", id, "kind", kind, "world_ids", worlds, "attempts", attempts, "error", cause)
		return
	}
	telemetry.EventsProcessed.WithLabelValues(kind, "retry").Inc()
	w.Logger.Warn("events: event attempt failed; retrying", "event_id", id, "kind", kind, "world_ids", worlds,
		"attempts", attempts, "retry_in_s", strconv.Itoa(1<<attempts), "error", cause)
}

// ScheduleAdvanceTo inserts the advance_to event of a world (at world
// creation). The caller holds the world's row lock or created the world in
// tx.
func ScheduleAdvanceTo(ctx context.Context, tx pgx.Tx, id store.WorldID, due time.Time) error {
	_, err := postgres.InsertEvent(ctx, tx, postgres.NewEvent{DueAt: due, Kind: KindAdvanceTo, WorldIDs: []store.WorldID{id}, Payload: json.RawMessage(`{}`)})
	return err
}

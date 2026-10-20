//go:build integration

package testenv

import (
	"context"
	"encoding/json"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/devworld"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
	"github.com/ricoberger/new-shores/server/internal/store/postgres"
)

var (
	catOnce sync.Once
	cat     *content.Catalogue
	catErr  error
)

// Catalogue loads content/old_coast once.
func Catalogue(t testing.TB) *content.Catalogue {
	t.Helper()
	catOnce.Do(func() { cat, catErr = content.Load(filepath.Join(RepoRoot(), "content", "old_coast")) })
	if catErr != nil {
		t.Fatal(catErr)
	}
	return cat
}

// NewWorld creates a player with a dev world evaluated at the database
// clock minus age and returns the player and world IDs.
func NewWorld(t testing.TB, st *postgres.Store, age time.Duration) (string, store.WorldID) {
	t.Helper()
	ctx := context.Background()
	var (
		playerID string
		id       store.WorldID
	)
	err := postgres.InTx(ctx, st.Pool(), func(tx pgx.Tx) error {
		now, err := postgres.DBNow(ctx, tx)
		if err != nil {
			return err
		}
		p, err := postgres.CreatePlayer(ctx, tx, "Tester")
		if err != nil {
			return err
		}
		w, err := devworld.New(Catalogue(t), now.Add(-age))
		if err != nil {
			return err
		}
		playerID = p.ID
		id, err = st.CreateWorld(ctx, tx, p.ID, Catalogue(t).Region.ID, w)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return playerID, id
}

// InsertEvent inserts an event while holding the row locks of its worlds
// (in ascending ID order), as the store requires.
func InsertEvent(t testing.TB, st *postgres.Store, due time.Time, kind string, worlds []store.WorldID, payload any) int64 {
	t.Helper()
	ctx := context.Background()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	var id int64
	err = postgres.InTx(ctx, st.Pool(), func(tx pgx.Tx) error {
		sorted := slices.Clone(worlds)
		slices.Sort(sorted)
		for _, w := range slices.Compact(sorted) {
			if _, err := st.LockWorld(ctx, tx, w); err != nil {
				return err
			}
		}
		var err error
		id, err = postgres.InsertEvent(ctx, tx, postgres.NewEvent{DueAt: due, Kind: kind, WorldIDs: worlds, Payload: raw})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// StoreWorld creates a player owning the given world and inserts the
// pending events of its due moments (postgres.ReconcileDueEvents) in the
// same transaction. It returns the world ID.
func StoreWorld(t testing.TB, st *postgres.Store, w *sim.World) store.WorldID {
	t.Helper()
	ctx := context.Background()
	var id store.WorldID
	err := postgres.InTx(ctx, st.Pool(), func(tx pgx.Tx) error {
		p, err := postgres.CreatePlayer(ctx, tx, "Tester")
		if err != nil {
			return err
		}
		if id, err = st.CreateWorld(ctx, tx, p.ID, Catalogue(t).Region.ID, w); err != nil {
			return err
		}
		if _, err := st.LockWorld(ctx, tx, id); err != nil {
			return err
		}
		_, err = postgres.ReconcileDueEvents(ctx, tx, id, w, 0)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

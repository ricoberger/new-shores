-- D-054: the island tile rows of a world (sim.EncodeTerrain, gzip) are
-- stored apart from the state envelope, keyed by the archipelago seed and
-- re-roll count of the world (0, 0 for a hand-made world). The state of
-- schema 7 has no tiles; LockWorld joins the row of the state's key. A
-- re-roll inserts the new key's row and deletes the old ones.
CREATE TABLE world_terrain (
  world_id   uuid NOT NULL REFERENCES worlds (id) ON DELETE CASCADE,
  seed       bigint NOT NULL,
  roll       int NOT NULL,
  terrain    bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, seed, roll)
);

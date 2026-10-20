-- M2: players, worlds, sessions, auth tokens and scheduled events
-- (docs/ARCHITECTURE.md §4.2/§4.3, docs/ONLINE.md §12).
-- Expand/contract only: later migrations must not drop or rename a column
-- that an older binary still reads.

CREATE TABLE players (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name      text NOT NULL,
  coat_of_arms      jsonb,
  -- Registered players only (NULL for guests); stored trimmed and
  -- lower-cased, unique case-insensitively.
  email             text,
  email_verified_at timestamptz,
  -- argon2id in PHC string format; NULL for guests.
  password_hash     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_login_at     timestamptz,
  archived_at       timestamptz
);

CREATE UNIQUE INDEX players_email_key ON players (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE worlds (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id         uuid NOT NULL REFERENCES players (id),
  region            text NOT NULL,
  state             jsonb NOT NULL,
  schema_version    int NOT NULL,
  version           bigint NOT NULL DEFAULT 0,
  last_evaluated_at timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL
);

-- Regions are first-class (D-010): one world per player and region.
CREATE UNIQUE INDEX worlds_player_region_key ON worlds (player_id, region);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid NOT NULL REFERENCES players (id),
  -- SHA-256 of the session token; the token itself is never stored.
  token_hash   bytea NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_player_id_idx ON sessions (player_id);

-- Single-purpose credentials: guest device tokens (no expiry), email
-- verification (24 h) and password reset (1 h). Only SHA-256 hashes are
-- stored; used_at marks a consumed or revoked token.
CREATE TABLE auth_tokens (
  id         bigserial PRIMARY KEY,
  player_id  uuid NOT NULL REFERENCES players (id),
  kind       text NOT NULL CHECK (kind IN ('device', 'verify_email', 'password_reset')),
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  used_at    timestamptz
);

CREATE INDEX auth_tokens_player_kind_idx ON auth_tokens (player_id, kind);

CREATE TABLE scheduled_events (
  id              bigserial PRIMARY KEY,
  due_at          timestamptz NOT NULL,
  kind            text NOT NULL,
  world_ids       uuid[] NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  attempts        int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Earliest time of the next processing attempt (retry backoff and the
  -- worker's claim lease). Defaults to due_at; due_at itself never changes.
  next_attempt_at timestamptz NOT NULL,
  last_error      text,
  updated_at      timestamptz
);

CREATE INDEX scheduled_events_pending_idx ON scheduled_events (next_attempt_at) WHERE status = 'pending';
-- Pending-event cap of world updates (earliest pending due_at per world).
CREATE INDEX scheduled_events_pending_worlds_idx ON scheduled_events USING gin (world_ids) WHERE status = 'pending';

CREATE FUNCTION scheduled_events_defaults() RETURNS trigger AS $$
BEGIN
  IF NEW.next_attempt_at IS NULL THEN
    NEW.next_attempt_at := NEW.due_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scheduled_events_defaults BEFORE INSERT ON scheduled_events
  FOR EACH ROW EXECUTE FUNCTION scheduled_events_defaults();

-- Wakes the workers (LISTEN scheduled_events) when events are inserted.
CREATE FUNCTION scheduled_events_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('scheduled_events', '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scheduled_events_notify AFTER INSERT ON scheduled_events
  FOR EACH STATEMENT EXECUTE FUNCTION scheduled_events_notify();

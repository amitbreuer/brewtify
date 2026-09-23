CREATE TABLE party_mini_app_sessions (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, init_hash TEXT NOT NULL UNIQUE,
  principal TEXT NOT NULL, csrf TEXT NOT NULL, expires_at TIMESTAMP(3) NOT NULL
);
CREATE INDEX party_mini_app_sessions_expires_at_idx ON party_mini_app_sessions(expires_at);
CREATE TABLE party_authorizations (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES party_mini_app_sessions(id) ON DELETE CASCADE,
  principal TEXT NOT NULL, ticket_hash TEXT NOT NULL UNIQUE, state_hash TEXT UNIQUE,
  browser_hash TEXT, encrypted_verifier TEXT NOT NULL, salt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','launched','consuming','complete','failed')),
  error TEXT, expires_at TIMESTAMP(3) NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX party_authorizations_session_id_created_at_idx ON party_authorizations(session_id, created_at);
CREATE TABLE party_host_sessions (
  id TEXT PRIMARY KEY, principal TEXT NOT NULL UNIQUE, account_key TEXT NOT NULL UNIQUE,
  encrypted_access_token TEXT NOT NULL, encrypted_refresh_token TEXT NOT NULL, salt TEXT NOT NULL,
  scopes TEXT[] NOT NULL, token_expires_at TIMESTAMP(3) NOT NULL, expires_at TIMESTAMP(3) NOT NULL
);
CREATE TABLE party_rooms (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, account_key TEXT NOT NULL,
  join_hash TEXT NOT NULL UNIQUE, encrypted_join TEXT NOT NULL, salt TEXT NOT NULL,
  device_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked','closed','expired')),
  mode TEXT NOT NULL DEFAULT 'host_approval' CHECK (mode IN ('host_approval','auto')),
  blocked_reason TEXT, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX party_one_active_room ON party_rooms(account_key) WHERE status IN ('open','locked');
CREATE INDEX party_rooms_expires_at_idx ON party_rooms(expires_at);
CREATE TABLE party_memberships (
  room_id TEXT NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES party_mini_app_sessions(id) ON DELETE CASCADE,
  participant TEXT NOT NULL, PRIMARY KEY(room_id, session_id)
);
CREATE SEQUENCE party_approval_order;
CREATE TABLE party_requests (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  participant TEXT NOT NULL, submission_key TEXT NOT NULL, display_name TEXT NOT NULL,
  source_url TEXT NOT NULL, source JSONB, selected JSONB, confidence TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','matched','needs_review','approved','added','unavailable','rejected','failed')),
  failure_code TEXT, sequence BIGSERIAL UNIQUE NOT NULL, revision BIGSERIAL UNIQUE NOT NULL, approved_order BIGINT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(room_id,participant,submission_key)
);
CREATE INDEX party_requests_room_id_updated_at_id_idx ON party_requests(room_id,updated_at,id);
CREATE FUNCTION party_request_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.revision := nextval('party_requests_revision_seq');
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$$;
CREATE TRIGGER party_request_changed BEFORE UPDATE ON party_requests FOR EACH ROW EXECUTE FUNCTION party_request_revision();
CREATE TABLE party_match_candidates (
  request_id TEXT NOT NULL REFERENCES party_requests(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL, metadata JSONB NOT NULL, PRIMARY KEY(request_id,track_id)
);
CREATE TABLE party_jobs (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES party_requests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('resolve','deliver')), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done')),
  generation INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
  due_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, dispatched_at TIMESTAMP(3),
  UNIQUE(request_id,kind)
);
CREATE INDEX party_jobs_status_due_at_idx ON party_jobs(status,due_at);
CREATE TABLE party_delivery_attempts (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES party_requests(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL DEFAULT 'sending' CHECK(outcome IN ('sending','accepted','rejected','unknown')),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX party_one_sending_per_room ON party_delivery_attempts(room_id) WHERE outcome='sending';
CREATE INDEX party_delivery_attempts_room_id_outcome_idx ON party_delivery_attempts(room_id,outcome);
CREATE TABLE party_throttles (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at TIMESTAMP(3) NOT NULL);
CREATE INDEX party_throttles_expires_at_idx ON party_throttles(expires_at);

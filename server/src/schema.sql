-- TrustVault database schema (PostgreSQL 15+).
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'owner', 'viewer')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Server-side sessions. Only a SHA-256 hash of the cookie token is stored,
-- so a database leak does not hand out working sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  category        text NOT NULL,
  description     text NOT NULL DEFAULT '',
  owner_id        uuid NOT NULL REFERENCES users(id),
  current_version integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS documents_owner_idx ON documents(owner_id);

-- File bytes live in the database, never on a public disk or bucket.
-- The only way out is the download route, which checks the grant first.
CREATE TABLE IF NOT EXISTS document_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       uuid NOT NULL REFERENCES documents(id),
  version_no        integer NOT NULL,
  original_filename text NOT NULL,
  mime_type         text NOT NULL,
  size_bytes        integer NOT NULL,
  sha256            text NOT NULL,
  content           bytea NOT NULL,
  uploaded_by       uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_no)
);

-- One row = one named person's access to one document.
-- The owner is never stored here; ownership comes from documents.owner_id.
CREATE TABLE IF NOT EXISTS grants (
  document_id uuid NOT NULL REFERENCES documents(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  permission  text NOT NULL CHECK (permission IN ('read', 'edit')),
  granted_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, user_id)
);

-- Append-only audit trail. Each row carries an HMAC over its own payload
-- plus the previous row's hash, so editing or removing a row breaks the chain.
CREATE TABLE IF NOT EXISTS audit_log (
  id             bigserial PRIMARY KEY,
  created_at     timestamptz NOT NULL,
  actor_id       uuid,
  actor_email    text,
  action         text NOT NULL,
  outcome        text NOT NULL CHECK (outcome IN ('allowed', 'denied')),
  document_id    uuid,
  target_user_id uuid,
  ip             text,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload        text NOT NULL,
  prev_hash      text NOT NULL,
  hash           text NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_doc_idx ON audit_log(document_id);
CREATE INDEX IF NOT EXISTS audit_actor_idx ON audit_log(actor_id);

-- The database itself refuses to change or delete audit rows.
CREATE OR REPLACE FUNCTION audit_log_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_change();

DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_change();

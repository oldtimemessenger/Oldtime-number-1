CREATE TABLE IF NOT EXISTS oldtime_app.chat_legacy_archive_parts (
  owner_id uuid NOT NULL REFERENCES oldtime_app.users(id) ON DELETE CASCADE,
  source_id text NOT NULL,
  part integer NOT NULL CHECK (part >= 0 AND part < 100),
  total_parts integer NOT NULL CHECK (total_parts >= 1 AND total_parts <= 100),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_legacy_archive_parts_pk PRIMARY KEY (owner_id, source_id, part),
  CONSTRAINT chat_legacy_archive_part_in_range CHECK (part < total_parts)
);

CREATE INDEX IF NOT EXISTS chat_legacy_archive_owner_created_idx
  ON oldtime_app.chat_legacy_archive_parts (owner_id, created_at DESC);

ALTER TABLE oldtime_app.chat_legacy_archive_parts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE oldtime_app.chat_legacy_archive_parts FROM PUBLIC, anon, authenticated;

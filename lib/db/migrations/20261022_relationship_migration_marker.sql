SET search_path TO oldtime_app, public;

CREATE TABLE IF NOT EXISTS relationship_migrations (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  imported_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE relationship_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE relationship_migrations FROM PUBLIC, anon, authenticated;

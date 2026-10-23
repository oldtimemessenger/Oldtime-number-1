-- Additive and repeatable. Run against development, not automatically at boot.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'personal';
ALTER TABLE users ADD COLUMN IF NOT EXISTS professional_profile jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS analytics_resources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source_id text NOT NULL,kind text NOT NULL,title text NOT NULL,is_public boolean NOT NULL DEFAULT false,
 duration_ms integer,published_at timestamptz NOT NULL,deleted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS analytics_resource_source_unique ON analytics_resources(owner_id,source_id);
CREATE INDEX IF NOT EXISTS analytics_resource_owner_idx ON analytics_resources(owner_id,created_at);
CREATE TABLE IF NOT EXISTS analytics_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),resource_id uuid NOT NULL REFERENCES analytics_resources(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,nonce uuid NOT NULL,source text NOT NULL,
 watched_ms integer NOT NULL DEFAULT 0,visible_ms integer NOT NULL DEFAULT 0,progress double precision NOT NULL DEFAULT 0,
 qualified boolean NOT NULL DEFAULT false,completed boolean NOT NULL DEFAULT false,started_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS analytics_session_nonce_unique ON analytics_sessions(actor_id,nonce);
CREATE INDEX IF NOT EXISTS analytics_session_resource_idx ON analytics_sessions(resource_id,started_at);
CREATE TABLE IF NOT EXISTS analytics_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 resource_id uuid REFERENCES analytics_resources(id) ON DELETE CASCADE,
 kind text NOT NULL,source text NOT NULL,dedup_key text NOT NULL,value integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS analytics_event_dedup_unique ON analytics_events(owner_id,actor_id,dedup_key);
CREATE INDEX IF NOT EXISTS analytics_event_owner_idx ON analytics_events(owner_id,created_at);
CREATE INDEX IF NOT EXISTS analytics_event_resource_idx ON analytics_events(resource_id,created_at);
CREATE TABLE IF NOT EXISTS analytics_daily (
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,day text NOT NULL,kind text NOT NULL,
 value integer NOT NULL DEFAULT 0,PRIMARY KEY(owner_id,day,kind)
);
CREATE TABLE IF NOT EXISTS analytics_follows (
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,actor_id)
);
COMMIT;

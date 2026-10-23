-- ADDITIVE development migration only. Review and apply to development.
-- Managed production schema is applied by Publish, never by app startup.
BEGIN;
ALTER TABLE blue_badge_entitlements ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'active';
ALTER TABLE blue_badge_entitlements ADD COLUMN IF NOT EXISTS auto_renews boolean;
ALTER TABLE blue_badge_entitlements ADD COLUMN IF NOT EXISTS canceled_at timestamptz;
ALTER TABLE blue_badge_entitlements ADD COLUMN IF NOT EXISTS billing_issue_at timestamptz;
CREATE TABLE IF NOT EXISTS creator_original_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id text NOT NULL, surface text NOT NULL, kind text NOT NULL,
  body text NOT NULL, fingerprint text NOT NULL, original boolean NOT NULL DEFAULT false,
  deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS creator_content_source_unique ON creator_original_content(user_id, source_id);
CREATE INDEX IF NOT EXISTS creator_content_fingerprint_idx ON creator_original_content(fingerprint);
CREATE TABLE IF NOT EXISTS creator_media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_path text NOT NULL, content_type text NOT NULL, size integer NOT NULL,
  fingerprint text, confirmed_at timestamptz,
  content_id uuid REFERENCES creator_original_content(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_media_owner_idx ON creator_media_assets(user_id, created_at);
CREATE TABLE IF NOT EXISTS post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_comments_post_idx ON post_comments(post_id,created_at);
CREATE TABLE IF NOT EXISTS blue_badge_store_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store text NOT NULL, subscription_key text NOT NULL, product_id text NOT NULL,
  state text NOT NULL, observed_at timestamptz NOT NULL, verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL, auto_renews boolean, canceled_at timestamptz,
  revoked_at timestamptz, billing_issue_at timestamptz, intro_used boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS badge_store_subscription_unique ON blue_badge_store_subscriptions(store,subscription_key);
CREATE INDEX IF NOT EXISTS badge_store_user_idx ON blue_badge_store_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS blue_badge_store_events (
  store text NOT NULL, event_id text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store,event_id)
);
COMMIT;

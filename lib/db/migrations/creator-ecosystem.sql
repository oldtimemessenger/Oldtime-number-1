BEGIN;
CREATE TABLE IF NOT EXISTS creator_program_accounts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'rising',
  approved_at timestamptz,
  restricted boolean NOT NULL DEFAULT false,
  is_admin boolean NOT NULL DEFAULT false,
  interested boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz,
  returning_offer_until timestamptz,
  preferences jsonb NOT NULL DEFAULT '{"features":true,"promotions":true,"creators":true,"communities":true}'
);
CREATE TABLE IF NOT EXISTS blue_badge_entitlements (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  store text NOT NULL CHECK (store IN ('apple', 'google')),
  transaction_id text NOT NULL,
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  intro_used boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS blue_badge_transaction_unique ON blue_badge_entitlements (store, transaction_id);
CREATE TABLE IF NOT EXISTS creator_program_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_history_user_idx ON creator_program_history (user_id, created_at);
CREATE TABLE IF NOT EXISTS creator_program_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS announcement_dismissals (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id text NOT NULL,
  choice text NOT NULL CHECK (choice IN ('not-now', 'never')),
  dismiss_until timestamptz,
  PRIMARY KEY (user_id, campaign_id)
);
CREATE TABLE IF NOT EXISTS announcement_events (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id text NOT NULL,
  event text NOT NULL CHECK (event IN ('shown', 'action')),
  day date NOT NULL,
  count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, campaign_id, event, day)
);
COMMIT;

-- Additive migration. Does not alter or remove any existing Oldtime data.
BEGIN;
CREATE TABLE IF NOT EXISTS tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL, description text NOT NULL, rules text NOT NULL,
  hosting_type text NOT NULL CHECK (hosting_type IN ('self','person','friend','team','community')),
  visibility text NOT NULL CHECK (visibility IN ('public','invite_only')),
  scoring_method text NOT NULL DEFAULT 'verified_support' CHECK (scoring_method = 'verified_support'),
  goal integer NOT NULL CHECK (goal BETWEEN 1 AND 100000),
  featured_user_id uuid REFERENCES users(id),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  published_at timestamptz, cancelled_at timestamptz, completed_at timestamptz,
  final_results jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tournaments_host_idx ON tournaments(host_id);
CREATE INDEX IF NOT EXISTS tournaments_ends_idx ON tournaments(ends_at);
CREATE TABLE IF NOT EXISTS tournament_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, name text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tournament_teams_name_unique ON tournament_teams(tournament_id,name);
CREATE TABLE IF NOT EXISTS tournament_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id), role text NOT NULL DEFAULT 'competitor' CHECK (role IN ('competitor','featured')),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','accepted','declined')),
  team_id uuid REFERENCES tournament_teams(id),
  accepted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tournament_participant_unique ON tournament_participants(tournament_id,user_id);
CREATE INDEX IF NOT EXISTS tournament_participants_user_idx ON tournament_participants(user_id);
CREATE TABLE IF NOT EXISTS tournament_supports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  participant_id uuid NOT NULL REFERENCES tournament_participants(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tournament_support_unique ON tournament_supports(tournament_id,user_id);
CREATE TABLE IF NOT EXISTS tournament_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id), action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tournament_audit_tournament_idx ON tournament_audit(tournament_id,created_at);

-- Flexible, server-validated tournament settings. Existing competitions keep
-- their original behavior and receive explicit, compatible defaults.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'community';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS cover_theme text NOT NULL DEFAULT 'arena';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS support_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS open_to_participants boolean NOT NULL DEFAULT true;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS max_participants integer;
ALTER TABLE tournament_teams ADD COLUMN IF NOT EXISTS captain_id uuid REFERENCES users(id);
ALTER TABLE tournament_participants ADD COLUMN IF NOT EXISTS response_message text;

ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_visibility_check;
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_scoring_method_check;
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_category_check;
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_cover_theme_check;
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_max_participants_check;
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_goal_check;
-- Translate the previous single scoring option before validating the expanded
-- constraint, preserving its meaning while making the current name explicit.
UPDATE tournaments SET scoring_method = 'community_support'
  WHERE scoring_method = 'verified_support';
ALTER TABLE tournaments ALTER COLUMN scoring_method SET DEFAULT 'community_support';
ALTER TABLE tournaments ADD CONSTRAINT tournaments_visibility_check CHECK (visibility IN ('public','private','invite_only'));
ALTER TABLE tournaments ADD CONSTRAINT tournaments_scoring_method_check CHECK (scoring_method IN ('community_support','participant_entries'));
ALTER TABLE tournaments ADD CONSTRAINT tournaments_category_check CHECK (category IN ('fitness','community','gaming','creative','learning','sports','other'));
ALTER TABLE tournaments ADD CONSTRAINT tournaments_cover_theme_check CHECK (cover_theme IN ('arena','ember','circuit','grid','spotlight'));
ALTER TABLE tournaments ADD CONSTRAINT tournaments_max_participants_check CHECK (max_participants IS NULL OR max_participants BETWEEN 2 AND 500);
ALTER TABLE tournaments ADD CONSTRAINT tournaments_goal_check CHECK (goal BETWEEN 1 AND 100000);

ALTER TABLE tournament_participants DROP CONSTRAINT IF EXISTS tournament_participants_status_check;
ALTER TABLE tournament_participants DROP CONSTRAINT IF EXISTS tournament_participants_role_check;
ALTER TABLE tournament_participants ADD CONSTRAINT tournament_participants_status_check
  CHECK (status IN ('invited','accepted','declined','change_requested','withdrawn'));
ALTER TABLE tournament_participants ADD CONSTRAINT tournament_participants_role_check
  CHECK (role IN ('competitor','featured','captain'));

-- Preserve existing team ownership when the new captain field is introduced.
UPDATE tournament_teams AS t SET captain_id = (
  SELECT p.user_id FROM tournament_participants AS p
  WHERE p.team_id = t.id AND p.status = 'accepted'
  ORDER BY p.created_at, p.id LIMIT 1
) WHERE t.captain_id IS NULL;
UPDATE tournament_participants AS p SET role = 'captain'
FROM tournament_teams AS t
WHERE t.id = p.team_id AND t.captain_id = p.user_id AND p.status = 'accepted';

CREATE TABLE IF NOT EXISTS tournament_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  kind text NOT NULL,
  body text NOT NULL,
  essential boolean NOT NULL DEFAULT true,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_notifications_recipient_event_unique UNIQUE (recipient_id,event_key)
);
CREATE INDEX IF NOT EXISTS tournament_notifications_recipient_created_idx
  ON tournament_notifications(recipient_id,created_at DESC);
CREATE TABLE IF NOT EXISTS tournament_notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  non_essential_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;

ALTER TABLE oldtime_app.users
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS privacy_initialized boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS oldtime_app.close_friend_members (
  owner_id uuid NOT NULL REFERENCES oldtime_app.users(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES oldtime_app.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT close_friend_members_pk PRIMARY KEY (owner_id, member_id),
  CONSTRAINT close_friend_members_no_self CHECK (owner_id <> member_id)
);
CREATE INDEX IF NOT EXISTS close_friend_members_member_idx
  ON oldtime_app.close_friend_members (member_id);

CREATE TABLE IF NOT EXISTS oldtime_app.account_blocks (
  owner_id uuid NOT NULL REFERENCES oldtime_app.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES oldtime_app.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_blocks_pk PRIMARY KEY (owner_id, blocked_id),
  CONSTRAINT account_blocks_no_self CHECK (owner_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS account_blocks_blocked_idx
  ON oldtime_app.account_blocks (blocked_id);

CREATE TABLE IF NOT EXISTS oldtime_app.stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES oldtime_app.users(id) ON DELETE CASCADE,
  text text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'close-friends')),
  media_path text,
  media_type text CHECK (media_type IS NULL OR media_type IN ('photo', 'video')),
  media_ready boolean NOT NULL DEFAULT true,
  saved_to_profile boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT stories_media_pair CHECK ((media_path IS NULL) = (media_type IS NULL))
);
CREATE INDEX IF NOT EXISTS stories_author_created_idx
  ON oldtime_app.stories (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stories_visibility_expiry_idx
  ON oldtime_app.stories (visibility, expires_at);

ALTER TABLE oldtime_app.close_friend_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE oldtime_app.account_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE oldtime_app.stories ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE oldtime_app.close_friend_members IS
  'Private audience membership; access is enforced by the authenticated Oldtime API.';
COMMENT ON TABLE oldtime_app.account_blocks IS
  'Account blocks; access is enforced by the authenticated Oldtime API.';
COMMENT ON TABLE oldtime_app.stories IS
  'Story metadata; media lives in the private oldtime-media Supabase Storage bucket.';

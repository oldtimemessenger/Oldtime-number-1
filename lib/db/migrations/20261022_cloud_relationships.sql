SET search_path TO oldtime_app, public;

CREATE TABLE IF NOT EXISTS user_follows (
  follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_follows_pk PRIMARY KEY (follower_id, followed_id),
  CONSTRAINT user_follows_no_self CHECK (follower_id <> followed_id)
);
CREATE INDEX IF NOT EXISTS user_follows_followed_idx ON user_follows (followed_id, created_at);

CREATE TABLE IF NOT EXISTS follow_requests (
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT follow_requests_pk PRIMARY KEY (requester_id, recipient_id),
  CONSTRAINT follow_requests_no_self CHECK (requester_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS follow_requests_recipient_idx ON follow_requests (recipient_id, created_at);

CREATE TABLE IF NOT EXISTS friend_requests (
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friend_requests_pk PRIMARY KEY (requester_id, recipient_id),
  CONSTRAINT friend_requests_no_self CHECK (requester_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS friend_requests_recipient_idx ON friend_requests (recipient_id, created_at);

CREATE TABLE IF NOT EXISTS friendships (
  member_low_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_high_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friendships_pk PRIMARY KEY (member_low_id, member_high_id),
  CONSTRAINT friendships_ordered_members CHECK (member_low_id < member_high_id)
);
CREATE INDEX IF NOT EXISTS friendships_high_idx ON friendships (member_high_id, created_at);

ALTER TABLE user_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE user_follows, follow_requests, friend_requests, friendships
  FROM PUBLIC, anon, authenticated;

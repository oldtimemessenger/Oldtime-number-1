CREATE TABLE IF NOT EXISTS oldtime_app.post_reposts (
  post_id uuid NOT NULL REFERENCES oldtime_app.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES oldtime_app.users(id) ON DELETE CASCADE,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_reposts_pk PRIMARY KEY (post_id, user_id),
  CONSTRAINT post_reposts_note_length CHECK (char_length(note) <= 140)
);

CREATE INDEX IF NOT EXISTS post_reposts_post_updated_idx
  ON oldtime_app.post_reposts(post_id, updated_at);
CREATE INDEX IF NOT EXISTS post_reposts_user_idx
  ON oldtime_app.post_reposts(user_id, post_id);

ALTER TABLE oldtime_app.post_reposts ENABLE ROW LEVEL SECURITY;

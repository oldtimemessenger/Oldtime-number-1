ALTER TABLE oldtime_app.post_comments
  ADD COLUMN IF NOT EXISTS parent_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'post_comments_parent_id_fkey'
      AND conrelid = 'oldtime_app.post_comments'::regclass
  ) THEN
    ALTER TABLE oldtime_app.post_comments
      ADD CONSTRAINT post_comments_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES oldtime_app.post_comments(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS oldtime_app.post_comment_reactions (
  comment_id uuid NOT NULL REFERENCES oldtime_app.post_comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES oldtime_app.users(id) ON DELETE CASCADE,
  reaction text NOT NULL CHECK (reaction IN ('like', 'dislike')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS post_comment_reactions_user_idx
  ON oldtime_app.post_comment_reactions (user_id, created_at DESC);

ALTER TABLE oldtime_app.post_comment_reactions ENABLE ROW LEVEL SECURITY;

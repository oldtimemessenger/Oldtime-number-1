ALTER TABLE oldtime_app.stories
  ADD COLUMN IF NOT EXISTS comments_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS oldtime_app.story_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES oldtime_app.stories(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES oldtime_app.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS story_comments_story_created_idx
  ON oldtime_app.story_comments (story_id, created_at);
CREATE INDEX IF NOT EXISTS story_comments_author_created_idx
  ON oldtime_app.story_comments (author_id, created_at);

ALTER TABLE oldtime_app.story_comments ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE oldtime_app.story_comments IS
  'Story replies are read and written only through the authenticated Oldtime API.';

-- Add a server-owned source relationship for published post remixes.
-- Existing posts remain unchanged; deleting a source preserves the remix.
ALTER TABLE oldtime_app.posts
  ADD COLUMN IF NOT EXISTS remix_source_post_id uuid
  REFERENCES oldtime_app.posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS posts_remix_source_post_idx
  ON oldtime_app.posts(remix_source_post_id)
  WHERE remix_source_post_id IS NOT NULL;

COMMENT ON COLUMN oldtime_app.posts.remix_source_post_id IS
  'Original Oldtime post that this published remix is based on.';

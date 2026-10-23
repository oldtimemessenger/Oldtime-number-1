ALTER TABLE oldtime_app.stories
  ADD COLUMN IF NOT EXISTS source_id text;

CREATE UNIQUE INDEX IF NOT EXISTS stories_author_source_unique
  ON oldtime_app.stories (author_id, source_id);

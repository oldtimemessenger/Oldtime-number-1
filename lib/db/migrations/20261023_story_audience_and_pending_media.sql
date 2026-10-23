ALTER TABLE oldtime_app.stories
  DROP CONSTRAINT IF EXISTS stories_media_pair,
  DROP CONSTRAINT IF EXISTS stories_visibility_check;

ALTER TABLE oldtime_app.stories
  ADD CONSTRAINT stories_media_pair CHECK (
    (media_path IS NULL AND media_type IS NULL)
    OR (media_path IS NULL AND media_type IS NOT NULL AND media_ready = false)
    OR (media_path IS NOT NULL AND media_type IS NOT NULL AND media_ready = true)
  ),
  ADD CONSTRAINT stories_visibility_check CHECK (
    visibility IN ('public', 'followers', 'friends', 'close-friends')
  );

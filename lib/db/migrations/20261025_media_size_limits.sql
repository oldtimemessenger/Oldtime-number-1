ALTER TABLE oldtime_app.user_media_assets
  DROP CONSTRAINT IF EXISTS user_media_assets_size_check;
ALTER TABLE oldtime_app.user_media_assets
  ALTER COLUMN size TYPE bigint USING size::bigint;
ALTER TABLE oldtime_app.user_media_assets
  ADD CONSTRAINT user_media_assets_size_check CHECK (size > 0);

ALTER TABLE oldtime_app.creator_media_assets
  ALTER COLUMN size TYPE bigint USING size::bigint;

UPDATE storage.buckets
SET file_size_limit = NULL,
    allowed_mime_types = ARRAY[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm',
      'audio/mp4', 'audio/webm', 'audio/ogg', 'audio/mpeg',
      'application/pdf', 'text/plain', 'text/csv', 'application/rtf', 'application/zip',
      'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ]::text[]
WHERE id = 'oldtime-media';

ALTER TABLE oldtime_app.chat_members
  ADD COLUMN IF NOT EXISTS state jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS oldtime_app.chat_message_media (
  message_id text NOT NULL REFERENCES oldtime_app.chat_messages(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES oldtime_app.user_media_assets(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, media_id),
  CONSTRAINT chat_message_media_position_unique UNIQUE (message_id, position)
);

CREATE INDEX IF NOT EXISTS chat_message_media_asset_idx
  ON oldtime_app.chat_message_media(media_id);

ALTER TABLE oldtime_app.chat_message_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE oldtime_app.chat_message_media FROM PUBLIC, anon, authenticated;

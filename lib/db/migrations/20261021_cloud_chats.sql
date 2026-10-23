CREATE TABLE IF NOT EXISTS oldtime_app.chat_conversations (
  id text PRIMARY KEY,
  created_by uuid NOT NULL REFERENCES oldtime_app.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oldtime_app.chat_members (
  conversation_id text NOT NULL REFERENCES oldtime_app.chat_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES oldtime_app.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  CONSTRAINT chat_members_pk PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS oldtime_app.chat_messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES oldtime_app.chat_conversations(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES oldtime_app.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'text',
  body text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz
);

CREATE INDEX IF NOT EXISTS chat_conversations_updated_idx ON oldtime_app.chat_conversations(updated_at);
CREATE INDEX IF NOT EXISTS chat_members_user_idx ON oldtime_app.chat_members(user_id, conversation_id);
CREATE INDEX IF NOT EXISTS chat_messages_room_created_idx ON oldtime_app.chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS chat_messages_author_idx ON oldtime_app.chat_messages(author_id, created_at);

ALTER TABLE oldtime_app.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE oldtime_app.chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE oldtime_app.chat_messages ENABLE ROW LEVEL SECURITY;

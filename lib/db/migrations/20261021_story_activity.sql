CREATE TABLE IF NOT EXISTS oldtime_app.story_views (
  story_id uuid NOT NULL REFERENCES oldtime_app.stories(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES oldtime_app.users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT story_views_pk PRIMARY KEY (story_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS story_views_story_viewed_idx
  ON oldtime_app.story_views (story_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS story_views_viewer_viewed_idx
  ON oldtime_app.story_views (viewer_id, viewed_at DESC);

CREATE TABLE IF NOT EXISTS oldtime_app.story_reactions (
  story_id uuid NOT NULL REFERENCES oldtime_app.stories(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES oldtime_app.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT story_reactions_pk PRIMARY KEY (story_id, actor_id)
);

CREATE INDEX IF NOT EXISTS story_reactions_story_updated_idx
  ON oldtime_app.story_reactions (story_id, updated_at DESC);

ALTER TABLE oldtime_app.story_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE oldtime_app.story_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE oldtime_app.story_views FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE oldtime_app.story_reactions FROM PUBLIC, anon, authenticated;

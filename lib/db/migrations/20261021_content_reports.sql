CREATE TABLE IF NOT EXISTS oldtime_app.content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES oldtime_app.users(id) ON DELETE CASCADE,
  target_user_id uuid REFERENCES oldtime_app.users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  category text NOT NULL,
  post_id text,
  comment_id text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_reports_reporter_created_idx
  ON oldtime_app.content_reports (reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_reports_status_created_idx
  ON oldtime_app.content_reports (status, created_at DESC);

ALTER TABLE oldtime_app.content_reports ENABLE ROW LEVEL SECURITY;

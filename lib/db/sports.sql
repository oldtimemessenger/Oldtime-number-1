CREATE TABLE IF NOT EXISTS sports_workouts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recording jsonb NOT NULL,
  summary jsonb NOT NULL,
  recording_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sports_workouts_owner_created_idx ON sports_workouts(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS sports_media (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id uuid NOT NULL REFERENCES sports_workouts(id) ON DELETE CASCADE,
  object jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS sports_card jsonb;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS sports_workout_id uuid REFERENCES sports_workouts(id) ON DELETE CASCADE;

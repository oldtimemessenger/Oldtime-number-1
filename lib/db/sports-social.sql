CREATE TABLE IF NOT EXISTS sports_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL, description text NOT NULL DEFAULT '', activity_type text NOT NULL,
  goal_distance_m integer NOT NULL CHECK(goal_distance_m > 0), visibility text NOT NULL DEFAULT 'invite_only',
  starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz NOT NULL CHECK(ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS sports_challenges_creator_idx ON sports_challenges(creator_id);
CREATE TABLE IF NOT EXISTS sports_members (
  challenge_id uuid NOT NULL REFERENCES sports_challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'invited',
  joined_at timestamptz, PRIMARY KEY(challenge_id,user_id)
);
CREATE INDEX IF NOT EXISTS sports_members_user_idx ON sports_members(user_id);
CREATE TABLE IF NOT EXISTS sports_workout_tags (
  workout_id uuid PRIMARY KEY REFERENCES sports_workouts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id uuid REFERENCES sports_challenges(id) ON DELETE CASCADE,
  tagged_user_ids jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS sports_workout_tags_challenge_idx ON sports_workout_tags(challenge_id);
ALTER TABLE sports_media ADD COLUMN IF NOT EXISTS mime text NOT NULL DEFAULT 'image/jpeg';
ALTER TABLE sports_workout_tags ALTER COLUMN challenge_id DROP NOT NULL;

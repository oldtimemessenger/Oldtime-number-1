SET search_path TO oldtime_app, public;

ALTER TABLE user_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE user_follows, follow_requests, friend_requests, friendships
  FROM PUBLIC, anon, authenticated;

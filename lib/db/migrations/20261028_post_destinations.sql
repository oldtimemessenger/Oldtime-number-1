ALTER TABLE "oldtime_app"."posts"
  ADD COLUMN "destination" text NOT NULL DEFAULT 'both'
  CHECK ("destination" IN ('main', 'community', 'both'));

CREATE INDEX "posts_destination_created_at_idx"
  ON "oldtime_app"."posts" ("destination", "created_at");

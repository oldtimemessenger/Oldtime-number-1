ALTER TABLE "oldtime_app"."posts"
  ADD COLUMN "visibility" text NOT NULL DEFAULT 'public'
  CHECK ("visibility" IN ('public', 'close-friends'));
CREATE TABLE "oldtime_app"."post_media_assets" (
  "post_id" uuid NOT NULL REFERENCES "oldtime_app"."posts"("id") ON DELETE CASCADE,
  "media_id" uuid NOT NULL REFERENCES "oldtime_app"."user_media_assets"("id") ON DELETE CASCADE,
  "position" integer NOT NULL CHECK ("position" >= 0 AND "position" < 10),
  PRIMARY KEY ("post_id", "media_id")
);
CREATE INDEX "post_media_assets_media_idx"
  ON "oldtime_app"."post_media_assets" ("media_id");
CREATE INDEX "post_media_assets_post_order_idx"
  ON "oldtime_app"."post_media_assets" ("post_id", "position");
ALTER TABLE "oldtime_app"."post_media_assets" ENABLE ROW LEVEL SECURITY;

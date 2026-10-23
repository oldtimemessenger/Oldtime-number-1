CREATE TABLE "oldtime_app"."user_media_assets" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "oldtime_app"."users"("id") ON DELETE CASCADE,
  "object_key" text NOT NULL UNIQUE,
  "content_type" text NOT NULL,
  "size" integer NOT NULL CHECK ("size" > 0 AND "size" <= 26214400),
  "sha256" text NOT NULL CHECK (length("sha256") = 64),
  "ready" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "user_media_assets_owner_created_idx"
  ON "oldtime_app"."user_media_assets" ("user_id", "created_at");
ALTER TABLE "oldtime_app"."user_media_assets" ENABLE ROW LEVEL SECURITY;

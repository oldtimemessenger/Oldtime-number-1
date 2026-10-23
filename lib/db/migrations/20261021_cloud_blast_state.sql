CREATE TABLE "oldtime_app"."blast_account_state" (
  "user_id" uuid NOT NULL REFERENCES "oldtime_app"."users"("id") ON DELETE CASCADE,
  "scope" text NOT NULL CHECK ("scope" IN ('social', 'video-notes')),
  "revision" integer NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "data" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "scope")
);
ALTER TABLE "oldtime_app"."blast_account_state" ENABLE ROW LEVEL SECURITY;

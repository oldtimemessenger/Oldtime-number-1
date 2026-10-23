CREATE TABLE "oldtime_app"."creative_drafts" (
  "user_id" uuid NOT NULL REFERENCES "oldtime_app"."users"("id") ON DELETE CASCADE,
  "context" text NOT NULL CHECK (length("context") BETWEEN 1 AND 120),
  "data" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "context")
);
ALTER TABLE "oldtime_app"."creative_drafts" ENABLE ROW LEVEL SECURITY;

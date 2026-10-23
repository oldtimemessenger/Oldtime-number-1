CREATE TABLE "oldtime_app"."account_state" (
  "user_id" uuid PRIMARY KEY REFERENCES "oldtime_app"."users"("id") ON DELETE CASCADE,
  "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "oldtime_app"."account_state" ENABLE ROW LEVEL SECURITY;

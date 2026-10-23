-- Preserve disabled-feature records without bringing the feature back.
CREATE SCHEMA oldtime_archive;
REVOKE ALL ON SCHEMA oldtime_archive FROM PUBLIC, anon, authenticated;
CREATE TABLE oldtime_archive.retired_table_definitions (
  source_table text PRIMARY KEY,
  definition jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE oldtime_archive.retired_records (
  source_table text NOT NULL REFERENCES oldtime_archive.retired_table_definitions(source_table),
  row_index bigint NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (source_table, row_index)
);
ALTER TABLE oldtime_archive.retired_table_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE oldtime_archive.retired_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA oldtime_archive FROM PUBLIC, anon, authenticated;

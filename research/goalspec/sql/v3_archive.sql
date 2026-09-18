-- This isolated append-only archive does not alter any goalspec runtime table.
CREATE SCHEMA IF NOT EXISTS goalspec_v3_archive;
-- statement-break
CREATE TABLE IF NOT EXISTS goalspec_v3_archive.archive_import (
  archive_id text PRIMARY KEY,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_utf8 text NOT NULL,
  payload jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
-- statement-break
CREATE TABLE IF NOT EXISTS goalspec_v3_archive.cohort_manifest (
  archive_id text NOT NULL REFERENCES goalspec_v3_archive.archive_import(archive_id),
  row_index bigint NOT NULL CHECK (row_index >= 0),
  cohort_id text NOT NULL,
  row_sha256 text NOT NULL,
  canonical_utf8 text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (archive_id, cohort_id),
  UNIQUE (archive_id, row_index)
);
-- statement-break
CREATE TABLE IF NOT EXISTS goalspec_v3_archive.artifact_file (
  archive_id text NOT NULL REFERENCES goalspec_v3_archive.archive_import(archive_id),
  row_index bigint NOT NULL CHECK (row_index >= 0),
  source_id text NOT NULL,
  cohort_id text,
  row_sha256 text NOT NULL,
  canonical_utf8 text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (archive_id, source_id),
  UNIQUE (archive_id, row_index),
  FOREIGN KEY (archive_id, cohort_id) REFERENCES goalspec_v3_archive.cohort_manifest(archive_id, cohort_id)
);
-- statement-break
CREATE TABLE IF NOT EXISTS goalspec_v3_archive.artifact_record (
  archive_id text NOT NULL REFERENCES goalspec_v3_archive.archive_import(archive_id),
  row_index bigint NOT NULL CHECK (row_index >= 0),
  source_id text NOT NULL,
  source_row bigint NOT NULL CHECK (source_row >= 0),
  cohort_id text,
  run_id text,
  arm text,
  event_type text,
  raw_utf8 text NOT NULL,
  row_sha256 text NOT NULL,
  canonical_utf8 text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (archive_id, source_id, source_row),
  UNIQUE (archive_id, row_index),
  FOREIGN KEY (archive_id, source_id) REFERENCES goalspec_v3_archive.artifact_file(archive_id, source_id),
  FOREIGN KEY (archive_id, cohort_id) REFERENCES goalspec_v3_archive.cohort_manifest(archive_id, cohort_id)
);
-- statement-break
CREATE INDEX IF NOT EXISTS artifact_record_run ON goalspec_v3_archive.artifact_record(archive_id, run_id, event_type);
-- statement-break
DO $body$
BEGIN
  IF to_regprocedure('goalspec_v3_archive.reject_change()') IS NULL THEN
    EXECUTE $definition$CREATE FUNCTION goalspec_v3_archive.reject_change() RETURNS trigger LANGUAGE plpgsql AS $function$
      BEGIN RAISE EXCEPTION 'GoalSpec v3 archives are immutable'; END;
    $function$$definition$;
  END IF;
END;
$body$;
-- statement-break
DO $body$
DECLARE archive_table text;
BEGIN
  FOREACH archive_table IN ARRAY ARRAY['archive_import', 'cohort_manifest', 'artifact_file', 'artifact_record'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = format('goalspec_v3_archive.%I', archive_table)::regclass AND tgname = 'reject_archive_change') THEN
      EXECUTE format('CREATE TRIGGER reject_archive_change BEFORE UPDATE OR DELETE OR TRUNCATE ON goalspec_v3_archive.%I FOR EACH STATEMENT EXECUTE FUNCTION goalspec_v3_archive.reject_change()', archive_table);
    END IF;
  END LOOP;
END;
$body$;

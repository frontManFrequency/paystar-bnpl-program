-- Application-local prototype tables (applied after the shared schema.sql).
-- These hold demo-controller state only; no financial facts live here.
BEGIN;
CREATE TABLE IF NOT EXISTS app_demo_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  model_id smallint NOT NULL,
  clock timestamptz NOT NULL,
  fixture_version text NOT NULL,
  seeded_at timestamptz NOT NULL DEFAULT now(),
  originations_paused boolean NOT NULL DEFAULT false,
  pause_reason text
);
CREATE TABLE IF NOT EXISTS app_meeting_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL,
  recorded_by uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('INTERESTED_IN_PILOT_DESIGN','REQUEST_REVISION','DECLINE')),
  reasons text NOT NULL,
  recorded_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS app_uploads (
  id uuid PRIMARY KEY,
  model_id smallint NOT NULL,
  bytes bytea NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paystar_runtime') THEN
    CREATE ROLE paystar_runtime NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO paystar_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO paystar_runtime;
COMMIT;

-- doc 35 W0.2 (B1 P0) — least-privilege app role + enforceable WORM audit.
--
-- PROBLEM (doc 35 §4.2 B1): the app connects to Postgres as the `postgres` SUPERUSER,
-- which BYPASSES Row-Level Security unconditionally. Consequently the append-only
-- RLS on audit_logs (mig 0102) and the hash-chain on control_audit_log (mig 0220)
-- are NOT actually enforced against the running app — a compromised app path (or the
-- DB user itself) could UPDATE/DELETE audit rows. This migration makes the WORM
-- property real by (a) creating a non-superuser app role, (b) FORCE-ing RLS so even
-- the table owner is subject to it, and (c) adding the missing append-only policies
-- on control_audit_log.
--
-- Additive + idempotent. Numbered 0224 (synapse-foundation used 0220-0223).
--
-- ════════════════════════════════════════════════════════════════════════════
-- OPERATOR CUTOVER (two steps — NOT done by this migration, by design):
--   1) Give the role a login + secret (kept OUT of git):
--        ALTER ROLE avi_app WITH LOGIN PASSWORD '<strong-secret>';
--   2) Point the app at it (restart required):
--        DATABASE_URL=postgresql://avi_app:<secret>@localhost:5433/avi_aoi_db
--   Verify after cutover:
--        - app boots, inspection ingest + normal CRUD work (avi_app has full DML
--          on every table EXCEPT update/delete on the two audit tables);
--        - `UPDATE audit_logs SET action='x'` as avi_app → 0 rows / denied;
--        - `DELETE FROM control_audit_log` as avi_app → 0 rows / denied.
--   Until step 2, the app keeps running as postgres and WORM stays advisory —
--   this migration is safe to apply with no behavioural change.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Least-privilege role (NOLOGIN until the operator sets a password) ─────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    CREATE ROLE avi_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO avi_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO avi_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO avi_app;
-- Future tables/sequences created by postgres inherit the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO avi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO avi_app;

-- ─── 2. control_audit_log: enable append-only RLS (mirror of audit_logs/0102) ─
ALTER TABLE control_audit_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='control_audit_log' AND policyname='control_audit_insert_only') THEN
    CREATE POLICY control_audit_insert_only ON control_audit_log FOR INSERT TO PUBLIC WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='control_audit_log' AND policyname='control_audit_select_only') THEN
    CREATE POLICY control_audit_select_only ON control_audit_log FOR SELECT TO PUBLIC USING (true);
  END IF;
END $$;
-- No UPDATE/DELETE policy → denied by default under RLS.

-- ─── 3. FORCE RLS so even a table OWNER (not just non-owners) obeys the policies ─
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE control_audit_log FORCE ROW LEVEL SECURITY;

-- ─── 4. Defense-in-depth: revoke tamper DML on audit tables from the app role ──
REVOKE UPDATE, DELETE ON audit_logs FROM avi_app;
REVOKE UPDATE, DELETE ON control_audit_log FROM avi_app;
